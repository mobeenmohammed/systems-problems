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
  let previousAttempts = []; /* the ones before it, collapsed */
  let reviewing = false;  /* a written proof is on screen, waiting to be reviewed */
  let lastBlocked = null; /* a submission that could not be run at all */
  let lastRun = null;     /* the last Run, for the Results pane */
  let solutionShown = false;
  let host = null;
  let activeTab = 'problem';

  /* ---------------- entry ---------------- */

  async function open(id, mount) {
    /* Opening is leaving the last one first: a second problem must not
       inherit the first one's editor, verdict or attempt history. */
    leave();

    host = mount;
    activeTab = 'problem';
    answered = null;
    previousAttempts = [];
    answerChanged = false;
    reviewing = false;
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

  /* ---------------- leaving ----------------

     The reported bug, and it was not intermittent. Opening a code problem
     puts body[data-workspace="true"] on the document, and that turns .main
     into a fixed-height, zero-padding, overflow:hidden box — correct for a
     workspace that owns the viewport, ruinous for the dashboard. Nothing ever
     took it off again, so one click from a problem to anywhere else left the
     destination page clipped to the window with no scrollbar: measured at
     422px of the dashboard, and 29,021px of the reading map, simply
     unreachable. html[data-focus] was the same mistake with the navigation.

     So there is now exactly one way out, and the router takes it on every
     route that is not a problem. It is written to be safe to call twice, and
     safe to call when no problem was ever open. */
  function leave() {
    endAnyDrag();

    /* CodeMirror holds listeners on the document and a mutation observer on
       its own DOM. Hiding the view does not stop any of that, and thirty
       crossings used to leave thirty of them. */
    for (const impl of [ProblemTypes.get('code')]) {
      if (impl && impl.teardown) impl.teardown();
    }

    delete document.body.dataset.workspace;
    document.documentElement.removeAttribute('data-focus');

    if (host && host.isConnected) host.replaceChildren();
    current = null;
    solution = null;
    answered = null;
    previousAttempts = [];
    answerChanged = false;
    reviewing = false;
    lastBlocked = null;
    lastRun = null;
    solutionShown = false;
    attempting = false;
    host = null;
  }

  /* Any pointer drag in flight, so that navigating mid-drag cannot leave the
     page with user-select off, a dragging flag set, or a capture held by an
     element that is about to be thrown away. */
  let dragCleanup = null;
  function endAnyDrag() {
    if (!dragCleanup) return;
    const fn = dragCleanup;
    dragCleanup = null;
    try { fn(); } catch { /* the element may already be gone */ }
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
    /* Removed rather than set to "false": the attribute exists only while it
       means something, so a stale one is visible in the DOM rather than
       hiding behind a falsy-looking string. */
    if (workspace) document.body.dataset.workspace = 'true';
    else delete document.body.dataset.workspace;
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

      p.type === 'code' ? el('div', {}, [
        el('hr', { class: 'ws-menu-rule' }),
        el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', id: 'resetLayoutBtn',
          title: 'Panel sizes and editor font back to their defaults',
          onclick: () => resetLayout(),
        }, ['Reset layout']),
        el('p', { class: 'tiny faint', style: 'margin:.3rem 0 0',
          text: 'Panels and font size only. Your code, notes and progress stay.' }),
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

  /* The statement, plus the one figure it may name.

     A figure is referenced by name and drawn by js/maths/figures.js rather
     than being markup in the data file: a drawing in a problem file would
     be either HTML passed through unescaped or a private little language.
     A name that nobody drew renders nothing rather than breaking the page. */
  function statementNode(p) {
    const wrap = el('div', { class: 'prose statement', html: MD.render(p.statement || '') });
    const name = (p.payload || {}).figure;
    if (name && typeof MathsFigures !== 'undefined' && MathsFigures.has(name)) {
      wrap.append(MathsFigures.node(name));
    }
    return wrap;
  }

  function fillLeftPane(pane) {
    if (!pane) return;
    pane.replaceChildren();
    ({
      problem:  panel => { panel.append(statementNode(current)); },
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
        /* Shown only when the language in front of the reader cannot run.
           code.js unhides it, because it is the thing that knows. Editing
           stays available the whole time — not being able to run something
           is no reason to stop someone writing it. */
        el('a', {
          class: 'btn btn-sm btn-ghost ws-setup', id: 'setupLink', href: '#/setup',
          hidden: true,
          title: 'What it takes to compile C++ and Rust, and what is working now',
        }, ['Set up execution']),
        el('button', {
          class: 'btn btn-sm btn-ghost ws-stop', type: 'button', id: 'stopBtn', hidden: true,
          title: 'Stop whatever is running or downloading',
          onclick: () => { if (impl.stop) impl.stop(); },
        }, ['Stop']),
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
    /* The judge-state box stays in the editor panel but is hidden by CSS
       while everything is fine — the toolbar chip is enough then. When
       something cannot run it reappears, because "No runner" on its own does
       not tell anybody which runner or what to do about it. */

    repaintMarks(widget);
  }

  /* True once the reader has touched the answer since the last submission.
     The verdict then stops describing what is on screen, so it is labelled
     as the previous attempt and the marks on the controls are cleared —
     a freshly ticked box must never arrive already marked wrong. */
  let answerChanged = false;

  function watchForChanges(widget) {
    if (!widget) return;
    const touched = () => {
      if (answerChanged || !answered) return;
      answerChanged = true;
      /* Clear the marks immediately rather than waiting for a redraw: the
         reader is looking at the control they just clicked. */
      widget.querySelectorAll('[data-mark]').forEach(n => delete n.dataset.mark);
      const v = host && host.querySelector('.verdict');
      if (v) v.dataset.stale = 'true';
      const note = host && host.querySelector('.verdict-when');
      if (note) note.textContent = 'Previous attempt';
    };
    widget.addEventListener('change', touched);
    widget.addEventListener('input', touched);
    /* locate and order are clicked rather than changed. */
    widget.addEventListener('click', e => {
      if (e.target.closest('button, [data-line], .opt, li')) touched();
    });
  }

  function repaintMarks(widget) {
    const p = current;
    const impl = ProblemTypes.get(p.type);
    if (!impl || !widget) return;

    /* The page redraws after every submission, which rebuilds the widget from
       the problem file and therefore blank. Putting the reader's own answer
       back is the first thing to do: submitting and finding the form empty
       reads as though the attempt was thrown away, and it makes "change your
       answer and try again" into "type it all in again". */
    if (answered && impl.restore) impl.restore(widget, answered.response);

    watchForChanges(widget);
    /* Marks from an attempt the reader has since edited would be pointing at
       a selection that no longer exists. */
    if (answered && !answerChanged) {
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

      /* Only one drag at a time, and a second pointerdown ends the first
         rather than running two. */
      endAnyDrag();

      try { bar.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      box.dataset.dragging = 'true';
      document.body.dataset.resizing = 'true';

      const move = ev => {
        const r = box.getBoundingClientRect();
        const { start, size } = axis(r);
        if (size <= 0) return;
        set((coord(ev) - start) / size);
        bar.setAttribute('aria-valuenow', String(Math.round(get() * 100)));
      };

      /* One cleanup, called by pointerup, by pointercancel, by Escape, by
         losing the capture, and by navigating away mid-drag. Anything that
         can end a drag has to end all of it — a left-behind
         [data-dragging] takes user-select with it and the page stops being
         selectable, which reads as "frozen". */
      const finish = () => {
        dragCleanup = null;
        try { bar.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        delete box.dataset.dragging;
        delete document.body.dataset.resizing;
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', finish);
        bar.removeEventListener('pointercancel', finish);
        bar.removeEventListener('lostpointercapture', finish);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('blur', finish);
        window.removeEventListener('keydown', onKey);
        const ed = codeEditor();
        if (ed) ed.refresh();
      };
      const onKey = ev => { if (ev.key === 'Escape') finish(); };

      dragCleanup = finish;
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', finish);
      bar.addEventListener('pointercancel', finish);
      bar.addEventListener('lostpointercapture', finish);
      /* The belt to the capture's braces: a pointerup that lands anywhere
         else — outside the window, on another element, after the capture was
         broken — still ends it. */
      window.addEventListener('pointerup', finish);
      window.addEventListener('blur', finish);
      window.addEventListener('keydown', onKey);
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
      panel.append(statementNode(p));

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
      reviewed:  'Self-reviewed',
    }[r.status] || 'Not started';
  }

  /* ---------------- the split, and focus mode ----------------

     The divider's position and whether focus mode is on are per-device view
     preferences, so they live under Store.pref rather than in the progress
     state - a bad value there could never cost a solve.

     The split is a CSS custom property rather than two inline widths, so one
     number drives both columns and the gutter stays put during a drag. */

  /* A fraction is the wrong unit on its own. 0.2-0.8 keeps either panel from
     vanishing on a wide screen, but a split of 0.8 saved on a 1920px monitor
     leaves 194px of editor at 1024px and about 110px at 800 — measured. So
     the fraction is the stored preference and these are the law: whatever is
     remembered, neither panel is ever narrower than this many pixels, and if
     the window is too small to honour both the fraction is ignored in favour
     of an even split. */
  const SPLIT_MIN = 0.2;
  const SPLIT_MAX = 0.8;
  const MIN_PANEL_PX = 320;   /* a readable statement, a usable editor */
  const MIN_EDITOR_PX = 180;  /* the results pane is allowed to be smaller */

  const prefFraction = (key, fallback) => {
    const v = Number(Store.pref(key, fallback));
    return Number.isFinite(v) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) : fallback;
  };

  /* Clamp a fraction so that neither side of `total` falls below `minPx`.
     When there is not room for both, half each is the least bad answer and
     the stored preference is left alone — shrinking the window must not
     quietly rewrite what the reader chose on their big screen. */
  function fitted(fraction, total, minPx) {
    if (!(total > 0)) return fraction;
    if (total < minPx * 2) return 0.5;
    const lo = minPx / total;
    const hi = 1 - minPx / total;
    return Math.min(hi, Math.max(lo, fraction));
  }

  const splitFraction = () => prefFraction('splitFraction', 0.42);
  const vSplitFraction = () => prefFraction('vSplitFraction', 0.62);

  /* What the layout should actually be right now, given the window. */
  function effectiveSplit() {
    const body = host && host.querySelector('.ws-body');
    const w = body ? body.getBoundingClientRect().width : 0;
    return fitted(splitFraction(), w, MIN_PANEL_PX);
  }

  function effectiveVSplit() {
    const right = host && host.querySelector('.ws-right');
    const h = right ? right.getBoundingClientRect().height : 0;
    return fitted(vSplitFraction(), h, MIN_EDITOR_PX);
  }

  function applySplit() {
    if (!host) return;
    const body = host.querySelector('.ws-body');
    if (body) body.style.setProperty('--split', String(effectiveSplit()));
    const right = host.querySelector('.ws-right');
    if (right) right.style.setProperty('--vsplit', String(effectiveVSplit()));
  }

  function setVSplit(fraction) {
    Store.setPref('vSplitFraction',
      Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, fraction)) * 1000) / 1000);
    applySplit();
    const ed = codeEditor();
    if (ed) ed.refresh();
  }

  function setSplit(fraction) {
    Store.setPref('splitFraction',
      Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, fraction)) * 1000) / 1000);
    applySplit();
    const ed = codeEditor();
    if (ed) ed.refresh();
  }

  /* Back to the defaults, and only the layout: progress, drafts, bookmarks
     and notes are a different kind of thing and are not touched. */
  function resetLayout() {
    Store.setPref('splitFraction', 0.42);
    Store.setPref('vSplitFraction', 0.62);
    Store.setPref('editorFontSize', 14);
    const ed = codeEditor();
    if (ed && ed.setFontSize) ed.setFontSize(14);
    applySplit();
    if (ed) ed.refresh();
    if (current && host && host.isConnected) draw();
    UI.toast('Layout reset. Your drafts and progress are untouched.', 'info');
  }

  /* A narrower window can make a remembered split illegal, and CodeMirror
     measures lazily, so both have to be told. One listener for the life of
     the page; it does nothing unless a workspace is on screen. */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!host || !host.isConnected) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!host || !host.isConnected) return;
      applySplit();
      const ed = codeEditor();
      if (ed) ed.refresh();
    }, 80);
  });

  /* Focus mode is "hide everything but the problem", so it is a preference
     that belongs to the reader and an *attribute* that belongs to the problem
     page. Keeping the two apart is the whole fix: the preference persists, the
     attribute is applied on arrival and removed on leaving. It used to be set
     once and never cleared, so pressing F inside a problem hid the navigation
     on every page of the site until you went back and pressed it again. */
  const focusOn = () => !!Store.pref('focusMode', false);

  const onProblemPage = () => !!(current && host && host.isConnected);

  function setFocus(on) {
    Store.setPref('focusMode', !!on);
    document.documentElement.toggleAttribute('data-focus', !!on && onProblemPage());
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
    document.documentElement.toggleAttribute('data-focus', focusOn() && onProblemPage());
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
    let kind = result.correct ? 'right' : (result.score > 0 ? 'part' : 'wrong');
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
    if (result.selfReview) next = 'Nothing has marked this. The rubric is below.';
    else if (result.correct) next = 'The Solution tab is open now.';
    else if (disclosed()) next = 'You can see the solution; try again whenever you like.';
    else next = 'Try again, take a hint, or read the prerequisites. Nothing has been revealed.';

    if (result.selfReview) kind = 'review';
    return el('div', { class: 'verdict', 'data-kind': kind,
      'data-stale': answerChanged ? 'true' : undefined }, [
      el('div', { class: 'verdict-head' }, [
        el('h4', { text: result.selfReview ? 'Saved, not marked'
        : result.correct ? 'Right' : (result.score > 0 ? 'Partly right' : 'Not right') }),
        /* Which attempt this is about. It says "Previous attempt" the moment
           the reader changes anything, so a verdict can never be read as a
           judgement on what is currently selected. */
        el('span', { class: 'verdict-when tiny faint',
          text: answerChanged ? 'Previous attempt' : 'This attempt' }),
      ]),
      el('p', { html: MD.renderInline(result.feedback || '') }),
      bits.length ? el('p', { class: 'award', text: bits.join(' · ') }) : null,
      el('p', { class: 'tiny faint' }, [next]),
      reviewing ? rubricNode() : null,
      attemptHistory(),
    ]);
  }

  /* ---------------- reviewing your own proof ----------------

     The one place on the site where the reader marks their own work, and
     the whole design is about keeping that honest. The rubric is a list of
     things a proof of THIS statement has to do; the model proof is behind
     a second, explicit action; and what gets recorded says Self-reviewed,
     never Solved. */
  function rubricNode() {
    const p = current;
    const pay = p.payload || {};
    const lines = pay.rubric || [];
    if (!lines.length) return null;

    const boxes = [];
    const list = el('ul', { class: 'rubric' }, lines.map((line, i) => {
      const cb = el('input', { type: 'checkbox', id: `rub-${i}` });
      boxes.push({ cb, line });
      cb.addEventListener('change', () => { done.disabled = false; });
      return el('li', {}, [cb, el('label', { for: `rub-${i}`, html: MD.renderInline(line) })]);
    }));

    const done = el('button', {
      class: 'btn btn-primary', type: 'button', id: 'reviewDone',
      onclick: () => {
        const ticked = boxes.filter(b => b.cb.checked).map(b => b.line);
        const award = Store.selfReview(p, { rubric: ticked });
        reviewing = false;
        answered = null;
        if (award.xp > 0) UI.toast(`+${award.xp} XP — recorded as self-reviewed.`, 'good');
        else UI.toast('Recorded as self-reviewed.', 'info');
        UI.refreshPurse();
        draw();
      },
    }, ['Record this as self-reviewed']);

    return el('div', { class: 'review-pane' }, [
      el('h4', { text: 'Check your proof against this' }),
      el('p', { class: 'tiny faint' }, [
        'Nothing here has read your proof. Tick what it genuinely does — this is '
        + 'your own record, and the status it writes is Self-reviewed, not Solved.',
      ]),
      list,
      el('div', { class: 'row', style: 'margin-top:.6rem' }, [
        done,
        disclosed() ? null : el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', id: 'showModel',
          onclick: doReveal,
        }, ['Show a model proof…']),
      ]),
    ]);
  }

  /* Everything before the latest one, folded away. Worth keeping: on a
     multi-select, what you tried last time is most of what you know. */
  function attemptHistory() {
    if (previousAttempts.length < 1) return null;
    return el('details', { class: 'verdict-history' }, [
      el('summary', { class: 'tiny faint',
        text: `${previousAttempts.length} earlier `
          + `${previousAttempts.length === 1 ? 'attempt' : 'attempts'}` }),
      el('ol', { class: 'tiny' }, previousAttempts.map((a, i) => el('li', {}, [
        el('strong', { text: a.result.correct ? 'Right' : (a.result.score > 0 ? 'Partly right' : 'Not right') }),
        ' — ',
        el('span', { html: MD.renderInline(a.result.feedback || '') }),
        el('span', { class: 'faint', text: ` (attempt ${i + 1})` }),
      ]))),
    ]);
  }

  /* "You have not answered yet" belongs beside the control, not only in a
     toast that slides away after three seconds. It clears itself as soon as
     the reader touches anything. */
  function sayNeedsAnswer(text) {
    clearNeedsAnswer();
    const widget = host && host.querySelector('#answerWidget');
    const anchor = host && (host.querySelector('.ws-toolbar-right') || widget);
    if (!anchor) return;
    const note = el('p', { class: 'needs-answer small', role: 'status', text });
    if (anchor.classList.contains('ws-toolbar-right')) anchor.before(note);
    else anchor.append(note);
    const go = () => clearNeedsAnswer();
    if (widget) {
      widget.addEventListener('change', go, { once: true });
      widget.addEventListener('click', go, { once: true });
      widget.addEventListener('input', go, { once: true });
    }
  }

  function clearNeedsAnswer() {
    if (!host) return;
    host.querySelectorAll('.needs-answer').forEach(n => n.remove());
  }

  /* A submission that never ran. Deliberately not a verdict: it has no
     score, no award and no "try again, nothing has been revealed", because
     nothing was judged. Saying "Not right" here would be a lie about the
     reader's answer, and it is the lie that makes a flaky runner feel like a
     flaky grader. */
  function executionFailureNode(blocked) {
    const where = blocked && blocked.backend
      ? Runners.label(blocked.backend)
      : null;
    return el('div', { class: 'verdict', 'data-kind': 'blocked' }, [
      el('h4', { text: where ? `Could not run — ${where}` : 'Could not run' }),
      el('p', { html: MD.renderInline((blocked && blocked.feedback) || 'Nothing could run this.') }),
      el('p', { class: 'tiny faint' }, [
        'Nothing was recorded against the problem and your work is still here. '
        + 'This is not a wrong answer — it is an attempt that never happened.',
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
         bonus for forgetting to tick a box. A toast alone is easy to miss, so
         it is also said next to the control, where the reader is looking. */
      const says = (impl.emptyMessage && impl.emptyMessage(widget, p)) || {
        mcq: 'Choose an option before submitting.',
        multi: 'Tick at least one option before submitting.',
        locate: 'Click the line you think is wrong before submitting.',
        order: 'Put the items in an order before submitting.',
        match: 'Pair every item before submitting.',
        numeric: 'Enter a number before submitting.',
        short: 'Type an answer before submitting.',
        predict: 'Type what you think it prints before submitting.',
      }[p.type] || 'Answer it first.';
      UI.toast(says, 'bad');
      sayNeedsAnswer(says);
      return;
    }
    clearNeedsAnswer();

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
    /* The whole solution goes in, not just the key: graders read
       solution.feedback to say why a wrong choice is wrong. */
    let result;
    try {
      result = await impl.grade(response, solution.key, p, solution);
    } catch (err) {
      /* A grader that throws must not leave Submit disabled for ever, and it
         is certainly not evidence that the answer was wrong. */
      restore();
      answered = null;
      lastBlocked = {
        feedback: `The grader failed: ${(err && err.message) || err}. Nothing was `
          + 'recorded, and your answer is still here.',
      };
      draw();
      return;
    }

    /* An answer the grader could not read is not a wrong answer either. A
       missing bracket in "{1,2" costs nothing: it is said beside the box,
       the text stays, and no attempt is recorded. */
    if (result.invalid) {
      restore();
      sayNeedsAnswer(result.feedback);
      impl.restore && impl.restore(widget, response);
      return;
    }

    /* A written proof is never marked by a machine. It is saved, and the
       reader is handed a rubric and — on request — a model proof. */
    if (result.selfReview) {
      restore();
      answered = { response, result, award: null };
      answerChanged = false;
      reviewing = true;
      resultTab = 'results';
      draw();
      return;
    }

    /* A submission that could not be run at all is not a wrong answer. If the
       judge is down, recording an attempt would quietly cost the first-try
       bonus for something that was never graded. */
    if (result.noAttempt) {
      restore();
      /* Deliberately not recorded as an attempt and not passed to the store:
         the runner being down must not cost a first-try bonus. */
      lastBlocked = result;
      impl.mark(widget, { response, key: solution.key, problem: p, solution, result });
      /* Put the reader in front of the explanation. On the workspace the
         result pane starts on Test cases, so a failed submission used to
         produce no visible change at all — the reason was sitting in a tab
         nobody had any reason to open. */
      resultTab = 'results';
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

    if (answered) previousAttempts.push(answered);
    answered = { response, result, award };
    /* The verdict on screen belongs to this submission, so any note that it
       is stale belongs to the one before it. */
    answerChanged = false;
    resultTab = 'results';
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
    /* On a written proof, revealing is not giving up - it is the step the
       verdict just told the reader to take, because nothing here can mark a
       proof and comparing against a model is the whole method. The generic
       warning ("score zero, recorded as read") reads as a penalty for doing
       the intended thing, so say what actually happens instead. */
    const ok = confirm(current.type === 'proof'
      ? 'Show a model proof?\n\n'
        + 'Your own attempt stays exactly as you wrote it. Read it against the '
        + 'rubric first - once you have seen the model proof, recording the '
        + 'review earns no XP, and the problem is marked Self-reviewed rather '
        + 'than solved. Nothing here can mark a proof either way.'
      : 'Reveal the answer?\n\n'
        + 'This problem will score zero and be recorded as read rather than solved. '
        + 'It stays in your list and you can still come back and work it properly.');
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
    open, leave, toggleFocus, setSplit, splitFraction, setVSplit, vSplitFraction,
    showResults, resetLayout,
  };
})();
