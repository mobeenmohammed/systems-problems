/* ============================================================
   maths/render.js — mathematics inside the markdown.

   `$x^2$` inline, `$$...$$` on its own lines. Rendered by KaTeX
   into HTML plus a hidden MathML copy, which is what a screen
   reader reads — the visual output alone is a pile of
   positioned spans and says nothing useful aloud.

   ---------------- why it is not just a regex in md.js ----------------

   Mathematics and markdown fight. `$a_1 + a_2$` has two
   underscores in it, and the markdown emphasis rule would turn
   the middle into italics and hand KaTeX `a<em>1 + a</em>2`.
   `$\{x\}$` has braces, `$a*b$` has a star.

   So every maths span is lifted out *before* markdown sees the
   text, replaced by a placeholder, and put back after. The
   placeholder is U+2063 INVISIBLE SEPARATOR around a number:
   markdown has no rule that touches it, HTML escaping leaves it
   alone, and it cannot occur in anything anybody types.

   ---------------- when KaTeX is missing ----------------

   The source is shown as code rather than vanishing. A reader
   who can see `P(A \mid B)` can still work out the question; a
   reader shown nothing cannot.
   ============================================================ */

const MathsRender = (() => {

  const SEP = '⁣';
  const TOKEN = new RegExp(`${SEP}M(\\d+)${SEP}`, 'g');

  const available = () => typeof katex !== 'undefined' && katex && typeof katex.renderToString === 'function';

  /* Lift every maths span out of the source.

     Display first, so that `$$...$$` is never read as two empty inline
     spans. A lone `$` — a price, a shell prompt — is left alone, because
     the opener has to find a closer on the same line to count. */
  function protect(src) {
    const spans = [];
    let text = String(src == null ? '' : src);

    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      spans.push({ tex, display: true });
      return `${SEP}M${spans.length - 1}${SEP}`;
    });

    text = text.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (m, before, tex) => {
      spans.push({ tex, display: false });
      return `${before}${SEP}M${spans.length - 1}${SEP}`;
    });

    /* An escaped dollar is a dollar. */
    text = text.replace(/\\\$/g, '$');
    return { text, spans };
  }

  function one(tex, display) {
    if (!available()) {
      const safe = MD.escapeHtml(tex);
      return display
        ? `<pre class="math-raw" role="math" aria-label="mathematics: ${safe}"><code>${safe}</code></pre>`
        : `<code class="math-raw" role="math" aria-label="mathematics: ${safe}">${safe}</code>`;
    }
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        /* Both, always. The visual half is spans with no meaning; the
           MathML half is the only thing a screen reader can read. */
        output: 'htmlAndMathml',
        strict: false,
        trust: false,
        macros: MACROS,
      });
    } catch (err) {
      /* throwOnError:false handles the ordinary case; this is for the
         pathological one, and it still shows the reader the source. */
      return `<code class="math-raw math-bad" title="${MD.escapeHtml(String(err.message || err))}">`
        + `${MD.escapeHtml(tex)}</code>`;
    }
  }

  /* A few shorthands, so statements can be written the way they are said.
     Deliberately small: every one of these is a name a reader will meet in
     a textbook, not a private abbreviation. */
  const MACROS = {
    '\\R': '\\mathbb{R}',
    '\\N': '\\mathbb{N}',
    '\\Q': '\\mathbb{Q}',
    '\\Z': '\\mathbb{Z}',
    '\\C': '\\mathbb{C}',
    '\\d': '\\mathrm{d}',
    '\\P': '\\mathbb{P}',
    '\\E': '\\mathbb{E}',
    '\\Var': '\\operatorname{Var}',
    '\\Cov': '\\operatorname{Cov}',
    '\\eps': '\\varepsilon',
    '\\To': '\\longrightarrow',
    '\\set': '\\{#1\\}',
    '\\abs': '\\left|#1\\right|',
    '\\norm': '\\left\\|#1\\right\\|',
  };

  function restore(html, spans) {
    if (!spans.length) return html;
    return String(html).replace(TOKEN, (_, i) => {
      const s = spans[Number(i)];
      return s ? one(s.tex, s.display) : '';
    });
  }

  /* The two calls md.js makes. */
  function wrap(src, renderFn) {
    const { text, spans } = protect(src);
    return restore(renderFn(text), spans);
  }

  /* For a label, a button, an aria-label: the maths as words rather than as
     markup. Crude but honest — it is better than reading out backslashes. */
  function plain(src) {
    return String(src == null ? '' : src)
      .replace(/\$\$?([\s\S]+?)\$\$?/g, (_, tex) => tex
        .replace(/\\[a-zA-Z]+/g, m => ({
          '\\le': ' less than or equal to ', '\\leq': ' less than or equal to ',
          '\\ge': ' greater than or equal to ', '\\geq': ' greater than or equal to ',
          '\\neq': ' not equal to ', '\\in': ' in ', '\\notin': ' not in ',
          '\\subset': ' subset of ', '\\subseteq': ' subset of ',
          '\\cup': ' union ', '\\cap': ' intersect ', '\\mid': ' given ',
          '\\varepsilon': ' epsilon ', '\\delta': ' delta ', '\\to': ' tends to ',
          '\\infty': ' infinity ', '\\emptyset': ' the empty set ',
          '\\sqrt': ' square root of ', '\\frac': ' fraction ',
          '\\mathbb': '', '\\mathrm': '', '\\operatorname': '',
        }[m] ?? ` ${m.slice(1)} `))
        .replace(/[{}^_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim());
  }

  return { available, protect, restore, wrap, plain, one, SEP, MACROS };
})();
