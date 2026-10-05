/* The stylesheets, checked as text rather than through a renderer — these are
   the failures that look like "the site is broken" rather than like a CSS bug,
   and all of them are visible in the source.

   Four things are enforced:

     1. Every purchasable theme defines the whole required token set. A theme
        missing --text renders invisible text.
     2. Every var(--x) used anywhere resolves to a token something defines.
        A typo in a token name silently renders transparent or unstyled.
     3. [hidden] still wins. A class that sets display:flex outranks the
        browser's built-in [hidden] rule, and an absolutely positioned overlay
        left visible swallows every click on the page.
     4. Every class applied has a rule, and every rule has a class that
        applies it. Both directions, at zero tolerance, with the deliberate
        exceptions listed.

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

/* ---------------- classes and rules that have lost each other ----------------

   Two directions of drift, both failures:

     - a class the markup or a renderer applies that no rule mentions, which
       is a renamed selector or a typo and renders unstyled
     - a rule for a class nothing applies any more, which is what seven rules
       in this stylesheet had become after the workspace rewrite renamed
       .pwrap.code to .workspace and replaced the shop's .swatch

   Both are at zero tolerance. The deliberate exceptions are listed in the two
   arrays below, so adding one is a decision rather than a drifting threshold. */

section('classes and rules agree');

const sources = [read('index.html'), ...[
  'js/views.js', 'js/problem.js', 'js/editor.js', 'js/catalog.js', 'js/app.js',
  'js/highlight.js', 'js/md.js', 'js/lint.js',
  'js/types/registry.js', 'js/types/mcq.js', 'js/types/numeric.js',
  'js/types/order.js', 'js/types/match.js', 'js/types/predict.js',
  'js/types/locate.js', 'js/types/code.js',
].map(read)].join('\n');

/* Candidates come from the obvious forms; membership is then decided by plain
   containment in the other text. Parsing the renderers properly is not worth
   it — a class can be built by a ternary, a template literal or a lookup —
   and containment has no false positives in the direction that matters.

   The one thing containment cannot see is a name assembled at run time:
   `diff diff-${id}` produces .diff-advanced, which appears nowhere as a
   literal. So the prefixes that precede an interpolation or a concatenation
   are collected, and a styled class starting with one of those is taken as
   reachable. That keeps the check at zero tolerance without hand-listing
   every status and difficulty value. */

const appliedCandidates = new Set();
const prefixes = new Set();

for (const m of sources.matchAll(/class(?:Name)?\s*[:=]\s*(['"`])([^'"`]*)\1/g)) {
  const body = m[2];
  for (const name of body.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
    if (name && /^[a-z][\w-]*[a-z\d]$/i.test(name)) appliedCandidates.add(name);
  }
  /* The literal run immediately before each interpolation. */
  for (const part of body.split('${').slice(0, -1)) {
    const tail = /([\w-]+)$/.exec(part);
    if (tail) prefixes.add(tail[1]);
  }
}
for (const m of sources.matchAll(/classList\.(?:add|remove|toggle|contains)\((['"])([^'"]+)\1/g)) {
  appliedCandidates.add(m[2]);
}
/* `cls = 'hl-' + kind`, `' action-' + tone` — the leading space is part of the
   literal in the second one, so it is allowed for rather than assumed away. */
for (const m of sources.matchAll(/(['"])\s*([a-z][\w-]*-)\1\s*\+/gi)) prefixes.add(m[2]);
/* `cls = 'hl-comment'` — a bare literal that is plainly a class name. */
for (const m of sources.matchAll(/\bcls\s*=\s*(['"])([a-z][\w-]*)\1/gi)) {
  appliedCandidates.add(m[2]);
}

/* Every class a rule mentions. A file extension in a comment looks like a
   class selector, so a dot followed by a known extension is skipped. */
const EXTENSIONS = /^(css|mjs|js|json|html|md|sh|yml|yaml|py|txt|test)$/;
const styled = new Set();
for (const m of all.matchAll(/\.(-?[a-z][\w-]*)/gi)) {
  if (!EXTENSIONS.test(m[1])) styled.add(m[1]);
}

ok('classes were found in the markup and the renderers', appliedCandidates.size > 60);
ok('and the stylesheets define some', styled.size > 60);
ok('and some are assembled at run time', prefixes.size > 3);

/* Hooks a renderer applies purely so the tests and the JS can find a node.
   Listed rather than silently tolerated, so adding one is a decision. */
const UNSTYLED_HOOKS = [
  'locate-status',     /* where the locate type writes its verdict */
  'match-status',      /* the same, for match */
  'topic-chip-label',  /* the chip's text, styled by the chip itself */
  'predict-reveal',    /* marks the node reveal() adds so it can take it back
                          out again — it is a .case, and looks like one */
];

const unstyled = [...appliedCandidates]
  .filter(c => !all.includes(c))
  .filter(c => !UNSTYLED_HOOKS.includes(c))
  .sort();
if (unstyled.length) console.log(`  --    applied but never mentioned in the CSS: ${unstyled.join(', ')}`);
check('no class is applied without the CSS mentioning it', unstyled, []);

/* And the other way round: a rule for a name that appears nowhere in the
   markup or the renderers, and does not belong to a run-time family, is dead.
   Six rules here were, after the workspace rewrite renamed .pwrap.code. */
const unapplied = [...styled]
  .filter(c => !sources.includes(c))
  .filter(c => ![...prefixes].some(pre => c.startsWith(pre)))
  /* Produced by the markdown renderer rather than written in a renderer. */
  .filter(c => !['table-wrap'].includes(c))
  .sort();
if (unapplied.length) console.log(`  --    styled but never applied: ${unapplied.join(', ')}`);
check('no rule targets a class nothing applies', unapplied, []);

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

/* ---------------- the editor ----------------

   There used to be a long section here checking that a coloured <pre> and a
   transparent <textarea> declared identical font metrics, because the two
   layers had to agree to the fraction of a pixel or the text sat beside its
   own colour. That editor is gone: CodeMirror owns the inside of .ed now, as
   one scroll container with the gutter inside it.

   The point worth keeping is that the checks never caught the bugs. A
   stylesheet that passed every one of them still produced a caret in the
   wrong place, a scrollbar across the middle of the editor and line numbers
   that drifted. Those are measurements, and they are made in a real browser
   in tests/browser/journeys.test.mjs. What is checked here is only what CSS
   alone can settle: that the two-layer editor really is gone, and that the
   structural fixes are still in the stylesheet rather than having been
   reverted by a later tidy-up. */

section('the two-layer editor is gone');
ok('no highlight overlay is styled', !styles.includes('.ed-highlight'));
ok('the only .ed-input left is the fallback textarea',
  [...styles.matchAll(/\.ed-input/g)].every((_, i, all) => all.length <= 3)
  && !/\.ed-input\s*\{[^}]*color:\s*transparent/.test(styles));

section('the editor is bounded by grid rows, not percentage heights');
/* The measured failure: .ed grew to 1840px inside a 492px flex box, because a
   flex item with height:100% does not shrink below its content. A
   minmax(0, 1fr) grid row does. */
ok('the editor panel is a grid with a bounded row',
  /\.ws-editor\s*\{[^}]*grid-template-rows:\s*minmax\(0, ?1fr\)/.test(styles));
ok('and so is the widget inside it',
  /\.ws-editor \.widget\s*\{[^}]*minmax\(0, ?1fr\)/.test(styles));
ok('and the editor host inside that',
  /\.ws-editor \.ed-host\s*\{[^}]*minmax\(0, ?1fr\)/.test(styles));
ok('.ed itself does not force a height through the chain',
  /\.ws-editor \.ed\s*\{[^}]*min-height:\s*0/.test(styles));

section('the workspace owns the viewport without scrolling the page');
ok('the main column is sized to the viewport',
  /body\[data-workspace="true"\] \.main\s*\{[^}]*height:\s*calc\(100vh/.test(styles));
ok('and clips rather than letting the page scroll sideways',
  /body\[data-workspace="true"\] \.main\s*\{[^}]*overflow:\s*hidden/.test(styles));

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
/* The CodeMirror bundle defines window.CM and nothing reads it at load time,
   so it only has to be before js/editor.js. Of our own scripts, store.js is
   first: every other module reads Store at definition time. */
ok('the editor bundle loads before the editor', idx('vendor/codemirror.js') < idx('js/editor.js'));
ok('store is the first of our own scripts',
  srcs.filter(s2 => s2.startsWith('js/'))[0] === 'js/store.js');
ok('app loads last', idx('js/app.js') === srcs.length - 1);
ok('md loads before problem.js, which renders with it', idx('js/md.js') < idx('js/problem.js'));
ok('highlight loads before md, which calls into it', idx('js/highlight.js') < idx('js/md.js') + 2);

report('browser/styles');
