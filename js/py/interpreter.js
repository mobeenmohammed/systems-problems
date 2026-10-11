/* ============================================================
   py/interpreter.js — CPython in the browser, and what that
   actually means.

   Pyodide 314.0.7: CPython 3.14.2 compiled to WebAssembly
   through Emscripten. 12.8 MB, fetched once and cached, then
   about a second to start and milliseconds per case.

   ---------------- what is different from python3 ----------------

   Measured here, not assumed, and tested in
   tests/browser/python.test.mjs so it stays true:

     · **It is 32-bit.** sys.maxsize is 2**31 - 1, where native
       CPython on a 64-bit machine says 2**63 - 1. Python's own
       ints are arbitrary precision either way, so arithmetic is
       unaffected; what changes is sys.maxsize itself, and
       anything using it as "infinity".

     · **sys.platform is 'emscripten'**, not 'linux'. Code that
       branches on it branches differently.

     · **There is no filesystem worth the name, no processes, no
       sockets.** open() works against an in-memory filesystem
       that starts empty and is thrown away. subprocess,
       multiprocessing and socket import but cannot do anything.

     · **No threads.** Pyodide here is built without pthreads,
       so threading exists but a thread runs when the main one
       lets it.

     · **Only the standard library.** No numpy, no requests.
       Pyodide can install packages; this does not, deliberately
       — a problem that needs numpy is a problem whose answer is
       about numpy, and the download index alone is 119 KB.

     · **Recursion is shallower.** The wasm stack is smaller
       than a native one, so a recursion that native CPython
       survives can hit RecursionError here. The limit is raised
       at start-up to a value measured to be safe, not guessed.

   ---------------- isolation between cases ----------------

   Each case runs in a fresh globals dict, so nothing one case
   defines is visible to the next. That is not the same as a
   fresh process: sys.modules is shared, so a module imported by
   one case is already imported for the next, and anything a case
   does to a module's state persists. A fresh interpreter per
   case would cost a second each, and the honest answer is to say
   so rather than to claim an isolation that is not there.

   An infinite loop cannot be interrupted from inside — wasm
   yields to nothing — so the worker is terminated and the next
   run pays for a reload from cache.
   ============================================================ */

export const RUNTIME = Object.freeze({
  implementation: 'CPython 3.14.2 (Pyodide 314.0.7)',
  target: 'wasm32-emscripten',
  stdlib: 'standard library only, no installable packages',
});

/* One entry, because Pyodide fetches the rest itself relative to the
   first. The byte counts are what a progress bar counts towards; they
   are the sizes of the vendored files, checked by the audit script. */
export const ASSETS = Object.freeze([
  { key: 'runtime', file: 'pyodide/pyodide.asm.wasm', bytes: 9598218, label: 'the interpreter' },
  { key: 'stdlib', file: 'pyodide/python_stdlib.zip', bytes: 2545637, label: 'the standard library' },
  { key: 'glue', file: 'pyodide/pyodide.asm.mjs', bytes: 1250344, label: 'the runtime' },
]);

export const TOTAL_BYTES = ASSETS.reduce((n, a) => n + a.bytes, 0);

/* Versioned in the URL for the same reason as the C++ cache: a static
   host cannot set headers, and a stale interpreter beside a fresh
   standard library would be a very confusing failure. */
export const CACHE_NAME = 'invariant-py-v1';

export const RUN_LIMITS = Object.freeze({
  runMs: 5_000,
  maxOutput: 64 * 1024,
});

async function openCache() {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch { return null; }
}

async function readWithProgress(res, onChunk) {
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    if (onChunk) onChunk(value.length);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}

/* Pyodide fetches its own assets by URL, so rather than pre-loading them
   and handing them over — which its API does not offer — `fetch` is
   wrapped for the duration. Anything under the vendored directory goes
   through the cache and reports progress; everything else is untouched.

   Returns a restore function. The wrapper is removed as soon as the
   interpreter is up, so nothing else in the worker inherits it. */
export function interceptFetch(baseUrl, { onProgress } = {}) {
  const real = self.fetch.bind(self);
  const base = new URL('.', baseUrl).href;

  self.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const abs = new URL(url, baseUrl).href;
    if (!abs.startsWith(base)) return real(input, init);

    const versioned = `${abs}${abs.includes('?') ? '&' : '?'}v=${CACHE_NAME}`;
    const cache = await openCache();

    if (cache) {
      try {
        const hit = await cache.match(versioned);
        if (hit) {
          const bytes = new Uint8Array(await hit.arrayBuffer());
          if (onProgress) onProgress(bytes.length, true);
          return new Response(bytes, { status: 200, headers: hit.headers });
        }
      } catch { /* a broken entry is a miss */ }
    }

    const res = await real(versioned, init);
    if (!res.ok) return res;

    let toCache = null;
    if (cache) { try { toCache = res.clone(); } catch { toCache = null; } }
    const headers = new Headers(res.headers);
    const bytes = await readWithProgress(res, n => { if (onProgress) onProgress(n, false); });
    if (cache && toCache) {
      try { await cache.put(versioned, toCache); } catch { /* quota, or storage off */ }
    }
    return new Response(bytes, { status: 200, headers });
  };

  return () => { self.fetch = real; };
}

/* ---------------- the harness the user's code runs under ----------------

   Written as Python rather than assembled in JavaScript, because the
   parts that have to be right — that a SystemExit from sys.exit() is not
   an error, that a traceback is the user's traceback and not ours — are
   easier to get right and to read here. */
export const HARNESS = `
import sys, io, builtins, traceback

class _Out(io.TextIOBase):
    """Collects output, and stops collecting past a limit.

    Truncating is better than a tab that runs out of memory because
    somebody printed inside a loop they meant to bound."""
    def __init__(self, cap):
        self.parts = []
        self.size = 0
        self.cap = cap
        self.truncated = False
    def write(self, s):
        n = len(s)
        if self.size + n > self.cap:
            room = max(0, self.cap - self.size)
            if room:
                self.parts.append(s[:room])
                self.size += room
            self.truncated = True
            return n
        self.parts.append(s)
        self.size += n
        return n
    def getvalue(self):
        return ''.join(self.parts)

def _run(source, stdin_text, cap):
    out, err = _Out(cap), _Out(cap)
    stdin = io.StringIO(stdin_text)

    old = (sys.stdout, sys.stderr, sys.stdin)
    sys.stdout, sys.stderr, sys.stdin = out, err, stdin

    # input() reads sys.stdin, but only if it is not wired to the
    # browser's own prompt, which Pyodide does by default.
    def _input(prompt=''):
        if prompt:
            out.write(str(prompt))
        line = stdin.readline()
        if not line:
            raise EOFError('EOF when reading a line')
        return line.rstrip('\\n')
    old_input = builtins.input
    builtins.input = _input

    # A fresh namespace per case. sys.modules is not reset — see the
    # note at the top of js/py/interpreter.js.
    g = {'__name__': '__main__', '__builtins__': builtins}

    status, exc = 0, ''
    try:
        exec(compile(source, 'main.py', 'exec'), g)
    except SystemExit as e:
        # sys.exit() is how a program ends on purpose.
        status = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException:
        status = 1
        # Drop this harness's own frames: the first traceback entry is
        # always the exec above, and showing it would point the reader
        # at code they did not write.
        lines = traceback.format_exception(*sys.exc_info())
        if len(lines) > 2:
            lines = [lines[0]] + lines[2:]
        exc = ''.join(lines)
    finally:
        sys.stdout, sys.stderr, sys.stdin = old
        builtins.input = old_input

    return {
        'stdout': out.getvalue(),
        'stderr': err.getvalue() + exc,
        'status': status,
        'truncated': out.truncated or err.truncated,
    }
`;

/* Raised from the default 1000 to something the wasm stack can take.
   Measured rather than guessed: see tests/browser/python.test.mjs,
   which checks that this depth really does survive. */
export const RECURSION_LIMIT = 2000;
