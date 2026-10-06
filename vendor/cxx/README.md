# vendor/cxx — the browser C++ toolchain

Copied here by `npm run vendor:cxx`. Do not edit anything in this directory;
change `scripts/vendor-cxx.mjs` and run it again.

| package | version | licence |
| --- | --- | --- |
| [browsercc](https://github.com/BertalanD/browsercc) | 0.1.1 | MIT — `browsercc/LICENSE` |
| [@bjorn3/browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) | 0.4.2 | MIT OR Apache-2.0 — `wasi/LICENSE-MIT`, `wasi/LICENSE-APACHE` |

browsercc is a build of **Clang/LLVM 20.1.2** targeting **wasm32-unknown-wasi**,
plus `wasm-ld` and a WASI sysroot containing wasi-libc and libc++.

90.2 MB in total, none of which is fetched until a reader
presses Run on a C++ problem with no other runner available.

## Why these files are in the repository

The site is a folder served by GitHub Pages with no build step and no runtime
dependencies. Anything it needs at run time has to be a file here. Fetching
the compiler from a public CDN instead would be smaller to clone and would
also mean the site stops working the day that CDN changes its policy on
40 MB binaries — and would make the compiler an unpinned third party in the
one part of the site that executes code.

## What is not here

`stdc++.h.pch` (18.5 MB). It only applies to one exact flag set, browsercc's
own `compile()` never uses it, and it is a fifth of the download again.
