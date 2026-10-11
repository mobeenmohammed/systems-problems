/* The Python worker: one interpreter, many cases, terminated rather
   than interrupted.

   Unlike the C++ side there is no compile step to protect, but there is
   a one-second start-up, so the interpreter is long-lived and the cases
   share it. What they do not share is a namespace: each case runs in a
   fresh globals dict. sys.modules is shared, which is a real difference
   from a fresh process and is written down in js/py/interpreter.js
   rather than glossed over.

   An infinite loop still cannot be interrupted from inside — wasm yields
   to nothing — so the façade terminates this worker and the next run
   starts a new one from cache.

   Messages in:   { type: 'boot', base }
                  { type: 'run', source, stdin, limits }
   Messages out:  { type: 'progress', loaded, total, cached }
                  { type: 'ready', version }
                  { type: 'done', result } | { type: 'failed', error }
*/

import {
  HARNESS, RECURSION_LIMIT, RUN_LIMITS, TOTAL_BYTES, interceptFetch,
} from './interpreter.js';

let py = null;
let runner = null;

async function boot(base) {
  const restore = interceptFetch(base, {
    onProgress: (bytes, cached) =>
      self.postMessage({ type: 'progress', loaded: bytes, total: TOTAL_BYTES, cached }),
  });

  try {
    const { loadPyodide } = await import(new URL('pyodide/pyodide.mjs', base).href);
    py = await loadPyodide({
      indexURL: new URL('pyodide/', base).href,
      /* Nothing here installs a package, and saying so keeps Pyodide
         from reaching for its 119 KB index of them. */
      packages: [],
      lockFileURL: new URL('pyodide/pyodide-lock.json', base).href,
      /* Pyodide's own chatter is not this page's to print. */
      stdout: () => {},
      stderr: () => {},
    });
  } finally {
    restore();
  }

  py.setRecursionLimit?.(RECURSION_LIMIT);
  py.runPython(`import sys\nsys.setrecursionlimit(${RECURSION_LIMIT})`);
  py.runPython(HARNESS);
  runner = py.globals.get('_run');

  self.postMessage({ type: 'ready', version: py.version });
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'boot') {
      await boot(msg.base);
      return;
    }
    if (msg.type !== 'run') return;
    if (!runner) throw new Error('the interpreter is not up');

    const limits = { ...RUN_LIMITS, ...(msg.limits || {}) };
    const started = Date.now();
    const got = runner(String(msg.source || ''), String(msg.stdin || ''), limits.maxOutput);
    /* A Python dict comes back as a PyProxy; it has to be converted and
       destroyed or it leaks into the next case. */
    const result = got.toJs ? got.toJs({ dict_converter: Object.fromEntries }) : got;
    if (got.destroy) got.destroy();

    self.postMessage({
      type: 'done',
      result: {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        status: Number(result.status) || 0,
        truncated: !!result.truncated,
        ms: Date.now() - started,
      },
    });
  } catch (err) {
    self.postMessage({ type: 'failed', error: String((err && err.message) || err) });
  }
};
