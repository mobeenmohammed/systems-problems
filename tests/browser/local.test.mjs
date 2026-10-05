/* The workspace against a LOCAL runner, in a real browser.

   The mirror image of hosted.test.mjs. That one proves the published site
   works on a machine with nothing installed; this one proves the advanced
   mode still works, is labelled Local rather than Hosted, and that the parts
   only a real toolchain can produce — a warning on a successful build, a
   caret-diagram compile error, a sanitizer trip, a timeout — arrive and are
   presented correctly.

   These checks used to live in tests/browser/runner.test.mjs, driven through
   jsdom by setting a textarea's value. That cannot work any more and should
   never have been trusted: jsdom has no layout engine, CodeMirror needs one,
   and "set .value and dispatch input" is exactly the kind of test that passed
   while three editor bugs shipped. The HTTP half of that suite — token,
   Origin, compile, lint — is still there and still in jsdom, where it belongs.

   Needs:
     npm run serve     the site, on 8000
     npm run runner    the local runner, on 2000

   Run: node tests/browser/local.test.mjs */

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

const SITE = process.env.BASE || 'http://127.0.0.1:8000';
const RUNNER = process.env.RUNNER || 'http://127.0.0.1:2000';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const reachable = async url => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok; }
  catch { return false; }
};

section('the setup this test needs');
const siteUp = await reachable(SITE);
const runnerUp = await reachable(`${RUNNER}/health`);
ok(`the site is served at ${SITE}`, siteUp);
ok(`the local runner is up at ${RUNNER}`, runnerUp);
if (!siteUp || !runnerUp) {
  console.log('\n  start them with:  npm run serve   and   npm run runner');
  report('browser/local');
}

const health = await (await fetch(`${RUNNER}/health`)).json();
const have = new Set((health.languages || []).filter(l => l.available).map(l => l.id));
console.log(`  --    ${[...have].join(', ')} available on the runner`);

const browser = await launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
/* No hosted runner configured at all, so "Local" cannot be a hosted result
   wearing the wrong label. */
await page.addInitScript(() => localStorage.removeItem('systems-lab/hosted-url'));
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

const pasteInto = async (p, text) => {
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.evaluate(async t => { await navigator.clipboard.writeText(t); }, text);
  await p.keyboard.press('Control+v');
  await p.waitForTimeout(300);
};

const waitForRun = async (p, id = '#runBtn') => {
  await p.waitForFunction(
    sel => { const b = document.querySelector(sel); return b && !b.disabled; },
    id, { timeout: 90000 },
  );
  await p.waitForTimeout(400);
};

await page.goto(`${SITE}/#/p/cpp-greet-and-sum`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

section('it says Local, and means it');
{
  const rows = await page.evaluate(async () =>
    window.SystemsLab.Runners.available(['cpp', 'js']));
  const cpp = rows.find(r => r.id === 'cpp');
  check('C++ is ready', cpp.ready, true);
  check('on the local runner', cpp.backend, 'local');
  check('labelled Local', cpp.where, 'Local');
  ok('and it reports the compiler version', !!cpp.version);
  check('JavaScript still runs in the tab',
    rows.find(r => r.id === 'js').backend, 'browser');
}

if (!have.has('cpp')) {
  console.log('  --    g++ is not installed on the runner; skipping the compile checks.');
  await browser.close();
  report('browser/local');
}

section('a program that builds, with a warning');
{
  /* Right answer, and an unused variable, so -Wall has something to say on a
     build that succeeded. Leaving warnings on is the whole point. */
  await pasteInto(page, [
    '#include <iostream>',
    '#include <string>',
    'int add(int a, int b) { return a + b; }',
    'std::string greeting(const std::string& n) { return "Hello, " + n + "!"; }',
    'int main() {',
    '    std::string name;',
    '    int a = 0, b = 0;',
    '    int unusedHere = 7;',
    '    std::cin >> name >> a >> b;',
    '    std::cout << greeting(name) << "\\n";',
    '    std::cout << a << " + " << b << " = " << add(a, b) << "\\n";',
    '}',
  ].join('\n'));

  await page.locator('#runBtn').click();
  await waitForRun(page);

  const r = await page.evaluate(() => {
    const d = document.querySelector('.diags');
    const where = d && d.querySelector('.diag-where');
    return {
      kind: d && d.dataset.kind,
      label: d ? d.querySelector('.lbl').textContent : '',
      rows: d ? d.querySelectorAll('.diag').length : 0,
      where: where ? where.textContent : '',
      raw: d ? d.querySelector('.diags-raw').textContent : '',
      passed: [...document.querySelectorAll('.case')].filter(c => c.dataset.pass === 'true').length,
      cases: document.querySelectorAll('.case').length,
      chip: document.getElementById('execState').textContent.trim(),
    };
  });
  check('it ran on the local runner and says so', r.chip, 'Ran on Local');
  check('every sample case passed', r.passed, r.cases);
  check('the warning is presented as a warning, not a failure', r.kind, 'warn');
  ok('with a summary saying it built', /It built/.test(r.label));
  ok('as a list of places rather than a blob', r.rows > 0);
  ok('the compiler\'s own text is kept underneath', /unused/.test(r.raw));
  ok('and it really came from g++, not the bracket scanner',
    r.raw.includes('-Wunused-variable'));

  /* Clicking a place moves the caret there, which is the only reason to make
     it a button. Checked through CodeMirror's own selection. */
  const line = Number(r.where.split(':')[0]);
  await page.locator('.diag-where').first().click();
  await page.waitForTimeout(250);
  const caretLine = await page.evaluate(() => {
    const view = window.SystemsLab.ProblemTypes.get('code').editor().view;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  check(`clicking "${r.where}" moves the caret to line ${line}`, caretLine, line);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'local-warning.png') });
}

section('a program that does not build');
{
  await pasteInto(page, '#include <iostream>\nint main() { std::cout << nope; }');
  await page.locator('#runBtn').click();
  await waitForRun(page);

  const r = await page.evaluate(() => {
    const d = document.querySelector('.diags');
    return {
      kind: d && d.dataset.kind,
      label: d ? d.querySelector('.lbl').textContent : '',
      errorRows: d ? d.querySelectorAll('.diag[data-severity="error"]').length : 0,
      cases: document.querySelectorAll('.case').length,
      source: window.SystemsLab.ProblemTypes.get('code').editor().value,
      status: window.SystemsLab.Store.record('cpp-greet-and-sum').status,
    };
  });
  check('it is reported as a build failure', r.kind, 'error');
  ok('the summary counts the errors', /did not build/.test(r.label));
  ok('with at least one error row', r.errorRows > 0);
  check('and no cases ran', r.cases, 0);
  ok('the code is untouched', r.source.includes('nope'));
  check('nothing was recorded as solved', r.status === 'solved', false);
}

section('a runaway program is a timeout');
{
  await pasteInto(page, 'int main() { for (;;) {} }');
  await page.locator('#runBtn').click();
  await waitForRun(page);

  const r = await page.evaluate(() => ({
    text: (document.getElementById('resultPane') || {}).textContent || '',
    runEnabled: !document.getElementById('runBtn').disabled,
    built: window.SystemsLab.ProblemTypes.get('code').lastBuildOk(),
  }));
  check('it compiled', r.built, true);
  ok('and the run is reported as having timed out', /timed out|time/i.test(r.text));
  ok('the Run button is usable again', r.runEnabled);
}

section('a sanitizer trip is a failure even when the answer looks right');
{
  /* algo-running-max is built with -fsanitize=address,undefined and declares
     requireClean, so a program that reads one past the end prints the right
     numbers and must still fail. That is the lesson the problem is for. */
  await page.goto(`${SITE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await pasteInto(page, [
    '#include <iostream>',
    '#include <vector>',
    'int main() {',
    '    int n = 0;',
    '    std::cin >> n;',
    '    std::vector<long long> v(n);',
    '    for (int i = 0; i < n; i++) std::cin >> v[i];',
    '    long long best = 0;',
    '    /* <= n walks one element past the end. The numbers printed before',
    '       that are still right, which is exactly the trap. */',
    '    for (int i = 0; i <= n; i++) {',
    '        if (i == 0 || v[i] > best) best = v[i];',
    '        if (i < n) std::cout << best << "\\n";',
    '    }',
    '}',
  ].join('\n'));

  await page.locator('#submitBtn').click();
  await waitForRun(page, '#submitBtn');

  const r = await page.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    text: (document.getElementById('resultPane') || {}).textContent || '',
    status: window.SystemsLab.Store.record('algo-running-max').status,
  }));
  check('it was not accepted', r.verdict === 'Right', false);
  ok('and the sanitizer is named as the reason',
    /sanitizer|AddressSanitizer|heap-buffer-overflow/i.test(r.text));
  check('not recorded as solved', r.status === 'solved', false);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'local-sanitizer.png') });
}

check('no console errors throughout',
  errors.filter(e => !/Failed to load resource/.test(e)), []);
await browser.close();
report('browser/local');
