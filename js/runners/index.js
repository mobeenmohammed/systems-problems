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

  /* One probe at a time, for the same reason as Hosted.check: the state is
     marked checked before the request comes back, so a concurrent caller
     would otherwise be handed a half-built "nothing is listening". */
  let judgePending = null;

  function checkJudge({ force = false } = {}) {
    const url = Store.config.judgeUrl;
    if (judgePending) return judgePending;
    if (judgeState.checked && judgeState.url === url && !force) return Promise.resolve(judgeState);
    judgePending = probeJudge(url, force).finally(() => { judgePending = null; });
    return judgePending;
  }

  async function probeJudge(url, force) {
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

  /* ---------------- the front door ----------------

     Three backends, and the reader is always told which one answered:

       Browser   JavaScript, in a Worker in this tab. Needs nothing.
       Hosted    a server, through our proxy. Works from any device.
       Local     the runner on this machine. Fastest, and the code never
                 leaves the laptop, but it has to be started.

     The order is deliberate and it is NOT "whatever works". A local runner
     that is up is preferred because it is faster and more private; hosted is
     used when there is no local one. What never happens is a silent fall
     back to localhost from a deployed page: if the page is not served from
     this machine, a request to 127.0.0.1 is either refused or — worse —
     answered by something else entirely, and either way the reader is owed
     the truth about where their code went. */

  const BROWSER = new Set(['js']);

  const BACKEND_LABEL = { browser: 'Browser', hosted: 'Hosted', local: 'Local' };

  const hostedAvailable = () => typeof Hosted !== 'undefined' && Hosted.enabled();

  /* Where a language would run right now, in preference order, or null. */
  async function backendFor(lang) {
    if (BROWSER.has(lang)) return 'browser';

    const judge = await checkJudge();
    if (judge.state === 'ready' && judge.languages.some(l => l.id === lang)) return 'local';

    if (hostedAvailable()) {
      const h = await Hosted.check();
      if (h.up && h.languages.includes(lang)) return 'hosted';
    }
    return null;
  }

  /* Which languages a problem can actually offer, and where each would run.
     A language the editor lists but cannot run is worse than one it does not
     list, so `ready` is strict: it means a submission will execute. */
  async function available(langs = []) {
    const judge = await checkJudge();
    const judgeIds = new Set(judge.languages.map(l => l.id));

    let hosted = { up: false, languages: [] };
    if (hostedAvailable()) hosted = await Hosted.check();
    const hostedIds = new Set(hosted.languages || []);

    return langs.map(id => {
      const browserReady = BROWSER.has(id);
      const localReady = judge.state === 'ready' && judgeIds.has(id);
      const hostedReady = hosted.up && hostedIds.has(id);
      const backend = browserReady ? 'browser'
        : localReady ? 'local'
        : hostedReady ? 'hosted'
        : null;

      return {
        id,
        ready: !!backend,
        installed: browserReady || judgeIds.has(id) || hostedIds.has(id),
        backend,
        where: backend ? BACKEND_LABEL[backend] : null,
        version: (judge.languages.find(l => l.id === id) || {}).version || null,
      };
    });
  }

  /* A single sentence about execution for the whole problem, which is what
     the toolbar shows. Honest about the case where nothing can run. */
  async function describe(langs = []) {
    const rows = await available(langs);
    const ready = rows.filter(r => r.ready);
    const blocked = rows.filter(r => !r.ready);
    const judge = await checkJudge();

    if (!rows.length) return { kind: 'idle', text: '' };

    if (!ready.length) {
      const names = blocked.map(r => r.id.toUpperCase()).join(' and ');
      if (hostedAvailable()) {
        const h = await Hosted.check();
        return {
          kind: 'blocked',
          text: `${names} cannot run: the hosted runner is not answering`
            + `${h.error ? ` (${h.error})` : ''}.`,
        };
      }
      return {
        kind: 'blocked',
        text: `${names} needs a runner. Start one with npm run runner, or `
          + 'turn on hosted execution in Settings.',
      };
    }

    const byBackend = {};
    for (const r of ready) (byBackend[r.backend] = byBackend[r.backend] || []).push(r.id);
    const parts = Object.entries(byBackend)
      .map(([b, ids]) => `${BACKEND_LABEL[b]}: ${ids.join(', ')}`);
    void judge;
    return {
      kind: 'ready',
      text: parts.join(' · ')
        + (blocked.length ? ` · ${blocked.map(r => r.id).join(', ')} unavailable` : ''),
    };
  }

  /* Runs it, and says who did. */
  async function run(lang, source, cases, opts = {}) {
    const backend = await backendFor(lang);

    if (backend === 'browser') {
      const reply = await runLocalJs(source, cases, opts);
      return { ...reply, backend: 'browser' };
    }
    if (backend === 'local') {
      const reply = await runRemote(lang, source, cases, opts);
      return { ...reply, backend: 'local' };
    }
    if (backend === 'hosted') {
      return Hosted.run(lang, source, cases, opts);
    }

    /* Nothing can run this. Say so plainly, with the specific reason, and do
       not post the source anywhere on the way to finding that out. */
    const judge = await checkJudge();
    let why;
    if (hostedAvailable()) {
      const h = await Hosted.check();
      why = `The hosted runner is not answering${h.error ? ` (${h.error})` : ''}.`;
    } else if (judge.state === 'unauthed') {
      why = `A runner is listening at ${judge.url} but refused this page. `
        + 'Reload, or paste its token under Settings.';
    } else if (judge.state === 'down') {
      why = `No runner is listening at ${judge.url}. Start one with npm run runner, `
        + 'or turn on hosted execution in Settings.';
    } else {
      why = 'No runner is configured for this language.';
    }

    return {
      lang,
      backend: null,
      compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
      cases: [],
      judgeDown: true,
      judgeError: why,
    };
  }

  return {
    run, available, describe, backendFor, checkJudge, loadToken, authHeaders,
    BACKEND_LABEL,
    /* The one place a backend is turned into words for a person to read, so
       "Hosted" cannot drift into "hosted" or "the server" somewhere else. */
    label: b => BACKEND_LABEL[b] || 'No runner',
    get judge() { return judgeState; },
    get token() { return token; },
    /* Exposed for tests, which drive the JS path without a browser. */
    runLocalJs,
  };
})();
