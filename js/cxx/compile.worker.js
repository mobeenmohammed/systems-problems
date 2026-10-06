/* The compile worker.

   Owns the expensive things — 63 MB of compiled WebAssembly and a 1,516-file
   sysroot — and keeps them for the life of the page, so the first compile
   costs a few seconds and every one after it costs about a second.

   It lives in a worker for one reason: Clang is a synchronous C++ program
   compiled to wasm, and running it on the main thread would freeze the page
   solid for the whole compile. Here the page stays scrollable and the Cancel
   button stays clickable.

   It does NOT run anybody's program. That happens in run.worker.js, one
   throwaway worker per case, because the only way to stop an infinite loop
   in WebAssembly is to terminate the thread it is on — and terminating this
   one would throw away the compiler with it.

   Messages in:   { type: 'init' }
                  { type: 'compile', id, source, flags? }
   Messages out:  { type: 'progress', loaded, total, percent, fromCache?, stage? }
                  { type: 'ready', toolchain }
                  { type: 'compiled', id, ok, stderr, bytes }
                  { type: 'failed', id?, error }
*/

import { Toolchain, BROWSER_FLAGS, TOOLCHAIN } from './toolchain.js';
import Clang from '../../vendor/cxx/browsercc/clang.js';
import LLD from '../../vendor/cxx/browsercc/lld.js';

const BASE = new URL('../../vendor/cxx/', import.meta.url).href;

let toolchain = null;

async function ensure() {
  if (toolchain && toolchain.ready) return toolchain;
  if (!toolchain) toolchain = new Toolchain({ baseUrl: BASE, Clang, LLD });
  await toolchain.init({
    onProgress: p => self.postMessage({ type: 'progress', ...p }),
  });
  return toolchain;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init') {
      await ensure();
      self.postMessage({ type: 'ready', toolchain: TOOLCHAIN });
      return;
    }

    if (msg.type === 'compile') {
      const tc = await ensure();
      const result = await tc.compile(msg.source, msg.flags || BROWSER_FLAGS);
      /* The linked program, as bytes. Each run worker compiles them itself —
         a few milliseconds for something this small — which keeps the run
         workers independent of whatever this one is holding. */
      const bytes = result.bytes ? result.bytes.slice() : null;
      self.postMessage(
        { type: 'compiled', id: msg.id, ok: result.ok, stderr: result.stderr, bytes },
        bytes ? [bytes.buffer] : [],
      );
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
