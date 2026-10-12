/* ============================================================
   runners/browserhdl.js — SystemVerilog simulation in this tab.

   Icarus Verilog 14.0 compiled to WebAssembly: the real
   preprocessor, the real elaborator and the real event-driven
   runtime, about 2.7 MB in total, fetched the first time a
   simulation is asked for and then in the browser's cache.

   Nothing is installed, nothing is paid for, no FPGA is
   involved, and nothing here needs SharedArrayBuffer or
   cross-origin isolation — which is what lets it be deployed to
   a static host that cannot set a response header.

   **It is a simulator.** A design that passes every check here
   has been shown to behave correctly under the testbench that
   was run against it. It has NOT been shown to be
   synthesisable, to meet timing, to fit a device, or to work on
   hardware. Those are different questions asked by different
   tools, and nothing on this site asks them.

   The shape of a run:

     one worker per run, terminated afterwards
         `vvp.callMain()` is synchronous wasm. A testbench with
         no `$finish` never returns, and the only thing that
         stops it is killing the worker — so that is what Stop,
         the build timeout and the simulation timeout all do.
         Throwing the worker away also makes "a good run works
         after a bad one" true by construction.

     two testbenches, and they are not interchangeable
         The problem supplies a *sample* testbench, which is
         what Run uses and what the waveform comes from. The
         solution supplies a *grading* testbench, which is what
         Submit uses, and whose waveform is never shown — the
         extra cases are the point of it being separate.
   ============================================================ */

const BrowserHdl = (() => {

  /* Where this file was loaded from, captured while the script is still
     executing: the site loads its modules as plain <script> tags, so
     import.meta does not exist here. */
  const HERE = (() => {
    const own = document.currentScript && document.currentScript.src;
    return own ? new URL('.', own).href : new URL('js/runners/', location.href).href;
  })();
  const workerUrl = name => new URL(`../${name}`, HERE).href;

  /* Bounds. Each is here because without it something a reader could
     plausibly write takes the tab with it, and each is enforced by
     terminating the worker, because synchronous wasm cannot be
     interrupted any other way. */
  const BUILD_MS = 30_000;   /* the first one includes the download */
  const SIM_MS = 10_000;
  const MAX_SOURCE = 128 * 1024;

  let support = null;
  let supportPromise = null;
  let version = '';

  function loadSupport() {
    if (!supportPromise) {
      supportPromise = fetch(new URL('../../data/hdl-support.json', HERE).href,
        { cache: 'no-cache' })
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null)
        .then(got => {
          support = got;
          /* The version is the pinned simulator's, and it is what makes
             the cached assets versioned: it goes on the query string of
             every module and .wasm, so a re-pin is a different URL
             rather than a stale file. */
          version = (got && got.toolchain && got.toolchain.pin) || '';
          return got;
        });
    }
    return supportPromise;
  }

  const capable = () => typeof Worker !== 'undefined'
    && typeof WebAssembly !== 'undefined';

  async function supportsProblem(problemId) {
    if (!capable()) return false;
    const s = await loadSupport();
    if (!s) return false;
    return (s.browser || []).includes(problemId);
  }

  async function reasonFor(problemId) {
    const s = await loadSupport();
    return (s && s.nativeOnly && s.nativeOnly[problemId]) || null;
  }

  const toolchain = () => (support && support.toolchain) || null;

  /* ---------------- progress ---------------- */

  const listeners = new Set();
  let progress = { stage: 'idle', loaded: 0, total: 0, percent: 0 };

  function onProgress(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function say(p) {
    progress = { ...progress, ...p };
    for (const fn of listeners) {
      try { fn(progress); } catch { /* a listener's problem, not ours */ }
    }
  }

  /* Whether the simulator has been fetched at least once. There is no
     explicit cache to consult — these are ordinary module and .wasm
     fetches, so the browser's HTTP cache is the cache — so this is a
     session flag used only to decide whether to show a progress bar. */
  let fetched = false;
  const ready = () => fetched;

  /* Pull it down now, so an assessment's clock does not start with a
     2.7 MB fetch in front of the first Run. */
  async function prepare() {
    if (fetched) return true;
    await loadSupport();
    say({ stage: 'download', percent: 0 });
    const w = new Worker(workerUrl('hdl/sim.worker.js'), { type: 'module' });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the simulator did not load in time')), BUILD_MS);
        w.onmessage = e => {
          const m = e.data || {};
          if (m.type === 'progress') {
            say({ stage: 'download', loaded: m.loaded, total: m.total,
              percent: m.total ? Math.round((m.loaded / m.total) * 100) : 0 });
            return;
          }
          if (m.type === 'ready') { clearTimeout(timer); resolve(); }
          if (m.type === 'failed') { clearTimeout(timer); reject(new Error(m.error)); }
        };
        w.onerror = err => { clearTimeout(timer); reject(new Error(err.message || 'worker error')); };
        w.postMessage({ type: 'init', version });
      });
      fetched = true;
      say({ stage: 'ready', percent: 100 });
      return true;
    } finally {
      w.terminate();
    }
  }

  /* ---------------- one run ----------------

     `kind` is 'sample' or 'grade', and the only thing it changes here
     is which limits apply and whether a waveform is asked for. The
     caller decides which testbench to pass; this does not know the
     difference and must not, because a runner that could tell would be
     a place for the grading cases to leak out of. */

  let live = null;   /* the worker in flight, so Stop has something to kill */

  function stop() {
    if (!live) return false;
    const w = live;
    live = null;
    w.terminate();
    say({ stage: 'idle' });
    return true;
  }

  const busy = () => !!live;

  async function run(sources, {
    generation = '2012',
    wantWaveform = true,
    buildMs = BUILD_MS,
    simMs = SIM_MS,
    signal,
  } = {}) {
    if (!capable()) {
      return { ok: false, blocked: 'this browser has no Worker or WebAssembly' };
    }
    for (const [name, src] of Object.entries(sources)) {
      if (String(src || '').length > MAX_SOURCE) {
        return { ok: false, blocked: `${name} is longer than ${MAX_SOURCE} characters` };
      }
    }
    await loadSupport();

    /* Anything already running is this reader's previous Run. Replacing
       it rather than queueing: two simulations at once is a state with
       no sensible result, and the newer click is the one they meant. */
    stop();

    const first = !fetched;
    say({ stage: first ? 'download' : 'build', percent: first ? 0 : null });

    const w = new Worker(workerUrl('hdl/sim.worker.js'), { type: 'module' });
    live = w;

    const started = Date.now();
    let phase = 'build';

    const result = await new Promise(resolve => {
      let settled = false;
      const done = r => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (live === w) live = null;
        w.terminate();
        resolve(r);
      };

      /* The timeout is the enforcement. It is per phase, because a
         thirty-second allowance for an endless clock would be thirty
         seconds of a spinning worker before the reader is told what
         happened. */
      let timer = setTimeout(function expire() {
        done({
          ok: false,
          timedOut: phase,
          ms: Date.now() - started,
          blocked: phase === 'build'
            ? `the compiler did not finish within ${Math.round(buildMs / 1000)}s`
            : `the simulation was still running after ${Math.round(simMs / 1000)}s`
              + ' and was stopped. A clock with no $finish, or a combinational'
              + ' loop that never advances time, will do that.',
        });
      }, buildMs);

      const onAbort = () => done({ ok: false, cancelled: true, ms: Date.now() - started });
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      w.onmessage = e => {
        const m = e.data || {};
        if (m.type === 'progress') {
          say({ stage: 'download', loaded: m.loaded, total: m.total,
            percent: m.total ? Math.round((m.loaded / m.total) * 100) : 0 });
          return;
        }
        if (m.type === 'built') {
          fetched = true;
          if (!m.ok) {
            done({
              ok: false,
              built: false,
              diagnostics: m.diagnostics || [],
              stderr: m.stderr || '',
              ms: Date.now() - started,
            });
            return;
          }
          /* Compiled. The clock restarts for the simulation, with its
             own, much shorter, allowance. */
          phase = 'simulate';
          say({ stage: 'simulate', percent: null });
          clearTimeout(timer);
          timer = setTimeout(() => done({
            ok: false,
            built: true,
            timedOut: 'simulate',
            diagnostics: m.diagnostics || [],
            ms: Date.now() - started,
            blocked: `the simulation was still running after ${Math.round(simMs / 1000)}s`
              + ' and was stopped. A clock with no $finish, or a combinational'
              + ' loop that never advances simulated time, will do that.',
          }), simMs);
          return;
        }
        if (m.type === 'ran') {
          done({
            ok: true,
            built: true,
            diagnostics: m.diagnostics || [],
            output: m.output || '',
            clipped: !!m.clipped,
            vcd: wantWaveform ? (m.vcd || null) : null,
            vcdClipped: !!m.vcdClipped,
            finished: !!m.finished,
            finishedAt: m.finishedAt,
            crashed: m.crashed || null,
            ms: Date.now() - started,
          });
          return;
        }
        if (m.type === 'failed') {
          done({ ok: false, blocked: m.error, ms: Date.now() - started });
        }
      };
      w.onerror = err => done({
        ok: false,
        blocked: `the simulator worker failed: ${err.message || 'unknown'}`,
        ms: Date.now() - started,
      });

      w.postMessage({
        type: 'run',
        id: 1,
        version,
        sources,
        generation,
        limits: {},
      });
    });

    say({ stage: 'idle' });
    return result;
  }

  /* Compile only, for the editor's as-you-type check. Same toolchain,
     same diagnostics, no simulation — so a design can be checked while
     it is being written without running anything. */
  async function check(sources, { generation = '2012', signal } = {}) {
    if (!capable()) return null;
    await loadSupport();
    const w = new Worker(workerUrl('hdl/sim.worker.js'), { type: 'module' });
    try {
      return await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), BUILD_MS);
        const stopIt = () => { clearTimeout(timer); resolve(null); };
        if (signal) signal.addEventListener('abort', stopIt, { once: true });
        w.onmessage = e => {
          const m = e.data || {};
          if (m.type === 'built') {
            clearTimeout(timer);
            fetched = true;
            resolve({ ok: m.ok, diagnostics: m.diagnostics || [], stderr: m.stderr || '' });
          }
          if (m.type === 'failed') stopIt();
        };
        w.onerror = stopIt;
        w.postMessage({ type: 'build', id: 1, version, sources, generation });
      });
    } finally {
      w.terminate();
    }
  }

  return {
    capable, supportsProblem, reasonFor, loadSupport, toolchain,
    prepare, onProgress, run, check, stop, busy,
    get ready() { return ready(); },
    get progress() { return progress; },
    get version() { return version; },
    BUILD_MS, SIM_MS, MAX_SOURCE,
    TOTAL_MB: 3,
  };
})();
