/* ============================================================
   types/locate.js — "locate": click the line with the bug.

   Reading code for a defect is most of what a systems developer
   actually does, and it is a different skill from writing code.
   A data race, a lock taken in the wrong order, a missing fence,
   a retry with no idempotency key — none of these are visible in
   the output, and none of them can be found by running the thing
   once.

   One line is the answer. Where a bug is really spread over two
   lines, the key names the line where the *decision* was made,
   and `alsoAccept` covers the other defensible answer.
   ============================================================ */

(() => {
  const { el, register } = ProblemTypes;

  let chosen = null;

  register('locate', {
    /* payload: { code: "…", lang?: "cpp", prompt?: "…", startLine?: 1 } */
    render(problem, mount, ctx) {
      const p = problem.payload || {};
      chosen = null;

      mount.append(el('p', { class: 'muted small' }, [
        p.prompt || 'Click the line where the bug is.',
      ]));

      const lines = String(p.code || '').replace(/\n$/, '').split('\n');
      const first = Number(p.startLine) || 1;
      const listing = el('div', { class: 'locate-code', role: 'radiogroup', 'aria-label': 'Choose the line with the bug' });

      lines.forEach((text, i) => {
        const n = first + i;
        /* Highlighted per line rather than as one block: each line is its own
           clickable row, so the markup cannot be one <pre>. */
        const escaped = MD.escapeHtml(text);
        const body = p.lang ? Highlight.run(escaped, p.lang) : escaped;

        listing.append(el('div', {
          class: 'locate-line', role: 'radio', tabindex: '0',
          'data-line': n, 'aria-pressed': 'false', 'aria-checked': 'false',
          'aria-label': `Line ${n}: ${text.trim() || '(blank)'}`,
          onclick: () => { if (!ctx.locked) select(mount, n); },
          onkeydown: e => {
            if (ctx.locked) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(mount, n); }
          },
        }, [
          el('span', { class: 'ln', text: String(n) }),
          el('span', { class: 'lc', html: body || ' ' }),
        ]));
      });

      mount.append(listing);
      mount.append(el('p', { class: 'locate-status tiny faint', style: 'margin-top:.5rem', text: 'No line chosen yet.' }));
    },

    collect() {
      return chosen === null ? null : chosen;
    },

    /* key: { line: 14, alsoAccept?: [15], why?: "…" } */
    grade(response, key) {
      const want = Number(key.line);
      const also = (key.alsoAccept || []).map(Number);
      const got = Number(response);

      if (got === want || also.includes(got)) {
        return { correct: true, score: 1, feedback: 'That is the one.' };
      }

      /* Being one line out usually means you found the right *statement* and
         clicked its brace or its continuation, which is a different thing from
         not having found it. */
      const near = Math.abs(got - want) === 1;
      return {
        correct: false,
        score: 0,
        feedback: near
          ? 'Close — you are one line away. Look at the statement next to it.'
          : 'Not that line.',
      };
    },

    /* The line they clicked, marked wrong. Not the line the bug is on, and
       not key.why, which names it. */
    mark(mount, { response, result }) {
      const got = Number(response);
      mount.querySelectorAll('.locate-line').forEach(node => {
        delete node.dataset.mark;
        if (Number(node.dataset.line) === got && !(result && result.correct)) {
          node.dataset.mark = 'wrong';
        }
      });
      const status = mount.querySelector('.locate-status');
      if (status) {
        status.textContent = (result && result.correct)
          ? `Line ${got}.`
          : `Not line ${got}. Look again.`;
      }
    },

    reveal(mount, { response, key }) {
      const want = Number(key.line);
      const also = (key.alsoAccept || []).map(Number);
      const got = Number(response);

      mount.querySelectorAll('.locate-line').forEach(node => {
        const n = Number(node.dataset.line);
        node.removeAttribute('tabindex');
        if (n === want || also.includes(n)) node.dataset.mark = 'right';
        else if (n === got) node.dataset.mark = 'wrong';
      });

      const status = mount.querySelector('.locate-status');
      if (status) {
        status.textContent = got === want || also.includes(got)
          ? `Line ${got}. ${key.why || ''}`.trim()
          : `You chose line ${got}. The bug is on line ${want}. ${key.why || ''}`.trim();
      }
    },
  });

  function select(mount, n) {
    chosen = n;
    mount.querySelectorAll('.locate-line').forEach(node => {
      const on = Number(node.dataset.line) === n;
      node.setAttribute('aria-pressed', String(on));
      node.setAttribute('aria-checked', String(on));
    });
    const status = mount.querySelector('.locate-status');
    if (status) status.textContent = `Line ${n} chosen.`;
  }
})();
