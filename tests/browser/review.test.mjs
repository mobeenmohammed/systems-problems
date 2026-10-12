/* The review queue, the "what I missed" note, and the storage that
   holds a submitted program.

   The node suite (tests/vault.test.mjs) drives the fallback path,
   because node has no IndexedDB. This one drives the real thing: a
   program really is written to IndexedDB, really survives a reload,
   and really comes back into the editor whole — which is the only
   reason to keep one, and the thing the old 6,000-character cap took
   away.

   Needs the site served:   npm run serve

   Run: node tests/browser/review.test.mjs
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
  await p.addInitScript(() => {
    localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
  });
  return { ctx, p };
}

const go = async (p, hash, wait = 1400) => {
  await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(wait);
};

/* ---------------- it really is IndexedDB ---------------- */

section('the vault is IndexedDB here, not the fallback');
{
  const { ctx, p } = await freshPage();
  await go(p, '#/');
  const m = await p.evaluate(async () => {
    const V = window.SystemsLab.Vault;
    const probe = await V.probe();
    return { mode: V.mode, ok: probe.ok, degraded: V.degraded };
  });
  check('it found IndexedDB', m.mode, 'indexeddb');
  ok('and a write round-trips', m.ok);
  ok('so nothing is degraded', !m.degraded);
  await ctx.close();
}

/* ---------------- a program is kept whole ---------------- */

section('a submitted program is kept whole and comes back');
{
  const { ctx, p } = await freshPage();
  /* Comfortably past the 6,000 characters the old store cut at, and
     the point of the whole change: a program cut in half cannot be
     loaded back, which is the only reason to keep one. */
  const LONG = `// head\n${'// filler line that is long enough to count\n'.repeat(400)}// TAIL-MARKER\n`;
  ok(`the program is longer than the old cap (${LONG.length} characters)`,
    LONG.length > 6000);

  await go(p, '#/p/algo-lru-cache', 2500);
  await toEditorTab(p);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.evaluate(t => navigator.clipboard.writeText(t), LONG);
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(600);

  await p.locator('#submitBtn').click();
  for (let i = 0; i < 160; i += 1) {
    if (await p.evaluate(() => !document.getElementById('submitBtn').disabled)) break;
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(800);

  const rec = await p.evaluate(() => {
    const subs = window.SystemsLab.Store.submissions('algo-lru-cache');
    const raw = localStorage.getItem('invariant/state/v1') || '';
    return {
      n: subs.length,
      stored: subs[0] && subs[0].stored,
      bytes: subs[0] && subs[0].bytes,
      inline: subs[0] && subs[0].source,
      truncated: subs[0] && subs[0].truncated,
      stateBytes: raw.length,
    };
  });
  check('it was recorded', rec.n, 1);
  ok('the verdict says a program was kept', rec.stored);
  check('and says how long it was, in full', rec.bytes, LONG.length);
  check('nothing is marked truncated', rec.truncated, false);
  check('and the program is not in the progress file', rec.inline, null);

  /* The progress file holds exactly one copy of this text — the
     DRAFT, which belongs there: it is active work, it has to be read
     synchronously when the editor mounts, and it is the only copy of
     what is currently in the editor. What must not be in there is a
     second copy per submission, which is what the old store did until
     it hit the quota and started cutting them in half. So: submit it
     twice more and watch the file not grow. */
  const grew = await p.evaluate(async () => {
    const size = () => (localStorage.getItem('invariant/state/v1') || '').length;
    const before = size();
    const btn = document.getElementById('submitBtn');
    for (let i = 0; i < 2; i += 1) {
      btn.click();
      for (let n = 0; n < 200 && btn.disabled; n += 1) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return { before, after: size(), subs: window.SystemsLab.Store.submissions('algo-lru-cache').length };
  });
  ok(`more submissions of the same program (${grew.subs} in all)`, grew.subs > 1);
  ok(`and the progress file barely moved (${grew.before} -> ${grew.after} bytes, `
    + `for ${LONG.length} characters a time)`,
    grew.after - grew.before < LONG.length / 10);

  /* It is in IndexedDB, and it is the whole thing. */
  const back = await p.evaluate(async () => {
    const subs = window.SystemsLab.Store.submissions('algo-lru-cache');
    return window.SystemsLab.Sources.get('algo-lru-cache', subs[0].at);
  });
  void rec.stateBytes;
  check('the vault has every character of it', back.length, LONG.length);
  ok('including the last line', back.includes('TAIL-MARKER'));

  /* ---- and it survives a reload and loads back ---- */
  section('and it survives a reload, and goes back into the editor');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.locator('.ws-tabs-work .tab[data-tab="subs"]').click();
  await p.waitForTimeout(600);
  await p.locator('.sub summary').first().click();
  /* The program is fetched when the row is opened, not when the list
     is painted — ten reads to draw a list nobody expanded is ten too
     many. */
  let shown = '';
  for (let i = 0; i < 40; i += 1) {
    shown = await p.evaluate(() =>
      (document.querySelector('.sub-src') || {}).textContent || '');
    if (shown) break;
    await p.waitForTimeout(250);
  }
  ok(`the row shows the program (${shown.length} characters)`, shown.length > 6000);
  ok('all of it, not the first six thousand characters', shown.includes('TAIL-MARKER'));

  await p.locator('.sub-body button').first().click();
  await p.waitForTimeout(900);
  const loaded = await p.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  check('and Load into the editor puts back every character', loaded.length, LONG.length);
  ok('including the end of it', loaded.includes('TAIL-MARKER'));
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'review-subs.png') });

  await ctx.close();
}

/* ---------------- what I missed ---------------- */

section('a wrong answer asks for one line while you still know why');
{
  const { ctx, p } = await freshPage();
  await go(p, '#/p/cpp-unsigned-wrap', 2000);

  const before = await p.evaluate(() => !!document.querySelector('.missed'));
  ok('nothing is asked before an answer', !before);

  /* Predict: type something wrong. */
  await p.locator('#answerWidget textarea').first().fill('nonsense');
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(1500);

  const m = await p.evaluate(() => ({
    box: !!document.querySelector('.missed-box'),
    said: (document.querySelector('.missed p') || {}).textContent || '',
    concepts: [...document.querySelectorAll('.missed a[href^="#/concepts"]')]
      .map(a => a.textContent),
  }));
  ok('it is asked after a wrong one', m.box);
  /* The honest framing: it is not a mark and nothing reads it. */
  ok(`and says nobody marks it ("${m.said.slice(0, 50)}…")`,
    /Nobody marks this|nothing scores it/i.test(m.said));
  ok(`with a way to the concepts it rests on (${m.concepts.join(', ')})`,
    m.concepts.length > 0);

  await p.locator('.missed-box').fill('I forgot that unsigned wraps instead of going negative.');
  await p.waitForTimeout(600);
  const saved = await p.evaluate(() => ({
    stored: window.SystemsLab.Store.record('cpp-unsigned-wrap').missed,
    told: !(document.querySelector('.missed-saved') || { hidden: true }).hidden,
  }));
  ok('it is stored', /unsigned wraps/.test(saved.stored));
  ok('and the page says where it went', saved.told);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'review-missed.png') });

  /* ---- and it is on the queue, in those words ---- */
  section('the review queue says why, in your own words');
  await go(p, '#/review', 1200);
  const q = await p.evaluate(() => ({
    rows: document.querySelectorAll('.rq-row').length,
    reason: (document.querySelector('.rq-row') || {}).dataset?.reason,
    why: (document.querySelector('.rq-why') || {}).textContent,
    quote: (document.querySelector('.rq-missed') || {}).textContent || '',
    tallies: [...document.querySelectorAll('.rq-tally')].map(t => t.textContent),
    felt: (document.querySelector('.rq-felt') || {}).textContent,
  }));
  ok(`it is on the list (${q.rows})`, q.rows >= 1);
  ok(`with a reason on the row ("${q.why}")`, (q.why || '').length > 3);
  ok('and your own sentence', /unsigned wraps/.test(q.quote));
  ok(`counted by reason (${q.tallies.join(' | ')})`, q.tallies.length >= 1);
  /* The rating is yours and is labelled as yours, never folded into a
     score. Not rated here, and it says that rather than guessing. */
  check('an unrated problem says so rather than being given a number',
    q.felt, 'not rated');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'review-queue.png') });

  /* ---- taking it off the list changes nothing else ---- */
  section('Done with it is a statement about the list, not the problem');
  const was = await p.evaluate(() => ({
    status: window.SystemsLab.Store.record('cpp-unsigned-wrap').status,
    attempts: window.SystemsLab.Store.record('cpp-unsigned-wrap').attempts,
  }));
  await p.locator('.rq-side button').first().click();
  await p.waitForTimeout(800);
  const now = await p.evaluate(() => ({
    rows: document.querySelectorAll('.rq-row').length,
    status: window.SystemsLab.Store.record('cpp-unsigned-wrap').status,
    attempts: window.SystemsLab.Store.record('cpp-unsigned-wrap').attempts,
    missed: window.SystemsLab.Store.record('cpp-unsigned-wrap').missed,
  }));
  /* It was attempted-and-wrong too, so it stays on the list for that
     reason — and the note is what went. */
  check('the note is cleared', now.missed, '');
  check('the solve record is untouched', now.status, was.status);
  check('and so is the attempt count', now.attempts, was.attempts);

  await ctx.close();
}

/* ---------------- the five reasons ---------------- */

section('every reason puts a problem on the list, and says which');
{
  const { ctx, p } = await freshPage();
  await go(p, '#/', 1200);
  await p.evaluate(() => {
    const S = window.SystemsLab.Store;
    const C = window.SystemsLab.Catalog;
    S.setFlag(C.meta('os-page-fault-walk'), true);
    S.setReview(C.meta('prob-two-aces'), -1);
    S.setMissed(C.meta('dist-raft-election'), 'I had the term numbers backwards.');
    S.setPerceived(C.meta('dist-raft-election'), 4);
  });
  /* A booked revisit in the past is due; setReview with a negative day
     count clears it, so write the date directly. */
  await p.evaluate(() => {
    const S = window.SystemsLab.Store;
    S.state.progress['prob-two-aces'].reviewOn = '2020-01-01';
  });

  await go(p, '#/review', 1200);
  const m = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.rq-row')];
    return {
      byReason: Object.fromEntries(rows.map(r => [
        r.querySelector('.rq-title a').getAttribute('href').replace('#/p/', ''),
        r.dataset.reason,
      ])),
      labels: rows.map(r => (r.querySelector('.rq-why') || {}).textContent),
      titles: rows.map(r => (r.querySelector('.rq-why') || {}).title),
      felt: rows.map(r => (r.querySelector('.rq-felt') || {}).textContent),
    };
  });
  check('a bookmark', m.byReason['os-page-fault-walk'], 'flagged');
  check('a booked revisit that has come due', m.byReason['prob-two-aces'], 'due');
  check('and a note about what was missed', m.byReason['dist-raft-election'], 'missed');
  ok('every row names its reason in words',
    m.labels.every(l => l && l.length > 3));
  ok('and explains it on hover', m.titles.every(t => t && t.length > 20));
  /* Your rating is shown as yours. */
  ok(`a rated one says how it felt (${m.felt.join(' | ')})`,
    m.felt.some(f => /felt /.test(f)));

  /* An assessment problem must never appear here: the catalogue cannot
     list the bank, and neither can this. */
  const leak = await p.evaluate(() => {
    const S = window.SystemsLab.Store;
    S.state.progress['oa-run-length'] = { id: 'oa-run-length', status: 'attempted', flagged: true, subs: [] };
    return [...document.querySelectorAll('.rq-row a')].map(a => a.getAttribute('href'));
  });
  await go(p, '#/review', 1000);
  const after = await p.evaluate(() =>
    [...document.querySelectorAll('.rq-row .rq-title a')].map(a => a.getAttribute('href')));
  ok(`no assessment problem leaks onto the list (${after.length} rows)`,
    !after.some(h => h.includes('oa-run-length')));
  void leak;

  await ctx.close();
}

/* ---------------- export and import ---------------- */

section('export carries the programs and the attempts, not only the progress');
{
  const { ctx, p } = await freshPage();
  await go(p, '#/p/algo-lru-cache', 2500);
  await toEditorTab(p);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.evaluate(() => navigator.clipboard.writeText('// EXPORTED-PROGRAM\n'));
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(400);
  await p.locator('#submitBtn').click();
  for (let i = 0; i < 160; i += 1) {
    if (await p.evaluate(() => !document.getElementById('submitBtn').disabled)) break;
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(700);

  const doc = await p.evaluate(async () => {
    const S = window.SystemsLab;
    return {
      _format: 'invariant/export/v2',
      progress: S.Store.exportState(),
      sources: await S.Sources.dump(),
      attempts: await S.Vault.get(S.Attempts.KEY),
    };
  });
  ok('the export has a program in it',
    JSON.stringify(doc.sources).includes('EXPORTED-PROGRAM'));
  ok('and the progress beside it', !!doc.progress.progress['algo-lru-cache']);

  /* Into a clean browser, and the program comes back. */
  const second = await freshPage();
  await go(second.p, '#/', 1200);
  const round = await second.p.evaluate(async d => {
    const S = window.SystemsLab;
    S.Store.importState(d.progress);
    await S.Sources.load(d.sources);
    const subs = S.Store.submissions('algo-lru-cache');
    return {
      verdict: subs.length,
      stored: subs[0] && subs[0].stored,
      program: await S.Sources.get('algo-lru-cache', subs[0].at),
    };
  }, doc);
  check('the verdict came across', round.verdict, 1);
  ok('it still says a program exists', round.stored);
  ok('and the program itself came too', /EXPORTED-PROGRAM/.test(round.program || ''));
  await second.ctx.close();

  await ctx.close();
}

/* ---------------- Settings says where things are ---------------- */

section('Settings says where your data actually is');
{
  const { ctx, p } = await freshPage();
  await go(p, '#/settings', 1800);
  const m = await p.evaluate(() => ({
    line: (document.getElementById('setStorage') || {}).textContent || '',
    state: (document.getElementById('setStorage') || {}).dataset?.state,
    note: (document.getElementById('setStorageNote') || {}).hidden,
  }));
  ok(`it names both stores ("${m.line.slice(0, 80)}")`,
    /localStorage/.test(m.line) && /IndexedDB/.test(m.line));
  ok('and how much is in the larger one', /KB/.test(m.line));
  check('with nothing wrong to report', m.state, 'ok');
  ok('so no warning is shown', m.note);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'review-storage.png') });
  await ctx.close();
}

/* ---------------- an execution failure is recoverable ---------------

   A submission the runner could not run is recorded as ungraded, never
   as wrong, and the attempt refuses to produce a pass verdict while
   one is present. On its own that is a dead end: the reader is told
   the service failed and given nothing to do.

   The retry is the something to do, and the thing that makes it safe
   is that the ANSWER IS FROZEN. It regrades the submission that was
   already made; it cannot be used to answer a question after the
   deadline, and the attempt's own `resolve` refuses any row that was
   not ungraded. */

section('a grading failure can be retried, and cannot become an edit');
{
  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/assess`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  /* Build a finished attempt with one ungraded row, directly, because
     making a runner fail on demand in a browser is a test about the
     runner rather than about this. The shape is exactly what
     problem.js writes on `noAttempt`. */
  const built = await p.evaluate(async () => {
    const { Attempts, Assessments } = window.SystemsLab;
    await Assessments.load();
    const def = Assessments.all()[0];
    const started = await Attempts.start(def, {});
    const a = started.attempt;
    /* The ungraded one is the CODING question, because that is the only
       kind that can fail this way: a grader for a multiple choice
       cannot be unavailable. The shape is exactly what problem.js
       writes on `noAttempt`, including the frozen program. */
    const first = def.problems[0];
    const second = def.problems.find(id =>
      (window.SystemsLab.Catalog.meta(id) || {}).type === 'code');
    await Attempts.record(a.id, first, {
      submitted: true, errored: false, correct: true, fraction: 1, response: 0,
    });
    await Attempts.record(a.id, second, {
      errored: true,
      errorWhy: 'the hosted runner is not answering',
      lang: 'cpp',
      source: ['#include <iostream>',
        'int main() { std::cout << "nope" << 10; return 0; }', ''].join('\n'),
      response: null,
    });
    const done = await Attempts.finish(a.id, def);
    return {
      id: a.id,
      ungraded: done.results.ungraded,
      passed: done.results.passed,
      outcomes: done.results.rows.map(r => r.outcome),
      /* The submission is on the attempt, whole. */
      frozen: (done.answers[second] || {}).source,
    };
  });
  ok('the failed row is ungraded rather than wrong',
    built.outcomes.includes('errored') && !built.outcomes.includes('wrong'));
  check('and there is no pass verdict while one is', built.passed, null);
  ok(`the submission itself was kept (${(built.frozen || '').length} characters)`,
    /std::cout/.test(built.frozen || ''));

  await p.goto(`${BASE}/#/assess/review/${built.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  const shown = await p.evaluate(() => ({
    note: (document.querySelector('.oa-note') || {}).textContent || '',
    retry: !!document.querySelector('[data-regrade]'),
    says: (document.querySelector('[data-regrade]') || {}).textContent || '',
    beside: [...document.querySelectorAll('.oa-result')]
      .map(n => n.textContent).find(t => /could not be run/i.test(t)) || '',
  }));
  ok(`the review says something never ran ("${shown.note.slice(0, 60)}…")`,
    /ungraded rather than wrong/i.test(shown.note));
  ok('there is a retry', shown.retry);
  ok(`which says what it will do ("${shown.says}")`, /grading/i.test(shown.says));
  ok('and says the answer cannot be edited now',
    /cannot be edited now/.test(shown.beside));

  /* The guard itself: resolve() refuses a row that was graded. */
  const refused = await p.evaluate(async () => {
    const { Attempts, Assessments } = window.SystemsLab;
    const a = await Attempts.get(location.hash.split('/').pop());
    const def = Assessments.byId(a.assessmentId);
    const graded = def.problems[0];
    const r = await Attempts.resolve(a.id, def, graded, { correct: false, fraction: 0 });
    const after = await Attempts.get(a.id);
    return { ok: r.ok, why: r.why, still: (after.answers[graded] || {}).correct };
  });
  ok(`a graded answer cannot be resolved ("${refused.why}")`, refused.ok === false);
  check('and is untouched by the attempt', refused.still, true);

  /* And a retry that fails again leaves it ungraded rather than zero. */
  const again = await p.evaluate(async () => {
    const { Attempts, Assessments } = window.SystemsLab;
    const id = location.hash.split('/').pop();
    const before = await Attempts.get(id);
    const bad = before.problems.find(x => (before.answers[x] || {}).errored);
    /* Read out as a primitive, not held as a reference: the store
       hands back the live object and regrade() rewrites `results` on
       it in place, so `before.results.passed` afterwards is the AFTER
       value. */
    const passedBefore = before.results.passed;
    const out = await Assessments.regrade(id, bad);
    const after = await Attempts.get(id);
    return {
      graded: out.graded,
      why: out.why,
      stillErrored: !!(after.answers[bad] || {}).errored,
      stillFrozen: (after.answers[bad] || {}).source,
      outcome: (after.results.rows.find(r => r.id === bad) || {}).outcome,
      passedBefore,
      passedAfter: after.results.passed,
      ungradedAfter: after.results.ungraded,
      resolvedAt: !!(after.answers[bad] || {}).resolvedAt,
      passMark: after.results.passMark,
      total: after.results.total,
    };
  }, { timeout: 120_000 });

  if (again.graded) {
    /* It ran this time. The program was wrong, so the row becomes a
       graded wrong answer rather than staying ungraded — which is the
       whole point: the attempt now has a verdict it could not have
       had before. */
    check('the retry graded it', again.outcome, 'wrong');
    ok('it is no longer ungraded', !again.stillErrored && again.ungradedAfter === 0);
    ok(`the attempt now has a verdict it could not have had before `
      + `(${JSON.stringify(again.passedBefore)} -> ${JSON.stringify(again.passedAfter)}, `
      + `pass mark ${again.passMark})`,
      again.passedBefore === null
        && (again.passMark == null ? again.passedAfter === null : typeof again.passedAfter === 'boolean'));
    ok('and it is recorded as having happened after the attempt', again.resolvedAt);
  } else {
    ok(`a second failure says why ("${String(again.why).slice(0, 60)}")`, !!again.why);
    ok('and leaves it ungraded rather than zero', again.stillErrored);
  }
  ok('the submission was never altered by any of this',
    /std::cout/.test(again.stillFrozen || ''));
  await ctx.close();
}

section('no uncaught errors');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 300)}` : 'none', errors.length === 0);

await browser.close();
report('browser/review');
