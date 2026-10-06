/* ============================================================
   types/maths.js — the answer formats mathematics needs.

     exact           a number, checked exactly. 3/8, 0.375 and
                     6/16 are one answer.
     approx          a number, checked to a stated tolerance,
                     and the statement says so.
     structured      a set or a union of intervals, compared as
                     the thing it is rather than as text.
     proofsteps      a proof with its justifications removed;
                     put each one back.
     counterexample  build one, field by field, and have the
                     parts that can be checked, checked.
     proof           write it out. Saved, never auto-marked,
                     and reviewed against a rubric by the only
                     person who can: you.

   ---------------- three rules ----------------

   A syntax error is not a wrong answer. "I cannot read that"
   and "that is not the right number" are different sentences
   and they go to different places; the first costs no attempt.

   Nothing is checked by sampling, and nothing is checked by
   comparing strings. js/maths/expr.js decides equality on
   exact values in Q(√d), and says so when an expression is
   outside what it can decide.

   Nothing claims to have verified a proof. A written proof is
   saved, compared against a rubric by the reader, and recorded
   as *Self-reviewed* — which is a different status from
   Solved and is never silently upgraded into it.
   ============================================================ */

(() => {
  const { el, register } = ProblemTypes;
  const E = MathsExpr;

  /* ---------------- shared answer field ---------------- */

  /* Every typed maths answer gets the same three things: a box, a line
     saying what may be typed into it, and a live preview of how the thing
     typed was understood. The preview is the part that matters — most
     "wrong" answers in a maths tool are the tool reading something other
     than what the person meant, and showing the reading makes that visible
     before they submit rather than after. */
  function answerField(mount, {
    id = 'mathsAnswer', label, syntax, placeholder, value = '', read = E.read, preview = true,
  }) {
    const box = el('input', {
      type: 'text', id, class: 'maths-input', autocomplete: 'off',
      spellcheck: 'false', value,
      placeholder: placeholder || '',
      'aria-describedby': `${id}-syntax ${id}-preview`,
    });

    const note = el('p', { class: 'tiny faint maths-syntax', id: `${id}-syntax` }, [syntax]);
    const shown = el('p', { class: 'maths-preview', id: `${id}-preview`, 'aria-live': 'polite' });

    const repaint = () => {
      const raw = box.value.trim();
      if (!raw) { shown.replaceChildren(); shown.dataset.state = 'empty'; return; }
      const r = read(raw);
      if (r.ok) {
        shown.dataset.state = 'ok';
        shown.replaceChildren(
          el('span', { class: 'tiny faint', text: 'read as ' }),
          el('span', { class: 'maths-read', text: describe(r) }),
        );
      } else {
        shown.dataset.state = r.kind === 'empty' ? 'empty' : 'bad';
        shown.replaceChildren(
          el('span', { class: 'tiny', text: r.kind === 'unsupported' ? 'not checkable: ' : 'cannot read that: ' }),
          el('span', { class: 'tiny', text: r.message }),
        );
      }
    };
    if (preview) box.addEventListener('input', repaint);

    mount.append(el('div', { class: 'maths-answer' }, [
      label ? el('label', { class: 'small', for: id, html: MD.renderInline(label) }) : null,
      box,
      note,
      preview ? shown : null,
    ]));
    if (preview) repaint();
    return box;
  }

  /* How a parsed answer is shown back. Sets and intervals describe
     themselves differently from a single number. */
  function describe(r) {
    if (r.members) {
      return r.members.length ? `{ ${r.members.map(m => m.toString()).join(', ')} }` : 'the empty set';
    }
    if (r.parts) {
      return r.parts.length
        ? r.parts.map(p => `${p.loClosed ? '[' : '('}${p.lo}, ${p.hi}${p.hiClosed ? ']' : ')'}`).join(' ∪ ')
        : 'the empty set';
    }
    return r.value.describe();
  }

  /* A failure that is not a wrong answer. The page shows these without
     recording an attempt, so a mistyped bracket never costs a first try. */
  const notAnAnswer = (r) => ({
    correct: false,
    score: 0,
    invalid: true,
    feedback: r.kind === 'unsupported'
      ? `That is a real expression, but this box cannot check it: ${r.message}`
      : r.kind === 'math'
        ? `That is not a number: ${r.message}`
        : `I could not read that answer: ${r.message}`,
  });

  /* Authored feedback, same contract as everywhere else on the site: it may
     say why what was given is unsuitable, never what the answer is. */
  const fb = solution => (solution && solution.feedback) || {};

  /* The first misconception rule whose trigger matches. Triggers are
     declarative — a value to compare against — because a rule written as
     code in a data file is a code-injection hole. */
  function misconception(solution, given, key) {
    for (const m of (fb(solution).whenValue || [])) {
      if (m.is !== undefined && E.sameValue(given, m.is)) return m.say;
      /* "they inverted the conditional", expressed as an expression the
         author writes out, so the rule is readable in the problem file. */
      if (m.isExpr !== undefined && E.sameValue(given, m.isExpr)) return m.say;
    }
    void key;
    return fb(solution).nudge || '';
  }

  const join = (...bits) => bits.filter(Boolean).join(' ');

  /* ---------------- exact ---------------- */

  register('exact', {
    /* payload: { prompt?, label?, placeholder?, syntax? } */
    render(problem, mount, ctx) {
      const pay = problem.payload || {};
      if (pay.prompt) mount.append(el('p', { class: 'prose', html: MD.render(pay.prompt) }));
      const box = answerField(mount, {
        label: pay.label || 'Your answer',
        syntax: pay.syntax
          || 'A number or a fraction. 3/8, 0.375 and 6/16 are all the same answer. '
            + 'You can write arithmetic: 1/2 + 1/6, C(5,2)/C(52,5), sqrt(2).',
        placeholder: pay.placeholder || 'e.g. 3/8',
      });
      box.disabled = !!ctx.locked;
    },
    collect(mount) {
      const v = (mount.querySelector('.maths-input') || {}).value || '';
      return v.trim() ? v : null;
    },
    restore(mount, response) {
      const box = mount.querySelector('.maths-input');
      if (box && response != null) box.value = String(response);
    },

    /* key: { value: "3/8", alsoAccept?: ["0.375"] } */
    grade(response, key, problem, solution) {
      const r = E.read(response);
      if (!r.ok) return notAnAnswer(r);

      const accept = [key.value, ...(key.alsoAccept || [])];
      if (accept.some(a => E.sameValue(response, a))) {
        return { correct: true, score: 1, feedback: 'Correct.' };
      }
      return {
        correct: false, score: 0,
        feedback: join(`${describe(r)} is not it.`, misconception(solution, response, key)),
      };
    },

    mark(mount, { result }) {
      const box = mount.querySelector('.maths-input');
      if (!box) return;
      delete box.dataset.mark;
      if (result && !result.correct && !result.invalid) box.dataset.mark = 'wrong';
    },
    reveal(mount, { key }) {
      const box = mount.querySelector('.maths-input');
      if (box && !box.parentElement.querySelector('.maths-truth')) {
        box.parentElement.append(el('p', { class: 'maths-truth small' }, [
          'The answer is ', el('code', { text: String(key.value) }), '.',
        ]));
      }
    },
  });

  /* ---------------- approx ---------------- */

  register('approx', {
    /* payload like exact; key: { value, tol } or { value, dp } */
    render(problem, mount, ctx) {
      const pay = problem.payload || {};
      if (pay.prompt) mount.append(el('p', { class: 'prose', html: MD.render(pay.prompt) }));
      const box = answerField(mount, {
        label: pay.label || 'Your answer',
        syntax: pay.syntax || 'A decimal. This one is checked to a stated tolerance, '
          + 'which the question gives — it is not an exact answer.',
        placeholder: pay.placeholder || 'e.g. 0.37',
      });
      box.disabled = !!ctx.locked;
    },
    collect(mount) {
      const v = (mount.querySelector('.maths-input') || {}).value || '';
      return v.trim() ? v : null;
    },
    restore(mount, response) {
      const box = mount.querySelector('.maths-input');
      if (box && response != null) box.value = String(response);
    },

    grade(response, key, problem, solution) {
      const r = E.read(response);
      if (!r.ok) return notAnAnswer(r);

      const want = E.read(String(key.value));
      if (!want.ok) {
        return { correct: false, score: 0, invalid: true, feedback: 'This problem\'s answer key is unreadable.' };
      }
      const tol = key.tol !== undefined
        ? Number(key.tol)
        : 0.5 * (10 ** -Number(key.dp === undefined ? 2 : key.dp));
      const got = r.value.toNumber();
      const target = want.value.toNumber();
      const off = Math.abs(got - target);

      if (off <= tol) return { correct: true, score: 1, feedback: 'Correct, within the stated tolerance.' };

      /* An answer that is right but rounded the wrong way is a different
         mistake from one that is wrong, and worth saying. */
      const near = off <= tol * 10;
      return {
        correct: false, score: 0,
        feedback: join(
          near
            ? `${got} is close but outside the tolerance of ±${tol}.`
            : `${got} is not within ±${tol} of the answer.`,
          misconception(solution, response, key),
        ),
      };
    },

    mark(mount, { result }) {
      const box = mount.querySelector('.maths-input');
      if (!box) return;
      delete box.dataset.mark;
      if (result && !result.correct && !result.invalid) box.dataset.mark = 'wrong';
    },
    reveal(mount, { key }) {
      const box = mount.querySelector('.maths-input');
      if (box && !box.parentElement.querySelector('.maths-truth')) {
        box.parentElement.append(el('p', { class: 'maths-truth small' }, [
          'The answer is ', el('code', { text: String(key.value) }), '.',
        ]));
      }
    },
  });

  /* ---------------- structured: sets and intervals ---------------- */

  const STRUCTURED = {
    set: {
      read: E.readSet,
      same: E.sameSet,
      syntax: 'A set, in braces: {1, 2, 3}. Order does not matter and repeats are ignored. '
        + 'The empty set is {} or ∅.',
      placeholder: 'e.g. {0, 1}',
    },
    intervals: {
      read: E.readIntervals,
      same: E.sameIntervals,
      syntax: 'An interval, or several joined by U. Round brackets exclude an end and square '
        + 'brackets include it: (0,1), [0,1], (0,1], [0,1). The empty set is {}.',
      placeholder: 'e.g. (0,1] U [2,3)',
    },
  };

  register('structured', {
    /* payload: { kind: 'set' | 'intervals', prompt?, label? } */
    render(problem, mount, ctx) {
      const pay = problem.payload || {};
      const spec = STRUCTURED[pay.kind] || STRUCTURED.set;
      if (pay.prompt) mount.append(el('p', { class: 'prose', html: MD.render(pay.prompt) }));
      const box = answerField(mount, {
        label: pay.label || 'Your answer',
        syntax: pay.syntax || spec.syntax,
        placeholder: pay.placeholder || spec.placeholder,
        read: spec.read,
      });
      box.disabled = !!ctx.locked;
    },
    collect(mount) {
      const v = (mount.querySelector('.maths-input') || {}).value || '';
      return v.trim() ? v : null;
    },
    restore(mount, response) {
      const box = mount.querySelector('.maths-input');
      if (box && response != null) box.value = String(response);
    },

    grade(response, key, problem, solution) {
      const spec = STRUCTURED[(problem.payload || {}).kind] || STRUCTURED.set;
      const r = spec.read(response);
      if (!r.ok) return notAnAnswer(r);

      const accept = [key.value, ...(key.alsoAccept || [])];
      if (accept.some(a => spec.same(response, a))) {
        return { correct: true, score: 1, feedback: 'Correct.' };
      }
      return {
        correct: false, score: 0,
        feedback: join(`${describe(r)} is not it.`, misconception(solution, response, key)),
      };
    },

    mark(mount, { result }) {
      const box = mount.querySelector('.maths-input');
      if (!box) return;
      delete box.dataset.mark;
      if (result && !result.correct && !result.invalid) box.dataset.mark = 'wrong';
    },
    reveal(mount, { key }) {
      const box = mount.querySelector('.maths-input');
      if (box && !box.parentElement.querySelector('.maths-truth')) {
        box.parentElement.append(el('p', { class: 'maths-truth small' }, [
          'The answer is ', el('code', { text: String(key.value) }), '.',
        ]));
      }
    },
  });

  /* ---------------- proofsteps ----------------

     A proof with its justifications taken out. The reader puts each one
     back from a shared list, which is harder than it sounds and much
     closer to what reading a proof actually involves than ordering lines
     is: the lines are already in order, and the question is why each one
     follows. */

  register('proofsteps', {
    /* payload: { claim, steps: [{ text, blank?: true }], choices: [ … ] } */
    render(problem, mount, ctx) {
      const pay = problem.payload || {};
      if (pay.claim) {
        mount.append(el('div', { class: 'proof-claim prose', html: MD.render(pay.claim) }));
      }

      const list = el('ol', { class: 'proof-steps' });
      (pay.steps || []).forEach((step, i) => {
        const row = el('li', { class: 'proof-step', 'data-step': i });
        row.append(el('div', { class: 'proof-text prose', html: MD.render(step.text || '') }));
        if (step.blank) {
          const sel = el('select', {
            class: 'proof-why', 'data-step': i,
            'aria-label': `Why does step ${i + 1} follow?`,
            disabled: ctx.locked || undefined,
          });
          sel.append(el('option', { value: '', text: 'why does this follow?' }));
          (pay.choices || []).forEach((c, j) => {
            sel.append(el('option', { value: String(j), html: undefined, text: MathsRender.plain(c) }));
          });
          row.append(sel);
        }
        list.append(row);
      });
      mount.append(list);
      mount.append(el('p', { class: 'tiny faint' }, [
        'Every line is already in the right order. The question is why each one follows.',
      ]));
    },

    collect(mount) {
      const picks = [...mount.querySelectorAll('.proof-why')].map(s => (s.value === '' ? null : Number(s.value)));
      return picks.every(p => p === null) ? null : picks;
    },
    restore(mount, response) {
      if (!Array.isArray(response)) return;
      [...mount.querySelectorAll('.proof-why')].forEach((s, i) => {
        s.value = response[i] == null ? '' : String(response[i]);
      });
    },

    /* key: { answers: [j, …] } in the order the blanks appear. */
    grade(response, key) {
      const want = key.answers || [];
      const got = Array.isArray(response) ? response : [];
      if (got.length !== want.length) {
        return { correct: false, score: 0, invalid: true, feedback: 'Not every step has an answer yet.' };
      }
      const unfilled = got.filter(g => g === null).length;
      if (unfilled) {
        return {
          correct: false, score: 0, invalid: true,
          feedback: `${unfilled} ${unfilled === 1 ? 'step is' : 'steps are'} still blank.`,
        };
      }
      const hits = got.filter((g, i) => g === want[i]).length;
      const correct = hits === want.length;
      return {
        correct,
        score: want.length ? hits / want.length : 0,
        feedback: correct
          ? 'Every step justified.'
          : `${hits} of ${want.length} steps are justified correctly. `
            + 'Work down from the top: the first one that is wrong is usually the only real mistake.',
      };
    },

    /* Which steps are wrong, never which answer was wanted. */
    mark(mount, { response, key, result }) {
      const want = (key && key.answers) || [];
      [...mount.querySelectorAll('.proof-step')].forEach(n => delete n.dataset.mark);
      if (!result || result.correct || result.invalid) return;
      [...mount.querySelectorAll('.proof-why')].forEach((sel, i) => {
        const row = sel.closest('.proof-step');
        if (!row) return;
        const given = response && response[i];
        if (given != null && given !== want[i]) row.dataset.mark = 'wrong';
      });
    },
    reveal(mount, { key }) {
      const want = (key && key.answers) || [];
      [...mount.querySelectorAll('.proof-why')].forEach((sel, i) => {
        const row = sel.closest('.proof-step');
        if (row) row.dataset.mark = 'right';
        sel.value = String(want[i]);
      });
    },
  });

  /* ---------------- counterexample ----------------

     Building one, field by field, with the parts that can be checked,
     checked — and the parts that cannot, not pretended about.

     The validators are named in the problem file and implemented here. A
     rule written as code *in* a data file would be an injection hole, and
     a rule written as a regular expression would be a string comparison
     wearing a disguise. */

  const VALIDATORS = {
    /* Each takes the parsed field values and the key, and returns
       { ok, why } — `why` being what to say when it does not hold. */

    /* d(x,y) for a proposed metric, at specific points, where the author
       has worked out what the value must be. */
    valuesMatch(vals, spec) {
      for (const want of spec.values || []) {
        const got = vals[want.field];
        if (!got) continue;
        if (!E.sameValue(got.text, want.is)) {
          return { ok: false, why: `${want.label || want.field} does not come out as it should here.` };
        }
      }
      return { ok: true };
    },

    /* A pair of sets, or numbers, that must differ. "Give two different
       points with distance zero" has to check they are different. */
    allDifferent(vals, spec) {
      const fields = (spec.fields || []).map(f => vals[f]).filter(Boolean);
      for (let i = 0; i < fields.length; i += 1) {
        for (let j = i + 1; j < fields.length; j += 1) {
          if (E.sameValue(fields[i].text, fields[j].text)) {
            return { ok: false, why: 'Those are the same, and the point of the example is that they differ.' };
          }
        }
      }
      return { ok: true };
    },

    /* A value has to sit inside a stated range. */
    inRange(vals, spec) {
      for (const r of spec.ranges || []) {
        const got = vals[r.field];
        if (!got) continue;
        const x = got.value.toNumber();
        const lo = E.read(String(r.min)).value.toNumber();
        const hi = E.read(String(r.max)).value.toNumber();
        if (x < lo || x > hi) {
          return { ok: false, why: `${r.label || r.field} has to be between ${r.min} and ${r.max}.` };
        }
      }
      return { ok: true };
    },
  };

  register('counterexample', {
    /* payload: { claim, fields: [{ id, label, syntax, placeholder }],
                  guidance?, selfReview?: [ … ] } */
    render(problem, mount, ctx) {
      const pay = problem.payload || {};
      mount.append(el('div', { class: 'cx-claim prose' }, [
        el('p', { class: 'tiny faint', text: 'Find a counterexample to this claim:' }),
        el('div', { html: MD.render(pay.claim || '') }),
      ]));
      if (pay.guidance) {
        mount.append(el('div', { class: 'prose small', html: MD.render(pay.guidance) }));
      }

      for (const f of (pay.fields || [])) {
        const box = answerField(mount, {
          id: `cx-${f.id}`,
          label: f.label,
          syntax: f.syntax || 'A number or a fraction.',
          placeholder: f.placeholder || '',
        });
        box.dataset.field = f.id;
        box.disabled = !!ctx.locked;
      }
    },

    collect(mount) {
      const out = {};
      let any = false;
      for (const box of mount.querySelectorAll('.maths-input')) {
        const v = box.value.trim();
        if (v) any = true;
        out[box.dataset.field] = v;
      }
      return any ? out : null;
    },
    restore(mount, response) {
      if (!response || typeof response !== 'object') return;
      for (const box of mount.querySelectorAll('.maths-input')) {
        if (response[box.dataset.field] != null) box.value = response[box.dataset.field];
      }
    },

    /* key: { checks: [{ validator, … }], blanks?: [...] } */
    grade(response, key, problem) {
      const pay = problem.payload || {};
      const vals = {};
      for (const f of (pay.fields || [])) {
        const raw = (response || {})[f.id];
        if (!raw || !String(raw).trim()) {
          return {
            correct: false, score: 0, invalid: true,
            feedback: `${f.label || f.id} is still empty.`,
          };
        }
        const r = E.read(raw);
        if (!r.ok) {
          const bad = notAnAnswer(r);
          return { ...bad, feedback: `${f.label || f.id}: ${bad.feedback}` };
        }
        vals[f.id] = { text: String(raw), value: r.value };
      }

      for (const spec of (key.checks || [])) {
        const fn = VALIDATORS[spec.validator];
        if (!fn) {
          return {
            correct: false, score: 0, invalid: true,
            feedback: `This problem names a check ("${spec.validator}") that does not exist.`,
          };
        }
        const verdict = fn(vals, spec);
        if (!verdict.ok) {
          return { correct: false, score: 0, feedback: verdict.why };
        }
      }

      return {
        correct: true, score: 1,
        feedback: 'That is a counterexample: every condition the claim needs is met, and the claim fails.',
      };
    },

    mark(mount, { result }) {
      for (const box of mount.querySelectorAll('.maths-input')) {
        delete box.dataset.mark;
        if (result && !result.correct && !result.invalid) box.dataset.mark = 'wrong';
      }
    },
  });

  /* ---------------- proof ----------------

     Written out, saved, and never marked by a machine.

     The brief for this one is a refusal as much as a feature: there is no
     automatic certification of a written proof, no AI marker, and no
     pretending that a keyword search is a reading. What there is: a place
     to write, a draft that survives, an explicit reveal of a model proof,
     a rubric to compare against, and a status of its own. */

  register('proof', {
    /* payload: { prompt?, rubric: [ … ], starter? } */
    render(problem, mount, ctx) {
      const pay = problem.payload || {};
      const saved = Store.draft(problem.id, 'proof');

      mount.append(el('p', { class: 'tiny faint' }, [
        'Write it out. Nothing here marks a proof automatically — you will compare '
        + 'it against a rubric and a model proof yourself, and the record will say '
        + 'Self-reviewed rather than Solved.',
      ]));

      const box = el('textarea', {
        class: 'proof-box', id: 'proofBox', rows: '14',
        spellcheck: 'true',
        placeholder: pay.starter || 'Let ε > 0. …',
        'aria-label': 'Your proof',
      });
      box.value = saved || '';
      box.disabled = !!ctx.locked;

      const note = el('span', { class: 'tiny faint', id: 'proofSaved' });
      let timer = null;
      box.addEventListener('input', () => {
        Store.saveDraft(problem, 'proof', box.value);
        note.textContent = 'Saving…';
        clearTimeout(timer);
        timer = setTimeout(() => { note.textContent = 'Saved'; }, 400);
      });

      mount.append(box);
      mount.append(el('div', { class: 'row', style: 'justify-content:space-between' }, [
        el('span', { class: 'tiny faint', text: 'Markdown and $maths$ both work here.' }),
        note,
      ]));
    },

    /* Submitting a proof means "I have written one and want to review it",
       so an empty box is the only thing that stops it. */
    collect(mount) {
      const box = mount.querySelector('.proof-box');
      const v = box ? box.value.trim() : '';
      return v ? v : null;
    },
    restore(mount, response) {
      const box = mount.querySelector('.proof-box');
      if (box && response != null && !box.value) box.value = String(response);
    },
    emptyMessage: () => 'Write something before reviewing it — even a first line.',

    /* Never "correct". The result is an invitation to review, and the page
       turns it into the Self-reviewed status rather than into a mark. */
    grade(response) {
      const words = String(response).trim().split(/\s+/).length;
      return {
        correct: false,
        score: 0,
        selfReview: true,
        words,
        feedback: `Saved — ${words} ${words === 1 ? 'word' : 'words'}. `
          + 'Nothing has judged this. Open the rubric below, read your proof against '
          + 'each line of it, and then reveal the model proof and compare.',
      };
    },

    mark() { /* there is nothing to mark */ },
  });
})();
