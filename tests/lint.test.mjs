/* Linting: turning real compiler output into rows a reader can click.

   The parsers are pure, and are driven here on captured output rather than by
   invoking the compilers, so they are tested the same way on every machine.
   The live paths are in tests/judge.test.mjs.

   Run: node tests/lint.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';
import { PARSERS } from '../judge/languages.mjs';

const { grab } = loadScripts(['js/lint.js']);
const Lint = grab('Lint');

/* The bracket scanner that used to be tested here is gone, and so are its
   twenty-odd checks. It ran on every keystroke and reported "No unbalanced
   brackets" under the editor, which looked like a program had been checked
   when nothing had been compiled. CodeMirror still matches and closes
   brackets while you type — that is the part that helps — and the compiler
   is now the only thing that returns a verdict.

   What remains is what always mattered: turning real compiler output into
   rows with a line, a column and a message. */

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
check('nothing to say until a compiler has looked',
  Lint.summarise([]), '');
check('one error',
  Lint.summarise([{ severity: 'error' }], { checkedBy: 'compiler' }), '1 error');
check('errors and warnings',
  Lint.summarise([{ severity: 'error' }, { severity: 'error' }, { severity: 'warning' }],
    { checkedBy: 'compiler' }),
  '2 errors, 1 warning');

report('lint');
