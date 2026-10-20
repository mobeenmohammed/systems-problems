/* Projects, organised separately from Learn.

   What is being claimed, and therefore what is checked:

     · Learn draws no project cards, and its trees still draw
     · Content -> Projects opens a catalogue of projects, not a filter
       on the problem list
     · one card per project, with its language, difficulty,
       description, milestone progress, and Start or Continue naming
       the milestone it opens
     · the language, difficulty and progress filters work, live in the
       hash so a filtered view is a link, and say so when they empty
       the list
     · every project has an overview with its goal, what it rests on,
       its file structure and its milestones in order
     · the prerequisites link into Learn, and Learn has no project in
       any of its trees
     · the old Learn and Tracks URLs redirect to the overview
     · every problem id, milestone link, draft, submission and
       completion record is the one it was

   Needs the site served:   npm run serve
   Run: node tests/browser/projects.test.mjs */

import { chromium } from 'playwright';
import { section, check, ok, report, readJson } from '../harness.mjs';

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

/* The authored data, so the numbers in this suite come from the
   catalogue rather than from something typed here once. */
const TRACKS = readJson('data/tracks.json');
const PROJECT_TRACKS = TRACKS.filter(t => t.kind === 'project');

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

/* A hash change on the same document is a route change, not a load, so
   a reload is forced where one is actually wanted. */
const go = async (hash, wait = 1500) => {
  await page.goto('about:blank');
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const title = () => page.evaluate(() =>
  ((document.querySelector('.view:not([hidden]) h1')) || {}).textContent || null);

/* ---------------- Learn, without them ---------------- */

section('Learn is courses and concepts');

await go('#/learn');
const learn = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('#learnTracks .track-card')]
    .map(a => a.getAttribute('href')),
  learnTracks: window.SystemsLab.Catalog.learnTracks().length,
  allTracks: window.SystemsLab.Catalog.allTracks().length,
  projects: window.SystemsLab.Catalog.allProjects().length,
  blurb: (document.querySelector('#learnBlurb') || {}).textContent || '',
}));
check('every track Learn owns has a card', learn.cards.length, learn.learnTracks);
check(`and the projects are not among them (${learn.projects} of them)`,
  learn.cards.filter(h => /project-/.test(h || '')).length, 0);
check('which is the whole difference between the two lists',
  learn.allTracks - learn.learnTracks, learn.projects);
ok(`and Learn says where they went ("${learn.blurb.slice(-28)}")`,
  /Projects are in Projects/.test(learn.blurb));

await go('#/learn/metric-spaces');
ok('a course still draws as a tree',
  await page.evaluate(() => document.querySelectorAll('.lnode').length > 5));

/* No project is a node in anybody's tree, which is the other half of
   "link prerequisites to Learn without inserting projects into course
   trees". */
const inTrees = await page.evaluate(() => {
  const bad = [];
  for (const t of window.SystemsLab.Catalog.learnTracks()) {
    const tree = window.SystemsLab.Catalog.trackTree(t.id);
    if (!tree) continue;
    (function walk(ns) {
      for (const n of ns) {
        for (const pr of (n.problems || [])) {
          if (/^proj-/.test(pr.id) && (pr.inTrack || tree.track.problems.includes(pr.id))) {
            bad.push(`${t.id}:${pr.id}`);
          }
        }
        walk(n.children);
      }
    })(tree.roots);
  }
  return bad;
});
check('no project milestone is required work in a Learn track', inTrees, []);

/* ---------------- the catalogue ---------------- */

section('Projects has a catalogue of its own');

await go('#/projects');
const nav = await page.evaluate(() => {
  const a = document.querySelector('.navmenu-item[href="#/projects"]');
  return a ? {
    label: (a.querySelector('.navmenu-title').childNodes[0] || {}).textContent,
    count: (a.querySelector('.navmenu-count') || {}).textContent,
    current: a.getAttribute('aria-current'),
  } : null;
});
check('Content offers it', (nav || {}).label, 'Projects');
check('with the number of them', (nav || {}).count, String(PROJECT_TRACKS.length));
check('and marks it as the page you are on', (nav || {}).current, 'page');

const cards = await page.evaluate(() =>
  [...document.querySelectorAll('.proj-card')].map(c => ({
    title: c.querySelector('.proj-top h3 a').textContent,
    href: c.querySelector('.proj-top h3 a').getAttribute('href'),
    chip: c.querySelector('.state').textContent,
    pills: [...c.querySelectorAll('.proj-meta .pill')].map(p => p.textContent),
    milestones: c.querySelector('.proj-meta .faint').textContent,
    blurb: c.querySelector('.proj-blurb').textContent,
    bar: !!c.querySelector('.bar i'),
    progress: c.querySelector('.spread').textContent,
    pips: [...c.querySelectorAll('.proj-pip')].map(a => a.getAttribute('href')),
    buttons: [...c.querySelectorAll('.proj-foot .btn')].map(b => b.textContent),
  })));

check(`one card per project (${cards.length})`, cards.length, PROJECT_TRACKS.length);
for (const c of cards) {
  ok(`${c.title}: has a language and a difficulty (${c.pills.join(', ')})`,
    c.pills.length >= 2);
  ok(`${c.title}: has a description`, c.blurb.length > 30);
  ok(`${c.title}: says how many milestones (${c.milestones})`,
    /\d+ milestones?/.test(c.milestones));
  ok(`${c.title}: has a progress bar and a count (${c.progress})`,
    c.bar && /\d+ of \d+ milestones/.test(c.progress));
  ok(`${c.title}: every milestone is a link`,
    c.pips.length > 1 && c.pips.every(h => /^#\/p\//.test(h || '')));
  ok(`${c.title}: Start names what it opens ("${c.buttons[0]}")`,
    /^(Start|Continue|Revisit): .+/.test(c.buttons[0] || ''));
  ok(`${c.title}: and an overview is one click away`,
    c.buttons.includes('Overview') && /^#\/projects\//.test(c.href || ''));
}

section('the filters');

const filters = await page.evaluate(() =>
  [...document.querySelectorAll('.proj-filter')].map(s => ({
    key: s.dataset.filter,
    options: [...s.options].map(o => o.textContent),
  })));
check('three of them', filters.map(f => f.key), ['lang', 'difficulty', 'progress']);
ok('each with a count beside every value',
  filters.every(f => f.options.slice(1).every(o => /\(\d+\)$/.test(o))));

const shown = () => page.evaluate(() =>
  [...document.querySelectorAll('.proj-card .proj-top h3 a')].map(a => a.textContent));

await page.selectOption('.proj-filter[data-filter="lang"]', 'sv');
await page.waitForTimeout(700);
const sv = await shown();
ok(`a language narrows it (${sv.length} of ${cards.length})`,
  sv.length > 0 && sv.length < cards.length);
check('and it is in the hash, so the view is a link',
  await page.evaluate(() => location.hash), '#/projects?lang=sv');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check('which survives a reload', await shown(), sv);

await go('#/projects?difficulty=advanced');
const hard = await shown();
ok(`difficulty narrows it too (${hard.length})`, hard.length > 0 && hard.length < cards.length);

await go('#/projects?progress=completed');
ok('a progress filter that matches nothing says so, rather than going blank',
  await page.evaluate(() => !!document.querySelector('.empty')
    && !!document.querySelector('.empty a[href="#/projects"]')));

await go('#/projects?lang=cpp&difficulty=advanced');
const both = await shown();
ok(`two filters combine (${both.join(', ')})`, both.length <= hard.length);
ok('and there is a way back to all of them',
  await page.evaluate(() => !!document.querySelector('.proj-filters a[href="#/projects"]')));

await go('#/projects?lang=nonsense');
ok('a value nothing has empties the list honestly rather than throwing',
  await page.evaluate(() => !!document.querySelector('.empty')));

/* ---------------- an overview each ---------------- */

section('every project has an overview');

for (const t of PROJECT_TRACKS) {
  await go(`#/projects/${t.id}`);
  const o = await page.evaluate(() => ({
    h1: (document.querySelector('.view:not([hidden]) h1') || {}).textContent,
    sections: [...document.querySelectorAll('.pov-sec h2')].map(h => h.textContent),
    goal: (document.querySelector('.pov-sec .prose') || {}).textContent || '',
    needs: [...document.querySelectorAll('.pov-needs a')]
      .map(a => ({ text: a.textContent, href: a.getAttribute('href') })),
    files: [...document.querySelectorAll('.pov-files li .mono')].map(n => n.textContent),
    given: document.querySelectorAll('.pov-files .mf-tag-ro').length,
    steps: [...document.querySelectorAll('.pov-step')].map(li => ({
      text: li.querySelector('.pov-step-title').textContent,
      href: li.querySelector('.pov-step-title').getAttribute('href'),
    })),
    cta: (document.querySelector('.phead .btn') || {}).textContent || '',
    back: (document.querySelector('.crumbs a') || {}).getAttribute('href'),
  }));

  check(`${t.id}: is its own page`, o.h1, t.title);
  ok(`${t.id}: with a way back to the catalogue`, o.back === '#/projects');
  ok(`${t.id}: says what you end up with`,
    o.sections.includes('What you end up with') && o.goal.length > 40);
  ok(`${t.id}: lists the files (${o.files.join(', ')})`, o.files.length >= 1);
  ok(`${t.id}: and says which of them the exercise gave you`, o.given >= 0);
  check(`${t.id}: the milestones are the track, in order`,
    o.steps.map(s => s.href), t.problems.map(id => `#/p/${id}`));
  ok(`${t.id}: each numbered and named ("${(o.steps[0] || {}).text}")`,
    o.steps.every((s, i) => s.text.startsWith(`${i + 1}. `)));
  ok(`${t.id}: and there is one button that starts it ("${o.cta}")`,
    /^(Start|Continue|Revisit): /.test(o.cta));

  ok(`${t.id}: says what it rests on`, o.needs.length > 0);
  ok(`${t.id}: with every prerequisite linking into Learn or the reading index`,
    o.needs.every(n => /^#\/learn\/[^/]+\/[^/]+$/.test(n.href) || n.href === '#/concepts'));
  ok(`${t.id}: by name rather than by id`,
    o.needs.every(n => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n.text)));
  ok(`${t.id}: and none of those links is to a project`,
    o.needs.every(n => !/project-/.test(n.href)));
}

/* A prerequisite link has to land on the concept, not merely on a
   page. One is enough to prove the route is real. */
await go(`#/projects/${PROJECT_TRACKS[0].id}`);
const firstNeed = await page.evaluate(() => {
  const a = [...document.querySelectorAll('.pov-needs a')]
    .find(x => /^#\/learn\//.test(x.getAttribute('href')));
  return a ? { href: a.getAttribute('href'), text: a.textContent } : null;
});
ok(`a prerequisite goes somewhere in Learn (${(firstNeed || {}).href})`, !!firstNeed);
if (firstNeed) {
  await go(firstNeed.href, 2200);
  const landed = await page.evaluate(() => ({
    graph: document.body.dataset.graph,
    selected: (document.querySelector('.lnode[aria-current="true"], .lnode[data-selected="true"]')
      || {}).dataset?.concept || null,
    panel: (document.querySelector('.lpanel-head h2') || {}).textContent || '',
  }));
  check('and it is the Learn graph', landed.graph, 'true');
  check(`with that concept opened ("${landed.panel}")`,
    landed.panel.trim(), firstNeed.text.trim());
}

/* ---------------- the links that already existed ---------------- */

section('the old URLs still land somewhere');

for (const t of PROJECT_TRACKS) {
  for (const old of [`#/learn/${t.id}`, `#/tracks/${t.id}`]) {
    await go(old, 1400);
    const now = await page.evaluate(() => location.hash);
    check(`${old} -> the overview`, now, `#/projects/${t.id}`);
    check('which is the project it named', await title(), t.title);
  }
}
await go(`#/learn/${PROJECT_TRACKS[0].id}/some-concept`, 1400);
check('and so does a deep link into one',
  await page.evaluate(() => location.hash), `#/projects/${PROJECT_TRACKS[0].id}`);

await go('#/projects/nonsense');
ok('an id nothing has says so and offers the list',
  await page.evaluate(() => /No such project/.test(document.body.textContent)
    && !!document.querySelector('a[href="#/projects"]')));

/* Three spellings reach a project, because three kinds of link do. */
const one = PROJECT_TRACKS.find(t => t.id === 'project-cache-sim') || PROJECT_TRACKS[0];
for (const spelling of [one.id, one.project, one.problems[1]]) {
  await go(`#/projects/${spelling}`);
  check(`#/projects/${spelling} finds it`, await title(), one.title);
}

/* ---------------- nothing moved underneath ---------------- */

section('ids, drafts, submissions and records are the ones they were');

await go(`#/p/${one.problems[0]}`, 2600);
const kept = await page.evaluate(async (ids) => {
  const S = window.SystemsLab;
  const pane = S.ProblemTypes.get('code').pane();
  /* Type into the first milestone, record a submission against it,
     and mark it solved: the three things the brief says must survive
     the move. */
  /* The file that is actually open, which is the one the editor
     belongs to — not pane.info()[0], which is whatever the explorer
     lists first. */
  const path = pane.active;
  const ed = pane.editor();
  ed.value = `// a draft written before the move\n${ed.value}`;
  await new Promise(r => setTimeout(r, 400));
  const at = new Date().toISOString();
  await S.Sources.put(ids[0], at, 'a submitted program');
  S.Store.state.progress[ids[0]] = {
    ...S.Store.record(ids[0]),
    status: 'solved',
    subs: [{ at, outcome: 'passed', lang: 'cpp', passed: 1, total: 1, ms: 9, stored: true, bytes: 20 }],
  };
  S.Store.save();
  return {
    path,
    draftKey: S.Workspace.draftKey('cpp', path),
    draft: S.Store.draft(ids[0], S.Workspace.draftKey('cpp', path)).slice(0, 36),
  };
}, one.problems);
ok(`a draft was written for ${kept.path}`, /before the move/.test(kept.draft));

await go('#/projects');
const after = await page.evaluate((trackId) => {
  const p = window.SystemsLab.Catalog.project(trackId);
  const card = [...document.querySelectorAll('.proj-card')]
    .find(c => c.querySelector('.proj-top h3 a').getAttribute('href') === `#/projects/${trackId}`);
  return {
    done: p.done,
    total: p.total,
    state: p.state,
    next: p.next.id,
    progress: card.querySelector('.spread').textContent,
    chip: card.querySelector('.state').textContent,
    cta: card.querySelector('.proj-foot .btn').textContent,
    firstPip: card.querySelector('.proj-pip').dataset.status,
  };
}, one.id);
check('the solve counts towards the project', after.done, 1);
ok(`and the card says so ("${after.progress}" / "${after.chip}")`,
  /1 of \d+ milestones/.test(after.progress) && after.chip === 'Attempted');
check('the first milestone is marked solved on the card', after.firstPip, 'solved');
check('and Continue moves to the next one', after.next, one.problems[1]);
ok(`naming it ("${after.cta}")`, /^Continue: /.test(after.cta));

await go(`#/p/${one.problems[0]}`, 2600);
const still = await page.evaluate(([id, key]) => {
  const S = window.SystemsLab;
  return {
    draft: S.Store.draft(id, key).slice(0, 36),
    subs: S.Store.submissions(id).length,
    status: S.Store.record(id).status,
    editor: S.ProblemTypes.get('code').pane().textOf(key.split(':').slice(1).join(':')).slice(0, 36),
  };
}, [one.problems[0], kept.draftKey]);
check('the draft is still there, under the same key', still.draft, kept.draft);
check('and in the editor', still.editor, kept.draft);
check('the submission is still there', still.subs, 1);
check('and so is the completion record', still.status, 'solved');

check('no uncaught errors on the page', errors, []);

await browser.close();
report('browser/projects');
