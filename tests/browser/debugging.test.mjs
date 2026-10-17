/* The debugging challenges, where the starter is the exercise.

   Two properties matter and they pull in opposite directions:

     · the starter must be WRONG, and wrong for the stated reason —
       a debugging exercise whose starter passes is not an exercise
     · the reference must be RIGHT, against the hidden cases too

   Both are checked here with the browser's own toolchains, through
   the same runners the workspace uses, because a bug that only
   reproduces under a native compiler is not a bug a reader can find.

   Also checked: the discovery (badge, filter, search), and that Reset
   restores the broken starter rather than emptying the editor — which
   is the one thing that would quietly destroy the exercise.

   Needs the site served:   npm run serve
   Run: node tests/browser/debugging.test.mjs */

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

const index = JSON.parse(fs.readFileSync('data/index.json', 'utf8'));
const DEBUG_IDS = index.filter(p => p.debugging).map(p => p.id);

const problemFile = (id) => {
  for (const d of fs.readdirSync('problems')) {
    const f = path.join('problems', d, `${id}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return null;
};
const solutionOf = id => JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8'));

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

const go = async (hash, wait = 2200) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* ---------------- the three of them exist and are labelled ---------------- */

section('three debugging challenges, in their own topics');
{
  check('there are three', DEBUG_IDS.length, 3);
  const byTopic = Object.fromEntries(index.filter(p => p.debugging).map(p => [p.id, p.topic]));
  ok(`each sits in an ordinary topic (${Object.values(byTopic).join(', ')})`,
    Object.values(byTopic).every(t => ['algo', 'rust', 'fpga'].includes(t)));
  const types = index.filter(p => p.debugging).map(p => p.type);
  ok(`and keeps its ordinary type (${types.join(', ')})`,
    types.includes('code') && types.includes('hdl'));

  for (const id of DEBUG_IDS) {
    const p = problemFile(id);
    ok(`${id}: the statement says the starter is wrong`,
      /already written, and it is wrong/i.test(p.statement));
    check(`${id}: three progressive hints`, (p.hints || []).length, 3);
    ok(`${id}: the first hint is about the symptom`,
      /run it|compare|count the|press run/i.test(p.hints[0]));
    ok(`${id}: and the last is targeted at the line`,
      /look at|comparison|cnt ==|n == cap|v\[mid\]/i.test(p.hints[2]));
    const sol = solutionOf(id);
    ok(`${id}: the solution explains the root cause`,
      /### The bug/.test(sol.explanation) && /### The fix/.test(sol.explanation));
    ok(`${id}: and says other implementations are accepted`,
      /Other ways to fix it/.test(sol.explanation));
    /* The whole fix must not be reachable without the solution action:
       no hint may contain the corrected line. */
    const fixes = [/start = \(start \+ 1\) % cap/, /v\[mid\] < x/, /cnt == N - 1/];
    ok(`${id}: no hint hands over the fix`,
      !(p.hints || []).some(h => fixes.some(re => re.test(h))));
  }
}

/* ---------------- discovery ---------------- */

section('they can be found');
{
  await go('#/problems?debugging=1', 1600);
  const listed = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.prow')].map(r => r.textContent.replace(/\s+/g, ' ')),
    control: (document.querySelector('#fDebug') || {}).value,
  }));
  check('the filter shows exactly the three', listed.rows.length, 3);
  check('and the control agrees with the URL', listed.control, '1');
  ok('every row carries the Debugging badge',
    listed.rows.every(t => /Debugging/.test(t)));

  for (const word of ['debugging', 'broken', 'ring buffer', 'tick']) {
    await go('#/problems', 900);
    await page.locator('#fSearch').fill(word);
    await page.waitForTimeout(600);
    const n = await page.evaluate(() => document.querySelectorAll('.prow').length);
    ok(`"${word}" finds something (${n})`, n >= 1);
  }

  await go('#/problems', 900);
  /* The search box keeps what was last typed into it, so it is cleared
     rather than assumed empty. */
  await page.locator('#fClear').click();
  await page.waitForTimeout(600);
  const all = await page.evaluate(() => document.querySelectorAll('.prow').length);
  ok(`and the unfiltered catalogue still lists everything (${all})`, all > 3);
}

/* ---------------- the code ones: broken fails, reference passes ---------------- */

const runCases = (lang, src, cases, profile, id) => page.evaluate(async ({ l, s, cs, pr, pid }) => {
  /* problemId matters: the in-browser compiler is only offered for
     problems it was certified against, and leaving it out picks no
     backend at all. */
  const reply = await window.SystemsLab.Runners.run(l, s, cs, { profile: pr, problemId: pid });
  return {
    built: !!(reply.compile && reply.compile.ok),
    backend: reply.backend,
    out: (reply.cases || []).map(c => (c.stdout || '').trim()),
  };
}, { l: lang, s: src, cs: cases, pr: profile, pid: id });

section('each broken starter fails, and fails for the stated reason');
{
  for (const id of DEBUG_IDS.filter(i => problemFile(i).type === 'code')) {
    const p = problemFile(id);
    const key = solutionOf(id).key;
    const lang = p.payload.langs[0];
    const visible = p.payload.cases;
    const all = [...visible, ...key.cases];

    await go(`#/p/${id}`, 2600);

    /* The starter, exactly as a reader meets it. */
    const starter = await page.evaluate(() =>
      window.SystemsLab.ProblemTypes.get('code').editor().value);
    check(`${id}: the editor opens on the broken program`,
      starter.trim(), p.payload.templates[lang].trim());
    ok(`${id}: which is a complete program, not a hole to fill`,
      !/your code here/i.test(starter));

    /* eslint-disable-next-line no-await-in-loop -- one toolchain, one tab. */
    const broken = await runCases(lang, starter, all, p.payload.profile, id);
    ok(`${id}: the broken starter compiles (${broken.backend})`, broken.built);
    const wrong = all.map((c, i) => broken.out[i] === (c.expect || '').trim());
    const firstVisible = wrong.slice(0, visible.length);
    ok(`${id}: it fails the failing sample`, firstVisible[0] === false);
    ok(`${id}: and passes the sample that does not reach the bug`,
      firstVisible.slice(1).some(Boolean));
    ok(`${id}: it does not fail everything — the bug is conditional`,
      wrong.some(Boolean) && wrong.some(x => !x));

    /* eslint-disable-next-line no-await-in-loop -- as above. */
    const fixed = await runCases(lang, key.reference[lang], all, p.payload.profile, id);
    ok(`${id}: the reference compiles`, fixed.built);
    const bad = all
      .map((c, i) => ({ i, got: fixed.out[i], want: (c.expect || '').trim() }))
      .filter(c => c.got !== c.want);
    ok(`${id}: and passes all ${all.length} cases`
      + (bad.length ? ` — case ${bad[0].i + 1} got "${bad[0].got}" want "${bad[0].want}"` : ''),
    bad.length === 0);
  }
}

/* ---------------- the hardware one, through its own simulator ---------------- */

section('the broken design simulates, ticks, and has the wrong period');
{
  const id = 'debug-tickgen';
  const p = problemFile(id);
  const key = solutionOf(id).key;
  await go(`#/p/${id}`, 2600);

  const starter = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('hdl').editor().value);
  ok('the editor opens on the broken design', /cnt == N\b/.test(starter));
  ok('which is complete, not a hole to fill', !/your code here/i.test(starter));

  const sim = (design, tb) => page.evaluate(async ({ d, t, gen }) => {
    const reply = await BrowserHdl.run({ 'design.sv': d, 'testbench.sv': t },
      { generation: gen, wantWaveform: true });
    return { built: reply.built !== false, ok: !!reply.ok, out: reply.output || '',
      vcd: !!reply.vcd };
  }, { d: design, t: tb, gen: p.payload.generation });

  const broke = await sim(starter, p.payload.testbench);
  ok('the broken design compiles', broke.built);
  const rows = Object.fromEntries([...broke.out.matchAll(/CHECK (\S+) (\S+) (\S+)/g)]
    .map(m => [m[1], { want: m[2], got: m[3] }]));
  ok(`it stays quiet through reset (${JSON.stringify(rows.quiet_in_reset)})`,
    rows.quiet_in_reset && rows.quiet_in_reset.want === rows.quiet_in_reset.got);
  ok(`and it does tick (${JSON.stringify(rows.ticks_seen)})`,
    rows.ticks_seen && rows.ticks_seen.want === rows.ticks_seen.got);
  ok(`each tick is still one cycle wide (${JSON.stringify(rows.one_cycle_wide)})`,
    rows.one_cycle_wide && rows.one_cycle_wide.want === rows.one_cycle_wide.got);
  ok(`but both period measurements are wrong, by exactly one `
    + `(${JSON.stringify(rows.period)}, ${JSON.stringify(rows.period_again)})`,
  rows.period && Number(rows.period.got) === Number(rows.period.want) + 1
    && rows.period_again && Number(rows.period_again.got) === Number(rows.period_again.want) + 1);
  ok('and it draws a waveform to look at', broke.vcd);

  const fixed = await sim(key.reference.sv, p.payload.testbench);
  const fixedRows = [...fixed.out.matchAll(/CHECK (\S+) (\S+) (\S+)/g)]
    .map(m => ({ name: m[1], want: m[2], got: m[3] }));
  ok(`the reference passes every sample check (${fixedRows.length})`,
    fixedRows.length === p.payload.checks.length && fixedRows.every(r => r.want === r.got));

  const graded = await sim(key.reference.sv, key.harness);
  const gradedRows = [...graded.out.matchAll(/CHECK (\S+) (\S+) (\S+)/g)]
    .map(m => ({ name: m[1], want: m[2], got: m[3] }));
  const failed = gradedRows.filter(r => r.want !== r.got);
  ok(`and the grading testbench too (${gradedRows.length} checks`
    + `${failed.length ? `, ${failed[0].name} wanted ${failed[0].want} got ${failed[0].got}` : ''})`,
  gradedRows.length === key.checks.length && failed.length === 0);

  const gradedBroken = await sim(starter, key.harness);
  const brokenFailed = [...gradedBroken.out.matchAll(/CHECK (\S+) (\S+) (\S+)/g)]
    .filter(m => m[2] !== m[3]);
  ok(`the broken design fails the grading testbench too (${brokenFailed.length} checks)`,
    brokenFailed.length > 0);
}

/* ---------------- Reset restores the broken starter ---------------- */

section('Reset puts the bug back, and the draft survives');
{
  const id = 'debug-ring-overwrite';
  await go(`#/p/${id}`, 2600);
  const before = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);

  await page.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('code').editor().value = '// mine\nint main(){}\n';
  });
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);
  const kept = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  ok('the draft survives a reload', kept.includes('// mine'));

  await page.locator('#resetBtn').click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  check('Reset restores the broken starter, not an empty editor', after.trim(), before.trim());
  ok('which still contains the bug', /if \(n < cap\)/.test(after));
}

check('no uncaught errors', errors, []);
await browser.close();
report('browser/debugging');
