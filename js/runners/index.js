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

  /* ---------------- the judge ---------------- */

  let judgeState = { checked: false, up: false, languages: [], url: '', error: '' };

  async function checkJudge({ force = false } = {}) {
    const url = Store.config.judgeUrl;
    if (judgeState.checked && judgeState.url === url && !force) return judgeState;

    judgeState = { checked: true, up: false, languages: [], url, error: '' };
    try {
      const res = await fetch(`${url}/langs`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      judgeState.languages = (body.languages || []).filter(l => l.available);
      judgeState.up = true;
    } catch (err) {
      /* Being down is a normal state, not an error: Docker is simply not
         running. The UI says so and gives the command. */
      judgeState.error = err && err.name === 'TimeoutError'
        ? 'no answer within 3 seconds'
        : String((err && err.message) || err);
    }
    return judgeState;
  }

  async function runRemote(lang, source, cases, { profile = 'standard', compileMs, runMs } = {}) {
    const url = Store.config.judgeUrl;
    try {
      const res = await fetch(`${url}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang, source, profile,
          cases: cases.map(c => ({ stdin: c.stdin || '', args: c.args || [] })),
          limits: { compileMs, runMs },
        }),
        signal: AbortSignal.timeout(90_000),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        return {
          lang,
          compile: { ok: false, stdout: '', stderr: body.error || `judge returned ${res.status}`, ms: 0, timedOut: false },
          cases: [],
          judgeError: body.error || `${res.status} ${res.statusText}`,
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

  /* Which languages a problem can actually offer right now. A language the
     editor lists but cannot run is worse than one it does not list. */
  async function available(langs = []) {
    const judge = await checkJudge();
    const judgeIds = new Set(judge.languages.map(l => l.id));
    return langs.map(id => ({
      id,
      ready: LOCAL.has(id) || judgeIds.has(id),
      where: LOCAL.has(id) ? 'in this tab' : 'the judge',
      version: (judge.languages.find(l => l.id === id) || {}).version || null,
    }));
  }

  function run(lang, source, cases, opts = {}) {
    if (LOCAL.has(lang)) return runLocalJs(source, cases, opts);
    return runRemote(lang, source, cases, opts);
  }

  return {
    run, available, checkJudge,
    get judge() { return judgeState; },
    /* Exposed for tests, which drive the JS path without a browser. */
    runLocalJs,
  };
})();
