/* Linting, in both tiers.

   The local bracket scanner is pure and runs on every keystroke, so it has to
   be right about comments and strings — reporting the smiley in a comment as
   an unbalanced paren would be worse than no linting at all.

   The compiler diagnostic parsers are pure too, and are driven here on real
   captured output rather than by invoking the compilers, so they are tested
   the same way on every machine. The live paths are in tests/judge.test.mjs.

   Run: node tests/lint.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';
import { PARSERS } from '../judge/languages.mjs';

const { grab } = loadScripts(['js/lint.js']);
const Lint = grab('Lint');

const scan = (src, lang = 'cpp') => Lint.scanBrackets(src, lang);
const msgs = (src, lang = 'cpp') => scan(src, lang).map(d => d.message);

/* ---------------- the bracket scanner ---------------- */

section('balanced code is reported clean');
check('a function',        scan('int main() { return 0; }').length, 0);
check('nesting',           scan('int f() { if (a[0]) { g({1}); } }').length, 0);
check('empty',             scan('').length, 0);
check('no brackets at all', scan('int x = 1;').length, 0);

section('an unclosed bracket is found, at the opening');
let d = scan('int main() {\n  int x = 1;\n');
check('one finding',        d.length, 1);
check('reported on the opening line', d[0].line, 1);
check('and at its column',  d[0].column, 12);
ok('and says what is open', d[0].message.includes("'{'"));
/* The compiler points at the end of the file; the fix is at the opening, and
   that is where someone needs to look. */
ok('not at the end of the file', d[0].line !== 3);

section('a stray closer is found');
d = scan('int main() { return 0; } }');
check('one finding',   d.length, 1);
check('on line 1',     d[0].line, 1);
ok('and says nothing was opened', d[0].message.includes('nothing was opened'));

section('a mismatched pair is named');
d = scan('int f() { return a[0); }');
ok('the mismatch is reported', d.length >= 1);
ok('and names both brackets', d[0].message.includes("'['") || d[0].message.includes("')'"));

section('brackets inside comments are ignored');
check('a line comment',  scan('int main() { } // ) } ]').length, 0);
check('a block comment', scan('/* { ( [ */ int main() { }').length, 0);
check('a brace in a comment does not count as opened',
  scan('int main() {\n  // {\n}').length, 0);
check('an unterminated block comment is reported',
  scan('int main() { }\n/* never closed').length, 1);
ok('and says so', msgs('int main() { }\n/* never closed')[0].includes('unterminated block comment'));

section('brackets inside strings are ignored');
check('a string with braces',   scan('f("{ ( [");').length, 0);
check('a char literal',         scan("char c = '}';").length, 0);
check('an escaped quote',       scan('f("a \\" ) b");').length, 0);
check('an unterminated string is reported', scan('f("oops);').length >= 1, true);
ok('and says so', msgs('f("oops);').some(m => m.includes('unterminated string')));

section('python');
check('a hash comment',   scan('def f():\n    pass  # )', 'python').length, 0);
check('a triple-quoted string', scan('x = """ ) } """', 'python').length, 0);
check('an unterminated triple quote', scan('x = """ oops', 'python').length, 1);
check('an unclosed paren',  scan('print(', 'python').length, 1);

section('javascript');
check('a template literal spanning lines',
  scan('const s = `line1\nline2 ) `;', 'js').length, 0);
check('a backtick is only special in js',
  scan('const s = `a`;', 'js').length, 0);

section('several findings are all reported');
d = scan('int f() {\n  g((;\n');
ok('more than one', d.length >= 2);

section('a realistic C++ program is clean');
check('the usual shape', scan([
  '#include <iostream>',
  '',
  'int main() {',
  '    std::cout << "hello, {world}" << "\\n";  // a brace in a string',
  '    return 0;',
  '}',
].join('\n')).length, 0);

/* ---------------- the compiler diagnostic parsers ---------------- */

section('g++ output');
let out = PARSERS.parsePlain([
  "C:\\Users\\Jimmy\\AppData\\Local\\Temp\\lint-abc\\main.cpp: In function 'int main()':",
  "C:\\Users\\Jimmy\\AppData\\Local\\Temp\\lint-abc\\main.cpp:1:20: error: 'nope' was not declared in this scope",
  "C:\\Users\\Jimmy\\AppData\\Local\\Temp\\lint-abc\\main.cpp:2:7: warning: unused variable 'x' [-Wunused-variable]",
].join('\n'));
check('two diagnostics',        out.length, 2);
/* A Windows absolute path starts "C:\\", and the colon in it is exactly what
   defeated the first version of this parser. */
check('the line survives a drive letter', out[0].line, 1);
check('and the column',         out[0].column, 20);
check('severity',               out[0].severity, 'error');
check('the message is clean of the path', out[0].message, "'nope' was not declared in this scope");
check('the warning too',        out[1].severity, 'warning');
ok('the "In function" context line is not a diagnostic', out.length === 2);

section('g++ notes are dropped');
out = PARSERS.parsePlain([
  '/tmp/x/main.cpp:3:5: error: no matching function',
  '/tmp/x/main.cpp:1:5: note: candidate expects 2 arguments',
].join('\n'));
check('only the error', out.length, 1);
check('and it is the error', out[0].severity, 'error');

section('rustc --error-format=short');
out = PARSERS.parsePlain(
  '/tmp/lint-x/main.rs:1:25: error[E0425]: cannot find value `nope` in this scope');
check('one diagnostic', out.length, 1);
check('line',           out[0].line, 1);
check('column',         out[0].column, 25);
/* The error code is in brackets after the severity and must not end up in the
   message or the line number. */
ok('the error code is stripped', !out[0].message.startsWith('[E0425]'));
ok('the message survives', out[0].message.includes('cannot find value'));

section('python py_compile');
out = PARSERS.parsePython([
  '  File "/tmp/lint-x/main.py", line 2',
  '    print(',
  '         ^',
  "SyntaxError: '(' was never closed",
].join('\n'));
check('one diagnostic', out.length, 1);
check('the line from the File header', out[0].line, 2);
ok('the message names the class', out[0].message.startsWith('SyntaxError:'));
ok('and the detail',               out[0].message.includes('never closed'));
check('nothing at all gives nothing', PARSERS.parsePython('').length, 0);

section('node --check');
out = PARSERS.parseNode([
  'file:///tmp/lint-x/main.js:2',
  'const y = {',
  '          ^',
  '',
  'SyntaxError: Unexpected end of input',
].join('\n'));
check('one diagnostic', out.length, 1);
check('the line',       out[0].line, 2);
ok('the message',       out[0].message.includes('Unexpected end of input'));
check('clean output gives nothing', PARSERS.parseNode('').length, 0);

section('a parser never throws on unexpected input');
for (const [name, fn] of Object.entries(PARSERS)) {
  for (const junk of ['', 'no diagnostics here', ':::', 'main.cpp::: error:', '1:2:3:4:5']) {
    try {
      const r = fn(junk);
      ok(`${name} survives ${JSON.stringify(junk.slice(0, 18))}`, Array.isArray(r));
    } catch (e) {
      ok(`${name} survives ${JSON.stringify(junk.slice(0, 18))}`, false);
    }
  }
}

/* ---------------- the summary line ---------------- */

section('summarising');
check('nothing found, by the compiler',
  Lint.summarise([], { checkedBy: 'compiler' }), 'No problems found by the compiler.');
check('nothing found, locally',
  Lint.summarise([]), 'No unbalanced brackets.');
check('one error',
  Lint.summarise([{ severity: 'error' }]), '1 error');
check('errors and warnings',
  Lint.summarise([{ severity: 'error' }, { severity: 'error' }, { severity: 'warning' }]),
  '2 errors, 1 warning');

report('lint');
