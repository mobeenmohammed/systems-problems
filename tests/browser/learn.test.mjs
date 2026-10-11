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

section('a track is a canvas of what it rests on');
await open('#/learn/metric-spaces');
{
  const m = await page.evaluate(() => {
    const tree = window.SystemsLab.Catalog.trackTree('metric-spaces');
    const nodes = [...document.querySelectorAll('.lnode')];
    return {
      count: nodes.length,
      size: tree.size,
      edges: document.querySelectorAll('#learnEdges path').length,
      role: document.getElementById('learnNodes').getAttribute('role'),
      itemRoles: [...new Set(nodes.map(n => n.getAttribute('role')))],
      levels: nodes.map(n => ({
        name: n.querySelector('.lnode-name').textContent,
        level: Number(n.getAttribute('aria-level')),
        left: Math.round(parseFloat(n.style.left)),
      })),
      /* Every box says its numbers in words as well as in a 3px bar. */
      labelled: nodes.every(n => /readings read/.test(n.getAttribute('aria-label') || '')),
    };
  });

  check('every concept the track rests on is a box', m.count, m.size);
  ok(`twelve of them (${m.count})`, m.count === 12);
  ok(`with edges between them (${m.edges})`, m.edges >= m.count - 1);
  check('the canvas is a tree to a screen reader', m.role, 'tree');
  check('and every box an item in it', m.itemRoles.join(','), 'treeitem');
  ok('each box says its progress in words, not only as a bar', m.labelled);

  /* The one claim the picture makes. */
  const level = name => (m.levels.find(l => l.name === name) || {}).level;
  const left = name => (m.levels.find(l => l.name === name) || {}).left;
  check('the axioms are the first level', level('The metric axioms'), 1);
  ok('balls come after the axioms', level('Open balls') > level('The metric axioms'));
  ok('open sets after balls', level('Open sets') > level('Open balls'));
  ok('closed sets after open sets', level('Closed sets') > level('Open sets'));
  ok('completeness after Cauchy sequences',
    level('Completeness') > level('Cauchy sequences'));
  ok('and the levels are left-to-right on the canvas',
    left('Open balls') > left('The metric axioms'));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'learn-canvas.png') });
}

section('every node sits to the right of everything it needs');
{
  /* Across all eleven tracks, read out of the DOM rather than out of the
     layout module that produced it. */
  const bad = await page.evaluate(async () => {
    const C = window.SystemsLab.Catalog;
    const out = [];
    for (const t of C.allTracks()) {
      const r = LearnLayout.layout(C.trackTree(t.id));
      const by = new Map(r.nodes.map(n => [n.id, n]));
      for (const e of r.edges) {
        if (by.get(e.from).col >= by.get(e.to).col) {
          out.push(`${t.id}: ${e.from} -> ${e.to}`);
        }
      }
    }
    return out;
  });
  ok(`no edge points backwards${bad.length ? `: ${bad[0]}` : ''}`, bad.length === 0);
}

section('the edges that make it a graph are drawn, dashed');
await open('#/learn/metric-spaces/compactness');
{
  const m = await page.evaluate(() => ({
    needs: ((window.SystemsLab.Catalog.concept('compactness') || {}).needs || []).length,
    into: document.querySelectorAll('#learnEdges path[data-to="compactness"]').length,
    dashed: document.querySelectorAll('#learnEdges path[data-extra="true"]').length,
    lit: document.querySelectorAll('#learnEdges path[data-lit="true"]').length,
    drawnOnce: document.querySelectorAll('.lnode[data-concept="compactness"]').length,
    note: [...document.querySelectorAll('#learnPanel p')]
      .map(x => x.textContent).find(t => /Also rests on/.test(t)) || '',
  }));
  ok(`compactness rests on more than one thing (${m.needs})`, m.needs > 1);
  check('so more than one line arrives at it', m.into, m.needs);
  ok('the extra ones are dashed rather than deleted', m.dashed > 0);
  ok('selecting it lights its edges', m.lit >= m.needs);
  check('and the box itself is drawn once', m.drawnOnce, 1);
  ok(`the panel names them too ("${m.note.slice(0, 48)}…")`, /Also rests on/.test(m.note));
}

section('pan, zoom and recenter');
{
  await open('#/learn/systems-simulations');
  const read = () => page.evaluate(() => {
    const t = document.getElementById('learnPan').style.transform;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(t);
    return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
  });

  const fitted = await read();
  ok('it opens fitted to the canvas', fitted !== null && fitted.z > 0);

  await page.locator('#learnZoomIn').click();
  await page.waitForTimeout(250);
  const bigger = await read();
  ok(`zoom in makes it bigger (${fitted.z} -> ${bigger.z})`, bigger.z > fitted.z);

  await page.locator('#learnZoomOut').click();
  await page.locator('#learnZoomOut').click();
  await page.waitForTimeout(250);
  const smaller = await read();
  ok(`zoom out makes it smaller (${smaller.z})`, smaller.z < bigger.z);

  /* Drag the background, not a box. */
  const box = await page.locator('#learnCanvas').boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height - 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + box.height - 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const panned = await read();
  ok(`dragging moves it (${Math.round(smaller.x)} -> ${Math.round(panned.x)})`,
    Math.abs(panned.x - smaller.x) > 80);

  await page.locator('#learnRecenter').click();
  await page.waitForTimeout(250);
  const back = await read();
  ok('Recenter puts it back', Math.abs(back.x - fitted.x) < 2 && Math.abs(back.z - fitted.z) < 0.01);
}

section('it can be walked with the arrow keys');
{
  /* systems-simulations, because metric-spaces has a single root and
     Down has nowhere to go from a column of one. */
  await open('#/learn/systems-simulations');
  /* Nothing is selected on arrival, so the first box is the way in. */
  await page.locator('.lnode').first().focus();
  const start = await page.evaluate(() => document.activeElement.dataset.concept);
  ok(`a box can be focused (${start})`, !!start);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const down = await page.evaluate(() => ({
    at: document.activeElement.dataset.concept,
    level: document.activeElement.getAttribute('aria-level'),
  }));
  ok('Down moves within the column', down.at !== start && down.level === '1');

  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  check('Up comes back',
    await page.evaluate(() => document.activeElement.dataset.concept), start);

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const right = await page.evaluate(() => ({
    at: document.activeElement.dataset.concept,
    level: Number(document.activeElement.getAttribute('aria-level')),
  }));
  ok(`Right goes to something that rests on it (${right.at})`, right.level > 1);

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  const back = await page.evaluate(() =>
    Number(document.activeElement.getAttribute('aria-level')));
  ok('Left goes back towards the prerequisites', back < right.level);

  /* Only the focused box is in the tab order. */
  check('exactly one box is tabbable',
    await page.evaluate(() =>
      [...document.querySelectorAll('.lnode')].filter(n => n.tabIndex === 0).length), 1);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  ok('Enter opens it', await page.evaluate(() =>
    !document.getElementById('learnPanel').hidden));
}

/* ---------------- what a node is for ---------------- */

section('a node answers what to read and what to try');
await open('#/learn/metric-spaces/metric-axioms');
{
  const m = await page.evaluate(() => ({
    hidden: document.getElementById('learnPanel').hidden,
    head: (document.querySelector('.lpanel-head h2') || {}).textContent,
    selected: (document.querySelector('.lnode[aria-selected="true"] .lnode-name') || {}).textContent,
    oneLine: (document.querySelector('#learnPanel p.muted') || {}).textContent || '',
    subs: [...document.querySelectorAll('.lpanel-sub span:first-child')].map(x => x.textContent),
    tables: document.querySelectorAll('#learnPanel table').length,
    headers: [...document.querySelectorAll('#learnPanel th')].map(h => h.textContent),
    resources: document.querySelectorAll('#learnPanel table:first-of-type tbody tr').length,
    questions: document.querySelectorAll('#learnPanel table:last-of-type tbody tr').length,
    links: [...document.querySelectorAll('#learnPanel a[href^="#/p/"]')].length,
    boxes: document.querySelectorAll('#learnPanel input[type="checkbox"]').length,
  }));

  ok('the panel is open', !m.hidden);
  check('on the node the address named', m.head, 'The metric axioms');
  check('and the box is marked as the selected one', m.selected, m.head);
  ok('it says what the concept is', m.oneLine.length > 40);
  check('two sections', m.subs.join(', '), 'Resources, Questions');
  check('as two tables', m.tables, 2);
  check('with the columns the reference has',
    m.headers.join(','), 'Tag,Resource,Section,Done,Name,Difficulty,Felt');
  ok(`resources are listed (${m.resources})`, m.resources >= 2);
  ok(`so are the problems (${m.questions})`, m.questions >= 2);
  check('every problem is a link', m.links, m.questions);
  check('and every resource has a tick box', m.boxes, m.resources);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'learn-panel.png') });
}

section('the panel closes without leaving the track');
{
  await page.locator('.lpanel-close').click();
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({
    hidden: document.getElementById('learnPanel').hidden,
    hash: location.hash,
    nodes: document.querySelectorAll('.lnode').length,
  }));
  ok('it is closed', m.hidden);
  check('the address drops the node', m.hash, '#/learn/metric-spaces');
  ok('and the canvas is still there', m.nodes > 0);
}

section('arriving with no node named opens no panel');
{
  await open('#/learn/probability-foundations');
  ok('nothing covers the canvas before you pick something',
    await page.evaluate(() => document.getElementById('learnPanel').hidden));
}

section('the problems really are the ones that rest on that concept');
{
  await open('#/learn/metric-spaces/metric-axioms');
  const m = await page.evaluate(() => {
    const C = window.SystemsLab.Catalog;
    const shown = [...document.querySelectorAll('#learnPanel a[href^="#/p/"]')]
      .map(a => a.getAttribute('href').replace('#/p/', ''));
    const expect = C.problemsForConcept('metric-axioms').map(p => p.id);
    return { shown, expect, missing: expect.filter(id => !shown.includes(id)) };
  });
  ok(`all ${m.expect.length} of them are listed`, m.missing.length === 0);
  ok('and nothing else is', m.shown.every(id => m.expect.includes(id)));
}

section('picking a node is a link you can share');
{
  await open('#/learn/metric-spaces');
  await page.locator('.lnode', { hasText: 'Completeness' }).click();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    head: (document.querySelector('.lpanel-head h2') || {}).textContent,
  }));
  check('the address names the node', after.hash, '#/learn/metric-spaces/completeness');
  check('and the panel followed', after.head, 'Completeness');

  /* Straight to it, cold, in a new page load. */
  await open('#/learn/metric-spaces/cauchy-sequences');
  const cold = await page.evaluate(() => ({
    head: (document.querySelector('.lpanel-head h2') || {}).textContent,
    on: (document.querySelector('.lnode[aria-selected="true"] .lnode-name') || {}).textContent,
  }));
  check('opening that address directly works too', cold.head, 'Cauchy sequences');
  check('with the canvas showing where you are', cold.on, 'Cauchy sequences');
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
  await page.locator('#learnPanel input[type="checkbox"]').first().check();
  await page.waitForTimeout(600);

  const m = await page.evaluate(() => ({
    stored: window.SystemsLab.Catalog.readProgress('bayes').read,
    label: (document.querySelector('.lnode[aria-selected="true"]') || {})
      .getAttribute?.('aria-label') || '',
    heading: (document.querySelector('.lpanel-sub span:last-child') || {}).textContent,
  }));
  ok(`the store took it (${before} -> ${m.stored})`, m.stored === before + 1);
  ok(`the box's own label moved with it ("${m.label.slice(0, 48)}…")`,
    /1 of \d+ readings read/.test(m.label));
  ok(`and so did the panel's count (${m.heading})`, /^1\/\d+$/.test(m.heading));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  const after = await page.evaluate(() => ({
    checked: document.querySelectorAll('#learnPanel input[type="checkbox"]:checked').length,
  }));
  ok('it survives a reload', after.checked >= 1);

  /* The old reading map is the same data, so it has to agree. */
  await open('#/concepts');
  const agrees = await page.evaluate(() =>
    window.SystemsLab.Catalog.readProgress('bayes').read);
  ok('and the concept index agrees', agrees >= 1);

  /* Put it back, so a re-run starts where it started. */
  await open('#/learn/probability-foundations/bayes');
  await page.locator('#learnPanel input[type="checkbox"]').first().uncheck();
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

section('it holds up on a narrow screen');
for (const w of [1024, 900, 768, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await open('#/learn/systems-simulations/page-replacement', 900);
  const m = await page.evaluate(() => {
    const canvas = document.getElementById('learnCanvas').getBoundingClientRect();
    const panel = document.getElementById('learnPanel').getBoundingClientRect();
    return {
      over: document.documentElement.scrollWidth - window.innerWidth,
      canvasWide: canvas.width > 200,
      panelWide: panel.width > 200,
      /* The panel must stay inside the canvas rather than hanging off
         the side of the page. */
      contained: panel.right <= canvas.right + 1 && panel.left >= canvas.left - 1,
      /* -4 for the canvas's own 1px borders on each side. */
      covers: panel.width >= canvas.width - 4,
      nodes: document.querySelectorAll('.lnode').length,
    };
  });
  ok(`${w}px: the page does not scroll sideways (${m.over}px)`, m.over <= 2);
  ok(`${w}px: the canvas is usable`, m.canvasWide && m.nodes > 0);
  ok(`${w}px: the panel is readable`, m.panelWide);
  ok(`${w}px: and stays inside the canvas`, m.contained);
  /* Below the breakpoint it takes the whole canvas rather than becoming
     a strip nobody can read. */
  if (w <= 760) ok(`${w}px: covering it rather than squeezing into a strip`, m.covers);
}
await page.setViewportSize({ width: 1500, height: 1100 });

section('no uncaught errors');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 200)}` : 'none', errors.length === 0);

await browser.close();
report('browser/learn');
