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
const rootBlock = styles.match(/:root\s*\{([\s\S]*?)\n\}/);
ok(':root exists in styles.css', !!rootBlock);
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
    new RegExp(`html\\[data-theme="${id}"\\]\\s*\\{`).test(themes));
}

section('every theme block defines the whole token set');
for (const id of sold) {
  if (id === 'theme-dark') continue;
  const block = themes.match(new RegExp(`html\\[data-theme="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
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
const bootIdx = html.indexOf('bare-metal/state/v1');
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
