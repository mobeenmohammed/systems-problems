/* ============================================================
   types/predict.js — "predict": say exactly what this prints.

   The most honest test there is of whether you understand a
   language. You cannot bluff the output of a program; either you
   can follow what it does or you cannot.

   It is also where most of the real C and C++ lessons live —
   integer promotion, struct padding, evaluation order, buffered
   stdio across a fork, `=` versus `<=` in a Verilog always block.
   None of it needs a compiler to ask about, which is why these
   problems work with the judge switched off.

   Graded on normalised output: trailing whitespace and a missing
   final newline are forgiven, because no problem here is about
   either. A blank line in the middle is not.
   ============================================================ */

(() => {
  const { el, register, normOutput } = ProblemTypes;

  register('predict', {
    /* payload: { code: "…", lang?: "c", prompt?: "…", lines?: 6 } */
    render(problem, mount, ctx) {
      const p = problem.payload || {};

      if (p.code) {
        const escaped = MD.escapeHtml(p.code);
        const body = p.lang ? Highlight.run(escaped, p.lang) : escaped;
        mount.append(el('pre', {
          class: 'code-block',
          'data-lang': p.lang || undefined,
          html: `<code>${body}</code>`,
        }));
      }

      mount.append(el('p', { class: 'muted small' }, [
        p.prompt || 'Write exactly what this prints, one line per line of output.',
      ]));

      mount.append(el('textarea', {
        id: 'predictAnswer',
        class: 'mono',
        spellcheck: 'false',
        autocapitalize: 'off',
        rows: String(p.lines || 6),
        style: 'width:100%;font-family:var(--mono);white-space:pre;overflow-wrap:normal',
        placeholder: 'the output, exactly',
        disabled: ctx.locked || undefined,
      }));

      mount.append(el('p', { class: 'tiny faint', style: 'margin:.4rem 0 0' }, [
        'Trailing spaces and a missing last newline are forgiven. A blank line in the middle is not — ' +
        'if the program prints one, write one.',
      ]));
    },

    collect(mount) {
      const node = mount.querySelector('#predictAnswer');
      if (!node) return null;
      /* An empty box is not an answer. "It prints nothing" is a real answer to
         some of these, so it has to be written — a space will do, and the
         normaliser turns that into the empty string. */
      return node.value === '' ? null : node.value;
    },

    /* key: { output: "…", accept?: ["…"] }

       `accept` is for the handful of cases with more than one legitimate
       answer — an unspecified evaluation order, or output that depends on
       whether stdout is a terminal. Where that is the point of the problem,
       the explanation says so. */
    grade(response, key) {
      const got = normOutput(response);
      const candidates = [key.output, ...(key.accept || [])].map(normOutput);

      if (candidates.some(w => w === got)) {
        return { correct: true, score: 1, feedback: 'Exactly right.' };
      }

      const want = candidates[0];
      const gotLines = got.split('\n');
      const wantLines = want.split('\n');

      /* The useful feedback for this type is which line went wrong, not that
         the whole thing is wrong. */
      let at = -1;
      for (let i = 0; i < Math.max(gotLines.length, wantLines.length); i += 1) {
        if (gotLines[i] !== wantLines[i]) { at = i; break; }
      }

      let why = 'Not what it prints.';
      if (gotLines.length !== wantLines.length) {
        why = `It prints ${wantLines.length} ${wantLines.length === 1 ? 'line' : 'lines'}, ` +
              `and you wrote ${gotLines.length}.`;
        if (at === 0) why += ' The first line is wrong too.';
      } else if (at >= 0) {
        why = `Line ${at + 1} is the first one that differs.`;
      }

      /* Right lines, wrong order, is a specific misunderstanding — usually of
         evaluation or buffering order — so it is named rather than lumped in. */
      if (gotLines.length === wantLines.length &&
          [...gotLines].sort().join('\n') === [...wantLines].sort().join('\n')) {
        why = 'Every line is right, but not in that order.';
      }

      return { correct: false, score: 0, feedback: why };
    },

    /* What they wrote, and nothing about what it really prints. */
    mark(mount) {
      const node = mount.querySelector('#predictAnswer');
      if (node) node.disabled = false;
      mount.querySelectorAll('.predict-reveal').forEach(n => n.remove());
    },

    reveal(mount, { key, response }) {
      const node = mount.querySelector('#predictAnswer');
      if (node) node.disabled = false;
      mount.querySelectorAll('.predict-reveal').forEach(n => n.remove());

      /* The answer side by side with what you wrote. Reading a diff out of the
         explanation is work the page should have done. */
      mount.append(el('div', { class: 'case predict-reveal', style: 'margin-top:.8rem' }, [
        el('div', { class: 'io' }, [
          el('div', {}, [
            el('h5', { text: 'you wrote' }),
            el('pre', { class: 'diff-bad', text: normOutput(response) || '(nothing)' }),
          ]),
          el('div', {}, [
            el('h5', { text: 'it prints' }),
            el('pre', { class: 'diff-ok', text: normOutput(key.output) || '(nothing)' }),
          ]),
        ]),
      ]));
    },
  });
})();
