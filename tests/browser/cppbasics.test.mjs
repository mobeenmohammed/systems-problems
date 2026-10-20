/* The beginner C++ band: twenty-four exercises from reading two numbers
   to a program that needs a predicate, a vector of strings and three
   reference parameters at once.

   What is being claimed, and therefore what is checked:

     · all twenty-four are in the catalogue, beginner, C++ only, single
       file, and classified as runnable in the browser
     · each opens as a workspace with a starter that says where the
       work goes and does not contain the answer
     · each has progressive hints, visible cases with worked examples,
       constraints and a stated boundary case
     · each solution explains itself and says what it does not check
     · the track lists them in the six teaching bands, in order, with
       the exercises that were already there sitting in the band they
       belong to rather than being pushed to the end
     · a representative few actually run and submit green through the
       browser compiler, driven the way a reader would

   The exhaustive "every reference passes every case in the browser" is
   `npm run audit:cxx`, which compiles all of them; this suite drives
   the page.

   Needs the site served:   npm run serve
   Run: node tests/browser/cppbasics.test.mjs */

import { chromium } from 'playwright';
import { section, check, ok, report, read, readJson } from '../harness.mjs';

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

/* The six bands, in teaching order. Written here rather than derived,
   because this list IS the claim: that the order was chosen and not
   whatever the files happened to sort as. */
const BANDS = [
  ['variables, arithmetic, input and conversions',
    ['cpp-arith-report', 'cpp-seconds-to-clock', 'cpp-mean-and-cast',
      'cpp-letter-position']],
  ['conditions and Boolean expressions',
    ['cpp-leap-year', 'cpp-triangle-kind', 'cpp-bool-is-a-value',
      'cpp-short-circuit-guard']],
  ['loops, counting and accumulation',
    ['cpp-digit-reverse', 'cpp-times-table', 'cpp-running-extremes',
      'cpp-collatz-steps']],
  ['functions and simple decomposition',
    ['cpp-function-digit-sum', 'cpp-function-default-power',
      'cpp-function-gcd-lcm', 'cpp-function-perfect-numbers']],
  ['strings and basic vector operations',
    ['cpp-string-build-reverse', 'cpp-string-longest-word',
      'cpp-vector-read-and-report', 'cpp-vector-above-mean']],
  ['references, and combinations',
    ['cpp-reference-swap', 'cpp-reference-min-max',
      'cpp-reference-accumulate', 'cpp-combine-word-report']],
];
const NEW = BANDS.flatMap(([, ids]) => ids);

const index = readJson('data/index.json');
const rows = Array.isArray(index) ? index : index.problems;
const byId = new Map(rows.map(r => [r.id, r]));
const support = readJson('data/cxx-support.json');
const runnable = new Set(support.browser || support.ids || []);

/* ---------------- the files ---------------- */

section('twenty-four new beginner C++ exercises');

check('all of them are in the catalogue', NEW.filter(id => !byId.has(id)), []);
check('and there are twenty-four', NEW.length, 24);
check('with no id used twice', NEW.length - new Set(NEW).size, 0);

for (const id of NEW) {
  const p = JSON.parse(read(`problems/cpp/${id}.json`));
  const s = JSON.parse(read(`solutions/${id}.json`));
  const tpl = (p.payload.templates || {}).cpp || '';
  const ref = (s.key.reference || {}).cpp || '';

  check(`${id}: beginner`, p.difficulty, 'beginner');
  check(`${id}: C++ and nothing else`, p.payload.langs, ['cpp']);
  ok(`${id}: single file`, p.payload.files === undefined);
  ok(`${id}: runnable in the browser`, runnable.has(id));

  ok(`${id}: the statement shows worked input and output`,
    /input:/.test(p.statement) && /output:/.test(p.statement));
  ok(`${id}: states its constraints`, /### Constraints/.test(p.statement));
  ok(`${id}: and names a boundary case`, /### Boundary cases/.test(p.statement));

  ok(`${id}: has three hints`, (p.hints || []).length === 3);
  ok(`${id}: each a real sentence`,
    (p.hints || []).every(h => h.length > 40));

  ok(`${id}: the starter says where the work goes`, /your code here/.test(tpl));
  ok(`${id}: and says what goes there`,
    tpl.split('\n').filter(l => /your code here/.test(l))
      .every(l => l.split('your code here')[1].trim().length > 12));

  /* The starter must not be the answer with a line removed.

     Some lines appear in both on purpose. A declaration carries no
     algorithm; an input guard is the same four words in every
     reference in the catalogue; and on three of these the reading
     loop is given because the exercise is the function below it, not
     the reading. Those are skipped — the generic forms by shape, the
     rest by name, with a reason, so that every exemption is a
     decision somebody wrote down rather than a threshold that drifted.

     Anything else shared between the two is the answer leaking. */
  const SCAFFOLD = [
    /^(const\s+)?[\w:<>,\s]+\s+\w+\{\s*\};$/,       // Type name{};
    /^if \(!\(std::cin >> [\w\s>]+\)\) return 0;$/,  // the read guard
    /^if \(!std::getline\(std::cin, \w+\)\) return 0;$/,
  ];
  const GIVEN = {
    'cpp-reference-min-max':
      'the reading loop is given; writing extremes() is the exercise',
    'cpp-reference-accumulate':
      'the two vectors are declared for you; filling and summing them is the exercise',
    'cpp-combine-word-report':
      'the reading loop is given; the two functions below it are the exercise',
  };
  const given = new Set(Object.keys(GIVEN).includes(id)
    ? tpl.split('\n').map(l => l.trim())
    : []);

  const refBody = ref.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 24
      && !/^#include|^int main|^return 0;/.test(l)
      && !SCAFFOLD.some(re => re.test(l))
      && !given.has(l));
  const leaked = refBody.filter(l => tpl.includes(l));
  check(`${id}: the starter gives nothing away${leaked.length ? `: ${leaked[0]}` : ''}`,
    leaked.length, 0);

  ok(`${id}: has visible cases`, (p.payload.cases || []).length >= 2);
  ok(`${id}: and hidden ones`, (s.key.cases || []).length >= 6);
  ok(`${id}: the explanation teaches rather than restates`,
    s.explanation.length > 900);
  ok(`${id}: and says what it does not check`,
    /What this does not check|does not check/.test(s.explanation));

  /* No advanced machinery the band has not introduced. */
  const banned = /template\s*<|new\s+\w|\bdelete\b|<algorithm>|<memory>|unique_ptr|std::sort|reinterpret_cast/;
  ok(`${id}: the reference uses nothing unexplained`, !banned.test(ref));
}

/* ---------------- the track ---------------- */

section('the track is the teaching order');

const tracks = readJson('data/tracks.json');
const track = tracks.find(t => t.id === 'cpp-first-programs');
ok('cpp-first-programs exists', !!track);
check('and is thirty-six problems', track.problems.length, 36);
check('every new exercise is in it', NEW.filter(id => !track.problems.includes(id)), []);

/* The bands are contiguous: everything in band n comes before
   everything in band n+1. That is the claim that "ordered by
   prerequisite" makes, and the thing that breaks silently when a
   problem is appended rather than placed. */
let last = -1;
let contiguous = true;
for (const [name, ids] of BANDS) {
  const at = ids.map(id => track.problems.indexOf(id));
  ok(`band "${name}" is all in the track`, at.every(i => i >= 0));
  const lo = Math.min(...at);
  if (lo <= last) contiguous = false;
  last = Math.max(...at);
}
ok('and the bands do not interleave', contiguous);

/* The twelve that were already there were placed, not appended. */
const existing = ['cpp-grade-bands', 'cpp-loop-multiples', 'cpp-sum-until-zero',
  'cpp-count-digits', 'cpp-function-min-of-three', 'cpp-function-prime-count',
  'cpp-vector-stats', 'cpp-string-scan', 'cpp-string-palindrome',
  'cpp-reference-clamp', 'cpp-reference-vector-fns', 'cpp-map-word-count'];
check('the twelve that were here are still here',
  existing.filter(id => !track.problems.includes(id)), []);
const tail = track.problems.slice(-12);
ok('and were placed among the new ones rather than left in a block at the end',
  existing.filter(id => tail.includes(id)).length < 12);

/* ---------------- through the page ---------------- */

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

const open = async (id, wait = 2400) => {
  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  await page.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

section('each one opens as a workspace a reader can start in');

for (const id of NEW) {
  await open(id, 1500);
  const shape = await page.evaluate(() => ({
    workspace: document.body.dataset.workspace,
    editor: !!document.querySelector('.cm-content'),
    lang: (document.querySelector('.lang-pick') || {}).dataset?.lang,
    run: !!document.querySelector('#runBtn'),
    submit: !!document.querySelector('#submitBtn'),
    starter: (window.SystemsLab.ProblemTypes.get('code').editor() || {}).value || '',
    crumbs: (document.querySelector('.ws-crumb-leaf') || {}).textContent,
  }));
  ok(`${id}: opens as a workspace with an editor`,
    shape.workspace === 'true' && shape.editor);
  check(`${id}: in C++`, shape.lang, 'cpp');
  ok(`${id}: with Run and Submit`, shape.run && shape.submit);
  ok(`${id}: and the starter in the editor`, /your code here/.test(shape.starter));
  check(`${id}: named for the compiler`, shape.crumbs, 'main.cpp');
}

section('and a few of them run and submit, for real');

/* Three: the first of the band, one that needs a function, and the one
   that needs all of it. Compiling all twenty-four through the page
   would take a quarter of an hour and prove what audit:cxx already
   proves. */
const driven = ['cpp-arith-report', 'cpp-function-gcd-lcm', 'cpp-combine-word-report'];

for (const id of driven) {
  const ref = JSON.parse(read(`solutions/${id}.json`)).key.reference.cpp;
  await open(id, 3000);
  await page.evaluate((src) => {
    window.SystemsLab.ProblemTypes.get('code').editor().value = src;
  }, ref);
  await page.waitForTimeout(400);

  await page.locator('#runBtn').click();
  await page.waitForFunction(() => !document.getElementById('runBtn').disabled,
    { timeout: 300000 });
  await page.waitForTimeout(700);
  const run = await page.evaluate(() => ({
    badge: (document.querySelector('.rsum-badge') || {}).textContent || '',
    frac: (document.querySelector('.rsum-frac') || {}).textContent || '',
  }));
  ok(`${id}: Run passes every visible case (${run.frac} ${run.badge})`,
    /pass/i.test(run.badge) || /^(\d+)\s*\/\s*\1$/.test(run.frac.replace(/\s/g, '')));

  await page.locator('#submitBtn').click();
  await page.waitForFunction(() => !document.getElementById('submitBtn').disabled,
    { timeout: 300000 });
  await page.waitForTimeout(900);
  const verdict = await page.evaluate(() => {
    const v = document.querySelector('.verdict');
    return v ? { kind: v.dataset.kind, head: (v.querySelector('h4') || {}).textContent } : null;
  });
  check(`${id}: and Submit says it is right`, (verdict || {}).kind, 'right');

  check(`${id}: which is recorded`, await page.evaluate(i =>
    window.SystemsLab.Store.record(i).status, id), 'solved');
}

/* And a wrong answer is reported as wrong, with the case that failed \u2014
   which is the only wrong-answer feedback an exact-output exercise
   has, and is worth proving exists. */
section('a wrong answer says which case, and what it wanted');

await open('cpp-arith-report', 3000);
await page.evaluate(() => {
  /* Right shape, wrong arithmetic: the difference the other way round. */
  window.SystemsLab.ProblemTypes.get('code').editor().value =
    '#include <iostream>\n'
    + 'int main()\n{\n'
    + '    int a{}; int b{};\n'
    + '    std::cin >> a >> b;\n'
    + '    std::cout << "sum " << a + b << "\\n";\n'
    + '    std::cout << "difference " << b - a << "\\n";\n'
    + '    std::cout << "product " << a * b << "\\n";\n'
    + '    if (b != 0) { std::cout << "quotient " << a / b << "\\n";'
    + ' std::cout << "remainder " << a % b << "\\n"; }\n'
    + '    else { std::cout << "quotient undefined\\nremainder undefined\\n"; }\n'
    + '    return 0;\n}\n';
});
await page.waitForTimeout(400);
await page.locator('#runBtn').click();
await page.waitForFunction(() => !document.getElementById('runBtn').disabled,
  { timeout: 300000 });
await page.waitForTimeout(800);
const failed = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.case, .rcase, .result-case')];
  return {
    badge: (document.querySelector('.rsum-badge') || {}).textContent || '',
    text: document.querySelector('#runOut, #resultPane')?.textContent || '',
    rows: rows.length,
  };
});
ok(`a wrong program is reported wrong ("${failed.badge.trim().slice(0, 30)}")`,
  !/all .*passed/i.test(failed.badge));
ok('and the output it produced is shown against what was wanted',
  /difference/.test(failed.text) && /expect/i.test(failed.text));

check('no uncaught errors on the page', errors, []);

await browser.close();
report('browser/cppbasics');
