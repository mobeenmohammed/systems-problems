/* ============================================================
   types/mcq.js — "mcq" (one right answer) and "multi" (several,
   with partial credit).

   Both live here because they are the same widget with a
   different input type and a different grader, and splitting
   them would mean keeping two copies of the option rendering in
   step.

   Options are rendered in the order the problem file gives them.
   They are deliberately NOT shuffled: a stable order is what
   lets a solution file explain "option 3 is the common
   misreading" and still make sense.
   ============================================================ */

(() => {
  const { el, register } = ProblemTypes;

  /* payload: { options: ["markdown", …], prompt?: "…" } */
  function renderOptions(problem, mount, ctx, multiple) {
    const opts = (problem.payload && problem.payload.options) || [];
    const name = `opt-${problem.id}`;

    if (problem.payload && problem.payload.prompt) {
      mount.append(el('p', { class: 'muted small', html: MD.renderInline(problem.payload.prompt) }));
    }

    const list = el('div', { class: 'opts', role: multiple ? 'group' : 'radiogroup' });
    opts.forEach((text, i) => {
      const input = el('input', {
        type: multiple ? 'checkbox' : 'radio',
        name, value: String(i),
        disabled: ctx.locked || undefined,
      });
      list.append(el('label', { class: 'opt', 'data-i': i }, [
        input,
        el('div', { class: 'opt-body', html: MD.render(text) }),
      ]));
    });
    mount.append(list);

    if (multiple) {
      mount.append(el('p', { class: 'tiny faint', style: 'margin:.5rem 0 0' },
        ['More than one may be right. Partial credit, but a wrong tick costs as much as a missed one.']));
    }
  }

  function collectOptions(mount, multiple) {
    const checked = [...mount.querySelectorAll('.opt input')]
      .map((n, i) => (n.checked ? i : -1))
      .filter(i => i >= 0);
    if (!checked.length) return null;
    return multiple ? checked : checked[0];
  }

  /* Painting the outcome. `right` is the set of correct indexes either way, so
     one function serves both graders. */
  function markOptions(mount, picked, right, solution) {
    const chosen = new Set([].concat(picked == null ? [] : picked));
    const correct = new Set(right);
    const why = (solution && solution.distractors) || {};

    mount.querySelectorAll('.opt').forEach((node, i) => {
      node.querySelectorAll('input').forEach(n => { n.disabled = true; });
      if (correct.has(i) && chosen.has(i))       node.dataset.mark = 'right';
      else if (chosen.has(i))                    node.dataset.mark = 'wrong';
      else if (correct.has(i))                   node.dataset.mark = 'missed';

      /* Why a wrong option is wrong is the part worth reading, so it is shown
         against the option itself rather than buried in the explanation. */
      const note = why[String(i)];
      if (note && (chosen.has(i) || correct.has(i))) {
        node.querySelector('.opt-body')
          .append(el('div', { class: 'why', html: MD.render(note) }));
      }
    });
  }

  register('mcq', {
    render: (problem, mount, ctx) => renderOptions(problem, mount, ctx, false),
    collect: mount => collectOptions(mount, false),

    /* key: { answer: <index> } */
    grade(response, key) {
      const right = Number(key && key.answer);
      const correct = Number(response) === right;
      return {
        correct,
        score: correct ? 1 : 0,
        feedback: correct ? 'Correct.' : 'Not that one.',
      };
    },

    mark: (mount, { response, key, solution }) =>
      markOptions(mount, response, [Number(key && key.answer)], solution),
  });

  register('multi', {
    render: (problem, mount, ctx) => renderOptions(problem, mount, ctx, true),
    collect: mount => collectOptions(mount, true),

    /* key: { answers: [<index>, …] }

       Scored by Jaccard overlap — the right ticks you made, over everything
       either of us ticked. A wrong tick therefore costs the same as a missed
       one, which is the honest reading of "select all that apply": claiming
       something false is as wrong as omitting something true. */
    grade(response, key, problem) {
      const right = new Set((key && key.answers || []).map(Number));
      const picked = new Set([].concat(response || []).map(Number));
      const total = (problem.payload && problem.payload.options || []).length;

      let hits = 0;
      for (const i of picked) if (right.has(i)) hits += 1;
      const union = new Set([...right, ...picked]).size;
      const score = union ? hits / union : 0;
      const correct = score === 1;

      const missed = [...right].filter(i => !picked.has(i)).length;
      const wrong  = [...picked].filter(i => !right.has(i)).length;

      let feedback;
      if (correct) feedback = `All ${right.size} of them, and nothing else.`;
      else if (!hits) feedback = 'None of those.';
      else {
        const bits = [`${hits} of ${right.size} right`];
        if (wrong)  bits.push(`${wrong} that ${wrong === 1 ? 'is' : 'are'} not`);
        if (missed) bits.push(`${missed} missed`);
        feedback = bits.join(', ') + `. Out of ${total} options.`;
      }

      return { correct, score, feedback };
    },

    mark: (mount, { response, key, solution }) =>
      markOptions(mount, response, (key && key.answers || []).map(Number), solution),
  });
})();
