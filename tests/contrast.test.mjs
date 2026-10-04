/* Text contrast, for every theme.

   The shop sells eight themes and each redefines the same token set. A theme
   whose --text-dim lands at 3:1 on its own background is not a style choice,
   it is unreadable body text — and it is invisible in review because you have
   to buy the theme to see it.

   So the token blocks are parsed straight out of the CSS and every text
   colour is checked against the surfaces it is actually used on, at the WCAG
   2.1 AA thresholds: 4.5:1 for body text, 3:1 for large text and for UI
   elements that have to be distinguishable.

   Run: node tests/contrast.test.mjs */

import { readFileSync } from 'node:fs';
import { section, check, ok, report } from './harness.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const base = read('css/styles.css');
const themes = read('css/themes.css');

/* ---------------- colour maths ---------------- */

function parseColor(raw) {
  const s = String(raw).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split('').map(c => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) return [1, 2, 3].map(i => Number(m[i]));
  return null;
}

const channel = v => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------- pull the token blocks out of the CSS ---------------- */

/* Only the plain `:root { ... }` block in styles.css, not the accent or
   media-query overrides, and one block per html[data-theme="..."]. */
function tokensFrom(css, selector) {
  /* The selector may now be part of a group — ":root, [data-theme-preview=…]"
     — so the block is located by its first selector and the next brace. */
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const out = {};
  /* Comments come first: the token blocks are grouped under /* ... *​/ headings,
     and a comment sitting between a ";" and the next token would otherwise
     swallow that token. */
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of body.split(';')) {
    const m = /^\s*(--[\w-]+)\s*:\s*([^;]+)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const defaults = tokensFrom(base, ':root,');
ok('the default token block parsed', defaults && Object.keys(defaults).length > 20);

const themeNames = [...themes.matchAll(/html\[data-theme="([\w-]+)"\]\s*,/g)].map(m => m[1]);
ok('every shop theme has a token block', themeNames.length >= 7);

/* A theme only overrides what it changes, so fall back to the defaults. */
const themeTokens = {};
for (const name of themeNames) {
  themeTokens[name] = { ...defaults, ...tokensFrom(themes, `html[data-theme="${name}"],`) };
}
/* The default look is itself a theme on the page, under theme-dark. */
if (!themeTokens['theme-dark']) themeTokens['theme-dark'] = { ...defaults };

/* ---------------- the pairs that have to be legible ----------------

   Each entry is a text token, the surface it sits on, and the threshold.
   --text-faint is deliberately held to the 3:1 large-text/UI floor: it is
   used for timestamps and one-line asides, never for a paragraph. */
const PAIRS = [
  ['--text',       '--bg',        4.5, 'body text on the page'],
  ['--text',       '--bg-elev',   4.5, 'body text on a card'],
  ['--text',       '--bg-elev-2', 4.5, 'body text on a raised card'],
  ['--text-dim',   '--bg',        4.5, 'secondary text on the page'],
  ['--text-dim',   '--bg-elev',   4.5, 'secondary text on a card'],
  ['--text-dim',   '--bg-elev-2', 4.5, 'secondary text on a raised card'],
  ['--text-faint', '--bg',        3.0, 'faint text on the page'],
  ['--text-faint', '--bg-elev',   3.0, 'faint text on a card'],
  ['--accent',     '--bg',        3.0, 'a link on the page'],
  ['--accent',     '--bg-elev',   3.0, 'a link on a card'],
  ['--ok',         '--bg-elev',   3.0, 'a success marker'],
  ['--warn',       '--bg-elev',   3.0, 'a warning marker'],
  ['--danger',     '--bg-elev',   3.0, 'an error marker'],
];

/* Syntax colours sit on --bg-inset, the code-block fill. These are read as
   text, not as indicators - and in this project a code comment is often the
   line carrying the lesson - so they are held to the body-text threshold. */
const SYNTAX = [
  '--hl-keyword', '--hl-type', '--hl-string', '--hl-comment',
  '--hl-num', '--hl-fn', '--hl-literal', '--hl-preproc',
];

/* Difficulty and status colours are read as dots next to their own label, so
   they only need to be visible, not readable. */
const UI_ONLY = [
  '--diff-beginner', '--diff-intermediate', '--diff-advanced',
  '--st-attempted', '--st-solved', '--st-read', '--st-unsolved',
];

for (const [name, tokens] of Object.entries(themeTokens)) {
  section(name);
  const tag = t => `${name}: ${t}`;

  for (const [fg, bg, want, what] of PAIRS) {
    const a = parseColor(tokens[fg]);
    const b = parseColor(tokens[bg]);
    if (!a || !b) { ok(tag(`${fg} and ${bg} are both defined`), false); continue; }
    const got = ratio(a, b);
    ok(tag(`${what}: ${got.toFixed(2)}:1 >= ${want}:1  (${fg} on ${bg})`), got >= want);
  }

  for (const fg of UI_ONLY) {
    const a = parseColor(tokens[fg]);
    const b = parseColor(tokens['--bg-elev']);
    if (!a || !b) { ok(tag(`${fg} is defined`), false); continue; }
    const got = ratio(a, b);
    ok(tag(`${fg} is distinguishable: ${got.toFixed(2)}:1 >= 3:1`), got >= 3.0);
  }

  for (const fg of SYNTAX) {
    const a = parseColor(tokens[fg]);
    const b = parseColor(tokens['--bg-inset']);
    if (!a || !b) { ok(tag(`${fg} is defined`), false); continue; }
    const got = ratio(a, b);
    ok(tag(`${fg} is readable in a code block: ${got.toFixed(2)}:1 >= 4.5:1`), got >= 4.5);
  }

  /* Text on the accent itself — buttons, which are the one place a colour is
     load-bearing for a word rather than for a dot. */
  const onAccent = parseColor(tokens['--accent-text']);
  const accent = parseColor(tokens['--accent']);
  if (onAccent && accent) {
    const got = ratio(onAccent, accent);
    ok(tag(`button label on the accent: ${got.toFixed(2)}:1 >= 4.5:1`), got >= 4.5);
  }
}

/* An accent is worn on top of a theme, so the pair is what a reader sees and
   the pair is what has to be legible — every combination the shop can produce,
   not just the two defaults. A theme may override an accent for itself, which
   is how the light theme avoids 1.6:1 links; the more specific rule wins in
   the browser and wins here. */
section('every theme and accent the shop can combine');

function blocksFor(css, re) {
  const out = {};
  for (const m of css.matchAll(re)) {
    const body = m[2].replace(/\/\*[\s\S]*?\*\//g, '');
    const row = {};
    for (const part of body.split(';')) {
      const kv = /^\s*(--[\w-]+)\s*:\s*([^;]+)$/.exec(part);
      if (kv) row[kv[1]] = kv[2].trim();
    }
    out[m[1]] = row;
  }
  return out;
}

/* The base overrides in styles.css, plus any per-theme refinement. */
const accentBase = blocksFor(base, /\[data-accent="([\w-]+)"\]\s*\{([^}]*)\}/g);
accentBase['accent-default'] = accentBase['accent-default'] || {};
ok('the accent overrides parsed', Object.keys(accentBase).length >= 4);

const perTheme = {};
for (const m of themes.matchAll(/html\[data-theme="([\w-]+)"\]\[data-accent="([\w-]+)"\]\s*\{([^}]*)\}/g)) {
  const row = {};
  for (const part of m[3].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const kv = /^\s*(--[\w-]+)\s*:\s*([^;]+)$/.exec(part);
    if (kv) row[kv[1]] = kv[2].trim();
  }
  (perTheme[m[1]] = perTheme[m[1]] || {})[m[2]] = row;
}

for (const [themeName, tokens] of Object.entries(themeTokens)) {
  for (const accentName of Object.keys(accentBase)) {
    const resolved = {
      ...tokens,
      ...accentBase[accentName],
      ...((perTheme[themeName] || {})[accentName] || {}),
    };
    const accent = parseColor(resolved['--accent']);
    const onAccent = parseColor(resolved['--accent-text']);
    const where = `${themeName} + ${accentName}`;

    if (!accent) { ok(`${where}: --accent resolves`, false); continue; }

    for (const surface of ['--bg', '--bg-elev']) {
      const bg = parseColor(resolved[surface]);
      if (!bg) { ok(`${where}: ${surface} resolves`, false); continue; }
      const got = ratio(accent, bg);
      ok(`${where}: link on ${surface} ${got.toFixed(2)}:1 >= 3:1`, got >= 3.0);
    }

    if (onAccent) {
      const got = ratio(onAccent, accent);
      ok(`${where}: button label ${got.toFixed(2)}:1 >= 4.5:1`, got >= 4.5);
    } else {
      ok(`${where}: --accent-text resolves`, false);
    }
  }
}

check('the maths agrees with a known pair (black on white)',
  Math.round(ratio([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);

report('contrast');
