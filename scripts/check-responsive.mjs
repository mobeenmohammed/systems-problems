/* Mathematics in both themes, at eight widths and three root font sizes.

   What this is for: the responsive check in the usability suite sampled
   1440, 1024 and 390, and the whole site scrolled sideways by 148px at 768
   without anything failing. This one prints the numbers so a person can
   look at them, and it covers the maths pages, which are the ones with wide
   display equations and figures in them.

     BASE=https://mobeenmohammed.github.io/systems-problems BROWSER=msedge \
       node scripts/check-responsive.mjs

   SHOTS=1 writes screenshots into _shots/. */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHANNEL = process.env.BROWSER || null;
const SHOTS = process.env.SHOTS ? path.join(process.cwd(), '_shots') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  ['#/p/metric-three-metrics-compared', 'figure + wide equations'],
  ['#/p/prob-bayes-screening', 'exact answer + tree figure'],
  ['#/p/metric-limits-are-unique', 'guided proof steps'],
  ['#/p/metric-continuity-epsilon-delta', 'written proof'],
  ['#/problems', 'catalogue'],
];

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const problems = [];

/* A page-level sideways scroll is the defect. An SVG path reaching past its
   own <svg> is not: KaTeX draws its stretchy rules with a path in a
   viewBox 400000 units wide, clipped by the element it sits in. Measuring
   descendants rather than the document would report that as a fault. */
const measure = p => p.evaluate(() => {
  const scrolls = n => {
    for (let a = n.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  const spill = [...document.querySelectorAll('.statement *, .maths-answer *, .rubric *')]
    .filter(n => !scrolls(n) && !n.closest('svg')
      && n.getBoundingClientRect().right > window.innerWidth + 1)
    .map(n => `${n.tagName}.${n.className || '-'}`.slice(0, 40));
  const nav = document.querySelector('#nav');
  return {
    over: document.documentElement.scrollWidth - window.innerWidth,
    spill,
    katex: document.querySelectorAll('.katex').length,
    unrendered: document.querySelectorAll('.math-raw, .math-bad').length,
    navScroll: nav ? nav.scrollWidth - nav.clientWidth : 0,
    navReaches: nav
      ? nav.querySelector('a:last-child').getBoundingClientRect().right
        <= nav.getBoundingClientRect().right + 1
      : true,
    bg: getComputedStyle(document.body).backgroundColor,
  };
});

const row = (label, m) => {
  const bad = m.over > 2 || m.spill.length || m.unrendered
    || (m.navScroll <= 1 && !m.navReaches);
  if (bad) problems.push(`${label}: ${JSON.stringify(m)}`);
  console.log(`  ${bad ? 'XX' : 'ok'}  ${label.padEnd(52)}`
    + `over=${String(m.over).padStart(4)}  katex=${String(m.katex).padStart(3)}`
    + `  raw=${m.unrendered}  navScroll=${String(m.navScroll).padStart(4)}`
    + (m.spill.length ? `  SPILL ${m.spill.join(', ')}` : ''));
};

for (const theme of ['theme-dark', 'theme-paper']) {
  console.log(`\n== ${theme} ==`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(t => localStorage.setItem('systems-lab/state/v1',
    JSON.stringify({ equipped: { theme: t } })), theme);
  const p = await ctx.newPage();
  for (const [hash, what] of PAGES) {
    await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1400);
    row(`${what}`, await measure(p));
    if (SHOTS && hash.includes('three-metrics')) {
      await p.screenshot({ path: path.join(SHOTS, `responsive-${theme}.png`) });
    }
  }
  await ctx.close();
}

console.log('\n== widths (dark) ==');
for (const w of [1440, 1100, 1024, 900, 820, 768, 700, 640, 390, 320]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 } });
  for (const [hash, what] of PAGES) {
    await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);
    row(`${String(w).padStart(4)}px  ${what}`, await measure(p));
  }
  if (SHOTS && w === 390) {
    await p.goto(`${BASE}/#/p/metric-three-metrics-compared`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(SHOTS, 'responsive-390.png') });
  }
  await p.close();
}

/* A browser set to a larger font is not the same thing as a narrow window,
   and no pixel breakpoint can see it. */
console.log('\n== root font size, at 1100px ==');
for (const size of [15, 19, 22, 26]) {
  const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await p.goto(`${BASE}/#/p/prob-bayes-screening`, { waitUntil: 'networkidle' });
  await p.evaluate(n => { document.documentElement.style.fontSize = `${n}px`; }, size);
  await p.waitForTimeout(900);
  row(`${size}px root font`, await measure(p));
  await p.close();
}

console.log(problems.length
  ? `\n  ${problems.length} problem(s):\n    ${problems.join('\n    ')}\n`
  : '\n  no sideways scroll, no unrendered maths, every view link reachable\n');
await browser.close();
process.exit(problems.length ? 1 : 0);
