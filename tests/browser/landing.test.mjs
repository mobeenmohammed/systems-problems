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

/* ---------------- the landing page ---------------- */

section('the landing page is doors, not a dashboard');
await open('#/');
{
  const m = await page.evaluate(() => ({
    doors: [...document.querySelectorAll('#landingGrid .door')].map(d => ({
      title: d.querySelector('h3').textContent,
      href: d.getAttribute('href'),
      count: (d.querySelector('.door-count') || {}).textContent || '',
      blurb: (d.querySelector('.door-blurb') || {}).textContent || '',
    })),
    carryOn: !!document.querySelector('#landingContinue .action'),
    /* The things that moved out. */
    gone: ['homeRank', 'homeStats', 'homeHeat', 'homeTopics', 'homeActions', 'homeTracks']
      .filter(id => document.getElementById(id)),
    nav: [...document.querySelectorAll('#nav a')].map(a => a.textContent.trim()),
  }));

  check('four doors', m.doors.length, 4);
  check('Questions, Coding exercises, Learn, Shop',
    m.doors.map(d => d.title).join(', '),
    'Questions, Coding exercises, Learn, Shop');
  ok('each goes somewhere real', m.doors.every(d => /^#\//.test(d.href)));
  ok('each says how far through it you are',
    m.doors.every(d => /\d+\s*\/\s*\d+/.test(d.count)));
  ok('and each says what it is for', m.doors.every(d => d.blurb.length > 40));
  ok('one thing to carry on with', m.carryOn);
  check('nothing from the dashboard was left behind', m.gone, []);
  check('and the top bar is down to two entries', m.nav.join(', '), 'Problems, Learn');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'landing.png') });
}

section('the two problem doors are the catalogue, split');
{
  const counts = await page.evaluate(() => {
    const all = window.SystemsLab.Catalog.all();
    const door = t => [...document.querySelectorAll('#landingGrid .door')]
      .find(d => d.querySelector('h3').textContent === t);
    const total = d => Number((d.querySelector('.door-count').textContent.split('/')[1] || '').trim());
    return {
      questions: total(door('Questions')),
      coding: total(door('Coding exercises')),
      realQuestions: all.filter(p => p.type !== 'code').length,
      realCoding: all.filter(p => p.type === 'code').length,
    };
  });
  check('Questions counts the non-code problems', counts.questions, counts.realQuestions);
  check('Coding exercises counts the code ones', counts.coding, counts.realCoding);
  ok('and together they are the whole catalogue',
    counts.questions + counts.coding === await page.evaluate(
      () => window.SystemsLab.Catalog.all().length));
}

section('a door lands on the catalogue already filtered');
{
  for (const [title, kind, want] of [
    ['Questions', 'questions', p => p.type !== 'code'],
    ['Coding exercises', 'code', p => p.type === 'code'],
  ]) {
    await open('#/');
    await page.locator('#landingGrid .door', { hasText: title }).first().click();
    await page.waitForTimeout(900);
    const m = await page.evaluate(k => ({
      hash: location.hash,
      sel: document.getElementById('fKind').value,
      rows: document.querySelectorAll('#catalogList .prow').length,
      expected: window.SystemsLab.Catalog.all()
        .filter(p => (k === 'code' ? p.type === 'code' : p.type !== 'code')).length,
      count: document.getElementById('catalogCount').textContent,
    }), kind);
    ok(`${title} goes to the catalogue (${m.hash})`, m.hash.includes('kind=' + kind));
    check(`${title}: the filter is set`, m.sel, kind);
    check(`${title}: the list is filtered`, m.rows, m.expected);
    ok(`${title}: and the count says so in English ("${m.count}")`,
      /\d+ (questions|coding exercises)/.test(m.count));
  }
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
