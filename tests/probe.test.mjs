/* RunProbe — composing a submission with the harness a problem owns, and
   folding the result into the verdict the input cases produced.

   Pure, so none of this needs a browser or a compiler. What it does need
   is care, because the composition rewrites somebody's program: the
   `#define main` is the whole trick and the thing most able to go quietly
   wrong. The headers have to come out above it or the macro is live over
   library code.

   Run: node tests/probe.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts(['js/runners/harness.js', 'js/runners/probe.js']);
const P = grab('RunProbe');
const H = grab('RunHarness');

/* ---------------- which headers get hoisted ---------------- */

section('headers');

const SUB = `#include <iostream>
#include <iomanip>

int main()
{
    std::cout << "hello\\n";
    return 0;
}
`;

check('what the submission included is hoisted',
  P.headers(SUB).includes('<iomanip>'), true);
check('and so is what the probe always needs',
  P.BASE.every(h => P.headers(SUB).includes(h)), true);
check('a header is not hoisted twice',
  P.headers(SUB).filter(h => h === '<iostream>').length, 1);
check('a quoted include is left alone — there is no such file in a '
  + 'single-file exercise',
  P.headers('#include "mine.h"\n').includes('"mine.h"'), false);
check('something that only looks like an include is left alone',
  P.headers('// #include <map> once upon a time\n').includes('<map>'), false);
check('indentation does not hide one',
  P.headers('  #  include   <map>  \n').includes('<map>'), true);
check('nothing is hoisted from an empty submission beyond the base',
  P.headers('').length, P.BASE.length);

/* ---------------- the composition ---------------- */

section('composition');

const composed = P.compose('int main() { return 0; }\n', SUB);

/* The ordering claim, which is the one property that makes the macro safe.
   The submission's own `#include` lines are still there, below the
   rename — they have to be, the submission is verbatim — but every header
   they name has already been included above it, so the include guard
   makes them no-ops and the macro never reaches library text. */
const lines = composed.split('\n');
const defineAt = lines.findIndex(l => l.startsWith('#define main'));
const prelude = new Set(lines.slice(0, defineAt)
  .map(l => (/^#include (<[^>]+>)$/.exec(l) || [])[1]).filter(Boolean));
ok('there is a rename, and headers above it', defineAt > 0 && prelude.size > 0);
ok('every header the submission names was already included above the rename',
  P.headers(SUB).every(h => prelude.has(h)));
ok('nothing below the rename names a header that is not already in',
  lines.slice(defineAt).every((l) => {
    const m = /^\s*#\s*include\s*(<[^>]+>)/.exec(l);
    return !m || prelude.has(m[1]);
  }));
check('the submission is renamed, not edited',
  composed.includes(SUB.trimEnd()), true);
check('the rename is undone before the probe',
  composed.indexOf('#undef main') < composed.indexOf('int main() { return 0; }'), true);
check('the submission keeps its own line numbers',
  composed.includes('#line 1 "your-program.cpp"'), true);
check('and the harness is named something else',
  composed.includes('#line 1 "interface-check.cpp"'), true);
check('the renamed main is not a reserved identifier',
  /^_|^.{0,2}__/.test(P.RENAMED), false);
check('CRLF in a draft does not survive into the compiler',
  P.compose('int main(){}', 'int main(){}\r\n').includes('\r'), false);

/* ---------------- when a probe applies ---------------- */

section('what a probe applies to');

const key = { probe: { source: 'int main(){}', cases: [{ expect: 'x' }] } };
check('a single-file C++ submission', P.has(key, { lang: 'cpp', source: 'x' }), true);
check('not a workspace — there is no one main to rename',
  P.has(key, { lang: 'cpp', source: 'x', files: [{ path: 'a.cpp', content: '' }] }), false);
check('not another language unless the probe says so',
  P.has(key, { lang: 'python', source: 'x' }), false);
check('a probe may say so',
  P.has({ probe: { ...key.probe, langs: ['cpp', 'c'] } }, { lang: 'c', source: 'x' }), true);
check('no probe', P.has({}, { lang: 'cpp', source: 'x' }), false);
check('a probe with no cases is not a probe',
  P.has({ probe: { source: 'int main(){}', cases: [] } }, { lang: 'cpp', source: 'x' }), false);

/* ---------------- folding a reply into a verdict ---------------- */

section('folding');

const passing = () => ({
  correct: true, score: 1, built: true, passed: 2,
  cases: [{ pass: true, why: 'Correct.' }, { pass: true, why: 'Correct.' }],
  feedback: 'All 2 cases passed.',
});

const probe = {
  label: 'Direct call',
  source: 'int main(){}',
  cases: [{ calls: 'power(7)', stdin: '', expect: '49\n' }],
};

{
  const v = P.fold(passing(), {
    compile: { ok: true, stderr: '' },
    cases: [{ stdout: '49\n', exit: 0 }],
  }, probe, { judge: H });
  check('a passing probe leaves the verdict correct', v.correct, true);
  check('and its case is added to the list', v.cases.length, 3);
  check('with a name of its own', v.cases[2].label, 'Direct call 1');
  check('and what it called', v.cases[2].calls, 'power(7)');
  check('the score counts it', v.score, 1);
  ok('and the feedback says the direct calls ran',
    /call your functions directly/.test(v.feedback));
}

{
  const v = P.fold(passing(), {
    compile: { ok: true, stderr: '' },
    cases: [{ stdout: '4\n', exit: 0 }],
  }, probe, { judge: H });
  check('a wrong answer to a direct call fails the submission', v.correct, false);
  check('and the score is two of three', v.score, 2 / 3);
  ok('the feedback does not pretend the input cases failed',
    /Every input case passed/.test(v.feedback));
}

{
  const v = P.fold(passing(), {
    compile: { ok: false, stderr: 'interface-check.cpp:4:30: error: too few arguments to function call\n' },
    cases: [],
  }, probe, { judge: H });
  check('a program the harness cannot call fails', v.correct, false);
  check('with one case rather than none', v.cases.length, 3);
  ok('and the reason is the compiler’s own words',
    /too few arguments/.test(v.cases[2].why));
  ok('the full diagnostic is kept for the row to show',
    v.cases[2].stderr.includes('interface-check.cpp'));
  check('the verdict records that the check ran and did not build',
    `${v.probe.ran} ${v.probe.built}`, 'true false');
}

check('a diagnostic with no error line still says something',
  P.firstError('warning: unused parameter\n'), '');
check('and the file and line are not read out at a reader',
  P.firstError('/tmp/x/interface-check.cpp:9:3: error: no member named foo\n'),
  'no member named foo');

report('probe');
