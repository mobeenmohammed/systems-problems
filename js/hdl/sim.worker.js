/* The Verilog simulation worker.

   Everything about this runs in a worker and the reason is one
   sentence: `vvp.callMain()` is a synchronous call into WebAssembly, so
   a testbench with no `$finish` — or a combinational loop that never
   advances simulated time — does not return. On the main thread that is
   a frozen tab with no way out. Here it is a worker the page terminates.

   Which also settles cancellation and the time limits: there is no way
   to interrupt synchronous wasm from inside, so Stop, the build timeout
   and the simulation timeout are all the same action — terminate this
   worker. The runner owns that; this side just does the work and
   reports.

   One worker per run, created and thrown away. The simulator is three
   WebAssembly modules totalling about 2.7 MB, and instantiating them
   takes single-digit milliseconds, so there is nothing to gain by
   keeping a worker that has just executed somebody's endless clock.
   It also makes "a valid simulation works after stopping a bad one"
   true by construction rather than by cleanup.

   Messages in:   { type: 'run', id, sources, generation, want, limits }
                  { type: 'build', id, sources, generation }
   Messages out:  { type: 'progress', stage, loaded, total }
                  { type: 'built', id, ok, diagnostics, stderr }
                  { type: 'ran', id, ... }
                  { type: 'failed', id, error }
*/

import { Simulator, GENERATION, LIMITS } from './toolchain.js';

const BASE = new URL('../../vendor/verilog/', import.meta.url).href;

let sim = null;
let version = '';

async function ensure() {
  if (!sim) sim = new Simulator({ baseUrl: BASE, version });
  await sim.init(p => self.postMessage({ type: 'progress', ...p }));
  return sim;
}

/* The names the reader sees, mapped onto the names the toolchain is
   given, so a diagnostic says "design.sv:12" and means the tab called
   design.sv. */
const FILES = { 'design.sv': 'design.sv', 'testbench.sv': 'testbench.sv' };

self.onmessage = async e => {
  const msg = e.data || {};
  if (msg.version) version = msg.version;

  try {
    if (msg.type === 'build' || msg.type === 'run') {
      const s = await ensure();
      const built = await s.build(msg.sources, {
        generation: msg.generation || GENERATION,
        files: FILES,
      });

      /* Always announced, even on the way to a simulation. The main
         thread uses it to switch phase: the build allowance is thirty
         seconds because the first one includes a download, and the
         simulation allowance is ten, because a design that is still
         running after ten seconds is not going to stop. Without this
         message the page never learned the compile had finished, so a
         zero-time loop ran under the build timeout — three times as
         long before being killed — and the status chip was left
         saying "Simulator 100%" while it simulated. */
      self.postMessage({
        type: 'built',
        id: msg.id,
        ok: built.ok,
        diagnostics: built.diagnostics,
        stderr: built.stderr,
      });
      if (!built.ok || msg.type === 'build') return;

      const limits = { ...LIMITS, ...(msg.limits || {}) };
      const ran = await s.simulate(built.vvp, {
        maxOutput: limits.output,
        maxVcd: limits.vcd,
      });

      self.postMessage({
        type: 'ran',
        id: msg.id,
        ok: true,
        diagnostics: built.diagnostics,
        output: ran.output,
        clipped: ran.clipped,
        vcd: ran.vcd,
        vcdClipped: ran.vcdClipped,
        ms: ran.ms,
        finished: ran.finished,
        finishedAt: ran.finishedAt,
        crashed: ran.crashed,
      });
      return;
    }

    if (msg.type === 'init') {
      await ensure();
      self.postMessage({ type: 'ready' });
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
