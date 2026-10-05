/* Bundle CodeMirror into vendor/codemirror.js, once, by hand.

   The site has no build step and no runtime dependencies, and that stays
   true: this is run by whoever changes the editor's feature set, and the
   output is committed. A reader cloning the repo serves it directly.

   Why vendored rather than loaded from a CDN: the site is meant to work on a
   laptop with no network while the local runner compiles your C++, and a
   page whose editor disappears offline would be a poor trade for a few
   hundred kilobytes.

   Run: node scripts/build-editor.mjs */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'vendor', 'codemirror.js');
mkdirSync(path.join(ROOT, 'vendor'), { recursive: true });

const result = await build({
  entryPoints: [path.join(ROOT, 'scripts', 'editor-entry.js')],
  bundle: true,
  format: 'iife',
  /* One global, because the site loads plain <script> tags in order. */
  globalName: 'CM',
  footer: { js: 'window.CM = CM.default || CM;' },
  minify: true,
  target: ['es2020'],
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});

const banner = [
  '/* CodeMirror 6, bundled for Systems Lab by scripts/build-editor.mjs.',
  '   Do not edit. Change scripts/editor-entry.js and rebuild.',
  `   Built ${new Date().toISOString().slice(0, 10)} from the versions in package.json.`,
  '   MIT licensed — see https://codemirror.net/ */',
  '',
].join('\n');

const code = banner + result.outputFiles[0].text;
writeFileSync(OUT, code, 'utf8');

const kb = Math.round(Buffer.byteLength(code) / 1024);
console.log(`vendor/codemirror.js written — ${kb} KB minified`);

/* The versions that went in, recorded next to the bundle so the committed
   file can be traced back to something. */
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const used = Object.fromEntries(Object.entries(pkg.devDependencies)
  .filter(([k]) => k.startsWith('@codemirror/') || k === 'codemirror' || k.startsWith('@lezer/')));
writeFileSync(path.join(ROOT, 'vendor', 'codemirror.versions.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), bytes: Buffer.byteLength(code), packages: used }, null, 2) + '\n',
  'utf8');
console.log(`vendor/codemirror.versions.json written — ${Object.keys(used).length} packages`);
