/* Mathematics inside the markdown.

   Two things to get right, and the second is the one that bites:

     · KaTeX actually renders, and emits the MathML a screen reader needs.
     · markdown does not get at the TeX first. `$a_1 + a_2$` has two
       underscores in it and `$a*b$` has a star, and the emphasis rules
       would quietly turn both into something KaTeX cannot parse.

   Run: node tests/maths-render.test.mjs */

import fs from 'node:fs';
import { loadScripts, section, check, ok, report } from './harness.mjs';

/* KaTeX is a browser bundle; it checks for `window` and attaches itself. The
   harness sandbox provides one. */
const { grab } = loadScripts([
  'vendor/katex/katex.min.js',
  'js/md.js',
  'js/maths/render.js',
]);
const MD = grab('MD');
const R = grab('MathsRender');

section('KaTeX is actually there');
ok('the vendored bundle loaded', R.available());
ok('and it is the pinned version',
  /0\.19\.0/.test(fs.readFileSync('vendor/katex/README.md', 'utf8')));

section('inline mathematics');
{
  const html = MD.renderInline('The probability is $P(A \\mid B)$ here.');
  ok('it rendered to KaTeX markup', html.includes('katex'));
  ok('with a MathML copy for a screen reader', html.includes('katex-mathml'));
  ok('and the surrounding words are untouched', /The probability is/.test(html) && /here\./.test(html));
  ok('no dollar signs are left behind', !html.includes('$'));
}

section('display mathematics');
{
  const html = MD.render('Before.\n\n$$\\sum_{i=1}^{n} x_i$$\n\nAfter.');
  ok('it rendered', html.includes('katex'));
  ok('as display rather than inline', html.includes('katex-display'));
  ok('and the prose either side survived', /Before\./.test(html) && /After\./.test(html));
}

section('markdown does not get at the TeX first');
{
  /* The whole reason the maths is lifted out before anything else runs. */
  const underscores = MD.renderInline('$a_1 + a_2 = b_3$');
  ok('subscripts are not turned into italics', !underscores.includes('<em>'));
  ok('and the expression rendered', underscores.includes('katex'));

  const stars = MD.renderInline('$a * b * c$');
  ok('stars are not emphasis', !stars.includes('<em>'));

  const braces = MD.renderInline('$\\{x : x > 0\\}$');
  ok('braces survive', braces.includes('katex'));

  /* And markdown still works *around* the maths. */
  const mixed = MD.renderInline('**bold** then $x^2$ then `code`');
  ok('bold still works', mixed.includes('<strong>bold</strong>'));
  ok('code still works', mixed.includes('<code>code</code>'));
  ok('and the maths rendered', mixed.includes('katex'));
}

section('escaping still holds');
{
  /* The renderer escapes before it does anything else, and adding a maths
     pass in front of that must not have opened a hole. */
  const html = MD.renderInline('<img src=x onerror=alert(1)> and $x$');
  ok('the tag is escaped', html.includes('&lt;img') && !html.includes('<img'));
  ok('and the maths still rendered', html.includes('katex'));

  const inMaths = MD.renderInline('$\\text{<script>alert(1)</script>}$');
  ok('nothing executable comes out of the TeX',
    !/<script\b/i.test(inMaths));
}

section('a lone dollar sign is a dollar sign');
{
  ok('a price is left alone', MD.renderInline('It costs $5 to run.').includes('$5'));
  ok('and an escaped dollar too', MD.renderInline('\\$100').includes('$100'));
  ok('neither produced maths',
    !MD.renderInline('It costs $5 to run.').includes('katex'));
}

section('the macros a statement is allowed to use');
for (const [tex, want] of [
  ['$\\R$', 'R'], ['$\\P(A)$', 'P'], ['$\\E[X]$', 'E'],
  ['$\\Var(X)$', 'Var'], ['$\\eps > 0$', 'ε'],
]) {
  const html = R.one(tex.slice(1, -1), false);
  ok(`${tex} renders`, html.includes('katex') && !html.includes('math-bad'));
  ok(`and reads as ${want}`, html.includes(want));
}

section('bad TeX is shown, not swallowed');
{
  const html = R.one('\\frac{1}{', false);
  ok('something came back', html.length > 0);
  ok('and the reader can still see the source or an error',
    html.includes('katex') || html.includes('math-raw'));
}

section('speaking it aloud');
{
  check('an inequality', R.plain('$x \\le 1$').trim(), 'x less than or equal to 1');
  ok('a conditional probability', /given/.test(R.plain('$P(A \\mid B)$')));
  ok('and set membership', /in/.test(R.plain('$x \\in A$')));
}

section('without KaTeX, the maths is still readable');
{
  /* A reader shown `P(A \mid B)` can work out the question; one shown
     nothing cannot. */
  const { grab: grab2 } = loadScripts(['js/md.js', 'js/maths/render.js']);
  const MD2 = grab2('MD');
  const R2 = grab2('MathsRender');
  ok('KaTeX is genuinely absent', !R2.available());
  const html = MD2.renderInline('the value $x^2$ here');
  ok('the source is shown instead of vanishing', html.includes('x^2'));
  ok('marked up as mathematics for a screen reader', html.includes('role="math"'));
  ok('and the prose is intact', /the value/.test(html) && /here/.test(html));
}

report('maths-render');
