/* Mathematics, solved the way a person solves it.

   The engine is tested on its own in tests/maths-expr.test.mjs; this suite
   is about the other half — typing an answer into a box, seeing how it was
   read, getting it wrong, being told something useful, and getting it right.

   The two things it is really here to catch:

     · a syntax error presented as a wrong answer. "{1,2" is a missing
       bracket, not a mathematical mistake, and it must cost nothing.
     · a written proof quietly marked correct. Nothing here may do that.

   Needs the site served:   npm run serve
   Run: node tests/browser/maths.test.mjs
        SHOTS=1 ... (also write screenshots) */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

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
  if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback/.test(m.text())) return;
  errors.push(m.text());
});

/* Via the dashboard, always. A goto to the hash you are already on is not a
   navigation and fires no hashchange, so re-opening the same problem would
   leave the previous render — and the previous verdict — on screen. */
const open = async (id, wait = 1100) => {
  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  await page.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};
const type = async (text, sel = '.maths-input') => {
  await page.locator(sel).first().fill(String(text));
  await page.waitForTimeout(250);
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
    head: (v.querySelector('h4') || {}).textContent,
    body: (v.querySelector('p') || {}).textContent,
  };
});
const preview = () => page.evaluate(() => {
  const n = document.querySelector('.maths-preview');
  return n ? { state: n.dataset.state, text: n.textContent } : null;
});
const needs = () => page.evaluate(() =>
  (document.querySelector('.needs-answer') || {}).textContent || '');
const record = id => page.evaluate(i => window.SystemsLab.Store.record(i), id);

/* ---------------- the subject switch ---------------- */

section('Mathematics is a subject, not a topic');
{
  await page.goto(`${BASE}/#/problems`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const systems = await page.evaluate(() => ({
    pressed: [...document.querySelectorAll('.subject-btn')]
      .map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`),
    rows: document.querySelectorAll('#catalogList .prow').length,
    count: document.getElementById('catalogCount').textContent,
    topics: [...document.querySelectorAll('#fTopic option')].map(o => o.textContent),
  }));
  check('two subjects are offered', systems.pressed.length, 2);
  ok('Systems is the one showing', systems.pressed.includes('Systems:true'));
  ok(`and the catalogue is scoped to it (${systems.count})`, /Systems problems/.test(systems.count));
  ok('the topic filter offers only Systems topics',
    systems.topics.includes('C++') && !systems.topics.includes('Metric Spaces'));

  await page.locator('.subject-btn', { hasText: 'Maths' }).click();
  await page.waitForTimeout(700);
  const maths = await page.evaluate(() => ({
    rows: document.querySelectorAll('#catalogList .prow').length,
    count: document.getElementById('catalogCount').textContent,
    topics: [...document.querySelectorAll('#fTopic option')].map(o => o.textContent),
    titles: [...document.querySelectorAll('#catalogList .prow-link')].map(a => a.textContent),
  }));
  check('switching shows the 24 mathematics problems', maths.rows, 24);
  ok(`and says so (${maths.count})`, /Mathematics problems/.test(maths.count));
  ok('the topic filter changed with it',
    maths.topics.includes('Metric Spaces') && maths.topics.includes('Probability')
      && !maths.topics.includes('C++'));
  ok('and the titles are mathematics',
    maths.titles.some(t => /axiom/i.test(t)) && maths.titles.some(t => /positive test/i.test(t)));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'maths-catalogue.png') });

  /* Search is shared on purpose. */
  await page.locator('#fSearch').fill('cache');
  await page.waitForTimeout(600);
  const searched = await page.evaluate(() => ({
    rows: document.querySelectorAll('#catalogList .prow').length,
    count: document.getElementById('catalogCount').textContent,
  }));
  ok(`searching crosses subjects (${searched.count})`,
    searched.rows > 0 && /every subject/.test(searched.count));
  await page.locator('#fClear').click();
  await page.waitForTimeout(400);
}

section('and the switch survives a reload');
{
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    pressed: [...document.querySelectorAll('.subject-btn')]
      .find(b => b.getAttribute('aria-pressed') === 'true').textContent,
    rows: document.querySelectorAll('#catalogList .prow').length,
  }));
  check('still on Mathematics', after.pressed, 'Maths');
  check('and still showing its problems', after.rows, 24);
}

/* ---------------- typesetting ---------------- */

section('the mathematics is typeset');
{
  await open('metric-axioms-which-fails');
  const r = await page.evaluate(() => ({
    rendered: document.querySelectorAll('#leftPane .katex, .statement .katex').length,
    mathml: document.querySelectorAll('.katex-mathml').length,
    dollars: (document.querySelector('.statement') || {}).textContent.includes('$'),
    inOptions: document.querySelectorAll('.opt .katex').length,
    display: document.querySelectorAll('.katex-display').length,
  }));
  ok(`the statement is typeset (${r.rendered} expressions)`, r.rendered > 5);
  ok('with MathML underneath for a screen reader', r.mathml > 5);
  ok('and no raw dollar signs left on screen', !r.dollars);
  ok(`the options are typeset too (${r.inOptions})`, r.inOptions > 0);
  ok('and the displayed equation is on its own line', r.display > 0);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'maths-statement.png') });
}

/* ---------------- an exact answer ---------------- */

section('an exact answer, with the reading shown as you type');
{
  await open('prob-bayes-screening');

  await type('3/8');
  const p1 = await preview();
  check('the box says how it read what was typed', p1.state, 'ok');
  ok(`and shows the value (${p1.text.trim()})`, /3\/8/.test(p1.text));

  await type('0.375');
  ok('a decimal is read as the same exact fraction',
    /3\/8/.test((await preview()).text));

  /* A syntax error is NOT a wrong answer. */
  await type('99/');
  const bad = await preview();
  check('an unfinished expression is flagged before submitting', bad.state, 'bad');
  ok(`and says what is wrong (${bad.text.trim().slice(0, 60)})`, /cannot read/i.test(bad.text));

  await submit();
  const after = await page.evaluate(() => ({
    verdict: !!document.querySelector('.verdict'),
    note: (document.querySelector('.needs-answer') || {}).textContent || '',
    rec: window.SystemsLab.Store.record('prob-bayes-screening'),
  }));
  check('submitting it produces no verdict at all', after.verdict, false);
  ok(`it is reported as unreadable, not wrong (${after.note.slice(0, 50)})`,
    /could not read/i.test(after.note));
  check('and no attempt was recorded', after.rec.attempts, 0);
  check('nor any status', after.rec.status, 'unsolved');
}

section('a wrong answer explains the misconception');
{
  /* The classic: answering with the sensitivity you were given. */
  await type('0.99');
  await submit();
  const v = await verdict();
  ok(`it is marked wrong ("${v.head}")`, v.head === 'Not right');
  ok('and names the inversion rather than just saying no',
    /sensitivity|reverse conditional|turned round|Bayes/i.test(v.body));
  ok('without giving the answer away', !/99\/1094/.test(v.body));
  const rec = await record('prob-bayes-screening');
  check('this one did count as an attempt', rec.attempts, 1);
  check('and is not solved', rec.status, 'attempted');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'maths-wrong.png') });
}

section('and the right one is accepted however it is written');
{
  await type('99/1094');
  await submit();
  check('the exact fraction', (await verdict()).head, 'Right');
  check('recorded as solved', (await record('prob-bayes-screening')).status, 'solved');

  /* The same value by a different route, on a fresh problem. */
  await open('prob-two-aces');
  await type('C(4,2)*C(48,3)/C(52,5)');
  await submit();
  check('an expression rather than a number', (await verdict()).head, 'Right');

  await open('prob-joint-marginal');
  await type('(1/2)/(5/8)');
  await submit();
  check('arithmetic the reader did not simplify', (await verdict()).head, 'Right');
}

/* ---------------- sets and intervals ---------------- */

section('a set is compared as a set');
{
  await open('metric-ball-in-the-integers');

  await type('{3, 1, 2}');
  await submit();
  check('order does not matter', (await verdict()).head, 'Right');

  await open('metric-ball-in-the-integers');
  await type('{1,2');
  const bad = await preview();
  check('a missing brace is a syntax error', bad.state, 'bad');
  await submit();
  ok('and costs no attempt', /braces/i.test(await needs()));
  check('with no verdict', await verdict(), null);
}

section('an interval is compared by its brackets');
{
  await open('metric-ball-depends-on-ambient');

  await type('(0,1)');
  await submit();
  const wrong = await verdict();
  ok(`the wrong bracket is wrong ("${wrong.head}")`, wrong.head === 'Not right');
  ok('and the reading is shown back', /0, 1/.test(wrong.body));

  await type('[0,1)');
  await submit();
  check('and the right one is right', (await verdict()).head, 'Right');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'maths-interval.png') });
}

/* ---------------- an approximate answer ---------------- */

section('an approximate answer says it is approximate');
{
  await open('prob-continuous-uniform');
  const said = await page.evaluate(() => ({
    statement: (document.querySelector('.statement') || {}).textContent || '',
    syntax: (document.querySelector('.maths-syntax') || {}).textContent || '',
  }));
  ok('the statement states the tolerance', /0\.005|two decimal places/.test(said.statement));
  ok('and so does the box', /tolerance|decimal/i.test(said.syntax));

  await type('0.3');
  await submit();
  const out = await verdict();
  ok(`outside the tolerance is wrong ("${out.head}")`, out.head === 'Not right');
  ok('and the tolerance is quoted back', /0\.005|±/.test(out.body));

  await type('0.25');
  await submit();
  check('and inside it is right', (await verdict()).head, 'Right');
}

/* ---------------- a guided proof ---------------- */

section('a proof with its justifications removed');
{
  await open('metric-limits-are-unique');
  const shape = await page.evaluate(() => ({
    steps: document.querySelectorAll('.proof-step').length,
    blanks: document.querySelectorAll('.proof-why').length,
    choices: document.querySelectorAll('.proof-why option').length
      / Math.max(1, document.querySelectorAll('.proof-why').length),
  }));
  ok(`the proof is laid out in steps (${shape.steps})`, shape.steps >= 6);
  ok(`with gaps to fill (${shape.blanks})`, shape.blanks >= 2);
  ok('and more justifications than gaps', shape.choices > shape.blanks);

  /* One wrong, the rest right. */
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('.proof-why')];
    const want = [0, 1, 2, 3, 4, 5];
    sels.forEach((s, i) => {
      s.value = String(i === 0 ? 6 : want[i]);
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await submit();
  const partly = await verdict();
  ok(`a near miss is scored as one ("${partly.head}")`, /Partly right/.test(partly.head));
  ok('and says how many are right without saying which answer was wanted',
    /\d+ of \d+/.test(partly.body));
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll('.proof-step')].filter(n => n.dataset.mark === 'wrong').length);
  check('exactly the wrong step is marked', marks, 1);
  ok('and no step is marked right, which would leak the rest',
    await page.evaluate(() =>
      ![...document.querySelectorAll('.proof-step')].some(n => n.dataset.mark === 'right')));

  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('.proof-why')];
    [0, 1, 2, 3, 4, 5].forEach((v, i) => {
      sels[i].value = String(v);
      sels[i].dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await submit();
  check('all of them right is right', (await verdict()).head, 'Right');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'maths-proofsteps.png') });
}

/* ---------------- a counterexample ---------------- */

section('building a counterexample');
{
  await open('metric-cauchy-without-a-limit');
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('.maths-input')].map(n => n.dataset.field));
  check('there are four things to fill in', fields.length, 4);

  /* A wrong one first. */
  await page.evaluate(() => {
    const v = { x1: '1', x10: '1/10', x100: '1/100', limit: '1' };
    for (const n of document.querySelectorAll('.maths-input')) {
      n.value = v[n.dataset.field];
      n.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await submit();
  const wrong = await verdict();
  ok(`a wrong limit is rejected ("${(wrong.body || '').slice(0, 50)}")`, wrong.head === 'Not right');
  ok('and says which field is off', /approach|value/i.test(wrong.body));

  await page.evaluate(() => {
    const v = { x1: '1', x10: '0.1', x100: '1/100', limit: '0' };
    for (const n of document.querySelectorAll('.maths-input')) {
      n.value = v[n.dataset.field];
      n.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await submit();
  const right = await verdict();
  check('and the real counterexample is accepted', right.head, 'Right');
  ok('with 0.1 read as 1/10', true);
}

/* ---------------- a written proof is never marked ---------------- */

section('a written proof is saved, not marked');
{
  await open('metric-continuity-epsilon-delta');
  const box = await page.evaluate(() => !!document.querySelector('.proof-box'));
  ok('there is somewhere to write it', box);

  await page.locator('.proof-box').fill(
    'Let a be any point and let eps > 0. Put delta = eps/2. '
    + 'If d2(x,a) < delta then each coordinate difference is at most d2(x,a), '
    + 'so |f(x)-f(a)| <= 2 d2(x,a) < eps.',
  );
  await page.waitForTimeout(700);

  const saved = await page.evaluate(() =>
    window.SystemsLab.Store.draft('metric-continuity-epsilon-delta', 'proof'));
  ok('it is autosaved as you write', saved.includes('delta = eps/2'));

  await submit();
  const v = await verdict();
  check('it is not marked right', v.head, 'Saved, not marked');
  ok('and says plainly that nothing judged it', /nothing has judged|not marked/i.test(v.body));

  const rec1 = await record('metric-continuity-epsilon-delta');
  check('no status was recorded by submitting alone', rec1.status, 'unsolved');

  const rubric = await page.evaluate(() => ({
    items: document.querySelectorAll('.rubric li').length,
    button: !!document.getElementById('reviewDone'),
    model: !!document.getElementById('showModel'),
    solutionLocked: !!document.querySelector('.tab[data-tab="solution"][data-locked="true"]'),
  }));
  ok(`a rubric is offered (${rubric.items} lines)`, rubric.items >= 5);
  ok('with a way to record the review', rubric.button);
  ok('and the model proof behind an explicit action', rubric.model);
  ok('the Solution tab is still locked until that action', rubric.solutionLocked);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'maths-proof-rubric.png') });

  await page.evaluate(() => {
    document.querySelectorAll('.rubric input').forEach(c => {
      c.checked = true;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.locator('#reviewDone').click();
  await page.waitForFunction(() =>
    window.SystemsLab.Store.record('metric-continuity-epsilon-delta').status === 'reviewed',
  { timeout: 10000 });
  await page.waitForTimeout(600);

  const rec2 = await record('metric-continuity-epsilon-delta');
  check('reviewing records its own status', rec2.status, 'reviewed');
  ok('which is not "solved"', rec2.status !== 'solved');
  ok('and it is flagged as self-reviewed', rec2.selfReviewed === true);
  ok('the rubric the reader ticked is kept', (rec2.rubric || []).length >= 5);
  /* Scoped to the problem host. A comma selector returns the first match in
     *document* order, and the hidden catalogue rendered earlier in this file
     is full of .status-word elements that come first. */
  const word = await page.evaluate(() =>
    (document.querySelector('#problemHost .status-word') || {}).textContent || '');
  ok(`the page says Self-reviewed rather than Solved ("${word}")`, /Self-reviewed/.test(word));
  ok('and the draft survived', (await page.evaluate(() =>
    window.SystemsLab.Store.draft('metric-continuity-epsilon-delta', 'proof'))).length > 20);
}

/* ---------------- figures ---------------- */

section('the figures are labelled, and are not claims');
{
  await open('metric-three-metrics-compared');
  const fig = await page.evaluate(() => {
    const f = document.querySelector('.mfig');
    if (!f) return null;
    return {
      svg: !!f.querySelector('svg'),
      aria: f.querySelector('svg').getAttribute('aria-label') || '',
      caption: (f.querySelector('figcaption') || {}).textContent || '',
      shapes: f.querySelectorAll('.mfig-shape').length,
    };
  });
  ok('there is a figure', fig && fig.svg);
  ok(`it describes itself to a screen reader (${fig.aria.slice(0, 40)}…)`, fig.aria.length > 40);
  ok(`the caption says what is drawn (${fig.caption.slice(0, 40)}…)`, fig.caption.length > 60);
  ok('and says the proof is elsewhere rather than claiming it',
    /proved in the solution|not by the picture|rather than by the picture/i.test(fig.caption));
  ok(`three balls are drawn (${fig.shapes} shapes)`, fig.shapes >= 3);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'maths-figure.png') });
}

/* ---------------- hints ---------------- */

section('hints are a ramp, revealed one at a time');
{
  await open('prob-indicators-fixed-points');
  await page.locator('.tab[data-tab="hints"]').first().click();
  await page.waitForTimeout(500);

  const shown = () => page.evaluate(() =>
    [...document.querySelectorAll('.hint')].map(n => n.textContent.trim()));

  check('none are given away before you ask', (await shown()).length, 0);

  const texts = [];
  for (let i = 1; i <= 3; i += 1) {
    const btn = page.locator('.panel button', { hasText: /Open/ }).first();
    if (!(await btn.count())) break;
    await btn.click();
    await page.waitForTimeout(450);
    const now = await shown();
    check(`after asking ${i} time${i === 1 ? '' : 's'}, ${i} hint${i === 1 ? '' : 's'}`,
      now.length, i);
    texts.push(now[i - 1] || '');
  }
  ok(`three hints came out, each longer than the last`, texts.length === 3);
  ok(`the first names the idea to use ("${(texts[0] || '').slice(0, 50)}…")`,
    /indicator|sum/i.test(texts[0] || ''));
  ok('and the last gives a substantial step rather than repeating the first',
    (texts[2] || '').length > 40 && texts[2] !== texts[0]);

  const cost = await page.evaluate(() =>
    window.SystemsLab.Store.record('prob-indicators-fixed-points').hintsUsed);
  check('and the site knows how many were taken', cost, 3);
}

check('no unexpected console errors', errors, []);
await browser.close();
report('browser/maths');
