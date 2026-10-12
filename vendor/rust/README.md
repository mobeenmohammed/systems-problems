# vendor/rust — the browser Rust toolchain

Pinned by `scripts/vendor-rust.mjs`. Do not edit anything in this directory;
change that script and run it again.

| artifact | from | licence |
| --- | --- | --- |
| `rustc.wasm` | [AngelOnFira/weblings](https://github.com/AngelOnFira/weblings) | MIT — `LICENSE-weblings` |
| `sysroot-wasip1.bundle` | the Rust standard library, built for `wasm32-wasip1` | MIT OR Apache-2.0 — `LICENSE-MIT`, `LICENSE-APACHE` |

The WASI shim is the one already vendored at `../cxx/wasi` — the same
`@bjorn3/browser_wasi_shim` that runs the C++ output, because the Rust output
is the same kind of thing.

## What this is

`rustc.wasm` is a **real rustc** (1.96.0-dev) compiled to WebAssembly from
@bjorn3's patched branches, using the **Cranelift** backend and a wasm linker
rather than LLVM and `lld`. That choice is why it is 88 MB rather than the
several hundred an LLVM build costs, and it is why there is a Rust compiler
here at all.

`sysroot-wasip1.bundle` is the `wasm32-wasip1` sysroot as one flat archive:
the six bytes `RIWB1\n`, a little-endian `u32` index length, a JSON index of
`{p, o, l}` entries, then the concatenated file bytes. `js/rust/toolchain.js`
unpacks it into an in-memory directory tree and hands it to rustc as a WASI
preopen. The format is weblings'.

| file | on disk | over the wire (gzip) |
| --- | --- | --- |
| `rustc.wasm` | 87.9 MB | 20.3 MB |
| `sysroot-wasip1.bundle` | 71.3 MB | 23.7 MB |
| | **159.2 MB** | **44.0 MB** |

None of it is fetched until somebody opens a Rust problem and either types
(which type-checks) or presses Run.

## No cross-origin isolation, which is the whole point

`rubrc`, the other in-browser Rust toolchain, is an LLVM build that needs
threads, and therefore `SharedArrayBuffer`, and therefore the
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response
headers. **GitHub Pages cannot set a response header at all.** It could be
worked around with a service worker that synthesises them, at the cost of a
forced reload on first visit and of breaking every cross-origin subresource —
but it would be a workaround for a requirement this toolchain does not have.

This `rustc.wasm` is built with an internal memory and is single-threaded. It
needs no headers, no isolation and no service worker. weblings' own demo is
served from GitHub Pages, which is how that was confirmed before anything was
vendored here.

## What it cannot do

One thing, and it is specific:

```
error: wasm emission failed: translating function `core::num::from_ascii_radix`:
       lowering `v135 = smulhi.i64 v133, v132`:
       unimplemented binary opcode smulhi on i64
```

**`parse::<i64>()` and `parse::<u64>()` do not compile.** The Cranelift → wasm
lowering has no `smulhi` for i64, and `from_ascii_radix` needs one. It is not
affected by the optimisation level — tested at `-O`, `0`, `1`, `2`, `3`, `s`
and `z`, and on both editions.

Everything around it works: 64-bit arithmetic, division, `checked_add`,
printing an `i64` or a `u64` or an `i128`, and parsing `i32`, `u32`, `usize`
and `f64`. It is reading a 64-bit integer out of a string, and nothing else.

`data/rust-support.json` records which problems that stops, and is generated
by `npm run audit:rust` — which compiles every Rust reference solution and
runs it against that problem's own cases.

Type-checking is **not** affected, because `--emit=metadata` stops after the
borrow checker and before code generation. Every Rust problem is checked as
you type, including the ones that cannot be run here.

## Re-pinning

`npm run vendor:rust` downloads both artifacts from the weblings deployment
and verifies them against the SHA-256 digests in `manifest.json`. A digest
that does not match aborts without writing anything.
