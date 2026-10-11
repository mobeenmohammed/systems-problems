/* Copies Pyodide out of node_modules and into vendor/, which is what
   actually gets deployed. Same reasoning as scripts/vendor-cxx.mjs: the
   site has no build step at serve time and no runtime dependencies, so a
   thing it needs at run time has to be a file in the repository.

   pyodide-lock.json is copied even though nothing here installs a
   package: loadPyodide reads it during start-up regardless of
   `packages: []`, and a 404 there stops the interpreter booting. It is
   119 KB against 12.8 MB, which is not worth being clever about.

   Deliberately *not* copied:

     pyodide.js, *.map, *.d.ts   the UMD build, source maps and types. The
                                 worker is a module worker and imports the
                                 .mjs.
     console.html, console-v2    Pyodide's own demo pages.

   The npm package ships no LICENSE file, so the MPL-2.0 text is fetched
   from the tag that matches the installed version and written beside the
   code. Pyodide is MPL-2.0; the CPython it contains is under the PSF
   licence, which the README here names.

   Run: npm run vendor:py  (and commit what it writes) */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'vendor', 'py');

const COPY = [
  ['pyodide', 'pyodide.mjs', 'pyodide/pyodide.mjs'],
  ['pyodide', 'pyodide.asm.mjs', 'pyodide/pyodide.asm.mjs'],
  ['pyodide', 'pyodide.asm.wasm', 'pyodide/pyodide.asm.wasm'],
  ['pyodide', 'python_stdlib.zip', 'pyodide/python_stdlib.zip'],
  ['pyodide', 'pyodide-lock.json', 'pyodide/pyodide-lock.json'],
];

const pkgVersion = name =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;

const version = pkgVersion('pyodide');

fs.rmSync(OUT, { recursive: true, force: true });

const manifest = { generatedBy: 'scripts/vendor-py.mjs', packages: {}, files: {} };
let total = 0;
const missing = [];

for (const [pkg, from, to] of COPY) {
  const src = path.join(ROOT, 'node_modules', pkg, from);
  if (!fs.existsSync(src)) { missing.push(`${pkg}/${from}`); continue; }
  const dst = path.join(OUT, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const bytes = fs.readFileSync(src);
  fs.writeFileSync(dst, bytes);
  manifest.files[to] = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  };
  manifest.packages[pkg] = version;
  total += bytes.length;
  console.log(`${String((bytes.length / 1048576).toFixed(2)).padStart(8)} MB  ${to}`);
}

if (missing.length) {
  console.error('\nnot found in node_modules:');
  for (const m of missing) console.error('  ' + m);
  console.error('\nrun npm install first.');
  process.exit(1);
}

/* The Python version Pyodide was built against, read out of its own lock
   file rather than guessed from the package version. */
let python = 'unknown';
try {
  const lock = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'node_modules', 'pyodide', 'pyodide-lock.json'), 'utf8'));
  python = (lock.info || {}).python || python;
} catch { /* the README just says unknown */ }

/* ---- the licence, which the package does not ship ---- */

const LICENSE_URL =
  `https://raw.githubusercontent.com/pyodide/pyodide/${version}/LICENSE`;

let licence = null;
try {
  const res = await fetch(LICENSE_URL);
  if (res.ok) licence = await res.text();
} catch { /* offline: handled below */ }

if (licence && /Mozilla Public License/i.test(licence)) {
  fs.writeFileSync(path.join(OUT, 'pyodide', 'LICENSE'), licence);
  console.log(`\n  LICENSE fetched from the ${version} tag`);
} else {
  console.error('\n  could not fetch the MPL-2.0 text from');
  console.error(`    ${LICENSE_URL}`);
  console.error('  Pyodide is redistributed here, so its licence has to be here too.');
  console.error('  Save it as vendor/py/pyodide/LICENSE and run this again.');
  process.exit(1);
}

manifest.totalBytes = total;
manifest.python = python;
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

fs.writeFileSync(path.join(OUT, 'README.md'), `# vendor/py — Python in the browser

Copied here by \`npm run vendor:py\`. Do not edit anything in this directory;
change \`scripts/vendor-py.mjs\` and run it again.

| package | version | licence |
| --- | --- | --- |
| [Pyodide](https://github.com/pyodide/pyodide) | ${version} | MPL-2.0 — \`pyodide/LICENSE\` |

Pyodide ${version} is **CPython ${python}** compiled to WebAssembly through
Emscripten, with the standard library in \`python_stdlib.zip\`. CPython itself
is under the [PSF licence](https://docs.python.org/3/license.html); the
Emscripten runtime it is built with is MIT.

${(total / 1048576).toFixed(1)} MB in total, none of which is fetched until a reader
presses Run on a Python problem with no other runner available.

\`pyodide-lock.json\` is the index of the thousand-odd packages Pyodide can
install. Nothing here installs one, but \`loadPyodide\` reads the file during
start-up whatever you pass for \`packages\`, and a 404 stops it booting.

## What is not here

- \`pyodide.js\`, the \`.map\` files and the \`.d.ts\` files — the UMD build,
  source maps and TypeScript types. The worker is a module worker.
- Pyodide's own demo console pages.

## Why these files are in the repository

Same reason as \`vendor/cxx\`: the site is a folder served by GitHub Pages with
no build step and no runtime dependencies, so anything it needs at run time
has to be a file here. Fetching the interpreter from a CDN instead would make
it an unpinned third party in the one part of the site that executes code.
`);

console.log(`\n${(total / 1048576).toFixed(1)} MB written to vendor/py`);
console.log('manifest.json and README.md written');
