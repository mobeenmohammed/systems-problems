/* The judge's own logic, against whatever real toolchains this machine has.

   Languages that are not installed are skipped with a notice rather than
   failing: on a Windows host only node is usually present, while CI's
   ubuntu-latest has g++, rustc and python3 already, so the compiled-language
   paths are exercised on every push whether or not Docker was up locally.

   What matters here is that the judge distinguishes the four different ways a
   submission can fail, because the UI says something different for each:
   a compile error, a wrong answer, a timeout, and a crash.

   Run: node tests/judge.test.mjs */

import { run, languages, detectPrlimit } from '../judge/server.mjs';
import { section, check, ok, report } from './harness.mjs';

await detectPrlimit();
const langs = await languages();
const have = Object.fromEntries(langs.map(l => [l.id, l.available]));

section('toolchains on this machine');
for (const l of langs) {
  console.log(`  --    ${l.id.padEnd(7)} ${l.available ? l.version : 'not installed — skipping its cases'}`);
}
ok('at least one language is available', langs.some(l => l.available));

const one = (stdin = '') => [{ stdin }];

/* Having a working g++ does not mean having the sanitizer runtimes: MinGW on
   Windows has no libasan at all, so -fsanitize=address fails at link time.
   The judge's real home is the Linux container, where it works — so this is a
   capability to probe, not something to infer from the compiler existing. */
const sanitizerWorks = have.cpp && (await run({
  lang: 'cpp',
  profile: 'sanitize',
  source: 'int main(){ return 0; }',
  cases: one(),
})).compile.ok;

console.log(`  --    sanitizer ${sanitizerWorks
  ? 'available'
  : 'unavailable on this host (no libasan) — those cases run in the container and in CI'}`);


/* ---------------- the happy path ---------------- */

section('a working submission');
if (have.js) {
  const res = await run({
    lang: 'js',
    source: 'const n = require("fs").readFileSync(0, "utf8").trim();\nconsole.log(Number(n) * 2);',
    cases: [{ stdin: '21\n' }, { stdin: '5\n' }],
  });
  check('compiles',            res.compile.ok, true);
  check('both cases ran',      res.cases.length, 2);
  check('first case output',   res.cases[0].stdout.trim(), '42');
  check('second case output',  res.cases[1].stdout.trim(), '10');
  check('exit 0',              res.cases[0].exit, 0);
  check('did not time out',    res.cases[0].timedOut, false);
  ok('timing is reported',     res.cases[0].ms >= 0);
}

if (have.cpp) {
  const res = await run({
    lang: 'cpp',
    source: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}',
    cases: [{ stdin: '21\n' }],
  });
  check('cpp compiles',        res.compile.ok, true);
  check('cpp runs',            res.cases[0].stdout.trim(), '42');
  check('cpp exits cleanly',   res.cases[0].exit, 0);
}

if (have.rust) {
  const res = await run({
    lang: 'rust',
    source: 'use std::io::Read;\nfn main(){let mut s=String::new();std::io::stdin().read_to_string(&mut s).unwrap();let n:i64=s.trim().parse().unwrap();println!("{}",n*2);}',
    cases: [{ stdin: '21\n' }],
  });
  check('rust compiles',       res.compile.ok, true);
  check('rust runs',           res.cases[0].stdout.trim(), '42');
}

if (have.python) {
  const res = await run({
    lang: 'python',
    source: 'import sys\nprint(int(sys.stdin.read().strip()) * 2)',
    cases: [{ stdin: '21\n' }],
  });
  check('python compiles',     res.compile.ok, true);
  check('python runs',         res.cases[0].stdout.trim(), '42');
}

/* ---------------- a compile error is not a failed case ---------------- */

section('a compile error');
if (have.js) {
  const res = await run({ lang: 'js', source: 'function ( {{{ bad', cases: one() });
  check('compile is not ok',   res.compile.ok, false);
  ok('the error text is returned', res.compile.stderr.length > 0);
  /* The distinction the UI depends on: no cases ran, so it must say
     "it did not build" rather than "all your tests failed". */
  check('no cases were run',   res.cases.length, 0);
}

if (have.cpp) {
  const res = await run({
    lang: 'cpp',
    source: '#include <iostream>\nint main(){ std::cout << undeclared_thing; }',
    cases: one(),
  });
  check('cpp compile fails',   res.compile.ok, false);
  check('no cases ran',        res.cases.length, 0);
  ok('g++ said what was wrong', /undeclared_thing/.test(res.compile.stderr));
}

/* ---------------- warnings on a SUCCESSFUL build ---------------- */

section('warnings are returned even when the build succeeds');
if (have.cpp) {
  const res = await run({
    lang: 'cpp',
    source: '#include <iostream>\nint main(){ int unused_variable; std::cout << "hi\\n"; }',
    cases: one(),
  });
  check('it still builds',     res.compile.ok, true);
  check('and still runs',      res.cases[0].stdout.trim(), 'hi');
  /* -Wall -Wextra is on every profile precisely so this is true: a warning
     you never see is a warning that taught you nothing. */
  ok('the warning came back',  /unused|warning/i.test(res.compile.stderr));
}

if (have.rust) {
  /* Rust's standard profile is -D warnings, so an unused variable is an
     error rather than a warning — which is the Rust lesson, not a bug. */
  const res = await run({
    lang: 'rust',
    source: 'fn main(){ let unused_variable = 5; println!("hi"); }',
    cases: one(),
  });
  check('-D warnings makes it a build failure', res.compile.ok, false);
  ok('and says which variable', /unused_variable/.test(res.compile.stderr));
}

/* ---------------- a timeout ---------------- */

section('a non-terminating submission is killed');
if (have.js) {
  const res = await run({
    lang: 'js',
    source: 'while (true) {}',
    cases: one(),
    limits: { runMs: 700 },
  });
  check('it built fine',       res.compile.ok, true);
  check('the case timed out',  res.cases[0].timedOut, true);
  ok('and was killed within a reasonable margin', res.cases[0].ms < 5000);
  ok('the page can tell this apart from a wrong answer', res.cases[0].timedOut === true);
}

if (have.cpp) {
  const res = await run({
    lang: 'cpp',
    source: 'int main(){ for(;;){} }',
    cases: one(),
    limits: { runMs: 700 },
  });
  check('a C++ infinite loop times out', res.cases[0].timedOut, true);
}

/* ---------------- a crash ---------------- */

section('a crash is reported as a crash');
if (have.js) {
  const res = await run({
    lang: 'js',
    source: 'throw new Error("boom");',
    cases: one(),
  });
  check('it built',            res.compile.ok, true);
  ok('exit is non-zero',       res.cases[0].exit !== 0);
  ok('the message is in stderr', /boom/.test(res.cases[0].stderr));
  check('it did not time out', res.cases[0].timedOut, false);
}

/* ---------------- the sanitizer ---------------- */

section('the sanitizer catches what the output does not');
if (sanitizerWorks) {
  /* The whole reason for a custom judge. This program prints the right answer
     and is still wrong, and no fixed-flag judge can express that. */
  const res = await run({
    lang: 'cpp',
    profile: 'sanitize',
    source: [
      '#include <iostream>',
      'int main(){',
      '  int a[4] = {1,2,3,4};',
      '  int sum = 0;',
      '  for (int i = 0; i <= 4; i++) sum += a[i];   // one past the end',
      '  std::cout << 10 << "\\n";',
      '  return 0;',
      '}',
    ].join('\n'),
    cases: one(),
  });

  check('it compiles under the sanitizer', res.compile.ok, true);
  ok('the sanitizer fired',                res.cases[0].sanitizer === true);
  ok('and said what it was',               /stack-buffer-overflow|AddressSanitizer/.test(res.cases[0].stderr));
  ok('the process did not exit cleanly',   res.cases[0].exit !== 0);

  /* And the control: a clean program under the same profile must not be
     reported as unclean, or requireClean would fail everything. */
  const clean = await run({
    lang: 'cpp',
    profile: 'sanitize',
    source: '#include <iostream>\nint main(){ int a[4]={1,2,3,4}; int s=0; for(int i=0;i<4;i++) s+=a[i]; std::cout<<s<<"\\n"; }',
    cases: one(),
  });
  check('a clean program is clean',   clean.cases[0].sanitizer, false);
  check('and exits 0',               clean.cases[0].exit, 0);
  check('with the right answer',     clean.cases[0].stdout.trim(), '10');
}

if (sanitizerWorks) {
  section('a use-after-free is caught too');
  const res = await run({
    lang: 'cpp',
    profile: 'sanitize',
    source: [
      '#include <iostream>',
      'int main(){',
      '  int* p = new int(7);',
      '  delete p;',
      '  std::cout << *p << "\\n";   // reading freed memory',
      '}',
    ].join('\n'),
    cases: one(),
  });
  ok('the sanitizer fired', res.cases[0].sanitizer === true);
  ok('and named it',        /heap-use-after-free/.test(res.cases[0].stderr));
}

/* ---------------- bad requests ---------------- */

section('bad requests are refused, not crashed on');
ok('an unknown language',      (await run({ lang: 'cobol', source: 'x', cases: one() })).error);
ok('no source',                (await run({ lang: 'js', source: '', cases: one() })).error);
ok('no cases',                 (await run({ lang: 'js', source: 'x', cases: [] })).error);
ok('too many cases',           (await run({ lang: 'js', source: 'x', cases: Array(99).fill({ stdin: '' }) })).error);
ok('an oversized source',      (await run({ lang: 'js', source: 'x'.repeat(300_000), cases: one() })).error);
ok('a missing cases array',    (await run({ lang: 'js', source: 'x' })).error);

section('output is capped');
if (have.js) {
  const res = await run({
    lang: 'js',
    source: 'const s = "x".repeat(1000); for (let i = 0; i < 1000; i++) console.log(s);',
    cases: one(),
    limits: { runMs: 5000 },
  });
  ok('a flood of output is truncated rather than returned whole',
    res.cases[0].stdout.length < 200_000);
  ok('and says it was truncated', res.cases[0].stdout.includes('truncated'));
}

report('judge');
