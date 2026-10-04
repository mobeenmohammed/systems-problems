/* ============================================================
   problem.js — one problem: its tabs, its answer widget, and
   what happens when you submit.

   The tabs read left to right in the order you actually need
   them: the problem, what it rests on, a nudge, your own notes,
   and only then the answer.

   The Solution tab is locked until you have either solved the
   problem or deliberately revealed it, and revealing is confirmed
   and scores zero. That is not punishment — it is the difference
   between a record that says you can do this and one that says
   you have seen it done, which is the same distinction the
   Learning Tree draws with `independence`.
   ============================================================ */

const ProblemView = (() => {

  const { el } = ProblemTypes;

  const TABS = [
    { id: 'problem', label: 'Problem' },
    { id: 'prereq',  label: 'Prerequisites' },
    { id: 'hints',   label: 'Hints' },
    { id: 'notes',   label: 'Notes' },
    { id: 'solution', label: 'Solution' },
  ];

  let current = null;     /* the problem being shown */
  let solution = null;    /* its key + explanation, once fetched */
  let answered = null;    /* the last graded result, for re-rendering a tab */
  let host = null;
  let activeTab = 'problem';

  /* ---------------- entry ---------------- */

  async function open(id, mount) {
    host = mount;
    activeTab = 'problem';
    answered = null;
    solution = null;

    host.replaceChildren(el('p', { class: 'muted', text: 'Loading…' }));

    const problem = await Catalog.get(id);
    if (!problem) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'Problem not found' }),
        el('p', { class: 'muted' }, [`Nothing in the catalog has the id "${id}".`]),
        el('a', { class: 'btn', href: '#/problems' }, ['Back to the problems']),
      ]));
      return;
    }

    current = problem;
    Store.touch(problem);
    syncFocus();

    /* Already finished with it? Then the answer is not a secret any more, and
       hiding it behind a confirm would just be in the way. */
    const r = Store.record(problem.id);
    if (r.status === 'solved' || r.status === 'read' || r.revealed) {
      solution = await Catalog.solution(problem.id);
    }

    draw();
  }

  const locked = () => {
    const r = Store.record(current.id);
    return r.status === 'solved' || r.status === 'read' || r.revealed;
  };

  /* ---------------- chrome ---------------- */

  function draw() {
    const p = current;
    const r = Store.record(p.id);
    const topic = Store.TOPIC_BY_ID[p.topic] || { label: p.topic };
    const diff  = Store.DIFF_BY_ID[p.difficulty] || { label: p.difficulty };
    const type  = Catalog.TYPE_BY_ID[p.type] || { label: p.type };

    const head = el('div', { class: 'phead' }, [
      el('div', { class: 'crumbs' }, [
        el('a', { href: '#/problems' }, ['All problems']),
        el('span', {}, ['/']),
        el('a', { href: `#/problems?topic=${p.topic}` }, [topic.label]),
      ]),
      el('div', { class: 'phead-top' }, [
        el('h1', { text: p.title }),
        el('div', { class: 'phead-tools' }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', type: 'button', id: 'bookmarkBtn',
            'aria-pressed': String(!!r.flagged),
            title: r.flagged ? 'Remove the bookmark' : 'Bookmark this for later',
            onclick: () => { Store.toggleFlag(p); draw(); },
          }, [r.flagged ? '\u2605 Bookmarked' : '\u2606 Bookmark']),
          el('button', {
            class: 'btn btn-sm btn-ghost', type: 'button', id: 'focusBtn',
            'aria-pressed': String(focusOn()),
            title: focusOn()
              ? 'Leave focus mode (F)'
              : 'Focus mode: hide everything but the problem (F)',
            onclick: () => setFocus(!focusOn()),
          }, [focusOn() ? 'Leave focus' : 'Focus']),
        ]),
      ]),
      el('div', { class: 'meta' }, [
        el('span', { class: `diff diff-${p.difficulty}`, text: diff.label }),
        el('span', { class: 'tag', text: type.label }),
        el('span', { class: `status-${r.status}` }, [statusWord(r)]),
        p.estimate ? el('span', {}, [`~${p.estimate} min`]) : null,
        ...(p.tags || []).map(t => el('span', { class: 'tag', text: `#${t}` })),
      ]),
    ]);

    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    for (const t of TABS) {
      const isSolution = t.id === 'solution';
      const shut = isSolution && !locked();
      const badge = t.id === 'hints' && (p.hints || []).length
        ? `${r.hintsUsed}/${p.hints.length}` : null;

      tabs.append(el('button', {
        class: 'tab', role: 'tab', type: 'button',
        'aria-selected': String(t.id === activeTab),
        'data-tab': t.id,
        'data-locked': shut ? 'true' : undefined,
        onclick: () => { activeTab = t.id; draw(); },
      }, [
        t.label,
        shut ? el('span', { class: 'badge', text: '🔒' }) : null,
        badge ? el('span', { class: 'badge', text: badge }) : null,
      ]));
    }

    const panel = el('div', { class: 'panel', role: 'tabpanel' });
    ({
      problem:  drawProblem,
      prereq:   drawPrereq,
      hints:    drawHints,
      notes:    drawNotes,
      solution: drawSolution,
    }[activeTab] || drawProblem)(panel);

    /* A code problem is a workspace rather than a page: the statement and the
       editor sit side by side with a divider you can drag, because reading the
       specification while writing against it is the whole activity. Everything
       else keeps the one-column reading layout with a side rail. */
    const isWorkspace = p.type === 'code' && activeTab === 'problem';

    const wrap = el('div', {
      class: isWorkspace ? 'pwrap workspace' : 'pwrap',
    }, [
      el('div', { class: 'pmain' }, [head, tabs, panel]),
      isWorkspace ? null : el('div', { class: 'rail' }, rail()),
    ]);

    host.replaceChildren(wrap);
    if (isWorkspace) applySplit();
  }

  /* ---------------- the split, and focus mode ----------------

     The divider's position and whether focus mode is on are per-device view
     preferences, so they live under Store.pref rather than in the progress
     state - a bad value there could never cost a solve.

     The split is a CSS custom property rather than two inline widths, so one
     number drives both columns and the gutter stays put during a drag. */

  const SPLIT_MIN = 0.25;
  const SPLIT_MAX = 0.75;
  const splitFraction = () => {
    const v = Number(Store.pref('splitFraction', 0.46));
    return Number.isFinite(v) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) : 0.46;
  };

  function applySplit() {
    const node = host.querySelector('.split');
    if (node) node.style.setProperty('--split', String(splitFraction()));
  }

  function setSplit(fraction) {
    const clamped = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, fraction));
    Store.setPref('splitFraction', Math.round(clamped * 1000) / 1000);
    applySplit();
  }

  const focusOn = () => !!Store.pref('focusMode', false);

  function setFocus(on) {
    Store.setPref('focusMode', !!on);
    document.documentElement.toggleAttribute('data-focus', !!on);
    const btn = host && host.querySelector('#focusBtn');
    if (btn) {
      btn.setAttribute('aria-pressed', String(!!on));
      btn.title = on ? 'Leave focus mode (F)' : 'Focus mode: hide everything but the problem (F)';
      btn.textContent = on ? 'Leave focus' : 'Focus';
    }
  }

  /* Applied on every draw so that arriving straight at a problem with focus
     mode remembered does not flash the full chrome first. */
  function syncFocus() {
    document.documentElement.toggleAttribute('data-focus', focusOn());
  }

  /* A draggable divider that is also operable from the keyboard, because a
     separator you can only reach with a mouse is a separator half the people
     using the page cannot move. */
  function gutter() {
    const bar = el('div', {
      class: 'gutter',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Resize the statement and editor panels',
      'aria-valuemin': '25',
      'aria-valuemax': '75',
      'aria-valuenow': String(Math.round(splitFraction() * 100)),
      tabindex: '0',
      onkeydown: e => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowLeft')       setSplit(splitFraction() - step);
        else if (e.key === 'ArrowRight') setSplit(splitFraction() + step);
        else if (e.key === 'Home')       setSplit(SPLIT_MIN);
        else if (e.key === 'End')        setSplit(SPLIT_MAX);
        else if (e.key === 'Enter' || e.key === ' ') setSplit(0.46);
        else return;
        e.preventDefault();
        bar.setAttribute('aria-valuenow', String(Math.round(splitFraction() * 100)));
      },
    });

    bar.addEventListener('pointerdown', e => {
      const split = bar.closest('.split');
      if (!split) return;
      /* Capture the pointer so the drag survives the cursor leaving the thin
         gutter, which it will immediately. */
      bar.setPointerCapture(e.pointerId);
      split.dataset.dragging = 'true';

      const move = ev => {
        const box = split.getBoundingClientRect();
        if (box.width <= 0) return;
        setSplit((ev.clientX - box.left) / box.width);
        bar.setAttribute('aria-valuenow', String(Math.round(splitFraction() * 100)));
      };
      const up = ev => {
        bar.releasePointerCapture(ev.pointerId);
        delete split.dataset.dragging;
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
      };

      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
      e.preventDefault();
    });

    return bar;
  }

  function statusWord(r) {
    return {
      unsolved:  'Not solved',
      attempted: `Attempted ${r.attempts}×`,
      solved:    'Solved',
      read:      'Read the answer',
    }[r.status] || 'Not solved';
  }

  /* ---------------- the side rail ---------------- */

  function rail() {
    const p = current;
    const r = Store.record(p.id);
    const worth = Store.potentialXp(p);
    const base = (Store.DIFF_BY_ID[p.difficulty] || {}).base || 0;

    const why = [];
    if (r.revealed) why.push('You revealed the answer, so this one is worth nothing now.');
    else {
      if (r.attempts === 0) why.push(`includes the +50% for a first-try solve`);
      else why.push(`the first-try bonus is gone after ${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}`);
      if (r.hintsUsed) why.push(`−${Math.round(base * Store.HINT_PENALTY * r.hintsUsed)} for ${r.hintsUsed} ${r.hintsUsed === 1 ? 'hint' : 'hints'}`);
    }

    const cards = [
      el('div', { class: 'card' }, [
        el('h3', { text: r.status === 'solved' ? 'Earned' : 'Worth now' }),
        el('div', { class: 'worth-big', text: `${r.status === 'solved' ? r.xpEarned : worth} XP` }),
        el('div', { class: 'worth-note', text: why.join(' · ') }),
      ]),
    ];

    const actions = [];
    if (!locked()) {
      actions.push(el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button',
        onclick: doReveal,
      }, ['Reveal the answer…']));
    }
    actions.push(el('button', {
      class: 'btn btn-sm', type: 'button',
      onclick: () => {
        Store.setFlag(p, !Store.record(p.id).flagged);
        UI.toast(Store.record(p.id).flagged ? 'Flagged to come back to.' : 'Flag removed.', 'info');
        draw();
      },
    }, [r.flagged ? '★ Flagged' : '☆ Flag for later']));

    cards.push(el('div', { class: 'card stack' }, [
      el('h3', { text: 'This problem' }),
      ...actions,
    ]));

    if (r.status === 'solved' || r.status === 'read') {
      cards.push(el('div', { class: 'card' }, [
        el('h3', { text: 'Come back to it' }),
        el('div', { class: 'row' }, [3, 7, 30].map(d =>
          el('button', {
            class: 'btn btn-sm', type: 'button',
            onclick: () => {
              Store.setReview(p, d);
              UI.toast(`Booked for ${Store.record(p.id).reviewOn}.`, 'info');
              draw();
            },
          }, [`${d}d`]))),
        r.reviewOn ? el('p', { class: 'tiny faint', style: 'margin:.5rem 0 0' },
          [`Booked for ${r.reviewOn}.`]) : null,
      ]));
    }

    return cards;
  }

  /* ---------------- the problem tab ---------------- */

  function drawProblem(panel) {
    const p = current;
    const impl = ProblemTypes.get(p.type);

    const statement = el('div', { class: 'prose statement', html: MD.render(p.statement || '') });

    if (!impl) {
      panel.append(statement);
      panel.append(el('div', { class: 'empty' }, [
        `This problem is of type "${p.type}", which this build does not know how to show yet.`,
      ]));
      return;
    }

    const answer = el('div', { class: 'answer' });
    const widget = el('div', { class: 'widget', id: 'answerWidget' });
    answer.append(widget);

    impl.render(p, widget, { locked: locked() });

    /* The two actions, together, in one place. Run is secondary and Submit is
       primary, and the bar sticks to the bottom of the editor column so
       neither is below the fold on a long statement. Non-code types get the
       same bar with only Submit in it, so the button is always in the same
       place. */
    const actions = locked() ? null : el('div', { class: 'actions-bar' }, [
      el('div', { class: 'actions-bar-main' }, [
        p.type === 'code'
          ? el('button', {
              class: 'btn', type: 'button', id: 'runBtn',
              onclick: () => ProblemTypes.get('code').run(false),
            }, ['Run samples'])
          : null,
        el('button', {
          class: 'btn btn-primary', type: 'button', id: 'submitBtn', onclick: doSubmit,
        }, ['Submit']),
      ]),
      el('div', { class: 'actions-bar-note' }, [
        el('span', { class: 'tiny', id: 'worthNow', text: `Worth ${Store.potentialXp(p)} XP now` }),
        p.type === 'code'
          ? el('span', { class: 'tiny faint', id: 'draftState' }, ['Drafts save as you type'])
          : null,
        p.type === 'code'
          ? el('span', { class: 'tiny faint' }, ['Ctrl+Enter runs \u00b7 Ctrl+Shift+Enter submits'])
          : null,
      ]),
    ]);

    const verdict = (answered && solution) ? verdictNode(answered) : null;

    if (p.type === 'code') {
      /* Statement left, workspace right, with a divider between them. */
      panel.append(el('div', { class: 'split' }, [
        el('div', { class: 'split-pane split-statement' }, [
          statement,
          workspaceAside(),
        ]),
        gutter(),
        el('div', { class: 'split-pane split-work' }, [
          answer,
          actions,
          verdict,
        ]),
      ]));
    } else {
      panel.append(statement);
      panel.append(answer);
      if (actions) panel.append(actions);
      if (verdict) panel.append(verdict);
    }

    /* Re-painting the marks after a tab switch, so going to the prerequisites
       and coming back does not lose what you just learned. */
    if (answered && solution) {
      impl.mark(widget, { response: answered.response, key: solution.key, problem: p, solution, result: answered.result });
    } else if (locked() && solution) {
      impl.mark(widget, { response: null, key: solution.key, problem: p, solution, result: null });
    }
  }

  /* ---------------- hints and notes, without leaving the editor ----------------

     Both exist as tabs, and on a code problem leaving the editor to read a
     hint means losing sight of what you were writing. So they also appear
     under the statement as disclosures: the same state, the same cost, the
     same records - just reachable from where the work is happening. */

  function workspaceAside() {
    const p = current;
    const r = Store.record(p.id);
    const hints = p.hints || [];
    const base = (Store.DIFF_BY_ID[p.difficulty] || {}).base || 0;
    const cost = Math.round(base * Store.HINT_PENALTY);
    const shown = locked() ? hints.length : r.hintsUsed;

    const parts = [];

    if (hints.length) {
      const body = el('div', { class: 'aside-body' }, [
        el('p', { class: 'tiny faint' }, [
          locked()
            ? 'All of them, now that you are done with the problem.'
            : `One at a time. Each new one costs ${cost} XP off this problem; `
              + 're-reading one you already opened is free.',
        ]),
        ...hints.slice(0, shown).map((h, i) => el('div', { class: 'hint' }, [
          el('span', { class: 'hn', text: `Hint ${i + 1}` }),
          el('div', { html: MD.render(h) }),
        ])),
        (!locked() && shown < hints.length)
          ? el('button', {
              class: 'btn btn-sm', type: 'button',
              onclick: () => {
                Store.openHint(p);
                UI.toast(`Hint ${Store.record(p.id).hintsUsed} opened. Worth ${Store.potentialXp(p)} XP now.`, 'info');
                draw();
              },
            }, [shown === 0
              ? `Open the first hint (\u2212${cost} XP)`
              : `Open hint ${shown + 1} of ${hints.length} (\u2212${cost} XP)`])
          : null,
        (shown >= hints.length && hints.length)
          ? el('p', { class: 'tiny faint', text: 'That is all of them.' })
          : null,
      ]);

      parts.push(el('details', {
        class: 'aside', open: (shown > 0) || undefined,
      }, [
        el('summary', {}, [
          'Hints',
          el('span', { class: 'aside-count', text: `${shown}/${hints.length}` }),
        ]),
        body,
      ]));
    }

    parts.push(el('details', { class: 'aside' }, [
      el('summary', {}, [
        'Your notes',
        r.notes ? el('span', { class: 'aside-count', text: 'written' }) : null,
      ]),
      el('div', { class: 'aside-body' }, [
        el('p', { class: 'tiny faint' }, [
          'Kept locally, and carried to the Learning Tree with the solve.',
        ]),
        el('textarea', {
          style: 'width:100%;min-height:6rem',
          placeholder: 'The sentence worth remembering.',
          oninput: e => Store.setNotes(p, e.target.value),
        }, [r.notes]),
      ]),
    ]));

    /* The rail's contents still matter on a code problem - what it is worth,
       reveal, revisit - they just cannot sit in a third column. */
    parts.push(el('details', { class: 'aside' }, [
      el('summary', {}, ['Scoring and bookkeeping']),
      el('div', { class: 'aside-body stack' }, rail()),
    ]));

    return el('div', { class: 'asides' }, parts);
  }

  function verdictNode({ result, award }) {
    const kind = result.correct ? 'right' : (result.score > 0 ? 'part' : 'wrong');
    const bits = [];
    if (award) {
      if (award.alreadySolved) bits.push('Already solved, so no more points — but good practice.');
      else if (award.xp > 0) {
        let line = `+${award.xp} XP`;
        if (award.streakBonus) line += ` and +${award.streakBonus} coins for the streak`;
        bits.push(line);
      } else if (Store.record(current.id).revealed) {
        bits.push('No points: you had revealed the answer.');
      }
    }

    return el('div', { class: 'verdict', 'data-kind': kind }, [
      el('h4', { text: result.correct ? 'Right' : (result.score > 0 ? 'Partly right' : 'Not right') }),
      el('p', { html: MD.renderInline(result.feedback || '') }),
      bits.length ? el('p', { class: 'award', text: bits.join(' · ') }) : null,
      el('p', { class: 'tiny faint' }, [
        result.correct || Store.record(current.id).revealed
          ? 'The Solution tab is open now.'
          : 'Try again, take a hint, or read the prerequisites.',
      ]),
    ]);
  }

  /* ---------------- submitting ---------------- */

  async function doSubmit() {
    const p = current;
    const impl = ProblemTypes.get(p.type);
    const widget = host.querySelector('#answerWidget');
    const btn = host.querySelector('#submitBtn');

    const response = impl.collect(widget, p);
    if (response === null || response === undefined) {
      /* Grading an empty answer as wrong would silently burn the first-try
         bonus for forgetting to tick a box. */
      UI.toast('Answer it first.', 'bad');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

    solution = solution || await Catalog.solution(p.id);
    if (!solution) {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
      UI.toast('Could not load the answer key for this problem.', 'bad');
      return;
    }

    /* Awaited rather than called: a code problem has to reach a Worker or the
       judge before it knows anything, and awaiting a plain value costs the
       synchronous types nothing. */
    const result = await impl.grade(response, solution.key, p);

    /* A submission that could not be run at all is not a wrong answer. If the
       judge is down, recording an attempt would quietly cost the first-try
       bonus for something that was never graded. */
    if (result.noAttempt) {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
      impl.mark(widget, { response, key: solution.key, problem: p, solution, result });
      UI.toast(result.feedback, 'bad', 9000);
      return;
    }

    const award = Store.submit(p, {
      correct: result.correct,
      score: result.score,
      lang: result.lang,
      sanitized: result.sanitized,
    });

    answered = { response, result, award };

    if (result.correct && !award.alreadySolved && award.xp > 0) {
      UI.toast(`+${award.xp} XP`, 'good');
    }
    for (const a of award.newAchievements) UI.toast(`Unlocked: ${a.label}`, 'good');
    if (award.rankUp) UI.toast(`You are now ${award.rankUp.label}`, 'good');

    UI.refreshPurse();
    draw();
  }

  async function doReveal() {
    const ok = confirm(
      'Reveal the answer?\n\n' +
      'This problem will score zero and be recorded as read rather than solved. ' +
      'It stays in your list and you can still come back and work it properly.'
    );
    if (!ok) return;
    Store.reveal(current);
    solution = await Catalog.solution(current.id);
    activeTab = 'solution';
    UI.refreshPurse();
    draw();
  }

  /* ---------------- prerequisites ---------------- */

  function drawPrereq(panel) {
    const p = current;
    const chain = Catalog.prereqsFor(p);

    if (!chain.length) {
      panel.append(el('div', { class: 'empty' }, ['This one rests on nothing in particular. Dive in.']));
      return;
    }

    panel.append(el('p', { class: 'muted small' }, [
      'In reading order — foundations first. The ones this problem names directly are marked; ' +
      'the rest are what those rest on.',
    ]));

    for (const c of chain) {
      const prog = Catalog.readProgress(c.id);
      const node = el('div', { class: 'prereq' }, [
        el('div', { class: 'spread' }, [
          el('h4', {}, [
            c.name,
            c.direct ? null : el('span', { class: 'tiny faint' }, ['  (underneath)']),
          ]),
          prog.total ? el('span', { class: 'tiny faint mono', text: `${prog.read}/${prog.total} read` }) : null,
        ]),
        c.why ? el('p', { class: 'why', html: MD.renderInline(c.why) }) : null,
        c.oneLine ? el('p', { class: 'one-line', html: MD.renderInline(c.oneLine) }) : null,
      ]);

      if ((c.readings || []).length) {
        const readings = el('div', { class: 'readings' });
        c.readings.forEach((rd, i) => {
          const done = Store.hasRead(c.id, i);
          const box = el('input', {
            type: 'checkbox', checked: done || undefined,
            'aria-label': `Mark "${rd.title}" as read`,
            onchange: e => {
              const unlocked = Store.markReading(c.id, i, e.target.checked);
              for (const a of unlocked) UI.toast(`Unlocked: ${a.label}`, 'good');
              draw();
            },
          });
          readings.append(el('label', { class: `reading${done ? ' done' : ''}` }, [
            box,
            rd.kind ? el('span', { class: 'kind', text: rd.kind }) : null,
            rd.url
              ? el('a', { class: 'title', href: MD.safeHref(rd.url), target: '_blank', rel: 'noopener noreferrer', text: rd.title })
              : el('span', { class: 'title', text: rd.title }),
            rd.where ? el('span', { class: 'where', text: rd.where }) : null,
          ]));
        });
        node.append(readings);
      }

      panel.append(node);
    }
  }

  /* ---------------- hints ---------------- */

  function drawHints(panel) {
    const p = current;
    const hints = p.hints || [];
    const r = Store.record(p.id);

    if (!hints.length) {
      panel.append(el('div', { class: 'empty' }, ['No hints on this one.']));
      return;
    }

    const base = (Store.DIFF_BY_ID[p.difficulty] || {}).base || 0;
    const cost = Math.round(base * Store.HINT_PENALTY);

    panel.append(el('p', { class: 'muted small' }, [
      locked()
        ? 'All of them, now that you are done with the problem.'
        : `Each hint costs ${cost} XP off this problem, and only the first time you open it — ` +
          're-reading one you already have is free.',
    ]));

    const show = locked() ? hints.length : r.hintsUsed;

    hints.slice(0, show).forEach((h, i) => {
      panel.append(el('div', { class: 'hint' }, [
        el('span', { class: 'hn', text: `Hint ${i + 1}` }),
        el('div', { html: MD.render(h) }),
      ]));
    });

    if (!locked() && show < hints.length) {
      panel.append(el('button', {
        class: 'btn', type: 'button', style: 'margin-top:.5rem',
        onclick: () => {
          Store.openHint(p);
          UI.toast(`Hint ${Store.record(p.id).hintsUsed} opened. This problem is now worth ${Store.potentialXp(p)} XP.`, 'info');
          draw();
        },
      }, [show === 0 ? `Open the first hint (−${cost} XP)` : `Open hint ${show + 1} (−${cost} XP)`]));
    }
  }

  /* ---------------- notes ---------------- */

  function drawNotes(panel) {
    const p = current;
    const r = Store.record(p.id);

    panel.append(el('p', { class: 'muted small' }, [
      'Yours, kept locally. The sentence worth remembering is the one to write here.',
    ]));

    panel.append(el('textarea', {
      style: 'width:100%;min-height:9rem', placeholder: 'What did this teach you?',
      oninput: e => Store.setNotes(p, e.target.value),
    }, [r.notes]));

    panel.append(el('h3', { style: 'margin-top:1.2rem', text: 'How hard did it feel?' }));
    panel.append(el('p', { class: 'tiny faint' }, [
      'Independent of whatever difficulty it is filed under. This is the figure that travels ' +
      'to the Learning Tree as `perceived`.',
    ]));
    panel.append(el('div', { class: 'chips' }, [1, 2, 3, 4, 5].map(n =>
      el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': String(r.perceived === n),
        onclick: () => { Store.setPerceived(p, r.perceived === n ? null : n); draw(); },
      }, [['Easy', 'Fine', 'Work', 'Hard', 'Brutal'][n - 1]]))));
  }

  /* ---------------- solution ---------------- */

  function drawSolution(panel) {
    if (!locked()) {
      panel.append(el('div', { class: 'empty' }, [
        el('h2', { text: 'Not yet' }),
        el('p', { class: 'muted' }, [
          'Solve it, or reveal the answer deliberately — which records it as read rather than ' +
          'solved, and scores zero.',
        ]),
        el('button', { class: 'btn', type: 'button', onclick: doReveal }, ['Reveal the answer…']),
      ]));
      return;
    }

    if (!solution) {
      panel.append(el('p', { class: 'muted', text: 'Loading the solution…' }));
      Catalog.solution(current.id).then(s => { solution = s; draw(); });
      return;
    }

    panel.append(el('div', { class: 'prose', html: MD.render(solution.explanation || '') }));

    const more = solution.readMore || [];
    if (more.length) {
      const list = el('div', { class: 'readings' });
      for (const m of more) {
        const c = Catalog.concept(m.concept);
        list.append(el('div', { class: 'reading' }, [
          el('span', { class: 'kind', text: 'read' }),
          el('span', { class: 'title', text: c ? c.name : m.concept }),
          m.where ? el('span', { class: 'where', text: m.where }) : null,
        ]));
      }
      panel.append(el('div', { class: 'card', style: 'margin-top:1rem' }, [
        el('h3', { text: 'Where to read more' }), list,
      ]));
    }
  }

  /* Reachable from the keyboard handler as well as the button, and from any
     view: focus mode is a preference about the window, not about a problem. */
  function toggleFocus(force = null) {
    const next = force === null ? !focusOn() : !!force;
    setFocus(next);
    if (current && host && host.isConnected) draw();
  }

  return { open, toggleFocus, setSplit, splitFraction };
})();
