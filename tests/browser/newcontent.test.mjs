/* Every problem added in this round, answered through the real page.

   The unit tests already run each answer key through its own grader.
   This does the same thing through the browser: it opens the problem,
   drives the widget the way a reader would, submits, and expects the
   verdict to be "Right". A key that grades correct in Node and cannot
   be entered on the page is a problem nobody can solve, and that gap
   is what this closes.

   The coding and hardware exercises are covered by their own audits,
   which compile and run every reference in the browser toolchains;
   here they are only opened, so that a workspace that fails to render
   is caught as well.

   Needs the site served:   npm run serve
   Run: node tests/browser/newcontent.test.mjs
   Against the deployed site: BASE=https://… node tests/browser/newcontent.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHANNEL = process.env.BROWSER || null;

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not reachable at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

/* The problems this round added, found rather than listed: everything
   whose id carries one of the prefixes, plus the two course tracks'
   own lists. Found rather than listed so that a problem added later
   and forgotten here shows up as a new line rather than as silence. */
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const PREFIX = /^(ms-|p2-|proj-cache-sim-|proj-seq-detect-)/;
const EXTRA = new Set([
  'algo-sliding-window-max', 'algo-merge-intervals', 'arch-sim-branch-predictor',
  'debug-cpp-erase-in-loop', 'rust-iterator-chains', 'rust-struct-histogram',
  'rust-two-mutable-halves', 'debug-rust-longest-run',
  'metric-code-axiom-checker', 'prob-code-markov-steps',
  'debug-py-reservoir-draws', 'hdl-gray-counter',
  'hdl-round-robin-arbiter', 'debug-hdl-inferred-latch',
]);

const problems = [];
for (const topic of fs.readdirSync('problems')) {
  for (const name of fs.readdirSync(path.join('problems', topic))) {
    const p = read(path.join('problems', topic, name));
    if (PREFIX.test(p.id) || EXTRA.has(p.id)) {
      problems.push({ ...p, key: read(path.join('solutions', `${p.id}.json`)).key });
    }
  }
}
problems.sort((a, b) => a.id.localeCompare(b.id));

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

const open = async (id, wait = 1300) => {
  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  await page.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const submit = async () => {
  await page.locator('#submitBtn').click();
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const v = document.querySelector('.verdict');
    return v ? { kind: v.dataset.kind, head: (v.querySelector('h4') || {}).textContent } : null;
  });
};

/* Enter the key's own answer, by type. Returns false for the types
   that have nothing automatic to enter. */
async function answer(p) {
  const k = p.key;
  switch (p.type) {
    case 'exact':
    case 'approx':
    case 'structured':
      await page.locator('.maths-input').first().fill(String(k.value));
      await page.waitForTimeout(200);
      return true;

    case 'mcq':
      await page.locator(`.opt[data-i="${k.answer}"] input`).check();
      return true;

    case 'multi':
      for (const i of k.answers) await page.locator(`.opt[data-i="${i}"] input`).check();
      return true;

    case 'match':
      for (const [i, j] of k.pairs.entries()) {
        await page.locator('.match-item[data-side="left"]').nth(i).click();
        await page.locator('.match-item[data-side="right"]').nth(j).click();
      }
      return true;

    case 'order': {
      /* Selection sort with the up button, which is the keyboard path
         the widget offers beside dragging. */
      for (const [pos, want] of k.order.entries()) {
        const at = await page.evaluate(w => [...document.querySelectorAll('.order-item')]
          .findIndex(n => Number(n.dataset.i) === w), want);
        for (let m = at; m > pos; m -= 1) {
          await page.locator('.order-item').nth(m).locator('.moves button').first().click();
          await page.waitForTimeout(40);
        }
      }
      return true;
    }

    case 'proofsteps':
      await page.evaluate((want) => {
        [...document.querySelectorAll('.proof-why')].forEach((s, i) => {
          s.value = String(want[i]);
          s.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }, k.answers);
      await page.waitForTimeout(150);
      return true;

    case 'counterexample':
      for (const [id, v] of Object.entries(k.example)) {
        await page.locator(`#cx-${id}`).fill(String(v));
      }
      await page.waitForTimeout(200);
      return true;

    default:
      return false;      /* proof, code, hdl */
  }
}

/* ---------------- the mathematics ---------------- */

const answered = problems.filter(p => !['code', 'hdl', 'proof'].includes(p.type));
section(`every new mathematics problem accepts its own key (${answered.length})`);

for (const p of answered) {
  await open(p.id);
  const rendered = await page.evaluate(() => !!document.querySelector('#answerWidget')
    && document.querySelector('#answerWidget').children.length > 0);
  if (!ok(`${p.id} [${p.type}]: the answer widget is there`, rendered)) continue;
  if (!(await answer(p))) continue;
  const v = await submit();
  ok(`${p.id} [${p.type}]: the key is accepted (${v && v.head})`,
    !!v && v.head === 'Right');
}

/* ---------------- the self-reviewed proofs ---------------- */

const proofs = problems.filter(p => p.type === 'proof');
section(`a written proof is kept rather than marked (${proofs.length})`);

for (const p of proofs) {
  await open(p.id);
  const box = await page.evaluate(() => !!document.querySelector('.proof-box'));
  ok(`${p.id}: there is somewhere to write it`, box);
  if (!box) continue;

  /* The rubric appears after the proof is handed in, because it is the
     review step rather than part of writing. */
  await page.locator('.proof-box').fill(
    'Let a be a point of X and let eps > 0. Choose N with sup |f_N - f| < eps/3. '
    + 'Then pick delta from the continuity of f_N at a, and split |f(x) - f(a)| '
    + 'into three terms by the triangle inequality.');
  await page.waitForTimeout(300);
  await submit();
  const after = await page.evaluate(() => ({
    rubric: document.querySelectorAll('.rubric li').length,
    said: (document.querySelector('.verdict') || {}).dataset?.kind,
  }));
  ok(`${p.id}: handing it in offers the rubric (${after.rubric} points)`,
    after.rubric >= 3);
  const rec = await page.evaluate(i => window.SystemsLab.Store.record(i).status, p.id);
  ok(`${p.id}: and it is not marked right by a machine (status "${rec}")`,
    rec !== 'solved');
}

/* ---------------- the coding and hardware exercises ---------------- */

const written = problems.filter(p => p.type === 'code' || p.type === 'hdl');
section(`every new coding exercise opens with its editor (${written.length})`);

for (const p of written) {
  await open(p.id, 2600);
  const got = await page.evaluate(() => {
    const impl = window.SystemsLab.ProblemTypes.get(
      document.body.dataset.workspace ? (window.SystemsLab.__t || 'code') : 'code');
    return {
      editors: document.querySelectorAll('.cm-editor').length,
      files: document.querySelectorAll('.mf-file').length,
      run: !!document.querySelector('#runBtn'),
      submit: !!document.querySelector('#submitBtn'),
      void: !!impl,
    };
  });
  const multi = Array.isArray((p.payload || {}).files) && p.payload.files.length;
  ok(`${p.id}: an editor is mounted`, got.editors >= 1);
  ok(`${p.id}: Run and Submit are both there`, got.run && got.submit);
  if (multi) {
    check(`${p.id}: and every file is in the explorer`, got.files, p.payload.files.length);
  } else {
    check(`${p.id}: and there is no explorer`, got.files, 0);
  }
}

/* ---------------- one of each project, run for real ---------------- */

section('the first milestone of each new project runs its reference');

const runWith = async (id, files) => {
  await open(id, 3000);
  await page.evaluate(({ fs: list }) => {
    const impl = window.SystemsLab.ProblemTypes.get('code');
    for (const f of list) { impl.openFile(f.path); impl.editor().value = f.content; }
  }, { fs: files });
  await page.waitForTimeout(400);
  await page.locator('#runBtn').click();
  await page.waitForFunction(() => !document.getElementById('runBtn').disabled,
    { timeout: 300000 });
  await page.waitForTimeout(700);
  return page.evaluate(() => ({
    badge: (document.querySelector('.rsum-badge') || {}).textContent || '',
    frac: (document.querySelector('.rsum-frac') || {}).textContent || '',
  }));
};

{
  const ref = read('solutions/proj-cache-sim-1.json').key.reference.files;
  const r = await runWith('proj-cache-sim-1', ref);
  ok(`the cache simulator passes its visible cases (${r.frac} ${r.badge})`,
    /All .* passed|passed/i.test(r.badge) || /^(\d+)\s*\/\s*\1$/.test(r.frac.replace(/\s/g, '')));
}

{
  await open('proj-seq-detect-1', 3000);
  const ref = read('solutions/proj-seq-detect-1.json').key.reference.files;
  await page.evaluate(({ fs: list }) => {
    const impl = window.SystemsLab.ProblemTypes.get('hdl');
    for (const f of list) { impl.openFile(f.path); impl.editor().value = f.content; }
  }, { fs: ref });
  await page.waitForTimeout(400);
  await page.locator('#runBtn').click();
  await page.waitForFunction(() => !document.getElementById('runBtn').disabled,
    { timeout: 300000 });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({
    kind: (document.querySelector('.verdict') || {}).dataset?.kind || '',
    head: (document.querySelector('.verdict-head') || {}).textContent || '',
    checks: [...document.querySelectorAll('.hdl-check')].map(n => n.dataset.state),
  }));
  const passed = r.checks.filter(x => x === 'pass').length;
  ok(`the sequence detector passes its sample checks (${passed}/${r.checks.length}, ${r.kind})`,
    r.checks.length === 5 && passed === 5);
}

check('no uncaught errors on the page', errors, []);

await browser.close();
report('browser/newcontent');
