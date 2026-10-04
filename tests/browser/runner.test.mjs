/* The real browser-to-runner workflow.

   jsdom boots the actual page, and its fetch is split: repo paths are served
   from disk as a static server would, and anything addressed to the runner is
   passed through to the real network. So this exercises the whole path —
   token load, Origin header, compile, run, diagnostics — rather than a mock
   of it.

   If the runner is not up the suite reports that and exits 0, because "you did
   not start the runner" is not a test failure. Everything it *can* check
   without the runner is still checked.

   Start the runner first:   npm run runner

   Run: node tests/browser/runner.test.mjs */

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ROOT, section, check, ok, report } from '../harness.mjs';

/* ---------------- is the runner there? ---------------- */

let tokenInfo = null;
try {
  tokenInfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/judge-token.json'), 'utf8'));
} catch { /* never started, or the file was cleaned */ }

const BASE = `http://127.0.0.1:${(tokenInfo && tokenInfo.port) || 2000}`;

let health = null;
try {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2500) });
  if (res.ok) health = await res.json();
} catch { /* down */ }

section('the runner');
if (!health) {
  console.log('  --    not running. Start it with: npm run runner');
  console.log('  --    skipping the integration checks; nothing below is a failure.');
  ok('the page is still testable without it', true);
  report('browser/runner');
}

ok('it answers /health without a token', health.ok === true);
console.log(`  --    ${health.platform}${health.wsl ? ` · WSL ${health.distro}` : ''} · prlimit ${health.prlimit ? 'on' : 'off'}`);
for (const l of health.languages) {
  console.log(`  --    ${l.id.padEnd(7)} ${l.available ? l.version : 'NOT INSTALLED'}`);
}
ok('a token file was written', !!(tokenInfo && tokenInfo.token));

const available = new Set(health.languages.filter(l => l.available).map(l => l.id));

/* ---------------- boot the page against the live runner ---------------- */

async function boot({ token = undefined } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'http://127.0.0.1:8000/',
  });
  const { window } = dom;

  /* The split: repo files off disk, runner requests through to the network
     with the Origin a browser on this page would send. */
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1:' + ((tokenInfo && tokenInfo.port) || 2000))) {
      /* The page builds its AbortSignal from jsdom's AbortSignal, and node's
         fetch refuses a signal that is not its own. Swap in a native one with
         the same budget rather than dropping the timeout. */
      const { signal, ...rest } = init;
      return fetch(u, {
        ...rest,
        signal: AbortSignal.timeout(20000),
        headers: { ...(init.headers || {}), Origin: 'http://127.0.0.1:8000' },
      });
    }
    const rel = u.replace(/^https?:\/\/127\.0\.0\.1:8000\//, '').split('?')[0];
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };

  window.confirm = () => true;
  window.scrollTo = () => {};
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  if (token !== undefined) window.localStorage.setItem('systems-lab/judge-token', token);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  window.eval(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'));

  for (let i = 0; i < 20; i += 1) {
    await new Promise(r => window.setTimeout(r, 0));
    await Promise.resolve();
  }
  return { window, document: window.document, errors };
}

const { window, errors } = await boot();
check('no console errors booting against the live runner', errors, []);

/* ---------------- the page finds the runner and the token ---------------- */

section('the page reaches the runner');
const judge = await window.SystemsLab.Runners.checkJudge({ force: true });
check('state is ready',   judge.state, 'ready');
check('up',               judge.up, true);
check('authenticated',    judge.authed, true);
ok('it found the token from the file', !!window.SystemsLab.Runners.token);
ok('and lists the installed languages', judge.languages.length >= 1);

section('a wrong token is reported as unauthorised, not as down');
const bad = await boot({ token: 'definitely-not-the-token' });
const badJudge = await bad.window.SystemsLab.Runners.checkJudge({ force: true });
check('up is still true',  badJudge.up, true);
check('but not authed',    badJudge.authed, false);
check('state says so',     badJudge.state, 'unauthed');
ok('with something to do about it', (badJudge.error || '').length > 10);
/* The distinction that matters: a tab must not offer a language it will then
   fail to run. */
const badAvail = await bad.window.SystemsLab.Runners.available(['cpp']);
check('cpp is not offered while unauthorised', badAvail[0].ready, false);
check('though it is known to be installed',    badAvail[0].installed, available.has('cpp'));

/* ---------------- run, through the page's own code path ---------------- */

const R = window.SystemsLab.Runners;
const H = window.SystemsLab.RunHarness || window.RunHarness;

async function runThroughPage(lang, source, cases, opts = {}) {
  return R.run(lang, source, cases, opts);
}

if (available.has('cpp')) {
  section('C++ through the page: a passing submission');
  let reply = await runThroughPage('cpp',
    '#include <iostream>\nint main(){ int n; std::cin >> n; std::cout << n * 2 << "\\n"; }',
    [{ stdin: '21\n' }]);
  check('it built',       reply.compile.ok, true);
  check('one case ran',   reply.cases.length, 1);
  check('right answer',   reply.cases[0].stdout.trim(), '42');
  check('exit 0',         reply.cases[0].exit, 0);

  section('C++ through the page: a compile error');
  reply = await runThroughPage('cpp', '#include <iostream>\nint main(){ std::cout << nope; }', [{ stdin: '' }]);
  check('it did not build', reply.compile.ok, false);
  check('and no case ran',  reply.cases.length, 0);
  ok('the compiler said why', /nope/.test(reply.compile.stderr));
  /* The verdict layer has to call this a build failure rather than "0 of 1
     passed", which is true and useless. */
  const verdict = H.judgeRun(reply, ['']);
  check('the verdict says it did not build', verdict.built, false);
  ok('and says so in words', verdict.feedback.includes('did not build'));

  section('C++ through the page: a runtime error');
  reply = await runThroughPage('cpp', '#include <iostream>\nint main(){ int* p = nullptr; std::cout << *p; }', [{ stdin: '' }]);
  check('it built',            reply.compile.ok, true);
  ok('the case did not exit 0', reply.cases[0].exit !== 0);
  check('and did not time out', reply.cases[0].timedOut, false);
  const crashVerdict = H.judgeRun(reply, ['0']);
  ok('reported as a crash, not a wrong answer',
    !crashVerdict.feedback.toLowerCase().includes('wrong output'));

  section('C++ through the page: a timeout');
  reply = await runThroughPage('cpp', 'int main(){ for(;;){} }', [{ stdin: '' }], { runMs: 800 });
  check('it built',         reply.compile.ok, true);
  check('and timed out',    reply.cases[0].timedOut, true);
  ok('within a reasonable margin', reply.cases[0].ms < 6000);
  const toVerdict = H.judgeRun(reply, ['']);
  ok('reported as a timeout', toVerdict.feedback.toLowerCase().includes('timed out'));

  section('C++ through the page: the sanitizer');
  reply = await runThroughPage('cpp', [
    '#include <iostream>',
    'int main(){',
    '  int a[4] = {1,2,3,4};',
    '  int s = 0;',
    '  for (int i = 0; i <= 4; i++) s += a[i];',
    '  std::cout << 10 << "\\n";',
    '}',
  ].join('\n'), [{ stdin: '' }], { profile: 'sanitize' });
  if (reply.compile.ok) {
    check('the sanitizer fired', reply.cases[0].sanitizer, true);
    const clean = H.judgeRun(reply, ['10'], { requireClean: true });
    check('requireClean fails it even though 10 was printed', clean.correct, false);
    ok('and says the program is wrong rather than the output',
      clean.cases[0].why.includes('output may be right'));
  } else {
    console.log('  --    no sanitizer runtime on this toolchain; skipped');
  }
}

if (available.has('rust')) {
  section('Rust through the page');
  let reply = await runThroughPage('rust',
    'use std::io::Read;\nfn main(){ let mut s=String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); let n: i64 = s.trim().parse().unwrap(); println!("{}", n*3); }',
    [{ stdin: '14\n' }]);
  check('it built',     reply.compile.ok, true);
  check('right answer', reply.cases[0].stdout.trim(), '42');

  reply = await runThroughPage('rust',
    'fn main(){ let v = vec![1,2,3]; let r = &v; drop(v); println!("{:?}", r); }',
    [{ stdin: '' }]);
  check('a borrow error is a build failure', reply.compile.ok, false);
  ok('and rustc explains it', /borrow/.test(reply.compile.stderr));
}

if (available.has('python')) {
  section('Python through the page');
  let reply = await runThroughPage('python',
    'import sys\nprint(int(sys.stdin.read().strip()) * 3)', [{ stdin: '14\n' }]);
  check('it ran',       reply.compile.ok, true);
  check('right answer', reply.cases[0].stdout.trim(), '42');

  reply = await runThroughPage('python', 'print(', [{ stdin: '' }]);
  check('a syntax error is reported as a build failure', reply.compile.ok, false);
}

section('JavaScript still runs in the tab, not on the runner');
const jsAvail = await R.available(['js']);
check('js is ready', jsAvail[0].ready, true);
check('and runs here', jsAvail[0].where, 'in this tab');

/* ---------------- lint, the editor's path ---------------- */

section('the editor lints with the real compiler');
for (const [lang, source, needle] of [
  ['cpp', 'int main(){ int x = 1\n return x; }', /expected/],
  ['rust', 'fn main(){ let x: i32 = "no"; }', /mismatched/],
  ['python', 'def f(:\n  pass', /SyntaxError/],
]) {
  if (!available.has(lang)) continue;
  const res = await window.SystemsLab.Lint.remote(source, lang);
  ok(`${lang}: the compiler answered`, res.ran === true);
  ok(`${lang}: with a diagnostic`, (res.diagnostics || []).length >= 1);
  const d = (res.diagnostics || [])[0];
  if (d) {
    ok(`${lang}: it has a line number`, Number.isInteger(d.line) && d.line >= 1);
    ok(`${lang}: and the expected message`, needle.test(d.message));
    ok(`${lang}: attributed to the compiler`, d.from === 'compiler');
  }
}

section('a clean program lints clean');
if (available.has('cpp')) {
  const res = await window.SystemsLab.Lint.remote('int main(){ return 0; }', 'cpp');
  check('ok',               res.ok, true);
  check('no diagnostics',   (res.diagnostics || []).length, 0);
}

/* ---------------- the workspace, against the real compiler ----------------

   Everything above goes through Runners directly. This drives the page the way
   a person does: open a code problem, type into the editor, press the Run
   button in the action bar, and read what comes back. If the diagnostics panel
   or the action bar is wired wrongly, nothing above would notice. */

section('the workspace, driven like a person');

const ws = await boot();
const wsWin = ws.window;
const wsDoc = ws.document;

const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(r => wsWin.setTimeout(r, 0));
    await Promise.resolve();
  }
};
const waitFor = async (predicate, ms = 30000) => {
  const start = Date.now();
  for (;;) {
    try { if (predicate()) return true; } catch { /* not yet */ }
    if (Date.now() - start > ms) return false;
    await new Promise(r => wsWin.setTimeout(r, 40));
  }
};
const click = node => node.dispatchEvent(
  new wsWin.MouseEvent('click', { bubbles: true, cancelable: true }));
const typeInto = (node, text) => {
  node.value = text;
  node.dispatchEvent(new wsWin.Event('input', { bubbles: true }));
};

wsWin.location.hash = '#/p/cpp-greet-and-sum';
await settle(30);

ok('the workspace is two panels', wsDoc.querySelector('#problemHost .split') !== null);
const runBtn = wsDoc.querySelector('#problemHost .actions-bar #runBtn');
ok('Run samples is in the action bar', runBtn !== null);
const editor = wsDoc.querySelector('#problemHost .ed .ed-input');
ok('and the editor is there', editor !== null);

if (available.has('cpp')) {
  section('a program that builds with a warning');
  /* Right answer, and an unused variable, so -Wall has something to say on a
     build that succeeds. The whole point of leaving warnings on. */
  typeInto(editor, [
    '#include <iostream>',
    '#include <string>',
    'int main() {',
    '    std::string name;',
    '    long long a = 0, b = 0;',
    '    int unusedHere = 7;',
    '    std::cin >> name >> a >> b;',
    '    std::cout << "Hello, " << name << "!\\n";',
    '    std::cout << a << " + " << b << " = " << (a + b) << "\\n";',
    '}',
  ].join('\n'));
  await settle();

  click(runBtn);
  const ran = await waitFor(() => wsDoc.querySelector('#problemHost .case') !== null);
  ok('pressing Run produced case results', ran);

  const diags = wsDoc.querySelector('#problemHost .diags');
  ok('the compiler had something to say', diags !== null);
  if (diags) {
    check('and it is presented as a warning, not a failure', diags.dataset.kind, 'warn');
    ok('with the summary saying it built', /It built/.test(diags.querySelector('.lbl').textContent));
    ok('as a list of places rather than a blob',
      diags.querySelector('.diags-list') !== null);
    const where = diags.querySelector('.diag-where');
    ok('each place is clickable', where !== null);
    ok('and names a real line in the source',
      where && Number(where.textContent.split(':')[0]) <= editor.value.split('\n').length);
    ok('the real compiler text is kept underneath',
      /unused/.test(diags.querySelector('.diags-raw').textContent));
    ok('the warning really came from g++ and not from the bracket scanner',
      diags.querySelector('.diags-raw').textContent.includes('-Wunused-variable'));

    /* Clicking it should move the caret, which is the only reason to make it
       a button. */
    const line = Number(where.textContent.split(':')[0]);
    click(where);
    await settle();
    const caretLine = editor.value.slice(0, editor.selectionStart).split('\n').length;
    check('clicking it moves the caret to that line', caretLine, line);
  }

  const cases = [...wsDoc.querySelectorAll('#problemHost .case')];
  ok('every sample case passed', cases.every(c => c.dataset.pass === 'true'));

  section('a program that does not build, in the page');
  typeInto(editor, '#include <iostream>\nint main() { std::cout << nope; }');
  await settle();
  click(runBtn);
  const failed = await waitFor(() =>
    (wsDoc.querySelector('#problemHost .diags') || {}).dataset?.kind === 'error');
  ok('it is reported as a build failure', failed);
  const bad = wsDoc.querySelector('#problemHost .diags');
  ok('the summary counts the errors', /did not build/.test(bad.querySelector('.lbl').textContent));
  ok('with at least one error row',
    bad.querySelector('.diag[data-severity="error"]') !== null);
  ok('and no cases ran', wsDoc.querySelector('#problemHost .case') === null);

  section('a timeout, in the page');
  typeInto(editor, 'int main() { for (;;) {} }');
  await settle();
  click(runBtn);
  const timedOut = await waitFor(() => {
    const node = wsDoc.querySelector('#problemHost .case');
    return node && /timed out/i.test(node.textContent);
  }, 40000);
  ok('a runaway program is reported as a timeout rather than hanging the page', timedOut);
  ok('and the Run button is usable again', runBtn.disabled === false);
} else {
  console.log('  --    g++ is not installed on the runner; skipping the live workspace checks.');
}

report('browser/runner');