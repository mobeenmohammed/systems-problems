/* The expression engine, driven directly.

   This is the part of the mathematics work that has to be right, because it
   is the part that tells somebody their answer is wrong. Three properties
   matter and each has a section here:

     · equal values compare equal however they are written. 3/8, 0.375,
       6/16 and (1+2)/8 are one answer, not four.
     · unequal values never compare equal. There is no sampling anywhere in
       the module, and these checks are the evidence.
     · a thing it cannot read, and a thing it can read but will not judge,
       are reported as *different kinds* of failure from a wrong answer.

   Run: node tests/maths-expr.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts(['js/maths/expr.js']);
const E = grab('MathsExpr');

const val = s => { const r = E.read(s); return r.ok ? r.value : null; };
const num = s => { const v = val(s); return v === null ? null : v.toString(); };
const bad = s => { const r = E.read(s); return r.ok ? null : r.kind; };

/* ---------------- reading numbers ---------------- */

section('numbers, exactly');
check('an integer',            num('42'), '42');
check('a negative',            num('-7'), '-7');
check('a fraction',            num('3/8'), '3/8');
check('reduced on the way in', num('6/16'), '3/8');
/* A decimal is a rational, not a float: 0.1 is 1/10 and must not become
   0.1000000000000000055511151231257827. */
check('a decimal is exact',    num('0.375'), '3/8');
check('and so is 0.1',         num('0.1'), '1/10');
/* Reduced, which is the point: the value is exact and canonical, not the
   text that was typed. */
check('a long decimal',        num('0.123456789012345678'),
  '61728394506172839/500000000000000000');
check('scientific notation',   num('1.5e3'), '1500');
check('a negative exponent',   num('2e-3'), '1/500');
check('a leading dot',         num('.25'), '1/4');

section('arithmetic');
check('addition',       num('1/3 + 1/6'), '1/2');
check('subtraction',    num('1 - 3/4'), '1/4');
check('multiplication', num('2/3 * 3/4'), '1/2');
check('division',       num('(1/2) / (1/4)'), '2');
check('precedence',     num('1 + 2*3'), '7');
check('brackets',       num('(1 + 2) * 3'), '9');
check('powers',         num('2^10'), '1024');
check('a negative power', num('2^-2'), '1/4');
check('right associative powers', num('2^3^2'), '512');
check('unary minus',    num('-(3-5)'), '2');
check('nested',         num('((1+1)/(2+2))^3'), '1/8');

section('the shapes people actually type');
check('implicit multiplication after a number', num('2(3+1)'), '8');
check('and after a bracket',                    num('(1+1)(2+2)'), '8');
check('a space in the middle',                  num('3 / 8'), '3/8');
check('a unicode minus',                        num('5 − 2'), '3');
check('a unicode times',                        num('3 × 4'), '12');
check('a unicode divide',                       num('3 ÷ 4'), '3/4');
check('a superscript',                          num('2³'), '8');
check('a root sign',                            num('√9'), '3');

section('counting');
check('factorial',        num('5!'), '120');
check('zero factorial',   num('0!'), '1');
check('choose',           num('C(5,2)'), '10');
check('the other spelling', num('choose(5,2)'), '10');
check('binom',            num('binom(10,3)'), '120');
check('choose at the edge', num('C(5,0)'), '1');
check('choose past the end', num('C(5,9)'), '0');
check('permutations',     num('P(5,2)'), '20');
/* Two hearts in a five-card hand: C(13,2)C(39,3)/C(52,5). */
check('a real probability', num('C(13,2)*C(39,3)/C(52,5)'), '9139/33320');
/* The big ones have to stay exact: a float loses this by the time it is
   printed. */
check('exact at scale', num('C(52,5)'), '2598960');
check('and a big factorial ratio', num('20!/18!'), '380');

section('surds');
check('a perfect square',      num('sqrt(16)'), '4');
check('a square-free radicand', num('sqrt(2)'), 'sqrt(2)');
check('pulled apart',          num('sqrt(12)'), '2*sqrt(3)');
check('of a fraction',         num('sqrt(1/4)'), '1/2');
check('of a non-square fraction', num('sqrt(2/9)'), '1/3*sqrt(2)');
check('added to a rational',   num('1 + sqrt(2)'), '1 + sqrt(2)');
check('the golden ratio',      num('(1+sqrt(5))/2'), '1/2 + 1/2*sqrt(5)');
check('squared away again',    num('sqrt(2)^2'), '2');
check('rationalised',          num('1/sqrt(2)'), '1/2*sqrt(2)');
check('a difference of surds', num('sqrt(8) - sqrt(2)'), 'sqrt(2)');
check('and one that cancels',  num('sqrt(2) - sqrt(2)'), '0');
/* Euclidean distances, which is what metric space problems want. */
check('the distance from (0,0) to (1,1)', num('sqrt(1^2 + 1^2)'), 'sqrt(2)');
check('and from (0,0) to (3,4)',          num('sqrt(3^2 + 4^2)'), '5');

section('equality is about the value, not the text');
const same = (a, b) => E.sameValue(a, b);
ok('a fraction and its decimal',   same('3/8', '0.375'));
ok('an unreduced fraction',        same('3/8', '6/16'));
ok('an arithmetic expression',     same('1/2', '(1+1)/4'));
ok('whitespace',                   same('1/2', ' 1 / 2 '));
ok('a different route to a surd',  same('sqrt(8)', '2*sqrt(2)'));
ok('a rationalised denominator',   same('1/sqrt(2)', 'sqrt(2)/2'));
ok('counting written two ways',    same('C(6,2)', '15'));
ok('and a probability',            same('1/6 + 1/6', '1/3'));

section('and unequal values are never equal');
ok('close is not equal',     !same('1/3', '0.333'));
ok('very close is not equal', !same('1/3', '0.3333333333333333'));
ok('nor is nearly a surd',   !same('sqrt(2)', '1.41421356'));
ok('different surds',        !same('sqrt(2)', 'sqrt(3)'));
ok('sign matters',           !same('1/2', '-1/2'));
ok('and so does order of operations', !same('1+2*3', '(1+2)*3'));

/* ---------------- failing well ---------------- */

section('a thing it cannot read is a syntax error, not a wrong answer');
check('nothing at all',        bad(''), 'empty');
check('just spaces',           bad('   '), 'empty');
check('a dangling operator',   bad('1 +'), 'syntax');
check('an unclosed bracket',   bad('(1 + 2'), 'syntax');
check('a stray bracket',       bad('1 + 2)'), 'syntax');
check('a word',                bad('seven'), 'syntax');
check('a stray character',     bad('1 # 2'), 'syntax');
/* Not read as 1*2: two numbers with a space between them is a typo every
   time, and multiplying them would turn a slip into an unexplainable wrong
   answer. */
check('two numbers side by side', bad('1 2'), 'syntax');
check('wrong arity',           bad('C(5)'), 'syntax');
ok('and the message says where it stopped',
  /expected|do not understand|not something/.test(E.read('(1+').message));

section('a thing it will not judge says so, and says why');
check('pi',    bad('pi'), 'unsupported');
check('e',     bad('e'), 'unsupported');
check('a log', bad('ln(2)'), 'unsupported');
check('sin',   bad('sin(1)'), 'unsupported');
check('mixing two surds', bad('sqrt(2) + sqrt(3)'), 'unsupported');
check('a fractional power', bad('2^(1/2)'), 'unsupported');
ok('and pi explains itself rather than looking like a typo',
  /exact values|not one it can compare/.test(E.read('pi').message));
ok('mixing surds names both of them',
  /√2 and √3|√3 and √2/.test(E.read('sqrt(2)+sqrt(3)').message));

section('and a thing that is not a number is its own kind of failure');
check('divide by zero',          bad('1/0'), 'math');
check('divide by zero the long way', bad('1/(2-2)'), 'math');
check('the root of a negative',  bad('sqrt(-1)'), 'math');
check('a negative factorial',    bad('(-1)!'), 'math');

section('nothing is evaluated as code');
/* The whole reason the parser exists. Each of these is a plausible attempt
   at injection and each must come back as an ordinary syntax error. */
for (const attack of [
  'constructor', 'this', 'globalThis.alert(1)', '[].map(x=>x)',
  'process.exit(1)', 'require("fs")', '`${1+1}`', 'alert(1)',
  '1;alert(1)', 'window.location', '__proto__',
]) {
  const r = E.read(attack);
  ok(`"${attack}" is refused`, !r.ok && (r.kind === 'syntax' || r.kind === 'unsupported'));
}

/* ---------------- sets ---------------- */

section('finite sets are unordered');
const sameSet = (a, b) => E.sameSet(a, b);
ok('the same members in another order', sameSet('{1,2,3}', '{3,1,2}'));
ok('a repeated member is still the same set', sameSet('{1,2,2}', '{1,2}'));
ok('members written differently',      sameSet('{1/2, 1}', '{0.5, 1}'));
ok('the empty set',                    sameSet('{}', '{}'));
ok('and the unicode empty set',        sameSet('∅', '{}'));
ok('spacing does not matter',          sameSet('{ 1 , 2 }', '{1,2}'));
ok('a missing member is a different set', !sameSet('{1,2}', '{1,2,3}'));
ok('an extra one too',                 !sameSet('{1,2,3}', '{1,2}'));
ok('and a different member',           !sameSet('{1,2}', '{1,3}'));
check('something that is not a set at all', E.readSet('1,2').kind, 'syntax');
ok('and it says how to write one', /braces/.test(E.readSet('1,2').message));
check('a member that will not parse', E.readSet('{1, two}').kind, 'syntax');
ok('naming the member that failed', /two/.test(E.readSet('{1, two}').message));

/* ---------------- intervals ---------------- */

section('intervals, where the brackets are the answer');
const sameI = (a, b) => E.sameIntervals(a, b);
ok('identical',                 sameI('(0,1)', '(0,1)'));
ok('ends written differently',  sameI('(0,1/2)', '(0,0.5)'));
ok('a union in another order',  sameI('(0,1) U (2,3)', '(2,3) U (0,1)'));
ok('the empty set',             sameI('{}', '{}'));
ok('open is not closed',        !sameI('(0,1)', '[0,1]'));
ok('nor is half-open',          !sameI('(0,1]', '(0,1)'));
ok('and the other half',        !sameI('[0,1)', '(0,1)'));
ok('different ends',            !sameI('(0,1)', '(0,2)'));
ok('a union is not one interval', !sameI('(0,1) U (2,3)', '(0,3)'));
check('something that is not an interval', E.readIntervals('0 to 1').kind, 'syntax');
ok('and it shows the four forms', /\(0,1\)/.test(E.readIntervals('0 to 1').message));
check('ends the wrong way round', E.readIntervals('(1,0)').kind, 'math');

/* ---------------- the bits graders lean on ---------------- */

section('describing a value back to a reader');
check('an integer',  E.describe('6/2'), '3');
ok('a fraction shows the decimal too', /3\/8 \(0\.375\)/.test(E.describe('3/8')));
ok('a surd shows what it is worth',    /sqrt\(2\).*1\.41/.test(E.describe('sqrt(2)')));
check('and something unreadable describes as nothing', E.describe('oops'), null);

report('maths-expr');
