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
  let lastBlocked = null; /* a submission that could not be run at all */
  let lastRun = null;     /* the last Run, for the Results pane */
  let solutionShown = false;
  let host = null;
  let activeTab = 'problem';

  /* ---------------- entry ---------------- */

  async function open(id, mount) {
    host = mount;
    activeTab = 'problem';
    answered = null;
    lastBlocked = null;
    solutionShown = false;
    attempting = false;
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

  /* ---------------- four separate questions ----------------

     These were one boolean called locked(), which conflated them and meant a
     wrong answer disabled the controls while a solved problem could not be
     practised again. They are not the same question:

       disclosed()  may the reader see the answer?
       finished()   has this problem been completed, however?
       rewarded()   has it already paid out, so a resubmit must not pay again?
       attempting() is a submission in flight right now?

     Only the last one has any business disabling a control. */

  const disclosed = () => {
    const r = Store.record(current.id);
    return r.status === 'solved' || r.status === 'read' || !!r.revealed;
  };

  const finished = () => {
    const r = Store.record(current.id);
    return r.status === 'solved' || r.status === 'read';
  };

  const rewarded = () => Store.record(current.id).status === 'solved';

  let attempting = false;

  /* ---------------- chrome ---------------- */

  /* ---------------- the workspace ----------------

     A code problem is a workspace, not a document. The old page let the
     editor grow with the content, which put it past the bottom of the window
     and under the sticky action bar — a click halfway down hit the bar and
     typing went nowhere. So the whole thing is now a fixed-height grid
     anchored to the viewport, and every pane scrolls inside its own box:

       header            compact: navigation, title, status, tools
       left   | right    statement and tabs | toolbar, editor, results
                         with a draggable divider between them, and a
                         second one between the editor and the results

     Nothing outside a pane scrolls, so there is no page-level scrollbar and
     no accidental nested one. */

  const LEFT_TABS = [
    { id: 'problem',  label: 'Description' },
    { id: 'prereq',   label: 'Prerequisites' },
    { id: 'hints',    label: 'Hints' },
    { id: 'notes',    label: 'Notes' },
    { id: 'solution', label: 'Solution' },
  ];

  const RESULT_TABS = [
    { id: 'cases',    label: 'Test cases' },
    { id: 'results',  label: 'Results' },
    { id: 'compiler', label: 'Compiler output' },
  ];

  let resultTab = 'cases';

  function draw() {
    const p = current;
    const workspace = p.type === 'code';
    document.body.dataset.workspace = workspace ? 'true' : 'false';
    host.replaceChildren(workspace ? drawWorkspace() : drawReading());
    if (workspace) {
      applySplit();
      /* CodeMirror measures lazily and has just been put in a box whose size
         it has not seen. */
      if (codeEditor()) codeEditor().refresh();
    }
  }

  const codeEditor = () => {
    const impl = ProblemTypes.get('code');
    return impl && impl.editor ? impl.editor() : null;
  };

  /* ---------------- the header ---------------- */

  /* Where this problem sits in the catalogue, so the header can offer the one
     before and the one after without the reader going back to the list. */
  function neighbours() {
    const all = Catalog.sorted(Catalog.all());
    const at = all.findIndex(x => x.id === current.id);
    return {
      at: at + 1, total: all.length,
      prev: at > 0 ? all[at - 1] : null,
      next: at >= 0 && at < all.length - 1 ? all[at + 1] : null,
    };
  }

  function header() {
    const p = current;
    const r = Store.record(p.id);
    const diff = Store.DIFF_BY_ID[p.difficulty] || { label: p.difficulty };
    const n = neighbours();

    const navBtn = (meta, label, title) => meta
      ? el('a', { class: 'ws-nav', href: `#/p/${meta.id}`, title: `${title}: ${meta.title}` }, [label])
      : el('span', { class: 'ws-nav', 'aria-disabled': 'true' }, [label]);

    return el('header', { class: 'ws-head' }, [
      el('div', { class: 'ws-head-left' }, [
        el('a', { class: 'ws-back', href: '#/problems', title: 'All problems' }, ['←']),
        navBtn(n.prev, '‹', 'Previous'),
        el('span', { class: 'ws-count tiny faint', text: `${n.at}/${n.total}` }),
        navBtn(n.next, '›', 'Next'),
      ]),

      el('div', { class: 'ws-head-mid' }, [
        el('h1', { class: 'ws-title', title: p.title, text: p.title }),
        el('span', { class: `diff diff-${p.difficulty}`, text: diff.label }),
        el('span', { class: `status-word status-${r.status}`, text: statusWord(r) }),
      ]),

      el('div', { class: 'ws-head-right' }, [
        p.type === 'code' ? fontSizeControl() : null,
        el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', id: 'bookmarkBtn',
          'aria-pressed': String(!!r.flagged),
          title: r.flagged ? 'Remove the bookmark' : 'Bookmark this for later',
          onclick: () => { Store.toggleFlag(p); draw(); },
        }, [r.flagged ? '★' : '☆']),
        el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', id: 'focusBtn',
          'aria-pressed': String(focusOn()),
          title: focusOn() ? 'Leave focus mode (F)' : 'Focus mode (F)',
          onclick: () => setFocus(!focusOn()),
        }, [focusOn() ? 'Unfocus' : 'Focus']),
        moreMenu(),
      ]),
    ]);
  }

  /* Bigger code without zooming the page, which on a split layout would cost
     the reader the statement. */
  function fontSizeControl() {
    const sizes = Editor.FONT_SIZES;
    const now = Editor.create ? (Store.pref('editorFontSize', Editor.DEFAULT_FONT)) : Editor.DEFAULT_FONT;
    const step = delta => {
      const i = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(now) + delta));
      const ed = codeEditor();
      if (ed && ed.setFontSize) ed.setFontSize(sizes[i]);
      else Store.setPref('editorFontSize', sizes[i]);
      draw();
    };
    return el('div', { class: 'ws-font', role: 'group', 'aria-label': 'Editor font size' }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button', title: 'Smaller code',
        disabled: now <= sizes[0] || undefined,
        onclick: () => step(-1),
      }, ['A−']),
      el('span', { class: 'tiny faint mono', text: `${now}` }),
      el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button', title: 'Bigger code',
        disabled: now >= sizes[sizes.length - 1] || undefined,
        onclick: () => step(1),
      }, ['A+']),
    ]);
  }

  /* Scoring, revealing and revisit scheduling: real, and not what the reader
     is doing right now, so they live behind one button rather than taking a
     column of the workspace. */
  function moreMenu() {
    const p = current;
    const r = Store.record(p.id);
    const worth = Store.potentialXp(p);

    const items = el('div', { class: 'ws-menu-body' }, [
      el('p', { class: 'tiny faint', text: r.status === 'solved'
        ? `Earned ${r.xpEarned} XP. Practising again is free and pays nothing.`
        : `Worth ${worth} XP right now.` }),

      disclosed() ? null : el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button', onclick: doReveal,
      }, ['Reveal the solution…']),

      finished() ? el('div', {}, [
        el('p', { class: 'tiny faint', style: 'margin:.4rem 0 .2rem', text: 'Come back to it in' }),
        el('div', { class: 'row' }, [3, 7, 30].map(d => el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: () => {
            Store.setReview(p, d);
            UI.toast(`Booked for ${Store.record(p.id).reviewOn}.`, 'info');
            draw();
          },
        }, [`${d}d`]))),
        r.reviewOn ? el('p', { class: 'tiny faint', style: 'margin:.4rem 0 0', text: `Booked for ${r.reviewOn}.` }) : null,
      ]) : null,
    ]);

    return el('details', { class: 'ws-menu' }, [
      el('summary', { class: 'btn btn-sm btn-ghost', title: 'Scoring, reveal, revisit' }, ['⋯']),
      items,
    ]);
  }

  /* ---------------- the code workspace ---------------- */

  function drawWorkspace() {
    const p = current;

    const left = el('section', { class: 'ws-left' }, [
      tabStrip(LEFT_TABS, activeTab, id => { activeTab = id; draw(); }),
      el('div', { class: 'ws-pane', id: 'leftPane' }),
    ]);
    fillLeftPane(left.querySelector('#leftPane'));

    const right = el('section', { class: 'ws-right' }, [
      el('div', { class: 'ws-toolbar', id: 'wsToolbar' }),
      el('div', { class: 'ws-editor', id: 'wsEditor' }),
      hGutter(),
      el('section', { class: 'ws-results' }, [
        tabStrip(RESULT_TABS, resultTab, id => { resultTab = id; draw(); }, 'ws-tabs ws-tabs-sm'),
        el('div', { class: 'ws-pane', id: 'resultPane' }),
      ]),
    ]);

    const body = el('div', { class: 'ws-body' }, [left, vGutter(), right]);
    const wrap = el('div', { class: 'ws' }, [header(), body]);

    /* The widget is mounted after the frame exists, so CodeMirror is created
       inside a box that already has its final size. */
    queueMicrotask(() => {
      const slot = wrap.querySelector('#wsEditor');
      const bar = wrap.querySelector('#wsToolbar');
      if (!slot || !bar) return;
      mountAnswer(slot, bar);
      fillResultPane(wrap.querySelector('#resultPane'));
      applySplit();
      const ed = codeEditor();
      if (ed) ed.refresh();
    });

    return wrap;
  }

  function tabStrip(tabs, active, onPick, cls = 'ws-tabs') {
    const strip = el('div', { class: cls, role: 'tablist' });
    for (const t of tabs) {
      const shut = t.id === 'solution' && !disclosed();
      const r = Store.record(current.id);
      const badge = t.id === 'hints' && (current.hints || []).length
        ? `${r.hintsUsed}/${current.hints.length}` : null;
      strip.append(el('button', {
        class: 'tab', role: 'tab', type: 'button',
        'aria-selected': String(t.id === active),
        'data-tab': t.id,
        'data-locked': shut ? 'true' : undefined,
        onclick: () => onPick(t.id),
      }, [
        t.label,
        shut ? el('span', { class: 'badge', text: '🔒' }) : null,
        badge ? el('span', { class: 'badge', text: badge }) : null,
      ]));
    }
    return strip;
  }

  function fillLeftPane(pane) {
    if (!pane) return;
    pane.replaceChildren();
    ({
      problem:  panel => panel.append(el('div', { class: 'prose statement', html: MD.render(current.statement || '') })),
      prereq:   drawPrereq,
      hints:    drawHints,
      notes:    drawNotes,
      solution: drawSolution,
    }[activeTab] || drawPrereq)(pane);
  }

  /* The answer widget plus the toolbar that drives it. The toolbar is built
     here rather than inside the type module so Run and Submit are in the same
     place for every problem, and stay visible while the editor scrolls. */
  function mountAnswer(slot, bar) {
    const p = current;
    const impl = ProblemTypes.get(p.type);
    if (!impl) {
      slot.append(el('div', { class: 'empty' }, [
        `This problem is of type "${p.type}", which this build cannot show yet.`,
      ]));
      return;
    }

    const widget = el('div', { class: 'widget', id: 'answerWidget' });
    slot.append(widget);
    impl.render(p, widget, { locked: false, disclosed: disclosed() });

    bar.replaceChildren(
      el('div', { class: 'ws-toolbar-left', id: 'langSlot' }),
      el('div', { class: 'ws-toolbar-right' }, [
        el('span', { class: 'ws-exec', id: 'execState' }),
        el('button', {
          class: 'btn btn-sm', type: 'button', id: 'runBtn',
          onclick: () => impl.run && impl.run(false),
        }, ['Run samples']),
        el('button', {
          class: 'btn btn-sm btn-primary', type: 'button', id: 'submitBtn',
          onclick: doSubmit,
        }, ['Submit']),
      ]),
    );

    /* The language tabs the type module built belong in the toolbar. */
    const tabs = widget.querySelector('.lang-tabs');
    const slotFor = bar.querySelector('#langSlot');
    if (tabs && slotFor) slotFor.append(tabs);
    const exec = widget.querySelector('.judge-state');
    if (exec) exec.remove();

    repaintMarks(widget);
  }

  function repaintMarks(widget) {
    const p = current;
    const impl = ProblemTypes.get(p.type);
    if (!impl || !widget) return;
    if (answered) {
      impl.mark(widget, {
        response: answered.response,
        key: solution ? solution.key : null,
        problem: p, solution, result: answered.result,
      });
    }
    if (disclosed() && solution) {
      impl.reveal(widget, {
        response: answered ? answered.response : null,
        key: solution.key, problem: p, solution,
        result: answered ? answered.result : null,
      });
    }
  }

  function fillResultPane(pane) {
    if (!pane) return;
    pane.replaceChildren();

    if (resultTab === 'cases') {
      const cases = ((current.payload || {}).cases) || [];
      if (!cases.length) {
        pane.append(el('p', { class: 'muted small', text: 'This problem has no visible sample cases.' }));
        return;
      }
      pane.append(el('p', { class: 'tiny faint', text:
        `${cases.length} sample ${cases.length === 1 ? 'case' : 'cases'}. `
        + 'Submit also runs hidden ones.' }));
      cases.forEach((c, i) => {
        pane.append(el('div', { class: 'case' }, [
          el('div', { class: 'case-head' }, [el('span', { text: `Case ${i + 1}` })]),
          el('div', { class: 'io' }, [
            el('div', {}, [el('h5', { text: 'stdin' }), el('pre', { text: c.stdin || '(none)' })]),
            el('div', {}, [el('h5', { text: 'expected' }), el('pre', { text: c.expect || '(nothing)' })]),
          ]),
        ]));
      });
      return;
    }

    if (resultTab === 'results') {
      if (lastBlocked) { pane.append(executionFailureNode(lastBlocked)); return; }
      if (!lastRun && !answered) {
        pane.append(el('p', { class: 'muted small', text: 'Press Run samples, or Submit.' }));
        return;
      }
      if (answered) pane.append(verdictNode(answered));
      const out = el('div', { class: 'run-out', id: 'runOut' });
      pane.append(out);
      const impl = ProblemTypes.get('code');
      if (impl && impl.repaintOutput) impl.repaintOutput(out);
      return;
    }

    /* compiler */
    const impl = ProblemTypes.get('code');
    const text = impl && impl.lastCompilerOutput ? impl.lastCompilerOutput() : '';
    if (!text) {
      pane.append(el('p', { class: 'muted small', text: 'Nothing from the compiler yet.' }));
      return;
    }
    pane.append(impl.diagnosticsNode(text, impl.lastBuildOk ? impl.lastBuildOk() : true));
  }

  /* ---------------- the two dividers ---------------- */

  function vGutter() {
    return makeGutter({
      cls: 'ws-gutter', orientation: 'vertical',
      label: 'Resize the statement and editor panels',
      get: splitFraction, set: setSplit,
      axis: box => ({ start: box.left, size: box.width }),
      coord: e => e.clientX,
      container: node => node.closest('.ws-body'),
    });
  }

  function hGutter() {
    return makeGutter({
      cls: 'ws-hgutter', orientation: 'horizontal',
      label: 'Resize the editor and results panels',
      get: vSplitFraction, set: setVSplit,
      axis: box => ({ start: box.top, size: box.height }),
      coord: e => e.clientY,
      container: node => node.closest('.ws-right'),
    });
  }

  function makeGutter({ cls, orientation, label, get, set, axis, coord, container }) {
    const bar = el('div', {
      class: cls, role: 'separator', 'aria-orientation': orientation,
      'aria-label': label, tabindex: '0',
      'aria-valuemin': '20', 'aria-valuemax': '80',
      'aria-valuenow': String(Math.round(get() * 100)),
      onkeydown: e => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') set(get() - step);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') set(get() + step);
        else if (e.key === 'Home') set(0.2);
        else if (e.key === 'End') set(0.8);
        else if (e.key === 'Enter' || e.key === ' ') set(orientation === 'vertical' ? 0.42 : 0.62);
        else return;
        e.preventDefault();
        bar.setAttribute('aria-valuenow', String(Math.round(get() * 100)));
      },
    });

    bar.addEventListener('pointerdown', e => {
      const box = container(bar);
      if (!box) return;
      bar.setPointerCapture(e.pointerId);
      box.dataset.dragging = 'true';
      const move = ev => {
        const r = box.getBoundingClientRect();
        const { start, size } = axis(r);
        if (size <= 0) return;
        set((coord(ev) - start) / size);
        bar.setAttribute('aria-valuenow', String(Math.round(get() * 100)));
      };
      const up = ev => {
        bar.releasePointerCapture(ev.pointerId);
        delete box.dataset.dragging;
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        const ed = codeEditor();
        if (ed) ed.refresh();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
      e.preventDefault();
    });

    return bar;
  }

  /* ---------------- the reading layout ----------------

     Everything that is not a code problem: one comfortable column, the answer
     controls under the statement, and the same retry feedback. */

  function drawReading() {
    const p = current;
    const impl = ProblemTypes.get(p.type);

    const panel = el('div', { class: 'panel', role: 'tabpanel' });
    if (activeTab === 'problem') {
      panel.append(el('div', { class: 'prose statement', html: MD.render(p.statement || '') }));

      const answer = el('div', { class: 'answer' });
      const widget = el('div', { class: 'widget', id: 'answerWidget' });
      answer.append(widget);
      if (impl) impl.render(p, widget, { locked: false, disclosed: disclosed() });
      panel.append(answer);

      panel.append(el('div', { class: 'actions-bar' }, [
        el('div', { class: 'actions-bar-main' }, [
          el('button', {
            class: 'btn btn-primary', type: 'button', id: 'submitBtn', onclick: doSubmit,
          }, ['Submit']),
        ]),
        el('div', { class: 'actions-bar-note' }, [
          el('span', { class: 'tiny', id: 'worthNow',
            text: rewarded() ? 'Already solved — practice only' : `Worth ${Store.potentialXp(p)} XP now` }),
        ]),
      ]));

      if (lastBlocked) panel.append(executionFailureNode(lastBlocked));
      else if (answered) panel.append(verdictNode(answered));

      repaintMarks(widget);
    } else {
      ({
        prereq: drawPrereq, hints: drawHints, notes: drawNotes, solution: drawSolution,
      }[activeTab] || drawPrereq)(panel);
    }

    return el('div', { class: 'pwrap reading' }, [
      el('div', { class: 'pmain' }, [
        header(),
        tabStrip(LEFT_TABS, activeTab, id => { activeTab = id; draw(); }, 'tabs'),
        panel,
      ]),
    ]);
  }

  function statusWord(r) {
    return {
      unsolved:  'Not started',
      attempted: `Attempted ${r.attempts}×`,
      solved:    'Solved',
      /* "Read the answer" sounded like a judgement. This is the record saying
         what happened, and what happened is that the solution was reviewed. */
      read:      'Solution reviewed',
    }[r.status] || 'Not started';
  }

  /* ---------------- the split, and focus mode ----------------

     The divider's position and whether focus mode is on are per-device view
     preferences, so they live under Store.pref rather than in the progress
     state - a bad value there could never cost a solve.

     The split is a CSS custom property rather than two inline widths, so one
     number drives both columns and the gutter stays put during a drag. */

  const SPLIT_MIN = 0.2;
  const SPLIT_MAX = 0.8;
  const splitFraction = () => {
    const v = Number(Store.pref('splitFraction', 0.42));
    return Number.isFinite(v) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) : 0.42;
  };

  /* The editor/results divider, kept with the other view preferences. */
  const vSplitFraction = () => {
    const v = Number(Store.pref('vSplitFraction', 0.62));
    return Number.isFinite(v) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) : 0.62;
  };

  function applySplit() {
    const body = host.querySelector('.ws-body');
    if (body) body.style.setProperty('--split', String(splitFraction()));
    const right = host.querySelector('.ws-right');
    if (right) right.style.setProperty('--vsplit', String(vSplitFraction()));
  }

  function setVSplit(fraction) {
    const clamped = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, fraction));
    Store.setPref('vSplitFraction', Math.round(clamped * 1000) / 1000);
    applySplit();
    const ed = codeEditor();
    if (ed) ed.refresh();
  }

  function setSplit(fraction) {
    const clamped = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, fraction));
    Store.setPref('splitFraction', Math.round(clamped * 1000) / 1000);
    applySplit();
    const ed = codeEditor();
    if (ed) ed.refresh();
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
    if (!disclosed()) {
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
        bits.push('No points: you had reviewed the solution.');
      }
    }

    /* What to do next, which depends on which of the four states this is. */
    let next;
    if (result.correct) next = 'The Solution tab is open now.';
    else if (disclosed()) next = 'You can see the solution; try again whenever you like.';
    else next = 'Try again, take a hint, or read the prerequisites. Nothing has been revealed.';

    return el('div', { class: 'verdict', 'data-kind': kind }, [
      el('h4', { text: result.correct ? 'Right' : (result.score > 0 ? 'Partly right' : 'Not right') }),
      el('p', { html: MD.renderInline(result.feedback || '') }),
      bits.length ? el('p', { class: 'award', text: bits.join(' · ') }) : null,
      el('p', { class: 'tiny faint' }, [next]),
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

    if (attempting) return;
    attempting = true;
    const restore = () => {
      attempting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
    };
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

    /* Fetching the key is itself a network call, and a page opened offline
       should say that rather than looking like a wrong answer. */
    let key = solution;
    try {
      key = solution || await Catalog.solution(p.id);
    } catch (err) {
      key = null;
    }
    if (!key) {
      restore();
      answered = null;
      lastBlocked = {
        feedback: 'The answer key could not be loaded. That is a network or '
          + 'serving problem rather than anything to do with your answer.',
      };
      draw();
      return;
    }
    solution = key;

    /* Awaited rather than called: a code problem has to reach a Worker or the
       judge before it knows anything, and awaiting a plain value costs the
       synchronous types nothing. */
    const result = await impl.grade(response, solution.key, p);

    /* A submission that could not be run at all is not a wrong answer. If the
       judge is down, recording an attempt would quietly cost the first-try
       bonus for something that was never graded. */
    if (result.noAttempt) {
      restore();
      /* Deliberately not recorded as an attempt and not passed to the store:
         the runner being down must not cost a first-try bonus. */
      lastBlocked = result;
      impl.mark(widget, { response, key: solution.key, problem: p, solution, result });
      draw();
      UI.toast(result.feedback, 'bad', 9000);
      return;
    }
    lastBlocked = null;

    const award = Store.submit(p, {
      correct: result.correct,
      score: result.score,
      lang: result.lang,
      sanitized: result.sanitized,
    });

    answered = { response, result, award };
    attempting = false;

    /* Only now, and only if it is actually earned. */
    if (result.correct && !solutionShown) solutionShown = true;

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
      disclosed()
        ? 'All of them, now that you are done with the problem.'
        : `Each hint costs ${cost} XP off this problem, and only the first time you open it — ` +
          're-reading one you already have is free.',
    ]));

    const show = disclosed() ? hints.length : r.hintsUsed;

    hints.slice(0, show).forEach((h, i) => {
      panel.append(el('div', { class: 'hint' }, [
        el('span', { class: 'hn', text: `Hint ${i + 1}` }),
        el('div', { html: MD.render(h) }),
      ]));
    });

    if (!disclosed() && show < hints.length) {
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
    if (!disclosed()) {
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

  /* Called by the code type after a run, so the pane the reader is looking
     at is the one with the answer in it. */
  function showResults() {
    lastRun = true;
    resultTab = 'results';
    draw();
  }

  return {
    open, toggleFocus, setSplit, splitFraction, setVSplit, vSplitFraction,
    showResults,
  };
})();
