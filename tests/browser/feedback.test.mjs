/* Getting it wrong, and what the page says about it.

   "Incorrect." teaches nothing. The authored notes live in the solution file
   beside the key — not in the problem file, because if only the wrong options
   carried a note the option without one would be the answer — and they are
   bound by one rule: a note may say why what you picked is unsuitable, and
   may never say what is right.

   The second half of this suite is the lifecycle, which was the part that
   actually misled: a verdict stayed on screen while the reader changed their
   answer, and the wrong-answer mark stayed on a radio they had since moved
   away from. A freshly chosen answer must never arrive already graded.

   Needs the site served:   npm run serve
   Run: node tests/browser/feedback.test.mjs
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

const open = async id => {
  await page.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
};
const submit = async () => {
  await page.locator('#submitBtn').click();
  await page.waitForTimeout(900);
};

const verdict = () => page.evaluate(() => {
  const v = document.querySelector('.verdict');
  if (!v) return null;
  return {
    kind: v.dataset.kind,
    stale: v.dataset.stale === 'true',
    head: (v.querySelector('h4') || {}).textContent,
    when: (v.querySelector('.verdict-when') || {}).textContent,
    body: (v.querySelector('p') || {}).textContent,
    history: !!v.querySelector('.verdict-history'),
  };
});

const marks = () => page.evaluate(() => [...document.querySelectorAll('.opt')]
  .map((n, i) => `${i}:${n.dataset.mark || '-'}`));

/* ---------------- single-choice ---------------- */

section('a wrong MCQ answer is explained, not just refused');
{
  await open('hpc-loop-order-row-major');
  /* Option 1: "version A performs fewer additions". A real misconception. */
  await page.locator('.opt[data-i="1"] input').check();
  await submit();

  const v = await verdict();
  ok(`it is more than one word (${(v.body || '').length} characters)`, v.body.length > 120);
  ok('it talks about what was actually picked',
    /addition/i.test(v.body) && /vectoris/i.test(v.body));
  ok('and leaves something to think about',
    /ask|notice|count|work out|consider/i.test(v.body));

  /* The disclosure rules. */
  const m = await marks();
  check('only the option they chose is marked', m.filter(x => x.endsWith('wrong')).length, 1);
  check('and it is theirs', m[1], '1:wrong');
  ok('nothing is marked right or missed',
    !m.some(x => x.endsWith('right') || x.endsWith('missed')));

  const state = await page.evaluate(() => ({
    enabled: [...document.querySelectorAll('.opt input')].every(n => !n.disabled),
    submit: !document.getElementById('submitBtn').disabled,
    solutionLocked: !!document.querySelector('.tab[data-tab="solution"][data-locked="true"]'),
    status: window.SystemsLab.Store.record('hpc-loop-order-row-major').status,
    revealed: !!window.SystemsLab.Store.record('hpc-loop-order-row-major').revealed,
  }));
  ok('every option is still selectable', state.enabled);
  ok('Submit is still live', state.submit);
  ok('the Solution tab is still locked', state.solutionLocked);
  check('and nothing was marked solved', state.status, 'attempted');
  check('nor revealed', state.revealed, false);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'feedback-mcq-wrong.png') });
}

section('a second wrong answer gets its own explanation');
{
  await page.locator('.opt[data-i="2"] input').check();
  const mid = await verdict();
  check('choosing again labels the old verdict', mid.when, 'Previous attempt');
  check('and dims it', mid.stale, true);
  const m = await marks();
  ok('and clears the mark off the one they moved away from',
    !m.some(x => x.endsWith('wrong')));

  await submit();
  const v = await verdict();
  check('the new verdict is about this attempt', v.when, 'This attempt');
  check('and is not stale', v.stale, false);
  ok('with a different explanation', /TLB/i.test(v.body));
  ok('and the earlier one is kept, folded away', v.history);
}

section('and then the right one');
{
  await page.locator('.opt[data-i="0"] input').check();
  await submit();
  const v = await verdict();
  check('it says so', v.head, 'Right');
  const state = await page.evaluate(() => ({
    status: window.SystemsLab.Store.record('hpc-loop-order-row-major').status,
    solutionOpen: !document.querySelector('.tab[data-tab="solution"][data-locked="true"]'),
  }));
  check('recorded as solved', state.status, 'solved');
  ok('and the solution is available now', state.solutionOpen);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'feedback-mcq-right.png') });
}

/* ---------------- select all ---------------- */

section('a wrong multi-select says something useful without handing it over');
{
  await open('arch-false-sharing-fixes');
  /* 0 is right, 2 is a classic wrong one: "just drop the atomic". */
  await page.locator('.opt[data-i="0"] input').check();
  await page.locator('.opt[data-i="2"] input').check();
  await submit();

  const v = await verdict();
  ok('it names the misconception in the selection',
    /data race|undefined behaviour/i.test(v.body));
  ok('and it is substantial', v.body.length > 140);

  /* Nothing that identifies the combination. */
  const m = await marks();
  check('no option is marked at all on a select-all', m.filter(x => x !== '0:-'
    && x !== '1:-' && x !== '2:-' && x !== '3:-').length, 0);
  ok('the number of correct options is not disclosed',
    !/\bof 2\b|\b2 (are|of them are) right\b|all 2/i.test(v.body));
  ok('and neither is which of their ticks was the good one',
    !/option 0|the first one is right|option 1 is/i.test(v.body));

  const state = await page.evaluate(() => ({
    enabled: [...document.querySelectorAll('.opt input')].every(n => !n.disabled),
    status: window.SystemsLab.Store.record('arch-false-sharing-fixes').status,
  }));
  ok('every box is still tickable', state.enabled);
  check('nothing solved', state.status, 'attempted');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'feedback-multi-wrong.png') });
}

section('unticking a box invalidates the verdict too');
{
  await page.locator('.opt[data-i="2"] input').uncheck();
  const v = await verdict();
  check('it is labelled as the previous attempt', v.when, 'Previous attempt');
  await page.locator('.opt[data-i="1"] input').check();
  await submit();
  const after = await verdict();
  check('and the corrected selection is accepted', after.head, 'Right');
}

/* ---------------- locate ---------------- */

section('clicking the wrong line says what that line does');
{
  await open('cpp-scope-shadowing');
  await page.locator('.locate-line[data-line="16"]').click();
  await submit();

  const v = await verdict();
  ok('it describes the line that was clicked',
    /prints|fahrenheit/i.test(v.body) && v.body.length > 80);
  ok('without naming the line with the bug on it', !/line 12\b/i.test(v.body));

  /* A line nobody annotated still gets something honest. */
  await page.locator('.locate-line[data-line="18"]').click();
  await submit();
  const fallback = await verdict();
  ok(`an unannotated line gets the general nudge ("${fallback.body.slice(0, 60)}…")`,
    fallback.body.length > 40);
  ok('and does not pretend to know what they were thinking',
    !/you probably|you must have|you thought/i.test(fallback.body));

  await page.locator('.locate-line[data-line="12"]').click();
  await submit();
  check('and the right line is accepted', (await verdict()).head, 'Right');
}

/* ---------------- empty ---------------- */

section('submitting nothing is a validation message, not a wrong answer');
{
  await open('dist-partition-choice');
  await page.locator('#submitBtn').click();
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    note: (document.querySelector('.needs-answer') || {}).textContent || '',
    verdict: !!document.querySelector('.verdict'),
    status: window.SystemsLab.Store.record('dist-partition-choice').status,
    attempts: window.SystemsLab.Store.record('dist-partition-choice').attempts,
  }));
  ok(`it says what to do ("${state.note}")`, /choose an option/i.test(state.note));
  check('no verdict was produced', state.verdict, false);
  check('nothing was recorded', state.status, 'unsolved');
  check('and no attempt was spent', state.attempts, 0);

  await page.locator('.opt[data-i="1"] input').check();
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => !document.querySelector('.needs-answer'));
  ok('and the message goes as soon as they answer', cleared);
}

/* ---------------- a reload in the middle ---------------- */

section('a reload after a wrong answer reveals nothing');
{
  await submit();
  const before = await verdict();
  check('wrong, as expected', before.head, 'Not right');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    verdict: !!document.querySelector('.verdict'),
    marks: [...document.querySelectorAll('.opt')].filter(n => n.dataset.mark).length,
    solutionLocked: !!document.querySelector('.tab[data-tab="solution"][data-locked="true"]'),
    status: window.SystemsLab.Store.record('dist-partition-choice').status,
    enabled: [...document.querySelectorAll('.opt input')].every(n => !n.disabled),
  }));
  check('the attempt is remembered', after.status, 'attempted');
  check('but nothing on screen is marked', after.marks, 0);
  check('the solution is still locked', after.solutionLocked, true);
  ok('and it is ready for another go', after.enabled);
  check('with no verdict claiming to describe the blank form', after.verdict, false);
}

check('no uncaught errors', errors, []);
await browser.close();
report('browser/feedback');
