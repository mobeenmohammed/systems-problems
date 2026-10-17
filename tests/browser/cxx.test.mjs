/* C++ in the browser: the whole journey, with nothing installed.

   The point of this backend is that somebody can open the published site on
   a borrowed laptop and compile C++. So this suite runs with the local
   runner's address pointed at a dead port and no hosted runner configured,
   which means a pass here cannot have come from anywhere else.

   It is slow on the first run — 90 MB of Clang has to come down — and quick
   afterwards, which is also the reader's experience and worth watching.

   Needs the site served:   npm run serve
   And the local runner DOWN, which is the point.

   Run: node tests/browser/cxx.test.mjs
        SHOTS=1 ... (also write screenshots) */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report, toEditorTab } from '../harness.mjs';

/* BROWSER=msedge runs it through the Edge installed on this machine. */
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

const support = JSON.parse(fs.readFileSync('data/cxx-support.json', 'utf8'));

const browser = await launch();
const errors = [];

/* A browser that believes it is on a device with nothing installed. */
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback/.test(m.text())) return;
    errors.push(m.text());
  });
  await p.addInitScript(() => {
    localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
    localStorage.removeItem('invariant/hosted-url');
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  return { ctx, p };
}

const paste = async (p, text) => {
  await toEditorTab(p);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.evaluate(async t => { await navigator.clipboard.writeText(t); }, text);
  await p.keyboard.press('Control+v');
  await p.waitForTimeout(250);
};

/* Wait for a run to *start* and then to finish. Waiting only for "enabled"
   returns the instant it is called on a button that has not been disabled
   yet, which made the next assertion read the previous run's result. */
const settled = async (p, sel = '#runBtn', timeout = 300000) => {
  try {
    await p.waitForFunction(
      s => { const b = document.querySelector(s); return b && b.disabled; },
      sel, { timeout: 5000 },
    );
  } catch { /* it finished before we looked, which is fine */ }
  await p.waitForFunction(
    s => { const b = document.querySelector(s); return b && !b.disabled; },
    sel, { timeout },
  );
  await p.waitForTimeout(500);
};

const cases = p => p.evaluate(() => {
  const all = [...document.querySelectorAll('.case')];
  return { total: all.length, passed: all.filter(c => c.dataset.pass === 'true').length };
});

/* The reference solutions, read out of the answer keys. A recovery check
   should exercise the runner, not a program invented for the test — and
   these are the same programs the audit certified. */
const referenceFor = id =>
  JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8')).key.reference.cpp;

const COUNT_OK = referenceFor('algo-impl-count');
const DIGITS_OK = referenceFor('cpp-count-digits');
const GREET_OK = referenceFor('cpp-greet-and-sum');

/* ---------------- what the audit says ---------------- */

section('the support list was generated, not written');
{
  check('it names the toolchain', support.toolchain.compiler, 'clang 20.1.2');
  check('and the target', support.toolchain.target, 'wasm32-unknown-wasi');
  ok(`${support.browser.length} problems are certified for the browser`,
    support.browser.length >= 25);
  ok('and the sanitizer problem is not one of them',
    !support.browser.includes('algo-running-max'));
  ok('which is explained rather than just excluded',
    /sanitizer/i.test(support.nativeOnly['algo-running-max'] || ''));
}

/* ---------------- the first run, including the download ---------------- */

section('a device with nothing installed can compile C++');
let firstRunMs = 0;
{
  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/p/cpp-greet-and-sum`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  const before = await p.evaluate(async () => {
    const rows = await window.SystemsLab.Runners.available(['cpp'], 'cpp-greet-and-sum');
    return { ready: rows[0].ready, backend: rows[0].backend, where: rows[0].where,
      chip: document.getElementById('execState').textContent.trim() };
  });
  check('C++ is offered', before.ready, true);
  check('on the in-browser compiler', before.backend, 'browsercpp');
  check('and a reader is told it runs here', before.where, 'Browser');

  await paste(p, GREET_OK);

  const t0 = Date.now();
  await p.locator('#runBtn').click();

  /* The download has to be visible, and stoppable, while it happens. */
  let sawProgress = false;
  let sawStop = false;
  for (let i = 0; i < 60 && !sawProgress; i += 1) {
    const look = await p.evaluate(() => ({
      bar: !!document.querySelector('.cxx-dl'),
      text: (document.querySelector('#cxxDlText') || {}).textContent || '',
      stop: !!document.querySelector('#stopBtn') && !document.querySelector('#stopBtn').hidden,
    }));
    if (look.bar && /MB/.test(look.text)) sawProgress = true;
    if (look.stop) sawStop = true;
    if (!sawProgress) await p.waitForTimeout(200);
  }
  ok('the download reports itself in megabytes', sawProgress);
  ok('and Stop is live while it happens', sawStop);
  if (process.env.SHOTS && sawProgress) {
    await p.screenshot({ path: path.join(SHOTS, 'cxx-downloading.png') });
  }

  await settled(p);
  firstRunMs = Date.now() - t0;

  const r = await cases(p);
  const after = await p.evaluate(() => ({
    chip: document.getElementById('execState').textContent.trim(),
    stop: document.querySelector('#stopBtn').hidden,
  }));
  ok(`the samples ran (${r.passed}/${r.total}) in ${(firstRunMs / 1000).toFixed(1)}s including the download`,
    r.total > 0 && r.passed === r.total);
  check('and the toolbar says where', after.chip, 'Ran on Browser');
  check('Stop is put away again', after.stop, true);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'cxx-first-run.png') });

  /* ---- the acceptance journey, on the same page ---- */

  section('submit a wrong answer, correct it, submit again');
  await paste(p, [
    '#include <iostream>',
    '#include <string>',
    'int main() {',
    '    std::string n; int a = 0, b = 0;',
    '    std::cin >> n >> a >> b;',
    '    std::cout << "Hello, " << n << std::endl;',
    '    std::cout << a << " + " << b << " = " << (a * b) << std::endl;',
    '}',
  ].join('\n'));
  await p.locator('#submitBtn').click();
  await settled(p, '#submitBtn');

  const wrong = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent,
    status: window.SystemsLab.Store.record('cpp-greet-and-sum').status,
    editable: !document.querySelector('.cm-content').matches('[contenteditable="false"]'),
    source: window.SystemsLab.ProblemTypes.get('code').editor().value,
  }));
  ok(`a wrong submission is marked wrong ("${wrong.verdict}")`, wrong.verdict !== 'Right');
  check('and not recorded as solved', wrong.status === 'solved', false);
  ok('the editor is still editable', wrong.editable);
  ok('and the code is as it was left', wrong.source.includes('(a * b)'));

  await paste(p, GREET_OK);
  await p.locator('#submitBtn').click();
  await settled(p, '#submitBtn');

  const right = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent,
    status: window.SystemsLab.Store.record('cpp-greet-and-sum').status,
    xp: window.SystemsLab.Store.state.xp,
    chip: document.getElementById('execState').textContent.trim(),
  }));
  check('the corrected one is accepted', right.verdict, 'Right');
  check('and recorded as solved', right.status, 'solved');
  ok('and paid out', right.xp > 0);
  check('still on the in-browser compiler', right.chip, 'Ran on Browser');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'cxx-submitted.png') });

  /* ---- compile error ---- */

  section('a compile error is the compiler\'s own words');
  await paste(p, '#include <iostream>\nint main(){ std::cout << nope; }');
  await p.locator('#runBtn').click();
  await settled(p);
  const diag = await p.evaluate(() => {
    const impl = window.SystemsLab.ProblemTypes.get('code');
    const d = document.querySelector('.diags');
    return {
      built: impl.lastBuildOk(),
      text: impl.lastCompilerOutput(),
      kind: d && d.dataset.kind,
      rows: d ? d.querySelectorAll('.diag[data-severity="error"]').length : 0,
      source: impl.editor().value,
    };
  });
  check('it did not build', diag.built, false);
  ok('Clang said why', /nope/.test(diag.text) && /error/.test(diag.text));
  check('presented as a build failure', diag.kind, 'error');
  ok('with a clickable place', diag.rows > 0);
  ok('and the code is untouched', diag.source.includes('nope'));

  /* One place for the compiler's words. Results used to carry a second
     copy of the same list, which is a reader deciding which is
     authoritative, and it pushed what the program did below the fold. */
  const split = await p.evaluate(() => {
    const tab = [...document.querySelectorAll('.ws-tabs-work .tab')]
      .find(t => t.getAttribute('aria-selected') === 'true' || t.dataset.active === 'true');
    const open = (tab && tab.textContent.trim()) || '';
    const pane = (document.getElementById('resultPane') || {}).innerText || '';
    return { open, pane, diags: document.querySelectorAll('#resultPane .diag').length };
  });
  ok(`a failed build opens Compiler output (${split.open})`, /Compiler output/.test(split.open));
  ok('and it is the list that is there', split.diags > 0);

  for (const t of await p.$$('.ws-tabs-work .tab')) {
    if ((await t.textContent()).trim().startsWith('Results')) { await t.click(); break; }
  }
  await p.waitForTimeout(400);
  const res = await p.evaluate(() => ({
    text: (document.getElementById('resultPane') || {}).innerText || '',
    diags: document.querySelectorAll('#resultPane .diag').length,
    toCompiler: !!document.querySelector('#toCompilerOut'),
  }));
  check('Results does not repeat the list', res.diags, 0);
  ok('it says the build failed', /did not build/i.test(res.text));
  ok('offers the way to the compiler', res.toCompiler);
  ok('and invents no failed-case count',
    !/\d+\s*\/\s*\d+/.test(res.text) && !/of \d+ cases/.test(res.text));

  /* A build that succeeds WITH warnings: the count, and a way there —
     not the warnings themselves, twice. */
  await paste(p, ['#include <iostream>',
    'int main(){ int unused = 5; std::cout << 4 << std::endl; }'].join('\n'));
  await p.locator('#runBtn').click();
  await settled(p);
  const warned = await p.evaluate(() => ({
    line: (document.querySelector('.buildline') || {}).textContent || '',
    diags: document.querySelectorAll('#resultPane .diag').length,
    cases: document.querySelectorAll('#resultPane .case').length,
    raw: (window.SystemsLab.ProblemTypes.get('code').lastCompilerOutput() || ''),
  }));
  if (/warning/i.test(warned.raw)) {
    ok(`Results carries the count (${warned.line.slice(0, 48)})`, /warning/i.test(warned.line));
    check('and still not the list', warned.diags, 0);
  } else {
    ok('this compiler had no warning for it, so there is no count to check', true);
  }
  ok('the cases are what Results is for', warned.cases > 0);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'cxx-compile-error.png') });

  /* ---- timeout, then recovery ---- */

  section('an infinite loop is stopped, and the next program still runs');
  await paste(p, '#include <iostream>\nint main(){ for(;;){} }');
  const tLoop = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  const loop = await p.evaluate(() => ({
    text: (document.getElementById('resultPane') || {}).textContent || '',
    built: window.SystemsLab.ProblemTypes.get('code').lastBuildOk(),
  }));
  check('it compiled', loop.built, true);
  ok(`and the run was cut short after ${((Date.now() - tLoop) / 1000).toFixed(1)}s`,
    /timed out|time/i.test(loop.text));
  ok('without taking the page with it', await p.evaluate(() => !!document.querySelector('.cm-content')));

  await p.goto(`${BASE}/#/p/algo-impl-count`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await paste(p, COUNT_OK);
  const tAfter = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  const recovered = await cases(p);
  ok(`a valid program runs straight afterwards (${recovered.passed}/${recovered.total}, `
    + `${((Date.now() - tAfter) / 1000).toFixed(1)}s)`,
    recovered.total > 0 && recovered.passed === recovered.total);

  /* ---- cancellation ---- */

  section('Stop actually stops it');
  await paste(p, '#include <iostream>\nint main(){ for(;;){} }');
  await p.locator('#runBtn').click();
  await p.waitForFunction(() => !document.getElementById('stopBtn').hidden, { timeout: 30000 });
  await p.waitForTimeout(400);
  const tStop = Date.now();
  await p.locator('#stopBtn').click();
  await settled(p);
  const stopped = await p.evaluate(() => ({
    text: (document.getElementById('resultPane') || {}).textContent || '',
    runEnabled: !document.getElementById('runBtn').disabled,
    stopHidden: document.querySelector('#stopBtn').hidden,
    source: window.SystemsLab.ProblemTypes.get('code').editor().value,
    status: window.SystemsLab.Store.record('algo-impl-count').status,
  }));
  ok(`it came back in ${((Date.now() - tStop) / 1000).toFixed(1)}s`, Date.now() - tStop < 20000);
  ok(`and said it was stopped ("${stopped.text.slice(0, 60).trim()}")`, /stopped/i.test(stopped.text));
  ok('Run is usable again', stopped.runEnabled);
  ok('Stop is put away', stopped.stopHidden);
  ok('the code is still there', stopped.source.includes('for(;;)'));
  check('and nothing was recorded', stopped.status === 'solved', false);

  await paste(p, COUNT_OK);
  await p.locator('#runBtn').click();
  await settled(p);
  const afterStop = await cases(p);
  ok(`and a real program runs after a cancellation (${afterStop.passed}/${afterStop.total})`,
    afterStop.total > 0 && afterStop.passed === afterStop.total);

  await ctx.close();
}

/* ---------------- the second visit ---------------- */

section('the compiler is cached, so coming back fetches nothing');
{
  /* Two mistakes this check has made, both worth not making again.

     It used to compare wall-clock against the first run, which only
     means anything if the first run was genuinely cold — against a
     deployed site with the assets already in the HTTP cache it was not,
     and the failure said nothing about caching.

     Then it counted bytes, but in a *fresh context*, whose Cache API is
     empty. Re-fetching there is correct behaviour. A return visit is the
     same browser coming back, so that is what this does: one context,
     one cold run, a reload, and a second run. */
  const { ctx, p } = await freshPage();

  let bytes = 0;
  const fetched = [];
  let counting = false;
  p.on('response', res => {
    if (!counting) return;
    const u = res.url();
    if (!/\.(wasm|tar)(\?|$)/.test(u)) return;
    const len = Number(res.headers()['content-length'] || 0);
    if (res.status() === 200 && len > 0) { bytes += len; fetched.push(u.split('/').pop()); }
  });

  await p.goto(`${BASE}/#/p/cpp-count-digits`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await paste(p, DIGITS_OK);
  const cold = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  const coldMs = Date.now() - cold;
  const first = await cases(p);
  ok(`it ran the first time (${first.passed}/${first.total})`,
    first.total > 0 && first.passed === first.total);

  /* Everything from here is the return visit. */
  counting = true;
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await paste(p, DIGITS_OK);
  const warm = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  const warmMs = Date.now() - warm;
  const again = await cases(p);

  ok(`it ran again (${again.passed}/${again.total})`,
    again.total > 0 && again.passed === again.total);
  console.log(`  --    cold ${(coldMs / 1000).toFixed(1)}s, after a reload `
    + `${(warmMs / 1000).toFixed(1)}s, ${(bytes / 1048576).toFixed(1)} MB off the wire`);
  ok(`the 90 MB was not fetched again (${(bytes / 1048576).toFixed(1)} MB`
    + `${fetched.length ? `: ${[...new Set(fetched)].join(', ')}` : ''})`,
    bytes < 5 * 1048576);
  ok(`and it was quick about it (${(warmMs / 1000).toFixed(1)}s)`, warmMs < 30000);
  await ctx.close();
}

/* ---------------- the one that must not run here ---------------- */

section('a sanitizer problem is marked native-only rather than quietly relaxed');
{
  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  const state = await p.evaluate(async () => {
    const rows = await window.SystemsLab.Runners.available(['cpp'], 'algo-running-max');
    const said = await window.SystemsLab.Runners.describe(['cpp'], 'algo-running-max');
    return {
      ready: rows[0].ready,
      chip: document.getElementById('execState').textContent.trim(),
      sentence: said.text,
      nativeOnly: said.nativeOnly || null,
      editable: !document.querySelector('.cm-content').matches('[contenteditable="false"]'),
      note: (document.getElementById('codeJudgeText') || {}).textContent || '',
    };
  });
  check('C++ is not offered for it', state.ready, false);
  ok(`the sentence says it needs the native toolchain ("${state.sentence}")`,
    /native toolchain/i.test(state.sentence));
  ok('and the reason names the sanitizer', /sanitizer/i.test(state.nativeOnly || ''));
  ok('while the editor stays usable', state.editable);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'cxx-native-only.png') });

  /* Pressing Run anyway used to answer with the generic "no runner is
     listening at 127.0.0.1:2000, start one with npm run runner" - which
     contradicted the note directly above the editor and buried the reason
     the exercise needs the native toolchain in the first place. */
  await p.locator('#runBtn').click();
  await p.waitForTimeout(3500);
  const pressed = await p.evaluate(() => {
    /* The reason sits behind a disclosure, which is where a technical
       reason belongs; a reader opens it, so the test does too. */
    const d = document.querySelector('.platform-detail');
    if (d) d.open = true;
    return {
      pane: (document.getElementById('resultPane') || {}).textContent
        .replace(/\s+/g, ' ').trim(),
      kind: (document.querySelector('.platform') || {}).dataset?.kind,
      verdict: !!document.querySelector('.verdict'),
      retry: !!document.querySelector('#retryRunBtn'),
      status: window.SystemsLab.Store.record('algo-running-max').status,
    };
  });
  check('pressing Run reports a toolchain gap', pressed.kind, 'toolchain');
  ok('it says it is the compiler here, not a missing runner',
    /cannot be built here/i.test(pressed.pane) && /gap in the compiler/i.test(pressed.pane));
  ok('and not a mistake in what they wrote', /not a mistake in what you wrote/i.test(pressed.pane));
  ok('there is no verdict and no score', !pressed.verdict && !/passed/i.test(pressed.pane));
  ok('and repeats the sanitizer reason there too', /sanitizer/i.test(pressed.pane));
  ok('without telling anyone to start a local runner for it',
    !/start one with|npm run runner, or turn on hosted/i.test(pressed.pane));
  ok('and without a Try again that could never work', !pressed.retry);
  check('and nothing is recorded', pressed.status, 'unsolved');
  await ctx.close();
}

/* ---------------- a download that did not finish ----------------

   90 MB over somebody's hotel wifi. This is the most likely way for a
   first run to fail, and it is not the reader's fault, not permanent,
   and not fixed by anything in the local-runner instructions. What it
   needs is to be named for what it is and to be retryable with the
   code untouched. */

section('an interrupted download says so, and Try again picks it up');
{
  const { ctx, p } = await freshPage();
  let cut = true;
  await p.route('**/vendor/cxx/**', r => (cut ? r.abort('connectionfailed') : r.continue()));

  await p.goto(`${BASE}/#/p/cpp-count-digits`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1600);
  const marked = `${DIGITS_OK}\n// a line only this test would write\n`;
  await paste(p, marked);

  await p.locator('#runBtn').click();
  await settled(p);

  const failed = await p.evaluate(() => ({
    kind: (document.querySelector('.platform') || {}).dataset?.kind,
    head: (document.querySelector('.platform-head') || {}).textContent || '',
    say: (document.querySelector('.platform-say') || {}).textContent || '',
    detail: (document.querySelector('.platform-detail p') || {}).textContent || '',
    retry: !!document.querySelector('#retryRunBtn'),
    setup: !!document.querySelector('.platform-acts a[href="#/setup"]'),
    verdict: !!document.querySelector('.verdict'),
    runEnabled: !document.querySelector('#runBtn').disabled,
    code: window.SystemsLab.ProblemTypes.get('code').editor().value,
    status: window.SystemsLab.Store.record('cpp-count-digits').status,
    attempts: window.SystemsLab.Store.record('cpp-count-digits').attempts,
  }));

  check('it is reported as a download, not as a missing toolchain', failed.kind, 'download');
  ok(`and said so in words (${failed.head})`, /did not finish downloading/.test(failed.head));
  ok('it says plainly that it was not the reader\u2019s code', /Not your code/.test(failed.head));
  ok('and that nothing was graded or recorded',
    /nothing was graded/i.test(failed.say) && /recorded/.test(failed.say));
  ok('there is no verdict, because nothing ran', !failed.verdict);
  ok('the technical reason is there to expand', failed.detail.length > 10);
  ok('Try again is offered', failed.retry);
  ok('and nothing sends them off to install a local runner', !failed.setup);
  ok('Run is usable again', failed.runEnabled);
  ok('the draft is exactly as it was', failed.code.includes('a line only this test would write'));
  check('nothing was recorded', failed.status, 'unsolved');
  check('and no attempt was counted', failed.attempts, 0);

  /* The connection comes back. */
  cut = false;
  await p.locator('#retryRunBtn').click();
  await settled(p, '#runBtn', 300000);

  const after = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent || '',
    platform: !!document.querySelector('.platform'),
    code: window.SystemsLab.ProblemTypes.get('code').editor().value,
  }));
  const ran = await cases(p);
  ok(`Try again compiled and ran (${after.exec})`, /Ran on/.test(after.exec));
  ok('the platform message is gone', !after.platform);
  check('every sample case passed', ran.passed, ran.total);
  ok('and the code is still the reader\u2019s',
    after.code.includes('a line only this test would write'));
  await ctx.close();
}

/* ---------------- nothing left the machine ---------------- */

section('nothing was sent anywhere');
{
  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/p/cpp-loop-multiples`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await paste(p, [
    '#include <iostream>',
    'int main(){ int n=0; std::cin>>n; long long s=0;',
    '  for(int i=1;i<=n;i++) if(i%3==0||i%5==0) s+=i;',
    '  std::cout << s << std::endl; }',
  ].join('\n'));
  await p.locator('#runBtn').click();
  await settled(p);

  const net = await p.evaluate(() => {
    const names = performance.getEntriesByType('resource').map(e => e.name);
    return {
      offSite: names.filter(n => !n.startsWith(location.origin)),
      toRunner: names.filter(n => /127\.0\.0\.1:(2999|2000)\/(run|lint)/.test(n)),
      vendor: names.filter(n => n.includes('/vendor/cxx/')).length,
    };
  });
  /* The runner address is deliberately pointed at a dead port, so the page
     probing it and being refused is the page working correctly. */
  check('no request to any other origin',
    net.offSite.filter(u => !u.includes('127.0.0.1:2999')), []);
  check('and none to a runner', net.toRunner, []);
  ok(`the compiler came from this site (${net.vendor} asset requests)`, net.vendor >= 1);
  await ctx.close();
}

check('no unexpected console errors', errors, []);
await browser.close();
report('browser/cxx');
