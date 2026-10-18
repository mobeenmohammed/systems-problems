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

  /* ---------------- assessment mode ----------------

     The same workspace, three differences, all of them things the
     reader is told about before the clock starts:

       · Hints, Notes and Solution are not there. An assessment with a
         Solution tab is not an assessment.
       · Submit records into the attempt. It does not touch XP, the
         streak, the problem's solved status or its submission history
         — a timed result is a different kind of evidence from a
         practice solve and mixing them would make both worth less.
       · Drafts go to the attempt, per problem and per language, via
         the hook in Store. Practice work on the same problem id is a
         separate thing and neither overwrites the other.

     `assess` is the whole of it: null in practice, an object with the
     attempt and the definition during one. */
  let assess = null;

  const inAssessment = () => !!assess;

  /* ---------------- answers that are not code ----------------

     The reported bug had two halves, and the second one is this.

     A code problem's answer is the editor's contents, and the editor has
     saved every keystroke to a draft since the day it was written. Every
     OTHER kind of answer — a ticked option, a predicted output, an
     ordering, a pairing, a chosen line — lived nowhere but in the DOM.
     In practice that is survivable: you answer and submit on one screen.
     Inside an assessment it is not, because moving to question 2 and
     back rebuilds the widget from the problem file, and a reload throws
     the page away entirely. The answer was simply gone, and the
     navigator could not show "written, not sent" either, because there
     was nothing written down to see.

     So every type now has a draft, in one slot, through the same hook
     the editor uses: in practice it goes to the problem's record, and
     during an attempt it goes to the attempt. One mechanism, no copies
     of the renderers, and the half-finished ordering you left on
     question 3 is still there when you come back to it.

     `code` and `proof` are excluded because they already save their own
     — the editor per language, the proof box under `proof` — and a
     second writer on the same answer is a race, not a backup. */
  const ANSWER_SLOT = '_answer';
  const SELF_SAVING = new Set(['code', 'proof']);

  const drafts = p => !SELF_SAVING.has(p.type);

  /* What to put back into a freshly rendered widget, newest first:

       the draft          what the reader last touched, which is the only
                          thing that can be newer than a submission;
       the recorded answer  inside an attempt, what was submitted — which
                          matters for the types whose widget has a
                          default position, because `order` collects an
                          answer from an untouched list and so never
                          writes a draft until something is dragged.

     Outside an attempt there is no recorded answer to fall back on: the
     practice store keeps verdicts, not responses. */
  function savedResponse(p) {
    if (!drafts(p)) return undefined;
    const raw = Store.draft(p.id, ANSWER_SLOT);
    if (raw) {
      try { return JSON.parse(raw); } catch { /* a draft we cannot read is no draft */ }
    }
    if (assess) {
      const ans = (assess.attempt.answers || {})[p.id];
      if (ans && ans.response != null) return ans.response;
    }
    return undefined;
  }

  /* Saved on the same three events that already mark a verdict stale,
     debounced, and only when the reader has actually touched something:
     collecting on render would write a draft for every `order` problem
     the moment it was opened, and the navigator would report every
     question as attempted before the reader had seen it. */
  let answerDraftTimer = null;
  /* The pending write, so that leaving, hiding the tab or reloading can
     push it out rather than let the debounce die with the page. Typing
     is the only thing debounced, and a reader who types an answer and
     immediately reloads is the case this exists for. */
  let flushAnswerDraft = null;

  function flushAnswers() {
    if (!flushAnswerDraft) return;
    clearTimeout(answerDraftTimer);
    const fn = flushAnswerDraft;
    try { fn(); } catch { /* the widget may already be gone */ }
  }

  /* Both, because they catch different exits: `pagehide` fires on a
     reload and on a close, `visibilitychange` on switching away — and
     on mobile, switching away is often the last event a page gets. */
  window.addEventListener('pagehide', flushAnswers);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAnswers();
  });

  function watchForAnswerDraft(widget) {
    const p = current;
    flushAnswerDraft = null;
    if (!widget || !p || !drafts(p)) return;
    const impl = ProblemTypes.get(p.type);
    if (!impl) return;

    const put = () => {
      if (!current || current.id !== p.id) return;
      let response = null;
      try { response = impl.partial(widget, p); } catch { return; }
      Store.saveDraft(p, ANSWER_SLOT, response == null ? '' : JSON.stringify(response));
      saveNote(response == null ? 'cleared' : 'saved');
    };
    /* Typing is debounced; a click is not.

       Everything here was debounced at first, and it lost answers. A
       tick, a drag, a pairing and a chosen line are each one discrete
       event with nothing to coalesce, so a 180ms wait buys nothing and
       costs the answer to anybody who ticks an option and reloads
       inside that window — which is exactly the test the brief asks
       for. Typing is the only case with a stream of events worth
       collapsing. */
    const soon = () => {
      clearTimeout(answerDraftTimer);
      answerDraftTimer = setTimeout(put, 180);
      saveNote('saving');
    };
    const atOnce = () => { clearTimeout(answerDraftTimer); put(); };

    widget.addEventListener('change', atOnce);
    widget.addEventListener('input', e => {
      /* `input` on a text box is typing; on a checkbox or a radio it is
         the same discrete event as `change`. */
      const t = e.target;
      const typed = t && (t.tagName === 'TEXTAREA'
        || (t.tagName === 'INPUT' && !['checkbox', 'radio'].includes(t.type)));
      if (typed) soon(); else atOnce();
    });
    /* locate, order and match are clicked rather than changed, and the
       click lands on a button inside the row. */
    widget.addEventListener('click', e => {
      if (e.target.closest('button, [data-line], .opt, li, .match-item')) atOnce();
    });
    /* A keyboard user moving an item with Enter on the up arrow fires a
       click, but one selecting a line with the arrow keys does not. */
    widget.addEventListener('keyup', e => {
      if (e.key && e.key.startsWith('Arrow')) atOnce();
    });

    flushAnswerDraft = put;
  }

  /* The save indicator. Three words, and they are three different
     facts: a write in flight, a write that landed, and a write that
     did not. */
  function saveNote(stateName) {
    const text = {
      saving: 'Saving…',
      saved: 'Saved',
      cleared: 'Cleared',
      failed: 'Save failed',
    }[stateName] || '';
    /* Beside the Submit button, and in the assessment's own header.
       The header is the one the brief asks for and the one that is
       always on screen; the other is where the eye already is. */
    for (const node of [
      host && host.querySelector('#answerSaved'),
      document.getElementById('oaSave'),
    ]) {
      if (!node) continue;
      node.dataset.state = stateName;
      node.textContent = text;
    }
  }

  /* ---------------- the feedback policy ----------------

     `feedback.duringAttempt` was printed on the pre-flight page and then
     never consulted. An assessment that says "nothing until you finish"
     and then prints "Not that one." under the question has told the
     reader something false about itself, which is worse than either
     policy would have been on its own.

     Two values, and the difference is what a submission is allowed to
     report back:

       samples   the visible cases, and nothing else. A submission says
                 it was recorded; it does not say whether it was right,
                 because that is decided by cases the reader cannot see.
       none      that it was recorded, and that is all.

     Either way an assessment never marks the widget, never explains a
     distractor and never reveals a key — those are practice-mode
     affordances and `mark()` exists precisely because a wrong answer in
     practice is allowed to say more than this. */
  const policy = () => (assess && assess.def && assess.def.feedback) || {};
  const tellsVerdict = () => !assess;

  /* The editor saves on every keystroke and reads on every mount, and
     both have to be synchronous — but an attempt lives in IndexedDB,
     which is not. So the attempt's drafts are copied into a plain map
     when the problem opens, the editor reads and writes that, and the
     writes go through to the durable store behind it.

     Losing a keystroke to a failed asynchronous write would be losing
     work under a clock, so the write-through is fire-and-forget and the
     map is the source of truth for the session. A reload reads the
     durable copy, which is at most one keystroke behind. */
  function wireAttemptDrafts(ctx) {
    const mem = ctx.drafts || (ctx.drafts = {});
    Store.useDraftStore({
      get: (id, lang) => (mem[id] || {})[lang || '_'] || '',
      set: (id, lang, src) => {
        mem[id] = mem[id] || {};
        mem[id][lang || '_'] = src;
        /* Fire-and-forget for the keystroke, but not for the outcome: a
           write that did not land is reported, because the alternative
           is a page quietly losing work under a clock. */
        Attempts.saveDraft(ctx.attempt.id, id, lang, src).then(r => {
          if (!r || r.ok === false) saveNote('failed');
        }).catch(() => saveNote('failed'));
        /* The navigator has a state for "written and not sent", and it
           is no use if it only appears after a submit — that is the
           one state it exists to show. */
        if (ctx.onDraft) ctx.onDraft(id);
      },
      setLang: (id, lang) => {
        ctx.langChoice = ctx.langChoice || {};
        ctx.langChoice[id] = lang;
        return lang;
      },
    });
  }

  /* Which tabs an attempt gets: the question, and nothing else.

     Hints and Solution are the two it obviously must not have. Notes is
     left out because a notes field that is kept and never shown again is
     a place to lose fifteen minutes.

     Prerequisites went too, and that was the reported change. A
     prerequisite is a reading recommendation — "you will want to have
     met integer promotion before this" — which is exactly the right
     thing to put in front of somebody learning and exactly the wrong
     thing to put in front of somebody being assessed: it names the
     topic the question is about. It is not deleted, it is moved: the
     review after the attempt links every question to its concepts and
     its reading, which is the moment that reading is worth anything. */
  const tabsNow = () => (assess
    ? LEFT_TABS.filter(t => t.id === 'problem')
    : LEFT_TABS);

  /* ---------------- entry ---------------- */

  /* Which open() is the current one.

     THE BUG THIS FIXES, with its stack:

       TypeError: Cannot read properties of null (reading 'replaceChildren')
         at draw (js/problem.js)
         at Object.open (js/problem.js)
         at async route (js/app.js)

     open() captures `host`, then awaits the problem's JSON. If the
     reader navigates away while that fetch is in flight — easy over a
     real network, which is why this showed up against the deployed
     site and not against localhost — the router calls leave(), which
     sets `host = null`. The fetch then lands, open() resumes, and
     draw() dereferences it.

     Reproduced deterministically by delaying the problem JSON by 2.5s
     and navigating away after 0.5s: four page errors in five trips.

     An epoch rather than a null check at each site, because the real
     condition is "this open() has been superseded" — which is also
     true when the reader opened a DIFFERENT problem while this one was
     loading, where `host` is not null but belongs to somebody else.
     Checked after every await. */
  let openEpoch = 0;

  async function open(id, mount, opts = {}) {
    /* Opening is leaving the last one first: a second problem must not
       inherit the first one's editor, verdict or attempt history. */
    leave();

    const mine = (openEpoch += 1);
    const current_ = () => openEpoch === mine && host === mount && !!host;

    host = mount;
    assess = opts.assess || null;
    if (assess) wireAttemptDrafts(assess);
    activeTab = 'problem';
    answered = null;
    previousAttempts = [];
    answerChanged = false;
    reviewing = false;
    lastBlocked = null;
    solutionShown = false;
    attempting = false;
    solution = null;
    myRun = null;
    myNote = '';

    host.replaceChildren(el('p', { class: 'muted', text: 'Loading…' }));

    /* An assessment question, by id, while that very assessment is
       running. The route works — the bank is registered by id — and on
       the practice page it would come with a Hints tab and a Solution
       tab, which is the one place in the site where a URL hands over an
       answer that is currently being asked for under a clock.

       Refused, with the way back. Not silently redirected: a reader who
       typed or bookmarked that URL should be told what happened. */
    if (!assess && Catalog.isPooled(id) && typeof Attempts !== 'undefined') {
      const live = await Attempts.running();
      if (!current_()) return;
      if (live && (live.problems || []).includes(id)) {
        host.replaceChildren(el('div', { class: 'empty' }, [
          el('h2', { text: 'That question is in the assessment you are sitting' }),
          el('p', { class: 'muted' }, ['It has hints and a solution on this page, '
            + 'and your attempt is still open, so it is not shown here until the '
            + 'attempt is finished.']),
          el('a', { class: 'btn btn-primary', href: `#/assess/${live.assessmentId}/go` },
            ['Back to the attempt']),
        ]));
        return;
      }
    }

    const problem = await Catalog.get(id);
    /* The reader left while that was in the air. Everything below
       belongs to a page that is no longer on screen. */
    if (!current_()) return;
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
    if (!assess && (r.status === 'solved' || r.status === 'read' || r.revealed)) {
      solution = await Catalog.solution(problem.id);
      if (!current_()) return;
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
    /* Anything still loading now belongs to a page nobody is looking
       at. Bumping the epoch is what makes it return quietly instead of
       painting into a host that is about to be null. */
    openEpoch += 1;

    /* Before anything is torn down: a debounced answer that has not been
       written yet is work, and going to the next question must not be the
       thing that loses it. */
    flushAnswers();
    flushAnswerDraft = null;
    endAnyDrag();

    /* CodeMirror holds listeners on the document and a mutation observer on
       its own DOM. Hiding the view does not stop any of that, and thirty
       crossings used to leave thirty of them. */
    for (const id of WORKSPACE_TYPES) {
      const impl = ProblemTypes.get(id);
      if (impl && impl.teardown) impl.teardown();
    }

    delete document.body.dataset.workspace;
    document.documentElement.removeAttribute('data-focus');

    /* Hand the drafts back to the practice store. Left in place, every
       problem opened after an attempt would read and write that
       attempt's drafts. */
    if (assess) { Store.useDraftStore(null); assess = null; }

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

  /* Open a pane from inside a type module.

     A run whose only visible effect is in a tab nobody opened has no
     visible effect, so every run opens Results before it starts — and
     the type cannot do that itself, because the strip belongs to the
     page. */
  function openPane(id) {
    if (!current || !host || !host.isConnected) return;
    if (!workTabs().some(t => t.id === id)) return;
    if (workTab === id) { repaintPane(); return; }
    setWorkTab(id);
  }

  /* Repaint whatever pane is open. Called by a type when its own
     state changed — a simulation came back — rather than redrawing the
     whole workspace, which would rebuild the editor underneath it. */
  function repaintPane() {
    if (!host || !host.isConnected) return;
    if (workTab === 'editor') return;
    const pane = host.querySelector('#resultPane');
    if (pane) fillResultPane(pane);
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
    /* Never, under a clock. An assessment problem has no practice record
       to be solved or revealed, so this was already false by accident —
       but "by accident" is not a disclosure policy, and a problem that
       appears in both pools would have leaked its own answer key into an
       attempt. */
    if (assess) return false;
    const r = Store.record(current.id);
    return r.status === 'solved' || r.status === 'read' || !!r.revealed;
  };

  const finished = () => {
    const r = Store.record(current.id);
    return r.status === 'solved' || r.status === 'read';
  };

  const rewarded = () => Store.record(current.id).status === 'solved';

  /* ---------------- an assessment question, outside an assessment ----

     The bank is reachable by id — that is how the attempt renders it
     with no changes at all — and the review afterwards links straight
     to it, which is right: once the clock has stopped the question is
     readable like any other, with its solution and its explanation.

     What must not happen is that reading it there counts for anything.
     An assessment question solved on the practice page would award XP,
     set a solved status and add a row to a submission history, for a
     problem the catalogue does not contain and no count includes — so
     the totals would stop adding up, and sitting the same assessment
     twice would pay twice. Grading still happens and still reports;
     the reward does not. */
  const pooled = () => !!(current && Catalog.isPooled(current.id));

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

  /* One strip across the top of the right column, the editor among them.
     It used to be a horizontal split: editor above, results below, with a
     divider. That gave the editor about half a column to live in and gave
     the sample cases a permanent seat they did not earn — they are read
     once and then not again. As tabs, whichever one you are looking at
     has the whole column.

     The language picker is injected after Editor, because it belongs to
     the editor rather than to the strip. */
  const WORK_TABS = [
    { id: 'editor',   label: 'Editor' },
    { id: 'results',  label: 'Results' },
    { id: 'cases',    label: 'Test cases' },
    { id: 'subs',     label: 'Submissions' },
    { id: 'compiler', label: 'Compiler output' },
  ];

  /* A type may supply its own strip. The hardware exercises need six
     tabs rather than five — a read-only testbench beside the design,
     and waveforms — and the alternative was a flag per tab here, which
     is how a page ends up knowing about every type in the catalogue.

     Asked of the type rather than branched on the type's name, so the
     next one that needs a different strip needs nothing here. */
  function workTabs() {
    const impl = current && ProblemTypes.get(current.type);
    return (impl && impl.TABS) || WORK_TABS;
  }

  /* Which types own the window: an editor and a result pane side by
     side, rather than a statement with an answer under it. */
  const WORKSPACE_TYPES = new Set(['code', 'hdl']);
  const isWorkspace = p => WORKSPACE_TYPES.has(p.type);

  let workTab = 'editor';

  function draw() {
    /* The last line of defence. Everything that calls draw() should
       already have checked, and this is here because the symptom of
       one that did not is an uncaught TypeError in the console and a
       half-painted page — which is a worse way to find out than a
       quiet return and a test that catches it. */
    if (!host || !current) return;
    const p = current;
    const workspace = isWorkspace(p);
    /* A tab the previous problem had and this one does not. Left alone
       it would paint an empty pane and leave the strip with nothing
       selected. */
    if (!workTabs().some(t => t.id === workTab)) workTab = 'editor';
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

  /* The editor of whatever type is on screen. It used to ask the code
     type unconditionally, which was right while that was the only type
     with one. */
  const codeEditor = () => {
    const impl = current ? ProblemTypes.get(current.type) : null;
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

    /* Inside an attempt almost all of this is wrong. There is no
       position in the catalogue, because the problem is not in the
       catalogue; there is no previous or next, because the navigator
       in the assessment's own bar is the only correct way through;
       the practice status is a status this problem does not have; and
       bookmarking it would be filing an assessment question away to
       practise later, which is the one thing an assessment bank must
       not become. What is left is the title, the difficulty, the font
       size and focus mode — all of which still make sense under a
       clock. */
    if (assess) {
      return el('header', { class: 'ws-head', 'data-mode': 'assessment' }, [
        el('div', { class: 'ws-head-mid' }, [
          el('h1', { class: 'ws-title', title: p.title, text: p.title }),
          el('span', { class: `diff diff-${p.difficulty}`, text: diff.label }),
          el('span', { class: 'tiny faint', text: `question ${
            assess.def.problems.indexOf(p.id) + 1} of ${assess.def.problems.length}` }),
        ]),
        /* No Focus button. An attempt is already the whole window with
           the site's navigation taken away, so a control offering to do
           that is a control that does nothing — and one that can be
           pressed to no visible effect is worse than one that is not
           there. The font size stays: it is about being able to read
           the code, which matters more under a clock, not less. */
        el('div', { class: 'ws-head-right' }, [
          isWorkspace(p) ? fontSizeControl() : null,
        ]),
      ]);
    }

    /* The same problem read after the assessment is over. There is no
       position in the catalogue because the problem is not in it — the
       header said `0/109` before this branch existed — and there is no
       practice status either, because nothing done here is recorded. */
    const fromBank = pooled();

    return el('header', { class: 'ws-head', 'data-mode': fromBank ? 'bank' : undefined }, [
      el('div', { class: 'ws-head-left' }, fromBank ? [
        el('a', { class: 'ws-back', href: '#/assess', title: 'Assessments' }, ['←']),
      ] : [
        el('a', { class: 'ws-back', href: '#/problems', title: 'All problems' }, ['←']),
        navBtn(n.prev, '‹', 'Previous'),
        el('span', { class: 'ws-count tiny faint', text: `${n.at}/${n.total}` }),
        navBtn(n.next, '›', 'Next'),
      ]),

      el('div', { class: 'ws-head-mid' }, [
        el('h1', { class: 'ws-title', title: p.title, text: p.title }),
        el('span', { class: `diff diff-${p.difficulty}`, text: diff.label }),
        fromBank
          ? el('span', { class: 'status-word status-bank',
              title: 'From an assessment. You can work through it and read the '
                + 'solution; nothing here is scored, and it does not appear in '
                + 'the catalogue or any of its counts.',
              text: 'Assessment question' })
          : el('span', { class: `status-word status-${r.status}`, text: statusWord(r) }),
      ]),

      el('div', { class: 'ws-head-right' }, [
        isWorkspace(p) ? fontSizeControl() : null,
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

  /* ---------------- reporting a problem with a problem ----------------

     A wrong expected output, a statement that contradicts its own
     cases, a testbench that is stricter than the words — these happen,
     and the reader is the only person who will ever notice. What they
     need is somewhere to put it that does not lose the details they
     would otherwise have to go and look up.

     So it prepares a report and puts it on the clipboard. It does NOT
     send anything: there is no backend here, nothing is posted
     anywhere, and a feature that quietly transmitted what somebody was
     working on would be a worse thing than the bug it was reporting.

     The source code is included only if the reader ticks the box. It
     is often exactly what makes a report useful and it is also their
     work, so it is their decision, made each time, rather than a
     setting somebody turned on once. */
  /* FNV-1a over the fields a reader could be looking at. Eight hex
     digits: enough to tell two versions of one exercise apart, which is
     all it is for, and not a security claim. */
  function fingerprint(p) {
    const text = JSON.stringify([p.id, p.title, p.statement, p.payload, p.hints]);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function reportNode() {
    const p = current;
    const r = Store.record(p.id);
    const impl = ProblemTypes.get(p.type);
    /* Asked for lazily. The header — and this menu with it — is built
       before the editor is mounted, so `codeEditor()` is null at this
       moment and gating the checkbox on it meant a problem with an
       editor never offered to include the code. */
    const hasEditor = isWorkspace(p);
    const editorNow = () => codeEditor();

    const what = el('textarea', {
      class: 'report-what', rows: '4', id: 'reportWhat',
      placeholder: 'What is wrong? For example: the statement says the counter wraps, '
        + 'but the third sample case expects it to saturate.',
    });
    const withCode = el('input', { type: 'checkbox', id: 'reportCode' });
    const note = el('span', { class: 'tiny faint', id: 'reportNote' });

    const build = () => {
      const lines = [
        `Problem:  ${p.id}`,
        `Title:    ${p.title}`,
        /* Problems do not carry a version number, and adding one to a
           hundred and thirteen files would mean remembering to bump it.
           A fingerprint of the content answers the question a version
           number is asked for — "is this the same exercise I was
           looking at?" — and cannot be forgotten. */
        `Version:  ${p.version != null ? `${p.version} ` : ''}content ${fingerprint(p)}`,
        `Type:     ${p.type}`,
        `Topic:    ${p.topic}`,
      ];
      const ed = editorNow();
      if (ed) {
        const lang = ed.lang || ((p.payload || {}).langs || [])[0] || null;
        if (lang) lines.push(`Language: ${Catalog.LANG_LABEL[lang] || lang}`);
      }
      const engine = lastRun && lastRun.backend ? lastRun.backend : null;
      lines.push(`Runtime:  ${engine ? Runners.label(engine) : 'nothing has run yet'}`);
      lines.push(`Status:   ${statusWord(r)}${r.attempts ? `, ${r.attempts} attempts` : ''}`);
      lines.push(`Page:     ${location.href}`);
      lines.push(`When:     ${new Date().toISOString()}`);
      lines.push('');
      lines.push('What is wrong:');
      lines.push(what.value.trim() || '(nothing written)');
      if (withCode.checked && ed && ed.value) {
        lines.push('');
        lines.push('My code at the time:');
        lines.push('```');
        lines.push(String(ed.value || ''));
        lines.push('```');
      }
      return lines.join('\n');
    };

    return el('details', { class: 'report' }, [
      el('summary', { class: 'tiny' }, ['Report a problem with this exercise']),
      el('div', { class: 'report-body' }, [
        el('p', { class: 'tiny faint', text: 'This prepares a report and copies it. '
          + 'Nothing is sent anywhere — there is no server here to send it to.' }),
        what,
        hasEditor ? el('label', { class: 'tiny' }, [
          withCode, ' Include the code currently in the editor',
        ]) : null,
        el('div', { class: 'row', style: 'gap:.4rem;align-items:center;margin-top:.4rem' }, [
          el('button', {
            class: 'btn btn-sm', type: 'button', id: 'reportCopy',
            onclick: async () => {
              const text = build();
              let copied = false;
              try {
                await navigator.clipboard.writeText(text);
                copied = true;
              } catch { /* no permission, or an insecure origin */ }
              note.textContent = copied
                ? 'Copied. Paste it wherever you keep these.'
                : 'Could not reach the clipboard — the report is below, select and copy it.';
              const out = host && host.querySelector('#reportOut');
              if (out) { out.textContent = text; out.hidden = copied; }
            },
          }, ['Copy the report']),
          note,
        ]),
        el('pre', { class: 'report-out', id: 'reportOut', hidden: true }),
      ]),
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

      el('hr', { class: 'ws-menu-rule' }),
      reportNode(),

      isWorkspace(p) ? el('div', {}, [
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

    /* Switching the statement for the hints must not rebuild the editor
       beside it; only the pane that changed is repainted. */
    const left = el('section', { class: 'ws-left' }, [
      tabStrip(tabsNow(), activeTab, setLeftTab),
      el('div', { class: 'ws-pane', id: 'leftPane' }),
    ]);
    fillLeftPane(left.querySelector('#leftPane'));

    /* The editor stays in the DOM whichever tab is showing: CodeMirror
       holds the undo history, the cursor and the scroll position, and
       rebuilding it to look at the test cases would throw all three away.
       Only one of the two is visible at a time — see .ws-right[data-pane]. */
    const right = el('section', { class: 'ws-right', 'data-pane': workTab === 'editor' ? 'editor' : 'result' }, [
      workStrip(),
      el('div', { class: 'ws-editor', id: 'wsEditor' }),
      el('div', { class: 'ws-pane', id: 'resultPane' }),
      el('div', { class: 'ws-foot', id: 'wsFoot' }),
    ]);

    const body = el('div', { class: 'ws-body' }, [left, vGutter(), right]);
    const wrap = el('div', { class: 'ws' }, [header(), body]);

    /* The widget is mounted after the frame exists, so CodeMirror is created
       inside a box that already has its final size. */
    queueMicrotask(() => {
      const slot = wrap.querySelector('#wsEditor');
      const bar = wrap.querySelector('#wsFoot');
      if (!slot || !bar) return;
      mountAnswer(slot, bar);
      fillResultPane(wrap.querySelector('#resultPane'));
      applySplit();
      const ed = codeEditor();
      if (ed) ed.refresh();
    });

    return wrap;
  }

  /* The work strip, with a slot for the language picker after Editor.
     code.js builds the picker, because it is the thing that knows which
     languages a problem takes and which of them can actually run. */
  function workStrip() {
    const strip = tabStrip(workTabs(), workTab, setWorkTab, 'ws-tabs ws-tabs-work');
    const editorTab = strip.querySelector('[data-tab="editor"]');
    if (editorTab) editorTab.after(el('div', { class: 'ws-lang-slot', id: 'langSlot' }));
    return strip;
  }

  function setWorkTab(id) {
    workTab = id;
    const right = host && host.querySelector('.ws-right');
    if (!right) { draw(); return; }
    right.dataset.pane = id === 'editor' ? 'editor' : 'result';
    for (const b of right.querySelectorAll('.ws-tabs-work .tab')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === id));
    }
    if (id === 'editor') {
      /* CodeMirror was measured in a hidden box; it has to look again. */
      const ed = codeEditor();
      if (ed) ed.refresh();
    } else {
      fillResultPane(right.querySelector('#resultPane'));
    }
  }

  function setLeftTab(id) {
    activeTab = id;
    const strip = host && host.querySelector('.ws-left .ws-tabs');
    const pane = host && host.querySelector('#leftPane');
    if (!strip || !pane) { draw(); return; }
    for (const b of strip.querySelectorAll('.tab')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === id));
    }
    fillLeftPane(pane);
  }

  function tabStrip(tabs, active, onPick, cls = 'ws-tabs') {
    const strip = el('div', { class: cls, role: 'tablist' });
    for (const t of tabs) {
      const shut = t.id === 'solution' && !disclosed();
      const r = Store.record(current.id);
      const subs = t.id === 'subs' ? Store.submissions(current.id).length : 0;
      const badge = t.id === 'hints' && (current.hints || []).length
        ? `${r.hintsUsed}/${current.hints.length}`
        : (subs ? String(subs) : null);
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

  /* ---------------- a project, and where you are in it ----------------

     A milestone on its own looks like an ordinary exercise with an odd
     title. The strip says what it is part of, which step this is, and
     what the others are — with the one you are on marked and the ones
     you have finished ticked, so "showing milestone progress" is a
     thing you can see rather than a claim.

     The siblings come from the catalogue, which carries `project` in
     the index, so this needs nothing loaded that is not already here. */
  function projectStrip(p) {
    const meta = p.project;
    if (!meta || !meta.id) return null;

    const steps = Catalog.all()
      .filter(x => x.project && x.project.id === meta.id)
      .sort((a, b) => (a.project.step || 0) - (b.project.step || 0));
    if (steps.length < 2) return null;

    const done = steps.filter(x => Store.record(x.id).status === 'solved').length;

    return el('div', { class: 'proj', 'data-of': String(steps.length) }, [
      el('div', { class: 'proj-head' }, [
        el('span', { class: 'proj-kind tiny', text: 'Project' }),
        el('span', { class: 'proj-title', text: meta.title || meta.id }),
        el('span', { class: 'tiny faint', text: `${done} of ${steps.length} done` }),
      ]),
      el('ol', { class: 'proj-steps' }, steps.map((x) => {
        const here = x.id === p.id;
        const solved = Store.record(x.id).status === 'solved';
        const label = (x.project && x.project.label) || x.title;
        const inner = [
          el('span', { class: 'proj-n', text: solved ? '✓' : String(x.project.step) }),
          el('span', { class: 'proj-label', text: label }),
        ];
        return el('li', { class: 'proj-step', 'data-here': String(here),
          'data-state': solved ? 'solved' : Store.record(x.id).status }, [
          here
            ? el('span', { class: 'proj-link', 'aria-current': 'step' }, inner)
            : el('a', { class: 'proj-link', href: `#/p/${x.id}`, title: x.title }, inner),
        ]);
      })),
      el('p', { class: 'tiny faint proj-note', text:
        'Your files are carried forward from one milestone to the next, and each '
        + 'one re-runs what the ones before it asked for.' }),
    ]);
  }

  function fillLeftPane(pane) {
    if (!pane) return;
    pane.replaceChildren();
    ({
      problem:  panel => {
        const strip = projectStrip(current);
        if (strip) panel.append(strip);
        panel.append(statementNode(current));
      },
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
    impl.render(p, widget, {
      locked: false,
      disclosed: disclosed(),
      assess: !!assess,
      policy: policy(),
    });

    /* The bar across the bottom of the column. It is the same two buttons
       for every problem, in the same place, and it does not scroll away
       with the editor. Reset is down here with them rather than inside
       the editor panel: it is one of the three things you can do to a
       program, and the other two are already here. */
    bar.replaceChildren(
      el('div', { class: 'ws-foot-left' }, [
        /* Reset throws away everything written since the problem was
           opened, which on a half-finished design is the afternoon.
           It asks first, and the question says how much is at stake
           rather than asking in the abstract — and it does not ask at
           all when there is nothing to lose. */
        impl.multiFile && impl.multiFile() ? resetMenu(impl) : el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', id: 'resetBtn',
          title: 'Put the starting template back',
          onclick: () => {
            if (!impl.resetTemplate) return;
            const ed = codeEditor();
            const now = ed ? String(ed.value || '') : '';
            const starter = impl.startingSource ? impl.startingSource(p) : null;
            const untouched = starter != null && now.trim() === String(starter).trim();
            if (!untouched && now.trim()) {
              const lines = now.split('\n').length;
              const ok = confirm(
                'Put the starting template back?\n\n'
                + `This replaces the ${lines} line${lines === 1 ? '' : 's'} in the editor `
                + 'with the template the problem came with. It cannot be undone from '
                + 'here, and the draft is overwritten.\n\n'
                + 'Your submissions are kept either way.');
              if (!ok) return;
            }
            impl.resetTemplate();
          },
        }, ['Reset']),
        el('span', { class: 'tiny faint', id: 'draftNote' }, ['']),
      ]),
      el('div', { class: 'ws-foot-right' }, [
        el('span', { class: 'ws-exec', id: 'execState' }),
        /* Shown only when the language in front of the reader cannot run.
           code.js unhides it, because it is the thing that knows. Editing
           stays available the whole time — not being able to run something
           is no reason to stop someone writing it. */
        /* "Set up execution" was the wrong label once the browser could
           compile everything: it reads as a requirement, and on the
           overwhelming majority of problems there is nothing to set up.
           It is hidden whenever the language in front of the reader
           runs — which is now almost always — and when it does appear
           it is a link to an explanation of why this particular
           exercise is the exception, not an instruction to install
           anything. */
        el('a', {
          class: 'btn btn-sm btn-ghost ws-setup', id: 'setupLink', href: '#/setup',
          hidden: true,
          title: 'Why this exercise cannot run in the browser, and what else is possible',
        }, ['Why not here?']),
        el('button', {
          class: 'btn btn-sm btn-ghost ws-stop', type: 'button', id: 'stopBtn', hidden: true,
          title: 'Stop whatever is running or downloading',
          onclick: () => { if (impl.stop) impl.stop(); },
        }, ['Stop']),
        el('button', {
          class: 'btn btn-sm btn-run', type: 'button', id: 'runBtn',
          onclick: () => impl.run && impl.run(false),
          title: p.type === 'hdl'
            ? 'Compile your design with the sample testbench and simulate it'
            : 'Run the visible sample cases',
        }, [p.type === 'hdl' ? 'Run simulation' : 'Run tests']),
        el('button', {
          class: 'btn btn-sm btn-primary', type: 'button', id: 'submitBtn',
          onclick: doSubmit,
        }, ['Submit']),
      ]),
    );

    /* The language picker the type module built belongs in the tab strip,
       beside Editor: it is which language the editor is in. */
    const pick = widget.querySelector('.lang-pick');
    const slotFor = host && host.querySelector('#langSlot');
    if (pick && slotFor) slotFor.append(pick);
    /* The judge-state box stays in the editor panel but is hidden by CSS
       while everything is fine — the toolbar chip is enough then. When
       something cannot run it reappears, because "No runner" on its own does
       not tell anybody which runner or what to do about it. */

    repaintMarks(widget);
  }

  /* Reset, on a workspace, is two different actions and they are not
     close in size. One puts this file back; the other puts every file
     back, which on a project is the afternoon. Offering them as one
     button and a confirm dialog means the dangerous one is the default
     and the question is the only thing standing in front of it.

     So: a small menu, each entry saying what it would cost, and the
     one that costs nothing right now disabled rather than hidden —
     because a reader looking for Reset should find it where it was,
     not discover that it has gone because there is nothing to reset. */
  function resetMenu(impl) {
    const body = el('div', { class: 'ws-menu-body' });

    /* Filled when it is opened, never once at build time. The bar is
       built when the problem is drawn and the files change under it
       all afternoon; a menu saying "1 of 3 changed" about a workspace
       where two have changed is a warning with the wrong number in
       it, which is worse than no number. */
    const fill = () => {
      const cost = (impl.resetCost && impl.resetCost()) || { changed: [], total: 0 };
      const n = cost.changed.length;

      const entry = (label, note, scope, enabled) => el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button',
        'data-scope': scope,
        disabled: enabled ? undefined : true,
        onclick: () => {
          const ask = scope === 'file'
            ? `Put ${cost.file} back as the exercise shipped it?\n\n`
              + 'The other files are left alone, and this cannot be undone from here.'
            : `Put all ${cost.total} files back as the exercise shipped them?\n\n`
              + `${n} ${n === 1 ? 'file has' : 'files have'} been changed — `
              + `${cost.changed.join(', ')} — and the changes are overwritten. `
              + 'Your submissions are kept either way.';
          if (!confirm(ask)) return;
          impl.resetTemplate(scope);
          const menu = host && host.querySelector('.ws-reset');
          if (menu) menu.open = false;
          draw();
        },
      }, [el('span', {}, [label]), el('span', { class: 'tiny faint', text: note })]);

      body.replaceChildren(
        entry('This file', cost.fileChanged
          ? `${cost.file} — changed`
          : `${cost.file} — unchanged`, 'file', cost.fileChanged),
        entry('Every file', n
          ? `${n} of ${cost.total} changed`
          : `all ${cost.total} unchanged`, 'all', n > 0),
        el('p', { class: 'tiny faint', style: 'margin:.3rem 0 0',
          text: 'Submissions and progress are kept either way.' }),
      );
    };

    const menu = el('details', { class: 'ws-menu ws-reset' }, [
      el('summary', { class: 'btn btn-sm btn-ghost', id: 'resetBtn',
        title: 'Put starter files back' }, ['Reset']),
      body,
    ]);
    menu.addEventListener('toggle', () => { if (menu.open) fill(); });
    fill();
    return menu;
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
       a selection that no longer exists.

       And never under a clock. `mark()` is deliberately allowed to say
       more than nothing — it paints the option you picked as wrong,
       which in practice is the point and in an assessment is a verdict
       the policy may not have promised. */
    if (answered && !answerChanged && tellsVerdict()) {
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

    /* A type with its own tabs fills its own panes. It returns true
       when it handled the tab, so a type can take some and leave the
       rest — the hardware type takes its testbench, results, waveforms
       and diagnostics, and leaves Submissions to the shared code
       below, which is the same list of submitted programs either way. */
    const own = current && ProblemTypes.get(current.type);
    if (own && own.fillPane && own.fillPane(pane, workTab, current)) return;

    if (workTab === 'cases') {
      const cases = ((current.payload || {}).cases) || [];
      pane.append(el('h5', { class: 'cases-head', text: 'The problem\u2019s samples' }));
      if (!cases.length) {
        pane.append(el('p', { class: 'muted small', text: 'This problem has no visible sample cases.' }));
      } else {
        pane.append(el('p', { class: 'tiny faint', text:
          `${cases.length} sample ${cases.length === 1 ? 'case' : 'cases'}. `
          + 'Run uses these; Submit also runs hidden ones.' }));
        cases.forEach((c, i) => {
          pane.append(el('div', { class: 'case' }, [
            el('div', { class: 'case-head' }, [el('span', { text: `Case ${i + 1}` })]),
            el('div', { class: 'io' }, [
              el('div', {}, [el('h5', { text: 'stdin' }), el('pre', { text: c.stdin || '(none)' })]),
              el('div', {}, [el('h5', { text: 'expected' }), el('pre', { text: c.expect || '(nothing)' })]),
            ]),
          ]));
        });
      }
      pane.append(myCasesNode());
      return;
    }

    if (workTab === 'subs') { fillSubmissions(pane); return; }

    if (workTab === 'results') {
      if (lastBlocked) { pane.append(executionFailureNode(lastBlocked)); return; }
      if (!lastRun && !answered) {
        pane.append(el('p', { class: 'muted small', text: 'Press Run tests, or Submit.' }));
        return;
      }
      if (answered) {
        pane.append(tellsVerdict() ? verdictNode(answered) : attemptStateNode(current));
      }
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

  /* ---------------- inputs of your own ----------------

     The samples answer "does it work on the example". The question
     somebody actually has at the keyboard is "what does it do on
     THIS", and until now the only way to ask it was to edit the
     program to hard-code the input, run, and edit it back.

     So: a list of stdin values that belong to the reader, kept with
     their draft, under the same problem id, in the same store. They
     are run through the same engine as everything else and they are
     NOT graded — there is no expected output here, because inventing
     one would be inventing an answer. The output is shown and that is
     all. Submit does not know these exist.

     Kept in the draft store under a reserved slot, like the answer
     drafts: it survives a reload, it travels in an export, and inside
     an assessment it goes to the attempt rather than to the practice
     record, which is what a reader scratching at a timed problem
     would expect. */
  const CASES_SLOT = '_mycases';

  function myCases() {
    const raw = Store.draft(current.id, CASES_SLOT);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map(String) : [];
    } catch { return []; }
  }

  function setMyCases(list) {
    Store.saveDraft(current, CASES_SLOT, JSON.stringify(list.map(String)));
  }

  /* The last run of the reader's own inputs, so changing tabs does not
     throw the output away.

     myNote is the message beside the buttons, and it is state rather
     than a DOM write for one reason: the moment a run finishes, the
     pane is repainted to show the outputs, which builds a fresh empty
     note element. Writing the result into the old one and then
     repainting means the reader never sees the sentence that says what
     happened. Progress during the run goes straight to the node
     because nothing repaints while it is in flight; anything that
     outlives the run goes here. */
  let myRun = null;
  let myNote = '';

  function myCasesNode() {
    const p = current;
    const impl = ProblemTypes.get(p.type);
    const list = myCases();

    const wrap = el('div', { class: 'mycases' }, [
      el('h5', { class: 'cases-head' }, ['Your own inputs']),
      el('p', { class: 'tiny faint' }, [
        'Anything you want to try. These are yours, they are kept with your '
        + 'draft, and they are never graded \u2014 there is no expected output, '
        + 'so this shows you what your program does and nothing more. Submit '
        + 'does not use them.',
      ]),
    ]);

    const rows = el('div', { class: 'mycase-list' });
    list.forEach((stdin, i) => {
      const box = el('textarea', {
        class: 'mycase-in', rows: String(Math.min(6, Math.max(2, stdin.split('\n').length))),
        spellcheck: 'false',
        'aria-label': `Input ${i + 1}`,
        placeholder: 'what to feed the program on stdin',
      });
      box.value = stdin;
      let t = null;
      box.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const next = myCases();
          next[i] = box.value;
          setMyCases(next);
        }, 250);
      });

      const got = myRun && myRun.id === p.id ? (myRun.cases || [])[i] : null;
      rows.append(el('div', { class: 'mycase' }, [
        el('div', { class: 'mycase-top' }, [
          el('span', { class: 'tiny faint', text: `Input ${i + 1}` }),
          el('button', {
            class: 'btn btn-sm btn-ghost', type: 'button',
            title: 'Remove this input',
            'aria-label': `Remove input ${i + 1}`,
            onclick: () => {
              const next = myCases();
              next.splice(i, 1);
              setMyCases(next);
              repaintPane();
            },
          }, ['Remove']),
        ]),
        box,
        got ? el('div', { class: 'mycase-out' }, [
          el('h5', { text: got.timedOut ? 'timed out' : got.exit ? `exit ${got.exit}` : 'output' }),
          el('pre', { text: (got.stdout || '').trim() || '(nothing)' }),
          (got.stderr || '').trim()
            ? el('pre', { class: 'diff-bad', text: got.stderr.trim() }) : null,
        ].filter(Boolean)) : null,
      ].filter(Boolean)));
    });
    wrap.append(rows);

    wrap.append(el('div', { class: 'row', style: 'gap:.4rem;flex-wrap:wrap;margin-top:.5rem' }, [
      el('button', {
        class: 'btn btn-sm', type: 'button', id: 'addMyCase',
        onclick: () => { setMyCases([...myCases(), '']); repaintPane(); },
      }, ['Add an input']),
      list.length ? el('button', {
        class: 'btn btn-sm btn-primary', type: 'button', id: 'runMyCases',
        onclick: () => runMyCases(),
      }, ['Run my inputs']) : null,
      el('span', { class: 'tiny faint', id: 'myCasesNote', text: myNote }),
    ].filter(Boolean)));

    if (!impl || !impl.collect) {
      wrap.append(el('p', { class: 'tiny faint', text:
        'This problem type has no program to feed, so there is nothing to run them against.' }));
    }
    return wrap;
  }

  async function runMyCases() {
    const p = current;
    const impl = ProblemTypes.get(p.type);
    const widget = host && host.querySelector('#answerWidget');
    const response = impl && impl.collect ? impl.collect(widget, p) : null;
    const note = host && host.querySelector('#myCasesNote');
    /* say() for progress, which is thrown away by the next repaint;
       settle() for the outcome, which has to survive it. */
    const say = t => { if (note) note.textContent = t; };
    const settle = t => { myNote = t; say(t); };

    if (!response || !response.source) {
      settle('Write a program first.');
      return;
    }
    const list = myCases();
    if (!list.length) { settle('Add an input first.'); return; }

    const btn = host && host.querySelector('#runMyCases');
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    say('');

    try {
      const reply = await Runners.run(response.lang, response.source,
        list.map(stdin => ({ stdin })), {
          problemId: p.id,
          /* The whole workspace, exactly as Run and Submit send it.
             The entry point on its own would not link. */
          files: response.files || null,
          sources: response.files && typeof Workspace !== 'undefined'
            ? Workspace.buildSources(p) : null,
          entry: response.files && typeof Workspace !== 'undefined'
            ? Workspace.entryOf(p) : null,
          profile: (p.payload || {}).profile || 'standard',
          onStage: (stage, detail) => {
            if (stage === 'running' && detail && detail.total > 1) {
              say(`Input ${Math.min(detail.done + 1, detail.total)} of ${detail.total}…`);
            } else {
              say({ downloading: 'Fetching the compiler…', compiling: 'Compiling…',
                running: 'Running…' }[stage] || '');
            }
          },
        });
      if (!current || current.id !== p.id) return;   /* they left */
      if (reply.judgeDown) {
        myRun = null;
        settle('');
        repaintPane();
        const pane = host && host.querySelector('#resultPane');
        if (pane && impl.platformNode) pane.prepend(impl.platformNode(reply));
        return;
      }
      if (reply.compile && !reply.compile.ok) {
        myRun = null;
        settle('It did not compile — the Compiler output tab has the errors.');
        return;
      }
      myRun = { id: p.id, cases: reply.cases || [] };
      settle(`Ran ${list.length} of your ${list.length === 1 ? 'input' : 'inputs'}. Nothing was graded or recorded.`);
      repaintPane();
    } catch (err) {
      settle(`Could not run: ${(err && err.message) || err}`);
    } finally {
      const b2 = host && host.querySelector('#runMyCases');
      if (b2) { b2.disabled = false; b2.textContent = 'Run my inputs'; }
    }
  }

  /* ---------------- what you have sent ----------------

     `attempts` is a number, and a number is no help a week later. This is
     the same list the store keeps: every graded program, newest first, with
     what it did and the code itself.

     Running the samples is not in here. Run is for the editor and happens
     dozens of times; Submit is the thing that goes on the record. */
  function fillSubmissions(pane) {
    const impl = ProblemTypes.get('code');
    const list = Store.submissions(current.id);

    if (!list.length) {
      pane.append(el('p', { class: 'muted small', text:
        'Nothing submitted yet. Run tests does not count — only Submit, '
        + 'which also runs the hidden cases.' }));
      return;
    }

    pane.append(el('p', { class: 'tiny faint', text:
      `${list.length} of the last ${Store.SUBS_MAX} submissions, newest first.` }));

    const words = { passed: 'Passed', failed: 'Failed', 'build-failed': 'Did not build' };

    pane.append(el('ol', { class: 'subs' }, list.map((sub, i) => {
      const lang = ((impl && impl.LANG_LABEL) || {})[sub.lang] || sub.lang || 'unknown';
      /* A build failure ran no cases, and "0/0 cases" is a worse way of
         saying so than saying nothing. */
      const cases = sub.total ? `${sub.passed}/${sub.total} cases` : '';

      /* The program is in IndexedDB now, so the body is filled when the
         row is opened rather than when the list is painted: ten reads
         to draw a list nobody has expanded is ten reads too many, and
         the list has to paint synchronously. */
      const body = el('div', { class: 'sub-body' }, [
        el('p', { class: 'tiny faint', text: sub.stored
          ? `Reading ${sub.bytes.toLocaleString()} characters\u2026`
          : (sub.storeError
            ? `The code for this one could not be saved: ${sub.storeError}. What it did is still here.`
            : 'No code was kept for this one. What it did is still here.') }),
      ]);
      if (sub.stored) fillSubmissionBody(body, sub);

      return el('li', {}, [el('details', { class: 'sub' }, [
        el('summary', {}, [
          el('span', { class: 'sub-verdict', 'data-outcome': sub.outcome,
            text: words[sub.outcome] || sub.outcome }),
          cases ? el('span', { class: 'sub-cases', text: cases }) : null,
          el('span', { class: 'sub-lang', text: lang }),
          el('span', { class: 'sub-when', title: sub.at, text: ago(sub.at) }),
          /* A build failure that never reached the compiler has no time
             worth printing; anything that ran does, even when it ran in
             less than the millisecond the runner can measure. */
          (sub.ms || sub.total)
            ? el('span', { class: 'sub-ms faint', text: duration(sub.ms) })
            : null,
          /* Which one it is, counting from the first, so "my third attempt"
             means something when you are reading them newest first. */
          el('span', { class: 'sub-n faint', text: `#${list.length - i}` }),
        ]),
        body,
      ])]);
    })));
  }

  /* Code that is displayed is coloured; code you type is not. This takes the
     same route the statement and the solution take — escape first, then
     highlight the escaped text, which is what the highlighter is written
     against — so a program containing `<script>` is a program containing
     `<script>` rather than one. */
  /* Fetch the program and swap it in. A failed read is said, not left
     as a spinner: the verdict is still true even when the program has
     gone, and "Reading…" for ever is the one thing it must not do. */
  async function fillSubmissionBody(body, sub) {
    let source = sub.source;   /* pre-migration records still carry it */
    if (source == null && typeof Sources !== 'undefined') {
      try { source = await Sources.get(current.id, sub.at); } catch { source = null; }
    }
    if (!body.isConnected) return;

    if (source == null) {
      body.replaceChildren(el('p', { class: 'tiny faint', text:
        'The code for this one could not be read back from storage. What it '
        + 'did is still here.' }));
      return;
    }

    body.replaceChildren(
      sourceNode(source, sub.lang),
      sub.truncated
        ? el('p', { class: 'tiny faint', text:
          'This one was saved before programs were kept whole, so only the '
          + 'first 6,000 characters of it exist.' })
        : null,
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button',
          onclick: () => loadSubmission(sub, source),
        }, ['Load into the editor']),
      ]),
    );
  }

  function sourceNode(source, lang) {
    /* A multi-file submission is one string holding every file. Shown
       as the files it was, each named, rather than as the JSON it is
       stored as. */
    const doc = typeof Workspace !== 'undefined' ? Workspace.unpack(source) : null;
    if (doc) {
      return el('div', { class: 'sub-files' }, doc.files.map(f => el('div', { class: 'sub-file' }, [
        el('h5', { class: 'sub-file-name mono' }, [
          f.path,
          f.path === doc.entry ? el('span', { class: 'mf-tag', text: 'entry' }) : null,
        ]),
        sourceNode(f.content, lang),
      ])));
    }

    const pre = el('pre', { class: 'sub-src' });
    const can = typeof Highlight !== 'undefined' && Highlight.supports(lang);
    pre.append(can
      ? el('code', { html: Highlight.run(MD.escapeHtml(source), lang) })
      : el('code', { text: source }));
    return pre;
  }

  function loadSubmission(sub, source) {
    /* The type that is on screen, not the code type. A hardware
       submission used to be handed to the code type, which has no
       editor on an hdl problem — so "Load into the editor" did
       nothing at all, silently, which is the worst way for a button
       to fail. */
    const impl = ProblemTypes.get(current.type);
    const ed = codeEditor();
    if (!impl || !impl.loadSource || !ed || source == null) return;
    const now = ed.value;
    const doc = typeof Workspace !== 'undefined' ? Workspace.unpack(source) : null;
    /* The editor holds the draft, and the draft is the only copy of it. */
    if (doc) {
      if (!confirm(
        `Put this submission back? It has ${doc.files.length} files.\n\n`
        + 'Every file it names is replaced by the version that was submitted, '
        + 'and what is in the editor now is the only copy of it.'
      )) return;
    } else if (now.trim() && now !== source && !confirm(
      'Put this submission back in the editor?\n\n'
      + 'What is in the editor now is replaced, and that is the only copy of it.'
    )) return;
    impl.loadSource(sub.lang, source);
    UI.toast('Loaded back into the editor.', 'info');
    /* No redraw: it would rebuild the editor and take the focus back out of
       it. The language tabs are repainted by the switch itself. */
  }

  /* Relative, because "4 minutes ago" is what you want of the submission you
     just made; the exact stamp is in the title for the one from last week. */
  function ago(iso) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return '';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 45) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(then).toISOString().slice(0, 10);
  }

  /* "0 ms" reads as "it did not run". A JavaScript program over seven small
     cases genuinely does finish inside one millisecond, which is what the
     runner can measure, so that is what it says. */
  const duration = (ms) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
    return ms >= 1 ? `${Math.round(ms)} ms` : '<1 ms';
  };

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
      /* The renderers are the practice renderers. `assess` is the whole
         of the difference and it is passed in rather than inferred, so a
         type that needs to behave differently under a clock can, and so
         that there is never a second copy of a widget to keep in step. */
      if (impl) {
        impl.render(p, widget, {
          locked: false,
          disclosed: disclosed(),
          assess: !!assess,
          policy: policy(),
        });
      }
      panel.append(answer);

      panel.append(el('div', { class: 'actions-bar' }, [
        el('div', { class: 'actions-bar-main' }, [
          el('button', {
            class: 'btn btn-primary', type: 'button', id: 'submitBtn', onclick: doSubmit,
          }, [assess ? 'Submit answer' : 'Submit']),
        ]),
        el('div', { class: 'actions-bar-note' }, [
          assess
            ? el('span', { class: 'tiny faint', id: 'answerSaved', 'data-state': 'idle',
                text: 'Your answer saves as you work' })
            : el('span', { class: 'tiny', id: 'worthNow',
                text: pooled()
                  ? 'From an assessment — nothing here is scored or recorded'
                  : rewarded() ? 'Already solved — practice only'
                  : `Worth ${Store.potentialXp(p)} XP now` }),
        ]),
      ]));

      if (assess) panel.append(attemptStateNode(p));
      if (lastBlocked) panel.append(executionFailureNode(lastBlocked));
      else if (answered && tellsVerdict()) panel.append(verdictNode(answered));

      /* Before the marks, because a saved answer is the thing the marks
         are about. */
      const seed = savedResponse(p);
      if (impl && impl.restore && seed !== undefined) impl.restore(widget, seed);
      repaintMarks(widget);
      watchForAnswerDraft(widget);
    } else {
      ({
        prereq: drawPrereq, hints: drawHints, notes: drawNotes, solution: drawSolution,
      }[activeTab] || drawPrereq)(panel);
    }

    return el('div', { class: 'pwrap reading' }, [
      el('div', { class: 'pmain' }, [
        header(),
        tabStrip(tabsNow(), activeTab, id => { activeTab = id; draw(); }, 'tabs'),
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

  /* What the layout should actually be right now, given the window. */
  function effectiveSplit() {
    const body = host && host.querySelector('.ws-body');
    const w = body ? body.getBoundingClientRect().width : 0;
    return fitted(splitFraction(), w, MIN_PANEL_PX);
  }

  function applySplit() {
    if (!host) return;
    const body = host.querySelector('.ws-body');
    if (body) body.style.setProperty('--split', String(effectiveSplit()));
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

  /* ---------------- what an attempt is told ----------------

     Three states, kept apart because they are three different facts
     about one question and a reader who cannot tell them apart cannot
     tell what is left to do:

       not answered    nothing written down
       answered        written down and saved, not sent
       submitted       sent, and recorded

     And a fourth that is not a state of the answer at all: **graded**.
     Nothing here is graded until the attempt is finished, which is what
     this says out loud rather than leaving the reader to infer it from
     the absence of a verdict. */
  function attemptStateNode(p) {
    const ans = (assess.attempt.answers || {})[p.id];
    const fb = policy();
    const submitted = !!(ans && ans.submitted);
    const errored = !!(ans && ans.errored);
    const selfReview = !!(ans && ans.selfReview);

    const at = ans && ans.at
      ? new Date(ans.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null;

    const lines = [];
    if (selfReview) {
      lines.push('Nothing marks a written proof. It is saved exactly as you '
        + 'wrote it, and you will read it against the rubric yourself once '
        + 'the assessment is over.');
    } else if (errored) {
      lines.push('This could not be run, so it has not been graded and is '
        + 'not counted wrong. Try submitting it again.');
    } else if (submitted) {
      lines.push(fb.duringAttempt === 'none'
        ? 'Recorded. Nothing is reported until you finish.'
        : 'Recorded. Run reports the sample cases; the result is reported '
          + 'when you finish.');
      if ((ans.submits || 0) > 1) {
        lines.push(`Submitted ${ans.submits} times. The last one is the one that counts.`);
      }
    }

    return el('div', { class: 'oa-state', 'data-state':
      selfReview ? 'review' : errored ? 'errored' : submitted ? 'submitted' : 'answered' }, [
      el('div', { class: 'verdict-head' }, [
        el('h4', { text: selfReview ? 'Saved, not marked'
          : errored ? 'Not graded' : 'Answer recorded' }),
        at ? el('span', { class: 'tiny faint', text: at }) : null,
      ]),
      ...lines.map(t => el('p', { class: 'small', text: t })),
      el('p', { class: 'tiny faint', text: 'You can change it and submit again '
        + 'until the assessment ends.' }),
    ]);
  }

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
      /* One line, asked at the only moment anybody actually knows the
         answer: right after getting it wrong, before the reason has
         gone. Not offered in an assessment — the reader is under a
         clock and has not been told what was wrong yet. */
      (!result.correct && !result.selfReview && !assess) ? missedNode() : null,
      attemptHistory(),
    ]);
  }

  /* ---------------- what I missed ----------------

     A separate field from Notes, and the separation is the point.
     Notes is "what did this teach you", written whenever. This is one
     line written while you still know why you got it wrong, which is a
     window that closes within about a minute — and it is what the
     review queue shows, so the queue says something in your words
     rather than "revise this".

     It is explicitly yours and explicitly not a mark: nothing reads it,
     nothing scores it, and writing one changes nothing about the
     problem except that it appears on the review list. */
  function missedNode() {
    const p = current;
    const r = Store.record(p.id);
    const concepts = (p.prereqs || []).map(x => x.concept || x).slice(0, 3);

    const box = el('textarea', {
      class: 'missed-box',
      rows: '2',
      placeholder: 'In one line — what did you miss?',
      oninput: e => {
        Store.setMissed(p, e.target.value);
        const note = box.parentElement.querySelector('.missed-saved');
        if (note) note.hidden = !e.target.value.trim();
      },
    }, [r.missed || '']);

    return el('div', { class: 'missed' }, [
      el('p', { class: 'tiny faint', text:
        'Worth a line now, while you still know. Nobody marks this and '
        + 'nothing scores it — it goes on your review list so the list can '
        + 'say why in your own words.' }),
      box,
      el('p', { class: 'tiny missed-saved', hidden: !(r.missed || '').trim() }, [
        'Saved. It is on ',
        el('a', { href: '#/review', text: 'your review list' }),
        '.',
      ]),
      concepts.length
        ? el('p', { class: 'tiny faint' }, [
          'This one rests on ',
          ...concepts.flatMap((c, i) => [
            i ? ', ' : '',
            el('a', { href: `#/concepts?q=${encodeURIComponent(c)}`,
              text: (Catalog.concept(c) || {}).name || c }),
          ]),
          '.',
        ])
        : null,
    ].filter(Boolean));
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

  /* What the store keeps about one submitted program: the code, and the
     numbers behind the verdict.

     The harness verdict itself is deliberately not stored. It holds every
     case's stdout, which is the judge's output rather than yours, and it
     would be the bulk of the bytes. */
  function submissionDigest(response, result) {
    const v = (result && result.verdict) || {};
    const cases = v.cases || [];
    return {
      source: response && typeof response.source === 'string' ? response.source : '',
      passed: cases.filter(c => c.pass).length,
      total: cases.length,
      /* Explicitly false only when the compiler refused it; an interpreted
         language never reports a build at all. */
      built: v.built !== false,
      ms: ((v.compile && v.compile.ms) || 0) + cases.reduce((n, c) => n + (c.ms || 0), 0),
    };
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
    const anchor = host && (host.querySelector('.ws-foot-right') || widget);
    if (!anchor) return;
    const note = el('p', { class: 'needs-answer small', role: 'status', text });
    if (anchor.classList.contains('ws-foot-right')) anchor.before(note);
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
  /* A submission that never ran.

     Delegated to the code type when it has a renderer, because that is
     where the taxonomy lives and two renderers for one event is how a
     page comes to describe it two different ways. This keeps the
     fallback for everything else — a maths grader that threw, an answer
     key that would not load — which has no backend and no kind. */
  function executionFailureNode(blocked) {
    const impl = ProblemTypes.get('code');
    if (impl && impl.platformNode && blocked && (blocked.kind || blocked.reply)) {
      return impl.platformNode({
        kind: blocked.kind,
        detail: blocked.detail,
        judgeError: blocked.feedback,
        backend: blocked.backend,
      });
    }
    return el('div', { class: 'verdict', 'data-kind': 'blocked' }, [
      el('h4', { text: 'Could not run' }),
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
       reader is handed a rubric and — on request — a model proof.

       Inside an assessment it is saved and nothing else happens yet.
       The rubric and the model proof are both disclosure, and they
       belong after the clock has stopped; the attempt records the
       proof as submitted-but-ungraded, the scoring keeps it out of the
       automatic total, and the review afterwards is where it is read
       against the rubric and marked by the only thing that can mark
       it. Nothing here claims to have verified a proof. */
    if (result.selfReview) {
      restore();
      if (assess) {
        await Attempts.record(assess.attempt.id, p.id, {
          submitted: true,
          selfReview: true,
          errored: false,
          correct: null,
          fraction: null,
          words: result.words || null,
          response,
        });
        if (assess.onAnswer) assess.onAnswer();
      }
      answered = { response, result, award: null };
      answerChanged = false;
      reviewing = !assess;
      workTab = 'results';
      draw();
      return;
    }

    /* A submission that could not be run at all is not a wrong answer. If the
       judge is down, recording an attempt would quietly cost the first-try
       bonus for something that was never graded. */
    if (result.noAttempt) {
      restore();
      /* Deliberately not recorded as an attempt and not passed to the store:
         the runner being down must not cost a first-try bonus.

         In an assessment it IS recorded, as `errored` — not as a wrong
         answer. The scoring keeps that outcome apart and refuses to
         give a pass verdict when one is present, because a pass
         computed over the problems that happened to work is not a
         pass. The reader gets a retry path instead. */
      if (assess) {
        /* The answer is frozen here, not discarded.

           It used to store `response: null`, which made the retry path
           on the review page impossible: there was nothing left to
           re-run. And storing it is what makes the retry *safe* — the
           grading can be attempted again after the deadline precisely
           because what gets graded is this, exactly as it was
           submitted, and cannot be edited now. */
        await Attempts.record(assess.attempt.id, p.id, {
          errored: true,
          errorWhy: result.feedback || 'execution failed',
          lang: result.lang || (response && response.lang) || null,
          source: isWorkspace(p) && response && typeof response.source === 'string'
            ? response.source : null,
          response: isWorkspace(p) ? null : response,
        });
        if (assess.onAnswer) assess.onAnswer();
      }
      lastBlocked = result;
      impl.mark(widget, { response, key: solution.key, problem: p, solution, result });
      /* Put the reader in front of the explanation. On the workspace the
         result pane starts on Test cases, so a failed submission used to
         produce no visible change at all — the reason was sitting in a tab
         nobody had any reason to open. */
      workTab = 'results';
      draw();
      UI.toast(result.feedback, 'bad', 9000);
      return;
    }
    lastBlocked = null;

    /* An assessment submission goes to the attempt and nowhere else. No
       XP, no streak, no change to the problem's solved status, and no
       row in its practice submission history: a result obtained under a
       clock, on a problem you had not seen, is a different kind of
       evidence from a practice solve, and letting them into the same
       record would make both worth less.

       The program is kept whole. The practice store caps a submission
       at 6,000 characters to protect the localStorage quota; an attempt
       lives in IndexedDB precisely so that cap does not apply, because
       a program cut in half is a program you cannot put back. */
    let award = null;
    if (assess) {
      await Attempts.record(assess.attempt.id, p.id, {
        submitted: true,
        errored: false,
        correct: !!result.correct,
        fraction: typeof result.score === 'number' ? result.score : (result.correct ? 1 : 0),
        lang: result.lang || null,
        source: isWorkspace(p) && response && typeof response.source === 'string'
          ? response.source : null,
        response: isWorkspace(p) ? null : response,
        passedCases: result.passed != null ? result.passed : null,
        totalCases: result.total != null ? result.total : null,
      });
      if (assess.onAnswer) assess.onAnswer();
    } else if (pooled()) {
      /* Graded, reported, and recorded nowhere. See `pooled()`. */
      award = null;
    } else {
      award = Store.submit(p, {
        correct: result.correct,
        score: result.score,
        lang: result.lang,
        sanitized: result.sanitized,
        /* A code problem also keeps the program itself, for the Submissions
           tab. Gated on the type rather than on "does the response happen to
           have a source field", because the type is the actual question. */
        ...(isWorkspace(p) ? submissionDigest(response, result) : {}),
      });
    }

    if (answered) previousAttempts.push(answered);
    answered = { response, result, award };
    /* The verdict on screen belongs to this submission, so any note that it
       is stale belongs to the one before it. */
    answerChanged = false;
    workTab = 'results';
    attempting = false;

    /* Only now, and only if it is actually earned. */
    if (result.correct && !solutionShown) solutionShown = true;

    /* No XP, no achievements and no rank from an attempt. The result
       is the assessment's, and it is reported when the attempt ends. */
    if (award) {
      if (result.correct && !award.alreadySolved && award.xp > 0) {
        UI.toast(`+${award.xp} XP`, 'good');
      }
      for (const a of award.newAchievements) UI.toast(`Unlocked: ${a.label}`, 'good');
      if (award.rankUp) UI.toast(`You are now ${award.rankUp.label}`, 'good');
      UI.refreshPurse();
    }
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
      const proof = current.type === 'proof';
      panel.append(el('div', { class: 'empty' }, [
        el('h2', { text: 'Not yet' }),
        el('p', { class: 'muted' }, [proof
          ? 'Write your proof first and submit it — nothing here can mark a proof, '
            + 'but comparing against a model you have not tried to write yourself '
            + 'teaches very little. Showing it is deliberate: the review that '
            + 'follows earns no XP and is recorded as Self-reviewed.'
          : 'Solve it, or reveal the answer deliberately — which records it as read rather than '
            + 'solved, and scores zero.'],
        ),
        el('button', { class: 'btn', type: 'button', onclick: doReveal },
          [proof ? 'Show a model proof…' : 'Reveal the answer…']),
      ]));
      return;
    }

    if (!solution) {
      panel.append(el('p', { class: 'muted', text: 'Loading the solution…' }));
      Catalog.solution(current.id).then(s => { solution = s; draw(); });
      return;
    }

    panel.append(el('div', { class: 'prose', html: MD.render(solution.explanation || '') }));

    /* Revealing a model proof switches to this tab, which used to leave the
       one control that records the review behind on the tab the reader came
       from - the last step of the intended path, out of sight. Comparing is
       the reason they are here, so the rubric comes with them. Only the
       active panel is in the document, so this is a move, not a copy. */
    if (current.type === 'proof' && reviewing) {
      const node = rubricNode();
      if (node) {
        panel.append(el('div', { class: 'card', style: 'margin-top:1rem' }, [
          el('h3', { text: 'Now compare' }),
          el('p', { class: 'tiny faint' }, [
            'Your own attempt is still on the working tab, exactly as you wrote '
            + 'it. Read it against each line, tick what it genuinely does, and '
            + 'record the review.',
          ]),
          node,
        ]));
      }
    }

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
    /* No redraw: rebuilding the workspace would rebuild the editor, and
       the reader's cursor is still in it. Only the pane changes. */
    setWorkTab('results');
  }

  return {
    open, leave, toggleFocus, setSplit, splitFraction,
    showResults, resetLayout, setWorkTab,
    /* For a type module that owns a pane: open it, and repaint it. The
       strip belongs to the page, so a type cannot reach it directly. */
    openPane, repaintPane,
    /* The code type paints the results pane and wants to say how long a run
       took in the same words the submissions list uses. One formatter, so
       the two cannot drift into "0 ms" and "<1 ms" for the same number. */
    duration,
  };
})();
