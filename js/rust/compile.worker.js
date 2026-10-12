/* The Rust compile worker.

   Owns the expensive things — 88 MB of compiled rustc and a wasm32-wasip1
   sysroot — and keeps them for the life of the page, so the first compile
   pays the download and every one after it pays only the compile.

   It lives in a worker for the same reason the C++ one does: rustc is a
   synchronous program compiled to wasm, and running it on the main thread
   would freeze the page solid for the whole compile. Here the page stays
   scrollable and Cancel stays clickable — and cancelling means terminating
   this worker, because synchronous wasm cannot be interrupted any other way.

   It does NOT run anybody's program. The output is an ordinary
   wasm32-wasip1 binary and goes to js/cxx/run.worker.js, one throwaway
   worker per case, exactly like the C++ output.

   Messages in:   { type: 'init' }
                  { type: 'compile', id, source, flags? }
   Messages out:  { type: 'progress', loaded, total, percent, stage }
                  { type: 'ready', toolchain, version }
                  { type: 'compiled', id, ok, stderr, diagnostics, bytes, ms }
                  { type: 'failed', id?, error }
*/

import { Toolchain, TOOLCHAIN, BROWSER_FLAGS } from './toolchain.js';

const BASE = new URL('../../vendor/rust/', import.meta.url).href;

let toolchain = null;

async function ensure() {
  if (toolchain && toolchain.ready) return toolchain;
  if (!toolchain) toolchain = new Toolchain({ baseUrl: BASE });
  await toolchain.init({
    onProgress: p => self.postMessage({ type: 'progress', ...p }),
  });
  return toolchain;
}

self.onmessage = async e => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init') {
      const tc = await ensure();
      const version = await tc.version();
      self.postMessage({ type: 'ready', toolchain: TOOLCHAIN, version });
      return;
    }

    if (msg.type === 'compile') {
      const tc = await ensure();
      /* A full build by default; a type-check when the caller asks for
         one. Same rustc, same sysroot, same worker — the only difference
         is --emit, and it is the difference between "does this compile
         for wasm" and "is this correct Rust". */
      const result = await tc.compile(msg.source, msg.flags || BROWSER_FLAGS);
      /* The linked program, as bytes, transferred rather than copied.
         Each run worker compiles them itself — a few milliseconds for
         something this small — which keeps the run workers independent
         of whatever this one is holding. */
      const bytes = result.bytes ? result.bytes.slice() : null;
      self.postMessage({
        type: 'compiled',
        id: msg.id,
        ok: result.ok,
        stderr: result.stderr,
        diagnostics: result.diagnostics,
        ms: result.ms,
        bytes,
      }, bytes ? [bytes.buffer] : []);
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'failed',
      id: msg.id,
      error: String((err && err.message) || err),
    });
  }
};
