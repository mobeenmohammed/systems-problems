/* The run worker: one compiled program, one case, then thrown away.

   A fresh worker per case, which costs about a millisecond and buys three
   things:

     · an infinite loop can be stopped. A wasm `while (true) {}` yields to
       nothing and ignores everything; terminate() is the only thing that
       ends it, and terminating a worker that also held the compiler would
       mean re-downloading it.
     · nothing a case leaves behind can reach the next one. A case passing
       because of what the previous one did is the worst kind of wrong
       answer.
     · the page stays responsive while somebody's program runs.

   Messages in:   { type: 'run', bytes, stdin, limits }
   Messages out:  { type: 'done', result } | { type: 'failed', error }
*/

import { runCase } from './toolchain.js';
import * as wasi from '../../vendor/cxx/wasi/index.js';

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'run') return;
  try {
    const module = await WebAssembly.compile(msg.bytes);
    const result = await runCase(module, msg.stdin, { ...wasi, limits: msg.limits });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'failed', error: String((err && err.message) || err) });
  }
};
