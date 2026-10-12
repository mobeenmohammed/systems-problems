/* The audit: the journey the site is for, end to end, and the handful
   of things that have actually gone wrong here before.

   The brief this was written against describes one journey —

     learn a concept -> practise -> understand the mistake ->
     revisit the weak area -> test yourself

   — and every other suite tests one leg of it in isolation. This one
   walks the whole thing in a single browser, in order, because the
   bugs that survive isolated tests are the ones in the joins: a mode
   flag that outlives its mode, a result that lands on the next page, a
   draft that one feature saves and another overwrites.

   And then it re-checks, cheaply and across every route, the three
   failures that have each happened here more than once:

     · a full-bleed layout following the reader to the next page
     · something typed being rendered as markup
     · a stale result or clock writing to a page it does not belong to

   Needs the site served:   npm run serve

   Run: node tests/browser/audit.test.mjs
        SHOTS=1 ... (also write screenshots) */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report, toEditorTab } from '../harness.mjs';

const CHANNEL = process.env.BROWSER || null;
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not being served at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback/.test(m.text())) return;
  errors.push(m.text());
});
page.on('dialog', d => d.accept());
await page.addInitScript(() => {
  localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
});

const go = async (hash, wait = 1200) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const settled = async (sel = '#submitBtn', ms = 180_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(s => {
      const b = document.querySelector(s);
      return !!b && !b.disabled;
    }, sel)) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

/* ================= the journey ================= */

section('1. learn a concept: the graph says what rests on what');
{
  await go('#/learn', 1400);
  ok('the index is a card page', await page.evaluate(() =>
    document.querySelectorAll('.track-card').length > 5
    && !document.body.dataset.graph));

  await page.locator('.track-card').first().click();
  await page.waitForTimeout(1800);
  const g = await page.evaluate(() => ({
    graph: document.body.dataset.graph,
    nodes: document.querySelectorAll('.lnode').length,
    required: (document.getElementById('learnProgress') || {}).textContent || '',
  }));
  check('opening one is a workspace', g.graph, 'true');
  ok(`with the concepts on it (${g.nodes})`, g.nodes > 3);
  /* The count that means "finishing this track", not everything the
     tree can reach. */
  ok(`and the progress is the required work ("${g.required}")`,
    /required solved/.test(g.required));

  await page.locator('.lnode').first().click();
  await page.waitForTimeout(900);
  const panel = await page.evaluate(() => ({
    open: !document.getElementById('learnPanel').hidden,
    heads: [...document.querySelectorAll('.lpanel-sub span:first-child')].map(s => s.textContent),
    practise: (document.querySelector('.lpanel-next .btn') || {}).getAttribute?.('href') || '',
  }));
  ok('a concept opens a panel', panel.open);
  ok(`with its work in named lists (${panel.heads.join(', ')})`,
    panel.heads.includes('Resources'));
  ok(`and a direct way to practise it (${panel.practise})`,
    /^#\/p\//.test(panel.practise));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'audit-1-learn.png') });
}

section('2. practise: the exercise it sent you to');
let PRACTISED = null;
{
  const href = await page.evaluate(() =>
    (document.querySelector('.lpanel-next .btn') || {}).getAttribute('href'));
  PRACTISED = href.replace('#/p/', '');
  await page.locator('.lpanel-next .btn').click();
  await page.waitForTimeout(2200);
  const m = await page.evaluate(() => ({
    hash: location.hash,
    graph: document.body.dataset.graph || null,
    widget: !!document.getElementById('answerWidget'),
  }));
  ok(`it opened the problem (${m.hash})`, m.hash.includes(PRACTISED));
  /* The one that has gone wrong here three times. */
  check('and the graph layout did not come with it', m.graph, null);
  ok('the problem is answerable', m.widget);
}

section('3. understand the mistake: wrong, and told why, and told nothing else');
{
  const type = await page.evaluate(id => (window.SystemsLab.Catalog.meta(id) || {}).type, PRACTISED);
  /* Something wrong, whatever kind of problem it is. */
  if (type === 'mcq' || type === 'multi') {
    await page.locator('#answerWidget input').last().check();
  } else if (type === 'code') {
    await toEditorTab(page);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.evaluate(() => navigator.clipboard.writeText('print("definitely not it")\n'));
    await page.keyboard.press('Control+V');
  } else {
    const box = page.locator('#answerWidget textarea, #answerWidget input[type="text"]').first();
    if (await box.count()) await box.fill('definitely not it');
  }
  await page.locator('#submitBtn').click();
  ok('it came back', await settled());
  await page.waitForTimeout(800);

  const m = await page.evaluate(id => {
    const r = window.SystemsLab.Store.record(id);
    return {
      verdict: (document.querySelector('.verdict h4') || {}).textContent,
      reason: (document.querySelector('.verdict p') || {}).textContent || '',
      revealed: r.revealed,
      status: r.status,
      solutionShown: !!document.querySelector('#leftPane .solution-body, #leftPane h2'),
      missedBox: !!document.querySelector('.missed-box'),
    };
  }, PRACTISED);
  ok(`it is marked wrong ("${m.verdict}")`, m.verdict && m.verdict !== 'Right');
  ok(`with a reason (${m.reason.length} characters)`, m.reason.length > 20);
  check('nothing was revealed', m.revealed, false);
  ok('and it is not recorded as solved', m.status !== 'solved');
  /* The one line, asked while you still know. */
  ok('and it asks what you missed', m.missedBox);

  await page.locator('.missed-box').fill('I did not read the second condition.');
  await page.waitForTimeout(700);
  check('which is stored',
    await page.evaluate(id => window.SystemsLab.Store.record(id).missed, PRACTISED),
    'I did not read the second condition.');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'audit-3-wrong.png') });
}

section('4. revisit: it is on the list, with the reason, in your words');
{
  await go('#/review', 1200);
  const m = await page.evaluate(id => {
    const row = [...document.querySelectorAll('.rq-row')]
      .find(r => r.querySelector('.rq-title a').getAttribute('href') === `#/p/${id}`);
    return {
      there: !!row,
      reason: row && row.dataset.reason,
      why: row && (row.querySelector('.rq-why') || {}).textContent,
      quote: row && (row.querySelector('.rq-missed') || {}).textContent,
      concepts: row ? [...row.querySelectorAll('a[href^="#/concepts"]')].length : 0,
    };
  }, PRACTISED);
  ok('the problem is on the review list', m.there);
  check('because of the note', m.reason, 'missed');
  ok(`and the row says so ("${m.why}")`, (m.why || '').length > 3);
  ok('in your own sentence', /second condition/.test(m.quote || ''));
  ok(`with a way back to the reading (${m.concepts})`, m.concepts > 0);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'audit-4-review.png') });
}

section('5. test yourself: and it is kept apart from all of that');
{
  const before = await page.evaluate(() => ({
    xp: window.SystemsLab.Store.state.xp,
    streak: window.SystemsLab.Store.state.streak.current,
  }));

  await go('#/assess', 1400);
  await page.locator('.oa-card').first().click();
  await page.waitForTimeout(2200);
  ok('the pre-flight says everything first', await page.evaluate(() =>
    document.querySelectorAll('.oa-fact').length >= 5
    && !document.getElementById('oaClock')));

  await page.locator('#oaStart').click();
  await page.waitForTimeout(2400);
  ok('the clock is running', await page.evaluate(() =>
    /^\d+:\d\d$/.test((document.getElementById('oaClock') || {}).textContent || '')));
  ok('and the solution tab is gone', await page.evaluate(() =>
    !document.querySelector('.tab[data-tab="solution"]')));

  await page.locator('#answerWidget textarea').first().fill('true\nfalse\ntrue\nfalse');
  await page.locator('#submitBtn').click();
  await settled();
  await page.waitForTimeout(900);

  await page.locator('#oaFinish').click();
  await page.waitForTimeout(2600);

  const after = await page.evaluate(() => ({
    hash: location.hash,
    score: (document.querySelector('.oa-score-big') || {}).textContent,
    xp: window.SystemsLab.Store.state.xp,
    streak: window.SystemsLab.Store.state.streak.current,
    attemptMode: document.body.dataset.attempt || null,
  }));
  ok(`it finished and scored (${after.score})`, /#\/assess\/review\//.test(after.hash));
  check('the XP did not move', after.xp, before.xp);
  check('nor the streak', after.streak, before.streak);
  /* And the attempt's layout did not follow the reader into the
     results, which it did once. */
  check('and the results page is an ordinary page', after.attemptMode, null);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'audit-5-assess.png') });
}

section('6. and the whole journey left the page working');
{
  await go('#/problems', 1200);
  const m = await page.evaluate(() => {
    const main = document.querySelector('.main');
    const cs = getComputedStyle(main);
    return {
      flags: [document.body.dataset.workspace, document.body.dataset.graph,
        document.body.dataset.attempt].filter(Boolean),
      maxW: cs.maxWidth,
      overflow: cs.overflow,
      rows: document.querySelectorAll('#catalogList .prow').length,
    };
  });
  check('no mode flag survived', m.flags, []);
  ok(`.main is a document (${m.maxW}, ${m.overflow})`,
    m.maxW !== 'none' && m.overflow !== 'hidden');
  ok(`and the catalogue is usable (${m.rows} rows)`, m.rows > 20);
}

/* ================= the things that keep going wrong ================= */

const ROUTES = ['#/', '#/problems', '#/learn', '#/learn/memory', '#/concepts',
  '#/profile', '#/shop', '#/settings', '#/setup', '#/review', '#/assess',
  '#/tracks', '#/p/cpp-count-digits', '#/p/metric-which-are-metrics'];

/* Three modes take the window: the code workspace, the Learn graph and
   an assessment attempt. Each sets a flag on <body>, and each time one
   has been added it has eventually been left on — the dashboard clipped
   to the window with no scrollbar, then the review page pinned to the
   left edge. So every route is entered from every other and the
   DESTINATION is measured. */
section('no mode flag outlives its mode, from anywhere to anywhere');
{
  const DEEP = new Set(['#/learn/memory']);
  const bad = [];
  for (const from of ROUTES) {
    for (const to of ROUTES) {
      if (from === to) continue;
      await page.goto(`${BASE}/${from}`, { waitUntil: 'commit' });
      await page.waitForTimeout(120);
      await page.goto(`${BASE}/${to}`, { waitUntil: 'commit' });
      await page.waitForTimeout(160);
      const m = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.main'));
        return {
          flags: [document.body.dataset.workspace, document.body.dataset.graph,
            document.body.dataset.attempt].filter(Boolean).join(','),
          maxW: cs.maxWidth,
          overflow: cs.overflow,
        };
      });
      const wantsWindow = to.startsWith('#/p/') || DEEP.has(to);
      const wrong = wantsWindow
        ? false
        : (m.flags || m.maxW === 'none' || m.overflow === 'hidden');
      if (wrong) bad.push(`${from} -> ${to}: ${JSON.stringify(m)}`);
    }
  }
  const n = ROUTES.length * (ROUTES.length - 1);
  check(`${n} route pairs, and the destination is itself every time`, bad.slice(0, 5), []);
}

section('anything you type is text, wherever it is shown again');
{
  const NASTY = '<img src=x onerror="window.__pwned = 1"><b>bold</b>';
  await go('#/', 900);
  await page.evaluate(n => {
    const S = window.SystemsLab;
    const m = S.Catalog.meta('cpp-count-digits');
    S.Store.setNotes(m, n);
    S.Store.setMissed(m, n);
    S.Store.setFlag(m, true);
    /* Through the control a reader actually uses, so this also
       exercises the repaint. */
    S.Store.state.profile.name = n;
    S.Store.save();
    S.UI.paintMe();
  }, NASTY);

  /* Scoped to the node that holds the text, not to the panel around
     it: the avatar menu has two <b> elements of its own for the XP and
     the coins, and counting those would be the test finding itself. */
  for (const [where, hash, sel] of [
    ['the review queue', '#/review', '.rq-missed'],
    ['Profile', '#/profile', '#profName'],
    ['the avatar menu', '#/', '#meName'],
  ]) {
    await go(hash, 1100);
    const m = await page.evaluate(s => {
      const node = document.querySelector(s);
      return {
        pwned: !!window.__pwned,
        found: !!node,
        built: node ? node.querySelectorAll('img, b, script, svg').length : -1,
        shown: node ? node.textContent : '',
      };
    }, sel);
    ok(`${where}: the text is on screen`, m.found);
    check(`${where}: nothing ran`, m.pwned, false);
    check(`${where}: and nothing was built out of it`, m.built, 0);
    ok(`${where}: it is shown as the text it is`, m.shown.includes('<img src=x'));
  }

  await go('#/p/cpp-count-digits', 1800);
  const notes = await page.evaluate(() => {
    const tab = document.querySelector('.tab[data-tab="notes"]');
    if (tab) tab.click();
    return true;
  });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({
    pwned: !!window.__pwned,
    built: document.querySelectorAll('#leftPane img, #leftPane b, #leftPane script').length,
  }));
  check('the Notes tab: nothing ran', m.pwned, false);
  check('and nothing was built out of it', m.built, 0);
  void notes;
}

section('the last character typed is the one that is run');
{
  /* Drafts save on a debounce and runs read from CodeMirror rather than
     from the draft, which is the only reason this works — so it is
     worth a test that types and clicks with no pause at all. */
  await go('#/p/algo-lru-cache', 2400);
  await toEditorTab(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.evaluate(() => navigator.clipboard.writeText('print("abc'));
  await page.keyboard.press('Control+V');
  await page.keyboard.type('def")');
  await page.locator('#runBtn').click();
  ok('the run came back', await settled('#runBtn'));
  const m = await page.evaluate(() => ({
    doc: document.querySelector('.cm-content').textContent,
    out: (document.getElementById('runOut') || {}).textContent || '',
  }));
  ok(`the editor has every character (${JSON.stringify(m.doc)})`, m.doc.endsWith('def")'));
  /* Whatever the verdict, the run must have seen the whole program —
     a compiler error about an unterminated string would mean it read
     the document before the last five characters landed. */
  ok('and the run did not see a truncated one',
    !/unterminated|expected .\\"./i.test(m.out));
}

section('two tabs on one attempt finalise it once');
{
  /* Counted as a delta: an attempt was already sat in step 5, and a
     test that insists on a total is a test that breaks the next time
     something above it sits one. */
  const had = await page.evaluate(async () =>
    (await window.SystemsLab.Attempts.all()).length);

  await go('#/assess/oa-cpp-foundations', 1800);
  await page.locator('#oaStart').click();
  await page.waitForTimeout(2200);

  const second = await ctx.newPage();
  second.on('dialog', d => d.accept());
  await second.goto(`${BASE}/#/assess/oa-cpp-foundations/go`, { waitUntil: 'networkidle' });
  await second.waitForTimeout(2400);
  ok('the second tab finds the same attempt', await second.evaluate(() =>
    /\/go$/.test(location.hash) && !!document.getElementById('oaClock')));

  await second.locator('#oaFinish').click();
  await second.waitForTimeout(2600);
  const finishedAt = await second.evaluate(() => location.hash);
  ok(`the second tab finished it (${finishedAt})`, /#\/assess\/review\//.test(finishedAt));
  await second.close();

  /* The first tab is still sitting on a running attempt that is no
     longer running. Coming back to it is what re-reads the store. */
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(2600);
  const m = await page.evaluate(async () => ({
    hash: location.hash,
    attempts: (await window.SystemsLab.Attempts.all()).length,
    running: !!(await window.SystemsLab.Attempts.running()),
    clockLeft: !!document.getElementById('oaClock'),
  }));
  check('the first tab goes to the result rather than carrying on', m.hash, finishedAt);
  check('exactly one attempt was added, not one per tab', m.attempts - had, 1);
  check('and nothing is still running', m.running, false);
  /* The dead clock is taken out of the document, not merely hidden:
     something finding it by id and believing an attempt is running is
     how a mode comes back from the dead. */
  check('the attempt page was emptied, not just hidden', m.clockLeft, false);
}

section('no uncaught errors anywhere in all of that');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 400)}` : 'none', errors.length === 0);

await browser.close();
report('browser/audit');
