/* ============================================================
   rust/toolchain.js — a real rustc, in a worker, in this tab.

   The compiler is the one from AngelOnFira/weblings (MIT): a
   rustc built to WebAssembly from @bjorn3's patched branches,
   using the Cranelift backend and a wasm linker rather than
   LLVM and lld. That choice is why it is 88 MB rather than the
   several hundred an LLVM build costs, and it is why there is a
   Rust compiler here at all.

   Two files, and they are the whole toolchain:

     rustc.wasm               88 MB, 20 MB over the wire
     sysroot-wasip1.bundle    71 MB, 24 MB over the wire

   The bundle is a flat archive of the wasm32-wasip1 sysroot —
   `RIWB1\n`, a u32 index length, a JSON index of
   {path, offset, length}, then the bytes — which is unpacked
   into an in-memory directory tree and handed to rustc as a
   WASI preopen. That format is weblings'; this file parses it.

   Nothing here needs SharedArrayBuffer, threads, or
   cross-origin isolation: rustc.wasm is built with an internal
   memory and is single-threaded. That is the whole reason this
   can be deployed to GitHub Pages, which cannot set a response
   header at all — see the README.

   What this module does NOT do is run the program. The output
   is an ordinary wasm32-wasip1 binary, so it is run by the same
   js/cxx/run.worker.js that runs the C++ output: one throwaway
   worker per case, terminated on timeout, with stdin wired in
   and the output bounded. A compiler and a sandbox are
   different jobs and were already separated here.
   ============================================================ */

import { Fd, File, Directory, PreopenDirectory, WASI } from '../../vendor/cxx/wasi/index.js';

/* The flags every submission is built with. Written down once, here,
   because a flag quietly changed to make a problem compile is a problem
   that is no longer the exercise it says it is. */
export const BROWSER_FLAGS = ['--edition', '2024', '-O', '-Cpanic=abort'];

/* Front end only: parse, types, traits, borrows, and stop. Shared with
   js/runners/browserrust.js, which runs exactly this on every keystroke
   in the editor — so the audit's "checks" column is a statement about
   what the reader actually gets rather than a separate experiment. */
/* What the native judge's `sanitize` profile is for Rust —
   judge/languages.mjs, and it is not a sanitizer, because Rust has
   none and needs none here. Indexing past the end of a slice is a
   bounds-checked panic, in wasm as everywhere else; what the profile
   adds is debug assertions and arithmetic overflow checks. Built the
   same way in the browser so that the two graders are grading the same
   program. */
export const CHECKED_FLAGS = [
  '--edition', '2024', '-C', 'debug-assertions=on', '-C', 'overflow-checks=on',
  '-Cpanic=abort',
];

export const flagsFor = profile =>
  (profile === 'sanitize' ? CHECKED_FLAGS : BROWSER_FLAGS);

export const CHECK_FLAGS = ['--edition', '2024', '--emit=metadata', '-Cpanic=abort'];

export const TOOLCHAIN = {
  compiler: 'rustc (Cranelift), WebAssembly build',
  target: 'wasm32-wasip1',
  edition: '2024',
  flags: '-O -Cpanic=abort --edition 2024',
  backend: 'cranelift',
  source: 'AngelOnFira/weblings',
};

/* The compiler is asked for the version it reports, once, the first time
   it is prepared. Nothing here writes a version number down: a number in
   a comment is wrong the first time the artifact is re-pinned. */
export let VERSION = null;

const ASSETS = {
  rustc: 'rustc.wasm',
  bundle: 'sysroot-wasip1.bundle',
};

/* Bumped when the pinned artifacts change, so a cached copy of the old
   ones is never served against the new index. */
export const CACHE_NAME = 'invariant-rust-v1';

/* ---------------- the sysroot bundle ---------------- */

export function parseBundle(bytes) {
  const magic = new TextDecoder().decode(bytes.subarray(0, 6));
  if (magic !== 'RIWB1\n') throw new Error('the sysroot bundle is not in the expected format');
  const ilen = new DataView(bytes.buffer, bytes.byteOffset + 6, 4).getUint32(0, true);
  const index = JSON.parse(new TextDecoder().decode(bytes.subarray(10, 10 + ilen)));
  const base = 10 + ilen;
  const files = new Map();
  for (const f of index.files) {
    if (f.p === 'manifest.json') continue;
    files.set(f.p, new File(bytes.slice(base + f.o, base + f.o + f.l)));
  }
  return files;
}

/* The flat bundle paths become a real directory tree, because that is
   what rustc walks when it is given --sysroot. */
function sysrootPreopen(files) {
  const root = new Map();
  const dirFor = segs => {
    let m = root;
    for (const seg of segs) {
      if (!m.has(seg)) m.set(seg, new Map());
      m = m.get(seg);
    }
    return m;
  };
  for (const [path, file] of files) {
    const segs = path.split('/');
    const name = segs.pop();
    dirFor(segs).set(name, file);
  }
  const toDir = m => new Directory([...m.entries()]
    .map(([n, v]) => [n, v instanceof Map ? toDir(v) : v]));
  return new PreopenDirectory('/sysroot', [...root.entries()]
    .map(([n, v]) => [n, v instanceof Map ? toDir(v) : v]));
}

/* ---------------- diagnostics ---------------- */

const ANSI = /\x1b\[[0-9;]*m/g;

/* rustc with --error-format=json prints one JSON object per line. The
   structured form is what makes a borrow-checker error point at a line
   in the editor rather than being a wall of text; `rendered` is rustc's
   own output, which is better than anything we would write. */
export function parseDiagnostics(log, { path = '/work/prog.rs', as = 'program' } = {}) {
  const out = [];
  for (const line of log.split('\n')) {
    if (line[0] !== '{') continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.$message_type !== 'diagnostic') continue;
    if (d.level !== 'error' && d.level !== 'warning') continue;
    const spans = d.spans || [];
    const sp = spans.find(s => s.is_primary) || spans[0] || null;
    const text = (d.rendered || d.message).trimEnd().replaceAll(path, as);
    out.push({
      level: d.level,
      message: d.message,
      code: (d.code && d.code.code) || null,
      line: sp ? sp.line_start : null,
      col: sp ? sp.column_start : null,
      endLine: sp ? sp.line_end : null,
      endCol: sp ? sp.column_end : null,
      rendered: text.replace(ANSI, ''),
    });
  }
  return out;
}

/* ---------------- the toolchain ---------------- */

export class Toolchain {
  constructor({ baseUrl }) {
    this.baseUrl = baseUrl;
    this.ready = false;
    this.module = null;
    this.sysroot = null;
  }

  /* Downloads both assets in parallel, reporting bytes as they arrive.
     The totals are the *decompressed* sizes, which is what the Streams
     API counts — the wire figure is about a quarter of that behind gzip,
     and saying the larger number would be a progress bar that claims a
     download four times the size of the real one. So the caller is given
     both the ratio and the fact that it is uncompressed bytes. */
  async init({ onProgress = null, signal = null } = {}) {
    if (this.ready) return this;

    const total = { rustc: 87_871_387, bundle: 71_313_335 };
    const grand = total.rustc + total.bundle;
    let got = 0;
    const tick = n => {
      got += n;
      if (onProgress) {
        onProgress({
          loaded: got,
          total: grand,
          percent: Math.min(100, Math.round((got / grand) * 100)),
          stage: 'download',
        });
      }
    };

    const url = name => new URL(name, this.baseUrl).href;

    const [moduleOrBytes, bundleBytes] = await Promise.all([
      this.#fetchModule(url(ASSETS.rustc), tick, signal),
      this.#fetchBytes(url(ASSETS.bundle), tick, signal),
    ]);

    if (onProgress) onProgress({ loaded: grand, total: grand, percent: 100, stage: 'unpack' });

    this.module = moduleOrBytes;
    this.sysroot = parseBundle(bundleBytes);
    this.ready = true;
    return this;
  }

  /* compileStreaming would be one less copy, but it needs the response to
     arrive as application/wasm and a static host that gets that wrong
     would break the compiler rather than slow it down. The bytes are read
     with progress and compiled from memory. */
  async #fetchModule(href, tick, signal) {
    const bytes = await this.#fetchBytes(href, tick, signal);
    return WebAssembly.compile(bytes);
  }

  async #fetchBytes(href, tick, signal) {
    const res = await fetch(href, { signal, cache: 'force-cache' });
    if (!res.ok) throw new Error(`${href.split('/').pop()}: ${res.status} ${res.statusText}`);
    if (!res.body) return new Uint8Array(await res.arrayBuffer());

    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      tick(value.byteLength);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out;
  }

  /* One rustc invocation: compile and link in one pass, out to a
     wasm32-wasip1 binary. Synchronous once it starts — which is why this
     only ever runs inside a worker, and why cancelling means terminating
     that worker. */
  async compile(source, flags = BROWSER_FLAGS) {
    if (!this.ready) throw new Error('the toolchain is not ready');

    let log = '';
    const dec = new TextDecoder();
    class Capture extends Fd {
      fd_write(data) {
        log += dec.decode(data, { stream: true });
        return { ret: 0, nwritten: data.byteLength };
      }
    }

    const work = new PreopenDirectory('/work', [
      ['prog.rs', new File(new TextEncoder().encode(source))],
    ]);

    const args = [
      'rustc', '/work/prog.rs',
      '--sysroot', '/sysroot',
      '-Zunstable-options',
      '--target', 'wasm32-wasip1',
      ...flags,
      '--error-format=json',
      '-o', '/work/prog.wasm',
    ];

    const fds = [
      new Capture(), new Capture(), new Capture(),
      new PreopenDirectory('/tmp', []),
      sysrootPreopen(this.sysroot),
      work,
    ];

    /* CLIF2WASM_OBJECT is what tells the Cranelift backend to emit the
       wasm object format the bundled linker expects. Without it rustc
       produces something the link step cannot read. */
    const wasi = new WASI(args, ['CLIF2WASM_OBJECT=1'], fds, { debug: false });

    const started = Date.now();
    let exit = 0;
    try {
      const instance = await WebAssembly.instantiate(this.module, {
        wasi_snapshot_preview1: wasi.wasiImport,
      });
      exit = wasi.start(instance);
    } catch (e) {
      const m = String((e && e.message) || e);
      if (!log.trim()) log += m;
      exit = 1;
    }
    const ms = Date.now() - started;

    const diagnostics = parseDiagnostics(log);
    const built = work.dir.contents.get('prog.wasm');
    const bytes = built && built.data && built.data.length ? built.data : null;

    /* Everything that is not a JSON diagnostic: an internal compiler
       error, a trap, a message rustc printed plainly. Shown only when
       there are no diagnostics, because otherwise it is noise beside
       rustc's own rendering of the same thing. */
    const residue = log
      .split('\n')
      .filter(l => l && l[0] !== '{')
      .join('\n')
      .replaceAll('/work/prog.rs', 'program')
      .trim();

    return {
      ok: !!bytes,
      bytes,
      exit,
      ms,
      diagnostics,
      /* The text a reader sees. rustc's own rendering, in order, with
         the internal path swapped for something meaningful. */
      stderr: diagnostics.length
        ? diagnostics.map(d => d.rendered).join('\n')
        : (residue || (bytes ? '' : `rustc exited ${exit} without producing a program`)),
    };
  }

  /* The front end only: parse, resolve, type-check, solve traits, borrow
     check — and stop before code generation.

     A separate method rather than a flag the caller passes, because the
     *success condition is different* and getting that wrong is exactly
     the mistake this replaced. `compile()` reports `ok` by whether a
     wasm file appeared, which is the right test for a compile and is
     always false for a check: `--emit=metadata` never writes one. The
     audit asked `compile(src, CHECK_FLAGS).ok` and was told that none
     of the seven Rust problems type-checked, when in fact all of them
     do — the number that was wrong was the number that exists to say
     what the browser toolchain *can* do.

     So a check succeeds when rustc exited cleanly and emitted no error
     diagnostic, which is what "it type-checks" means. */
  async check(source) {
    const r = await this.compile(source, CHECK_FLAGS);
    const errors = r.diagnostics.filter(d => d.level === 'error');
    return {
      ok: r.exit === 0 && !errors.length,
      diagnostics: r.diagnostics,
      errors,
      stderr: r.stderr,
      ms: r.ms,
      exit: r.exit,
    };
  }

  /* What the compiler says it is. Asked rather than written down. */
  async version() {
    if (VERSION) return VERSION;
    if (!this.ready) return null;
    let out = '';
    const dec = new TextDecoder();
    class Capture extends Fd {
      fd_write(data) {
        out += dec.decode(data, { stream: true });
        return { ret: 0, nwritten: data.byteLength };
      }
    }
    const wasi = new WASI(['rustc', '--version'], [], [
      new Capture(), new Capture(), new Capture(),
    ], { debug: false });
    try {
      const instance = await WebAssembly.instantiate(this.module, {
        wasi_snapshot_preview1: wasi.wasiImport,
      });
      wasi.start(instance);
    } catch { /* a compiler that will not say is reported as unknown */ }
    VERSION = out.trim().split('\n')[0] || null;
    return VERSION;
  }
}
