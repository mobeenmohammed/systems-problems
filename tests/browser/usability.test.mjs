/* The small things that make a page feel broken.

   None of these is the headline bug. All of them are the kind of thing that
   leaves somebody stuck with no way forward and no idea why: a button that
   stays greyed out after a failure, a result from the problem before last, a
   toolbar that has walked off the edge of the window.

   Needs the site served:   npm run serve
   Run: node tests/browser/usability.test.mjs */

import { chromium } from 'playwright';

import { section, check, ok, report, toEditorTab } from '../harness.mjs';

/* The language is a dropdown in the tab strip now, not a row of tabs, so
   choosing one means opening it first - which is what a person does too. */
const pickLang = async (p, id) => {
  await p.locator('.lang-pick-btn').click();
  await p.waitForTimeout(150);
  await p.locator(`.lang-opt[data-lang="${id}"]`).click();
  await p.waitForTimeout(400);
};

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
    localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
    localStorage.removeItem('invariant/hosted-url');
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
    check(`and says Run, not "Running…" (${state.runLabel})`, state.runLabel, 'Run tests');
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

  /* A run puts the reader in front of the results, which is a different
     tab from the editor now. Going back to it is what a person does too. */
  await p.locator('.ws-tabs-work .tab[data-tab="editor"]').click();
  await p.waitForTimeout(250);
  await toEditorTab(p);
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
  await toEditorTab(page);
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

/* ---------------- what the picker says, and does not hide ----------------

   "Python does not appear in the dropdown" turned out to be two different
   true things wearing one symptom: on the 17 exercises that declare it,
   Python is there and ready; on the 13 C++ fundamentals exercises it is
   not offered at all, because the exercise is C++. Nothing on screen told
   those apart from a broken runner, which is what these check. */

section('a one-language exercise says so in words');
{
  await open('#/p/cpp-count-digits');
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const only = document.querySelector('.lang-pick-only');
    return {
      lang: document.querySelector('.lang-pick').dataset.lang,
      name: (document.querySelector('.lang-pick-name') || {}).textContent,
      only: only && getComputedStyle(only).display !== 'none' ? only.textContent : null,
      caret: !!document.querySelector('.lang-pick .lang-caret'),
      title: (document.querySelector('.lang-pick-btn') || {}).title,
    };
  });
  check('it is C++', m.lang, 'cpp');
  check('and the word "only" is on screen, not in a tooltip', m.only, 'only');
  ok('with no caret, because there is nothing to open', !m.caret);
  ok('and the tooltip says whose property that is',
    /property of the exercise/.test(m.title || ''));
}

section('a Python exercise offers Python, and says where it would run');
{
  await open('#/p/algo-impl-count');
  await page.waitForTimeout(1200);
  await page.locator('.lang-pick-btn').click();
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('.lang-opt')].map(o => ({
      lang: o.dataset.lang,
      ready: o.dataset.ready,
      disabled: o.disabled,
      name: (o.querySelector('.lang-opt-name') || {}).textContent,
      note: (o.querySelector('.lang-opt-note') || {}).textContent,
    })),
  }));
  const py = m.opts.find(o => o.lang === 'python');
  ok(`both languages are listed (${m.opts.map(o => o.lang).join(', ')})`,
    m.opts.length === 2);
  ok('Python is one of them', !!py);
  check('it is ready', py.ready, 'true');
  ok(`and the option says where it runs ("${py.note}")`,
    /Browser/.test(py.note || ''));
  check('no option is disabled', m.opts.filter(o => o.disabled).length, 0);
  await page.keyboard.press('Escape');
}

section('the whole menu is on screen, not clipped by the strip it hangs from');
{
  /* The strip used to scroll sideways, and a scroll container clips its
     children on both axes — CSS computes overflow-y to `auto` the moment
     overflow-x is not `visible`. So the menu was cut off below the first
     option and looked like a menu with one entry. Nothing in the DOM says
     so, which is why this is a hit test. */
  await open('#/p/algo-running-max');
  await page.waitForTimeout(1500);
  await page.locator('.lang-pick-btn').click();
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const menu = document.querySelector('.lang-menu');
    const opts = [...menu.querySelectorAll('.lang-opt')];
    const r = menu.getBoundingClientRect();
    const hit = o => {
      const b = o.getBoundingClientRect();
      const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!(at && (at === o || o.contains(at)));
    };
    return {
      options: opts.length,
      clickable: opts.filter(hit).length,
      onScreen: r.bottom <= window.innerHeight + 1 && r.top >= -1,
      /* Taller than one row, which is what a clipped menu looked like. */
      height: Math.round(r.height),
    };
  });
  ok(`every option is reachable (${m.clickable} of ${m.options})`,
    m.options >= 3 && m.clickable === m.options);
  ok('the menu fits on screen', m.onScreen);
  ok(`and it is as tall as its contents (${m.height}px)`, m.height > 100);
  await page.keyboard.press('Escape');
}

section('a language nothing can run is still offered, with the reason');
{
  /* Rust has no in-browser runner, so on a deployed page every Rust
     exercise is in exactly this state. The option must not vanish and
     must not be a dead button: it is how you read the template and see
     what to do next. */
  await open('#/p/algo-running-max');
  await page.waitForTimeout(1500);
  await page.locator('.lang-pick-btn').click();
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('.lang-opt')].map(o => ({
      lang: o.dataset.lang,
      ready: o.dataset.ready,
      disabled: o.disabled,
      note: (o.querySelector('.lang-opt-note') || {}).textContent,
      title: o.title,
    })),
  }));
  const rust = m.opts.find(o => o.lang === 'rust');
  ok('Rust is listed', !!rust);
  check('it is not pretending to be ready', rust.ready, 'false');
  ok('it is not disabled either', !rust.disabled);
  ok(`the note names the problem ("${rust.note}")`, /runner/.test(rust.note || ''));
  ok('and the tooltip names the next action',
    /Running code/.test(rust.title || ''));
  await page.keyboard.press('Escape');

  /* And choosing it works: the template appears, the draft saves, and the
     bar says it cannot run rather than failing on the click. */
  await page.locator('.lang-pick-btn').click();
  await page.waitForTimeout(200);
  await page.locator('.lang-opt[data-lang="rust"]').click();
  await page.waitForTimeout(1800);
  const picked = await page.evaluate(() => ({
    lang: document.querySelector('.lang-pick').dataset.lang,
    name: (document.querySelector('.lang-pick-name') || {}).textContent,
    doc: document.querySelector('.cm-content').textContent,
    chip: (document.getElementById('execState') || {}).textContent,
    setup: !(document.getElementById('setupLink') || { hidden: true }).hidden,
  }));
  check('it switched', picked.lang, 'rust');
  check('and the button renamed', picked.name, 'Rust');
  ok(`the Rust template is in the editor (${picked.doc.length} chars)`,
    /fn main/.test(picked.doc));
  ok(`the bar says it cannot run ("${picked.chip}")`, /No runner/.test(picked.chip || ''));
  ok('and offers the way out', picked.setup);
}

section('switching language mid-run does not mix the two up');
{
  await open('#/p/algo-running-max');
  await page.locator('#runBtn').click();
  await page.waitForTimeout(120);
  await pickLang(page, 'js');
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => ({
    lang: document.querySelector('.lang-pick').dataset.lang,
    chip: (document.getElementById('execState') || {}).textContent,
    runEnabled: !document.getElementById('runBtn').disabled,
  }));
  check('JavaScript is the selected language', state.lang, 'js');
  ok(`and the toolbar is not showing the C++ run ("${state.chip}")`,
    !/Ran on/.test(state.chip || ''));
  ok('Run is usable', state.runEnabled);
}

/* ---------------- the bar at the widths people use ---------------- */

section('the bar stays on screen and clickable');
for (const [w, h] of [[1920, 1080], [1536, 864], [1440, 900], [1280, 800], [1152, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await open('#/p/algo-running-max', 900);

  const m = await page.evaluate(() => {
    const bar = document.querySelector('.ws-foot');
    const strip = document.querySelector('.ws-tabs-work');
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
      tabs: inside('.lang-pick'),
      barOverflows: bar.scrollWidth > bar.clientWidth + 2,
      /* The strip is allowed to scroll inside itself; what it may not do
         is push the page sideways. */
      stripFits: strip.getBoundingClientRect().right <= window.innerWidth + 1,
      pageHScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  });
  check(`${w}×${h}: Run`, m.run, 'clickable');
  check(`${w}×${h}: Submit`, m.submit, 'clickable');
  check(`${w}×${h}: the language picker`, m.tabs, 'clickable');
  ok(`${w}×${h}: the bar is not overflowing its own box`, !m.barOverflows);
  ok(`${w}×${h}: and the tab strip fits the column`, m.stripFits);
  ok(`${w}×${h}: and the page does not scroll sideways`, !m.pageHScroll);
}
await page.setViewportSize({ width: 1440, height: 900 });

section('nothing floats over the answer you are trying to click');
/* The Submit bar was `position: sticky; bottom: 0`, which floated it up
   over the answer field directly above it. On a long statement at
   1440x1000, elementFromPoint in the middle of the answer box returned
   DIV.actions-bar: the field could not be clicked at all, and the bar's
   gradient hid what had been typed. A control you can see but not hit is
   worse than one that is plainly absent. */
for (const [w, h] of [[1440, 1000], [1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const id of ['metric-three-metrics-compared', 'prob-bayes-screening',
    'metric-continuity-epsilon-delta', 'cpp-sizeof-and-types']) {
    await open(`#/p/${id}`, 900);
    const m = await page.evaluate(() => {
      const bits = [...document.querySelectorAll(
        '.maths-answer input, .maths-answer textarea, .proof-box, .opt, #submitBtn')];
      return bits.map(n => {
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        /* Only judge what is actually on screen. */
        if (r.bottom < 0 || r.top > window.innerHeight) return null;
        const y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const hit = document.elementFromPoint(r.left + r.width / 2, y);
        return {
          what: `${n.tagName}.${(n.className || '-').split(' ')[0]}`,
          ok: !!(hit && (hit === n || n.contains(hit) || hit.contains(n))),
          covered: hit ? `${hit.tagName}.${(hit.className || '-').split(' ')[0]}` : 'nothing',
        };
      }).filter(Boolean);
    });
    for (const bit of m) {
      ok(`${w}x${h} ${id}: ${bit.what} is clickable where it looks`
        + (bit.ok ? '' : ` — ${bit.covered} is over it`), bit.ok);
    }
  }
}
await page.setViewportSize({ width: 1440, height: 900 });

section('no page-level horizontal overflow anywhere');
/* The tablet widths are in here deliberately. The first version of this
   check sampled 1440, 1024 and 390, and the whole site scrolled sideways
   by 148px at 768 without anything failing: the top bar was a single
   nowrap row down to 680, and the brand, the subject switch, seven view
   links and the purse stopped fitting long before that. */
for (const [w, label] of [[1440, 'desktop'], [1024, 'small laptop'],
  [900, 'tablet'], [820, 'tablet'], [768, 'tablet'], [700, 'tablet'],
  [390, 'phone'], [320, 'narrow phone']]) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const hash of ['#/', '#/problems', '#/tracks', '#/concepts', '#/profile',
    '#/shop', '#/settings', '#/setup', '#/p/algo-running-max', '#/p/cpp-sizeof-and-types',
    '#/p/metric-three-metrics-compared', '#/p/prob-bayes-screening']) {
    await open(hash, 700);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth);
    ok(`${label} ${w}px ${hash}: no sideways scroll (${over}px)`, over <= 2);
  }

  /* Overflowing nothing is not enough on its own: the view links have to
     stay reachable. Either they all fit, or the strip itself scrolls. */
  const nav = await page.evaluate(() => {
    const n = document.querySelector('#nav');
    const last = n.querySelector('a:last-child').getBoundingClientRect();
    return {
      hidden: n.scrollWidth - n.clientWidth,
      scrollable: getComputedStyle(n).overflowX !== 'visible',
      lastInStrip: last.right <= n.getBoundingClientRect().right + 1,
    };
  });
  ok(`${label} ${w}px: every view link is reachable`,
    nav.hidden <= 1 ? nav.lastInStrip : nav.scrollable);
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
  await toEditorTab(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('// this one');
  await page.waitForTimeout(400);

  await page.locator('#resetBtn').click();
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
