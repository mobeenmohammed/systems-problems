/* ============================================================
   server.mjs — the local code runner.

     GET  /health   is it up, and what is missing if so
     GET  /langs    what it can compile, with versions
     POST /lint     syntax check only, for the editor
     POST /run      compile once, run every case, answer once

   One compile and N cases per request, because a problem has one
   submission and several tests, and N round trips to compile the
   same source N times would be absurd.

   ---------------- what keeps this safe ----------------

   Three things, and all three have to hold:

     1. It binds loopback only — not 0.0.0.0, not a LAN address,
        and a non-loopback JUDGE_HOST is refused at startup rather
        than quietly honoured. Nothing off this machine can reach
        it at all.
     2. Every request but /health must carry a shared token, in
        an Authorization: Bearer or X-Judge-Token header. The
        token is generated per start, printed, and written to a
        file the page reads.
     3. The Origin header must be one we know. A browser sets
        Origin on a cross-origin POST and a page cannot forge it,
        so this is what stops some other site using your runner
        even if it had the token.

   Deliberately belt-and-braces. What is being guarded is "runs
   arbitrary code as you", so being careful is cheap by
   comparison. It is still NOT a hardened sandbox and must never
   be exposed to a network. See judge/README.md.
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LANGS, flagsFor, sawSanitizer } from './languages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.JUDGE_PORT || 2000);
const HOST = process.env.JUDGE_HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

/* Caps. Generous enough for anything a problem here asks for, small enough
   that a runaway loop printing to stdout cannot fill the disk or the reply. */
const MAX_SOURCE   = 256 * 1024;
const MAX_CASES    = 60;
const MAX_OUTPUT   = 64 * 1024;      /* per stream, per case */
/* 20s was enough on a warm machine and not on a cold one: the first rustc of
   a CI run faulted in its libraries from a fresh disk and went past it,
   failing a trivial program with no stderr at all. The compiler is our own
   trusted toolchain — the cap that matters is the one on the submitted
   program's run, below — so this is generous on purpose. */
const COMPILE_MS   = Number(process.env.JUDGE_COMPILE_MS || 45_000);
const RUN_MS       = 5_000;
const HARD_RUN_MS  = 30_000;
const LINT_MS      = 10_000;         /* a syntax check runs while you type */

/* A char code rather than an escape: the editing that produced this file has
   eaten a backslash before now, and a newline written as text is silent. */
const NEWLINE = String.fromCharCode(10);

/* ---------------- the token ----------------

   Generated per start and written into data/ so the page can fetch it.
   Anything able to read that file already runs as you, so the file is not the
   security boundary — the Origin check is. The token is what stops a page on
   another origin that has somehow got past CORS. */

const TOKEN_FILE = process.env.JUDGE_TOKEN_FILE
  || path.join(HERE, '..', 'data', 'judge-token.json');

let TOKEN = process.env.JUDGE_TOKEN || '';

/* Generating the token and publishing it are two steps on purpose.

   They used to be one, run before listen(), so starting a second runner
   while the first was up overwrote the live instance's token file and then
   died on EADDRINUSE. The page would then read a token belonging to a
   process that no longer existed, and report "running, but it refused this
   page" — a state that looked like a bug in the page and was a bug here.

   Now nothing is written until the port is actually ours. */
function makeToken() {
  if (!TOKEN) TOKEN = crypto.randomBytes(24).toString('base64url');
  return TOKEN;
}

async function publishToken() {
  makeToken();
  try {
    await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
    await fs.writeFile(
      TOKEN_FILE,
      JSON.stringify({
        token: TOKEN,
        port: PORT,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, null, 2) + NEWLINE,
      'utf8',
    );
  } catch (err) {
    console.error(`could not write ${TOKEN_FILE}: ${err.message}`);
    console.error('the page will not find the token; paste it into Settings instead');
  }
  return TOKEN;
}

/* The file names whoever is listening, so it goes when they do. Leaving a
   token for a dead process is how the page ends up reporting "refused" when
   the honest answer is "nothing is running". */
/* Synchronous on purpose. This runs from a signal handler and from the exit
   hook, and an awaited unlink does not reliably land before the process goes
   away — which leaves a token file on disk naming a runner that is no longer
   there. The pid check is what makes a second instance safe: it will not
   delete a file belonging to the one that is actually serving. */
function retractToken() {
  try {
    const raw = fsSync.readFileSync(TOKEN_FILE, 'utf8');
    if (JSON.parse(raw).pid === process.pid) fsSync.unlinkSync(TOKEN_FILE);
  } catch { /* already gone, or never ours */ }
}

/* ---------------- origins ----------------

   Loopback on any port, so `npm run serve` works whatever port it picks, and
   the GitHub Pages site. A request with no Origin is allowed: curl and the
   health check send none, and they are not the threat — a browser always
   sends it on a cross-origin POST. */
const ALLOWED_ORIGIN = [
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https:\/\/[\w-]+\.github\.io$/,
];

const extraOrigins = (process.env.JUDGE_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

export function originAllowed(origin) {
  if (!origin) return true;
  if (extraOrigins.includes(origin)) return true;
  return ALLOWED_ORIGIN.some(re => re.test(origin));
}

export function tokenOk(req) {
  const given = req.headers['x-judge-token']
    || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!given || !TOKEN) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(TOKEN);
  /* Constant-time, so a wrong token does not leak how much of it was right. */
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- running a process ---------------- */

let prlimit = null;
export async function detectPrlimit() {
  try {
    const r = await exec('prlimit', ['--version'], { timeoutMs: 2000 });
    prlimit = r.exit === 0;
  } catch { prlimit = false; }
  return prlimit;
}

const LIMITS = ['--nproc=512', '--fsize=67108864', '--nofile=512'];

/* An address-space cap guards against one runaway allocation taking the
   machine with it — but it is fatal to a sanitized build. AddressSanitizer
   reserves on the order of 20 TB of *virtual* address space for shadow memory
   at startup, so any RLIMIT_AS makes every instrumented binary die before
   main() with an allocation failure that even looks like a sanitizer report.

   It is also not applied to the compiler: rustc and g++ reserve large virtual
   arenas, and capping them makes a compile crawl or stall. The compiler is our
   own trusted toolchain; the thing to guard is the submitted program's run. */
const AS_LIMIT = '--as=4294967296';

function wrap(cmd, args, { stage = 'run', sanitized = false } = {}) {
  if (!prlimit) return [cmd, args];
  const capAddressSpace = stage === 'run' && !sanitized;
  const limits = capAddressSpace ? [...LIMITS, AS_LIMIT] : LIMITS;
  return ['prlimit', [...limits, '--', cmd, ...args]];
}

export function exec(cmd, args, { cwd, stdin = '', timeoutMs = RUN_MS, env } = {}) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        /* NO_COLOR and FORCE_COLOR=0 are deliberate and go after the
           inherited environment. Node colourises console.log of a number
           whenever FORCE_COLOR is set, and several terminals and CI runners
           set it; the judge would then hand back "[33m42[39m"
           where the problem expected "42" and mark a correct answer wrong.
           Program output is compared byte for byte, so it must be plain. */
        env: { ...process.env, ...env, NO_COLOR: '1', FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ stdout: '', stderr: String(err.message), exit: -1, signal: null, timedOut: false, ms: 0 });
      return;
    }

    let stdout = '';
    let stderr = '';
    let outTruncated = false;
    let errTruncated = false;
    let timedOut = false;
    let done = false;

    const take = (chunk, which) => {
      const s = chunk.toString('utf8');
      if (which === 'out') {
        if (stdout.length >= MAX_OUTPUT) { outTruncated = true; return; }
        stdout += s.slice(0, MAX_OUTPUT - stdout.length);
        if (stdout.length >= MAX_OUTPUT) outTruncated = true;
      } else {
        if (stderr.length >= MAX_OUTPUT) { errTruncated = true; return; }
        stderr += s.slice(0, MAX_OUTPUT - stderr.length);
        if (stderr.length >= MAX_OUTPUT) errTruncated = true;
      }
    };

    child.stdout.on('data', c => take(c, 'out'));
    child.stderr.on('data', c => take(c, 'err'));

    /* SIGKILL rather than SIGTERM: a tight loop with no handler ignores the
       polite one, and the whole point here is a guaranteed stop. */
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, Math.min(timeoutMs, HARD_RUN_MS));

    const finish = (exit, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        stdout: outTruncated ? stdout + NEWLINE + '…output truncated…' : stdout,
        stderr: errTruncated ? stderr + NEWLINE + '…output truncated…' : stderr,
        exit, signal, timedOut,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    };

    child.on('error', err => { stderr += String(err.message); finish(-1, null); });
    child.on('close', (code, signal) => finish(code === null ? -1 : code, signal));

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
    child.stdin.on('error', () => { /* the program exited without reading stdin */ });
  });
}

/* Windows refuses to spawn an extension-less file even when it is a valid PE
   image, and the two compilers disagree about whose job the suffix is: g++
   appends .exe to a bare -o name, rustc takes it literally. So the suffix is
   asked for up front. Under WSL or Linux this is simply "prog". */
const EXE = process.platform === 'win32' ? '.exe' : '';

async function resolveBin(bin) {
  for (const candidate of [bin, `${bin}.exe`, bin.replace(/\.exe$/, '')]) {
    try { await fs.access(candidate); return candidate; } catch { /* next */ }
  }
  return bin;
}

/* ---------------- /lint ---------------- */

export async function lint({ lang, source, profile = 'standard' }) {
  const spec = LANGS[lang];
  if (!spec) return { error: `unknown language "${lang}"` };
  if (typeof source !== 'string') return { error: 'no source' };
  if (source.length > MAX_SOURCE) return { error: `source exceeds ${MAX_SOURCE} bytes` };
  if (!spec.syntax) return { error: `no syntax check for "${lang}"` };
  if (!source.trim()) return { lang, ok: true, diagnostics: [], ms: 0 };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lint-'));
  try {
    const src = path.join(dir, spec.file);
    await fs.writeFile(src, source, 'utf8');
    for (const aux of spec.aux || []) {
      await fs.writeFile(path.join(dir, aux.name), aux.content, 'utf8');
    }

    const flags = flagsFor(lang, profile);
    const [cmd, args] = spec.syntax({ src, dir, flags });
    const [wc, wa] = wrap(cmd, args, { stage: 'compile', sanitized: profile === 'sanitize' });
    const res = await exec(wc, wa, { cwd: dir, timeoutMs: LINT_MS });

    if (res.timedOut) return { lang, ok: false, timedOut: true, diagnostics: [], ms: res.ms };

    const diagnostics = spec.diagnostics ? spec.diagnostics(res.stderr + NEWLINE + res.stdout) : [];

    /* A non-zero exit with nothing parsed means the compiler said something in
       a shape the parser does not know. Returning the raw text beats silently
       reporting "no problems" on code that does not build. */
    if (res.exit !== 0 && !diagnostics.length) {
      const raw = (res.stderr || res.stdout || '').trim();
      if (raw) diagnostics.push({ line: 1, column: 1, severity: 'error', message: raw.split(NEWLINE)[0] });
    }

    return { lang, ok: res.exit === 0, diagnostics, ms: res.ms };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------------- /run ---------------- */

export async function run({ lang, source, profile = 'standard', cases = [], limits = {} }) {
  const spec = LANGS[lang];
  if (!spec) return { error: `unknown language "${lang}"` };
  if (typeof source !== 'string' || !source.trim()) return { error: 'no source' };
  if (source.length > MAX_SOURCE) return { error: `source exceeds ${MAX_SOURCE} bytes` };
  if (!Array.isArray(cases) || !cases.length) return { error: 'no cases' };
  if (cases.length > MAX_CASES) return { error: `more than ${MAX_CASES} cases` };

  /* A language the machine cannot run is reported as missing rather than as a
     compile failure, because the fix is to install something. */
  const row = (await languages()).find(l => l.id === lang);
  if (row && !row.available) {
    return {
      error: `${spec.label} is not installed on the runner`,
      missing: lang,
      hint: spec.install || null,
    };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'judge-'));
  try {
    const src = path.join(dir, spec.file);
    const bin = path.join(dir, `prog${EXE}`);
    await fs.writeFile(src, source, 'utf8');

    /* Some languages need a companion file next to the submission — the
       JavaScript shim providing the same stdin/stdout helpers the in-browser
       Worker does, so a submission means one thing in both places. */
    for (const aux of spec.aux || []) {
      await fs.writeFile(path.join(dir, aux.name), aux.content, 'utf8');
    }

    const flags = flagsFor(lang, profile);
    const compileMs = Math.min(Number(limits.compileMs) || COMPILE_MS, COMPILE_MS);
    const runMs     = Math.min(Number(limits.runMs) || RUN_MS, HARD_RUN_MS);
    const sanitized = profile === 'sanitize';

    /* --- compile --- */
    const [ccmd, cargs] = spec.compile({ src, bin, dir, flags });
    const [wc, wa] = wrap(ccmd, cargs, { stage: 'compile', sanitized });
    const compiled = await exec(wc, wa, { cwd: dir, timeoutMs: compileMs });

    const compile = {
      ok: compiled.exit === 0 && !compiled.timedOut,
      stdout: compiled.stdout,
      /* Returned even on success, on purpose: warnings are the lesson. */
      stderr: compiled.stderr,
      ms: compiled.ms,
      timedOut: compiled.timedOut,
    };

    if (!compile.ok) return { lang, profile, compile, cases: [] };

    /* --- run each case --- */
    const binPath = await resolveBin(bin);
    const [rcmd, rargs] = spec.run({ src, bin: binPath, dir });
    const results = [];

    for (const c of cases) {
      const extra = Array.isArray(c.args) ? c.args.map(String) : [];
      const [wrc, wra] = wrap(rcmd, [...rargs, ...extra], { stage: 'run', sanitized });
      const out = await exec(wrc, wra, {
        cwd: dir,
        stdin: typeof c.stdin === 'string' ? c.stdin : '',
        timeoutMs: runMs,
        env: {
          ASAN_OPTIONS: 'detect_leaks=1:abort_on_error=0:print_stacktrace=1:log_to_stderr=1',
          UBSAN_OPTIONS: 'print_stacktrace=1',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUNBUFFERED: '1',
          OMP_NUM_THREADS: '4',
        },
      });

      results.push({
        stdout: out.stdout,
        stderr: out.stderr,
        exit: out.exit,
        signal: out.signal,
        timedOut: out.timedOut,
        ms: out.ms,
        sanitizer: sawSanitizer(out.stderr),
      });
    }

    return { lang, profile, compile, cases: results };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------------- /langs ---------------- */

let langCache = null;

export async function languages({ fresh = false } = {}) {
  if (langCache && !fresh) return langCache;
  const out = [];
  for (const [id, spec] of Object.entries(LANGS)) {
    const [cmd, args] = spec.version;
    const res = await exec(cmd, args, { timeoutMs: 5000 });
    const version = (res.stdout || res.stderr || '').trim().split(NEWLINE)[0];
    out.push({
      id,
      label: spec.label,
      available: res.exit === 0,
      version: res.exit === 0 ? version : null,
      /* What to do about it, rather than only that it is missing. */
      install: res.exit === 0 ? null : (spec.install || null),
    });
  }
  langCache = out;
  return out;
}

/* ---------------- http ---------------- */

function cors(req, res) {
  const origin = req.headers.origin;
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Judge-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const send = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
};

function readBody(req, max = MAX_SOURCE * 2) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* Every refusal says what to do about it. A bare "403 forbidden" is the most
   annoying thing a local tool can do to you. */
function guard(req, res) {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    send(res, 403, {
      error: 'origin not allowed',
      origin,
      hint: 'The runner accepts loopback origins and https://<user>.github.io. '
          + 'Set JUDGE_ORIGINS="https://example.test" to add one.',
    });
    return false;
  }
  if (!tokenOk(req)) {
    send(res, 401, {
      error: 'missing or wrong token',
      hint: 'The page reads data/judge-token.json, which the runner writes at '
          + 'startup. If the runner restarted, reload the page. Otherwise copy '
          + 'the token from the runner log into Settings.',
    });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  try {
    /* /health is deliberately unauthenticated: the page must be able to tell
       "not running" from "running, wrong token", and it reveals nothing but
       version strings. */
    if (req.method === 'GET' && url.pathname === '/health') {
      const langs = await languages();
      return send(res, 200, {
        ok: true,
        service: 'systems-lab-runner',
        prlimit,
        platform: `${process.platform} ${process.arch}`,
        wsl: !!process.env.WSL_DISTRO_NAME,
        distro: process.env.WSL_DISTRO_NAME || null,
        needsToken: true,
        languages: langs.map(l => ({ id: l.id, available: l.available, version: l.version })),
        missing: langs.filter(l => !l.available).map(l => ({ id: l.id, install: l.install })),
      });
    }

    if (req.method === 'GET' && url.pathname === '/langs') {
      if (!guard(req, res)) return;
      return send(res, 200, { languages: await languages({ fresh: url.searchParams.has('fresh') }) });
    }

    if (req.method === 'POST' && (url.pathname === '/lint' || url.pathname === '/run')) {
      if (!guard(req, res)) return;
      let payload;
      try { payload = JSON.parse(await readBody(req)); }
      catch (err) { return send(res, 400, { error: `bad request body: ${err.message}` }); }
      const result = url.pathname === '/lint' ? await lint(payload) : await run(payload);
      return send(res, result.error ? 400 : 200, result);
    }

    return send(res, 404, { error: 'not found', hint: 'try /health, /langs, /lint or /run' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err && err.message || err) });
  }
});

/* ---------------- startup ---------------- */

const isMain = process.argv[1] && process.argv[1].endsWith('server.mjs');

if (isMain) {
  if (!LOOPBACK.includes(HOST)) {
    console.error(`refusing to bind ${HOST}: this runner is loopback-only.`);
    console.error('It executes arbitrary code as you and has no sandbox worth the name.');
    process.exit(1);
  }

  makeToken();
  await detectPrlimit();
  const langs = await languages();

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`port ${PORT} is already in use — another runner is already up.`);
      console.error('Nothing has been changed; the running one keeps its token.');
      console.error('  npm run runner:status   to see what is there');
      console.error('  npm run runner:stop     to stop it');
      console.error('  JUDGE_PORT=2001 npm run runner   to run a second one beside it');
    } else {
      console.error(`could not listen: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, async () => {
    /* The port is ours, so the token file may now name us. */
    await publishToken();
    const rule = '-'.repeat(60);
    console.log(rule);
    console.log(`  Systems Lab runner    http://${HOST}:${PORT}`);
    if (process.env.WSL_DISTRO_NAME) console.log(`  WSL distro            ${process.env.WSL_DISTRO_NAME}`);
    console.log(`  prlimit guards        ${prlimit ? 'on' : 'unavailable'}`);
    console.log(`  token                 ${TOKEN}`);
    console.log(`  token file            ${TOKEN_FILE}`);
    console.log(rule);
    for (const l of langs) {
      console.log(`  ${l.available ? 'ok  ' : '--  '} ${l.id.padEnd(7)} ${l.version || 'NOT INSTALLED'}`);
    }
    const missing = langs.filter(l => !l.available && l.install);
    if (missing.length) {
      console.log(rule);
      console.log('  to add what is missing:');
      for (const l of missing) console.log(`    ${l.id.padEnd(7)} ${l.install}`);
    }
    console.log(rule);
    console.log('  loopback only. never expose this to a network.');
    console.log(rule);
  });

  /* Tidy up on the way out, so the next start is not confused by a token
     that belongs to nobody. */
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      retractToken();
      process.exit(0);
    });
  }
  /* A catch-all for the ways a process ends without a signal we handle. */
  process.on('exit', retractToken);
}

export { server };
export const tokenFile = () => TOKEN_FILE;
export const currentToken = () => TOKEN;
