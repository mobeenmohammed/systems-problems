/* The small things that make a page feel broken.

   None of these is the headline bug. All of them are the kind of thing that
   leaves somebody stuck with no way forward and no idea why: a button that
   stays greyed out after a failure, a result from the problem before last, a
   toolbar that has walked off the edge of the window.

   Needs the site served:   npm run serve
   Run: node tests/browser/usability.test.mjs */

import { chromium } from 'playwright';

import { section, check, ok, report } from '../harness.mjs';

/* BROWSER=msedge runs the whole suite through the Edge installed on this
   machine rather than Playwright's bundled Chromium. Same engine, different
   build and different default settings — and Edge on Windows is what this
   site is actually read in. */
const CHANNEL = process.env.BROWSER || null;
const launch = () => chromium.launch(CHANNEL ? { channel: CHANNEL } : {});

const BASE = process.env.BASE || 'http://127.0.0.1:8000';

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
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

const open = async (hash, wait = 1100) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* ---------------- buttons that never come back ---------------- */

section('a failed run never leaves the button disabled');
{
  /* Execution pointed at a port nothing serves, so every Run fails. */
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => {
    localStorage.setItem('systems-lab/judge-url', 'http://127.0.0.1:2999');
    localStorage.removeItem('systems-lab/hosted-url');
  });
  await p.goto(`${BASE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1600);

  for (let i = 1; i <= 3; i += 1) {
    await p.locator('#runBtn').click();
    await p.waitForTimeout(1600);
    const state = await p.evaluate(() => {
      const r = document.getElementById('runBtn');
      const s = document.getElementById('submitBtn');
      return { run: r.disabled, runLabel: r.textContent, submit: s.disabled };
    });
    check(`Run is usable again after failure ${i}`, state.run, false);
    check(`and says Run, not "Running…" (${state.runLabel})`, state.runLabel, 'Run samples');
    check('Submit is live too', state.submit, false);
  }

  /* An untouched template is not an attempt, so it has to be changed before
     Submit does anything — and being told so, accurately, is itself worth
     checking. */
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(500);
  const untouched = await p.evaluate(() =>
    (document.querySelector('.needs-answer') || {}).textContent || '');
  ok(`an untouched template says exactly that ("${untouched.slice(0, 48)}…")`,
    /starting template/i.test(untouched));

  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+End');
  await p.keyboard.type('\n// mine');
  await p.waitForTimeout(400);
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(2600);
  const after = await p.evaluate(() => ({
    submit: document.getElementById('submitBtn').disabled,
    label: document.getElementById('submitBtn').textContent,
    verdict: (document.querySelector('.verdict h4') || {}).textContent || null,
    status: window.SystemsLab.Store.record('algo-running-max').status,
  }));
  check('Submit comes back after a failed submission', after.submit, false);
  check('with its own label', after.label, 'Submit');
  ok(`it is reported as not having run ("${after.verdict}")`, /could not run/i.test(after.verdict || ''));
  check('and nothing was recorded against the problem', after.status, 'unsolved');
  await p.close();
}

/* ---------------- a result that belongs to another problem ---------------- */

section('a run in flight cannot land on the next problem');
{
  await open('#/p/algo-running-max');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('int main(){}');
  await page.waitForTimeout(300);

  /* Start it, then leave immediately. */
  await page.locator('#runBtn').click();
  await page.waitForTimeout(120);
  await page.evaluate(() => { location.hash = '#/p/cpp-greet-and-sum'; });
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => ({
    title: (document.querySelector('.ws-head h1') || {}).textContent,
    cases: document.querySelectorAll('.case[data-pass]').length,
    chip: (document.getElementById('execState') || {}).textContent,
    doc: window.SystemsLab.ProblemTypes.get('code').editor().value,
  }));
  ok(`the new problem is showing ("${state.title}")`,
    (state.title || '').length > 5 && !/running maximum/i.test(state.title));
  check('with no results carried over from the old one', state.cases, 0);
  ok(`and the chip is not claiming a run that was not this one ("${state.chip}")`,
    !/^Ran on/.test(state.chip || ''));
  ok('the editor holds the new problem\'s code', !state.doc.includes('int main(){}')
    || state.doc.length > 20);
}

section('switching language mid-run does not mix the two up');
{
  await open('#/p/algo-running-max');
  await page.locator('#runBtn').click();
  await page.waitForTimeout(120);
  await page.locator('.lang-tab[data-lang="js"]').click();
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => ({
    lang: document.querySelector('.lang-tab[aria-pressed="true"]').dataset.lang,
    chip: (document.getElementById('execState') || {}).textContent,
    runEnabled: !document.getElementById('runBtn').disabled,
  }));
  check('JavaScript is the selected language', state.lang, 'js');
  ok(`and the toolbar is not showing the C++ run ("${state.chip}")`,
    !/Ran on/.test(state.chip || ''));
  ok('Run is usable', state.runEnabled);
}

/* ---------------- the toolbar at the widths people use ---------------- */

section('the toolbar stays on screen and clickable');
for (const [w, h] of [[1920, 1080], [1536, 864], [1440, 900], [1280, 800], [1152, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await open('#/p/algo-running-max', 900);

  const m = await page.evaluate(() => {
    const bar = document.querySelector('.ws-toolbar');
    const inside = sel => {
      const n = document.querySelector(sel);
      if (!n || n.hidden) return 'absent';
      const r = n.getBoundingClientRect();
      if (r.width === 0) return 'collapsed';
      if (r.right > window.innerWidth + 1 || r.left < -1) return 'off-screen';
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && (hit === n || n.contains(hit)) ? 'clickable' : 'covered';
    };
    return {
      run: inside('#runBtn'),
      submit: inside('#submitBtn'),
      tabs: inside('.lang-tab[data-lang="cpp"]'),
      barOverflows: bar.scrollWidth > bar.clientWidth + 2,
      pageHScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  });
  check(`${w}×${h}: Run`, m.run, 'clickable');
  check(`${w}×${h}: Submit`, m.submit, 'clickable');
  check(`${w}×${h}: the language tabs`, m.tabs, 'clickable');
  ok(`${w}×${h}: the toolbar is not overflowing its own box`, !m.barOverflows);
  ok(`${w}×${h}: and the page does not scroll sideways`, !m.pageHScroll);
}
await page.setViewportSize({ width: 1440, height: 900 });

section('no page-level horizontal overflow anywhere');
for (const [w, label] of [[1440, 'desktop'], [1024, 'small laptop'], [390, 'phone']]) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const hash of ['#/', '#/problems', '#/tracks', '#/concepts', '#/profile',
    '#/shop', '#/settings', '#/setup', '#/p/algo-running-max', '#/p/cpp-sizeof-and-types']) {
    await open(hash, 700);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth);
    ok(`${label} ${hash}: no sideways scroll (${over}px)`, over <= 2);
  }
}
await page.setViewportSize({ width: 1440, height: 900 });

/* ---------------- the keyboard ---------------- */

section('hints, notes and the solution are reachable by keyboard');
{
  await open('#/p/algo-running-max');

  /* Tab strips are buttons, so they must take focus and act on Enter. */
  const reachable = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.ws-left .tab')];
    return tabs.map(t => ({ label: t.textContent.trim().slice(0, 12), tabbable: t.tabIndex >= 0 }));
  });
  ok(`every left-hand tab is in the tab order (${reachable.length} of them)`,
    reachable.length >= 4 && reachable.every(t => t.tabbable));

  await page.locator('.ws-left .tab[data-tab="hints"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const onHints = await page.evaluate(() =>
    !!document.querySelector('.ws-left .tab[data-tab="hints"][aria-selected="true"]'));
  ok('Enter opens the Hints tab', onHints);

  /* The hint itself has to be openable without a mouse. */
  const hintOk = await page.evaluate(async () => {
    const btn = document.querySelector('#leftPane button, #leftPane summary');
    if (!btn) return 'no control';
    btn.focus();
    if (document.activeElement !== btn) return 'cannot focus';
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    return 'ok';
  });
  check('and a hint can be taken from the keyboard', hintOk, 'ok');

  await page.locator('.ws-left .tab[data-tab="notes"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const notesEditable = await page.evaluate(() => {
    const box = document.querySelector('#leftPane textarea');
    if (!box) return false;
    box.focus();
    return document.activeElement === box;
  });
  ok('the Notes box takes focus', notesEditable);

  const locked = await page.evaluate(() => {
    const t = document.querySelector('.ws-left .tab[data-tab="solution"]');
    return { exists: !!t, tabbable: t && t.tabIndex >= 0, locked: t && t.dataset.locked === 'true' };
  });
  ok('the Solution tab is focusable even while locked', locked.exists && locked.tabbable);
  ok('and is still marked locked', locked.locked);
}

/* ---------------- resetting is narrow ---------------- */

section('resetting the editor touches nothing else');
{
  await open('#/p/algo-running-max');
  page.on('dialog', d => d.accept());

  await page.evaluate(() => {
    window.SystemsLab.Store.saveDraft({ id: 'cpp-greet-and-sum', topic: 'cpp',
      difficulty: 'beginner', type: 'code' }, 'cpp', '// another problem\'s draft');
  });
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('// this one');
  await page.waitForTimeout(400);

  await page.locator('.editor-tools button').first().click();
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    here: window.SystemsLab.ProblemTypes.get('code').editor().value,
    other: window.SystemsLab.Store.draft('cpp-greet-and-sum', 'cpp'),
    xp: window.SystemsLab.Store.state.xp,
  }));
  ok('this editor went back to the template', !after.here.includes('// this one')
    && after.here.length > 20);
  check('the other problem\'s draft is untouched', after.other, "// another problem's draft");
  ok('and progress is intact', typeof after.xp === 'number');
}

check('no uncaught errors', errors, []);
await browser.close();
report('browser/usability');
