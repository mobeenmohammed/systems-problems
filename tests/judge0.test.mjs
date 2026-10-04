/* The Judge0 adapter.

   Two halves. The first is offline and always runs: the flags this adapter
   sends must be identical to the ones the local runner uses, or the same
   problem means two different things depending on which backend answered.

   The second half talks to the real https://ce.judge0.com. It needs no account
   and no API key, which is the main reason this backend is worth having — but
   it is a network call to a third party and it is rate limited, so it only
   runs when asked:

       JUDGE0=1 node tests/judge0.test.mjs

   Run: node tests/judge0.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';
import { PROFILES } from '../judge/languages.mjs';

/* Judge0 is a browser-side module and reads Store.config, so give it one. */
const { grab } = loadScripts(['js/runners/harness.js', 'js/runners/judge0.js'], {
  /* The harness stubs fetch to a 404 so no suite accidentally reaches the
     network. This one is about the network, so it gets the real thing. */
  fetch,
  Store: {
    config: {
      judge0: {
        enabled: true,
        url: 'https://ce.judge0.com',
        languageIds: { cpp: 105, rust: 108, python: 109 },
      },
    },
  },
});
const Judge0 = grab('Judge0');
const H = grab('RunHarness');

/* ---------------- the flags must match the local runner ---------------- */

section('the two backends send the same flags');

/* The local runner keeps flags as an array; the adapter as a string, because
   that is what Judge0's compiler_options field takes. Comparing them is the
   point: a problem built with -std=c++23 here and -std=c++17 there would be a
   different problem. */
for (const lang of ['cpp', 'rust']) {
  for (const profile of ['standard', 'sanitize', 'strict', 'parallel']) {
    const local = (PROFILES[lang] || {})[profile];
    const remote = (Judge0.PROFILE_FLAGS[lang] || {})[profile];
    if (!local) continue;
    if (!remote) { ok(`${lang}/${profile}: the adapter has it too`, false); continue; }
    check(`${lang}/${profile} flags agree`, remote.split(/\s+/).filter(Boolean), local.filter(Boolean));
  }
}

section('language ids are configurable, with measured defaults');
check('cpp default',    Judge0.DEFAULT_LANG_IDS.cpp, 105);
check('rust default',   Judge0.DEFAULT_LANG_IDS.rust, 108);
check('python default', Judge0.DEFAULT_LANG_IDS.python, 109);

section('it is off unless switched on');
const offScripts = loadScripts(['js/runners/judge0.js'], { Store: { config: {} } });
const Off = offScripts.grab('Judge0');
check('disabled by default',       Off.enabled(), false);
check('and supports nothing then', Off.supports('cpp'), false);

section('a configured language is supported, an unconfigured one is not');
check('cpp is supported',   Judge0.supports('cpp'), true);
check('js is not',          Judge0.supports('js'), false);
check('cobol is not',       Judge0.supports('cobol'), false);

/* ---------------- the live service ---------------- */

if (!process.env.JUDGE0) {
  section('the live service');
  console.log('  --    skipped. Set JUDGE0=1 to probe https://ce.judge0.com.');
  console.log('  --    It needs no account and no key, but it is a third party and rate limited.');
  report('judge0');
  process.exit(0);
}

section('ce.judge0.com answers');
const state = await Judge0.check({ force: true });
if (!state.up) {
  console.log(`  --    unreachable: ${state.error}`);
  ok('unreachable is reported rather than thrown', typeof state.error === 'string');
  report('judge0');
  process.exit(0);
}
check('up', state.up, true);
ok('and reports the languages we asked about', state.languages.length >= 2);
for (const l of state.languages) console.log(`  --    ${l.id.padEnd(7)} id ${l.judge0Id}  ${l.version}`);

const wait = ms => new Promise(r => setTimeout(r, ms));

section('a passing C++ submission, through the adapter');
let reply = await Judge0.run('cpp',
  '#include <iostream>\nint main(){ int n; std::cin >> n; std::cout << n * 2 << "\\n"; }',
  [{ stdin: '21\n' }]);
check('backend is named',  reply.backend, 'judge0');
check('it built',          reply.compile.ok, true);
check('right answer',      reply.cases[0].stdout.trim(), '42');
check('exit 0',            reply.cases[0].exit, 0);
/* The whole adapter exists so the verdict layer does not care who ran it. */
let verdict = H.judgeRun(reply, ['42']);
check('the verdict is correct', verdict.correct, true);
await wait(4000);

section('a C++23 feature really is available');
reply = await Judge0.run('cpp',
  '#include <iostream>\nint main(){ std::cout << __cplusplus << "\\n"; }', [{ stdin: '' }]);
check('it built', reply.compile.ok, true);
ok('__cplusplus reports C++23', reply.cases[0].stdout.trim() === '202302');
await wait(4000);

section('warnings come back on a build that succeeded');
reply = await Judge0.run('cpp',
  '#include <iostream>\nint main(){ int unused = 3; std::cout << "built\\n"; }', [{ stdin: '' }]);
check('it built',            reply.compile.ok, true);
ok('and the warning survived', /unused/.test(reply.compile.stderr));
verdict = H.judgeRun(reply, ['built']);
check('still correct',       verdict.correct, true);
ok('and the warning is surfaced', verdict.feedback.includes('warning'));
await wait(4000);

section('a compile error is a build failure, not a failed case');
reply = await Judge0.run('cpp', '#include <iostream>\nint main(){ std::cout << nope; }', [{ stdin: '' }]);
check('it did not build', reply.compile.ok, false);
check('and no cases ran',  reply.cases.length, 0);
ok('the compiler said why', /nope/.test(reply.compile.stderr));
verdict = H.judgeRun(reply, ['']);
check('reported as a build failure', verdict.built, false);
await wait(4000);

section('a runtime error');
reply = await Judge0.run('cpp', '#include <iostream>\nint main(){ int* p=nullptr; std::cout << *p; }', [{ stdin: '' }]);
check('it built',             reply.compile.ok, true);
ok('and did not exit 0',       reply.cases[0].exit !== 0);
check('and did not time out',  reply.cases[0].timedOut, false);
ok('Judge0 named the status',  typeof reply.cases[0].judge0Status === 'string');
await wait(4000);

section('a timeout');
reply = await Judge0.run('cpp', 'int main(){ for(;;){} }', [{ stdin: '' }], { runMs: 1000 });
check('it built',      reply.compile.ok, true);
check('and timed out', reply.cases[0].timedOut, true);
verdict = H.judgeRun(reply, ['']);
ok('reported as a timeout', verdict.feedback.toLowerCase().includes('timed out'));
await wait(4000);

section('the sanitizer, which the docs do not promise');
reply = await Judge0.run('cpp', [
  '#include <iostream>',
  'int main(){',
  '  int a[4] = {1,2,3,4};',
  '  int s = 0;',
  '  for (int i = 0; i <= 4; i++) s += a[i];',
  '  std::cout << 10 << "\\n";',
  '}',
].join('\n'), [{ stdin: '' }], { profile: 'sanitize' });
check('it built under the sanitizer', reply.compile.ok, true);
ok('and the sanitizer fired',         reply.cases[0].sanitizer === true);
const clean = H.judgeRun(reply, ['10'], { requireClean: true });
check('requireClean fails it', clean.correct, false);
await wait(4000);

section('several cases in one call');
reply = await Judge0.run('cpp',
  '#include <iostream>\nint main(){ int n; std::cin >> n; std::cout << n * 2 << "\\n"; }',
  [{ stdin: '1\n' }, { stdin: '2\n' }, { stdin: '3\n' }]);
check('three cases came back', reply.cases.length, 3);
check('in order',              reply.cases.map(c => c.stdout.trim()), ['2', '4', '6']);
verdict = H.judgeRun(reply, ['2', '4', '6']);
check('all correct', verdict.correct, true);
await wait(4000);

section('Rust, edition 2021');
reply = await Judge0.run('rust',
  'use std::io::Read;\nfn main(){ let mut s=String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); let n: i64 = s.trim().parse().unwrap(); println!("{}", n*3); }',
  [{ stdin: '14\n' }]);
check('it built',     reply.compile.ok, true);
check('right answer', reply.cases[0].stdout.trim(), '42');
await wait(4000);

section('Python');
reply = await Judge0.run('python',
  'import sys\nprint(int(sys.stdin.read().strip()) * 3)', [{ stdin: '14\n' }]);
check('it ran',       reply.compile.ok, true);
check('right answer', reply.cases[0].stdout.trim(), '42');

report('judge0');
