/* C++ completion: the word lists, the type reading, and the one case
   that can be wrong.

   The completion source is duck-typed on CodeMirror's CompletionContext —
   it uses matchBefore, pos, explicit and state.doc and nothing else —
   which is what lets the whole thing be driven here without starting an
   editor. tests/browser/complete.test.mjs drives the real one.

   Run: node tests/complete.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts(['js/complete-cpp.js']);
const C = grab('CppComplete');

/* A stand-in for CodeMirror's context. The cursor is always at the end of
   the text, which is where completion happens. */
const ctx = (doc, explicit = false) => ({
  pos: doc.length,
  explicit,
  state: { doc: { toString: () => doc } },
  matchBefore(re) {
    const line = doc.slice(doc.lastIndexOf('\n') + 1);
    const m = new RegExp(`${re.source}$`).exec(line);
    if (!m) return null;
    return { from: doc.length - m[0].length, to: doc.length, text: m[0] };
  },
});

const at = (doc, explicit = false) => C.source(ctx(doc, explicit));
const labels = r => (r ? r.options.map(o => o.label) : []);
const find = (r, label) => (r ? r.options.find(o => o.label === label) : undefined);

/* ---------------- headers ---------------- */

section('#include offers headers and nothing else');
{
  const r = at('#include <vec');
  ok('it answers', !!r);
  ok('vector is there', labels(r).includes('vector'));
  ok('and so is algorithm', labels(r).includes('algorithm'));
  ok('no keywords leak in', !labels(r).includes('return'));
  ok('and no std:: names', !labels(r).some(l => l.startsWith('std::')));
  check('it replaces only what was typed after the bracket',
    r.from, '#include <vec'.length - 'vec'.length);

  ok('quoted includes work too', labels(at('#include "str')).includes('string'));
}

/* ---------------- the standard library ---------------- */

section('std:: names carry the header you need to include');
{
  const r = at('std::vec');
  const v = find(r, 'std::vector');
  ok('std::vector is offered', !!v);
  check('with the header beside it', v.detail, '<vector>');
  check('and it replaces the whole std:: token', r.from, 0);

  check('std::sort says algorithm', find(at('std::so'), 'std::sort').detail, '<algorithm>');
  check('std::accumulate says numeric',
    find(at('std::ac'), 'std::accumulate').detail, '<numeric>');
  check('std::cout says iostream', find(at('std::co'), 'std::cout').detail, '<iostream>');
}

section('keywords are offered, and are not confused with names');
{
  const r = at('con');
  ok('constexpr is a keyword', find(r, 'constexpr').type === 'keyword');
  ok('and std::cout is not', !find(r, 'std::cout') || find(r, 'std::cout').type === 'class');
}

/* ---------------- your own names ---------------- */

section('identifiers already in the buffer complete');
{
  const doc = 'int runningTotal = 0;\nvoid helper(int n);\nrunn';
  const r = at(doc);
  ok('a variable you declared', labels(r).includes('runningTotal'));
  ok('a function you declared', labels(r).includes('helper'));
  ok('but not a keyword dressed as one', !C.identifiers('return return', '').includes('return'));
  ok('and not one-or-two letter noise', !C.identifiers('int i = 0; ab', '').includes('ab'));
}

/* ---------------- reading declarations ---------------- */

section('declarations a regex can read are read');
{
  const t = C.declaredTypes([
    'std::vector<int> numbers;',
    'std::string name;',
    'std::map<std::string, int> counts;',
    'std::unordered_set<int> seen;',
    'const std::vector<std::string>& rows = x;',
    'std::pair<int, int> edge;',
    'vector<double> bare;',
    'std::deque<int> queue;',
  ].join('\n'));
  check('vector',        t.numbers, 'vector');
  check('string',        t.name,    'string');
  check('map',           t.counts,  'map');
  check('unordered_set is a set', t.seen, 'set');
  check('a const reference still declares a name', t.rows, 'vector');
  check('pair',          t.edge,    'pair');
  check('without std::, after using namespace std', t.bare, 'vector');
  check('a deque is close enough to a vector to answer', t.queue, 'vector');

  check('the streams are always themselves', t.cout, 'ostream');
  check('and cin is an istream',             t.cin,  'istream');
}

section('what it cannot read, it does not pretend to know');
{
  const t = C.declaredTypes('auto guess = makeSomething();\nMyClass thing;\nT item;');
  ok('auto is not guessed at', t.guess === undefined);
  ok('a type it has never heard of is not either', t.thing === undefined);
  ok('nor a template parameter', t.item === undefined);
}

/* ---------------- members: the part that can be wrong ---------------- */

section('a known receiver gets exactly its own members');
{
  const r = at('std::vector<int> numbers;\nnumbers.');
  const ls = labels(r);
  ok('push_back is offered', ls.includes('push_back'));
  ok('and size', ls.includes('size'));
  ok('but not substr, which is a string thing', !ls.includes('substr'));
  ok('nor first, which is a pair thing', !ls.includes('first'));
  ok('the type is not repeated on every row, because it is known',
    r.options.every(o => o.detail === undefined));

  const s = labels(at('std::string name;\nname.'));
  ok('a string gets substr', s.includes('substr'));
  ok('and push_back, which std::string really does have', s.includes('push_back'));
  ok('but not emplace_back, which it does not', !s.includes('emplace_back'));

  ok('an arrow works like a dot',
    labels(at('std::vector<int> v;\nv->')).includes('push_back'));
}

section('an unknown receiver is offered everything, labelled');
{
  const r = at('mystery.');
  const ls = labels(r);
  ok('it still helps', ls.length > 10);
  ok('offering members from several types', ls.includes('push_back') && ls.includes('substr'));
  ok('every one of them says which type it belongs to',
    r.options.every(o => typeof o.detail === 'string' && o.detail.startsWith('std::')));
  ok('and a name two types share is offered once',
    ls.filter(l => l === 'size').length === 1);
}

section('cout knows what it is');
{
  const ls = labels(at('std::cout.'));
  ok('an ostream member', ls.includes('flush'));
  ok('and not a container one', !ls.includes('push_back'));
}

/* ---------------- when not to interrupt ---------------- */

section('it stays out of the way');
{
  ok('one character is not enough on its own', at('v') === null);
  ok('unless it was asked for', at('v', true) !== null);
  ok('two characters is enough', at('ve') !== null);
  ok('a member list shows on the dot, with nothing typed',
    at('std::vector<int> v;\nv.') !== null);
}

report('complete');
