/* The two course trees: the whole of a unit, drawn as a graph with its
   chapters as groups.

   What is being claimed, and therefore what is checked:

     · a course track draws EVERY concept of the course, including the
       chapters nothing has been set on yet, rather than only what the
       track's problems happen to rest on
     · chapter order and prerequisite order are different relations and
       are shown differently: the chapters are a rail, the edges are
       `needs`, and no edge points backwards in course order
     · a chapter folds into one box that keeps the edges crossing its
       boundary, and unfolds again
     · every node says which section and page of the notes it is, and
       material the notes exclude is marked optional
     · the fold survives a reload
     · and a track that is not a course is exactly as it was

   Needs the site served:   npm run serve
   Run: node tests/browser/courses.test.mjs
   Against the deployed site: BASE=https://… node tests/browser/courses.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import { section, check, ok, report } from '../harness.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHANNEL = process.env.BROWSER || null;

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not reachable at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const courses = JSON.parse(fs.readFileSync('data/courses.json', 'utf8'));
const concepts = JSON.parse(fs.readFileSync('data/concepts.json', 'utf8'));
const TRACKS = {
  'metric-spaces': 'course-metric-spaces',
  'probability-2': 'course-probability-2',
};

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

const go = async (hash, wait = 2400) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};
const fresh = async (hash, wait = 2400) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const shape = () => page.evaluate(() => ({
  rail: !document.getElementById('learnChapters').hidden,
  chapters: [...document.querySelectorAll('.lchap')].length,
  nodes: [...document.querySelectorAll('.lnode')].map(n => n.dataset.concept),
  chaptered: document.querySelectorAll('.lnode[data-chapter]').length,
  optional: [...document.querySelectorAll('.lnode[data-optional="true"]')]
    .map(n => n.dataset.concept),
  folded: [...document.querySelectorAll('.lnode[data-folded]')].map(n => n.dataset.concept),
  edges: [...document.querySelectorAll('#learnEdges path')]
    .map(p => `${p.dataset.from}>${p.dataset.to}`),
}));

/* ---------------- the whole course is in the picture ---------------- */

for (const [cid, course] of Object.entries(courses)) {
  section(`${course.title}: the tree is the course`);

  const trackId = TRACKS[cid];
  await fresh(`#/learn/${trackId}`);
  const got = await shape();

  const want = (course.chapters || []).flatMap(ch => ch.concepts);
  check('the chapter rail is there', got.rail, true);
  check('with one entry per chapter', got.chapters, course.chapters.length);
  check('every concept of the course is a box', [...got.nodes].sort(), [...want].sort());
  check('and every box says which chapter it is in', got.chaptered, want.length);

  const wantOptional = want.filter(id => concepts[id].optional);
  check(`the non-examinable sections are marked (${wantOptional.length})`,
    [...got.optional].sort(), [...wantOptional].sort());

  /* Course order is the rail; prerequisite order is the edges. The
     claim the picture makes is only the second one, and the thing
     that would make it a lie is an edge running backwards. */
  const at = {};
  want.forEach((id, i) => { at[id] = i; });
  const backwards = got.edges
    .map(e => e.split('>'))
    .filter(([a, b]) => at[a] !== undefined && at[b] !== undefined && at[a] > at[b]);
  check('no prerequisite edge points backwards through the course', backwards, []);

  /* And the two relations really are different: if every edge were
     "the previous section", the graph would be a single chain. */
  ok(`the graph is not merely the reading order (${got.edges.length} edges over ${got.nodes.length} nodes)`,
    got.edges.length !== got.nodes.length - 1);

  /* Selecting a concept is a route, which is what clicking a box
     does; going there directly is the same thing without having to
     scroll a panned canvas to find the box first. */
  await go(`#/learn/${trackId}/${want[0]}`, 1200);
  const open = await page.evaluate(() => ({
    title: (document.querySelector('.lpanel-head h2') || {}).textContent,
    where: (document.querySelector('.lpanel-src') || {}).textContent,
    selected: (document.querySelector('.lnode[aria-selected="true"]') || {}).dataset?.concept,
  }));
  check('selecting a concept opens its panel', open.title, concepts[want[0]].name);
  check('and the box is marked as the selected one', open.selected, want[0]);
  check('and the panel says where in the notes it comes from',
    open.where, concepts[want[0]].where);
}

/* ---------------- folding a chapter ---------------- */

section('a chapter folds into one box, and the edges survive');

const trackId = TRACKS['metric-spaces'];
await fresh(`#/learn/${trackId}`);
const before = await shape();

const ch1 = courses['metric-spaces'].chapters[0];
await page.locator('.lchap-fold[data-chapter="1"]').click();
await page.waitForTimeout(900);
const afterFold = await shape();

check('the chapter is one box now', afterFold.folded, ['__chapter-1']);
check(`and its ${ch1.concepts.length} sections are gone`,
  afterFold.nodes.filter(id => ch1.concepts.includes(id)), []);
check('every other box is still there',
  afterFold.nodes.length, before.nodes.length - ch1.concepts.length + 1);

/* The point of folding rather than hiding: a node that rested on
   something inside the chapter now rests on the chapter. */
const dependents = Object.entries(concepts)
  .filter(([, c]) => c.course === 'metric-spaces'
    && (c.needs || []).some(n => ch1.concepts.includes(n))
    && !ch1.concepts.includes(c.chapter === 1 ? 'x' : ''))
  .map(([id]) => id)
  .filter(id => !ch1.concepts.includes(id));
const intoChapter = afterFold.edges.filter(e => e.startsWith('__chapter-1>'));
ok(`the edges into the chapter are still drawn (${intoChapter.length} of them, for ${dependents.length} dependents)`,
  intoChapter.length > 0);
check('and nothing still points at a section inside it',
  afterFold.edges.filter(e => ch1.concepts.some(c => e.includes(c))), []);

await page.locator('.lnode[data-folded]').first().click();
await page.waitForTimeout(700);
const foldedPanel = await page.evaluate(() => ({
  title: (document.querySelector('.lpanel-head h2') || {}).textContent,
  sections: [...document.querySelectorAll('.lpanel-sections li span:first-child')]
    .map(s => s.textContent),
}));
check('the folded box names the chapter', foldedPanel.title,
  `Chapter 1: ${ch1.title}`);
check('and the panel lists the sections it stands for',
  foldedPanel.sections.length, ch1.concepts.length);

section('and the fold is remembered');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2400);
check('a reload finds it still folded', (await shape()).folded, ['__chapter-1']);

await page.locator('.lchap-fold[data-chapter="1"]').click();
await page.waitForTimeout(900);
const back = await shape();
check('unfolding puts every section back', [...back.nodes].sort(), [...before.nodes].sort());
check('and the edges are the ones they were',
  [...back.edges].sort(), [...before.edges].sort());

section('fold all, and unfold all');

await page.locator('.lchap-acts button:has-text("Fold all")').first().click();
await page.waitForTimeout(1000);
const allFolded = await shape();
check('every chapter is one box', allFolded.nodes.length,
  courses['metric-spaces'].chapters.length);
check('and all of them are folded', allFolded.folded.length,
  courses['metric-spaces'].chapters.length);

await page.locator('.lchap-acts button:has-text("Unfold all")').first().click();
await page.waitForTimeout(1000);
check('unfold all brings the whole course back',
  (await shape()).nodes.length, before.nodes.length);

/* ---------------- the tracks that are not courses ---------------- */

section('a track that is not a course is untouched');

await go('#/learn/metric-spaces');
const plain = await shape();
check('no chapter rail', plain.rail, false);
check('no chapter numbers on the boxes', plain.chaptered, 0);
ok(`and it is still the tree it was (${plain.nodes.length} boxes)`, plain.nodes.length > 0);
check('none of them is a folded chapter', plain.folded, []);

await go('#/learn/systems-simulations');
const sys = await page.evaluate(() => {
  const c = document.getElementById('learnCanvas').getBoundingClientRect();
  return { rail: !document.getElementById('learnChapters').hidden, canvas: Math.round(c.height) };
});
check('nor on a systems track', sys.rail, false);
/* The rail is `hidden` there, and a hidden element is not a grid item —
   so the canvas has to be told which row it is in or it lands in the
   empty one and gets no height at all. */
ok(`and the canvas still has its height (${sys.canvas}px)`, sys.canvas > 400);

check('no uncaught errors on the page', errors, []);

await browser.close();
report('browser/courses');
