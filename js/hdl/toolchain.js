/* ============================================================
   hdl/toolchain.js — Icarus Verilog, in the page.

   Three programs, not one, and that is the shape of Icarus
   itself rather than anything this port invented:

     ivlpp   the preprocessor. Macros, includes, and `line
             directives so the compiler's errors point at the
             right file.
     ivl     the compiler. Elaborates the design and emits a
             .vvp program.
     vvp     the runtime. Executes the .vvp, runs the $display
             calls, and writes the VCD.

   Each is a separate WebAssembly module with its own Emscripten
   filesystem, and the files pass between them in memory. In a
   normal install these are three processes and the files are on
   disk; here the orchestration is the few lines below.

   Pinned by scripts/vendor-hdl.mjs. **Icarus Verilog is
   GPL-2.0-or-later**, so the vendored binaries are a
   redistribution of a GPL work: vendor/verilog/COPYING carries
   the licence and vendor/verilog/README.md identifies the
   upstream source exactly. Nothing here modifies them.

   What this is NOT: a synthesiser. A design that simulates
   correctly here has not been shown to be synthesisable, to
   meet timing, or to work on a device. Nothing in this file or
   anything built on it says otherwise, and the exercises say so
   out loud.
   ============================================================ */

/* The language generation passed to ivl. 2012 is SystemVerilog-2012,
   which is what makes `logic`, `always_comb` and `always_ff` legal.

   It is a *generation flag*, and that is worth being precise about:
   setting it does not mean Icarus implements SystemVerilog-2012. It
   means the parser accepts that grammar and the simulator implements
   the subset it implements. data/hdl-support.json records what was
   actually measured, feature by feature, rather than what the flag is
   called. */
export const GENERATION = '2012';

export const TOOLCHAIN = {
  simulator: 'Icarus Verilog 14.0',
  where: 'WebAssembly, in this tab',
  generation: `SystemVerilog-2012 (ivl -g${GENERATION})`,
  licence: 'GPL-2.0-or-later',
  upstream: 'https://github.com/steveicarus/iverilog',
  port: 'https://github.com/senolgulgonul/verisim',
};

/* Bounds. Every one of these exists because without it a design a
   reader could plausibly write takes the tab with it.

   The two time limits are enforced by whoever owns the worker, not
   here: `callMain` is synchronous inside the module, so nothing on
   this side can interrupt it. Terminating the worker is the only
   thing that stops a zero-time loop, and that is what the runner
   does. These are the numbers it uses. */
export const LIMITS = {
  buildMs: 20_000,
  simMs: 10_000,
  /* Characters of $display output kept. A `$monitor` on a 64-bit bus
     with a 1ps timescale will produce megabytes in a few simulated
     microseconds. */
  output: 64 * 1024,
  /* Characters of VCD kept. Four megabytes is about 90 seconds of
     reading at any zoom level anybody would use, and parsing more
     than that costs more than it shows. */
  vcd: 4 * 1024 * 1024,
};

/* ivl's config file, which is how it is told everything a command line
   would otherwise carry. `basedir:/` and the DLL flag are what make
   the statically-linked vvp target and VPI work inside one module. */
const ivlConf = generation => `basedir:/
module:system.vpi
generation:${generation}
generation:no-specify
out:/out.vvp
iwidth:32
widthcap:65536
functor:cprop
functor:nodangle
flag:DLL=vvp.tgt
`;

/* Noise, not diagnostics. The port links the VPI statically, so ivl
   still looks for system.vpi, fails to find it, and says so — on
   every single compile. Shown to a reader it would read as an error
   in their design. */
const NOISE = /system\.vpi|dynamic linking not enabled/;

/* Icarus writes `file:line: level: message`, with the level sometimes
   absent (a bare `file:line: something` is an error). Parsed into rows
   so the editor can put a marker on the line, which is the whole
   reason to parse it rather than print it.

   The file name is the one this module gave the preprocessor, so it is
   mapped back to what the reader calls the tab. */
export function parseDiagnostics(text, { files = {} } = {}) {
  const rows = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line || NOISE.test(line)) continue;

    const m = /^([^\s:]+):(\d+):(?:(\d+):)?\s*(error|warning|sorry|internal error)?\s*:?\s*(.*)$/
      .exec(line);
    if (!m) {
      /* Something Icarus said without a position — `sorry: ...` for an
         unimplemented construct arrives like this. Kept, because
         dropping it would lose the only explanation there is. */
      const bare = /^(error|warning|sorry|internal error)\s*:\s*(.*)$/.exec(line);
      if (bare) rows.push({ file: null, line: null, level: bare[1], message: bare[2], rendered: line });
      else if (rows.length) rows[rows.length - 1].message += `\n${line}`;
      continue;
    }
    const file = files[m[1].replace(/^\//, '')] || m[1].replace(/^\//, '');
    rows.push({
      file,
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : null,
      level: m[4] || 'error',
      message: m[5],
      rendered: `${file}:${m[2]}: ${m[4] || 'error'}: ${m[5]}`,
    });
  }
  return rows;
}

/* The grading rules live in js/hdl/grade.js, which is written as a
   plain global so that the page, this module and the Node scripts can
   all have the same copy. Side-effect import: it assigns
   `globalThis.HdlGrade`. One set of rules, three callers — a second
   copy is how a grader and an audit come to disagree about what a pass
   is. */
import './grade.js';

export const { parseChecks, gradeChecks, toolchainLimit } = globalThis.HdlGrade;

/* ---------------- the pipeline ----------------

   Each stage gets a fresh module instance. Emscripten's filesystem is
   per-instance, and reusing one would carry a previous run's files —
   including the VCD, which would be read back as this run's output
   after a simulation that produced none. */
export class Simulator {
  constructor({ baseUrl, version = '', load } = {}) {
    this.baseUrl = baseUrl;
    this.version = version;
    /* Injected so the audit script can import the modules through
       Node's loader while the page imports them by URL. */
    this.load = load || (name => import(new URL(`${name}?v=${this.version}`, this.baseUrl).href));
    this.factories = null;
  }

  async init(onProgress = null) {
    if (this.factories) return this.factories;
    const names = ['ivlpp.js', 'ivl.js', 'vvp.js'];
    const mods = {};
    for (let i = 0; i < names.length; i += 1) {
      if (onProgress) onProgress({ stage: 'load', loaded: i, total: names.length });
      const m = await this.load(names[i]);
      mods[names[i].replace('.js', '')] = m.default || m;
    }
    if (onProgress) onProgress({ stage: 'load', loaded: names.length, total: names.length });
    this.factories = mods;
    return mods;
  }

  /* Emscripten resolves its own .wasm against the loader's URL, which
     drops the version query — so it is put back here. Without it a
     re-pinned simulator would be a new .js beside a cached .wasm,
     which is the worst of the three possible states. */
  opts(extra) {
    const base = this.baseUrl;
    const v = this.version;
    return {
      locateFile: p => (base ? new URL(`${p}${v ? `?v=${v}` : ''}`, base).href : p),
      ...extra,
    };
  }

  /* ivlpp over every source at once, so a macro defined in one file is
     visible in the next — which is what a single translation unit
     means, and what separate passes would silently break. */
  async preprocess(sources) {
    const { ivlpp } = await this.init();
    const out = [];
    const err = [];
    const m = await ivlpp(this.opts({ print: s => out.push(s), printErr: s => err.push(s) }));
    const args = ['-L'];
    for (const [name, src] of Object.entries(sources)) {
      m.FS.writeFile(`/${name}`, src.endsWith('\n') ? src : `${src}\n`);
      args.push(`/${name}`);
    }
    m.callMain(args);
    return { text: `${out.join('\n')}\n`, stderr: err.join('\n') };
  }

  async compile(text, { generation = GENERATION } = {}) {
    const { ivl } = await this.init();
    const err = [];
    const m = await ivl(this.opts({ print: () => {}, printErr: s => err.push(s) }));
    m.FS.writeFile('/ivl.conf', ivlConf(generation));
    m.FS.writeFile('/src.v', text);
    let crashed = null;
    try {
      m.callMain(['-C/ivl.conf', '--', '/src.v']);
    } catch (e) {
      crashed = String((e && e.message) || e);
    }
    let vvp = null;
    try { vvp = m.FS.readFile('/out.vvp'); } catch { /* no output: it failed */ }
    const stderr = err.join('\n');
    return {
      ok: !!(vvp && vvp.length),
      vvp,
      stderr,
      crashed,
      diagnostics: parseDiagnostics(stderr),
    };
  }

  /* The whole front end: preprocess, then compile. Returned together
     because a reader does not care which of the two stages rejected
     their module, only which line it was. */
  async build(sources, { generation = GENERATION, files = {} } = {}) {
    const pp = await this.preprocess(sources);
    const c = await this.compile(pp.text, { generation });
    const diagnostics = parseDiagnostics(`${pp.stderr}\n${c.stderr}`, { files });
    return {
      ok: c.ok,
      vvp: c.vvp,
      diagnostics,
      crashed: c.crashed,
      stderr: diagnostics.map(d => d.rendered).join('\n')
        || (c.ok ? '' : (c.crashed || 'the compiler produced no program')),
    };
  }

  /* Run it. Output and VCD are both capped as they are taken, and the
     caller is told when a cap was hit rather than being handed a
     truncated file that looks complete. */
  async simulate(vvp, { maxOutput = LIMITS.output, maxVcd = LIMITS.vcd } = {}) {
    const { vvp: factory } = await this.init();
    let output = '';
    let clipped = false;
    const take = s => {
      if (clipped) return;
      if (output.length + s.length + 1 > maxOutput) {
        output += `${s.slice(0, Math.max(0, maxOutput - output.length))}\n`;
        clipped = true;
        return;
      }
      output += `${s}\n`;
    };

    const m = await factory(this.opts({ print: take, printErr: take }));
    m.FS.writeFile('/sim.vvp', vvp);

    let crashed = null;
    const started = Date.now();
    try {
      m.callMain(['/sim.vvp']);
    } catch (e) {
      crashed = String((e && e.message) || e);
    }
    const ms = Date.now() - started;

    let vcd = null;
    let vcdClipped = false;
    try {
      vcd = m.FS.readFile('/dump.vcd', { encoding: 'utf8' });
      if (vcd && vcd.length > maxVcd) { vcd = vcd.slice(0, maxVcd); vcdClipped = true; }
    } catch { /* no $dumpfile, which is fine for a grading run */ }

    /* Icarus prints this when $finish or $stop is reached. Its absence
       is not an error — a simulation can simply run out of events —
       but the grader uses it together with the DONE line to tell a
       finished run from a hung one. */
    const finish = /\$(finish|stop) called at (\d+)/.exec(output);

    return {
      output: output.replace(/\n+$/, ''),
      clipped,
      vcd,
      vcdClipped,
      ms,
      crashed,
      finished: !crashed,
      finishedAt: finish ? Number(finish[2]) : null,
    };
  }
}
