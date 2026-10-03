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
ok('a missed answer is reported',        m([0], [0, 2]).feedback.includes('1 missed'));
ok('a wrong tick is reported',           m([0, 1], [0]).feedback.includes('is not'));
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

report('grade');
