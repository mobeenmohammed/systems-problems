/* ============================================================
   types/match.js — "match": pair the two columns.

   Click an item on the left, then its partner on the right. The
   pairing is shown as a number on both halves rather than as a
   drawn line: lines between two scrolling columns need SVG that
   re-measures on every resize, and a number says the same thing
   and survives a narrow screen, where the two columns stack.

   Every left item takes exactly one right item. The right column
   may be longer than the left — spare options are distractors,
   and they are what stop the last pair being free.
   ============================================================ */

(() => {
  const { el, register } = ProblemTypes;

  /* leftIndex -> rightIndex, for the problem on screen. */
  let pairs = {};
  let picked = null;

  function repaint(mount) {
    const used = new Set(Object.values(pairs));

    mount.querySelectorAll('.match-item[data-side="left"]').forEach(node => {
      const i = Number(node.dataset.i);
      const to = pairs[i];
      node.setAttribute('aria-pressed', String(picked === i));
      const tag = node.querySelector('.tagn');
      if (to === undefined) {
        node.removeAttribute('data-paired');
        tag.textContent = '';
      } else {
        node.dataset.paired = String(to);
        /* The pair number is the left item's position, so the two halves of a
           pair carry the same figure and reading across is possible. */
        tag.textContent = `${i + 1}`;
      }
    });

    mount.querySelectorAll('.match-item[data-side="right"]').forEach(node => {
      const j = Number(node.dataset.i);
      const owner = Object.keys(pairs).find(k => pairs[k] === j);
      const tag = node.querySelector('.tagn');
      if (owner === undefined) {
        node.removeAttribute('data-paired');
        tag.textContent = '';
      } else {
        node.dataset.paired = owner;
        tag.textContent = `${Number(owner) + 1}`;
      }
      node.setAttribute('aria-pressed', 'false');
      node.classList.toggle('available', !used.has(j));
    });

    const left = mount.querySelectorAll('.match-item[data-side="left"]').length;
    const done = Object.keys(pairs).length;
    const status = mount.querySelector('.match-status');
    if (status) {
      status.textContent = done === left
        ? 'All paired. Submit when you are happy.'
        : picked !== null
          ? 'Now pick its partner on the right.'
          : `${done} of ${left} paired — pick one on the left.`;
    }
  }

  register('match', {
    /* payload: { left: [...], right: [...], leftLabel?, rightLabel?, prompt? } */
    render(problem, mount, ctx) {
      const p = problem.payload || {};
      pairs = {};
      picked = null;

      mount.append(el('p', { class: 'muted small' }, [
        p.prompt || 'Click an item on the left, then the one on the right that goes with it. Clicking a left item again clears its pair.',
      ]));

      const leftCol = el('div', { class: 'match-col' }, [
        el('h4', { text: p.leftLabel || 'These' }),
      ]);
      const rightCol = el('div', { class: 'match-col' }, [
        el('h4', { text: p.rightLabel || 'Go with these' }),
      ]);

      (p.left || []).forEach((text, i) => {
        leftCol.append(el('button', {
          class: 'match-item', type: 'button', 'data-side': 'left', 'data-i': i,
          'aria-pressed': 'false', disabled: ctx.locked || undefined,
          onclick: () => {
            if (pairs[i] !== undefined) { delete pairs[i]; picked = null; }
            else picked = picked === i ? null : i;
            repaint(mount);
          },
        }, [el('span', { html: MD.renderInline(text) }), el('span', { class: 'tagn' })]));
      });

      (p.right || []).forEach((text, j) => {
        rightCol.append(el('button', {
          class: 'match-item', type: 'button', 'data-side': 'right', 'data-i': j,
          'aria-pressed': 'false', disabled: ctx.locked || undefined,
          onclick: () => {
            if (picked === null) return;
            /* One right item can only serve one left item, so taking it from
               whoever had it is the only sensible reading of the click. */
            for (const k of Object.keys(pairs)) if (pairs[k] === j) delete pairs[k];
            pairs[picked] = j;
            picked = null;
            repaint(mount);
          },
        }, [el('span', { html: MD.renderInline(text) }), el('span', { class: 'tagn' })]));
      });

      mount.append(el('div', { class: 'match-wrap' }, [leftCol, rightCol]));
      mount.append(el('p', { class: 'match-status tiny faint', style: 'margin-top:.5rem' }));
      repaint(mount);
    },

    /* An answer only once every left item has a partner. A half-finished
       pairing graded as wrong would cost the first-try bonus for stopping to
       think. */
    collect(mount, problem) {
      const left = (problem.payload.left || []).length;
      if (Object.keys(pairs).length < left) return null;
      return Array.from({ length: left }, (_, i) => pairs[i]);
    },

    /* key: { pairs: [2, 0, 1, …] } — the right index for each left item.

       Scored on how many pairs are right, because "four of six" tells you the
       shape is nearly there where a bare "wrong" does not. */
    grade(response, key, problem) {
      const want = (key && key.pairs || []).map(Number);
      const got = [].concat(response || []).map(Number);

      if (got.length !== want.length) {
        return { correct: false, score: 0, feedback: 'Not every item is paired.' };
      }

      let right = 0;
      for (let i = 0; i < want.length; i += 1) if (got[i] === want[i]) right += 1;

      if (right === want.length) {
        return { correct: true, score: 1, feedback: `All ${want.length} pairs right.` };
      }
      return {
        correct: false,
        score: right / want.length,
        feedback: `${right} of ${want.length} pairs right.`,
      };
    },

    /* Nothing per-pair: marking which rows were right would give the
       remaining pairs away by elimination. The controls stay live. */
    mark(mount) {
      mount.querySelectorAll('.match-item').forEach(n => {
        n.disabled = false;
        delete n.dataset.mark;
      });
      mount.querySelectorAll('.match-item .why').forEach(n => n.remove());
    },

    reveal(mount, { response, key, problem }) {
      const want = (key && key.pairs || []).map(Number);
      const got = [].concat(response || []).map(Number);
      const rightText = problem.payload.right || [];

      mount.querySelectorAll('.match-item').forEach(n => { n.disabled = true; });

      mount.querySelectorAll('.match-item[data-side="left"]').forEach(node => {
        const i = Number(node.dataset.i);
        const okPair = got[i] === want[i];
        node.dataset.mark = okPair ? 'right' : 'wrong';
        if (!okPair) {
          /* Showing the right partner beside a wrong pair is the lesson;
             leaving it to the explanation alone is stingy. */
          node.append(el('div', { class: 'why', html: `→ ${MD.renderInline(rightText[want[i]] || '')}` }));
        }
      });

      mount.querySelectorAll('.match-item[data-side="right"]').forEach(node => {
        const j = Number(node.dataset.i);
        const correctOwner = want.indexOf(j);
        if (correctOwner >= 0) node.dataset.mark = got[correctOwner] === j ? 'right' : 'wrong';
      });
    },
  });
})();
