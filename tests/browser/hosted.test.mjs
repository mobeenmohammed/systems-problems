/* Hosted execution, through the browser, with no local runner.

   This is the journey that matters for the deployed site: open the page on a
   device that has no runner, write C++, press Run, and get an answer. It is
   driven through Chromium with real typing and real clicks, against the
   proxy in proxy/ — the same handler a Worker would run.

   Needs two things up:
     npm run serve     the site, on 8000
     npm run proxy     the execution proxy, on 8787

   and the local runner DOWN, which is the point:
     npm run runner:stop

   Run: node tests/browser/hosted.test.mjs */

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
const PROXY = process.env.PROXY || 'http://127.0.0.1:8787';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

section('the setup this test needs');
const siteUp = await reachable(SITE);
const proxyUp = await reachable(`${PROXY}/health`);
const runnerUp = await reachable('http://127.0.0.1:2000/health');

ok(`the site is served at ${SITE}`, siteUp);
ok(`the proxy is up at ${PROXY}`, proxyUp);
if (!siteUp || !proxyUp) {
  console.log('\n  start them with:  npm run serve   and   npm run proxy');
  report('browser/hosted');
}
if (runnerUp) {
  console.log('  --    a LOCAL runner is also up, so "hosted" could be a false pass.');
  console.log('  --    stop it with: npm run runner:stop');
}
check('no local runner is running, so hosted is the only way this can work',
  runnerUp, false);

const browser = await launch();
const errors = [];

/* A page that believes it is the deployed site: hosted execution configured,
   and the runner address pointed at a port nothing serves, so an accidental
   fallback to localhost would be visible rather than lucky. */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(url => {
  localStorage.setItem('systems-lab/hosted-url', url);
  localStorage.setItem('systems-lab/judge-url', 'http://127.0.0.1:2999');
}, PROXY);

await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.goto(`${SITE}/#/p/cpp-greet-and-sum`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

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
  await p.waitForTimeout(500);
};

section('the page knows where it can run');
{
  const state = await page.evaluate(async () => {
    const rows = await window.SystemsLab.Runners.available(['cpp']);
    const described = await window.SystemsLab.Runners.describe(['cpp']);
    return { rows, described, hosted: window.SystemsLab.Hosted.state };
  });
  check('C++ is runnable', state.rows[0].ready, true);
  check('and it says where: hosted', state.rows[0].backend, 'hosted');
  check('labelled for a person', state.rows[0].where, 'Hosted');
  ok('the toolbar sentence names it', /Hosted/.test(state.described.text));
  ok('the proxy reported its languages', state.hosted.languages.includes('cpp'));
  check('and because everything can run, no explanation is in the way',
    await page.evaluate(() => {
      const n = document.querySelector('.judge-state');
      return n ? getComputedStyle(n).display : 'absent';
    }), 'none');
}

section('write C++ and press Run, with no local runner');
{
  await pasteInto(page, [
    '#include <iostream>',
    '#include <string>',
    'int add(int a, int b) { return a + b; }',
    'std::string greeting(const std::string& n) { return "Hello, " + n + "!"; }',
    'int main() {',
    '  std::string n; int a = 0, b = 0;',
    '  std::cin >> n >> a >> b;',
    '  std::cout << greeting(n) << "\\n";',
    '  std::cout << a << " + " << b << " = " << add(a, b) << "\\n";',
    '}',
  ].join('\n'));

  await page.locator('#runBtn').click();
  await waitForRun(page);

  const result = await page.evaluate(() => {
    const cases = [...document.querySelectorAll('.case')];
    return {
      cases: cases.length,
      passed: cases.filter(c => c.dataset.pass === 'true').length,
    };
  });
  ok(`sample cases ran (${result.passed}/${result.cases} passed)`, result.cases > 0);
  check('all of them passed', result.passed, result.cases);
  check('and the toolbar says where it ran',
    await page.evaluate(() => document.getElementById('execState').textContent.trim()),
    'Ran on Hosted');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hosted-run.png') });
}

section('submit, hosted, and have it marked');
{
  await page.locator('#submitBtn').click();
  await waitForRun(page, '#submitBtn');

  const after = await page.evaluate(() => ({
    status: window.SystemsLab.Store.record('cpp-greet-and-sum').status,
    verdict: (document.querySelector('.verdict h4') || {}).textContent || null,
    xp: window.SystemsLab.Store.state.xp,
  }));
  check('it was graded as right', after.verdict, 'Right');
  check('and recorded as solved', after.status, 'solved');
  ok('and paid out', after.xp > 0);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hosted-submit.png') });
}

section('a compile error through the hosted path, then a fix');
{
  await page.goto(`${SITE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await pasteInto(page, '#include <iostream>\nint main(){ std::cout << nope; }');
  await page.locator('#runBtn').click();
  await waitForRun(page);

  const diag = await page.evaluate(() => {
    const impl = window.SystemsLab.ProblemTypes.get('code');
    return {
      built: impl.lastBuildOk(),
      compiler: impl.lastCompilerOutput(),
      source: impl.editor().value,
    };
  });
  check('it did not build', diag.built, false);
  ok('the compiler said why', /nope/.test(diag.compiler));
  ok('and the code is untouched', diag.source.includes('nope'));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'state-compile-error.png') });

  await pasteInto(page,
    '#include <iostream>\nint main(){int n;std::cin>>n;long long b=0;'
    + 'for(int i=0;i<n;i++){long long x;std::cin>>x;if(i==0||x>b)b=x;std::cout<<b<<"\\n";}}');
  await page.locator('#runBtn').click();
  await waitForRun(page);

  const fixed = await page.evaluate(() => ({
    built: window.SystemsLab.ProblemTypes.get('code').lastBuildOk(),
    passed: [...document.querySelectorAll('.case')].filter(c => c.dataset.pass === 'true').length,
  }));
  check('the corrected version builds', fixed.built, true);
  ok('and passes', fixed.passed > 0);
}

section('nothing was submitted to localhost');
{
  const hits = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(e => e.name)
    .filter(n => /127\.0\.0\.1:(2999|2000)\b/.test(n)));
  const toProxy = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(e => e.name.includes(':8787')).length);
  ok(`the proxy was used (${toProxy} requests)`, toProxy > 0);
  console.log(`  --    requests to a local runner port: ${hits.length} (health checks)`);
  const runs = hits.filter(h => h.includes('/run'));
  check('no submission was sent to localhost', runs, []);
}

section('an unavailable hosted runner is reported honestly');
{
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.addInitScript(() => {
    localStorage.setItem('systems-lab/hosted-url', 'http://127.0.0.1:2999');
    localStorage.setItem('systems-lab/judge-url', 'http://127.0.0.1:2999');
  });
  await p2.goto(`${SITE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2000);

  const reply = await p2.evaluate(async () =>
    window.SystemsLab.Runners.run('cpp', 'int main(){}', [{ stdin: '' }], {}));
  check('it is flagged as an execution failure', reply.judgeDown, true);
  check('with no cases', reply.cases.length, 0);
  ok('and a reason a person can act on', (reply.judgeError || '').length > 20);
  console.log(`  --    "${reply.judgeError}"`);
  check('it is not reported as a build that failed on the reader', reply.compile.ok, false);

  /* And what that looks like, through the buttons rather than the API. */
  await p2.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await pasteInto(p2, '#include <iostream>\nint main(){ std::cout << 1; }');
  await p2.locator('#runBtn').click();
  await waitForRun(p2);
  const why = await p2.evaluate(() => {
    const n = document.querySelector('.judge-state');
    return n && getComputedStyle(n).display !== 'none' ? n.textContent : '';
  });
  ok(`the editor panel explains which runner and what to do ("${why.trim()}")`,
    /hosted/i.test(why) && why.length > 20);

  ok('the page says it could not run, not that the answer was wrong',
    /could not run|not answering/i.test(
      await p2.evaluate(() => document.getElementById('resultPane').textContent)));

  /* And on Submit, which is a different path: the grader comes back with
     noAttempt, and the page has to render that as "never ran" rather than as
     a verdict. This caught a ReferenceError that only fired when every
     backend was unreachable at once. */
  await p2.locator('#submitBtn').click();
  await p2.waitForTimeout(3000);
  const blocked = await p2.evaluate(() => {
    const v = document.querySelector('.verdict');
    return {
      kind: v && v.dataset.kind,
      head: v ? v.querySelector('h4').textContent : '',
      body: v ? v.textContent : '',
      status: window.SystemsLab.Store.record('algo-running-max').status,
      source: window.SystemsLab.ProblemTypes.get('code').editor().value,
    };
  });
  check('a submission that never ran is not shown as a verdict', blocked.kind, 'blocked');
  ok('it says so in as many words', /could not run/i.test(blocked.head));
  ok('and that nothing was recorded', /not a wrong answer/i.test(blocked.body));
  check('because nothing was', blocked.status, 'unsolved');
  ok('the code is still there', blocked.source.length > 10);
  if (process.env.SHOTS) await p2.screenshot({ path: path.join(SHOTS, 'state-unavailable.png') });
  await p2.close();
}

section('a runaway program is a timeout, not a wrong answer');
{
  await page.goto(`${SITE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await pasteInto(page, '#include <iostream>\nint main(){ for(;;){} }');
  await page.locator('#runBtn').click();
  await waitForRun(page);

  const timed = await page.evaluate(() => {
    const cases = [...document.querySelectorAll('.case')];
    return {
      built: window.SystemsLab.ProblemTypes.get('code').lastBuildOk(),
      timedOut: cases.some(c => /time/i.test(c.textContent)),
      pane: (document.getElementById('resultPane') || {}).textContent || '',
      status: window.SystemsLab.Store.record('algo-running-max').status,
    };
  });
  check('it compiled fine', timed.built, true);
  ok('and the run is reported as having run out of time', timed.timedOut
    || /time|timeout/i.test(timed.pane));
  check('nothing was recorded as solved', timed.status === 'solved', false);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'state-timeout.png') });
}

section('a rate-limited proxy says so, and the code survives');
{
  /* A stub that answers 429 the way the proxy does when a bucket is empty.
     Exhausting the real bucket would mean thirty real compiles on somebody
     else's service to photograph one error message, which is not a
     reasonable thing to do to a free endpoint. What is being checked is the
     page's handling of the status, and that is identical either way. */
  const { createServer } = await import('node:http');
  const stub = createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.url.startsWith('/health')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, languages: ['cpp', 'rust', 'python', 'js'] }));
      return;
    }
    res.writeHead(429, { ...cors, 'Content-Type': 'application/json', 'Retry-After': '30' });
    res.end(JSON.stringify({ error: 'rate limited', retryAfter: 30 }));
  });
  await new Promise(r => stub.listen(8791, '127.0.0.1', r));

  const p3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p3.addInitScript(() => {
    localStorage.setItem('systems-lab/hosted-url', 'http://127.0.0.1:8791');
    localStorage.setItem('systems-lab/judge-url', 'http://127.0.0.1:2999');
  });
  await p3.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await p3.goto(`${SITE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(1500);

  await pasteInto(p3, '// a program worth keeping\nint main(){}');
  await p3.locator('#runBtn').click();
  await waitForRun(p3);

  const limited = await p3.evaluate(() => {
    const impl = window.SystemsLab.ProblemTypes.get('code');
    return {
      source: impl.editor().value,
      pane: (document.getElementById('resultPane') || {}).textContent || '',
      chip: (document.getElementById('execState') || {}).textContent || '',
      status: window.SystemsLab.Store.record('algo-running-max').status,
    };
  });
  ok('the reader is told they are being rate limited',
    /too many|rate|slow down|wait/i.test(limited.pane));
  ok('the code is still there', limited.source.includes('worth keeping'));
  check('and nothing was marked wrong', limited.status === 'attempted', false);
  check('the toolbar names the backend that failed, not a local one',
    limited.chip.trim(), 'Could not run — Hosted');
  if (process.env.SHOTS) await p3.screenshot({ path: path.join(SHOTS, 'state-rate-limited.png') });
  await p3.close();
  await new Promise(r => stub.close(r));
}

section('submit a wrong program, fix it, submit again');
{
  await page.goto(`${SITE}/#/p/algo-running-max`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  /* Compiles, runs, and is simply wrong: it echoes each number instead of
     the running maximum. */
  await pasteInto(page,
    '#include <iostream>\nint main(){int n;std::cin>>n;'
    + 'for(int i=0;i<n;i++){long long x;std::cin>>x;std::cout<<x<<"\\n";}}');
  await page.locator('#submitBtn').click();
  await waitForRun(page, '#submitBtn');

  const wrong = await page.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    status: window.SystemsLab.Store.record('algo-running-max').status,
    submitEnabled: !document.getElementById('submitBtn').disabled,
    editable: !document.querySelector('.cm-content').matches('[contenteditable="false"]'),
    solutionShown: /solution/i.test(document.querySelector('.ws-left').textContent)
      && !!document.querySelector('.ws-left .solution-body'),
    source: window.SystemsLab.ProblemTypes.get('code').editor().value,
  }));
  ok(`it was not accepted ("${wrong.verdict}")`, wrong.verdict !== 'Right');
  check('but not recorded as solved', wrong.status === 'solved', false);
  ok('Submit is still live', wrong.submitEnabled);
  ok('the editor is still editable', wrong.editable);
  check('and the solution was not shown', wrong.solutionShown, false);
  ok('the code is exactly as it was left', wrong.source.includes('std::cout<<x'));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'state-wrong-submission.png') });

  /* Now the right one, from the same page, with no reload. */
  await pasteInto(page,
    '#include <iostream>\nint main(){int n;std::cin>>n;long long b=0;'
    + 'for(int i=0;i<n;i++){long long x;std::cin>>x;if(i==0||x>b)b=x;std::cout<<b<<"\\n";}}');
  await page.locator('#submitBtn').click();
  await waitForRun(page, '#submitBtn');

  const right = await page.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    status: window.SystemsLab.Store.record('algo-running-max').status,
  }));
  check('the corrected one is marked right', right.verdict, 'Right');
  check('and recorded as solved', right.status, 'solved');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'state-retry-correct.png') });
}

/* Probing a runner that is deliberately not there logs a connection
   failure, and that is the correct behaviour being observed rather than a
   defect: the page tried, could not reach it, and said so. Anything else on
   the console is a real error. */
const unexpected = errors.filter(e =>
  !/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|Failed to load resource/.test(e));
check('no unexpected console errors throughout', unexpected, []);
console.log(`  --    ${errors.length - unexpected.length} expected connection `
  + 'failure(s) from probing the runner that is deliberately absent');
await browser.close();
report('browser/hosted');
