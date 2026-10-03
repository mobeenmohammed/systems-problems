/* RunHarness — comparing program output and turning a judge reply into a
   verdict. Pure, so it is tested without a browser, a Worker or the judge.

   The distinctions here are the ones that make a judge worth learning from:
   a timeout, a crash, a build failure and a wrong answer are four different
   things and must never be reported as the same thing.

   Run: node tests/runner.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts(['js/runners/harness.js']);
const H = grab('RunHarness');

/* ---------------- output comparison ---------------- */

section('normalisation');
check('a missing final newline is forgiven', H.same('42', '42\n'), true);
check('an extra final newline is forgiven',  H.same('42\n\n', '42'), true);
check('trailing spaces are forgiven',        H.same('42   \n', '42'), true);
check('trailing tabs are forgiven',          H.same('1\t\n2', '1\n2'), true);
check('CRLF is forgiven',                    H.same('1\r\n2\r\n', '1\n2'), true);
/* Internal blank lines are NOT forgiven: a program printing a spare line
   between records got the format wrong, and pretending otherwise would let a
   wrong answer through. */
check('an internal blank line is significant', H.same('1\n\n2', '1\n2'), false);
check('leading whitespace is significant',     H.same('  42', '42'), false);
check('order matters',                         H.same('2\n1', '1\n2'), false);
check('empty against empty',                   H.same('', ''), true);
check('empty against something',               H.same('', '42'), false);

section('locating the first difference');
check('a differing line is found',    H.firstDifference('1\n9\n3', '1\n2\n3').line, 2);
check('and the column within it',     H.firstDifference('abc\nxyz', 'abc\nxqz').column, 2);
check('output ending early is named', H.firstDifference('1', '1\n2').reason, 'output ended early');
check('extra output is named',        H.firstDifference('1\n2', '1').reason, 'extra output after the expected end');
check('identical output has no difference', H.firstDifference('1\n2', '1\n2'), null);

/* ---------------- a single case ---------------- */

section('one case');
const c = (r, expect, opts) => H.judgeCase(r, expect, opts);
const good = { stdout: '42\n', stderr: '', exit: 0, ms: 3 };

check('right output passes',          c(good, '42').pass, true);
check('wrong output fails',           c({ ...good, stdout: '41\n' }, '42').pass, false);
ok('and says which line differs',     c({ ...good, stdout: '41\n' }, '42').why.includes('line 1'));

section('a timeout is not a wrong answer');
const slow = c({ stdout: '', stderr: '', exit: -1, timedOut: true, ms: 2000 }, '42');
check('it fails',       slow.pass, false);
ok('and says it timed out', slow.why.toLowerCase().includes('timed out'));
ok('not that the output was wrong', !slow.why.toLowerCase().includes('wrong output'));

section('a crash is not a wrong answer');
const crashed = c({ stdout: '', stderr: 'boom', exit: 1, ms: 5 }, '42');
check('it fails',            crashed.pass, false);
ok('and names the status',    crashed.why.includes('1'));
ok('not that the output was wrong', !crashed.why.toLowerCase().includes('wrong output'));

const signalled = c({ stdout: '', stderr: '', exit: -1, signal: 'SIGSEGV', ms: 5 }, '42');
ok('a signal is named',       signalled.why.includes('SIGSEGV'));

section('the sanitizer');
const dirty = { stdout: '42\n', stderr: 'AddressSanitizer: heap-buffer-overflow', exit: 1, ms: 5, sanitizer: true };
check('right output but unclean fails when cleanliness is required',
  c(dirty, '42', { requireClean: true }).pass, false);
ok('and says the output may be right but the program is not',
  c(dirty, '42', { requireClean: true }).why.includes('output may be right'));
/* Without requireClean the exit status still fails it, which is correct — ASan
   aborts. The point of the flag is the case where it does not abort. */
const dirtyButZero = { ...dirty, exit: 0 };
check('a clean exit with a sanitizer note passes when cleanliness is not required',
  c(dirtyButZero, '42').pass, true);
ok('but the note is still surfaced', c(dirtyButZero, '42').why.includes('sanitizer'));
check('and it fails when cleanliness IS required',
  c(dirtyButZero, '42', { requireClean: true }).pass, false);

/* ---------------- a whole submission ---------------- */

section('a build failure is its own kind of result');
const failed = H.judgeRun(
  { compile: { ok: false, stderr: "error: 'x' was not declared", ms: 10 }, cases: [] },
  ['42', '7'],
);
check('not correct',        failed.correct, false);
check('scores zero',       failed.score, 0);
check('did not build',     failed.built, false);
check('no cases reported', failed.cases.length, 0);
/* "0 of 2 passed" would be true and useless when nothing ran. */
ok('says it did not build', failed.feedback.includes('did not build'));
ok('and keeps the compiler output', failed.compile.stderr.includes('not declared'));

section('a compiler timeout is distinguished from a compiler error');
const ctimeout = H.judgeRun({ compile: { ok: false, stderr: '', timedOut: true }, cases: [] }, ['x']);
ok('says the compiler timed out', ctimeout.feedback.includes('compiler timed out'));

section('all cases passing');
const allPass = H.judgeRun({
  compile: { ok: true, stderr: '', ms: 300 },
  cases: [{ stdout: '1\n', exit: 0, ms: 2 }, { stdout: '2\n', exit: 0, ms: 2 }],
}, ['1', '2']);
check('correct',   allPass.correct, true);
check('full score', allPass.score, 1);
ok('says how many', allPass.feedback.includes('All 2'));

section('warnings on a passing submission are surfaced');
const warned = H.judgeRun({
  compile: { ok: true, stderr: "warning: unused variable 'x'", ms: 300 },
  cases: [{ stdout: '1\n', exit: 0, ms: 2 }],
}, ['1']);
check('still correct', warned.correct, true);
/* -Wall -Wextra exists to be read. A pass that silently swallows the warning
   teaches nothing. */
ok('but mentions the warnings', warned.feedback.includes('warning'));

section('some cases failing');
const partial = H.judgeRun({
  compile: { ok: true, stderr: '', ms: 300 },
  cases: [
    { stdout: '1\n', exit: 0, ms: 2 },
    { stdout: '9\n', exit: 0, ms: 2 },
    { stdout: '3\n', exit: 0, ms: 2 },
  ],
}, ['1', '2', '3']);
check('not correct',       partial.correct, false);
check('partial score',     partial.score, 2 / 3);
check('passed count',      partial.passed, 2);
ok('says how many passed', partial.feedback.includes('2 of 3'));
ok('and why the first failure failed', partial.feedback.includes('line 1'));

section('one failure among passes reports the FIRST failure');
const firstFail = H.judgeRun({
  compile: { ok: true, stderr: '', ms: 1 },
  cases: [
    { stdout: '1\n', exit: 0, ms: 1 },
    { stdout: '', exit: -1, timedOut: true, ms: 2000 },
    { stdout: '', exit: 1, stderr: 'boom', ms: 1 },
  ],
}, ['1', '2', '3']);
ok('the timeout is the one named', firstFail.feedback.toLowerCase().includes('timed out'));

section('no cases at all is not a pass');
const none = H.judgeRun({ compile: { ok: true, stderr: '', ms: 1 }, cases: [] }, []);
check('an empty run is not correct', none.correct, false);

section('a missing expectation does not throw');
const stubbed = H.judgeRun({
  compile: { ok: true, stderr: '', ms: 1 },
  cases: [{ stdout: 'x\n', exit: 0, ms: 1 }, { stdout: 'y\n', exit: 0, ms: 1 }],
}, ['x']);
check('the unmatched case is judged against nothing', stubbed.cases[1].pass, false);
ok('and the run did not crash', stubbed.cases.length === 2);

report('runner');
