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

  /* Put the reader's last selection back after a redraw. Without it the
     form comes back blank after every submission, which reads as though the
     attempt was thrown away. */
  function restoreOptions(mount, response) {
    const chosen = new Set([].concat(response == null ? [] : response).map(Number));
    mount.querySelectorAll('.opt input').forEach((input, i) => {
      input.checked = chosen.has(i);
    });
  }

  function collectOptions(mount, multiple) {
    const checked = [...mount.querySelectorAll('.opt input')]
      .map((n, i) => (n.checked ? i : -1))
      .filter(i => i >= 0);
    if (!checked.length) return null;
    return multiple ? checked : checked[0];
  }

  /* Everything, once the answer is legitimately visible: which were right,
     which were missed, and why each distractor is attractive. `right` is the
     set of correct indexes either way, so one function serves both graders. */
  function revealOptions(mount, picked, right, solution) {
    const chosen = new Set([].concat(picked == null ? [] : picked));
    const correct = new Set(right);
    const why = (solution && solution.distractors) || {};

    mount.querySelectorAll('.opt').forEach((node, i) => {
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

  /* After a wrong attempt. The reader learns that this pick was not it, and
     nothing else: no mark on the options they missed, no distractor notes,
     and the radios stay live so the next guess is one click away.

     For "select all", not even their own ticks are marked. Telling someone
     which three of their four ticks were right hands them the combination in
     two attempts, which is the thing a retry is supposed to make them earn. */
  function markOwnChoice(mount, picked, { perOption }) {
    const chosen = new Set([].concat(picked == null ? [] : picked));
    mount.querySelectorAll('.opt').forEach((node, i) => {
      delete node.dataset.mark;
      if (perOption && chosen.has(i)) node.dataset.mark = 'wrong';
    });
  }

  /* ---------------- authored feedback ----------------

     "Not that one." is true and useless. What helps is a sentence about the
     choice actually made — and the rule that makes it safe to show is that
     it may say why *this* is unsuitable and may never say what is right.

     The notes live in the solution file, beside the key. If they lived in the
     problem file and only the wrong options carried one, the option without a
     note would be the answer. */

  const fb = solution => (solution && solution.feedback) || {};

  /* The note for one picked option, if the author wrote one. */
  function noteFor(solution, i) {
    const o = fb(solution).options || {};
    const entry = o[String(i)];
    if (!entry) return null;
    return typeof entry === 'string' ? { why: entry } : entry;
  }

  /* The first authored misconception whose ticks are all present in the
     selection. Used by "select all", where saying anything per-option would
     hand over the combination. */
  function misconception(solution, picked) {
    const list = fb(solution).misconceptions || [];
    const chosen = new Set([...picked].map(Number));
    for (const m of list) {
      const want = (m.picked || []).map(Number);
      if (!want.length) continue;
      if (want.every(i => chosen.has(i))) return m.say || null;
    }
    return null;
  }

  /* Joins the sentences into one paragraph, dropping the empties. */
  const sentences = (...bits) => bits.filter(Boolean).join(' ');

  register('mcq', {
    render: (problem, mount, ctx) => renderOptions(problem, mount, ctx, false),
    collect: mount => collectOptions(mount, false),
    restore: restoreOptions,

    /* key: { answer: <index> } */
    grade(response, key, problem, solution) {
      const right = Number(key && key.answer);
      const correct = Number(response) === right;
      if (correct) return { correct: true, score: 1, feedback: 'Correct.' };

      /* Why this one is unsuitable, and one thing to go and think about.
         Neither sentence may name or hint at the right option — that is what
         the retry is for. */
      const note = noteFor(solution, Number(response));
      const nudge = fb(solution).reconsider || fb(solution).nudge || '';
      return {
        correct: false,
        score: 0,
        feedback: note
          ? sentences(note.why, note.reconsider || nudge)
          : sentences('Not that one.', nudge),
      };
    },

    /* One answer, so marking the pick they made as wrong gives away nothing
       they were not just told by the verdict. */
    mark: (mount, { response, result }) =>
      markOwnChoice(mount, response, { perOption: !(result && result.correct) }),

    reveal: (mount, { response, key, solution }) =>
      revealOptions(mount, response, [Number(key && key.answer)], solution),
  });

  register('multi', {
    render: (problem, mount, ctx) => renderOptions(problem, mount, ctx, true),
    collect: mount => collectOptions(mount, true),
    restore: restoreOptions,

    /* key: { answers: [<index>, …] }

       Scored by Jaccard overlap — the right ticks you made, over everything
       either of us ticked. A wrong tick therefore costs the same as a missed
       one, which is the honest reading of "select all that apply": claiming
       something false is as wrong as omitting something true. */
    grade(response, key, problem, solution) {
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

      /* Feedback is about the ticks they made, never about the ones they did
         not. "2 of 3 right" would say how many correct options exist, and
         with four options that is most of the way to the answer. */
      let feedback;
      if (correct) {
        feedback = 'All of them, and nothing else.';
      } else if (!picked.size) {
        feedback = 'Nothing ticked.';
      } else if (!hits) {
        feedback = picked.size === 1
          ? 'Not that one.'
          : `None of those ${picked.size}.`;
      } else {
        const bits = [`${hits} of your ${picked.size} ${picked.size === 1 ? 'tick is' : 'ticks are'} right`];
        if (missed) bits.push('and there is at least one you have not ticked');
        else if (wrong) bits.push(`but ${wrong === 1 ? 'one is' : wrong + ' are'} not`);
        feedback = bits.join(', ') + '.';
      }

      /* One authored sentence about the idea behind the selection, where the
         author recognised it, and a general nudge otherwise. Deliberately
         never per-option: with four options, telling someone which of their
         two ticks is the wrong one is telling them the answer. */
      if (!correct) {
        const extra = misconception(solution, picked) || fb(solution).nudge;
        if (extra) feedback = `${feedback} ${extra}`;
      }
      void total;

      return { correct, score, feedback };
    },

    mark: mount => markOwnChoice(mount, null, { perOption: false }),

    reveal: (mount, { response, key, solution }) =>
      revealOptions(mount, response, (key && key.answers || []).map(Number), solution),
  });
})();
