/* Navigating away from a problem, and the layout it leaves behind.

   The reported failure: "after navigating between tabs/pages the site
   sometimes expands across the screen, clips content and becomes
   unresponsive". It is not zoom and it is not intermittent — it is
   deterministic, and it is two attributes that are set when a code problem
   opens and never cleared when you leave it:

     body[data-workspace="true"]   .main becomes padding:0, max-width:none,
                                   height:100vh-header, overflow:hidden
     html[data-focus]              the whole top bar is display:none

   Both are correct on a problem page and wrong everywhere else. Measured on
   the dashboard after one click: 1270px of content inside an 848px box with
   overflow hidden and no scrollbar. On the reading map, 29869px inside 848.
   The content below the fold is simply unreachable, which is what
   "unresponsive" means here — the page is not frozen, the rest of it has been
   cut off and there is no way to scroll to it.

   So this suite measures the destination page rather than the problem page,
   and it does it through real clicks on the real navigation.

   Needs the site served:   npm run serve
   Run: node tests/browser/navigation.test.mjs
        SHOTS=1 ... (also write screenshots) */

import { chromium } from 'playwright';

import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

/* BROWSER=msedge runs the whole suite through the Edge installed on this
   machine rather than Playwright's bundled Chromium. Same engine, different
   build and different default settings — and Edge on Windows is what this
   site is actually read in. */
const CHANNEL = process.env.BROWSER || null;
const launch = () => chromium.launch(CHANNEL ? { channel: CHANNEL } : {});

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

const browser = await launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  /* Two things the browser says that are it working correctly, not the page
     failing: nothing is listening on the runner's port, and — on the
     published https site — Chrome refusing the page access to a loopback
     address until the reader grants Local Network Access. */
  if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback/
    .test(m.text())) return;
  errors.push(m.text());
});

const settle = (ms = 650) => page.waitForTimeout(ms);
const open = async hash => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await settle(900);
};
const navClick = async href => {
  await page.locator(`.topbar a[href="${href}"]`).first().click();
  await settle();
};

/* Everything about the destination that the leak would spoil. */
const destination = () => page.evaluate(() => {
  const main = document.querySelector('.main');
  const view = document.querySelector('.view:not([hidden])');
  const cs = getComputedStyle(main);
  return {
    view: view && view.id,
    workspaceFlag: document.body.dataset.workspace || null,
    focusFlag: document.documentElement.hasAttribute('data-focus'),
    overflow: cs.overflow,
    padding: cs.paddingLeft,
    /* The test that matters: is any of the page unreachable? Either the
       content fits, or something can scroll to the rest of it. */
    reachable: main.scrollHeight <= main.clientHeight + 2
      || main.scrollHeight > main.clientHeight + 2
        && (cs.overflowY === 'auto' || cs.overflowY === 'scroll'
          || document.documentElement.scrollHeight > window.innerHeight + 2),
    hiddenBelowTheFold: main.scrollHeight - main.clientHeight,
    navVisible: !!document.querySelector('.topbar')
      && getComputedStyle(document.querySelector('.topbar')).display !== 'none',
    dragging: !!document.querySelector('[data-dragging]'),
    /* Anything big, opaque to the pointer and on top of the page. */
    /* What is actually under the pointer in the middle of the page. On a
       short page that is legitimately the page itself, so the containers
       count as "nothing"; anything else sitting on top is the transparent
       layer this is looking for. */
    blockingOverlay: (() => {
      const n = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (!n) return 'nothing is at the centre of the screen';
      if (n.closest('.view') || n.closest('.topbar')) return null;
      if (n === document.body || n === document.documentElement
        || n.classList.contains('main')) return null;
      return `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`;
    })(),
  };
});

/* ---------------- the reported sequence ---------------- */

section('leaving a code problem restores the page you land on');

const DESTINATIONS = [
  ['#/', 'view-home', 'Dashboard'],
  ['#/problems', 'view-problems', 'Problems'],
  ['#/tracks', 'view-tracks', 'Tracks'],
  ['#/concepts', 'view-concepts', 'Reading'],
  ['#/profile', 'view-profile', 'Profile'],
  ['#/settings', 'view-settings', 'Settings'],
];

for (const [href, viewId, label] of DESTINATIONS) {
  await open('#/p/algo-running-max');
  await navClick(href);
  const d = await destination();
  check(`${label}: it is the page that is showing`, d.view, viewId);
  check(`${label}: the workspace layout did not come with it`, d.workspaceFlag, null);
  ok(`${label}: nothing is clipped out of reach (${d.hiddenBelowTheFold}px below the fold)`,
    d.reachable);
  ok(`${label}: the navigation is still there`, d.navVisible);
  check(`${label}: nothing is covering the page`, d.blockingOverlay, null);
}

section('and the page you land on is still usable');
{
  await open('#/p/algo-running-max');
  await navClick('#/problems');

  /* A real click on a real row, with a real timeout: if something invisible
     is over the page this is where it shows up. */
  let went = null;
  try {
    await page.locator('#catalogList .prow-link').first().click({ timeout: 5000 });
    await settle();
    went = await page.evaluate(() => location.hash);
  } catch (err) {
    went = `BLOCKED: ${err.message.split('\n')[0]}`;
  }
  ok(`a problem row can still be clicked (${went})`, /^#\/p\//.test(went || ''));

  /* And scrolling, which is the other half of "unresponsive". */
  await navClick('#/concepts');
  const scrolled = await page.evaluate(async () => {
    const before = window.scrollY + document.querySelector('.main').scrollTop;
    window.scrollBy(0, 600);
    document.querySelector('.main').scrollTop += 600;
    await new Promise(r => setTimeout(r, 120));
    return (window.scrollY + document.querySelector('.main').scrollTop) - before;
  });
  ok(`the reading map scrolls (${scrolled}px)`, scrolled > 100);
}

/* ---------------- focus mode ---------------- */

section('focus mode does not follow you out of the problem');
{
  await open('#/p/algo-running-max');
  await page.keyboard.press('f');
  await settle(400);
  const inProblem = await destination();
  ok('focus mode hides the navigation while you are in the problem',
    inProblem.focusFlag && !inProblem.navVisible);

  await page.evaluate(() => { location.hash = '#/'; });
  await settle();
  const after = await destination();
  check('and the attribute is gone once you leave', after.focusFlag, false);
  ok('so the navigation is back', after.navVisible);
  ok('and the dashboard is not clipped', after.reachable);

  /* The preference is the reader's, so going back to a problem keeps it. */
  await page.evaluate(() => { location.hash = '#/p/algo-running-max'; });
  await settle(900);
  const back = await destination();
  ok('returning to a problem restores the reader\'s focus-mode choice', back.focusFlag);
  await page.keyboard.press('f');
  await settle(400);
}

/* ---------------- a drag that never ends ---------------- */

section('dragging a divider and navigating away mid-drag');
{
  await open('#/p/algo-running-max');
  const g = await page.locator('.ws-gutter').boundingBox();
  ok('there is a divider to drag', !!g);

  await page.mouse.move(g.x + g.width / 2, g.y + 300);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 180, g.y + 300, { steps: 8 });

  /* Leave without ever releasing the button. */
  await page.evaluate(() => { location.hash = '#/'; });
  await settle();
  await page.mouse.up();
  await settle(300);

  const d = await destination();
  check('no element is left marked as dragging', d.dragging, false);
  check('and nothing transparent is left over the page', d.blockingOverlay, null);
  ok('the dashboard is intact', d.reachable && d.navVisible);

  let went = null;
  try {
    await page.locator('.topbar a[href="#/problems"]').first().click({ timeout: 5000 });
    await settle();
    went = await page.evaluate(() => location.hash);
  } catch (err) { went = `BLOCKED: ${err.message.split('\n')[0]}`; }
  check('and the navigation still responds to a click', went, '#/problems');
}

/* ---------------- back and forward ---------------- */

section('browser Back and Forward');
{
  await open('#/');
  await page.evaluate(() => { location.hash = '#/p/algo-running-max'; });
  await settle(900);
  await page.goBack();
  await settle(900);
  const back = await destination();
  check('Back lands on the dashboard', back.view, 'view-home');
  check('with no workspace layout', back.workspaceFlag, null);
  ok('and nothing clipped', back.reachable);

  await page.goForward();
  await settle(900);
  const fwd = await page.evaluate(() => ({
    view: (document.querySelector('.view:not([hidden])') || {}).id,
    workspace: document.body.dataset.workspace,
    editors: document.querySelectorAll('.cm-editor').length,
  }));
  check('Forward goes back into the problem', fwd.view, 'view-problem');
  check('and the workspace layout comes back with it', fwd.workspace, 'true');
  check('with exactly one editor, not two', fwd.editors, 1);
}

/* ---------------- repeated navigation ---------------- */

section('thirty crossings, which is what the reader actually did');
{
  const route = ['#/p/algo-running-max', '#/', '#/p/cpp-sizeof-and-types', '#/tracks',
    '#/p/algo-running-max', '#/concepts', '#/p/cpp-greet-and-sum', '#/settings',
    '#/problems', '#/p/algo-running-max'];
  for (let i = 0; i < 3; i += 1) {
    for (const hash of route) {
      await page.evaluate(h => { location.hash = h; }, hash);
      await page.waitForTimeout(260);
    }
  }
  await settle(900);
  await page.evaluate(() => { location.hash = '#/'; });
  await settle(900);

  const d = await destination();
  const leaked = await page.evaluate(() => ({
    editors: document.querySelectorAll('.cm-editor').length,
    hosts: document.querySelectorAll('.ed-host').length,
    workspaces: document.querySelectorAll('.ws').length,
  }));
  check('still the dashboard, still laid out as one', d.view, 'view-home');
  check('no workspace flag after thirty crossings', d.workspaceFlag, null);
  ok('nothing clipped', d.reachable);
  check('no editor was left behind in the DOM', leaked.editors, 0);
  check('nor a workspace frame', leaked.workspaces, 0);
  if (process.env.SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'after-nav-dashboard.png') });
  }
}

/* ---------------- drafts ---------------- */

section('drafts survive all of that');
{
  await open('#/p/algo-running-max');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('// a draft that must survive');
  await settle(500);

  for (const hash of ['#/', '#/tracks', '#/concepts', '#/settings', '#/problems']) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => { location.hash = '#/p/algo-running-max'; });
  await settle(1000);

  const doc = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  ok(`the draft came back ("${doc.slice(0, 32)}")`, doc.includes('a draft that must survive'));

  await page.reload({ waitUntil: 'networkidle' });
  await settle(1100);
  const afterReload = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  ok('and survives a reload', afterReload.includes('a draft that must survive'));
}

check('no uncaught errors during any of it', errors, []);
await browser.close();
report('browser/navigation');
