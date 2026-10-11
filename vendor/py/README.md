# vendor/py — Python in the browser

Copied here by `npm run vendor:py`. Do not edit anything in this directory;
change `scripts/vendor-py.mjs` and run it again.

| package | version | licence |
| --- | --- | --- |
| [Pyodide](https://github.com/pyodide/pyodide) | 314.0.7 | MPL-2.0 — `pyodide/LICENSE` |

Pyodide 314.0.7 is **CPython 3.14.2** compiled to WebAssembly through
Emscripten, with the standard library in `python_stdlib.zip`. CPython itself
is under the [PSF licence](https://docs.python.org/3/license.html); the
Emscripten runtime it is built with is MIT.

12.9 MB in total, none of which is fetched until a reader
presses Run on a Python problem with no other runner available.

`pyodide-lock.json` is the index of the thousand-odd packages Pyodide can
install. Nothing here installs one, but `loadPyodide` reads the file during
start-up whatever you pass for `packages`, and a 404 stops it booting.

## What is not here

- `pyodide.js`, the `.map` files and the `.d.ts` files — the UMD build,
  source maps and TypeScript types. The worker is a module worker.
- Pyodide's own demo console pages.

## Why these files are in the repository

Same reason as `vendor/cxx`: the site is a folder served by GitHub Pages with
no build step and no runtime dependencies, so anything it needs at run time
has to be a file here. Fetching the interpreter from a CDN instead would make
it an unpinned third party in the one part of the site that executes code.
