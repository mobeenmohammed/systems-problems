/* The C++ journey on the default path: the compiler in the tab.

   tests/browser/journeys.test.mjs walks the same ground through a hosted
   runner, and it needs one — `npm run proxy`, or a judge on 2000. That is
   not the configuration anybody reads the site in. The published site has
   no runner behind it at all: clang is 90 MB of WebAssembly fetched into
   the page and every verdict is produced in the reader's own browser.

   So this suite covers that path and nothing else, and it needs nothing
   running but the site. The first Run pays for the toolchain, which is
   why the timeouts here are in minutes rather than seconds.

     1. the homepage to a C++ exercise, by the links that are on it
     2. typing, running, and what the chip says ran it
     3. a program that does not build, and the diagnostics
     4. a program that does not stop, and stopping it
     5. changing language, and the draft that was there before
     6. a reload, and the draft again
     7. submitting, and being recorded
     8. and the direct-call checks, rejecting a program whose output
        is right

   Needs the site served:   npm run serve
   Run: node tests/browser/journeys-cpp.test.mjs
        BASE=https://mobeenmohammed.github.io/systems-problems node … */

import { chromium } from 'playwright';
import { section, check, ok, report, toEditorTab } from '../harness.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHANNEL = process.env.BROWSER || null;

/* Two languages, beginner, and certified for the browser toolchain —
   which is what makes the language switch below a real switch rather
   than a disabled tab. */
const TWO_LANG = 'algo-impl-count';
/* And one of the exercises whose requirement is not visible in its
   output, for the last section. */
const PROBED = 'cpp-function-default-power';

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not reachable at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

/* The correct program is the exercise's own reference, fetched rather than
   copied in: a journey that pastes a program written out here would start
   failing the day the exercise changed, for a reason that has nothing to
   do with the journey. */
const solution = await (await fetch(`${BASE}/solutions/${TWO_LANG}.json`)).json();
const CPP_OK = solution.key.reference.cpp;
const index = await (await fetch(`${BASE}/data/index.json`)).json();
const TITLE = (index.find(p => p.id === TWO_LANG) || {}).title || '';

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
let errors = [];
const resetErrors = () => { errors = []; };

/* A reader arriving for the first time: nothing in storage. Cleared once
   on the way in rather than on every load — an init script would also run
   on the reload below, which is exactly the thing being tested. */
async function visitor() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    /* No runner on this machine is the normal state and the one the
       published site is in: the page finding that out is not a defect. */
    if (/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|Failed to load resource|favicon/.test(m.text())) return;
    errors.push(m.text());
  });
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.evaluate(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  return { ctx, p };
}

const open = async (p, hash, wait = 2200) => {
  await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(wait);
};

const code = p => p.locator('.cm-content').first();
const docText = p => p.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().value);

async function paste(p, text) {
  await toEditorTab(p);
  await code(p).click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.evaluate(async t => { await navigator.clipboard.writeText(t); }, text);
  await p.keyboard.press('Control+v');
  await p.waitForTimeout(250);
}

/* The toolchain is 90 MB on a cold cache, so "finished" is a state to
   wait for rather than a timeout to guess at. */
const settled = p => p.waitForFunction(() => {
  const e = document.querySelector('#execState');
  const r = document.querySelector('#runBtn');
  return e && r && !r.disabled
    && !/Compil|Fetch|Running|Grading|Checking|Calling/i.test(e.textContent || '');
}, { timeout: 420_000 });

const submitSettled = p => p.waitForFunction(() => {
  const b = document.querySelector('#submitBtn');
  return b && !b.disabled;
}, { timeout: 420_000 });

const result = p => p.evaluate(() => {
  const host = document.querySelector('#codeOut, .results, #results') || document;
  const txt = n => ((host.querySelector(n) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  return {
    badge: txt('.rsum-badge'),
    frac: txt('.rsum-frac'),
    why: txt('.rsum-why'),
    note: txt('.rsum-note'),
    exec: ((document.querySelector('#execState') || {}).textContent || '').trim(),
    cases: [...host.querySelectorAll('.case')].map(c => ({
      name: (c.querySelector('.case-name') || {}).textContent || '',
      why: (c.querySelector('.case-why') || {}).textContent || '',
      pass: c.dataset.pass,
    })),
    buildLine: txt('.buildline'),
  };
});

/* ============================================================
   1. the homepage to a C++ exercise
   ============================================================ */

section('a visitor reaches a C++ exercise from the homepage');
{
  resetErrors();
  const { ctx, p } = await visitor();

  const menu = p.locator('#contentBtn');
  ok('there is a Content menu in the header', await menu.count() > 0);
  await menu.click();
  await p.waitForTimeout(400);
  const toProblems = p.locator('.navmenu-item').filter({ hasText: /Problems|Practice|exercises/i }).first();
  ok('and it offers the problem catalogue', await toProblems.isVisible());
  await toProblems.click();
  await p.waitForTimeout(1400);

  const box = p.locator('#search, input[type="search"], .search-input').first();
  await box.fill('C++');
  await p.waitForTimeout(700);
  const found = await p.evaluate(() => document.querySelectorAll('.p-card, .prob-card, .prow').length);
  ok(`searching for "C++" finds exercises (${found})`, found >= 5);

  await box.fill(TITLE);
  await p.waitForTimeout(700);
  const link = p.locator(`a[href$="/p/${TWO_LANG}"]`).first();
  ok(`searching for its title finds it ("${TITLE}")`, await link.count() > 0);
  await link.click();
  await p.waitForTimeout(2200);

  const landed = await p.evaluate(() => ({
    hash: location.hash,
    editor: !!document.querySelector('.cm-editor'),
    run: ((document.querySelector('#runBtn') || {}).textContent || '').trim(),
    statement: ((document.querySelector('.prose') || {}).innerText || '').length,
    langs: [...document.querySelectorAll('.lang-opt')].map(o => o.dataset.lang),
  }));
  check('it lands on the exercise', landed.hash.includes(TWO_LANG), true);
  ok('with an editor', landed.editor);
  ok('a statement', landed.statement > 200);
  ok('and a Run button that says what it does', /Run/.test(landed.run));
  ok('no page errors on the way in', errors.length === 0);
  await ctx.close();
}

/* ============================================================
   2. typing, running, and which compiler answered
   ============================================================ */

section('typing a program and running it in the tab');
let ranIn = '';
{
  resetErrors();
  const { ctx, p } = await visitor();
  await open(p, `#/p/${TWO_LANG}`);

  /* Real keystrokes first, because setting a value proves nothing about
     whether somebody can type into this page. */
  await toEditorTab(p);
  await code(p).click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.keyboard.type('int typed = 1;', { delay: 0 });
  check('typed characters arrive', await docText(p), 'int typed = 1;');

  await paste(p, CPP_OK);
  check('and a whole program pastes exactly', await docText(p), CPP_OK);

  await p.locator('#runBtn').click();
  await settled(p);
  const r = await result(p);
  ranIn = r.exec;
  check('every sample case passes', r.badge, 'Passed');
  ok(`the chip names what ran it ("${r.exec}")`, /browser|tab|clang/i.test(r.exec));
  ok('and the note says Submit runs more', /Submit also runs the hidden/.test(r.note));
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

/* ============================================================
   3. a program that does not build
   ============================================================ */

section('a compile error is a compile error, not a wrong answer');
{
  resetErrors();
  const { ctx, p } = await visitor();
  await open(p, `#/p/${TWO_LANG}`);
  /* One undeclared identifier, put in by hand. Breaking the reference
     this way rather than writing out a broken program keeps the section
     working whatever the exercise is. */
  await paste(p, CPP_OK.replace('return 0;', 'kount += 1;\n    return 0;'));

  await p.locator('#runBtn').click();
  await settled(p);

  /* A reader whose program did not build has exactly one next question,
     and the page answers it by going there: the pane that opens is the
     compiler's output, not a list of cases that never ran. */
  const showing = await p.evaluate(() => (([...document.querySelectorAll('.ws-tabs-work .tab')]
    .find(t => t.getAttribute('aria-selected') === 'true') || {}).textContent || '').trim());
  check('the pane that opens is the compiler output', showing, 'Compiler output');

  const rows = await p.evaluate(() => [...document.querySelectorAll('.diags-list .diag')]
    .map(r2 => r2.textContent.replace(/\s+/g, ' ').trim()));
  ok(`and it is a list of places (${rows.length}), not a wall of text`, rows.length >= 1);
  ok('each with a line and column to click',
    await p.locator('.diag .diag-where').count() >= 1);
  ok('and it names the undeclared identifier',
    rows.join(' ').includes('kount') || /undeclared/.test(rows.join(' ')));

  /* And the Results pane, when a reader does look at it, says the
     program did not build rather than scoring it zero. */
  await p.evaluate(() => [...document.querySelectorAll('.ws-tabs-work .tab')]
    .find(t => /Results/.test(t.textContent)).click());
  await p.waitForTimeout(600);
  const r = await result(p);
  check('nothing is reported as a failed case', r.cases.length, 0);
  ok(`it says it did not build ("${r.buildLine.slice(0, 40)}")`, /did not build/i.test(r.buildLine));
  ok('and there is no score for a run that never happened', !r.frac);
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

/* ============================================================
   4. a program that does not stop
   ============================================================ */

section('a run can be stopped, and stopping it records nothing');
{
  resetErrors();
  const { ctx, p } = await visitor();
  await open(p, `#/p/${TWO_LANG}`);
  await paste(p, `#include <iostream>

int main()
{
    volatile long long n{ 0 };
    for (;;) { n += 1; }
    std::cout << n;
    return 0;
}
`);

  await p.locator('#runBtn').click();
  /* Wait for it to be genuinely running rather than still downloading,
     then stop it. */
  await p.waitForFunction(() => {
    const e = document.querySelector('#execState');
    return e && /Running|Compil/i.test(e.textContent || '');
  }, { timeout: 420_000 });
  const stop = p.locator('#stopBtn, .run-stop').first();
  ok('a Stop control appears while it runs', await stop.count() > 0);
  await stop.click();
  await settled(p);

  const after = await p.evaluate(() => ({
    exec: ((document.querySelector('#execState') || {}).textContent || '').trim(),
    text: (document.querySelector('#codeOut, .results, #results') || document.body)
      .textContent.replace(/\s+/g, ' ').trim(),
    runnable: !document.querySelector('#runBtn').disabled,
    source: window.SystemsLab.ProblemTypes.get('code').editor().value,
  }));
  ok('Run works again afterwards', after.runnable);
  ok('the page says nothing was recorded', /[Nn]othing was recorded|Stopped/.test(after.text + after.exec));
  ok('and the program is as it was left', after.source.includes('for (;;)'));
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

/* ============================================================
   5. changing language, 6. and a reload
   ============================================================ */

section('changing language keeps the draft that was there');
{
  resetErrors();
  const { ctx, p } = await visitor();
  await open(p, `#/p/${TWO_LANG}`);
  await paste(p, CPP_OK);
  await p.waitForTimeout(700);

  const saved = await p.evaluate(() => ((document.querySelector('#draftState, #draftNote') || {})
    .textContent || '').trim());
  ok(`the page says it saved ("${saved}")`, /Saved/i.test(saved));

  await p.locator('.lang-pick-btn').click();
  await p.waitForTimeout(200);
  await p.locator('.lang-opt[data-lang="python"]').click();
  await p.waitForTimeout(900);
  const py = await docText(p);
  ok('switching to Python gives the Python starter', !py.includes('#include'));

  await p.locator('.lang-pick-btn').click();
  await p.waitForTimeout(200);
  await p.locator('.lang-opt[data-lang="cpp"]').click();
  await p.waitForTimeout(900);
  check('and switching back gives the C++ draft', await docText(p), CPP_OK);

  /* The same question after a real reload, which is where a draft that
     was only in memory would be lost. */
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2400);
  check('a reload brings it back too', await docText(p), CPP_OK);
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

/* ============================================================
   7. submitting
   ============================================================ */

section('submitting a correct program records it');
{
  resetErrors();
  const { ctx, p } = await visitor();
  await open(p, `#/p/${TWO_LANG}`);
  await paste(p, CPP_OK);

  await p.locator('#submitBtn').click();
  await submitSettled(p);
  await p.waitForTimeout(600);
  const r = await result(p);
  check('the verdict is a pass', r.badge, 'Passed');
  ok('and it ran more than the samples', /the samples/.test(r.note));

  const recorded = await p.evaluate(id => {
    const rec = window.SystemsLab.Store.record(id);
    return { solved: rec.status === 'solved', status: rec.status };
  }, TWO_LANG);
  ok('it is recorded as solved', recorded.solved);
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

/* ============================================================
   8. the direct-call checks
   ============================================================ */

section('a program whose output is right and whose code is not');
{
  resetErrors();
  const { ctx, p } = await visitor();
  await open(p, `#/p/${PROBED}`);

  /* Correct on every line it prints, and with no default argument
     anywhere — which is what this exercise is about. Before the direct
     calls existed, this was accepted. */
  await paste(p, `#include <iostream>

long long power(int base, int exponent)
{
    long long result{ 1 };
    for (int i = 0; i < exponent; ++i) result *= base;
    return result;
}

int main()
{
    int base{};
    int exponent{};
    if (!(std::cin >> base >> exponent)) return 0;

    std::cout << "square " << power(base, 2) << "\\n";
    std::cout << "power " << power(base, exponent) << "\\n";
    return 0;
}
`);

  /* Run first: the samples are all it checks, and they all pass. That is
     the point — the two phases disagree, and they are meant to. */
  await p.locator('#runBtn').click();
  await settled(p);
  const onRun = await result(p);
  check('Run says every sample case passed', onRun.badge, 'Passed');

  await p.locator('#submitBtn').click();
  await submitSettled(p);
  await p.waitForTimeout(600);
  const onSubmit = await result(p);
  check('and submitting fails it', onSubmit.badge, 'Failed');
  const direct = onSubmit.cases.find(c => /Direct call/.test(c.name));
  ok('with a row named for the direct call', !!direct);
  ok('that says the grader could not call the code',
    !!direct && /could not call your code/.test(direct.why));
  ok('and the summary does not blame the input cases',
    /Every input case passed/.test(onSubmit.why) || /direct call/i.test(onSubmit.why));

  const notSolved = await p.evaluate(id => window.SystemsLab.Store.record(id).status !== 'solved', PROBED);
  ok('it is not recorded as solved', notSolved);

  /* And the exercise says so, rather than springing it. */
  const says = await p.evaluate(() => ((document.querySelector('.prose') || {}).innerText || ''));
  ok('the statement told the reader this check exists', /What the grader checks/.test(says));

  /* Then the real thing, on the same page, to show the check is not
     simply refusing everything. */
  await paste(p, `#include <iostream>

long long power(int base, int exponent = 2)
{
    long long result{ 1 };
    for (int i = 0; i < exponent; ++i) result *= base;
    return result;
}

int main()
{
    int base{};
    int exponent{};
    if (!(std::cin >> base >> exponent)) return 0;

    std::cout << "square " << power(base) << "\\n";
    std::cout << "power " << power(base, exponent) << "\\n";
    return 0;
}
`);
  await p.locator('#submitBtn').click();
  await submitSettled(p);
  await p.waitForTimeout(600);
  const fixed = await result(p);
  check('the program with the default argument passes', fixed.badge, 'Passed');
  ok('and the note mentions the direct calls',
    /call your functions directly/.test(fixed.note) || /direct/i.test(fixed.note));
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

console.log(`\n  --    every verdict above came from ${ranIn || 'the in-tab compiler'}`);

await browser.close();
report('journeys-cpp');
