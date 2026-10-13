/* ============================================================
   runners/browserrust.js — Rust on this device, with nothing
   installed and nothing paid for.

   A real rustc built to WebAssembly (AngelOnFira/weblings, MIT)
   with the Cranelift backend, running in a worker in this tab.
   159 MB of toolchain, about 44 MB over the wire behind gzip,
   fetched the first time it is needed and cached afterwards —
   and then about a tenth of a second per compile, which is
   faster than the C++ one by an order of magnitude.

   The shape of a run is the C++ runner's, because the output is
   the same thing — an ordinary wasm32-wasip1 binary:

     compile worker   long-lived, holds rustc and the sysroot
     run worker       one per case, js/cxx/run.worker.js,
                      terminated on timeout or cancellation and
                      never reused

   Two separate capabilities, and they are not the same size:

     check   type-check only (--emit=metadata). Works on EVERY
             Rust problem, in under a third of a second, with
             the real borrow checker, the real trait solver and
             rustc's own diagnostics. This is what the editor
             uses, and it is the first time anything has checked
             Rust here without a local toolchain.

     run     compile, link and execute. Works on the problems
             data/rust-support.json certifies, which is fewer,
             because the Cranelift → wasm lowering is
             incomplete: `parse::<i64>()` does not compile. See
             scripts/audit-rust.mjs, which found that by
             compiling every reference solution rather than by
             anybody deciding.

   Nothing here needs SharedArrayBuffer or cross-origin
   isolation, which is the whole reason it can be deployed to a
   static host that cannot set a response header.
   ============================================================ */

const BrowserRust = (() => {

  /* Where this file was loaded from, captured while the script is still
     executing — the site loads its modules as plain <script> tags, so
     import.meta does not exist here. */
  const HERE = (() => {
    const self = document.currentScript && document.currentScript.src;
    return self ? new URL('.', self).href : new URL('js/runners/', location.href).href;
  })();
  const workerUrl = name => new URL(`../${name}`, HERE).href;

  const COMPILE_MS = 120_000;  /* the first one includes 44 MB of download */
  const CHECK_MS = 30_000;
  const RUN_MS = 5_000;        /* per case, matching the local runner */
  const MAX_SOURCE = 256 * 1024;

  /* Loaded once, lazily. The *promise* is what is cached, not a flag: a
     second caller arriving while the fetch is out must wait for it
     rather than decide the language is uncertified. */
  let supportPromise = null;
  let support = null;

  function loadSupport() {
    if (!supportPromise) {
      supportPromise = fetch(new URL('../../data/rust-support.json', HERE).href,
        { cache: 'no-cache' })
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null)
        .then(got => { support = got; return got; });
    }
    return supportPromise;
  }

  function capable() {
    return typeof Worker !== 'undefined'
      && typeof WebAssembly !== 'undefined'
      && typeof WebAssembly.compile === 'function';
  }

  async function supportsProblem(problemId) {
    if (!capable()) return false;
    const s = await loadSupport();
    if (!s) return false;
    return (s.browser || []).includes(problemId);
  }

  /* Does the FRONT END accept this problem's reference solution?

     A separate question from `supportsProblem`, and the answer is yes
     far more often: the Cranelift gap is in code generation, so every
     Rust problem type-checks even when five of the seven cannot be
     run. data/rust-support.json records both, measured, and this is
     how the editor and the toolbar tell a reader which of the two
     they have. */
  async function checksProblem(problemId) {
    if (!capable()) return false;
    const s = await loadSupport();
    if (!s) return false;
    return (s.checks || []).includes(problemId);
  }

  async function reasonFor(problemId) {
    const s = await loadSupport();
    return (s && s.nativeOnly && s.nativeOnly[problemId]) || null;
  }

  const toolchain = () => (support && support.toolchain) || null;

  /* ---------------- the compile worker ---------------- */

  let compiler = null;
  let ready = false;
  let readying = null;
  let version = null;
  const listeners = new Set();

  function onProgress(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  const announce = p => {
    for (const fn of [...listeners]) { try { fn(p); } catch { /* not our problem */ } }
  };

  let lastProgress = null;
  const progress = () => lastProgress;

  function spawnCompiler() {
    if (compiler) return compiler;
    compiler = new Worker(workerUrl('rust/compile.worker.js'), { type: 'module' });
    compiler.onerror = () => { /* surfaced through the pending promise instead */ };
    return compiler;
  }

  function prepare() {
    if (ready) return Promise.resolve();
    if (readying) return readying;

    readying = new Promise((resolve, reject) => {
      let w;
      try { w = spawnCompiler(); } catch (err) {
        reject(new Error(`could not start the compiler worker: ${err.message}`));
        return;
      }

      const off = () => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      };

      const onMessage = e => {
        const m = e.data || {};
        if (m.type === 'progress') {
          lastProgress = m;
          announce(m);
          return;
        }
        if (m.type === 'ready') {
          off();
          ready = true;
          version = m.version || null;
          if (support && support.toolchain && version) support.toolchain.version = version;
          lastProgress = { loaded: 1, total: 1, percent: 100, stage: 'ready' };
          announce(lastProgress);
          resolve();
          return;
        }
        if (m.type === 'failed') { off(); reject(new Error(m.error)); }
      };
      const onError = ev => {
        off();
        reject(new Error(ev.message
          || 'the Rust compiler worker failed to load — check that vendor/rust is deployed'));
      };

      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      w.postMessage({ type: 'init' });
    });

    readying.catch(() => {
      /* A failed preparation must not poison every later attempt. */
      teardown();
    }).finally(() => { readying = null; });

    return readying;
  }

  function teardown() {
    if (compiler) { try { compiler.terminate(); } catch { /* already gone */ } }
    compiler = null;
    ready = false;
  }

  let nextId = 1;

  /* One rustc invocation. `flags` decides whether that is a full build or
     a type-check; everything else about the call is the same. */
  function invoke(source, { signal, flags = null, limitMs = COMPILE_MS } = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const w = spawnCompiler();
      let settled = false;

      const finish = fn => (...a) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.removeEventListener('message', onMessage);
        if (signal) signal.removeEventListener('abort', onAbort);
        fn(...a);
      };
      const ok = finish(resolve);
      const bad = finish(reject);

      const timer = setTimeout(() => {
        /* rustc has hung. Nothing short of terminating it will help, and
           it has to be rebuilt before the next attempt. */
        teardown();
        bad(new Error('the compiler stopped responding'));
      }, limitMs);

      const onMessage = e => {
        const m = e.data || {};
        if (m.id !== id) return;
        if (m.type === 'compiled') ok(m);
        else if (m.type === 'failed') bad(new Error(m.error));
      };
      const onAbort = () => {
        /* Synchronous wasm cannot be interrupted. Terminating the worker
           is the only thing that stops a compile, and it costs the
           download nothing — the assets are in the HTTP cache. */
        teardown();
        bad(new DOMException('cancelled', 'AbortError'));
      };

      w.addEventListener('message', onMessage);
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      w.postMessage({ type: 'compile', id, source, flags });
    });
  }

  const compileSource = (source, opts = {}) => invoke(source, opts);

  /* ---------------- type-check only ----------------

     --emit=metadata stops after the borrow checker, before code
     generation. That matters more than it sounds: the Cranelift gap
     that stops five of the seven Rust problems from running is in code
     generation, so a type-check works on all of them. */
  const CHECK_FLAGS = ['--edition', '2024', '--emit=metadata', '-Cpanic=abort'];

  async function check(source, { signal } = {}) {
    if (!capable()) return null;
    if (String(source).length > MAX_SOURCE) return null;
    await prepare();
    const r = await invoke(source, { signal, flags: CHECK_FLAGS, limitMs: CHECK_MS });
    return {
      diagnostics: r.diagnostics || [],
      ms: r.ms,
      checkedBy: 'rustc',
      version,
    };
  }

  /* ---------------- one case, in its own worker ----------------

     The same worker the C++ output is run in. The binary is a
     wasm32-wasip1 program either way, and a sandbox that has already
     been built, bounded and tested is not worth writing twice. */
  function runOne(bytes, stdin, { runMs = RUN_MS, signal } = {}) {
    return new Promise(resolve => {
      let worker;
      try {
        worker = new Worker(workerUrl('cxx/run.worker.js'), { type: 'module' });
      } catch (err) {
        resolve(crashResult(`could not start a run worker: ${err.message}`));
        return;
      }

      let settled = false;
      const started = Date.now();
      const done = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        try { worker.terminate(); } catch { /* already gone */ }
        resolve(result);
      };

      const timer = setTimeout(() => done({
        stdout: '', stderr: '', exit: -1, signal: 'SIGKILL',
        timedOut: true, ms: Date.now() - started, sanitizer: false,
      }), runMs);

      const onAbort = () => done({
        stdout: '', stderr: '', exit: -1, signal: 'SIGKILL',
        timedOut: false, cancelled: true, ms: Date.now() - started, sanitizer: false,
      });

      worker.onmessage = e => {
        const m = e.data || {};
        if (m.type === 'done') done({ ...m.result, ms: Date.now() - started });
        else if (m.type === 'failed') done(crashResult(m.error, Date.now() - started));
      };
      worker.onerror = ev =>
        done(crashResult(ev.message || 'the run worker failed', Date.now() - started));

      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const copy = bytes.slice();
      worker.postMessage({ type: 'run', bytes: copy, stdin: stdin || '' }, [copy.buffer]);
    });
  }

  const crashResult = (message, ms = 0) => ({
    stdout: '', stderr: String(message), exit: -1, signal: null,
    timedOut: false, ms, sanitizer: false,
  });

  /* ---------------- the runner interface ---------------- */

  async function run(source, cases, { runMs = RUN_MS, signal, onStage } = {}) {
    /* `running` carries which case, because "Running…" on a
       fourteen-case problem is indistinguishable from stuck. */
    const say = (s, detail) => { if (onStage) onStage(s, detail); };

    if (!capable()) return down('this browser cannot run WebAssembly in a worker');
    if (String(source).length > MAX_SOURCE) {
      return down(`the source is larger than ${Math.round(MAX_SOURCE / 1024)} KB`);
    }

    try {
      if (!ready) say('downloading');
      await prepare();
    } catch (err) {
      if (err && err.name === 'AbortError') return cancelled();
      return down(err.message, 'download');
    }

    say('compiling');
    let built;
    try {
      built = await compileSource(source, { signal });
    } catch (err) {
      if (err && err.name === 'AbortError') return cancelled();
      return down(err.message);
    }

    if (!built.ok || !built.bytes) {
      return {
        lang: 'rust', backend: 'browserrust',
        compile: { ok: false, stdout: '', stderr: built.stderr || '', ms: built.ms || 0, timedOut: false },
        diagnostics: built.diagnostics || [],
        cases: [],
      };
    }

    const all = cases || [];
    say('running', { done: 0, total: all.length });
    const results = [];
    for (const c of all) {
      if (signal && signal.aborted) return cancelled();
      /* eslint-disable-next-line no-await-in-loop -- cases are deliberately
         sequential: a fresh instance each, and an early abort should not
         leave four more workers running. */
      const r = await runOne(built.bytes, c.stdin, { runMs, signal });
      if (r.cancelled) return cancelled();
      results.push(r);
      say('running', { done: results.length, total: all.length });
    }

    return {
      lang: 'rust', backend: 'browserrust',
      compile: { ok: true, stdout: '', stderr: built.stderr || '', ms: built.ms || 0, timedOut: false },
      diagnostics: built.diagnostics || [],
      cases: results,
    };
  }

  /* `kind` travels with the reply so the page can tell a toolchain
     that will never build this from a download that was interrupted.
     The second is transient and the answer is Try again; saying so in
     the words of the first sends a reader off to install things they
     do not need. */
  const down = (why, kind = 'service') => ({
    lang: 'rust', backend: 'browserrust',
    compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
    cases: [], judgeDown: true,
    kind,
    /* The raw reason, for the disclosure the page puts it behind. The
       sentence below is for a reader; this is for whoever they show it
       to. */
    detail: String(why),
    judgeError: `The in-browser Rust compiler could not be used: ${why}.`,
  });

  const cancelled = () => ({
    lang: 'rust', backend: 'browserrust',
    compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
    cases: [], judgeDown: true, cancelled: true,
    judgeError: 'Stopped. Nothing was recorded, and your code is as you left it.',
  });

  return {
    capable, supportsProblem, checksProblem, reasonFor, loadSupport, toolchain,
    prepare, onProgress, progress, teardown, run, check,
    get ready() { return ready; },
    get version() { return version; },
    /* Exposed for the browser tests, which drive a compile without a page. */
    compileSource, runOne, CHECK_FLAGS,
    TOTAL_MB: 44,
  };
})();
