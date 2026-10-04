/* ============================================================
   runners/index.js — where each language runs, behind one call.

     Runners.run(lang, source, cases, opts)
        -> { compile, cases: [{ stdout, stderr, exit, signal,
                                timedOut, ms, sanitizer }] }

   JavaScript runs in a Web Worker in this tab: instant, offline,
   and killable, because terminating a worker stops an infinite
   loop dead. Everything else goes to the judge over HTTP, which
   is the only way to get a real g++ or rustc — with real
   diagnostics and real sanitizers — out of a static site.

   Every backend answers in the judge's shape, so the type module
   and the UI never learn which one ran.
   ============================================================ */

const Runners = (() => {

  /* ---------------- the in-tab JavaScript runner ---------------- */

  /* The worker source, as text. It is built into a Blob rather than kept in a
     file so that there is no second request to get wrong, and so the whole
     runner is one thing to read.

     Submissions here read stdin and write stdout, exactly as they do under the
     judge, so a problem means the same thing in every language. */
  const WORKER_SRC = `
    self.onmessage = (e) => {
      const { source, stdin } = e.data;
      let out = '';
      let err = '';
      const encoder = new TextEncoder();

      /* A tiny stdin/stdout shim. The names match what the starter templates
         use, and console.log is wired to the same buffer so a submission that
         just logs behaves as expected. */
      const api = {
        readStdin: () => stdin,
        readLines: () => stdin.replace(/\\r\\n?/g, '\\n').split('\\n'),
        print: (...a) => { out += a.join(' ') + '\\n'; },
        write: (s) => { out += String(s); },
      };

      const console_ = {
        log:   (...a) => api.print(...a.map(String)),
        error: (...a) => { err += a.map(String).join(' ') + '\\n'; },
        warn:  (...a) => { err += a.map(String).join(' ') + '\\n'; },
        info:  (...a) => api.print(...a.map(String)),
      };

      let exit = 0;
      const started = Date.now();
      try {
        const fn = new Function(
          'readStdin', 'readLines', 'print', 'write', 'console',
          '"use strict";\\n' + source
        );
        fn(api.readStdin, api.readLines, api.print, api.write, console_);
      } catch (ex) {
        err += (ex && ex.stack ? ex.stack : String(ex)) + '\\n';
        exit = 1;
      }

      self.postMessage({
        stdout: out, stderr: err, exit,
        signal: null, timedOut: false, ms: Date.now() - started, sanitizer: false,
      });
    };
  `;

  let workerUrl = null;
  function ensureWorkerUrl() {
    if (!workerUrl) {
      workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    }
    return workerUrl;
  }

  /* One worker per case, torn down after. Reusing one would be faster, but a
     submission that leaves a timer or a mutated global behind would then leak
     into the next case, and a case passing because of what the previous one
     did is the worst kind of wrong answer. */
  function runJsCase(source, stdin, limitMs) {
    return new Promise(resolve => {
      let worker;
      try {
        worker = new Worker(ensureWorkerUrl());
      } catch (err) {
        resolve({ stdout: '', stderr: `could not start a worker: ${err.message}`, exit: -1, signal: null, timedOut: false, ms: 0, sanitizer: false });
        return;
      }

      let settled = false;
      const started = Date.now();

      const done = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch {}
        resolve(result);
      };

      /* The reason the worker exists: a `while (true) {}` in a submission
         cannot be interrupted any other way. */
      const timer = setTimeout(() => done({
        stdout: '', stderr: '', exit: -1, signal: 'SIGKILL',
        timedOut: true, ms: Date.now() - started, sanitizer: false,
      }), limitMs);

      worker.onmessage = e => done(e.data);
      worker.onerror = e => done({
        stdout: '', stderr: e.message || 'worker error', exit: 1, signal: null,
        timedOut: false, ms: Date.now() - started, sanitizer: false,
      });

      worker.postMessage({ source, stdin: typeof stdin === 'string' ? stdin : '' });
    });
  }

  async function runLocalJs(source, cases, { runMs = 2000 } = {}) {
    /* new Function throws on a syntax error before anything runs, which is the
       browser's equivalent of a compile failure — so it is reported as one. */
    try {
      new Function(source);
    } catch (err) {
      return {
        lang: 'js',
        compile: { ok: false, stdout: '', stderr: `${err.name}: ${err.message}`, ms: 0, timedOut: false },
        cases: [],
      };
    }

    const results = [];
    for (const c of cases) {
      results.push(await runJsCase(source, c.stdin, runMs));
    }
    return { lang: 'js', compile: { ok: true, stdout: '', stderr: '', ms: 0, timedOut: false }, cases: results };
  }

  /* ---------------- the runner ----------------

     Four states, not two, because "I have not looked" and "it answered and
     refused me" need different things said about them:

       unchecked  nothing asked yet
       down       nothing listening — start it
       unauthed   listening, but the token is missing or stale — reload
       ready      listening and willing

     /health is unauthenticated precisely so the first three can be told
     apart. Everything else needs the token. */

  let judgeState = {
    checked: false, up: false, authed: false,
    languages: [], missing: [], url: '', error: '', info: null,
    state: 'unchecked',
  };

  /* The runner writes its token into data/ at startup and the page reads it
     from there. That file is not the security boundary — anything able to read
     it already runs as you — the Origin check on the runner is. */
  const TOKEN_URL = 'data/judge-token.json';
  let token = null;
  let tokenTried = false;

  async function loadToken({ force = false } = {}) {
    if (token && !force) return token;
    /* A token typed into Settings wins over the file, for the case where the
       page is served from somewhere the file is not. */
    const manual = Store.config.judgeToken;
    if (manual) { token = manual; return token; }
    if (tokenTried && !force) return token;
    tokenTried = true;
    try {
      const res = await fetch(`${TOKEN_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const body = await res.json();
        token = body.token || null;
      }
    } catch { /* not served from the repo, or not started yet */ }
    return token;
  }

  const authHeaders = () => (token ? { 'X-Judge-Token': token } : {});

  async function checkJudge({ force = false } = {}) {
    const url = Store.config.judgeUrl;
    if (judgeState.checked && judgeState.url === url && !force) return judgeState;

    judgeState = {
      checked: true, up: false, authed: false,
      languages: [], missing: [], url, error: '', info: null, state: 'down',
    };

    /* 1. Is anything there? */
    let health = null;
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      health = await res.json();
    } catch (err) {
      judgeState.error = err && err.name === 'TimeoutError'
        ? 'no answer within 3 seconds'
        : String((err && err.message) || err);
      judgeState.state = 'down';
      return judgeState;
    }

    judgeState.up = true;
    judgeState.info = health;
    judgeState.missing = health.missing || [];

    /* 2. Will it talk to us? */
    await loadToken({ force });
    try {
      const res = await fetch(`${url}/langs`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => ({}));
        judgeState.state = 'unauthed';
        judgeState.error = body.hint || body.error || 'the runner refused the token';
        /* Fall back to what /health said, so the editor can still show which
           languages exist even while the token is wrong. */
        judgeState.languages = (health.languages || []).filter(l => l.available);
        return judgeState;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      judgeState.languages = (body.languages || []).filter(l => l.available);
      judgeState.authed = true;
      judgeState.state = 'ready';
    } catch (err) {
      judgeState.state = 'unauthed';
      judgeState.error = String((err && err.message) || err);
      judgeState.languages = (health.languages || []).filter(l => l.available);
    }
    return judgeState;
  }

  async function runRemote(lang, source, cases, { profile = 'standard', compileMs, runMs, retried = false } = {}) {
    const url = Store.config.judgeUrl;
    await loadToken();
    try {
      const res = await fetch(`${url}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          lang, source, profile,
          cases: cases.map(c => ({ stdin: c.stdin || '', args: c.args || [] })),
          limits: { compileMs, runMs },
        }),
        signal: AbortSignal.timeout(90_000),
      });

      const body = await res.json().catch(() => ({}));

      /* A restarted runner has a new token. Reload it once and try again
         rather than making the reader work out why it stopped. */
      if ((res.status === 401 || res.status === 403) && !retried) {
        await loadToken({ force: true });
        return runRemote(lang, source, cases, { profile, compileMs, runMs, retried: true });
      }

      if (res.status === 401 || res.status === 403) {
        judgeState.state = 'unauthed';
        judgeState.authed = false;
        return {
          lang,
          compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
          cases: [],
          judgeUnauthed: true,
          judgeError: body.hint || body.error || 'the runner refused the token',
        };
      }

      if (!res.ok || body.error) {
        return {
          lang,
          compile: { ok: false, stdout: '', stderr: body.error || `the runner returned ${res.status}`, ms: 0, timedOut: false },
          cases: [],
          judgeError: body.error || `${res.status} ${res.statusText}`,
          judgeMissing: body.missing || null,
          judgeHint: body.hint || null,
        };
      }
      return body;
    } catch (err) {
      judgeState.up = false;
      return {
        lang,
        compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
        cases: [],
        judgeDown: true,
        judgeError: String((err && err.message) || err),
      };
    }
  }

  /* ---------------- the front door ---------------- */

  const LOCAL = new Set(['js']);

  /* Which languages a problem can actually offer right now, and where each
     would run. A language the editor lists but cannot run is worse than one it
     does not list, so `ready` is strict: it means a submission will actually
     execute, not that something plausibly exists. */
  async function available(langs = []) {
    const judge = await checkJudge();
    const judgeIds = new Set(judge.languages.map(l => l.id));

    /* Judge0 is only probed when it is switched on, so the common case costs
       no extra request. */
    let j0 = { up: false, languages: [] };
    if (typeof Judge0 !== 'undefined' && Judge0.enabled()) j0 = await Judge0.check();
    const j0Ids = new Set(j0.languages.map(l => l.id));

    return langs.map(id => {
      const localReady = LOCAL.has(id);
      const runnerReady = judge.state === 'ready' && judgeIds.has(id);
      const j0Ready = j0.up && j0Ids.has(id);
      const where = localReady ? 'in this tab'
        : runnerReady ? 'your runner'
        : j0Ready ? 'Judge0'
        : 'the runner';
      return {
        id,
        ready: localReady || runnerReady || j0Ready,
        installed: localReady || judgeIds.has(id) || j0Ids.has(id),
        where,
        backend: localReady ? 'local' : runnerReady ? 'runner' : j0Ready ? 'judge0' : null,
        version: (judge.languages.find(l => l.id === id) || {}).version
          || (j0.languages.find(l => l.id === id) || {}).version
          || null,
      };
    });
  }

  /* Your own runner first, always: it compiles once for every case, answers in
     milliseconds, and your code never leaves the machine. Judge0 is the
     fallback for a device that cannot reach it. */
  async function run(lang, source, cases, opts = {}) {
    if (LOCAL.has(lang)) return runLocalJs(source, cases, opts);

    const judge = await checkJudge();
    if (judge.state === 'ready' && judge.languages.some(l => l.id === lang)) {
      return runRemote(lang, source, cases, opts);
    }

    if (typeof Judge0 !== 'undefined' && Judge0.supports(lang)) {
      const j0 = await Judge0.check();
      if (j0.up && j0.languages.some(l => l.id === lang)) {
        return Judge0.run(lang, source, cases, opts);
      }
    }

    /* Neither available. Go to the local runner anyway so the reply carries
       its diagnosis — "start the runner", or "the token is stale" — rather
       than a generic failure. */
    return runRemote(lang, source, cases, opts);
  }

  return {
    run, available, checkJudge, loadToken, authHeaders,
    get judge() { return judgeState; },
    get token() { return token; },
    /* Exposed for tests, which drive the JS path without a browser. */
    runLocalJs,
  };
})();
