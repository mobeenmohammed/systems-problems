/* The landing page, the profile menu, and the rail beside the catalogue.

   What replaced the dashboard, and the three claims worth holding: that
   the landing page answers "what do I open" rather than "how am I doing";
   that everything about you is reachable from the avatar and operable
   from the keyboard; and that the numbers which left the dashboard
   actually arrived somewhere rather than being deleted.

   Needs the site served:   npm run serve
   Run: node tests/browser/landing.test.mjs
        SHOTS=1 node tests/browser/landing.test.mjs */

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
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const open = async (hash, wait = 1100) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* ---------------- the front page ---------------- */

section('the front page introduces the site rather than listing it');
await open('#/');
{
  const m = await page.evaluate(() => ({
    title: (document.querySelector('.hero-title') || {}).textContent || '',
    sub: (document.querySelector('.hero-sub') || {}).textContent || '',
    strands: [...document.querySelectorAll('.hero-strands li')].map(l => l.textContent.trim()),
    cta: [...document.querySelectorAll('#homeCta .btn')]
      .map(b => ({ text: b.textContent.trim(), href: b.getAttribute('href') })),
    tiles: [...document.querySelectorAll('.htile')].map(t => ({
      title: t.querySelector('h3').textContent,
      href: t.getAttribute('href'),
      blurb: t.querySelector('p').textContent,
      art: !!t.querySelector('.htile-art svg'),
    })),
    steps: [...document.querySelectorAll('.home-steps h3')].map(h => h.textContent),
    feats: [...document.querySelectorAll('.feat h3')].map(h => h.textContent),
    /* The things this page is not. A list of problems on it would be the
       catalogue arriving a page early, which is what it replaced. */
    rows: document.querySelectorAll('#view-home .prow').length,
    doors: document.querySelectorAll('#view-home .door').length,
    gone: ['landingGrid', 'landingContinue', 'homeRank', 'homeStats', 'homeHeat']
      .filter(id => document.getElementById(id)),
  }));

  ok(`it leads with what the site is ("${m.title.trim().slice(0, 40)}…")`, m.title.length > 20);
  ok('and a line under it saying what you get', m.sub.length > 60);
  check('four strands named', m.strands.length, 4);
  ok('mathematics among them', m.strands.some(x => /Mathematics/i.test(x)));

  check('two things to press', m.cta.length, 2);
  ok('one of them starts you solving',
    m.cta.some(b => /^#\/(problems|p\/)/.test(b.href || '')));
  ok('the other goes to the tracks', m.cta.some(b => b.href === '#/learn'));

  check('four drawings of what is inside', m.tiles.length, 4);
  ok('each is drawn rather than described', m.tiles.every(t => t.art));
  ok('each says what it stands for', m.tiles.every(t => t.blurb.length > 60));
  ok('and each is a door to the real thing', m.tiles.every(t => /^#\//.test(t.href || '')));

  check('three steps, in the order they happen', m.steps.length, 3);
  ok('three things it claims to do', m.feats.length === 3);

  check('no problem list on it', m.rows, 0);
  check('and none of the doors it replaced', m.doors, 0);
  check('nothing from the old landing page was left behind', m.gone, []);
  if (process.env.SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'landing.png'), fullPage: true });
  }
}

section('the numbers on it are counted, not written down');
{
  const m = await page.evaluate(() => {
    const n = window.SystemsLab.Catalog.counts();
    const facts = [...document.querySelectorAll('#homeFacts .fact')].map(f => ({
      value: Number(f.querySelector('.fact-n').textContent.replace(/[^0-9]/g, '')),
      label: f.querySelector('.fact-k').textContent,
    }));
    return { facts, real: n };
  });
  const by = word => (m.facts.find(f => f.label.includes(word)) || {}).value;
  check('problems', by('problem'), m.real.problems);
  check('topics', by('topics'), m.real.topics);
  check('concepts', by('concepts'), m.real.concepts);
  check('readings', by('readings'), m.real.readings);
  check('languages', by('languages'), m.real.languages);
  ok('every one of them is a real number',
    m.facts.length === 5 && m.facts.every(f => Number.isFinite(f.value) && f.value > 0));
}

section('the main button knows whether you have been here before');
{
  const fresh = await page.evaluate(() => {
    const b = document.querySelector('#homeCta .btn-primary');
    return { text: b.textContent.trim(), href: b.getAttribute('href') };
  });
  check('a first visit is offered a beginning', fresh.text, 'Start solving');
  check('into the catalogue', fresh.href, '#/problems');

  /* One problem left part-finished. Written straight into the store and
     reloaded, because page.goto to the hash the page is already on is a
     same-document navigation: the live store would paint over it. */
  const seeded = await page.evaluate(() => {
    const t = window.SystemsLab.Catalog.allTracks().find(x => (x.problems || []).length > 1);
    const id = t.problems[0];
    localStorage.setItem('invariant/state/v1',
      JSON.stringify({ progress: { [id]: { status: 'attempted' } } }));
    return id;
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const back = await page.evaluate(() => {
    const b = document.querySelector('#homeCta .btn-primary');
    const note = document.querySelector('#homeCta .hero-cta-note a');
    return {
      text: b.textContent.trim(), href: b.getAttribute('href'),
      note: note ? note.textContent.trim() : '',
    };
  });
  check(`a returning one is offered the thing they left (${seeded})`, back.text, 'Carry on');
  ok(`and it points at a problem (${back.href})`, /^#\/p\/.+/.test(back.href));
  ok(`named, so it is a promise about something (${back.note})`, back.note.length > 3);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
}

section('carrying on moved to the catalogue, where the problems are');
await open('#/problems');
{
  const m = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('#catalogRail .rail-head')].map(h => h.textContent),
    cards: document.querySelectorAll('#catalogRail .action').length,
  }));
  ok(`the rail still has this week's problem (${m.heads.join(', ')})`,
    m.heads.includes('This week'));
  ok('and the rail is where the carry-on card went', m.cards >= 1);
}

/* ---------------- the Content menu ---------------- */

section('one entry in the bar, and it opens on everything');
await open('#/');
{
  const shut = await page.evaluate(() => ({
    links: [...document.querySelectorAll('#nav > a')].length,
    buttons: [...document.querySelectorAll('#nav button')].map(b => b.textContent.trim()),
    hidden: document.getElementById('contentPanel').hidden,
    expanded: document.getElementById('contentBtn').getAttribute('aria-expanded'),
  }));
  check('no bare links left in the bar itself', shut.links, 0);
  check('one button, and it is Content', shut.buttons.join(','), 'Content');
  ok('the panel starts closed', shut.hidden);
  check('and says so', shut.expanded, 'false');

  await page.hover('#contentBtn');
  await page.waitForTimeout(400);
  const open1 = await page.evaluate(() => ({
    hidden: document.getElementById('contentPanel').hidden,
    expanded: document.getElementById('contentBtn').getAttribute('aria-expanded'),
    cols: [...document.querySelectorAll('.navmenu-col-head')].map(h => h.textContent),
    items: [...document.querySelectorAll('.navmenu-item')].map(a => ({
      label: a.querySelector('.navmenu-title').childNodes[0].textContent.trim(),
      href: a.getAttribute('href'),
      blurb: a.querySelector('.navmenu-blurb').textContent,
      icon: !!a.querySelector('.navmenu-icon'),
    })),
  }));
  ok('hovering opens it', !open1.hidden);
  check('and says so', open1.expanded, 'true');
  ok(`grouped (${open1.cols.join(', ')})`, open1.cols.join(',') === 'Practice,Guided');
  ok(`every learning destination is in it (${open1.items.length})`,
    open1.items.length >= 6);
  ok('each has a line saying what it is for',
    open1.items.every(i => i.blurb.length > 10));
  ok('each has an icon', open1.items.every(i => i.icon));
  ok('each goes somewhere real', open1.items.every(i => /^#\//.test(i.href || '')));
  for (const want of ['Problems', 'Questions', 'Coding exercises', 'Learn', 'Reading',
    'This week']) {
    ok(`${want} is in it`, open1.items.some(i => i.label === want));
  }
  /* Content is the subject; the avatar is you. Both used to carry Profile
     and Shop, which is two routes to one page and neither of them the
     obvious one. */
  for (const gone of ['Profile', 'Shop', 'Settings', 'Running code']) {
    ok(`${gone} is not duplicated here`, !open1.items.some(i => i.label === gone));
  }
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'content-menu.png') });
}

section('the counts beside the entries are the catalogue, not a guess');
{
  const m = await page.evaluate(() => {
    const all = window.SystemsLab.Catalog.all();
    const n = a => Number((a.querySelector('.navmenu-count') || {}).textContent || NaN);
    const by = label => [...document.querySelectorAll('.navmenu-item')]
      .find(a => a.querySelector('.navmenu-title').childNodes[0].textContent.trim() === label);
    return {
      problems: n(by('Problems')),
      questions: n(by('Questions')),
      coding: n(by('Coding exercises')),
      realAll: all.length,
      realQuestions: all.filter(p => p.type !== 'code').length,
      realCoding: all.filter(p => p.type === 'code').length,
      concepts: n(by('Reading')),
      realConcepts: window.SystemsLab.Catalog.allConcepts().length,
    };
  });
  check('Problems counts the catalogue', m.problems, m.realAll);
  check('Questions counts the non-code ones', m.questions, m.realQuestions);
  check('Coding exercises counts the code ones', m.coding, m.realCoding);
  ok('and the two halves are the whole', m.questions + m.coding === m.realAll);
  check('Reading counts the concepts', m.concepts, m.realConcepts);
}

section('it can be worked without a mouse');
{
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.locator('#contentBtn').click();
  await page.waitForTimeout(300);
  ok('click opens it too', await page.evaluate(() =>
    !document.getElementById('contentPanel').hidden));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const afterEsc = await page.evaluate(() => ({
    hidden: document.getElementById('contentPanel').hidden,
    focus: document.activeElement.id,
  }));
  ok('Escape shuts it', afterEsc.hidden);
  check('and gives the focus back to the button', afterEsc.focus, 'contentBtn');

  /* Enter on the button, then Tab into the panel: the whole menu has to be
     reachable, because it is now the only way to the rest of the site. */
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  const landed = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    inPanel: !!document.activeElement.closest('#contentPanel'),
    href: document.activeElement.getAttribute('href'),
  }));
  ok(`Tab lands inside the panel (${landed.tag} ${landed.href})`, landed.inPanel);
}

section('a menu entry lands on the catalogue already filtered');
{
  for (const [label, kind] of [['Questions', 'questions'], ['Coding exercises', 'code']]) {
    await open('#/');
    await page.hover('#contentBtn');
    await page.waitForTimeout(350);
    await page.locator('.navmenu-item', { hasText: label }).first().click();
    await page.waitForTimeout(900);
    const m = await page.evaluate(k => ({
      hash: location.hash,
      sel: document.getElementById('fKind').value,
      rows: document.querySelectorAll('#catalogList .prow').length,
      expected: window.SystemsLab.Catalog.all()
        .filter(p => (k === 'code' ? p.type === 'code' : p.type !== 'code')).length,
      count: document.getElementById('catalogCount').textContent,
      menuShut: document.getElementById('contentPanel').hidden,
    }), kind);
    ok(`${label} goes to the catalogue (${m.hash})`, m.hash.includes('kind=' + kind));
    check(`${label}: the filter is set`, m.sel, kind);
    check(`${label}: the list is filtered`, m.rows, m.expected);
    ok(`${label}: and the count says so in English ("${m.count}")`,
      /\d+ (questions|coding exercises)/.test(m.count));
    ok(`${label}: the menu does not follow you there`, m.menuShut);
  }
}

section('the menu says which page you are on');
{
  await open('#/learn');
  await page.hover('#contentBtn');
  await page.waitForTimeout(350);
  const m = await page.evaluate(() => ({
    current: [...document.querySelectorAll('.navmenu-item[aria-current="page"]')]
      .map(a => a.querySelector('.navmenu-title').childNodes[0].textContent.trim()),
    btn: document.getElementById('contentBtn').dataset.active,
  }));
  check('Learn is marked, and only Learn', m.current.join(','), 'Learn');
  check('and the button in the bar is lit', m.btn, 'true');
  await page.keyboard.press('Escape');
}

/* ---------------- "can be solved in" ----------------

   The question the catalogue could not answer before. Most coding
   exercises here are C++ only, and that is on purpose — the exercise IS
   C++. What was missing was any way to find the ones you can write in
   something else, and any way to tell "this is C++ only" apart from
   "Python is broken". */

section('the Language filter means can be solved in, not taught in');
{
  await open('#/problems');
  const offered = await page.evaluate(() => ({
    options: [...document.querySelectorAll('#fLang option')].map(o => o.value),
    labels: [...document.querySelectorAll('#fLang option')].map(o => o.textContent),
  }));
  ok(`it offers the languages problems declare (${offered.labels.join(', ')})`,
    offered.options.includes('cpp') && offered.options.includes('python'));
  ok('each option carries how many, so C++ being most of them is visible '
    + 'before you select it',
    offered.labels.slice(1).every(l => /\(\d+\)$/.test(l)));

  await page.selectOption('#fLang', 'python');
  await page.waitForTimeout(700);
  const py = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('#catalogList .prow .prow-link')]
      .map(a => a.getAttribute('href').replace('#/p/', ''));
    const all = window.SystemsLab.Catalog.all();
    const by = Object.fromEntries(all.map(p => [p.id, p]));
    return {
      rows: ids,
      notCode: ids.filter(id => (by[id] || {}).type !== 'code'),
      count: document.getElementById('catalogCount').textContent,
      real: all.filter(p => (p.langs || []).includes('python')).map(p => p.id),
    };
  });
  check('it lists exactly the problems that declare Python',
    py.rows.slice().sort(), py.real.slice().sort());
  ok(`and it found some (${py.rows.length})`, py.rows.length > 0);
  check('a question declares no language, so none is listed', py.notCode, []);
  ok(`the count calls them coding exercises ("${py.count}")`,
    /coding exercises/.test(py.count));

  /* A topic whose exercises are all C++, plus Python selected, is the empty
     case — and the message has to say why rather than "clear a filter". */
  await page.selectOption('#fTopic', 'cpp');
  await page.waitForTimeout(700);
  const empty = await page.evaluate(() => ({
    rows: document.querySelectorAll('#catalogList .prow').length,
    text: (document.querySelector('#catalogList .empty') || {}).textContent || '',
  }));
  check('C++ fundamentals has no Python exercise', empty.rows, 0);
  ok('and the empty state says it is the exercise, not the install',
    /property of the exercise/i.test(empty.text));

  await page.locator('#fClear').click();
  await page.waitForTimeout(400);
  check('Clear clears it too',
    await page.evaluate(() => document.getElementById('fLang').value), '');
}

section('the route carries the language, so the filter can be linked to');
{
  /* A cold load, not a hash change from a catalogue that has already
     built its options. The <select> is empty until the catalogue first
     paints, and setting a value an option does not exist for is dropped
     without a word — so this passed from a warm page and failed from a
     pasted link. */
  await page.goto(`${BASE}/#/problems?lang=python`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => ({
    sel: document.getElementById('fLang').value,
    rows: document.querySelectorAll('#catalogList .prow').length,
    real: window.SystemsLab.Catalog.all()
      .filter(p => (p.langs || []).includes('python')).length,
  }));
  check('the control shows it', m.sel, 'python');
  check('and the list is filtered', m.rows, m.real);
}

section('Kind and Subject narrow together, and search overrides both');
{
  await open('#/problems');
  await page.selectOption('#fKind', 'code');
  await page.selectOption('#fSubject', 'maths');
  await page.waitForTimeout(700);
  const both = await page.evaluate(() => ({
    rows: document.querySelectorAll('#catalogList .prow').length,
    count: document.getElementById('catalogCount').textContent,
  }));
  /* No mathematics problem is a coding exercise, so this is the empty
     case — which must say so rather than look broken. */
  ok(`maths + coding is empty, and says so (${both.rows} rows)`,
    both.rows === 0 && /Nothing matches/i.test(
      await page.evaluate(() => document.querySelector('#catalogList .empty').textContent)));

  await page.locator('#fSearch').fill('bayes');
  await page.waitForTimeout(700);
  ok('a search ignores both and finds it anyway', await page.evaluate(() =>
    document.querySelectorAll('#catalogList .prow').length > 0));
  await page.locator('#fClear').click();
  await page.waitForTimeout(400);
  check('clearing restores everything',
    await page.evaluate(() => document.querySelectorAll('#catalogList .prow').length),
    await page.evaluate(() => window.SystemsLab.Catalog.all().length));
}

/* ---------------- the profile menu ---------------- */

section('everything about you is behind the avatar');
await open('#/');
{
  const shut = await page.evaluate(() => ({
    hidden: document.getElementById('meMenu').hidden,
    expanded: document.getElementById('meBtn').getAttribute('aria-expanded'),
  }));
  ok('it starts closed', shut.hidden);
  check('and says so', shut.expanded, 'false');

  await page.locator('#meBtn').click();
  await page.waitForTimeout(300);
  const openState = await page.evaluate(() => ({
    hidden: document.getElementById('meMenu').hidden,
    expanded: document.getElementById('meBtn').getAttribute('aria-expanded'),
    items: [...document.querySelectorAll('#meMenu [role="menuitem"]')]
      .map(a => a.textContent.trim()),
    focused: document.activeElement.textContent.trim(),
    xp: !!document.getElementById('purseXp'),
    role: document.getElementById('meMenu').getAttribute('role'),
  }));
  ok('clicking opens it', !openState.hidden);
  check('and says so', openState.expanded, 'true');
  check('Profile, Shop, Settings', openState.items.join(', '), 'Profile, Shop, Settings');
  check('it is a menu to a screen reader', openState.role, 'menu');
  check('focus moves into it', openState.focused, 'Profile');
  ok('XP and coins came with it', openState.xp);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'me-menu.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => ({
    hidden: document.getElementById('meMenu').hidden,
    onButton: document.activeElement.id,
  }));
  ok('Escape closes it', closed.hidden);
  check('and puts focus back on the button', closed.onButton, 'meBtn');

  await page.locator('#meBtn').click();
  await page.waitForTimeout(200);
  await page.mouse.click(400, 500);
  await page.waitForTimeout(250);
  ok('a click outside closes it too',
    await page.evaluate(() => document.getElementById('meMenu').hidden));

  await page.locator('#meBtn').click();
  await page.waitForTimeout(200);
  await page.locator('#meMenu a[href="#/settings"]').click();
  await page.waitForTimeout(600);
  const went = await page.evaluate(() => ({
    hash: location.hash,
    hidden: document.getElementById('meMenu').hidden,
  }));
  check('a menu item navigates', went.hash, '#/settings');
  ok('and shuts the menu on the way', went.hidden);
}

section('the ring is progress to the next rank');
{
  await open('#/');
  const fresh = await page.evaluate(() =>
    document.getElementById('meRing').getAttribute('stroke-dasharray'));
  ok(`a new reader is near zero (${fresh})`, /^(0|[0-9]) 100$/.test(fresh));

  /* Earn some, and it should move. */
  await page.evaluate(() => {
    window.SystemsLab.Store.state.xp = 150;
    window.SystemsLab.UI.paintMe();
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    ring: document.getElementById('meRing').getAttribute('stroke-dasharray'),
    rank: document.getElementById('meRank').textContent,
  }));
  ok(`it moved (${after.ring})`, after.ring !== fresh);
  ok(`and the menu names the rank (${after.rank})`, /Libc|Userland/.test(after.rank));
}

/* ---------------- the rail ---------------- */

section('the week\'s problem is beside the catalogue');
await open('#/problems');
{
  const m = await page.evaluate(() => {
    const rail = document.getElementById('catalogRail');
    const card = rail.querySelector('.action');
    return {
      heads: [...rail.querySelectorAll('.rail-head')].map(h => h.textContent),
      hasCard: !!card,
      href: card && card.querySelector('h2 a').getAttribute('href'),
      start: !!(card && card.querySelector('.action-side a.btn')),
      /* The card carries its own eyebrow; the heading above already says
         This week, so it must not be shown twice. */
      eyebrowShown: card
        && getComputedStyle(card.querySelector('.eyebrow')).display !== 'none',
    };
  });
  ok('the heading says what it is', m.heads.includes('This week'));
  ok('there is a card', m.hasCard);
  ok('pointing at a real problem', /^#\/p\//.test(m.href || ''));
  ok('with a way in', m.start);
  ok('and This week is not written twice', !m.eyebrowShown);
}

section('it stacks under the list rather than squeezing it');
/* The breakpoint is max-width: 1100px, so 1100 itself stacks. */
for (const w of [1500, 1200, 1100, 900, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await open('#/problems', 800);
  const m = await page.evaluate(() => {
    const list = document.querySelector('.plist-main').getBoundingClientRect();
    const rail = document.getElementById('catalogRail').getBoundingClientRect();
    return {
      over: document.documentElement.scrollWidth - window.innerWidth,
      beside: rail.left >= list.right - 1,
      railWide: rail.width > 120,
    };
  });
  ok(`${w}px: no sideways scroll (${m.over}px)`, m.over <= 2);
  ok(`${w}px: the rail is usable`, m.railWide);
  if (w > 1100) ok(`${w}px: and sits beside the list`, m.beside);
  else ok(`${w}px: and drops below it`, !m.beside);
}
await page.setViewportSize({ width: 1500, height: 1000 });

/* ---------------- the numbers landed somewhere ---------------- */

section('what left the dashboard arrived on Profile');
await open('#/profile');
{
  const m = await page.evaluate(() => ({
    rank: (document.getElementById('profRankName') || {}).textContent,
    next: (document.getElementById('profRankNext') || {}).textContent,
    bar: (document.getElementById('profRankBar') || {}).style.width,
    streak: (document.getElementById('profStreakLine') || {}).textContent,
    cells: document.querySelectorAll('#profHeat i').length,
    caption: (document.getElementById('profHeatCaption') || {}).textContent,
    key: document.querySelectorAll('.heat-key i').length,
    stats: document.querySelectorAll('#profStats .stat').length,
    topics: document.querySelectorAll('#profTopics *').length,
  }));
  ok(`the rank is here (${m.rank})`, !!m.rank);
  ok('with how far to the next one', m.next.length > 0);
  ok('and a bar for it', typeof m.bar === 'string');
  ok(`the streak line came too (${m.streak.slice(0, 32)}…)`, m.streak.length > 10);
  check('the activity grid is 26 weeks', m.cells, 26 * 7);
  ok('it says what it shows', m.caption.length > 20);
  check('and keeps its legend, so the colours mean something', m.key, 5);
  ok('the stat row is here', m.stats > 0);
  ok('and the per-topic breakdown', m.topics > 0);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'profile.png') });
}

section('no uncaught errors');
ok(errors.length ? errors.join(' | ').slice(0, 200) : 'none', errors.length === 0);

await browser.close();
report('browser/landing');
