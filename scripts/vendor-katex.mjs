/* Copies KaTeX out of node_modules and into vendor/, with only the fonts a
   current browser will actually use.

   Why KaTeX rather than MathJax: it renders synchronously, so a statement
   full of mathematics does not reflow a second after it appears; it has no
   runtime dependencies; and it emits a hidden MathML copy of every
   expression, which is what a screen reader reads. 268 KB of script and
   296 KB of fonts against MathJax's several megabytes.

   The .woff and .ttf copies of all twenty faces are dropped — 900 KB of the
   1.2 MB — because every browser this site supports has read woff2 since
   2016, and the CSS is rewritten to ask for nothing else.

   Run: npm run vendor:katex  (and commit what it writes) */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'katex');
const OUT = path.join(ROOT, 'vendor', 'katex');

if (!fs.existsSync(SRC)) {
  console.error('katex is not installed. Run npm install first.');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });

let total = 0;
const copy = (from, to) => {
  const bytes = fs.readFileSync(path.join(SRC, from));
  fs.writeFileSync(path.join(OUT, to), bytes);
  total += bytes.length;
  return bytes.length;
};

copy('dist/katex.min.js', 'katex.min.js');
copy('LICENSE', 'LICENSE');

/* The stylesheet, with every non-woff2 source removed. KaTeX lists three
   formats per face in src:, and a browser only downloads the first it
   understands — but leaving the others in means shipping files that are
   never read, or a stylesheet pointing at files that are not there. */
const css = fs.readFileSync(path.join(SRC, 'dist/katex.min.css'), 'utf8');
const trimmed = css.replace(
  /src:[^;}]*(?=[;}])/g,
  (src) => {
    const woff2 = src.match(/url\(([^)]*\.woff2)\)\s*format\(["']woff2["']\)/);
    return woff2 ? `src:url(${woff2[1]}) format("woff2")` : src;
  },
);
fs.writeFileSync(path.join(OUT, 'katex.min.css'), trimmed);
total += Buffer.byteLength(trimmed);

const leftOver = [...trimmed.matchAll(/url\(([^)]+)\)/g)]
  .map(m => m[1])
  .filter(u => !u.endsWith('.woff2'));
if (leftOver.length) {
  console.error('the stylesheet still asks for non-woff2 fonts:', leftOver.slice(0, 5));
  process.exit(1);
}

let fonts = 0;
for (const f of fs.readdirSync(path.join(SRC, 'dist/fonts'))) {
  if (!f.endsWith('.woff2')) continue;
  copy(`dist/fonts/${f}`, `fonts/${f}`);
  fonts += 1;
}

/* Every face the stylesheet names must be present, or an expression renders
   in a fallback font and the spacing is quietly wrong. */
const wanted = new Set([...trimmed.matchAll(/url\(fonts\/([^)]+)\)/g)].map(m => m[1]));
const missing = [...wanted].filter(f => !fs.existsSync(path.join(OUT, 'fonts', f)));
if (missing.length) {
  console.error('fonts the stylesheet needs but which were not copied:', missing);
  process.exit(1);
}

fs.writeFileSync(path.join(OUT, 'README.md'), `# vendor/katex

Copied here by \`npm run vendor:katex\`. Do not edit; change
\`scripts/vendor-katex.mjs\` and run it again.

**[KaTeX](https://katex.org) ${version}**, MIT — see \`LICENSE\`.

${fonts} woff2 faces, ${(total / 1024).toFixed(0)} KB in total. The \`.woff\`
and \`.ttf\` copies of the same faces are not shipped and the stylesheet has
been rewritten to ask only for woff2.

Loaded by \`index.html\` on every page, because mathematics appears in problem
statements, hints, feedback and solutions, and a late-loading renderer would
reflow all of them.
`);

console.log(`katex ${version}: ${fonts} woff2 faces, ${(total / 1024).toFixed(0)} KB -> vendor/katex`);
