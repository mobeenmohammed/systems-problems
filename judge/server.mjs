/* ============================================================
   server.mjs — the local judge.

     GET  /health   is it up
     GET  /langs    what it can compile, with versions
     POST /run      compile once, run every case, answer once

   One compile and N cases in a single request, because a problem
   has one submission and several tests, and N round trips to
   compile the same source N times would be absurd.

   It binds 127.0.0.1 only. Browsers exempt loopback *addresses*
   from mixed-content blocking, so the HTTPS page on GitHub Pages
   can call http://127.0.0.1:2000 — but Firefox does not extend
   that exemption to the name "localhost", which is why the site
   ships the address as the default and says so.

   This is NOT a hardened multi-tenant sandbox and does not need
   to be: the only code it ever runs is code you wrote, on your
   own machine. It must never be exposed to the internet. See
   judge/README.md.
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LANGS, flagsFor, sawSanitizer } from './languages.mjs';

const PORT = Number(process.env.JUDGE_PORT || 2000);
const HOST = process.env.JUDGE_HOST || '0.0.0.0';   /* published to 127.0.0.1 by compose */

/* Caps. Generous enough for anything a problem here asks for, small enough
   that a runaway loop printing to stdout cannot fill the disk or the reply. */
const MAX_SOURCE   = 256 * 1024;
const MAX_CASES    = 40;
const MAX_OUTPUT   = 64 * 1024;      /* per stream, per case */
const COMPILE_MS   = 20_000;
const RUN_MS       = 5_000;
const HARD_RUN_MS  = 30_000;

/* Which origins may call this. The deployed site and anything on loopback,
   which covers `npm run serve` and whatever port you happen to use. */
const ALLOWED = [
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https:\/\/[\w-]+\.github\.io$/,
];

const originAllowed = origin => !origin || ALLOWED.some(re => re.test(origin));

/* ---------------- running a process ---------------- */

/* prlimit is in util-linux, which Debian always has. It is what stops a fork
   bomb or a 10 GB allocation from taking the container with it. If it is
   missing the judge still works, just without those guards. */
let prlimit = null;
async function detectPrlimit() {
  try {
    const r = await exec('prlimit', ['--version'], { timeoutMs: 2000 });
    prlimit = r.exit === 0;
  } catch { prlimit = false; }
  return prlimit;
}

const LIMITS = ['--nproc=512', '--fsize=67108864', '--as=4294967296', '--nofile=512'];

function wrap(cmd, args) {
  return prlimit ? ['prlimit', [...LIMITS, '--', cmd, ...args]] : [cmd, args];
}

function exec(cmd, args, { cwd, stdin = '', timeoutMs = RUN_MS, env } = {}) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...env },
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
        stdout: outTruncated ? stdout + '\n…output truncated…' : stdout,
        stderr: errTruncated ? stderr + '\n…output truncated…' : stderr,
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
   asked for up front and both are given a name the platform can execute.
   Inside the Linux container this is simply "prog", as before. */
const EXE = process.platform === 'win32' ? '.exe' : '';

/* Belt and braces: whatever the compiler actually wrote is what gets run. */
async function resolveBin(bin) {
  for (const candidate of [bin, `${bin}.exe`, bin.replace(/\.exe$/, '')]) {
    try { await fs.access(candidate); return candidate; } catch { /* try the next */ }
  }
  return bin;
}

/* ---------------- /run ---------------- */

export async function run({ lang, source, profile = 'standard', cases = [], limits = {} }) {
  const spec = LANGS[lang];
  if (!spec) return { error: `unknown language "${lang}"` };
  if (typeof source !== 'string' || !source.trim()) return { error: 'no source' };
  if (source.length > MAX_SOURCE) return { error: `source exceeds ${MAX_SOURCE} bytes` };
  if (!Array.isArray(cases) || !cases.length) return { error: 'no cases' };
  if (cases.length > MAX_CASES) return { error: `more than ${MAX_CASES} cases` };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'judge-'));
  try {
    const src = path.join(dir, spec.file);
    const bin = path.join(dir, `prog${EXE}`);
    await fs.writeFile(src, source, 'utf8');

    /* Some languages need a companion file next to the submission — the
       JavaScript shim that provides the same stdin/stdout helpers the
       in-browser Worker does, so a submission means one thing everywhere. */
    for (const aux of spec.aux || []) {
      await fs.writeFile(path.join(dir, aux.name), aux.content, 'utf8');
    }

    const flags = flagsFor(lang, profile);
    const compileMs = Math.min(Number(limits.compileMs) || COMPILE_MS, COMPILE_MS);
    const runMs     = Math.min(Number(limits.runMs) || RUN_MS, HARD_RUN_MS);

    /* --- compile --- */
    const [ccmd, cargs] = spec.compile({ src, bin, flags });
    const [wc, wa] = wrap(ccmd, cargs);
    const compiled = await exec(wc, wa, { cwd: dir, timeoutMs: compileMs });

    const compile = {
      ok: compiled.exit === 0 && !compiled.timedOut,
      stdout: compiled.stdout,
      /* Returned even on success, on purpose: warnings are the lesson. */
      stderr: compiled.stderr,
      ms: compiled.ms,
      timedOut: compiled.timedOut,
    };

    if (!compile.ok) {
      return { lang, profile, compile, cases: [] };
    }

    /* --- run each case ---
       The compiler does not always produce exactly the name it was given:
       rustc appends the platform executable suffix on Windows, so -o prog
       yields prog.exe. Inside the container this never matters, but the judge
       is also runnable directly on a Windows host, where looking for the wrong
       name makes every case fail with empty output and no explanation. */
    const binPath = await resolveBin(bin);
    const [rcmd, rargs] = spec.run({ src, bin: binPath, dir });
    const results = [];

    for (const c of cases) {
      const [wrc, wra] = wrap(rcmd, [...rargs, ...(Array.isArray(c.args) ? c.args.map(String) : [])]);
      const out = await exec(wrc, wra, {
        cwd: dir,
        stdin: typeof c.stdin === 'string' ? c.stdin : '',
        timeoutMs: runMs,
        /* A deterministic, quiet environment: an ASan banner on every run
           would drown the actual report. */
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
    /* Never leave a binary or a core file behind; a judge that fills /tmp over
       a week is a judge that stops working for no visible reason. */
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------------- /langs ---------------- */

let langCache = null;

async function languages() {
  if (langCache) return langCache;
  const out = [];
  for (const [id, spec] of Object.entries(LANGS)) {
    const [cmd, args] = spec.version;
    const res = await exec(cmd, args, { timeoutMs: 4000 });
    const version = (res.stdout || res.stderr || '').trim().split('\n')[0];
    out.push({ id, label: spec.label, available: res.exit === 0, version: res.exit === 0 ? version : null });
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const send = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
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

const server = http.createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, prlimit });
    }

    if (req.method === 'GET' && url.pathname === '/langs') {
      return send(res, 200, { languages: await languages() });
    }

    if (req.method === 'POST' && url.pathname === '/run') {
      if (!originAllowed(req.headers.origin)) {
        return send(res, 403, { error: 'origin not allowed' });
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (err) {
        return send(res, 400, { error: `bad request body: ${err.message}` });
      }
      const result = await run(payload);
      return send(res, result.error ? 400 : 200, result);
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err && err.message || err) });
  }
});

/* Importable for tests without starting a listener. */
const isMain = process.argv[1] && process.argv[1].endsWith('server.mjs');
if (isMain) {
  await detectPrlimit();
  const langs = await languages();
  server.listen(PORT, HOST, () => {
    console.log(`judge listening on ${HOST}:${PORT}`);
    console.log(`prlimit guards: ${prlimit ? 'on' : 'unavailable'}`);
    for (const l of langs) {
      console.log(`  ${l.available ? 'ok ' : '-- '} ${l.id.padEnd(7)} ${l.version || 'not installed'}`);
    }
  });
}

export { server, languages, detectPrlimit, exec };
