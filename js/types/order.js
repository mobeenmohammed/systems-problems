/* ============================================================
   types/order.js — "order": put the steps in the right sequence.

   The items arrive in the order the problem file lists them,
   which is the scrambled order you are meant to see. The key is
   the correct permutation of those original indexes, so the
   scramble is authored rather than random — a random one would
   make a solution file unable to refer to "the third item".

   Every item can be moved by dragging, and also by the small
   up/down buttons on it. The buttons are not a fallback nobody
   uses: they are the only way this works from a keyboard, and
   they are how the jsdom test drives it.
   ============================================================ */

(() => {
  const { el, register, sameArray } = ProblemTypes;

  function reindex(list) {
    [...list.querySelectorAll('.order-item')].forEach((node, i) => {
      node.querySelector('.n').textContent = String(i + 1);
    });
  }

  function move(list, node, delta) {
    const items = [...list.querySelectorAll('.order-item')];
    const at = items.indexOf(node);
    const to = at + delta;
    if (to < 0 || to >= items.length) return;
    if (delta < 0) list.insertBefore(node, items[to]);
    else list.insertBefore(items[to], node);
    reindex(list);
  }

  register('order', {
    /* payload: { items: ["markdown", …], prompt?: "…", labels?: ["first","last"] } */
    render(problem, mount, ctx) {
      const p = problem.payload || {};
      const items = p.items || [];

      mount.append(el('p', { class: 'muted small' }, [
        p.prompt || 'Put these in order, first at the top.',
      ]));

      const list = el('div', { class: 'order-list', id: 'orderList' });

      items.forEach((text, i) => {
        const node = el('div', {
          class: 'order-item', 'data-i': i,
          draggable: ctx.locked ? undefined : 'true',
        }, [
          el('span', { class: 'n', text: String(i + 1) }),
          el('div', { html: MD.renderInline(text) }),
          ctx.locked ? null : el('div', { class: 'moves' }, [
            el('button', {
              type: 'button', 'aria-label': `Move "${String(text).slice(0, 40)}" up`,
              onclick: e => { e.preventDefault(); move(list, node, -1); },
            }, ['▲']),
            el('button', {
              type: 'button', 'aria-label': `Move "${String(text).slice(0, 40)}" down`,
              onclick: e => { e.preventDefault(); move(list, node, 1); },
            }, ['▼']),
          ]),
        ]);

        if (!ctx.locked) {
          node.addEventListener('dragstart', e => {
            node.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            /* Firefox ignores a drag with no payload set. */
            e.dataTransfer.setData('text/plain', String(i));
          });
          node.addEventListener('dragend', () => {
            node.classList.remove('dragging');
            list.querySelectorAll('.over').forEach(n => n.classList.remove('over'));
            reindex(list);
          });
          node.addEventListener('dragover', e => {
            e.preventDefault();
            const dragging = list.querySelector('.dragging');
            if (!dragging || dragging === node) return;
            node.classList.add('over');
            /* Insert before or after depending on which half you are over, so
               dropping on the last item can reach the last position. */
            const box = node.getBoundingClientRect();
            const after = (e.clientY - box.top) > box.height / 2;
            list.insertBefore(dragging, after ? node.nextSibling : node);
          });
          node.addEventListener('dragleave', () => node.classList.remove('over'));
          node.addEventListener('drop', e => { e.preventDefault(); reindex(list); });
        }

        list.append(node);
      });

      mount.append(list);

      if (p.labels && p.labels.length === 2) {
        mount.append(el('div', { class: 'row tiny faint', style: 'justify-content:space-between;margin-top:.4rem' }, [
          el('span', { text: `↑ ${p.labels[0]}` }),
          el('span', { text: `${p.labels[1]} ↓` }),
        ]));
      }
    },

    /* The DOM order of the original indexes. Always an answer — an untouched
       list is still a claim about the order, just usually a wrong one. */
    collect(mount) {
      const nodes = [...mount.querySelectorAll('.order-item')];
      if (!nodes.length) return null;
      return nodes.map(n => Number(n.dataset.i));
    },

    /* key: { order: [2, 0, 4, 1, 3] }

       Scored on how many items sit in their correct position, which is the
       figure a learner can act on: "four of six in the right place" tells you
       the shape is nearly right, where a bare "wrong" does not. Being correct
       still means exactly right. */
    grade(response, key) {
      const want = (key && key.order || []).map(Number);
      const got  = [].concat(response || []).map(Number);

      if (!want.length || got.length !== want.length) {
        return { correct: false, score: 0, feedback: 'That is not a complete ordering.' };
      }

      if (sameArray(got, want)) {
        return { correct: true, score: 1, feedback: `All ${want.length} in the right order.` };
      }

      let placed = 0;
      for (let i = 0; i < want.length; i += 1) if (got[i] === want[i]) placed += 1;

      /* Exactly reversed is a specific and common misreading — usually of
         which end the question called "first" — so it is named. */
      if (sameArray(got, [...want].reverse())) {
        return { correct: false, score: 0, feedback: 'That is the right sequence, exactly backwards.' };
      }

      return {
        correct: false,
        score: placed / want.length,
        feedback: `${placed} of ${want.length} in the right place.`,
      };
    },

    mark(mount, { key }) {
      const want = (key && key.order || []).map(Number);
      const nodes = [...mount.querySelectorAll('.order-item')];

      nodes.forEach((node, i) => {
        node.draggable = false;
        node.querySelectorAll('.moves button').forEach(b => { b.disabled = true; });
        node.dataset.mark = Number(node.dataset.i) === want[i] ? 'right' : 'wrong';
      });

      /* Showing the right order beside a wrong attempt is the whole lesson;
         leaving them to work it out from the explanation alone is stingy. */
      const items = mount.querySelector('.order-list');
      if (items && nodes.some(n => n.dataset.mark === 'wrong')) {
        const payloadItems = [...nodes]
          .sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i))
          .map(n => n.children[1].innerHTML);
        mount.append(el('div', { class: 'hint', style: 'margin-top:.8rem' }, [
          el('span', { class: 'hn', text: 'The right order' }),
          el('ol', { style: 'margin:.2rem 0 0;padding-left:1.3rem' },
            want.map(idx => el('li', { html: payloadItems[idx] }))),
        ]));
      }
    },
  });
})();
