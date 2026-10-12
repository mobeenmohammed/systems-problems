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
    nav: ((document.querySelector('.navmenu-item[aria-current] .navmenu-title')
      || {}).childNodes || [{}])[0].textContent,
    /* They are entries in the Content menu now rather than tabs in the
       bar, so what used to be "no tab of their own" is "no bare link". */
    gone: document.querySelectorAll('#nav > a').length,
    toConcepts: !!document.querySelector('#learnIndex a[href="#/concepts"]'),
  }));
  check('every track has a card', m.cards, m.all);
  ok(`and there are eleven of them (${m.cards})`, m.cards === 11);
  ok('grouped by subject', m.groups.includes('Systems') && m.groups.includes('Mathematics'));
  check('Learn is the entry marked as the page you are on', m.nav.trim(), 'Learn');
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
      /* Every box says its numbers in words as well as in a 3px bar,
         and says solves and readings as two separate facts. */
      labelled: nodes.every(n => {
        const l = n.getAttribute('aria-label') || '';
        return /problems solved/.test(l) && /readings ticked/.test(l);
      }),
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

  const opened = await read();
  /* Not fitted: the starting view is readable, with the roots at the
     top. Fit all is a separate button for the other question. */
  ok(`it opens at a readable scale (${opened.z})`, opened !== null && opened.z >= 0.55);

  await page.locator('#learnZoomIn').click();
  await page.waitForTimeout(250);
  const bigger = await read();
  ok(`zoom in makes it bigger (${opened.z} -> ${bigger.z})`, bigger.z > opened.z);

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

  await page.locator('#learnReset').click();
  await page.waitForTimeout(250);
  const back = await read();
  ok('Reset zoom puts it back',
    Math.abs(back.x - opened.x) < 2 && Math.abs(back.z - opened.z) < 0.01);
}

/* ---------------- the three controls are three questions ---------------- */

section('Fit all, Reset zoom and Centre selected are not the same button');
{
  /* One "Recenter" was asked to answer three: show me all of it, put it
     back how it started, and where is the one I picked. */
  await open('#/learn/memory');
  const read = () => page.evaluate(() => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/
      .exec(document.getElementById('learnPan').style.transform || '');
    return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
  });

  const started = await read();
  ok(`the opening view is readable (${started.z})`, started.z >= 0.55);

  await page.locator('#learnFit').click();
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const canvas = document.getElementById('learnCanvas').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.lnode')].map(n => n.getBoundingClientRect());
    return {
      inside: boxes.every(b =>
        b.left >= canvas.left - 1 && b.right <= canvas.right + 1
        && b.top >= canvas.top - 1 && b.bottom <= canvas.bottom + 1),
      count: boxes.length,
    };
  });
  ok(`Fit all puts every one of the ${fit.count} boxes on screen`, fit.inside);

  await page.locator('#learnReset').click();
  await page.waitForTimeout(300);
  const reset = await read();
  ok(`Reset zoom goes back to readable (${reset.z})`, reset.z >= 0.55);

  /* Centre selected is off until something is selected, which is the
     honest state of a button with nothing to centre. */
  check('Centre selected starts disabled',
    await page.evaluate(() => document.getElementById('learnCentre').disabled), true);

  await page.locator('.lnode').last().click();
  await page.waitForTimeout(500);
  check('and turns on once a node is open',
    await page.evaluate(() => document.getElementById('learnCentre').disabled), false);

  /* Push it far away, then ask for it back. */
  await page.locator('#learnFit').click();
  await page.waitForTimeout(250);
  await page.locator('#learnCentre').click();
  await page.waitForTimeout(350);
  const centred = await page.evaluate(() => {
    const sel = document.querySelector('.lnode[aria-selected="true"]');
    const canvas = document.getElementById('learnCanvas').getBoundingClientRect();
    const panel = document.getElementById('learnPanel').getBoundingClientRect();
    const b = sel.getBoundingClientRect();
    /* The middle of what you can SEE, which is the canvas minus the
       panel — not the middle of the canvas, half of which is covered. */
    const midX = (canvas.left + panel.left) / 2;
    const midY = canvas.top + canvas.height / 2;
    return {
      dx: Math.abs((b.left + b.width / 2) - midX),
      dy: Math.abs((b.top + b.height / 2) - midY),
      clear: b.right <= panel.left + 1,
    };
  });
  ok(`Centre selected brings it to the middle of the visible canvas `
    + `(${Math.round(centred.dx)}px, ${Math.round(centred.dy)}px off)`,
    centred.dx < 40 && centred.dy < 40);
  ok('which means clear of the panel, not behind it', centred.clear);
}

section('it can be walked with the arrow keys');
{
  /* systems-simulations, because metric-spaces has a single root and
     Right has nowhere to go from a rank of one. */
  await open('#/learn/systems-simulations');
  /* Nothing is selected on arrival, so the first box is the way in. */
  await page.locator('.lnode').first().focus();
  const start = await page.evaluate(() => document.activeElement.dataset.concept);
  ok(`a box can be focused (${start})`, !!start);

  /* The tree runs top down now, so the keys do: left and right along a
     rank, up and down between them. */
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const right = await page.evaluate(() => ({
    at: document.activeElement.dataset.concept,
    level: document.activeElement.getAttribute('aria-level'),
  }));
  ok('Right moves along the rank', right.at !== start && right.level === '1');

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  check('Left comes back',
    await page.evaluate(() => document.activeElement.dataset.concept), start);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const down = await page.evaluate(() => ({
    at: document.activeElement.dataset.concept,
    level: Number(document.activeElement.getAttribute('aria-level')),
  }));
  ok(`Down goes to something that rests on it (${down.at})`, down.level > 1);

  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  const back = await page.evaluate(() =>
    Number(document.activeElement.getAttribute('aria-level')));
  ok('Up goes back towards the prerequisites', back < down.level);

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
    rows: document.querySelectorAll('#learnPanel table tbody tr').length,
    /* Every problem row, across however many lists there are. */
    problemRows: [...document.querySelectorAll('#learnPanel table')]
      .slice(1)
      .reduce((n, t) => n + t.querySelectorAll('tbody tr').length, 0),
    /* The rows only: the Practise button is a link to a problem too. */
    links: [...document.querySelectorAll('#learnPanel table a[href^="#/p/"]')].length,
    boxes: document.querySelectorAll('#learnPanel input[type="checkbox"]').length,
    note: (document.querySelector('.lpanel-note') || {}).textContent || '',
    next: (document.querySelector('.lpanel-next .btn') || {}).textContent || '',
    nextHref: (document.querySelector('.lpanel-next .btn') || {}).getAttribute?.('href') || '',
  }));

  ok('the panel is open', !m.hidden);
  check('on the node the address named', m.head, 'The metric axioms');
  check('and the box is marked as the selected one', m.selected, m.head);
  ok('it says what the concept is', m.oneLine.length > 40);
  /* Resources, then the work split by what the work is. "Questions"
     used to hold the coding exercises too, which is three different
     kinds of thing under two headings. */
  ok(`the sections are named and separate (${m.subs.join(', ')})`,
    m.subs[0] === 'Resources'
    && m.subs.slice(1).every(x =>
      ['Questions', 'Coding exercises', 'Related practice'].includes(x))
    && m.subs.length >= 2);
  ok(`one table each (${m.tables})`, m.tables === m.subs.length);
  check('with the columns the reference has',
    m.headers.slice(0, 4).join(','), 'Tag,Resource,Section,Read');
  check('and the problem lists keep theirs',
    m.headers.slice(4, 7).join(','), 'Name,Difficulty,Felt');
  ok(`resources are listed (${m.resources})`, m.resources >= 2);
  ok(`so are the problems (${m.problemRows})`, m.problemRows >= 2);
  check('every problem is a link', m.links, m.problemRows);
  check('and every resource has a tick box', m.boxes, m.resources);
  /* A tick is a note to yourself. Said where the ticks are, because
     that is where somebody might think it counted for something. */
  ok(`the readings say they are not counted ("${m.note.slice(0, 50)}…")`,
    /not counted towards the track/i.test(m.note));
  /* And the one thing to do next, where there is one. */
  ok(`there is a direct way to practise it ("${m.next}")`,
    /Practise this|Carry on/.test(m.next) && /^#\/p\//.test(m.nextHref));
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
    /1 of \d+ readings ticked/.test(m.label));
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
  /* Reading has an entry of its own in the menu now, so #/concepts marks
     Reading rather than borrowing Learn. The two track routes have none,
     and borrow the entry they are reached from. */
  for (const [from, expect, lit] of [
    ['#/tracks', 'view-learn', 'Learn'],
    ['#/tracks/memory', 'view-tracks', 'Learn'],
    ['#/concepts', 'view-concepts', 'Reading'],
  ]) {
    await open(from, 800);
    const m = await page.evaluate(() => ({
      view: [...document.querySelectorAll('.view')].find(v => !v.hidden).id,
      nav: ((document.querySelector('.navmenu-item[aria-current] .navmenu-title')
        || {}).childNodes || [{}])[0].textContent,
    }));
    check(`${from} shows ${expect}`, m.view, expect);
    check(`${from} marks ${lit} in the menu`, (m.nav || '').trim(), lit);
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

/* ---------------- the graph owns the window ---------------- */

section('an open track is a workspace, and the index is not');
{
  await open('#/learn');
  const list = await page.evaluate(() => ({
    graph: document.body.dataset.graph || null,
    width: Math.round(document.querySelector('.main').getBoundingClientRect().width),
    cards: document.querySelectorAll('.track-card').length,
  }));
  check('the index is an ordinary page', list.graph, null);
  ok(`at the ordinary width (${list.width}px)`, list.width <= 1200);
  ok(`with the track cards on it (${list.cards})`, list.cards > 5);

  await open('#/learn/memory');
  const graph = await page.evaluate(() => {
    const main = document.querySelector('.main').getBoundingClientRect();
    const canvas = document.getElementById('learnCanvas').getBoundingClientRect();
    return {
      graph: document.body.dataset.graph || null,
      mainW: Math.round(main.width),
      canvasH: Math.round(canvas.height),
      winH: window.innerHeight,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
    };
  });
  check('opening a track turns the workspace on', graph.graph, 'true');
  ok(`and it uses the window's width (${graph.mainW}px)`, graph.mainW >= 1400);
  ok(`the canvas is most of its height (${graph.canvasH} of ${graph.winH})`,
    graph.canvasH > graph.winH * 0.7);
  ok('and the page itself does not scroll', !graph.pageScrolls);
}

/* The bug this is modelled on is real and was reported: the code
   workspace put body[data-workspace] on and nothing took it off, so one
   click from a problem to anywhere else left the destination clipped to
   the window with no scrollbar. The graph does the same thing to .main,
   so it gets the same regression test. */
section('leaving the graph gives the page back');
{
  for (const [label, hash] of [
    ['the catalogue', '#/problems'],
    ['the reading map', '#/concepts'],
    ['Profile', '#/profile'],
    ['the Learn index', '#/learn'],
    ['the front page', '#/'],
  ]) {
    await open('#/learn/memory');
    await open(hash);
    const m = await page.evaluate(() => ({
      graph: document.body.dataset.graph || null,
      main: getComputedStyle(document.querySelector('.main')).overflow,
      /* The real symptom: content taller than the window with nothing
         able to scroll to it. */
      reachable: document.documentElement.scrollHeight <= window.innerHeight + 2
        || document.documentElement.scrollHeight > 0,
      height: getComputedStyle(document.querySelector('.main')).height,
      maxW: getComputedStyle(document.querySelector('.main')).maxWidth,
    }));
    check(`${label}: the flag is gone`, m.graph, null);
    ok(`${label}: and .main is a document again (${m.maxW}, ${m.main})`,
      m.main !== 'hidden' && m.maxW !== 'none');
  }
}

/* ---------------- find ---------------- */

section('a concept can be found by name and is brought to the middle');
{
  await open('#/learn/memory');
  await page.locator('#learnFind').fill('tlb');
  await page.waitForTimeout(400);
  const hits = await page.evaluate(() => ({
    open: document.getElementById('learnFind').getAttribute('aria-expanded'),
    options: [...document.querySelectorAll('.graph-find-opt')].map(o => ({
      id: o.dataset.concept,
      label: o.textContent,
    })),
  }));
  check('the list opens', hits.open, 'true');
  ok(`and it matched (${hits.options.map(o => o.id).join(', ')})`, hits.options.length > 0);

  await page.locator('.graph-find-opt').first().click();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => {
    const sel = document.querySelector('.lnode[aria-selected="true"]');
    const canvas = document.getElementById('learnCanvas').getBoundingClientRect();
    const panel = document.getElementById('learnPanel').getBoundingClientRect();
    const b = sel.getBoundingClientRect();
    return {
      hash: location.hash,
      name: sel.querySelector('.lnode-name').textContent,
      dx: Math.abs((b.left + b.width / 2) - (canvas.left + panel.left) / 2),
      clear: b.right <= panel.left + 1,
      listShut: document.getElementById('learnFindList').hidden,
      boxEmpty: document.getElementById('learnFind').value === '',
    };
  });
  ok(`choosing one opens it (${after.name})`, /#\/learn\/memory\//.test(after.hash));
  ok(`and centres it (${Math.round(after.dx)}px off the middle)`, after.dx < 60);
  ok('clear of the panel', after.clear);
  ok('the list closes behind it', after.listShut);
  ok('and the box empties, ready for the next one', after.boxEmpty);

  /* A search with no answer says so rather than showing an empty box. */
  await page.locator('#learnFind').fill('quaternion');
  await page.waitForTimeout(400);
  ok('a miss says so', await page.evaluate(() =>
    /Nothing in this track matches/.test(
      (document.querySelector('.graph-find-none') || {}).textContent || '')));
  await page.keyboard.press('Escape');
}

/* ---------------- coming back ---------------- */

section('pan, zoom and the open node survive going to a problem and back');
{
  await open('#/learn/memory');
  await page.locator('#learnZoomIn').click();
  await page.locator('#learnZoomIn').click();
  await page.waitForTimeout(250);
  const box = await page.locator('#learnCanvas').boundingBox();
  /* Down and to the right. Dragging the other way puts a top-rank box
     above the canvas, where it is clipped out of sight — pannable, and
     not something to then try to click. */
  await page.mouse.move(box.x + 120, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  /* Whichever box is fully on screen after that, rather than a fixed
     index that the pan may have moved out of the frame. */
  const pick = await page.evaluate(() => {
    const c = document.getElementById('learnCanvas').getBoundingClientRect();
    const n = [...document.querySelectorAll('.lnode')].find(x => {
      const b = x.getBoundingClientRect();
      return b.left > c.left + 4 && b.right < c.right - 4
        && b.top > c.top + 4 && b.bottom < c.bottom - 4;
    });
    return n ? n.dataset.concept : null;
  });
  ok('a box is on screen to click', !!pick);
  await page.locator(`.lnode[data-concept="${pick}"]`).click();
  await page.waitForTimeout(600);

  const read = () => page.evaluate(() => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/
      .exec(document.getElementById('learnPan').style.transform || '');
    return {
      v: m ? { x: +m[1], y: +m[2], z: +m[3] } : null,
      at: (document.querySelector('.lnode[aria-selected="true"]') || {}).dataset?.concept || null,
      hash: location.hash,
    };
  });
  const before = await read();
  ok(`a node is open (${before.at})`, !!before.at);

  /* Out to a problem and back, which is the journey this is for. */
  await open('#/p/arch-struct-padding');
  await open(before.hash);
  await page.waitForTimeout(700);
  const after = await read();
  check('the same node is still open', after.at, before.at);
  ok(`and the same view (${JSON.stringify(after.v)})`,
    Math.abs(after.v.z - before.v.z) < 0.01
    && Math.abs(after.v.x - before.v.x) < 3
    && Math.abs(after.v.y - before.v.y) < 3);

  /* And across a real reload, because a view kept only in a variable is
     a view that a refresh throws away. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const reloaded = await read();
  ok(`it survives a reload too (${JSON.stringify(reloaded.v)})`,
    Math.abs(reloaded.v.z - before.v.z) < 0.01
    && Math.abs(reloaded.v.x - before.v.x) < 3);
}

/* ---------------- the pointer ---------------- */

section('a click opens a node; a drag moves the canvas and opens nothing');
{
  await open('#/learn/memory');
  const read = () => page.evaluate(() => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/
      .exec(document.getElementById('learnPan').style.transform || '');
    return {
      x: m ? +m[1] : 0,
      at: (document.querySelector('.lnode[aria-selected="true"]') || {}).dataset?.concept || null,
    };
  });

  /* A press on a box with a two-pixel wobble is a click, not a pan —
     which is what a hand on a trackpad actually does. */
  const node = await page.locator('.lnode').first().boundingBox();
  const was = await read();
  await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
  await page.mouse.down();
  await page.mouse.move(node.x + node.width / 2 + 2, node.y + node.height / 2 + 1);
  await page.mouse.up();
  await page.waitForTimeout(600);
  const clicked = await read();
  ok(`a wobbly click still opens the node (${clicked.at})`, !!clicked.at);
  ok('and did not pan the canvas', Math.abs(clicked.x - was.x) < 2);

  /* A real drag from a box pans and does NOT open it: half the canvas
     has boxes on it, and a graph you cannot drag from a box is a graph
     with half a surface. */
  await open('#/learn/memory');
  const before = await read();
  const n2 = await page.locator('.lnode').nth(1).boundingBox();
  await page.mouse.move(n2.x + n2.width / 2, n2.y + n2.height / 2);
  await page.mouse.down();
  await page.mouse.move(n2.x + n2.width / 2 + 160, n2.y + n2.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const dragged = await read();
  ok(`dragging from a box pans (${Math.round(before.x)} -> ${Math.round(dragged.x)})`,
    Math.abs(dragged.x - before.x) > 100);
  check('and opens nothing', dragged.at, null);
}

/* ---------------- the panel's width ---------------- */

section('the details panel is resizable, and remembers');
{
  await open('#/learn/memory/page-faults');
  const width = () => page.evaluate(() =>
    Math.round(document.getElementById('learnPanel').getBoundingClientRect().width));
  const was = await width();
  ok(`it has a width (${was}px)`, was > 200);

  const grip = await page.locator('#learnGrip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 140, grip.y + grip.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const wider = await width();
  ok(`dragging the grip widens it (${was} -> ${wider})`, wider > was + 100);

  /* The keyboard can do it too: a drag handle a keyboard cannot move is
     a control half the readers do not have. */
  await page.locator('#learnGrip').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const narrower = await width();
  ok(`and so can the arrow keys (${wider} -> ${narrower})`, narrower < wider);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const kept = await width();
  ok(`the width survives a reload (${kept}px)`, Math.abs(kept - narrower) <= 2);
}

/* ---------------- following a path ---------------- */

section('the chain down to the selected concept is lit, not just its own edges');
{
  await open('#/learn/metric-spaces/compactness');
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({
    lit: document.querySelectorAll('.learn-edges path[data-lit="true"]').length,
    path: document.querySelectorAll('.learn-edges path[data-path="true"]').length,
    ancestors: document.querySelectorAll('.lnode[data-ancestor="true"]').length,
    total: document.querySelectorAll('.learn-edges path').length,
  }));
  ok(`its own edges are lit (${m.lit})`, m.lit > 0);
  ok(`and the way down to it as well (${m.path} more)`, m.path > 0);
  ok(`with the concepts on that way marked (${m.ancestors})`, m.ancestors > 0);
  ok('but not the whole graph', m.lit + m.path < m.total);
}

section('no uncaught errors');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 200)}` : 'none', errors.length === 0);

await browser.close();
report('browser/learn');
