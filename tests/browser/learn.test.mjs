/* Learn: tracks as prerequisite trees, and what a node is for.

   The claim being tested is not "a tree renders". It is that the tree is
   derived from the concept graph rather than written down, that it puts
   prerequisites above the things that need them, that it does not quietly
   drop the edges that make it a DAG rather than a tree, and that a node
   answers both halves of "what do I read for this, and what can I then do
   with it".

   Needs the site served:   npm run serve
   Run: node tests/browser/learn.test.mjs
        SHOTS=1 node tests/browser/learn.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { section, check, ok, report } from '../harness.mjs';

const CHANNEL = process.env.BROWSER || null;
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not being served at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const open = async (hash, wait = 1000) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* ---------------- the index ---------------- */

section('Learn lists every track, both subjects');
await open('#/learn');
{
  const m = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('.learn-group-head')].map(h => h.textContent),
    cards: document.querySelectorAll('#learnTracks .track-card').length,
    all: window.SystemsLab.Catalog.allTracks().length,
    nav: (document.querySelector('#nav a[aria-current]') || {}).textContent,
    gone: document.querySelectorAll('#nav a[data-route="tracks"], #nav a[data-route="concepts"]').length,
    toConcepts: !!document.querySelector('#learnIndex a[href="#/concepts"]'),
  }));
  check('every track has a card', m.cards, m.all);
  ok(`and there are eleven of them (${m.cards})`, m.cards === 11);
  ok('grouped by subject', m.groups.includes('Systems') && m.groups.includes('Mathematics'));
  check('the Learn tab is the current one', m.nav, 'Learn');
  check('Tracks and Reading are no longer their own tabs', m.gone, 0);
  ok('the whole concept index is still one link away', m.toConcepts);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'learn-index.png') });
}

/* ---------------- the tree ---------------- */

section('a track is a tree of what it rests on');
await open('#/learn/metric-spaces');
{
  const m = await page.evaluate(() => {
    const tree = window.SystemsLab.Catalog.trackTree('metric-spaces');
    /* Depth measured from the DOM, so this checks the rendering and not
       just the data behind it. */
    const depthOf = el => {
      let d = 0;
      for (let n = el.parentElement; n; n = n.parentElement) {
        if (n.classList && n.classList.contains('tkids')) d += 1;
      }
      return d;
    };
    const nodes = [...document.querySelectorAll('.tnode')];
    return {
      count: nodes.length,
      size: tree.size,
      roots: tree.roots.length,
      names: nodes.map(n => n.querySelector('.tnode-name').textContent),
      depths: Object.fromEntries(nodes.map(n =>
        [n.querySelector('.tnode-name').textContent, depthOf(n.closest('li'))])),
      lists: document.querySelectorAll('#learnTreeHost ul').length,
    };
  });
  check('every concept the track rests on is a node', m.count, m.size);
  ok(`twelve of them, from one root (${m.count})`, m.count === 12 && m.roots === 1);
  ok('it is nested lists, so the nesting is real to a screen reader', m.lists > 1);

  /* The ordering claim, stated as prerequisites rather than as pixels. */
  ok('the axioms are the root', m.depths['The metric axioms'] === 0);
  ok('balls come after the axioms',
    m.depths['Open balls'] > m.depths['The metric axioms']);
  ok('open sets come after balls',
    m.depths['Open sets'] > m.depths['Open balls']);
  ok('closed sets come after open sets',
    m.depths['Closed sets'] > m.depths['Open sets']);
  ok('completeness comes after Cauchy sequences',
    m.depths.Completeness > m.depths['Cauchy sequences']);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'learn-tree.png') });
}

section('every node sits below everything it needs');
{
  /* The whole point of the layout, checked across all eleven tracks
     rather than the one that happens to be on screen. */
  const bad = await page.evaluate(() => {
    const C = window.SystemsLab.Catalog;
    const out = [];
    for (const t of C.allTracks()) {
      const tree = C.trackTree(t.id);
      const depth = {};
      (function walk(ns, d) {
        for (const n of ns) { depth[n.id] = d; walk(n.children, d + 1); }
      })(tree.roots, 0);
      for (const id of Object.keys(depth)) {
        const c = C.concept(id) || {};
        for (const need of c.needs || []) {
          if (depth[need] === undefined) continue;
          if (depth[need] >= depth[id]) out.push(`${t.id}: ${id} is not below ${need}`);
        }
      }
    }
    return out;
  });
  ok(`no node is drawn above one of its prerequisites${bad.length ? `: ${bad[0]}` : ''}`,
    bad.length === 0);
}

section('the edges that make it a graph are shown, not dropped');
await open('#/learn/metric-spaces/compactness');
{
  const m = await page.evaluate(() => {
    const C = window.SystemsLab.Catalog;
    const needs = (C.concept('compactness') || {}).needs || [];
    const note = [...document.querySelectorAll('#learnNodeHost p')]
      .map(p => p.textContent).find(t => /Also rests on/.test(t)) || '';
    return {
      needs: needs.length,
      note,
      links: [...document.querySelectorAll('#learnNodeHost a[href^="#/learn/"]')].length,
      drawnOnce: document.querySelectorAll('.tnode[data-concept="compactness"]').length,
    };
  });
  ok(`compactness really does rest on more than one thing (${m.needs})`, m.needs > 1);
  ok(`so the node says so ("${m.note.slice(0, 60)}…")`, /Also rests on/.test(m.note));
  ok('and the extra prerequisites are links to their own nodes', m.links >= 1);
  check('while the node itself is still drawn exactly once', m.drawnOnce, 1);
}

/* ---------------- what a node is for ---------------- */

section('a node answers what to read and what to try');
await open('#/learn/metric-spaces');
{
  const m = await page.evaluate(() => ({
    picked: (document.querySelector('.tnode.on .tnode-name') || {}).textContent,
    head: (document.querySelector('.lnode-head h2') || {}).textContent,
    oneLine: (document.querySelector('#learnNodeHost p.muted') || {}).textContent || '',
    readings: document.querySelectorAll('#learnNodeHost .reading').length,
    problems: document.querySelectorAll('#learnNodeHost .prow').length,
    subs: [...document.querySelectorAll('.lnode-sub')].map(h => h.textContent),
    links: [...document.querySelectorAll('#learnNodeHost .prow a[href^="#/p/"]')].length,
  }));
  ok('a node is picked for you rather than leaving an empty panel', !!m.head);
  check('and it is the one highlighted in the tree', m.head, m.picked);
  ok('it says what the concept is', m.oneLine.length > 40);
  ok(`it lists what to read (${m.readings})`, m.readings >= 2);
  ok(`and what to try (${m.problems})`, m.problems >= 2);
  ok('under headings that say which is which',
    m.subs.includes('Read') && m.subs.includes('Then try'));
  ok('every problem is a link to the problem', m.links === m.problems);
}

section('the problems really are the ones that rest on that concept');
{
  const m = await page.evaluate(() => {
    const C = window.SystemsLab.Catalog;
    const shown = [...document.querySelectorAll('#learnNodeHost .prow a[href^="#/p/"]')]
      .map(a => a.getAttribute('href').replace('#/p/', ''));
    const expect = C.problemsForConcept('metric-axioms').map(p => p.id);
    return { shown, expect, missing: expect.filter(id => !shown.includes(id)) };
  });
  ok(`all ${m.expect.length} of them are listed`, m.missing.length === 0);
  ok('and nothing else is', m.shown.every(id => m.expect.includes(id)));
}

section('picking a node is a link you can share');
{
  await page.locator('.tnode', { hasText: 'Completeness' }).click();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    head: (document.querySelector('.lnode-head h2') || {}).textContent,
  }));
  check('the address names the node', after.hash, '#/learn/metric-spaces/completeness');
  check('and the panel followed', after.head, 'Completeness');

  /* Straight to it, cold, in a new page load. */
  await open('#/learn/metric-spaces/cauchy-sequences');
  const cold = await page.evaluate(() => ({
    head: (document.querySelector('.lnode-head h2') || {}).textContent,
    on: (document.querySelector('.tnode.on .tnode-name') || {}).textContent,
  }));
  check('opening that address directly works too', cold.head, 'Cauchy sequences');
  check('with the tree showing where you are', cold.on, 'Cauchy sequences');
}

section('an id nobody has heard of lands on the list, not an empty frame');
await open('#/learn/no-such-track');
{
  const m = await page.evaluate(() => ({
    index: !document.getElementById('learnIndex').hidden,
    detail: !document.getElementById('learnTrack').hidden,
    cards: document.querySelectorAll('#learnTracks .track-card').length,
  }));
  ok('the track list is showing', m.index && m.cards > 0);
  ok('and the empty detail pane is not', !m.detail);
}

/* ---------------- it is the same progress ---------------- */

section('ticking a reading here is ticking it everywhere');
await open('#/learn/probability-foundations/bayes');
{
  const before = await page.evaluate(() =>
    window.SystemsLab.Catalog.readProgress('bayes').read);
  await page.locator('#learnNodeHost .reading input').first().check();
  await page.waitForTimeout(600);

  const m = await page.evaluate(() => ({
    stored: window.SystemsLab.Catalog.readProgress('bayes').read,
    counts: (document.querySelector('.tnode.on .tnode-counts') || {}).textContent,
  }));
  ok(`the store took it (${before} -> ${m.stored})`, m.stored === before + 1);
  ok('and the tree counts moved with it', /1\/\d+ read/.test(m.counts));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  const after = await page.evaluate(() => ({
    checked: document.querySelectorAll('#learnNodeHost .reading input:checked').length,
    onConcepts: null,
  }));
  ok('it survives a reload', after.checked >= 1);

  /* The old reading map is the same data, so it has to agree. */
  await open('#/concepts');
  const agrees = await page.evaluate(() =>
    window.SystemsLab.Catalog.readProgress('bayes').read);
  ok('and the concept index agrees', agrees >= 1);

  /* Put it back, so a re-run starts where it started. */
  await open('#/learn/probability-foundations/bayes');
  await page.locator('#learnNodeHost .reading input').first().uncheck();
  await page.waitForTimeout(400);
}

/* ---------------- the links that used to exist ---------------- */

section('older addresses still land somewhere sensible');
{
  for (const [from, expect] of [
    ['#/tracks', 'view-learn'],
    ['#/tracks/memory', 'view-tracks'],
    ['#/concepts', 'view-concepts'],
  ]) {
    await open(from, 800);
    const m = await page.evaluate(() => ({
      view: [...document.querySelectorAll('.view')].find(v => !v.hidden).id,
      nav: (document.querySelector('#nav a[aria-current]') || {}).textContent,
    }));
    check(`${from} shows ${expect}`, m.view, expect);
    check(`${from} keeps the Learn tab lit`, m.nav, 'Learn');
  }
}

/* ---------------- narrow ---------------- */

section('it stacks rather than squeezing');
for (const w of [1024, 900, 768, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await open('#/learn/systems-simulations/page-replacement', 900);
  const m = await page.evaluate(() => {
    const tree = document.getElementById('learnTreeHost').getBoundingClientRect();
    const node = document.getElementById('learnNodeHost').getBoundingClientRect();
    return {
      over: document.documentElement.scrollWidth - window.innerWidth,
      stacked: node.top >= tree.bottom - 1,
      treeVisible: tree.width > 100,
      nodeVisible: node.width > 100,
    };
  });
  ok(`${w}px: the page does not scroll sideways (${m.over}px)`, m.over <= 2);
  ok(`${w}px: both panes are usable`, m.treeVisible && m.nodeVisible);
  if (w <= 900) ok(`${w}px: and they stack`, m.stacked);
}
await page.setViewportSize({ width: 1500, height: 1100 });

section('no uncaught errors');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 200)}` : 'none', errors.length === 0);

await browser.close();
report('browser/learn');
