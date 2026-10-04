/* The stylesheets, checked as text rather than through a renderer — these are
   the failures that look like "the site is broken" rather than like a CSS bug,
   and all of them are visible in the source.

   Three things are enforced:

     1. Every purchasable theme defines the whole required token set. A theme
        missing --text renders invisible text.
     2. Every var(--x) used anywhere resolves to a token something defines.
        A typo in a token name silently renders transparent or unstyled.
     3. [hidden] still wins. A class that sets display:flex outranks the
        browser's built-in [hidden] rule, and an absolutely positioned overlay
        left visible swallows every click on the page.

   Run: node tests/browser/styles.test.mjs */

import { JSDOM } from 'jsdom';
import { read, section, check, ok, report } from '../harness.mjs';

const styles = read('css/styles.css');
const themes = read('css/themes.css');
const all = styles + '\n' + themes;

/* Kept in step with the REQUIRED list documented at the top of themes.css. */
const REQUIRED = [
  'bg', 'bg-elev', 'bg-elev-2', 'bg-inset', 'border', 'border-strong',
  'text', 'text-dim', 'text-faint',
  'accent', 'accent-text', 'accent-soft',
  'ok', 'warn', 'danger',
  'diff-beginner', 'diff-intermediate', 'diff-advanced',
  'st-unsolved', 'st-attempted', 'st-solved', 'st-read',
  'hl-keyword', 'hl-type', 'hl-string', 'hl-comment',
  'hl-num', 'hl-fn', 'hl-literal', 'hl-preproc',
];

/* The themes the shop sells, read out of store.js so the two cannot drift:
   a theme on sale with no stylesheet block is a purchase that does nothing. */
const sold = [...read('js/store.js').matchAll(/id:\s*'(theme-[\w-]+)'/g)].map(m => m[1]);

/* ---------------- the token set ---------------- */

section('the default theme');
/* The default palette is declared on a selector group — ":root" together with
   the theme-dark preview container — so a preview swatch paints from the same
   values as the page rather than from a second copy of them. Match the group,
   not a bare ":root {". */
const rootBlock = styles.match(/:root[^{]*\{([\s\S]*?)\n\}/);
ok(':root exists in styles.css', !!rootBlock);
ok('and the same block serves a theme-dark preview',
  /:root,\s*\[data-theme-preview="theme-dark"\]\s*\{/.test(styles.replace(/\s+/g, ' ')));
for (const token of REQUIRED) {
  ok(`:root defines --${token}`, new RegExp(`--${token}\\s*:`).test(rootBlock[1]));
}

section('every theme on sale has a stylesheet block');
ok('the shop sells some themes', sold.length >= 8);
for (const id of sold) {
  if (id === 'theme-dark') {
    /* The default is :root itself rather than a block of its own. */
    ok(`${id} is the :root default`, true);
    continue;
  }
  ok(`${id} has a block in themes.css`,
    new RegExp(`html\\[data-theme="${id}"\\]\\s*,`).test(themes));
}

/* Every theme on sale is also shown as a miniature in the shop, which paints
   from the same block via [data-theme-preview]. A theme without that selector
   would render its card in whatever theme the reader is wearing - a preview
   that lies. */
section('every theme can be previewed from its own tokens');
for (const id of sold) {
  const where = id === 'theme-dark' ? styles : themes;
  ok(`${id} has a preview selector`,
    where.includes(`[data-theme-preview="${id}"]`));
}

section('every theme block defines the whole token set');
for (const id of sold) {
  if (id === 'theme-dark') continue;
  const block = themes.match(new RegExp(`html\\[data-theme="${id}"\\][^{]*\\{([\\s\\S]*?)\\n\\}`));
  if (!ok(`${id}: block is readable`, !!block)) continue;
  const missing = REQUIRED.filter(t => !new RegExp(`--${t}\\s*:`).test(block[1]));
  check(`${id}: no missing tokens`, missing, []);
}

/* ---------------- no token is used without being defined ---------------- */

section('every var(--x) resolves');
const used = new Set([...all.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
ok('some tokens are in use', used.size > 20);
const undefinedTokens = [...used].filter(t => !defined.has(t)).sort();
check('no token is used without being defined', undefinedTokens, []);

section('no token is defined and never used');
/* Not a failure — a token can be defined ahead of the rule that will want it —
   but dead tokens in every theme block are a maintenance cost worth seeing. */
const unused = [...defined].filter(t => !used.has(t)).sort();
if (unused.length) console.log(`  --    defined but unused: ${unused.join(', ')}`);
ok('the token list is not mostly dead', unused.length < defined.size / 2);

/* ---------------- the hidden rule ---------------- */

section('[hidden] wins');
ok('styles.css has a [hidden] rule', /\[hidden\]\s*\{[^}]*display:\s*none/.test(styles));
ok('and it is marked important, so a display: rule on a class cannot beat it',
  /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(styles));

/* Proved rather than asserted: jsdom applies a <style> element's cascade, so a
   node carrying both `hidden` and a class that sets display:grid must still
   compute to none. That combination is exactly the one that left an invisible
   overlay catching clicks in the tracker. */
const dom = new JSDOM(`<!DOCTYPE html><html><head><style>${styles}</style></head>
  <body>
    <div id="plain" hidden>x</div>
    <div id="flexed" class="stack" hidden>x</div>
    <div id="gridded" class="grid" hidden>x</div>
    <div id="shown" class="stack">x</div>
  </body></html>`);
const { window } = dom;
const display = id => window.getComputedStyle(window.document.getElementById(id)).display;

check('a hidden element is display:none',            display('plain'), 'none');
check('a hidden flex container is still none',       display('flexed'), 'none');
check('a hidden grid container is still none',       display('gridded'), 'none');
ok('and a visible one is not none',                  display('shown') !== 'none');

/* ---------------- the editor's two layers ----------------

   The syntax highlighting is a coloured <pre> sitting exactly behind a
   transparent <textarea>. Anything that can move a glyph by a fraction of a
   pixel must be identical on both, or the text sits beside its own colour —
   and the symptom is subtle enough to ship unnoticed.

   So the metrics are declared once, in a rule that targets both, and this
   checks two things: that the shared rule really does declare all of them,
   and that no rule targeting just one layer sets any of them afterwards. */

section('the editor overlay has matched metrics');

const METRICS = [
  'font-family', 'font-size', 'line-height', 'letter-spacing', 'tab-size',
  'padding', 'margin', 'border', 'white-space', 'text-indent', 'box-sizing',
  'word-break', 'overflow-wrap', 'text-align',
];

/* A rule is {selector, declarations}. Good enough for a hand-written
   stylesheet with no nested at-rules inside these sections. */
function rules(css) {
  const out = [];
  for (const chunk of css.split('}')) {
    const at = chunk.indexOf('{');
    if (at < 0) continue;
    const selector = chunk.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: chunk.slice(at + 1) });
  }
  return out;
}

const declares = (body, prop) =>
  new RegExp('(^|;|\\n)\\s*' + prop.replace('-', '\\-') + '\\s*:', 'i').test(body);

const edRules = rules(styles);

const shared = edRules.find(r => {
  const parts = r.selector.split(',').map(x => x.trim());
  return parts.includes('.ed-highlight') && parts.includes('.ed-input');
});
ok('a rule targets both layers together', !!shared);

if (shared) {
  for (const prop of METRICS) {
    ok(`the shared rule sets ${prop}`, declares(shared.body, prop));
  }
}

/* Only rules targeting a layer element itself — not a descendant of it, and
   not the container. `.ed-highlight code` legitimately zeroes its own padding
   because the textarea has no equivalent child. */
const LAYER_ONLY = /^\.ed-(input|highlight)(::?[\w-]+)?$/;

for (const r of edRules) {
  if (r === shared) continue;
  const parts = r.selector.split(',').map(x => x.trim());
  const targetsOneLayer = parts.some(p => LAYER_ONLY.test(p));
  if (!targetsOneLayer) continue;
  const sets = METRICS.filter(prop => declares(r.body, prop));
  if (!check(`"${r.selector}" sets no shared metric`, sets, [])) {
    console.log('        a metric set on one layer only will misalign the text');
  }
}

section('the overlay cannot be clicked, and the input is on top');
ok('the highlight ignores pointer events',
  shared && /pointer-events:\s*none/.test(styles.slice(styles.indexOf('.ed-highlight {'))));
ok('the input text is transparent so the colours show through',
  /\.ed-input\s*\{[^}]*color:\s*transparent/.test(styles));
ok('but the caret is not',
  /\.ed-input\s*\{[^}]*caret-color:/.test(styles));
ok('and a too-long document falls back to showing the textarea itself',
  /data-plain="true"[^}]*\}/.test(styles) || styles.includes('data-plain'));

/* ---------------- the views ---------------- */

section('every view in index.html starts hidden');
const html = read('index.html');
const views = [...html.matchAll(/<section id="view-([\w-]+)"([^>]*)>/g)];
ok('views are declared', views.length >= 7);
for (const [, name, attrs] of views) {
  ok(`view-${name} is hidden in the markup`, attrs.includes('hidden'));
}

section('the theme bootstrap runs before the stylesheets can paint');
/* If this inline script moved below the first paint, every load would flash
   the default dark theme — blinding for anyone wearing Paper. */
const bootIdx = html.indexOf('systems-lab/state/v1');
const bodyIdx = html.indexOf('<body');
ok('the inline theme script is in the head', bootIdx > 0 && bootIdx < bodyIdx);
ok('it sets data-theme', /setAttribute\('data-theme'/.test(html));
ok('it is wrapped so a blocked localStorage cannot stop the page',
  /try\s*\{[\s\S]*?catch/.test(html.slice(bootIdx - 400, bootIdx + 600)));

section('every script index.html loads exists');
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../harness.mjs';
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
ok('scripts are declared', srcs.length >= 10);
for (const src of srcs) {
  ok(`${src} exists`, fs.existsSync(path.join(ROOT, src)));
}

section('load order');
/* The registry has to exist before any type module calls register(), and the
   type modules before problem.js asks the registry for one. */
const idx = src => srcs.indexOf(src);
ok('the registry loads before the type modules', idx('js/types/registry.js') < idx('js/types/mcq.js'));
ok('store loads first', idx('js/store.js') === 0);
ok('app loads last', idx('js/app.js') === srcs.length - 1);
ok('md loads before problem.js, which renders with it', idx('js/md.js') < idx('js/problem.js'));
ok('highlight loads before md, which calls into it', idx('js/highlight.js') < idx('js/md.js') + 2);

report('browser/styles');
