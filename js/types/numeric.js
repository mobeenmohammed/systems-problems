/* ============================================================
   types/numeric.js — "numeric" (a figure within a tolerance) and
   "short" (a word, a flag, a syscall name).

   Numeric answers in this subject are rarely bare decimals: the
   honest answer to a cache question is "4 KiB", to a bandwidth
   question "12.8 GB/s", to a miss-rate question "1/16" or "6.25%".
   So the parser accepts binary and decimal SI suffixes, percent,
   simple fractions and exponent notation, and the grader compares
   numbers rather than strings. Typing 4096 when the answer is
   4 KiB is right, because it is.
   ============================================================ */

(() => {
  const { el, register, normText } = ProblemTypes;

  /* Binary suffixes are checked before decimal ones so that "Ki" is not read
     as "K" with a stray i. */
  const SUFFIX = [
    ['ki', 1024], ['mi', 1024 ** 2], ['gi', 1024 ** 3], ['ti', 1024 ** 4],
    ['k', 1e3], ['m', 1e6], ['g', 1e9], ['t', 1e12],
    ['µ', 1e-6], ['u', 1e-6], ['n', 1e-9], ['p', 1e-12],
  ];

  /* Returns a number, or null when the text is not a number at all. Exported
     on the type so tests/grade.test.mjs can drive it directly. */
  function parseNumber(raw) {
    let s = String(raw == null ? '' : raw).trim().toLowerCase()
      .replace(/,/g, '')          /* 1,048,576 */
      .replace(/\s+/g, '');

    if (!s) return null;

    let percent = false;
    if (s.endsWith('%')) { percent = true; s = s.slice(0, -1); }

    /* A trailing unit is dropped, but only after any suffix has been read, so
       "12.8gb/s" keeps its G and "4kib" keeps its Ki. */
    let scale = 1;
    const unitMatch = s.match(/^([-+]?[\d.]+(?:e[-+]?\d+)?(?:\/[\d.]+)?)(.*)$/);
    if (unitMatch) {
      const tail = unitMatch[2];
      s = unitMatch[1];
      if (tail) {
        for (const [suf, mul] of SUFFIX) {
          if (tail.startsWith(suf)) { scale = mul; break; }
        }
      }
    }

    /* A simple fraction, which is how a miss rate is usually quoted. */
    let value;
    if (s.includes('/')) {
      const [a, b] = s.split('/');
      const num = Number(a), den = Number(b);
      if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
      value = num / den;
    } else {
      value = Number(s);
    }

    if (!Number.isFinite(value)) return null;
    if (percent) value /= 100;
    return value * scale;
  }

  register('numeric', {
    /* payload: { unit?: "cycles", placeholder?: "…", hintFormat?: "…" } */
    render(problem, mount, ctx) {
      const p = problem.payload || {};
      const wrap = el('div', { class: 'numeric-in' }, [
        el('input', {
          type: 'text', id: 'numAnswer', inputmode: 'decimal',
          placeholder: p.placeholder || 'your answer',
          autocomplete: 'off', spellcheck: 'false',
          disabled: ctx.locked || undefined,
        }),
        p.unit ? el('span', { class: 'unit', text: p.unit }) : null,
      ]);
      mount.append(wrap);
      mount.append(el('p', { class: 'tiny faint', style: 'margin:.5rem 0 0' }, [
        p.hintFormat ||
        'Suffixes, percentages and fractions are all understood: 4096, 4 KiB, 6.25% and 1/16 are each read as a number.',
      ]));
    },

    collect(mount) {
      const raw = (mount.querySelector('#numAnswer') || {}).value || '';
      return raw.trim() ? raw : null;
    },

    /* key: { value: 4096, tol?: 0, rtol?: 0.01, accept?: [ … ] }

       rtol is relative and is the usual one, because these answers span many
       orders of magnitude and "within 1%" means the same thing at 4 KiB and
       at 12.8 GB/s. tol is absolute, for when the answer is a small count. */
    grade(response, key) {
      const got = parseNumber(response);
      if (got === null) {
        return { correct: false, score: 0, feedback: 'That is not a number I can read.' };
      }

      const candidates = [key.value, ...(key.accept || [])]
        .map(v => (typeof v === 'number' ? v : parseNumber(v)))
        .filter(v => v !== null);

      const rtol = Number.isFinite(key.rtol) ? key.rtol : (Number.isFinite(key.tol) ? 0 : 0.01);
      const tol  = Number.isFinite(key.tol) ? key.tol : 0;

      for (const want of candidates) {
        const slack = Math.max(tol, Math.abs(want) * rtol);
        if (Math.abs(got - want) <= slack) {
          return { correct: true, score: 1, feedback: 'Correct.' };
        }
      }

      const want = candidates[0];
      /* Being out by exactly a factor of two or eight is such a common and
         such a *specific* mistake — bits for bytes, a halved line size — that
         saying so is worth more than "wrong". */
      const ratio = want ? got / want : NaN;
      let nudge = '';
      for (const [f, note] of [[8, 'bits where bytes were wanted, or the other way round'],
                               [1 / 8, 'bits where bytes were wanted, or the other way round'],
                               [2, 'a factor of two — a halved or doubled size somewhere'],
                               [1 / 2, 'a factor of two — a halved or doubled size somewhere'],
                               [1024, 'a factor of 1024'], [1 / 1024, 'a factor of 1024'],
                               [100, 'a percentage written as a fraction, or the reverse'],
                               [1 / 100, 'a percentage written as a fraction, or the reverse']]) {
        if (Math.abs(ratio - f) <= Math.abs(f) * 0.001) { nudge = ` You are out by ${note}.`; break; }
      }

      return { correct: false, score: 0, feedback: `Not that.${nudge}` };
    },

    mark(mount, { result }) {
      const input = mount.querySelector('#numAnswer');
      if (input) input.disabled = true;
    },

    parseNumber,
  });

  register('short', {
    /* payload: { placeholder?: "…", prompt?: "…" } */
    render(problem, mount, ctx) {
      const p = problem.payload || {};
      if (p.prompt) mount.append(el('p', { class: 'muted small', html: MD.renderInline(p.prompt) }));
      mount.append(el('div', { class: 'short-in' }, [
        el('input', {
          type: 'text', id: 'shortAnswer',
          placeholder: p.placeholder || 'your answer',
          autocomplete: 'off', spellcheck: 'false',
          disabled: ctx.locked || undefined,
        }),
      ]));
    },

    collect(mount) {
      const raw = (mount.querySelector('#shortAnswer') || {}).value || '';
      return raw.trim() ? raw : null;
    },

    /* key: { accept: ["mmap", "mmap()"], pattern?: "^-O[123]$", flags?: "i" }

       `accept` is a list of whole answers compared after normalising case and
       whitespace. `pattern` is for the cases where listing every spelling is
       silly — a flag with a number in it, a path with a variable part. */
    grade(response, key) {
      const got = normText(response);
      if (!got) return { correct: false, score: 0, feedback: 'Nothing entered.' };

      for (const want of key.accept || []) {
        if (normText(want) === got) return { correct: true, score: 1, feedback: 'Correct.' };
      }

      if (key.pattern) {
        try {
          if (new RegExp(key.pattern, key.flags || 'i').test(String(response).trim())) {
            return { correct: true, score: 1, feedback: 'Correct.' };
          }
        } catch {
          /* A bad pattern in a content file must not read as a wrong answer;
             content.test.mjs compiles every pattern so this cannot ship. */
        }
      }

      return { correct: false, score: 0, feedback: 'Not quite. Check the exact spelling.' };
    },

    mark(mount) {
      const input = mount.querySelector('#shortAnswer');
      if (input) input.disabled = true;
    },
  });
})();
