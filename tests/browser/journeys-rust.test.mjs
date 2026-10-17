/* The Rust exercise from the report, walked the way it was reported.

   The screenshot that started this showed "COULD NOT RUN — NO RUNNER"
   on "Many readers, or one writer", a paragraph about `smulhi.i64`, and
   instructions to install WSL and run `npm run runner`. That is what
   this suite is about: what the reader is told when the browser
   compiler cannot build an exercise, and what they are told when it
   can.

   It separates the two things that were being reported as one:

     checking   the front end ran — parser, types, traits, borrows.
                All seven exercises. A borrow error is a real error and
                is shown as one.
     running    codegen, execution, and every case compared. Two of
                the seven.

   A type-check must never be presented as a successful run, and a
   compiler gap must never be presented as a wrong answer.

   Needs the site served:   npm run serve
   Run: node tests/browser/journeys-rust.test.mjs
        BASE=https://mobeenmohammed.github.io/systems-problems node … */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHANNEL = process.env.BROWSER || null;
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not reachable at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const support = JSON.parse(fs.readFileSync('data/rust-support.json', 'utf8'));
const RUNS = support.browser;
const CHECKS = support.checks;
const solutionOf = id => JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8'));

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];

async function visitor() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback|favicon/.test(m.text())) return;
    errors.push(m.text());
  });
  p.on('dialog', d => d.accept());
  /* Nothing installed, and nothing listening. */
  await p.addInitScript(() => {
    localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
    localStorage.removeItem('invariant/hosted-url');
  });
  return { ctx, p };
}

const shot = async (p, name) => {
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const settled = p => p.waitForFunction(() => {
  const b = document.querySelector('#runBtn');
  const e = document.querySelector('#execState');
  return b && !b.disabled && e
    && !/Compil|Fetch|Running|Checking|Working/.test(e.textContent || '');
}, { timeout: 300_000 });

/* Choose Rust, or establish that there was nothing to choose.

   A Rust-only exercise disables the picker on purpose — the tooltip
   says so, and it is a property of the exercise rather than of what is
   installed. So "the picker is disabled and already says Rust" is a
   pass here, not something to click through. */
const pickRust = async (p) => {
  const btn = p.locator('.lang-pick-btn');
  if (await btn.count() === 0) return 'no picker';
  const state = await btn.evaluate(b => ({
    disabled: b.disabled,
    label: b.textContent.replace(/\s+/g, ' ').trim(),
    why: b.getAttribute('title') || '',
  }));
  if (state.disabled) {
    return /rust/i.test(state.label) || /rust/i.test(state.why) ? 'rust only' : 'disabled';
  }
  await btn.click();
  await p.waitForTimeout(200);
  const opt = p.locator('.lang-opt[data-lang="rust"]');
  if (await opt.count() === 0) return 'not offered';
  await opt.click();
  await p.waitForTimeout(600);
  return 'picked';
};

/* ============================================================
   the exercise from the screenshot
   ============================================================ */

section('"Many readers, or one writer": the exercise from the report, running');
{
  const { ctx, p } = await visitor();
  await p.goto(`${BASE}/#/p/rust-borrow-shared-exclusive`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2600);

  const before = await p.evaluate(() => ({
    body: document.body.innerText,
    chip: (document.querySelector('#execState') || {}).textContent || '',
  }));
  ok('nothing on the page mentions WSL before a run', !/\bWSL\b/.test(before.body));
  ok('nor npm run runner', !/npm run runner/.test(before.body));

  /* Press Run, with the reference solution in the editor — the program
     is correct Rust, and what stops it is the compiler. */
  const ref = solutionOf('rust-borrow-shared-exclusive').key.reference.rust;
  await p.evaluate(src => {
    window.SystemsLab.ProblemTypes.get('code').editor().value = src;
  }, ref);
  await p.waitForTimeout(500);
  await p.click('#runBtn');
  await settled(p);
  await p.waitForTimeout(900);

  const after = await p.evaluate(() => {
    const d = document.querySelector('.platform-detail');
    if (d) d.open = true;
    return {
      kind: (document.querySelector('.platform') || {}).dataset?.kind,
      head: (document.querySelector('.platform-head') || {}).textContent || '',
      say: (document.querySelector('.platform-say') || {}).textContent || '',
      detail: (document.querySelector('.platform-detail') || {}).textContent || '',
      pane: (document.querySelector('#resultPane') || {}).innerText || '',
      cases: document.querySelectorAll('#resultPane .case').length,
      passed: document.querySelectorAll('#resultPane .case[data-pass="true"]').length,
      status: window.SystemsLab.Store.record('rust-borrow-shared-exclusive').status,
      attempts: window.SystemsLab.Store.record('rust-borrow-shared-exclusive').attempts,
      code: window.SystemsLab.ProblemTypes.get('code').editor().value,
      runEnabled: !document.querySelector('#runBtn').disabled,
      chip: (document.querySelector('#execState') || {}).textContent || '',
    };
  });
  await shot(p, 'r1-the-exercise-from-the-report');

  /* This is the exact set of things the screenshot got wrong — and
     the exercise it was taken on now compiles, runs and is graded,
     because the lowering it tripped over is in the compiler. So the
     assertions are the opposite of what they were, and the ones about
     WSL and the local runner stay exactly as they were. */
  ok('there is no platform message at all', !after.kind && !/Not your code/.test(after.pane));
  ok('it ran', /Ran on/.test(after.chip || ''));
  ok(`there is a result about the cases (${after.passed} of ${after.cases} passed)`,
    after.cases > 0 && after.passed === after.cases);
  ok('nobody is told to install WSL', !/\bWSL\b/.test(after.pane));
  ok('nobody is told to run a local runner', !/npm run runner/.test(after.pane));
  ok('nothing mentions smulhi at a reader', !/smulhi|umulhi/.test(after.pane));
  ok('the draft is untouched', after.code.includes(ref.split('\n')[0]));
  ok('and Run is usable again', after.runEnabled);

  /* All the way through, on the exercise the report was about. */
  await p.click('#submitBtn');
  await p.waitForFunction(() => {
    const btn = document.querySelector('#submitBtn');
    return btn && !btn.disabled && /Submit/.test(btn.textContent);
  }, { timeout: 300_000 });
  await p.waitForTimeout(800);
  const sub = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    status: window.SystemsLab.Store.record('rust-borrow-shared-exclusive').status,
  }));
  ok(`submitting grades it (${sub.verdict})`, sub.status === 'solved');

  await ctx.close();
}

/* ============================================================
   checking is not running
   ============================================================ */

section('a type-check is never presented as a run');
{
  const { ctx, p } = await visitor();
  await p.goto(`${BASE}/#/p/rust-borrow-shared-exclusive`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2600);

  /* A borrow error: two mutable borrows alive at once. The front end
     catches this, and it is the reader's mistake, not the platform's. */
  await p.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('code').editor().value = `fn main() {
    let mut v = vec![1, 2, 3];
    let a = &mut v;
    let b = &mut v;
    a.push(4);
    b.push(5);
}
`;
  });
  await p.waitForTimeout(2500);        /* the checker runs as you type */

  const checked = await p.evaluate(() => ({
    chip: (document.querySelector('#execState') || {}).textContent || '',
    state: (document.querySelector('#execState') || {}).dataset?.state,
    diags: [...document.querySelectorAll('.cm-lintPoint, .cm-diagnostic, .diag')].length,
    lintText: document.body.innerText,
  }));
  ok(`a program that was never run does not claim to have run (${checked.chip})`,
    !/Ran on/.test(checked.chip));
  ok('a borrow error is reported somewhere',
    /borrow|E0499|cannot borrow/i.test(checked.lintText) || checked.diags > 0);
  await shot(p, 'r2-borrow-error');
  await ctx.close();
}

/* ============================================================
   the two that do run, all the way through
   ============================================================ */

section('the exercises the browser compiler can build, run and submit');
{
  for (const id of RUNS) {
    const { ctx, p } = await visitor();
    await p.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2600);
    const picked = await pickRust(p);
    ok(`${id}: the workspace is in Rust (${picked})`,
      picked === 'picked' || picked === 'rust only');

    const ref = solutionOf(id).key.reference.rust;
    await p.evaluate(src => {
      window.SystemsLab.ProblemTypes.get('code').editor().value = src;
    }, ref);
    await p.waitForTimeout(500);

    await p.click('#runBtn');
    await settled(p);
    await p.waitForTimeout(800);
    const run = await p.evaluate(() => ({
      chip: (document.querySelector('#execState') || {}).textContent || '',
      pane: (document.querySelector('#resultPane') || {}).innerText || '',
      cases: [...document.querySelectorAll('.case')].length,
      passed: [...document.querySelectorAll('.case[data-pass="true"]')].length,
      platform: !!document.querySelector('.platform'),
    }));
    ok(`${id}: it actually ran (${run.chip})`, /Ran on/.test(run.chip));
    ok(`${id}: no platform message`, !run.platform);
    ok(`${id}: every sample case passed (${run.passed} of ${run.cases})`,
      run.cases > 0 && run.passed === run.cases);
    await shot(p, `r3-${id}-run`);

    await p.click('#submitBtn');
    await p.waitForFunction(() => {
      const b = document.querySelector('#submitBtn');
      return b && !b.disabled && /Submit/.test(b.textContent);
    }, { timeout: 300_000 });
    await p.waitForTimeout(800);
    const sub = await p.evaluate(id2 => ({
      verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
      status: window.SystemsLab.Store.record(id2).status,
    }), id);
    ok(`${id}: and submitting grades it (${sub.verdict})`, sub.status === 'solved');

    /* A wrong program is wrong, not blocked. */
    await p.evaluate(() => {
      const ed = window.SystemsLab.ProblemTypes.get('code').editor();
      ed.value = 'fn main() { println!("definitely not the answer"); }\n';
    });
    await p.waitForTimeout(500);
    await p.click('#runBtn');
    await settled(p);
    await p.waitForTimeout(700);
    const wrong = await p.evaluate(() => ({
      pane: (document.querySelector('#resultPane') || {}).innerText || '',
      platform: !!document.querySelector('.platform'),
      passed: [...document.querySelectorAll('.case[data-pass="true"]')].length,
    }));
    ok(`${id}: a wrong program fails on the cases, not on the platform`,
      !wrong.platform && wrong.passed === 0);

    /* And a program that does not compile is a build error. */
    await p.evaluate(() => {
      window.SystemsLab.ProblemTypes.get('code').editor().value =
        'fn main() { let x: i32 = "not an integer"; println!("{}", x); }\n';
    });
    await p.waitForTimeout(500);
    await p.click('#runBtn');
    await settled(p);
    await p.waitForTimeout(700);
    const build = await p.evaluate(() => ({
      pane: (document.querySelector('#resultPane') || {}).innerText || '',
      platform: !!document.querySelector('.platform'),
      kind: (document.querySelector('.verdict') || {}).dataset?.kind,
    }));
    ok(`${id}: a type error is a build failure, not a platform failure`,
      !build.platform && /did not (compile|build)|E0308|mismatched types/i.test(build.pane));
    await shot(p, `r3-${id}-build-error`);
    await ctx.close();
  }
}

/* ============================================================
   what the site says about all seven, in one place
   ============================================================ */

section('the site never claims more than it can do');
{
  const { ctx, p } = await visitor();
  await p.goto(`${BASE}/#/setup`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  /* The page is many sections, so the whole of it is what a reader
     sees. What matters is that it names Rust among the toolchains that
     run here AND says where the limit is, in the same place. */
  const setup = await p.evaluate(() => document.body.innerText);
  ok('the Where your code runs page names Rust among the browser toolchains',
    /Where your code runs/.test(setup) && /Rust/.test(setup));
  ok('and does not claim every Rust exercise runs here',
    /cannot run in a browser|type-check|cannot build|does not compile/i.test(setup));
  await shot(p, 'r4-setup');

  for (const id of CHECKS) {
    const runs = RUNS.includes(id);
    await p.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);
    const said = await p.evaluate(async id2 => {
      const rows = await window.SystemsLab.Runners.available(['rust'], id2);
      const d = await window.SystemsLab.Runners.describe(['rust'], id2);
      return { ready: rows[0].ready, text: d.text, nativeOnly: d.nativeOnly || null };
    }, id);
    check(`${id}: the site agrees with the audit about whether it runs`, said.ready, runs);
    if (!runs) {
      ok(`${id}: and says why in a sentence (${(said.text || '').slice(0, 54)}…)`,
        !!said.text && said.text.length > 10);
      ok(`${id}: without telling anyone to install anything`,
        !/npm run runner|\bWSL\b|Docker/i.test(said.text || ''));
    }
  }
  await ctx.close();
}

check('no uncaught errors anywhere in these journeys', errors, []);
await browser.close();
report('browser/journeys-rust');
