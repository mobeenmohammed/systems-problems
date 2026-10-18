/* ============================================================
   runners/index.js — where each language runs, behind one call.

     Runners.run(lang, source, cases, opts)
        -> { compile, cases: [{ stdout, stderr, exit, signal,
                                timedOut, ms, sanitizer }] }

   JavaScript runs in a Web Worker in this tab: instant, offline,
   and killable, because terminating a worker stops an infinite
   loop dead. C++ and Python also run in this tab, on a vendored
   clang built to WebAssembly and on Pyodide — so neither of those
   is a g++ or a CPython on Linux, and nothing here says it is.
   What still needs the judge over HTTP is rustc, and anything
   graded on a real sanitizer: there is no sanitizer for
   WebAssembly, and a native toolchain is the only thing that can
   produce one.

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
  let judgeCheckedAt = 0;

  /* How long a *negative* answer is believed. "Ready" is cached until
     something forces a re-probe, because a runner that answered is not
     going to stop between two clicks and a probe per question would be a
     request storm. "Down" and "unauthed" are not cached that way: the
     ordinary way to get a runner is to start one while this page is
     already open, and a dropdown that decided at load time that Rust can
     never run is wrong for the rest of the session. Fifteen seconds is
     long enough that switching language twice costs one probe, short
     enough that `npm run runner` is noticed by the time you have
     alt-tabbed back. */
  const STALE_MS = 15_000;

  function checkJudge({ force = false } = {}) {
    const url = Store.config.judgeUrl;
    if (judgePending) return judgePending;
    const fresh = judgeState.state === 'ready'
      || Date.now() - judgeCheckedAt < STALE_MS;
    if (judgeState.checked && judgeState.url === url && fresh && !force) {
      return Promise.resolve(judgeState);
    }
    judgePending = probeJudge(url, force).finally(() => {
      judgeCheckedAt = Date.now();
      judgePending = null;
    });
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

  /* C++ in the browser is a fourth backend internally and the *same* mode to
     a reader: it runs on this device, in this tab, with nothing installed.
     So it is labelled Browser, like JavaScript, and the only place the
     distinction surfaces is where it has to — "this problem needs the native
     toolchain", which is a property of the problem and not of the mode. */
  const BACKEND_LABEL = {
    browser: 'Browser', browsercpp: 'Browser', browserpy: 'Browser',
    browserrust: 'Browser',
    hosted: 'Hosted', local: 'Local',
  };

  /* The languages, as a reader calls them. `r.id.toUpperCase()` produced
     "CPP and RUST needs the native toolchain" — the wrong name for two
     of the four languages and the wrong verb for any plural. */
  const LANG_NAME = { cpp: 'C++', python: 'Python', rust: 'Rust', js: 'JavaScript' };
  const nameList = rows => rows.map(r => LANG_NAME[r.id] || r.id).join(' and ');
  const verb = rows => (rows.length === 1 ? 'needs' : 'need');

  const browserCpp = () => (typeof BrowserCpp !== 'undefined' ? BrowserCpp : null);
  const browserPy = () => (typeof BrowserPy !== 'undefined' ? BrowserPy : null);
  const browserRust = () => (typeof BrowserRust !== 'undefined' ? BrowserRust : null);

  /* Whether the in-browser compiler would take this particular problem.
     Certified per problem, from data/cxx-support.json, which is generated by
     compiling every reference solution rather than by anybody deciding. */
  async function browserCppFor(lang, problemId) {
    const b = browserCpp();
    if (lang !== 'cpp' || !b || !problemId) return false;
    return b.supportsProblem(problemId);
  }

  /* The same bargain for Python, certified the same way, from
     data/py-support.json. */
  async function browserPyFor(lang, problemId) {
    const b = browserPy();
    if (lang !== 'python' || !b || !problemId) return false;
    return b.supportsProblem(problemId);
  }

  /* And for Rust, from data/rust-support.json. The list is shorter than
     the other two and the reason is in the file: the Cranelift backend
     in this rustc cannot lower a 64-bit widening multiply, so a program
     that reads an i64 out of a string does not build. Type-checking is
     unaffected and is offered on every Rust problem — see
     js/runners/browserrust.js. */
  async function browserRustFor(lang, problemId) {
    const b = browserRust();
    if (lang !== 'rust' || !b || !problemId) return false;
    return b.supportsProblem(problemId);
  }

  const hostedAvailable = () => typeof Hosted !== 'undefined' && Hosted.enabled();

  /* Where a language would run right now, in preference order, or null.

     `problemId` matters for exactly one case: C++ in the browser is only
     offered for problems certified for it. Without one, the answer is the
     same as it has always been. */
  async function backendFor(lang, problemId = null, { multiFile = false } = {}) {
    /* A workspace. One backend can do this — the in-browser toolchain,
       which compiles each translation unit and links the objects. The
       local judge and the hosted one take one file, and handing them
       the entry point alone would report "undefined symbol" about a
       definition the reader did write. So they are not offered. */
    if (multiFile) {
      return (lang === 'cpp' && await browserCppFor(lang, problemId)) ? 'browsercpp' : null;
    }

    if (BROWSER.has(lang)) return 'browser';

    const judge = await checkJudge();
    if (judge.state === 'ready' && judge.languages.some(l => l.id === lang)) return 'local';

    /* Ahead of hosted: it is faster, it is free, and the code never leaves
       the machine. Behind local for the same reasons plus the sanitizer. */
    if (await browserCppFor(lang, problemId)) return 'browsercpp';
    if (await browserPyFor(lang, problemId)) return 'browserpy';
    if (await browserRustFor(lang, problemId)) return 'browserrust';

    if (hostedAvailable()) {
      const h = await Hosted.check();
      if (h.up && h.languages.includes(lang)) return 'hosted';
    }
    return null;
  }

  /* Which languages a problem can actually offer, and where each would run.
     A language the editor lists but cannot run is worse than one it does not
     list, so `ready` is strict: it means a submission will execute. */
  async function available(langs = [], problemId = null, { multiFile = false } = {}) {
    /* Same rule as backendFor, said once: on a workspace the only
       honest answer is the browser toolchain or nothing, and the chip
       over the editor must not promise Local. */
    if (multiFile) {
      const cppHere = await browserCppFor('cpp', problemId);
      const engine = (browserCpp() && browserCpp().toolchain() || {}).compiler || 'clang, WebAssembly';
      return langs.map(id => ({
        id,
        ready: id === 'cpp' && !!cppHere,
        installed: id === 'cpp' && !!cppHere,
        backend: id === 'cpp' && cppHere ? 'browsercpp' : null,
        where: id === 'cpp' && cppHere ? BACKEND_LABEL.browsercpp : null,
        version: id === 'cpp' && cppHere ? engine : null,
      }));
    }

    const judge = await checkJudge();
    const judgeIds = new Set(judge.languages.map(l => l.id));

    let hosted = { up: false, languages: [] };
    if (hostedAvailable()) hosted = await Hosted.check();
    const hostedIds = new Set(hosted.languages || []);

    const cppInBrowser = await browserCppFor('cpp', problemId);
    const pyInBrowser = await browserPyFor('python', problemId);
    const rustInBrowser = await browserRustFor('rust', problemId);

    return langs.map(id => {
      const browserReady = BROWSER.has(id);
      const localReady = judge.state === 'ready' && judgeIds.has(id);
      const inBrowserCpp = id === 'cpp' && cppInBrowser;
      const inBrowserPy = id === 'python' && pyInBrowser;
      const inBrowserRust = id === 'rust' && rustInBrowser;
      const hostedReady = hosted.up && hostedIds.has(id);
      const backend = browserReady ? 'browser'
        : localReady ? 'local'
        : inBrowserCpp ? 'browsercpp'
        : inBrowserPy ? 'browserpy'
        : inBrowserRust ? 'browserrust'
        : hostedReady ? 'hosted'
        : null;

      const inBrowser = inBrowserCpp || inBrowserPy || inBrowserRust;
      const engine = inBrowserCpp
        ? ((browserCpp() && browserCpp().toolchain() || {}).compiler || 'clang, WebAssembly')
        : inBrowserPy
          ? ((browserPy() && browserPy().toolchain() || {}).implementation || 'CPython, WebAssembly')
          : inBrowserRust
            ? ((browserRust() && browserRust().version)
              || (browserRust() && browserRust().toolchain() || {}).version
              || 'rustc, WebAssembly')
            : null;

      return {
        id,
        ready: !!backend,
        installed: browserReady || inBrowser || judgeIds.has(id) || hostedIds.has(id),
        backend,
        where: backend ? BACKEND_LABEL[backend] : null,
        version: engine
          || (judge.languages.find(l => l.id === id) || {}).version || null,
      };
    });
  }

  /* A single sentence about execution for the whole problem, which is what
     the toolbar shows. Honest about the case where nothing can run. */
  async function describe(langs = [], problemId = null, { multiFile = false } = {}) {
    const rows = await available(langs, problemId, { multiFile });
    const ready = rows.filter(r => r.ready);
    const blocked = rows.filter(r => !r.ready);
    const judge = await checkJudge();

    if (!rows.length) return { kind: 'idle', text: '' };

    /* "There is no runner" is the wrong thing to say when there is one and
       this particular problem is the reason it is not being used. Worked out
       once, because it applies whether or not some *other* language on the
       same problem can still run. */
    const nativeOnly = problemId
      ? (blocked.some(r => r.id === 'cpp') && browserCpp()
          ? await browserCpp().reasonFor(problemId) : null)
        || (blocked.some(r => r.id === 'python') && browserPy()
          ? await browserPy().reasonFor(problemId) : null)
        || (blocked.some(r => r.id === 'rust') && browserRust()
          ? await browserRust().reasonFor(problemId) : null)
      : null;

    if (nativeOnly) {
      const names = nameList(blocked);
      const parts = Object.entries(ready.reduce((acc, r) => {
        (acc[r.backend] = acc[r.backend] || []).push(LANG_NAME[r.id] || r.id);
        return acc;
      }, {})).map(([b, ids]) => `${BACKEND_LABEL[b]}: ${ids.join(', ')}`);

      /* "Rust needs the native toolchain for this problem" is true and
         is not the whole truth, and the part it leaves out is the part
         that matters most while you are writing. The browser rustc
         type-checks every Rust problem — the parser, the trait solver
         and the borrow checker are the ones from the release, and the
         editor runs them on every keystroke. Only code generation is
         missing. So a reader on one of these problems gets real E0382
         and E0502 diagnostics as they type and cannot press Run, which
         is a very different thing from "Rust does not work here". */
      const checks = blocked.some(r => r.id === 'rust') && browserRust()
        ? await browserRust().checksProblem(problemId) : false;

      return {
        kind: ready.length ? 'partial' : 'blocked',
        /* Added to the sentence rather than replacing it: on a problem
           where both C++ and Rust are blocked, saying only the thing
           about Rust would drop the fact the reader asked about. */
        /* Composed so it never says the same language twice. With Rust
           the only blocked one, the check is the lead and the missing
           codegen is the qualification; with several, the names come
           first and the check is a note after them. */
        text: `${parts.length ? `${parts.join(' · ')} · ` : ''}`
          + (checks && blocked.length === 1
            ? 'Rust is type-checked here as you type; running this one needs the '
              + 'native toolchain.'
            : `${names} ${verb(blocked)} the native toolchain to run this one.`
              + (checks ? ' Rust is still type-checked here.' : '')),
        nativeOnly,
        checks,
      };
    }

    if (!ready.length) {
      const names = nameList(blocked);
      if (hostedAvailable()) {
        const h = await Hosted.check();
        return {
          kind: 'blocked',
          text: `${names} cannot run: the hosted runner is not answering`
            + `${h.error ? ` (${h.error})` : ''}.`,
        };
      }
      /* No shell command in the toolbar. A reader on a problem that
         cannot run needs to know that, and needs somewhere to read why;
         what they do not need is `npm run runner` in a strip under the
         editor, which is advanced documentation wearing the costume of
         an error message. The command lives on the setup page, which
         this links to. */
      return {
        kind: 'blocked',
        text: `${names} cannot run in this browser. There is a native toolchain `
          + 'option, which is optional and explained under Running code.',
      };
    }

    const byBackend = {};
    for (const r of ready) (byBackend[r.backend] = byBackend[r.backend] || []).push(LANG_NAME[r.id] || r.id);
    const parts = Object.entries(byBackend)
      .map(([b, ids]) => `${BACKEND_LABEL[b]}: ${ids.join(', ')}`);

    /* "cpp unavailable" is a fact, not advice. If something is blocked, the
       sentence has to carry the reason and the fix — otherwise the reader is
       told that C++ does not work and left to guess whose fault it is. */
    let tail = '';
    if (blocked.length) {
      const names = nameList(blocked);
      tail = ` · ${names} cannot run: `;

      if (hostedAvailable()) {
        const h = await Hosted.check();
        tail += h.up
          ? 'the hosted runner does not offer it.'
          : `the hosted runner is not answering${h.error ? ` (${h.error})` : ''}.`;
      } else if (judge.state === 'unauthed') {
        tail += 'the local runner refused this page — reload, or paste its token in Settings.';
      } else {
        /* No shell command in a strip under the editor. See the other
           branch: the native toolchain is advanced documentation and
           lives on the setup page. */
        tail += 'there is no runner for it here. The native toolchain is optional '
          + 'and explained under Running code.';
      }
    }

    return { kind: blocked.length ? 'partial' : 'ready', text: parts.join(' · ') + tail };
  }

  /* Runs it, and says who did. */
  async function run(lang, source, cases, opts = {}) {
    /* A workspace arrives as opts.files; `source` is then the entry
       point's text and is used for nothing but the size check inside
       the backend. */
    const multiFile = Array.isArray(opts.files) && opts.files.length > 0;
    const backend = await backendFor(lang, opts.problemId || null, { multiFile });

    if (multiFile) {
      if (backend !== 'browsercpp') {
        return {
          lang,
          backend: null,
          compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
          cases: [],
          judgeDown: true,
          kind: 'toolchain',
          judgeError: 'This exercise is built from several files, and the '
            + 'in-browser C++ toolchain is the only thing here that can do that.',
          detail: 'Separate translation units are compiled and linked by the '
            + 'clang in this tab. The optional local runner and the hosted one '
            + 'both take a single file, so neither is offered for a workspace.',
        };
      }
      return browserCpp().runFiles(opts.files, cases, {
        runMs: opts.runMs,
        signal: opts.signal,
        onStage: opts.onStage,
        sources: opts.sources || null,
        entry: opts.entry || null,
      });
    }

    if (backend === 'browser') {
      const reply = await runLocalJs(source, cases, opts);
      return { ...reply, backend: 'browser' };
    }
    if (backend === 'browserpy') {
      return browserPy().run(source, cases, {
        runMs: opts.runMs,
        signal: opts.signal,
        onStage: opts.onStage,
      });
    }
    if (backend === 'browsercpp') {
      return browserCpp().run(source, cases, {
        runMs: opts.runMs,
        signal: opts.signal,
        onStage: opts.onStage,
      });
    }
    if (backend === 'browserrust') {
      return browserRust().run(source, cases, {
        runMs: opts.runMs,
        signal: opts.signal,
        onStage: opts.onStage,
        /* A `sanitize` problem is built with the checks on, the same as
           the native judge builds it. */
        profile: opts.profile,
      });
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

    /* The reason first, before any talk of runners. On a problem the audit
       marked native-only, "start a local runner" is not merely unhelpful,
       it contradicts the note above the editor and hides why the exercise
       needs the native toolchain at all. */
    const nativeWhy = opts.problemId
      ? (lang === 'cpp' && browserCpp()
          ? await browserCpp().reasonFor(opts.problemId) : null)
        || (lang === 'python' && browserPy()
          ? await browserPy().reasonFor(opts.problemId) : null)
        || (lang === 'rust' && browserRust()
          ? await browserRust().reasonFor(opts.problemId) : null)
      : null;
    if (nativeWhy) {
      return {
        lang,
        backend: null,
        compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
        cases: [],
        judgeDown: true,
        nativeOnly: nativeWhy,
        /* The KIND, not just the words. "could not run" was being used
           for three different situations — a browser compiler that
           cannot build this program, a local runner that is not
           running, and a hosted service that is down — and the advice
           attached to it was written for the second. A reader on the
           published site got told to install WSL for a limitation of
           the compiler they were already using. */
        kind: 'toolchain',
        /* One sentence. The detail belongs behind a disclosure, which
           is the renderer's job rather than this string's. */
        judgeError: 'The in-browser Rust compiler cannot build this exercise.',
        detail: nativeWhy,
      };
    }

    const judge = await checkJudge();
    let why;
    let kind = 'nothing';
    let detail = null;
    if (hostedAvailable()) {
      const h = await Hosted.check();
      kind = 'service';
      why = 'The hosted runner is not answering.';
      detail = h.error || null;
    } else if (judge.state === 'unauthed') {
      kind = 'service';
      why = 'A runner is listening on this machine but refused this page.';
      detail = `It is at ${judge.url}. Reload, or paste its token under Settings.`;
    } else if (judge.state === 'down') {
      kind = 'nothing';
      why = `Nothing on this device can run ${LANG_NAME[lang] || lang} for this exercise.`;
      detail = `No runner answered at ${judge.url}. A local toolchain is optional and `
        + 'is explained under Running code; it is not needed for the rest of the site.';
    } else {
      kind = 'nothing';
      why = `Nothing available can run ${LANG_NAME[lang] || lang}.`;
    }

    return {
      lang,
      backend: null,
      compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
      cases: [],
      judgeDown: true,
      kind,
      detail,
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
