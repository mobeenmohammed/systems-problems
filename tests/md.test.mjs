/* The markdown renderer and the highlighter. Both take untrusted-shaped input
   and produce HTML that is inserted with innerHTML, so the escaping is the
   part that matters most here.

   Run: node tests/md.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts(['js/highlight.js', 'js/md.js']);
const MD = grab('MD');
const H = grab('Highlight');

const has = s => out => out.includes(s);
const r = src => MD.render(src);

/* ---------------- escaping ---------------- */

section('escaping — nothing gets through');
ok('a script tag is escaped',      !/<script/i.test(r('<script>alert(1)</script>')));
ok('and is still visible as text', has('&lt;script&gt;')(r('<script>alert(1)</script>')));
ok('an img onerror is escaped',    !/<img/i.test(r('<img src=x onerror=alert(1)>')));
ok('an ampersand is escaped',      has('&amp;')(r('a & b')));
ok('quotes are escaped',           has('&quot;')(r('say "hi"')));
ok('a javascript: link is neutered', !r('[x](javascript:alert(1))').includes('javascript:'));
ok('a data: link is neutered',     !r('[x](data:text/html,<script>)').includes('data:'));
ok('an http link survives',        has('href="https://example.test"')(r('[x](https://example.test)')));
ok('a fragment link survives',     has('href="#/problems"')(r('[x](#/problems)')));
ok('external links get noopener',  has('rel="noopener noreferrer"')(r('[x](https://example.test)')));
ok('escaping happens inside code spans too', has('&lt;b&gt;')(r('`<b>`')));
ok('escaping happens inside code blocks too', has('&lt;b&gt;')(r('```\n<b>\n```')));

/* ---------------- inline ---------------- */

section('inline');
check('bold',            has('<strong>x</strong>')(r('**x**')), true);
check('italic asterisk', has('<em>x</em>')(r('an *x* here')), true);
check('italic underscore', has('<em>x</em>')(r('an _x_ here')), true);
check('strikethrough',   has('<del>x</del>')(r('~~x~~')), true);
check('inline code',     has('<code>x</code>')(r('`x`')), true);

section('inline — code spans are left alone inside');
ok('asterisks in code survive', has('<code>a *b* c</code>')(r('`a *b* c`')));
ok('underscores in code survive', has('<code>a_b_c</code>')(r('`a_b_c`')));
/* The placeholder used while code spans are set aside must not be able to
   collide with real text. A printable one like " 0 " matched ordinary prose. */
ok('a bare number in prose is untouched', has('in 5 steps')(r('`x` and in 5 steps')));
ok('two code spans both come back', r('`a` and `b`').includes('<code>a</code>') && r('`a` and `b`').includes('<code>b</code>'));
ok('ten code spans all come back',
  (r(Array.from({ length: 10 }, (_, i) => `\`c${i}\``).join(' ')).match(/<code>/g) || []).length === 10);
ok('an identifier with underscores is not italicised', !r('`snake_case_name`').includes('<em>'));

/* ---------------- blocks ---------------- */

section('blocks');
check('h1',  has('<h1>T</h1>')(r('# T')), true);
check('h3',  has('<h3>T</h3>')(r('### T')), true);
check('not a heading without a space', has('<p>#notag')(r('#notag')), true);
check('paragraph', has('<p>hello</p>')(r('hello')), true);
check('rule', has('<hr>')(r('---')), true);
check('unordered list', has('<ul><li>a</li><li>b</li></ul>')(r('- a\n- b')), true);
check('ordered list', has('<ol><li>a</li>')(r('1. a\n2. b')), true);
check('ordered list keeps its start', has('start="3"')(r('3. a\n4. b')), true);
check('blockquote', has('<blockquote>')(r('> q')), true);
check('fenced code', has('<pre class="code-block"')(r('```\nx\n```')), true);
check('fenced code records its language', has('data-lang="c"')(r('```c\nx\n```')), true);

section('tables');
const table = r('| a | b |\n| --- | --: |\n| 1 | 2 |');
ok('a table is a table',        table.includes('<table>'));
ok('headers are th',            table.includes('<th'));
ok('right alignment is honoured', table.includes('text-align:right'));
ok('a table can scroll on its own', table.includes('table-wrap'));
ok('pipes without a separator row are just text',
  !r('a | b\nc | d').includes('<table>'));

/* A cell whose subject is a shell pipeline has to be able to contain a pipe.
   Escaped as \| it must survive as one character and not split the row. */
const piped = r('| cmd | where |\n| --- | --- |\n| `a 2>&1 \\| less` | piped |');
ok('an escaped pipe does not split a cell', piped.match(/<td/g).length === 2);
ok('and renders as a bare pipe',            piped.includes('2&gt;&amp;1 | less'));
ok('with no stray backslash',               !piped.includes('\\|'));

section('awkward input');
check('empty string',        r(''), '');
check('null',                r(null), '');
check('undefined',           r(undefined), '');
ok('whitespace only yields nothing', r('\n\n  \n').trim() === '');
ok('an unclosed fence does not hang', r('```c\nx').includes('code-block'));
ok('CRLF is handled', r('# T\r\n\r\nbody').includes('<h1>T</h1>'));

/* ---------------- the highlighter ---------------- */

section('highlighting — on already-escaped text');
const cpp = H.run(MD.escapeHtml('#include <vector>\n// return\nint n = 0x1f; // "s"'), 'cpp');
ok('a preprocessor line is one token', cpp.includes('hl-preproc'));
ok('escaped angle brackets survive',   cpp.includes('&lt;vector&gt;'));
ok('entities are never split',         !cpp.includes('&amp;lt;'));
ok('a keyword inside a comment is not recoloured',
  /class="hl-comment">\/\/ return</.test(cpp));
ok('a hex literal is one number',      cpp.includes('>0x1f<'));

section('highlighting — nothing is lost');
const strip = s => s.replace(/<\/?span[^>]*>/g, '');
for (const [lang, src] of [
  ['cpp',     '#include <vector>\nint main() { std::string s = "x"; return 0; }'],
  ['rust',    'fn main() { let v: Vec<u32> = vec![1]; println!("{:?}", v); }'],
  ['python',  'def f(x):\n    return x  # note\n'],
  ['js',      'const f = async () => { await g(`t${1}`); };'],
  ['bash',    'grep -c foo /var/log/x | wc -l  # count'],
  ['verilog', 'always @(posedge clk) q <= d;'],
  ['asm',     'main:\n  mov %rax, %rbx  ; move'],
]) {
  const esc = MD.escapeHtml(src);
  ok(`${lang}: round-trips exactly`, strip(H.run(esc, lang)) === esc);
  ok(`${lang}: something was coloured`, H.run(esc, lang) !== esc);
}

section('highlighting — unknown languages');
check('an unknown language is a no-op', H.run('plain', 'cobol'), 'plain');
check('no language is a no-op',         H.run('plain', ''), 'plain');
check('c++ is an alias for cpp',        H.supports('c++'), true);
check('rs is an alias for rust',        H.supports('rs'), true);
check('cobol is not supported',         H.supports('cobol'), false);

report('md');
