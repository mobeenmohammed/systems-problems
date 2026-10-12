/* Online assessments: the whole journey, with the parts that are
   easy to get wrong tested directly rather than inferred.

   The three that matter most, and none of them is visible from a
   single happy-path run:

     · it survives a real reload. An attempt whose state is in a
       variable is an attempt lost to a refresh.
     · the deadline is an instant, not a counter. A counter stops in
       a background tab and hands minutes back to anyone who
       switches away.
     · it is finalised exactly once, and expiry freezes what was
       saved rather than whatever happens to be in the editor's
       memory at the moment the timer fires.

   And the separation: nothing here may touch XP, a streak, or a
   problem's solved status, and the assessment bank may not appear
   in the catalogue.

   Needs the site served:   npm run serve

   Run: node tests/browser/assessment.test.mjs
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

const defs = JSON.parse(fs.readFileSync('data/assessments.json', 'utf8')).assessments;
const DEF = defs[0];
const bank = JSON.parse(fs.readFileSync('data/assessment-index.json', 'utf8'));

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback/.test(m.text())) return;
    errors.push(m.text());
  });
  p.on('dialog', d => d.accept());
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  return { ctx, p };
}

const go = async (p, hash, wait = 1600) => {
  await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(wait);
};

/* ---------------- the bank is separate ---------------- */

section('the assessment bank is not in the catalogue');
{
  const { ctx, p } = await freshPage();
  await go(p, '#/problems');
  const m = await p.evaluate(ids => {
    const all = window.SystemsLab.Catalog.all();
    return {
      total: all.length,
      leaked: ids.filter(id => all.some(x => x.id === id)),
      /* By id it is reachable, which is how the problem page renders
         one with no changes at all. */
      byId: ids.map(id => !!window.SystemsLab.Catalog.meta(id)),
      counts: window.SystemsLab.Catalog.counts().problems,
    };
  }, bank.map(b => b.id));
  check('no assessment problem is listed', m.leaked, []);
  check('and the catalogue count is the catalogue', m.counts, m.total);
  /* The bank is loaded at boot and every one of its problems resolves by
     id — that is how the attempt renders one with no changes at all, and
     how a question flagged for review from an assessment can be shown on
     the review list at all.

     It used to be loaded lazily, on first opening the mode, and the test
     here asserted that. That was the wrong invariant to protect: it made
     `Catalog.meta` a function whose answer depended on where the reader
     had been this session, so the dashboard's review count and the
     review page itself disagreed about the same flagged question.

     The invariant that matters is the one checked either side of this:
     being loaded is not being listed. */
  check('every bank problem resolves by id', m.byId, bank.map(() => true));

  /* Searching for one by name finds nothing, which is the real test —
     a filter that reaches the bank would spoil every assessment. */
  await p.locator('#fSearch').fill('run-length');
  await p.waitForTimeout(700);
  check('and a search cannot find one',
    await p.evaluate(() => document.querySelectorAll('#catalogList .prow').length), 0);
  await ctx.close();
}

/* ---------------- the way in ---------------- */

section('Content has a way in, and the list says what there is');
{
  const { ctx, p } = await freshPage();
  await go(p, '#/');
  await p.hover('#contentBtn');
  await p.waitForTimeout(400);
  const menu = await p.evaluate(() => ({
    cols: [...document.querySelectorAll('.navmenu-col-head')].map(h => h.textContent),
    item: [...document.querySelectorAll('.navmenu-item')]
      .find(a => a.getAttribute('href') === '#/assess'),
  }));
  ok(`there is an Assess column (${menu.cols.join(', ')})`, menu.cols.includes('Assess'));
  ok('with a way to the assessments', !!menu.item);

  await go(p, '#/assess');
  const list = await p.evaluate(() => ({
    cards: document.querySelectorAll('.oa-card').length,
    facts: [...document.querySelectorAll('.oa-card .oa-facts span')].map(s => s.textContent),
    blurb: (document.getElementById('assessBlurb') || {}).textContent || '',
  }));
  ok(`the assessments are listed (${list.cards})`, list.cards === defs.length);
  ok(`each says its duration and size (${list.facts.join(' | ')})`,
    list.facts.some(f => /min/.test(f)) && list.facts.some(f => /problem/.test(f)));
  ok('and the list says it is kept apart from practice',
    /XP|apart/.test(list.blurb));
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'assess-list.png') });
  await ctx.close();
}

/* ---------------- before the clock ---------------- */

section('everything is said before the clock starts');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/assess/${DEF.id}`, 2500);
  const m = await p.evaluate(() => ({
    facts: Object.fromEntries([...document.querySelectorAll('.oa-fact')].map(f => [
      f.querySelector('.oa-fact-label').textContent,
      f.querySelector('.oa-fact-value').textContent,
    ])),
    notes: [...document.querySelectorAll('.oa-fact-note')].map(n => n.textContent),
    honest: [...document.querySelectorAll('.oa-honest li')].map(l => l.textContent),
    exec: (document.getElementById('oaExec') || {}).textContent || '',
    start: (document.getElementById('oaStart') || {}).textContent || '',
    clockYet: !!document.getElementById('oaClock'),
  }));

  check('the duration', m.facts.Duration, `${DEF.durationMin} minutes`);
  check('the number of problems', m.facts.Problems, String(DEF.problems.length));
  ok(`the languages (${m.facts.Languages})`, /C\+\+/.test(m.facts.Languages));
  ok(`the scoring (${m.facts.Scoring})`, /partial credit/i.test(m.facts.Scoring));
  ok(`the pass mark (${m.facts['Pass mark']})`, /%/.test(m.facts['Pass mark']));
  ok(`what feedback there is (${m.facts['While it runs']})`,
    /sample/i.test(m.facts['While it runs']));
  ok('whether it is timed, in words',
    m.notes.some(n => /clock starts when you press Start/i.test(n)));
  ok('the weights, per problem', m.notes.some(n => /×\d/.test(n)));

  /* The honest limits, before starting rather than in a footnote. */
  ok('it says it is not proctored and not tamper-proof',
    m.honest.some(l => /tamper-proof/i.test(l)));
  ok('it says what happens when the time runs out',
    m.honest.some(l => /whatever is saved at that moment is what is graded/i.test(l)));
  ok('it says the clock keeps running while the tab is closed',
    m.honest.some(l => /keeps running while the tab is closed/i.test(l)));
  ok('and that nothing here counts towards practice',
    m.honest.some(l => /XP/.test(l) && /solved/.test(l)));

  /* Execution is checked here, not at problem three. */
  ok(`the runners are checked first ("${m.exec.replace(/\s+/g, ' ').slice(0, 60)}")`,
    /can run on this device|no runner/.test(m.exec));
  ok('with an offer to download the toolchains before the clock',
    /Download the toolchains now/.test(m.exec));

  check('it is a fresh attempt', m.start, 'Start');
  ok('and no clock exists yet', !m.clockYet);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'assess-brief.png'), fullPage: true });
  await ctx.close();
}

/* ---------------- the attempt ---------------- */

section('an attempt hides what an assessment must hide');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/assess/${DEF.id}`, 2200);
  await p.locator('#oaStart').click();
  await p.waitForTimeout(2500);

  const m = await p.evaluate(() => ({
    hash: location.hash,
    mode: document.body.dataset.attempt,
    clock: (document.getElementById('oaClock') || {}).textContent,
    tabs: [...document.querySelectorAll('.tab[data-tab]')]
      .map(t => t.dataset.tab),
    dots: [...document.querySelectorAll('.oa-dot')].map(d => d.dataset.state),
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
  }));
  ok(`the attempt opened (${m.hash})`, /\/go$/.test(m.hash));
  check('it takes the window', m.mode, 'true');
  ok('and the page itself does not scroll', !m.pageScrolls);
  ok(`the clock is running (${m.clock})`, /^\d+:\d\d$/.test(m.clock));
  check('every problem starts unanswered', [...new Set(m.dots)], ['unanswered']);

  /* Nor the catalogue chrome. A position in a catalogue this problem
     is not in, a practice status it does not have, and a bookmark
     that would file an assessment question away to practise later —
     which is the one thing the bank must not become. */
  const chrome = await p.evaluate(() => ({
    count: !!document.querySelector('.ws-count'),
    bookmark: !!document.getElementById('bookmarkBtn'),
    status: !!document.querySelector('.ws-head .status-word'),
    prevNext: document.querySelectorAll('.ws-nav').length,
    says: (document.querySelector('.ws-head-mid .tiny') || {}).textContent || '',
  }));
  ok('there is no position in the catalogue', !chrome.count);
  ok('no previous or next', chrome.prevNext === 0);
  ok('no practice status', !chrome.status);
  ok('and no bookmark', !chrome.bookmark);
  ok(`it says where you are in the assessment instead (${chrome.says})`,
    /question \d+ of \d+/.test(chrome.says));

  /* The four tabs an assessment must not have.

     `prereq` joined the list. A prerequisite is a reading
     recommendation — "you will want to have met integer promotion
     before this" — which is the right thing to put in front of somebody
     learning and the wrong thing to put in front of somebody being
     assessed, because it names the topic the question is about. It is
     not deleted: the review afterwards links every question to its
     concepts, which is the moment that reading is worth anything. */
  for (const gone of ['hints', 'solution', 'notes', 'prereq']) {
    ok(`there is no ${gone} tab`, !m.tabs.includes(gone));
  }
  check('the statement is the only tab', m.tabs, ['problem']);

  /* And nothing of the site's own navigation. An attempt is immersive by
     default — there is no Focus button to press, because there is
     nothing left for it to hide. */
  const immersive = await p.evaluate(() => ({
    topbar: getComputedStyle(document.querySelector('.topbar')).display,
    mainH: Math.round(document.querySelector('.main').getBoundingClientRect().height),
    winH: window.innerHeight,
    focusBtn: !!document.getElementById('focusBtn'),
    bar: ['oaClock', 'oaProgress', 'oaNav', 'oaSave', 'oaExit', 'oaFinish']
      .filter(id => !!document.getElementById(id)),
  }));
  check('the site navigation is gone', immersive.topbar, 'none');
  check('the attempt has the whole window', immersive.mainH, immersive.winH);
  ok('there is no Focus button to press', !immersive.focusBtn);
  check('and the assessment bar has all six of its parts',
    immersive.bar.length, 6);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'assess-attempt.png') });

  /* ---- answering ---- */
  section('submitting records against the attempt and nothing else');
  const ta = p.locator('#answerWidget textarea').first();
  await ta.fill('true\nfalse\ntrue\nfalse');
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(1800);

  const after = await p.evaluate(id => ({
    dots: [...document.querySelectorAll('.oa-dot')].map(d => d.dataset.state),
    xp: window.SystemsLab.Store.state.xp,
    coins: window.SystemsLab.Store.state.coins,
    status: window.SystemsLab.Store.record(id).status,
    subs: window.SystemsLab.Store.submissions(id).length,
    streak: window.SystemsLab.Store.state.streak.current,
  }), DEF.problems[0]);
  check('the navigator says it was submitted', after.dots[0], 'submitted');
  check('no XP was earned', after.xp, 0);
  check('no coins either', after.coins, 0);
  check('the problem is not marked solved', after.status, 'unsolved');
  check('and nothing went into its practice submissions', after.subs, 0);

  /* ---- the navigator's middle state ---- */
  section('the navigator tells written-but-not-sent from submitted');
  await p.locator('.oa-dot').nth(1).click();
  await p.waitForTimeout(1500);
  await p.locator('#answerWidget input[type="checkbox"]').first().check();
  await p.waitForTimeout(600);
  /* Nothing is written for an MCQ until it is submitted, so use the
     code problem, where a draft is a real thing. */
  await p.locator('.oa-dot').nth(2).click();
  await p.waitForTimeout(2500);
  await toEditorTab(p);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.evaluate(() => navigator.clipboard.writeText('// WORKING-ON-IT\nint main(){}\n'));
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(900);

  const mid = await p.evaluate(() => ({
    dots: [...document.querySelectorAll('.oa-dot')].map(d => d.dataset.state),
    titles: [...document.querySelectorAll('.oa-dot')].map(d => d.title),
  }));
  check('written and not sent is its own state', mid.dots[2], 'attempted');
  ok('and it says so in words, not only in a colour',
    mid.titles[2].includes('written, not submitted'));
  check('the submitted one still reads submitted', mid.dots[0], 'submitted');

  /* ---- a real reload ---- */
  section('the attempt survives a real reload');
  const beforeClock = await p.evaluate(() =>
    document.getElementById('oaClock').textContent);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);

  const back = await p.evaluate(() => ({
    hash: location.hash,
    clock: (document.getElementById('oaClock') || {}).textContent,
    dots: [...document.querySelectorAll('.oa-dot')].map(d => d.dataset.state),
    doc: (document.querySelector('.cm-content') || {}).textContent || '',
  }));
  ok(`it is still the same attempt (${back.hash})`, /\/go/.test(back.hash));
  ok(`the draft came back ("${back.doc.slice(0, 20)}")`, back.doc.includes('WORKING-ON-IT'));
  check('and so did the submitted state', back.dots[0], 'submitted');
  /* The clock did not restart, and it did not freeze: real time passed. */
  const secs = t => { const [m2, s2] = t.split(':').map(Number); return m2 * 60 + s2; };
  ok(`the clock carried on rather than restarting (${beforeClock} -> ${back.clock})`,
    secs(back.clock) < secs(beforeClock));

  /* ---- leaving and coming back ---- */
  section('navigating away and back finds the attempt, not a lost one');
  await go(p, '#/problems', 900);
  await go(p, '#/assess', 1500);
  const seen = await p.evaluate(() => ({
    state: (document.querySelector('.oa-card') || {}).dataset?.state,
    pill: (document.querySelector('.oa-card .pill') || {}).textContent,
    rows: document.querySelectorAll('.oa-row').length,
  }));
  check('the card says it is in progress', seen.state, 'running');
  check('and says so in words', seen.pill, 'In progress');
  ok('and it is in the history', seen.rows >= 1);

  await go(p, `#/assess/${DEF.id}`, 1800);
  const resume = await p.evaluate(() => ({
    resume: !!document.querySelector('a[href$="/go"]'),
    start: !!document.getElementById('oaStart'),
    text: document.body.textContent,
  }));
  ok('it offers to resume', resume.resume);
  ok('and does not offer to start a second one', !resume.start);
  ok('saying how much time is left', /left\./.test(resume.text));

  /* ---- finishing early ---- */
  section('finishing early is explicit, and says what is unfinished');
  await go(p, `#/assess/${DEF.id}/go`, 2500);
  let asked = '';
  p.on('dialog', d => { asked = d.message(); });
  await p.locator('#oaFinish').click();
  await p.waitForTimeout(3000);

  const done = await p.evaluate(() => ({
    hash: location.hash,
    score: (document.querySelector('.oa-score-big') || {}).textContent,
    verdict: (document.querySelector('.oa-verdict') || {}).textContent,
    outcomes: [...document.querySelectorAll('.oa-result')].map(r => r.dataset.outcome),
    xp: window.SystemsLab.Store.state.xp,
  }));
  ok(`it asked before finalising ("${asked.split('\n')[0]}")`, /Finish this assessment/.test(asked));
  ok('and listed what had not been submitted', /not been submitted/.test(asked));
  ok('and warned it cannot be undone', /cannot be undone/.test(asked));
  ok(`it went to the review (${done.hash})`, /#\/assess\/review\//.test(done.hash));
  /* The attempt takes the window; the review does not. The flag used
     to be cleared on any route that did not START WITH "assess", which
     matched the review too, so the results page arrived full-bleed and
     pinned to the left edge. Third time a mode flag has outlived its
     mode in this codebase. */
  const shape = await p.evaluate(() => ({
    attemptMode: document.body.dataset.attempt || null,
    maxW: getComputedStyle(document.querySelector('.main')).maxWidth,
    overflow: getComputedStyle(document.querySelector('.main')).overflow,
  }));
  check('the full-bleed attempt layout did not follow it', shape.attemptMode, null);
  ok(`and the review is an ordinary page (${shape.maxW}, ${shape.overflow})`,
    shape.maxW !== 'none' && shape.overflow !== 'hidden');
  ok(`with a score (${done.score})`, /%$/.test(done.score));
  ok(`and a verdict ("${done.verdict}")`, done.verdict.length > 3);
  ok(`one row per problem (${done.outcomes.join(', ')})`,
    done.outcomes.length === DEF.problems.length);
  ok('a right answer is marked right', done.outcomes.includes('right'));
  ok('and an unanswered one is not called wrong', done.outcomes.includes('unanswered'));
  check('still no XP', done.xp, 0);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'assess-review.png'), fullPage: true });

  /* ---- finalised once ---- */
  section('an attempt is finalised once');
  const twice = await p.evaluate(async () => {
    const A = window.SystemsLab.Attempts;
    const list = await A.all();
    const a = list[0];
    const defs = window.SystemsLab.Assessments.all();
    const def = defs.find(d => d.id === a.assessmentId);
    const first = JSON.stringify(a.results);
    const again = await A.finish(a.id, def, { reason: 'finished' });
    return { same: JSON.stringify(again.results) === first, state: again.state };
  });
  ok('finishing it again changes nothing', twice.same);
  ok('and it stays finished', twice.state === 'finished' || twice.state === 'expired');

  await ctx.close();
}

/* ---------------- the deadline ---------------- */

section('the deadline is an instant, and expiry finalises what was saved');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/assess/${DEF.id}`, 2200);
  await p.locator('#oaStart').click();
  await p.waitForTimeout(2200);

  /* Write something, then move the deadline into the near future in the
     DURABLE store and let the page notice. Moving the stored deadline
     rather than a variable is the point: if the page were counting
     down from a number in memory it would not notice at all. */
  await p.locator('.oa-dot').nth(2).click();
  await p.waitForTimeout(2500);
  await toEditorTab(p);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.evaluate(() => navigator.clipboard.writeText('// LAST-THING-I-WROTE\n'));
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(900);

  await p.evaluate(async () => {
    const A = window.SystemsLab.Attempts;
    const V = window.SystemsLab.Vault;
    const blob = await V.get(A.KEY);
    for (const a of blob.attempts) {
      if (a.state === 'running') a.deadlineAt = new Date(Date.now() + 1500).toISOString();
    }
    await V.set(A.KEY, blob);
    A._reset();
  });
  /* Coming back to the tab is what re-reads it. */
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(5000);

  const over = await p.evaluate(() => ({
    hash: location.hash,
    ended: (document.querySelector('.oa-score-side') || {}).textContent || '',
    rows: [...document.querySelectorAll('.oa-result')].map(r => r.dataset.outcome),
    source: (document.querySelector('.oa-source pre') || {}).textContent || '',
  }));
  ok(`it finalised itself (${over.hash})`, /#\/assess\/review\//.test(over.hash));
  ok(`and says it ran out of time ("${over.ended.replace(/\s+/g, ' ').slice(0, 60)}")`,
    /Ran out of time/.test(over.ended));
  ok('every problem got an outcome', over.rows.length === DEF.problems.length);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'assess-expired.png') });

  /* And the draft that was in the editor at the deadline is the draft
     that was frozen — which is only true because drafts are saved as
     they are typed rather than on submit. */
  const kept = await p.evaluate(async () => {
    const A = window.SystemsLab.Attempts;
    const a = (await A.all())[0];
    return JSON.stringify(a.drafts);
  });
  ok(`the last thing written was kept (${kept.length} chars of drafts)`,
    kept.includes('LAST-THING-I-WROTE'));

  await ctx.close();
}

/* ---------------- a retake is a separate attempt ---------------- */

section('a retake is a separate attempt and earns nothing twice');
{
  const { ctx, p } = await freshPage();
  /* Two complete attempts in one context. */
  for (let i = 0; i < 2; i += 1) {
    await go(p, `#/assess/${DEF.id}`, 2000);
    await p.locator('#oaStart').click();
    await p.waitForTimeout(2200);
    const ta = p.locator('#answerWidget textarea').first();
    await ta.fill('true\nfalse\ntrue\nfalse');
    await p.locator('#submitBtn').click();
    await p.waitForTimeout(1500);
    await p.locator('#oaFinish').click();
    await p.waitForTimeout(2500);
  }

  const m = await p.evaluate(async id => {
    const list = await window.SystemsLab.Attempts.all();
    return {
      n: list.length,
      ids: [...new Set(list.map(a => a.id))].length,
      ordinals: list.map(a => a.ordinal).sort(),
      scores: list.map(a => a.score),
      xp: window.SystemsLab.Store.state.xp,
      solved: window.SystemsLab.Store.record(id).status,
    };
  }, DEF.problems[0]);
  check('there are two attempts', m.n, 2);
  check('with distinct ids', m.ids, 2);
  check('numbered', m.ordinals, [1, 2]);
  ok('each scored on its own', m.scores.every(s => s != null));
  check('and the second earned no XP either', m.xp, 0);
  check('the problem is still not solved in practice', m.solved, 'unsolved');

  await go(p, `#/assess/${DEF.id}`, 1800);
  const page = await p.evaluate(() => ({
    rows: document.querySelectorAll('.oa-row').length,
    start: (document.getElementById('oaStart') || {}).textContent || '',
  }));
  check('both are listed', page.rows, 2);
  ok(`and the button says which this would be ("${page.start}")`,
    /attempt 3/i.test(page.start));

  await ctx.close();
}

section('no uncaught errors');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 300)}` : 'none', errors.length === 0);

await browser.close();
report('browser/assessment');
