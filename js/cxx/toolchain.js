/* ============================================================
   cxx/toolchain.js — Clang, in the page.

   A real C++ compiler, compiled to WebAssembly, running on the
   reader's own machine. No account, no key, no server, no
   Docker, no WSL. The cost is 90 MB of compiler, fetched once
   and then cached, and a set of differences from native Linux
   that are listed below and taken seriously everywhere else in
   the codebase.

   ---------------- what this actually is ----------------

     compiler   Clang/LLVM 20.1.2
     target     wasm32-unknown-wasi
     standard   C++20
     library    libc++ and wasi-libc, from browsercc's sysroot
     runtime    @bjorn3/browser_wasi_shim

   ---------------- how it differs from the native runner ----------------

   These are measured, not assumed, and tests/cxx-browser.test.mjs
   re-measures them:

     · wasm32. `long`, `void*` and `size_t` are FOUR bytes, where the
       native runner is x86-64 and they are eight. `int` and `long long`
       agree at 4 and 8. A problem whose answer depends on any of that
       cannot run here and is marked native-only.

     · No exceptions, at all. `-fno-exceptions` rejects `try`/`throw`
       at compile time; `-fexceptions` gets as far as the linker and
       fails on `__cxa_throw`. The sysroot's libc++ has no unwinder. So
       `std::stoi` on bad input, `vector::at` out of range, and anything
       that catches, are native-only.

     · No sanitizers. There is no ASan or UBSan runtime for this target,
       and — worse for teaching — out-of-bounds reads and null
       dereferences do not trap here either: linear memory starts at
       address 0 and is readable, so they quietly return rubbish. A
       problem whose lesson is "the sanitizer catches what the output
       hides" would have its lesson silently deleted. Native-only, and
       the flags are never quietly relaxed to make one fit.

     · No threads, no OpenMP, no filesystem beyond what the shim
       provides, no fork, no signals.

   ---------------- shape ----------------

   One module, no DOM, no window. It runs unchanged in a Worker and in
   Node, which is what lets the audit in scripts/audit-cxx.mjs classify
   every problem by actually compiling it rather than by guessing.
   ============================================================ */

/* The flags every browser compile uses. Not configurable from outside:
   a profile the browser cannot honour must fail the capability check, not
   silently become a different profile. */
export const BROWSER_FLAGS = Object.freeze([
  '-O2', '-std=c++20', '-fno-exceptions', '-Wall', '-Wextra',
]);

export const TOOLCHAIN = Object.freeze({
  compiler: 'clang 20.1.2',
  target: 'wasm32-unknown-wasi',
  standard: 'C++20',
  flags: BROWSER_FLAGS.join(' '),
});

/* The assets, in the order a progress bar should count them. */
export const ASSETS = Object.freeze([
  { key: 'clang', file: 'browsercc/clang.wasm', bytes: 42554368, label: 'the compiler' },
  { key: 'sysroot', file: 'browsercc/sysroot.tar', bytes: 28620800, label: 'the standard library' },
  { key: 'lld', file: 'browsercc/lld.wasm', bytes: 23203840, label: 'the linker' },
]);

export const TOTAL_BYTES = ASSETS.reduce((n, a) => n + a.bytes, 0);

/* ---------------- fetching, with progress and a cache ---------------- */

/* The version lives in the URL rather than in a header, because a static
   host cannot set headers and because a wrong answer from a stale cache
   would be a compiler that no longer matches its sysroot. */
const CACHE_NAME = 'systems-lab-cxx-v1';

async function openCache() {
  /* Absent in a Worker without the Cache API, and absent in a private
     window in several browsers. Neither is an error: it just means the
     90 MB is fetched again next time. */
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch { return null; }
}

/* Reads a response body with progress. `onChunk` is called with the number
   of bytes added, not the total, so a caller tracking several downloads can
   just add them up. */
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

export async function fetchAsset(baseUrl, asset, { onProgress, signal } = {}) {
  const url = new URL(`${asset.file}?v=${CACHE_NAME}`, baseUrl).href;
  const cache = await openCache();

  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        if (onProgress) onProgress(bytes.length, true);
        return bytes;
      }
    } catch { /* a broken cache entry is just a miss */ }
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${asset.label}: ${res.status} ${res.statusText}`);

  /* Put it in the cache before reading it, by cloning — a body can only be
     consumed once, and failing to cache must not fail the download. */
  let toCache = null;
  if (cache) { try { toCache = res.clone(); } catch { toCache = null; } }

  const bytes = await readWithProgress(res, n => { if (onProgress) onProgress(n, false); });

  if (cache && toCache) {
    try { await cache.put(url, toCache); } catch { /* quota, or storage off */ }
  }
  return bytes;
}

/* ---------------- the tar the sysroot arrives in ---------------- */

/* browsercc ships its sysroot as an uncompressed tar and exports a reader
   for it; this is the same walk, kept here so the toolchain module has no
   import-time dependency on which of browsercc's entry points exist. */
export function* tarEntries(buffer) {
  const data = new Uint8Array(buffer);
  const dec = new TextDecoder('utf-8');
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    const name = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(dec.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim(), 8) || 0;
    const start = offset + 512;
    yield { name, content: data.slice(start, start + size) };
    offset = start + Math.ceil(size / 512) * 512;
  }
}

/* ---------------- the toolchain itself ---------------- */

export class Toolchain {
  constructor({ baseUrl, Clang, LLD }) {
    this.baseUrl = baseUrl;
    this.Clang = Clang;
    this.LLD = LLD;
    this.ready = false;
    this.clangModule = null;
    this.lldModule = null;
    this.sysroot = null;
    /* The `-###` driver run depends only on the flags, never on the source,
       and it costs most of a second. Asked once per flag set. */
    this.invocations = new Map();
  }

  /* Downloads and compiles the three big assets. Safe to call twice; the
     second call waits on the first rather than starting again. */
  async init({ onProgress, signal } = {}) {
    if (this.ready) return;
    if (this._initing) return this._initing;

    this._initing = (async () => {
      let done = 0;
      const tick = (n, fromCache) => {
        done += n;
        if (onProgress) {
          onProgress({
            loaded: done, total: TOTAL_BYTES, fromCache,
            percent: Math.min(100, Math.round((done / TOTAL_BYTES) * 100)),
          });
        }
      };

      const [clangBin, sysrootTar, lldBin] = await Promise.all(
        ASSETS.map(a => fetchAsset(this.baseUrl, a, { onProgress: tick, signal })),
      );

      if (onProgress) onProgress({ loaded: TOTAL_BYTES, total: TOTAL_BYTES, percent: 100, stage: 'preparing' });

      /* Compiling 63 MB of WebAssembly is the other slow half of the first
         run, and the result is reusable for every compile afterwards. */
      [this.clangModule, this.lldModule] = await Promise.all([
        WebAssembly.compile(clangBin),
        WebAssembly.compile(lldBin),
      ]);

      this.sysroot = [...tarEntries(sysrootTar.buffer.slice(
        sysrootTar.byteOffset, sysrootTar.byteOffset + sysrootTar.byteLength,
      ))].filter(e => !e.name.endsWith('/'));

      this.ready = true;
    })();

    try { await this._initing; } finally { this._initing = null; }
  }

  /* Emscripten will fetch and compile its own .wasm unless handed one. This
     is what makes the second compile cost a second rather than three. */
  _instantiate(mod) {
    return (imports, cb) => {
      WebAssembly.instantiate(mod, imports).then(inst => cb(inst, mod));
      return {};
    };
  }

  _plant(m) {
    for (const { name, content } of this.sysroot) {
      const dir = name.split('/').slice(0, -1).join('/');
      if (dir && !m.FS.analyzePath(dir).exists) m.FS.mkdirTree(dir);
      m.FS.writeFile(name, content);
    }
  }

  async _invocation(fileName, flags) {
    const key = `${fileName} ${flags.join(' ')}`;
    if (this.invocations.has(key)) return this.invocations.get(key);

    let stderr = '';
    const clang = await this.Clang({
      thisProgram: 'clang++',
      printErr: d => { stderr += `${d}\n`; },
      instantiateWasm: this._instantiate(this.clangModule),
    });
    clang.FS.writeFile(fileName, '');
    /* Enough of a sysroot for the driver to decide on paths; it does not
       read anything, it only has to find the names. */
    clang.FS.mkdirTree('/lib/wasm32-wasi');
    clang.FS.mkdirTree('/include/c++/v1');
    clang.FS.writeFile('/lib/wasm32-wasi/crt1-command.o', new Uint8Array(0));
    clang.FS.writeFile('/lib/wasm32-wasi/crt1-reactor.o', new Uint8Array(0));

    if (clang.callMain([fileName, ...flags, '-###']) !== 0) {
      throw new Error(`the compiler driver rejected these flags:\n${stderr}`);
    }

    const lines = stderr.split('\n');
    const pick = needle => {
      const line = lines.find(l => l.includes(needle)) || '';
      const quoted = line.match(/"([^"]*)"/g);
      if (!quoted) throw new Error(`could not read the driver's ${needle} line`);
      const args = quoted.map(s => s.slice(1, -1)).slice(1);
      return { args, out: args[args.findIndex(a => a === '-o') + 1] };
    };
    const cc1 = pick('-cc1');
    const ld = pick('wasm-ld');
    const found = {
      compilerArgs: cc1.args, compilerArtifact: cc1.out,
      linkerArgs: ld.args, linkerArtifact: ld.out,
    };
    this.invocations.set(key, found);
    return found;
  }

  /* One compile. Returns the linked WebAssembly.Module, or null and the
     compiler's own words — which are ordinary Clang diagnostics, carets and
     all, so the existing diagnostic parser reads them unchanged. */
  async compile(source, flags = BROWSER_FLAGS) {
    if (!this.ready) throw new Error('the toolchain has not been initialised');

    let stderr = '';
    const onErr = d => { stderr += `${d}\n`; };
    const inv = await this._invocation('main.cpp', flags);

    const clang = await this.Clang({
      thisProgram: 'clang++', printErr: onErr,
      instantiateWasm: this._instantiate(this.clangModule),
    });
    clang.FS.writeFile('main.cpp', source);
    this._plant(clang);

    /* A copy of the argv every time: Emscripten's callMain unshifts argv[0]
       into the array it is given, so passing the cached one twice turns
       `-cc1` into argv[2] and the driver stops recognising it. */
    if (clang.callMain([...inv.compilerArgs]) !== 0) {
      return { ok: false, stderr, module: null };
    }
    const obj = clang.FS.readFile(inv.compilerArtifact, { encoding: 'binary' });

    const lld = await this.LLD({
      thisProgram: 'wasm-ld', printErr: onErr,
      instantiateWasm: this._instantiate(this.lldModule),
    });
    lld.FS.writeFile(inv.compilerArtifact, obj);
    this._plant(lld);
    if (lld.callMain([...inv.linkerArgs]) !== 0) {
      return { ok: false, stderr, module: null };
    }

    const wasm = lld.FS.readFile(inv.linkerArtifact, { encoding: 'binary' });
    return { ok: true, stderr, module: await WebAssembly.compile(wasm), bytes: wasm };
  }
}

/* ---------------- running one case ----------------

   Deliberately a free function taking a compiled module: one compile per
   submission, one fresh instance per case, so nothing a case leaves behind
   — a mutated global, a half-read stdin — can reach the next one. */

export const RUN_LIMITS = Object.freeze({
  stdoutBytes: 64 * 1024,
  stderrBytes: 64 * 1024,
});

export async function runCase(module, stdin, { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, limits = RUN_LIMITS }) {
  let out = '';
  let err = '';
  let outTruncated = false;
  let errTruncated = false;

  const sink = (which) => ConsoleStdout.lineBuffered(line => {
    if (which === 1) {
      if (out.length >= limits.stdoutBytes) { outTruncated = true; return; }
      out += `${line}\n`;
    } else {
      if (err.length >= limits.stderrBytes) { errTruncated = true; return; }
      err += `${line}\n`;
    }
  });

  const wasi = new WASI(
    ['main.wasm'],
    [],
    [
      new OpenFile(new File(new TextEncoder().encode(typeof stdin === 'string' ? stdin : ''))),
      sink(1),
      sink(2),
      new PreopenDirectory('/', new Map()),
    ],
    { debug: false },
  );

  const started = Date.now();
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  let exit = 0;
  let crash = '';
  try {
    wasi.start(instance);
  } catch (e) {
    if (e && typeof e.exit_code === 'number') {
      exit = e.exit_code;
    } else {
      /* A wasm trap: unreachable, an out-of-bounds *linear memory* access
         past the end of the heap, a bad indirect call. Reported as a crash
         rather than as a wrong answer. */
      exit = -1;
      crash = String((e && e.message) || e);
    }
  }

  return {
    stdout: outTruncated ? `${out}\n…output truncated…\n` : out,
    stderr: errTruncated ? `${err}\n…output truncated…\n` : err,
    exit,
    crash,
    signal: null,
    timedOut: false,
    ms: Date.now() - started,
    sanitizer: false,
  };
}
