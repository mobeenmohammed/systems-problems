/* Python in the browser, with no runner anywhere.

   The runner address is pointed at a port nothing serves and hosted
   execution is cleared, so anything that runs here ran in this tab. The
   claims being tested are the ones that would be embarrassing to get
   wrong: that it runs at all without cross-origin isolation, that the
   platform differences are what js/py/interpreter.js says they are, that
   a traceback is the reader's traceback, that an infinite loop can be
   stopped and the next program still runs, and that nothing was sent
   anywhere.

   Needs the site served:   npm run serve
   Run: node tests/browser/python.test.mjs
        SHOTS=1 node tests/browser/python.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { section, check, ok, report } from '../harness.mjs';

const CHANNEL = process.env.BROWSER || null;
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

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const PROBLEM = 'algo-impl-count';

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.addInitScript(() => {
    localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
    localStorage.removeItem('invariant/hosted-url');
  });
  const p = await ctx.newPage();
  return { ctx, p };
}

const settled = async (p, sel = '#runBtn', ms = 240000) => {
  await p.waitForFunction(s => document.querySelector(s)?.disabled, sel,
    { timeout: 20000 }).catch(() => {});
  await p.waitForFunction(s => !document.querySelector(s)?.disabled, sel, { timeout: ms });
};

const paste = async (p, text) => {
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.evaluate(t => navigator.clipboard.writeText(t), text);
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(200);
};

/* Open the problem and switch to Python, waiting for the tab rather than
   for a guessed number of milliseconds. */
async function openPython(p, id = PROBLEM) {
  await p.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(
    () => !document.querySelector('.lang-tab[data-lang="python"]')?.disabled,
    { timeout: 40000 });
  await p.locator('.lang-tab[data-lang="python"]').click();
  await p.waitForTimeout(900);
}

const cases = p => p.evaluate(() => {
  const all = [...document.querySelectorAll('.case')];
  return {
    total: all.length,
    passed: all.filter(c => c.dataset.pass === 'true').length,
    first: (all[0]?.querySelector('.case-head')?.textContent || '').replace(/\s+/g, ' ').trim(),
    stderr: [...(all[0]?.querySelectorAll('.io pre') || [])].map(x => x.textContent).join('\n'),
  };
});

const reference = JSON.parse(
  fs.readFileSync(`solutions/${PROBLEM}.json`, 'utf8')).key.reference.python;

/* ---------------- it runs at all ---------------- */

section('Python runs in the browser, with nothing installed');
{
  const { ctx, p } = await freshPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));

  await openPython(p);
  const chip = await p.evaluate(() =>
    document.getElementById('execState').textContent.trim());
  ok(`the chip says where it will run ("${chip}")`, /Browser/.test(chip));
  ok('and which Python', /CPython 3\.\d+/.test(chip));

  await paste(p, reference);
  const t0 = Date.now();
  await p.locator('#runBtn').click();

  /* The download has to be visible while it happens: 13 MB of silence is
     indistinguishable from a page that has hung. */
  let sawProgress = '';
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    const now = await p.evaluate(() => ({
      text: (document.querySelector('#cxxDlText') || {}).textContent || '',
      busy: document.querySelector('#runBtn').disabled,
    }));
    if (now.text && !sawProgress) sawProgress = now.text;
    if (!now.busy && sawProgress) break;
    await p.waitForTimeout(150);
  }
  await settled(p);
  ok(`the download says what it is doing ("${sawProgress}")`,
    /Python/i.test(sawProgress) || /interpreter/i.test(sawProgress));

  const r = await cases(p);
  ok(`the sample cases pass (${r.passed}/${r.total}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    r.total > 0 && r.passed === r.total);
  check('no uncaught errors', errors.length, 0);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'python-run.png') });
  await ctx.close();
}

/* ---------------- the platform, measured ---------------- */

section('it says what platform it is, and it is not Linux');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  await paste(p, [
    'import sys',
    'print(sys.version.split()[0])',
    'print(sys.platform)',
    'print(sys.maxsize.bit_length() + 1)',
    'print(2**70)',
  ].join('\n'));
  await p.locator('#runBtn').click();
  await settled(p);

  const got = await p.evaluate(() => {
    const pre = [...document.querySelectorAll('.case .io h5')]
      .map((h, i) => [h.textContent, document.querySelectorAll('.case .io pre')[i]?.textContent]);
    return Object.fromEntries(pre).got || '';
  });
  const lines = got.trim().split('\n');
  ok(`CPython 3.x (${lines[0]})`, /^3\./.test(lines[0] || ''));
  check('sys.platform is emscripten, not linux', lines[1], 'emscripten');
  check('sys.maxsize is 32-bit here, where native CPython is 64', lines[2], '32');
  /* The thing that is *not* different, and the reason the 32-bit note
     matters less than it sounds: Python ints are arbitrary precision. */
  check('but integers are still arbitrary precision', lines[3],
    String(2n ** 70n));
  await ctx.close();
}

section('the standard library is there, and nothing beyond it');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  await paste(p, [
    'import json, math, collections, itertools, heapq, bisect, re, functools, decimal, fractions',
    'print("stdlib ok")',
    'try:',
    '    import numpy',
    '    print("numpy present")',
    'except ImportError:',
    '    print("no numpy, as documented")',
  ].join('\n'));
  await p.locator('#runBtn').click();
  await settled(p);
  const got = await p.evaluate(() => {
    const h5 = [...document.querySelectorAll('.case .io h5')].map(h => h.textContent);
    const pre = [...document.querySelectorAll('.case .io pre')].map(x => x.textContent);
    return Object.fromEntries(h5.map((k, i) => [k, pre[i]])).got || '';
  });
  ok('the standard library imports', /stdlib ok/.test(got));
  ok('and there is no numpy, which the README says too',
    /no numpy, as documented/.test(got));
  await ctx.close();
}

/* ---------------- failure, reported as failure ---------------- */

section('a traceback is the reader\'s traceback');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  await paste(p, 'xs = [1, 2, 3]\nprint(xs[9])');
  await p.locator('#runBtn').click();
  await settled(p);
  const r = await cases(p);
  ok(`it did not pass (${r.first})`, r.passed === 0);
  ok('it says the program exited badly rather than "wrong output"',
    /Exited with status/.test(r.first));
  ok('the exception is named', /IndexError/.test(r.stderr));
  ok('with the line the reader wrote', /line 2/.test(r.stderr));
  ok('and no frames from the harness that ran it',
    !/interpreter\.js|_run|exec\(/.test(r.stderr));
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'python-traceback.png') });
  await ctx.close();
}

section('a wrong answer is a wrong answer, not a crash');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  await paste(p, 'print("definitely not the answer")');
  await p.locator('#runBtn').click();
  await settled(p);
  const r = await cases(p);
  ok(`it is reported as wrong output (${r.first})`, /Wrong output/.test(r.first));
  await ctx.close();
}

section('too much output is truncated rather than filling the tab');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  await paste(p, 'for i in range(200000):\n    print("x" * 80)');
  await p.locator('#runBtn').click();
  await settled(p);
  const r = await cases(p);
  ok('it came back at all', r.total > 0);
  ok('and said it had been truncated', /truncated/.test(r.stderr));
  await ctx.close();
}

/* ---------------- the loop that cannot be interrupted ---------------- */

section('an infinite loop is stopped, and the next program still runs');
{
  const { ctx, p } = await freshPage();
  await openPython(p);

  await paste(p, 'while True:\n    pass');
  const t0 = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  const loop = await cases(p);
  ok(`it was cut short after ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    /Timed out/i.test(loop.first));
  ok('the page is still there', await p.evaluate(() => !!document.querySelector('.cm-content')));

  await paste(p, reference);
  const t1 = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  const after = await cases(p);
  ok(`a valid program runs straight afterwards (${after.passed}/${after.total}, `
    + `${((Date.now() - t1) / 1000).toFixed(1)}s)`,
    after.total > 0 && after.passed === after.total);
  await ctx.close();
}

section('Stop actually stops it');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  await paste(p, 'while True:\n    pass');
  await p.locator('#runBtn').click();
  await p.waitForFunction(() => !document.getElementById('stopBtn').hidden,
    { timeout: 30000 });
  await p.waitForTimeout(300);
  const t0 = Date.now();
  await p.locator('#stopBtn').click();
  /* Not settled(): that waits for Run to go busy first, and after a stop
     it never does again — which is twenty seconds of its own timeout
     being reported as the runner being slow. */
  await p.waitForFunction(() => !document.getElementById('runBtn').disabled,
    { timeout: 60000 });

  const stopped = await p.evaluate(() => ({
    text: (document.getElementById('resultPane') || {}).textContent || '',
    runEnabled: !document.getElementById('runBtn').disabled,
    stopHidden: document.getElementById('stopBtn').hidden,
    status: window.SystemsLab.Store.record('algo-impl-count').status,
  }));
  ok(`it came back in ${((Date.now() - t0) / 1000).toFixed(1)}s`, Date.now() - t0 < 20000);
  ok(`and said it was stopped ("${stopped.text.replace(/\s+/g, ' ').slice(0, 90)}")`,
    /stopped/i.test(stopped.text));
  ok('Run is usable again', stopped.runEnabled);
  ok('Stop is put away', stopped.stopHidden);
  check('and nothing was recorded', stopped.status === 'solved', false);

  await paste(p, reference);
  await p.locator('#runBtn').click();
  await settled(p);
  const back = await cases(p);
  ok(`a real program runs after a cancellation (${back.passed}/${back.total})`,
    back.total > 0 && back.passed === back.total);
  await ctx.close();
}

/* ---------------- isolation between cases ---------------- */

section('one case cannot see what the last one defined');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  /* Two sample cases, so this runs twice in the same interpreter. The
     first pass defines a global; the second must not see it. */
  await paste(p, [
    'import sys',
    'seen = "leaked" in globals()',
    'leaked = True',
    'print("saw a leftover" if seen else "clean namespace")',
  ].join('\n'));
  await p.locator('#runBtn').click();
  await settled(p);
  const got = await p.evaluate(() =>
    [...document.querySelectorAll('.case .io pre')].map(x => x.textContent).join('|'));
  ok('every case started with a clean namespace',
    !/saw a leftover/.test(got) && /clean namespace/.test(got));
  await ctx.close();
}

/* ---------------- submitting ---------------- */

section('submit runs the hidden cases and records the solve');
{
  const { ctx, p } = await freshPage();
  await openPython(p);
  await paste(p, reference);
  await p.locator('#submitBtn').click();
  await settled(p, '#submitBtn');

  const r = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent,
    detail: (document.querySelector('.verdict p') || {}).textContent,
    status: window.SystemsLab.Store.record('algo-impl-count').status,
    lang: window.SystemsLab.Store.record('algo-impl-count').lang,
  }));
  check('it is right', r.verdict, 'Right');
  ok(`and ran more than the samples (${r.detail})`, /\d+ cases passed/.test(r.detail));
  check('the solve is recorded', r.status, 'solved');
  check('against Python', r.lang, 'python');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'python-submit.png') });
  await ctx.close();
}

/* ---------------- the audit, and what it certifies ---------------- */

section('only audited problems are offered, and the audit is generated');
{
  const support = JSON.parse(fs.readFileSync('data/py-support.json', 'utf8'));
  ok('the file says it is generated', /GENERATED by scripts\/audit-py\.mjs/.test(support._note));
  ok('it names the interpreter it certified against',
    /CPython/.test(JSON.stringify(support.runtime)));
  ok(`it certifies the Python problems (${support.browser.length} of ${support.generated})`,
    support.browser.length > 0 && support.browser.length <= support.generated);

  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/p/${PROBLEM}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  const asked = await p.evaluate(async id =>
    window.SystemsLab.Runners.available(['python'], id).then(r => r[0].ready), PROBLEM);
  ok('a certified problem is offered Python', asked === true);

  const uncertified = await p.evaluate(async () =>
    window.SystemsLab.Runners.available(['python'], 'no-such-problem-at-all')
      .then(r => r[0].ready));
  ok('an unknown problem is not', uncertified === false);
  await ctx.close();
}

/* ---------------- nothing left the machine ---------------- */

section('nothing was sent anywhere');
{
  const { ctx, p } = await freshPage();
  const outside = [];
  const runner = [];
  p.on('request', r => {
    const u = r.url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return;
    if (/127\.0\.0\.1:(2999|2000)/.test(u)) { runner.push(u); return; }
    outside.push(u);
  });

  await openPython(p);
  await paste(p, reference);
  await p.locator('#runBtn').click();
  await settled(p);

  ok(`no request to any other origin${outside.length ? `: ${outside[0]}` : ''}`,
    outside.length === 0);
  ok('the only runner traffic is the probe finding nothing there',
    runner.every(u => /127\.0\.0\.1:2999/.test(u)));
  await ctx.close();
}

await browser.close();
report('browser/python');
