/* The hosted execution proxy.

   The browser must never hold a Judge0 key, and must never be able to hand a
   compiler arbitrary flags. So the page does not talk to Judge0 at all: it
   posts a problem-shaped request here — language, profile name, source, test
   cases — and this translates it, applies every limit, and translates the
   answer back into exactly the shape the local runner returns. Nothing
   downstream of Runners can tell which backend answered.

   Platform-neutral on purpose: one `handle(request, env)` taking and
   returning a standard Request/Response, with a Cloudflare Worker entry in
   worker.mjs and a Node entry in server.mjs. The second one is how this is
   tested without deploying anything.

   ---------------- what this enforces ----------------

   · the upstream credential never leaves the server
   · compiler flags come from the table below, never from the caller
   · only four languages, and only four profiles
   · source size, case count and per-case stdin size are capped
   · cpu, wall and memory limits are clamped whatever the caller asks for
   · a per-IP token bucket, and a smaller bucket for submissions
   · an Origin allowlist, so the endpoint is not a free compiler for anyone
*/

/* ---------------- limits ---------------- */

export const LIMITS = {
  maxSourceBytes: 64 * 1024,
  maxCases: 20,              /* Judge0's own max_submission_batch_size */
  maxStdinBytes: 64 * 1024,
  maxTotalStdinBytes: 256 * 1024,

  /* Clamped regardless of what arrives. Judge0 CE allows up to 20s CPU and
     2 GB; neither is anything a teaching exercise should need. */
  cpuSeconds: { default: 5, max: 10 },
  wallSeconds: { max: 15 },
  memoryKb: { standard: 256000, sanitize: 1024000, strict: 256000, parallel: 512000, max: 1024000 },

  /* Per IP. A person working through a problem runs a handful of times a
     minute; these are generous for that and useless for abuse. */
  bucket: { capacity: 30, refillPerMinute: 20 },
  submitBucket: { capacity: 120, refillPerMinute: 60 },

  upstreamTimeoutMs: 25000,
  pollDeadlineMs: 60000,
};

/* ---------------- the flag table ----------------

   Identical to judge/languages.mjs, which is what makes a problem mean the
   same thing on both backends. tests/proxy.test.mjs compares the two
   character for character. It lives here rather than in the browser because
   a public endpoint that forwards caller-supplied compiler options is a
   remote code execution service with extra steps. */

export const PROFILE_FLAGS = {
  cpp: {
    standard: '-std=c++23 -O2 -Wall -Wextra',
    sanitize: '-std=c++23 -O1 -g -Wall -Wextra -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer',
    strict:   '-std=c++23 -O2 -Wall -Wextra -Wpedantic -Wshadow -Wconversion',
    parallel: '-std=c++23 -O2 -Wall -Wextra -fopenmp -pthread',
  },
  rust: {
    standard: '-O --edition 2021 -D warnings',
    sanitize: '--edition 2021 -C debug-assertions=on -C overflow-checks=on',
    strict:   '-O --edition 2021 -D warnings',
    parallel: '-O --edition 2021',
  },
  python: { standard: '', sanitize: '', strict: '', parallel: '' },
  js:     { standard: '', sanitize: '', strict: '', parallel: '' },
};

export const LANGUAGE_IDS = { cpp: 105, rust: 108, python: 109, js: 102 };

const STATUS = {
  1: 'In Queue', 2: 'Processing', 3: 'Accepted', 4: 'Wrong Answer',
  5: 'Time Limit Exceeded', 6: 'Compilation Error',
  7: 'Runtime Error (SIGSEGV)', 8: 'Runtime Error (SIGXFSZ)',
  9: 'Runtime Error (SIGFPE)', 10: 'Runtime Error (SIGABRT)',
  11: 'Runtime Error (NZEC)', 12: 'Runtime Error (Other)',
  13: 'Internal Error', 14: 'Exec Format Error',
};

/* ---------------- rate limiting ----------------

   In memory, per instance. On a single Node process that is exactly right;
   on a serverless platform it is per isolate, which is weaker but still
   bounds a single caller's burst. A deployment that needs more should put a
   KV- or Durable-Object-backed bucket behind the same interface — the shape
   is deliberately small so that swap is a few lines. */

const buckets = new Map();

export function takeToken(key, spec, now = Date.now()) {
  let b = buckets.get(key);
  if (!b) { b = { tokens: spec.capacity, at: now }; buckets.set(key, b); }
  const refill = ((now - b.at) / 60000) * spec.refillPerMinute;
  b.tokens = Math.min(spec.capacity, b.tokens + refill);
  b.at = now;
  if (b.tokens < 1) {
    const waitMs = Math.ceil(((1 - b.tokens) / spec.refillPerMinute) * 60000);
    return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
  b.tokens -= 1;
  return { ok: true };
}

/* Exposed so a long-lived process does not accumulate one entry per address
   seen since boot. */
export function sweepBuckets(now = Date.now(), maxAgeMs = 30 * 60000) {
  for (const [k, b] of buckets) if (now - b.at > maxAgeMs) buckets.delete(k);
}

/* ---------------- helpers ---------------- */

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...extra },
});

function corsHeaders(origin, allowed) {
  if (!origin || !allowed.length) return {};
  const ok = allowed.some(a => a === '*' || a === origin);
  if (!ok) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
    'Access-Control-Max-Age': '600',
  };
}

const bytes = s => new TextEncoder().encode(String(s ?? '')).length;

function clientKey(request) {
  /* Cloudflare sets CF-Connecting-IP; a reverse proxy sets X-Forwarded-For.
     Falling back to a constant means one shared bucket, which is the safe
     direction to fail in. */
  return request.headers.get('CF-Connecting-IP')
    || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
    || 'unknown';
}

/* ---------------- the request shape ----------------

   { lang, profile, source, cases: [{ stdin }], submission?: bool }

   Deliberately NOT accepting: compiler flags, language ids, time or memory
   limits, or a URL. Everything that decides what the compiler does is
   decided here. */

export function validate(body) {
  if (!body || typeof body !== 'object') return 'a JSON object is required';

  const lang = String(body.lang || '');
  if (!Object.prototype.hasOwnProperty.call(LANGUAGE_IDS, lang)) {
    return `unsupported language "${lang}"`;
  }

  const profile = String(body.profile || 'standard');
  if (!PROFILE_FLAGS[lang][profile]  && profile !== 'standard'
      && !Object.prototype.hasOwnProperty.call(PROFILE_FLAGS[lang], profile)) {
    return `unknown profile "${profile}"`;
  }

  const source = String(body.source ?? '');
  if (!source.trim()) return 'there is no source to run';
  if (bytes(source) > LIMITS.maxSourceBytes) {
    return `the source is larger than ${LIMITS.maxSourceBytes} bytes`;
  }

  const cases = Array.isArray(body.cases) ? body.cases : [];
  if (!cases.length) return 'at least one case is required';
  if (cases.length > LIMITS.maxCases) {
    return `at most ${LIMITS.maxCases} cases per request`;
  }

  let total = 0;
  for (const c of cases) {
    const n = bytes(c && c.stdin);
    if (n > LIMITS.maxStdinBytes) return `one case's stdin is larger than ${LIMITS.maxStdinBytes} bytes`;
    total += n;
  }
  if (total > LIMITS.maxTotalStdinBytes) {
    return `the cases together carry more than ${LIMITS.maxTotalStdinBytes} bytes of stdin`;
  }

  return null;
}

/* ---------------- Judge0 ---------------- */

function upstreamHeaders(env) {
  const h = { 'Content-Type': 'application/json' };
  /* RapidAPI, Sulu and a self-hosted instance each name the header
     differently; whichever is configured is the one sent, and none of them
     is ever visible to the browser. */
  if (env.JUDGE0_RAPIDAPI_KEY) {
    h['X-RapidAPI-Key'] = env.JUDGE0_RAPIDAPI_KEY;
    h['X-RapidAPI-Host'] = env.JUDGE0_RAPIDAPI_HOST || 'judge0-ce.p.rapidapi.com';
  } else if (env.JUDGE0_AUTH_TOKEN) {
    h['X-Auth-Token'] = env.JUDGE0_AUTH_TOKEN;
  }
  return h;
}

const upstreamBase = env =>
  String(env.JUDGE0_URL || 'https://ce.judge0.com').replace(/\/+$/, '');

function toCase(r) {
  const status = Number(r.status_id);
  const timedOut = status === 5;
  const stderr = String(r.stderr || '');
  const fromMessage = /error status (\d+)/.exec(String(r.message || ''));
  const exit = status === 3 ? 0
    : timedOut ? -1
    : fromMessage ? Number(fromMessage[1])
    : (status >= 7 && status <= 12) ? 1
    : 0;

  return {
    stdout: String(r.stdout || ''),
    stderr: stderr || (status !== 3 && r.message ? String(r.message) : ''),
    exit,
    signal: status >= 7 && status <= 10
      ? (STATUS[status] || '').replace(/.*\((SIG\w+)\).*/, '$1') : null,
    timedOut,
    ms: Math.round((Number(r.time) || 0) * 1000),
    sanitizer: /AddressSanitizer|UndefinedBehaviorSanitizer|LeakSanitizer|runtime error:/.test(stderr),
    judge0Status: STATUS[status] || `status ${status}`,
  };
}

async function runOnJudge0(body, env, fetchImpl = fetch) {
  const lang = body.lang;
  const profile = PROFILE_FLAGS[lang][body.profile] !== undefined ? body.profile : 'standard';
  const flags = PROFILE_FLAGS[lang][profile];
  const cases = body.cases;

  const cpu = Math.min(
    LIMITS.cpuSeconds.max,
    Math.max(1, Math.ceil(Number(body.runMs) / 1000) || LIMITS.cpuSeconds.default),
  );
  const memory = Math.min(LIMITS.memoryKb.max, LIMITS.memoryKb[profile] || LIMITS.memoryKb.standard);

  const submissions = cases.map(c => ({
    language_id: LANGUAGE_IDS[lang],
    source_code: body.source,
    stdin: typeof c.stdin === 'string' ? c.stdin : '',
    ...(flags ? { compiler_options: flags } : {}),
    cpu_time_limit: cpu,
    wall_time_limit: Math.min(LIMITS.wallSeconds.max, cpu + 5),
    memory_limit: memory,
  }));

  const base = upstreamBase(env);
  const headers = upstreamHeaders(env);

  const post = await fetchImpl(`${base}/submissions/batch?base64_encoded=false`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ submissions }),
    signal: AbortSignal.timeout(LIMITS.upstreamTimeoutMs),
  });
  if (post.status === 429) throw new Error('the execution service is rate limiting us');
  if (!post.ok) throw new Error(`the execution service returned ${post.status}`);

  const tokens = (await post.json()).map(x => x.token).filter(Boolean);
  if (!tokens.length) throw new Error('the execution service accepted the work but returned no tokens');

  const fields = 'stdout,stderr,status_id,time,memory,message,compile_output';
  const deadline = Date.now() + LIMITS.pollDeadlineMs;
  let delay = 400;

  for (;;) {
    const res = await fetchImpl(
      `${base}/submissions/batch?tokens=${tokens.join(',')}&base64_encoded=false&fields=${fields}`,
      { headers, signal: AbortSignal.timeout(LIMITS.upstreamTimeoutMs) },
    );
    if (res.status === 429) throw new Error('the execution service is rate limiting us');
    if (!res.ok) throw new Error(`the execution service returned ${res.status} while polling`);
    const rows = (await res.json()).submissions || [];
    if (rows.length === tokens.length && rows.every(r => Number(r.status_id) > 2)) {
      return { rows, profile };
    }
    if (Date.now() > deadline) throw new Error('the execution service did not finish in time');
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 2500);
  }
}

/* ---------------- the handler ---------------- */

export async function handle(request, env = {}, fetchImpl = fetch) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const cors = corsHeaders(origin, allowed);
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  /* Health, so the page can say Hosted: ready before anyone presses Run. */
  if (url.pathname.endsWith('/health') && request.method === 'GET') {
    return json({
      ok: true,
      backend: 'hosted',
      languages: Object.keys(LANGUAGE_IDS),
      profiles: Object.keys(PROFILE_FLAGS.cpp),
      limits: {
        maxSourceBytes: LIMITS.maxSourceBytes,
        maxCases: LIMITS.maxCases,
        cpuSeconds: LIMITS.cpuSeconds.max,
      },
      upstreamConfigured: !!(env.JUDGE0_URL || env.JUDGE0_RAPIDAPI_KEY || env.JUDGE0_AUTH_TOKEN),
    }, 200, cors);
  }

  if (!url.pathname.endsWith('/run') || request.method !== 'POST') {
    return json({ error: 'POST /run, or GET /health' }, 404, cors);
  }

  /* An allowlist that is configured and does not contain this origin is a
     refusal. An unconfigured allowlist means "anywhere", which is only for
     local development and is reported as such by /health. */
  if (allowed.length && !allowed.some(a => a === '*' || a === origin)) {
    return json({ error: 'this origin is not allowed to use this endpoint' }, 403, {});
  }

  /* An optional shared secret, for a deployment that wants one on top of the
     origin check. Not a user credential: it only raises the cost of casual
     abuse, which is all a static site can do. */
  if (env.CLIENT_TOKEN) {
    const given = request.headers.get('X-Client-Token');
    if (given !== env.CLIENT_TOKEN) {
      return json({ error: 'this endpoint needs a client token' }, 401, cors);
    }
  }

  const key = clientKey(request);
  const gate = takeToken(key, LIMITS.bucket);
  if (!gate.ok) {
    return json({
      error: `too many runs from this address — try again in ${gate.retryAfter}s`,
      retryAfter: gate.retryAfter,
    }, 429, { ...cors, 'Retry-After': String(gate.retryAfter) });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'the request body is not JSON' }, 400, cors); }

  const bad = validate(body);
  if (bad) return json({ error: bad }, 400, cors);

  /* A submission runs more cases, so it costs more of the hourly budget. */
  const weight = Math.max(1, Math.ceil((body.cases || []).length / 4));
  for (let i = 0; i < weight; i += 1) {
    const g = takeToken(`${key}:hour`, LIMITS.submitBucket);
    if (!g.ok) {
      return json({
        error: `this address has run a lot recently — try again in ${g.retryAfter}s`,
        retryAfter: g.retryAfter,
      }, 429, { ...cors, 'Retry-After': String(g.retryAfter) });
    }
  }

  try {
    const { rows, profile } = await runOnJudge0(body, env, fetchImpl);

    /* One source, so a compilation error is one failure rather than N. The
       reply shape is the local runner's, exactly. */
    const compileError = rows.find(r => Number(r.status_id) === 6);
    if (compileError) {
      return json({
        lang: body.lang, profile, backend: 'hosted',
        compile: {
          ok: false, stdout: '',
          stderr: String(compileError.compile_output || 'compilation failed'),
          ms: 0, timedOut: false,
        },
        cases: [],
      }, 200, cors);
    }

    const warning = rows.map(r => String(r.compile_output || '')).find(t => t.trim());
    return json({
      lang: body.lang, profile, backend: 'hosted',
      compile: { ok: true, stdout: '', stderr: warning || '', ms: 0, timedOut: false },
      cases: rows.map(toCase),
    }, 200, cors);
  } catch (err) {
    /* An upstream failure is an execution failure, never a wrong answer, and
       the page is told so explicitly. */
    return json({
      lang: body.lang, backend: 'hosted',
      compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
      cases: [],
      judgeDown: true,
      judgeError: String((err && err.message) || err),
    }, 502, cors);
  }
}
