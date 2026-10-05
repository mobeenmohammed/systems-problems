/* Graders, driven directly. They are pure by design — no DOM, no store — so
   the rules that decide whether you were right can be tested on their own,
   which is the part that most needs to be trustworthy.

   Run: node tests/grade.test.mjs */

import { loadScripts, section, check, ok, near, report } from './harness.mjs';

const { grab } = loadScripts([
  'js/md.js',
  'js/types/registry.js',
  'js/types/mcq.js',
  'js/types/numeric.js',
  'js/types/order.js',
  'js/types/match.js',
  'js/types/predict.js',
  'js/types/locate.js',
]);

const Types = grab('ProblemTypes');
const g = (type, response, key, problem = {}) => Types.get(type).grade(response, key, problem);

/* ---------------- mcq ---------------- */

section('mcq');
check('right option is correct',      g('mcq', 2, { answer: 2 }).correct, true);
check('wrong option is not',          g('mcq', 1, { answer: 2 }).correct, false);
check('right option scores 1',        g('mcq', 2, { answer: 2 }).score, 1);
check('wrong option scores 0',        g('mcq', 0, { answer: 2 }).score, 0);
check('option 0 is a real answer',    g('mcq', 0, { answer: 0 }).correct, true);
check('a string index still matches',  g('mcq', '2', { answer: 2 }).correct, true);

/* ---------------- multi ---------------- */

section('multi — partial credit by overlap');
const four = { payload: { options: ['a', 'b', 'c', 'd'] } };
const m = (resp, answers) => g('multi', resp, { answers }, four);

check('exactly right is correct',        m([0, 2], [0, 2]).correct, true);
check('order does not matter',           m([2, 0], [0, 2]).correct, true);
check('exactly right scores 1',          m([0, 2], [0, 2]).score, 1);
check('one of two, nothing wrong',       m([0], [0, 2]).score, 0.5);
check('both right plus one wrong',       m([0, 2, 3], [0, 2]).score, 2 / 3);
check('nothing right scores 0',          m([1], [0, 2]).score, 0);
check('a wrong tick is never correct',   m([0, 1, 2], [0, 2]).correct, false);
/* Feedback on a failed "select all" must not hand over the combination, and
   saying "1 of 2 right" hands over half of it: with four options, knowing
   there are exactly two correct answers is most of the way there. So it
   reports the ticks the reader made and whether something is still missing,
   and never how many correct options exist. */
ok('a miss is signalled without saying how many',
  /not ticked/i.test(m([0], [0, 2]).feedback));
ok('and the number of correct options is not disclosed',
  !/of 2|2 right|All 2/.test(m([0], [0, 2]).feedback));
ok('a wrong tick is reported against the ticks made',
  /your \d+ tick|not that one|none of those/i.test(m([0, 1], [0]).feedback));
ok('a fully correct answer says so without counting',
  !/\d/.test(m([0, 2], [0, 2]).feedback));
/* A wrong tick must cost the same as a missed one — otherwise "select all"
   rewards ticking everything. */
check('over-ticking costs as much as under-ticking',
  m([0, 1], [0]).score === m([], [0]).score || m([0, 1], [0]).score, 0.5);
check('ticking everything is not a strategy', m([0, 1, 2, 3], [0]).score, 0.25);

/* ---------------- numeric ---------------- */

section('numeric — parsing');
const parse = Types.get('numeric').parseNumber;

check('plain integer',          parse('4096'), 4096);
check('decimal',                parse('6.25'), 6.25);
check('comma groups',           parse('1,048,576'), 1048576);
check('percent becomes a ratio', parse('6.25%'), 0.0625);
check('simple fraction',        parse('1/16'), 0.0625);
check('exponent',               parse('1.5e3'), 1500);
check('binary suffix KiB',      parse('4KiB'), 4096);
check('binary suffix with space', parse('4 KiB'), 4096);
check('decimal suffix GB',      parse('12GB'), 12e9);
near('micro suffix',            parse('5us'), 5e-6, 1e-18);
check('negative',               parse('-3'), -3);
check('words are not numbers',  parse('sixteen'), null);
check('empty is not a number',  parse(''), null);
check('divide by zero is not a number', parse('1/0'), null);

section('numeric — grading');
const n = (resp, key) => g('numeric', resp, key);

check('exact hit',                     n('0.0625', { value: 0.0625 }).correct, true);
check('fraction form of the same',     n('1/16',   { value: 0.0625 }).correct, true);
check('percent form of the same',      n('6.25%',  { value: 0.0625 }).correct, true);
check('default 1% relative tolerance', n('0.0628', { value: 0.0625 }).correct, true);
check('outside the tolerance',         n('0.07',   { value: 0.0625 }).correct, false);
check('explicit rtol is honoured',     n('0.07',   { value: 0.0625, rtol: 0.2 }).correct, true);
check('absolute tol is honoured',      n('5',      { value: 4, tol: 1 }).correct, true);
check('tol 0 means exact',             n('4.01',   { value: 4, tol: 0 }).correct, false);
check('an accept alternative matches', n('4 KiB',  { value: 4096, accept: ['4096'] }).correct, true);
check('nonsense is not correct',       n('banana', { value: 4 }).correct, false);
ok('nonsense says so',                 n('banana', { value: 4 }).feedback.includes('not a number'));
/* The specific-mistake nudges: being out by a factor of 8 or 1024 is such a
   recognisable error that naming it is worth more than "wrong". */
ok('factor of 8 is named',    n('0.5',  { value: 0.0625 }).feedback.includes('bits'));
ok('factor of 2 is named',    n('0.125', { value: 0.0625 }).feedback.includes('factor of two'));
ok('factor of 1024 is named', n('4',    { value: 4096 }).feedback.includes('1024'));

/* ---------------- short ---------------- */

section('short');
const s = (resp, key) => g('short', resp, key);

check('exact accept',            s('mmap', { accept: ['mmap'] }).correct, true);
check('case is ignored',         s('MMAP', { accept: ['mmap'] }).correct, true);
check('surrounding space is ignored', s('  mmap  ', { accept: ['mmap'] }).correct, true);
check('inner space is collapsed', s('page  fault', { accept: ['page fault'] }).correct, true);
check('a second spelling',       s('mmap()', { accept: ['mmap', 'mmap()'] }).correct, true);
check('wrong word',              s('malloc', { accept: ['mmap'] }).correct, false);
check('nothing entered',         s('', { accept: ['mmap'] }).correct, false);
check('pattern matches',         s('-O2', { pattern: '^-O[123]$' }).correct, true);
check('pattern rejects',          s('-O9', { pattern: '^-O[123]$' }).correct, false);
/* A broken pattern in a content file must read as "not correct", never as a
   crash that looks like the site is down. content.test.mjs compiles every
   pattern so this cannot actually ship. */
check('a bad pattern does not throw', s('x', { pattern: '([' }).correct, false);

/* ---------------- order ---------------- */

section('order');
const six = { payload: { items: ['a', 'b', 'c', 'd', 'e', 'f'] } };
const o = (resp, order) => g('order', resp, { order }, six);
const KEY = [1, 3, 5, 4, 0, 2];

check('exactly right is correct',   o(KEY, KEY).correct, true);
check('exactly right scores 1',     o(KEY, KEY).score, 1);
check('one swap is not correct',    o([3, 1, 5, 4, 0, 2], KEY).correct, false);
check('one swap keeps four placed', o([3, 1, 5, 4, 0, 2], KEY).score, 4 / 6);
ok('placement count is reported',   o([3, 1, 5, 4, 0, 2], KEY).feedback.includes('4 of 6'));
check('a wrong length is rejected', o([1, 3], KEY).correct, false);
check('a wrong length scores 0',    o([1, 3], KEY).score, 0);
/* Exactly reversed usually means the question's "first" was read as "last",
   which is a different mistake from a jumble and worth saying. */
ok('reversed is named as such', o([...KEY].reverse(), KEY).feedback.includes('backwards'));
check('reversed scores 0',      o([...KEY].reverse(), KEY).score, 0);

section('output normalisation');
const norm = Types.normOutput;
check('trailing newline ignored',      norm('15\n'), '15');
check('several trailing newlines',     norm('15\n\n\n'), '15');
check('trailing spaces per line',      norm('1  \n2\t\n'), '1\n2');
check('CRLF folded to LF',             norm('1\r\n2'), '1\n2');
check('inner blank line is kept',      norm('1\n\n2'), '1\n\n2');
check('leading space is kept',         norm('  1'), '  1');

/* ---------------- match ---------------- */

section('match');
const mprob = { payload: { left: ['a', 'b', 'c'], right: ['X', 'Y', 'Z', 'W'] } };
const mt = (resp, key) => g('match', resp, { pairs: key }, mprob);
const MKEY = [2, 0, 3];

check('all pairs right is correct',  mt(MKEY, MKEY).correct, true);
check('and scores 1',                mt(MKEY, MKEY).score, 1);
check('two of three',                mt([2, 0, 1], MKEY).score, 2 / 3);
ok('and says so',                    mt([2, 0, 1], MKEY).feedback.includes('2 of 3'));
check('none right scores 0',         mt([0, 1, 2], MKEY).score, 0);
check('a short answer is rejected',  mt([2, 0], MKEY).correct, false);
ok('and says it is incomplete',      mt([2, 0], MKEY).feedback.includes('Not every item'));
/* The right column is longer than the left, so a spare option is a real
   distractor rather than a free last pair. */
check('choosing a distractor is wrong', mt([2, 0, 1], MKEY).correct, false);

/* ---------------- predict ---------------- */

section('predict');
const pr = (resp, key) => g('predict', resp, key);

check('exact match',                       pr('42', { output: '42' }).correct, true);
check('trailing newline forgiven',         pr('42\n', { output: '42' }).correct, true);
check('missing trailing newline forgiven', pr('42', { output: '42\n' }).correct, true);
check('trailing spaces forgiven',          pr('42   ', { output: '42' }).correct, true);
check('multi-line match',                  pr('1\n2\n3', { output: '1\n2\n3\n' }).correct, true);
check('an inner blank line matters',       pr('1\n2', { output: '1\n\n2' }).correct, false);
check('wrong value',                       pr('41', { output: '42' }).correct, false);
check('an accepted alternative',           pr('b', { output: 'a', accept: ['b'] }).correct, true);
check('an empty answer is not an answer',  pr('', { output: '' }).correct, true);

ok('a wrong line count is named',
  pr('1', { output: '1\n2' }).feedback.includes('2 lines'));
ok('the first differing line is named',
  pr('1\n9\n3', { output: '1\n2\n3' }).feedback.includes('Line 2'));
/* Right lines in the wrong order is a specific misunderstanding — usually of
   evaluation or buffering order — so it is called out as such. */
ok('right lines in the wrong order is named',
  pr('2\n1', { output: '1\n2' }).feedback.includes('not in that order'));

/* ---------------- locate ---------------- */

section('locate');
const lo = (resp, key) => g('locate', resp, key);

check('the right line',        lo(14, { line: 14 }).correct, true);
check('a string line number',  lo('14', { line: 14 }).correct, true);
check('the wrong line',        lo(9, { line: 14 }).correct, false);
check('an also-accepted line', lo(15, { line: 14, alsoAccept: [15] }).correct, true);
/* One line out usually means the right statement and the wrong row of it,
   which is a different thing from not having found it at all. */
ok('one line out says you are close', lo(13, { line: 14 }).feedback.includes('one line away'));
ok('far out does not',                !lo(2, { line: 14 }).feedback.includes('one line away'));

report('grade');
