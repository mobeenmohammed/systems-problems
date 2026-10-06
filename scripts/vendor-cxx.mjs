/* Copies the browser C++ toolchain out of node_modules and into vendor/, which
   is what actually gets deployed.

   The site has no build step at serve time and no runtime dependencies, so a
   thing it needs at run time has to be a file in the repository. That is true
   of a 40 MB compiler as much as of a stylesheet — it is just a larger file.

   Deliberately *not* copied: stdc++.h.pch (18.5 MB). It only applies to the
   exact flag set `-O2 -std=c++20 -fno-exceptions`, it is not wired into
   browsercc's own compile(), and it would add a fifth of the download again
   to save part of a second. If compile time becomes the complaint, this is
   the first thing to revisit.

   Run: npm run vendor:cxx  (and commit what it writes) */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'vendor', 'cxx');

const COPY = [
  ['browsercc', 'dist/index.js', 'browsercc/index.js'],
  ['browsercc', 'dist/clang.js', 'browsercc/clang.js'],
  ['browsercc', 'dist/lld.js', 'browsercc/lld.js'],
  ['browsercc', 'dist/clang.wasm', 'browsercc/clang.wasm'],
  ['browsercc', 'dist/lld.wasm', 'browsercc/lld.wasm'],
  ['browsercc', 'dist/sysroot.tar', 'browsercc/sysroot.tar'],
  ['browsercc', 'LICENSE', 'browsercc/LICENSE'],
  ['@bjorn3/browser_wasi_shim', 'dist/index.js', 'wasi/index.js'],
  ['@bjorn3/browser_wasi_shim', 'dist/fd.js', 'wasi/fd.js'],
  ['@bjorn3/browser_wasi_shim', 'dist/fs_mem.js', 'wasi/fs_mem.js'],
  ['@bjorn3/browser_wasi_shim', 'dist/wasi.js', 'wasi/wasi.js'],
  ['@bjorn3/browser_wasi_shim', 'dist/fs_opfs.js', 'wasi/fs_opfs.js'],
  ['@bjorn3/browser_wasi_shim', 'dist/wasi_defs.js', 'wasi/wasi_defs.js'],
  ['@bjorn3/browser_wasi_shim', 'dist/strace.js', 'wasi/strace.js'],
  ['@bjorn3/browser_wasi_shim', 'dist/debug.js', 'wasi/debug.js'],
  ['@bjorn3/browser_wasi_shim', 'LICENSE-MIT', 'wasi/LICENSE-MIT'],
  ['@bjorn3/browser_wasi_shim', 'LICENSE-APACHE', 'wasi/LICENSE-APACHE'],
];

const pkgVersion = name =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;

fs.rmSync(OUT, { recursive: true, force: true });

const manifest = { generatedBy: 'scripts/vendor-cxx.mjs', packages: {}, files: {} };
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
  manifest.packages[pkg] = pkgVersion(pkg);
  total += bytes.length;
  console.log(`${String((bytes.length / 1048576).toFixed(2)).padStart(8)} MB  ${to}`);
}

if (missing.length) {
  console.error('\nnot found in node_modules:');
  for (const m of missing) console.error('  ' + m);
  console.error('\nrun npm install first.');
  process.exit(1);
}

manifest.totalBytes = total;
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

fs.writeFileSync(path.join(OUT, 'README.md'), `# vendor/cxx — the browser C++ toolchain

Copied here by \`npm run vendor:cxx\`. Do not edit anything in this directory;
change \`scripts/vendor-cxx.mjs\` and run it again.

| package | version | licence |
| --- | --- | --- |
| [browsercc](https://github.com/BertalanD/browsercc) | ${manifest.packages.browsercc} | MIT — \`browsercc/LICENSE\` |
| [@bjorn3/browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) | ${manifest.packages['@bjorn3/browser_wasi_shim']} | MIT OR Apache-2.0 — \`wasi/LICENSE-MIT\`, \`wasi/LICENSE-APACHE\` |

browsercc is a build of **Clang/LLVM 20.1.2** targeting **wasm32-unknown-wasi**,
plus \`wasm-ld\` and a WASI sysroot containing wasi-libc and libc++.

${(total / 1048576).toFixed(1)} MB in total, none of which is fetched until a reader
presses Run on a C++ problem with no other runner available.

## Why these files are in the repository

The site is a folder served by GitHub Pages with no build step and no runtime
dependencies. Anything it needs at run time has to be a file here. Fetching
the compiler from a public CDN instead would be smaller to clone and would
also mean the site stops working the day that CDN changes its policy on
40 MB binaries — and would make the compiler an unpinned third party in the
one part of the site that executes code.

## What is not here

\`stdc++.h.pch\` (18.5 MB). It only applies to one exact flag set, browsercc's
own \`compile()\` never uses it, and it is a fifth of the download again.
`);

console.log(`\n${(total / 1048576).toFixed(1)} MB written to vendor/cxx`);
console.log('manifest.json and README.md written');
