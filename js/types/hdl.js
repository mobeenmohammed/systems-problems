/* ============================================================
   types/hdl.js — "hdl": design a module and simulate it.

   The same workspace as a coding exercise, with two sources
   instead of one and a waveform instead of a diff:

     design.sv      yours. Autosaved, like any other draft.
     testbench.sv   the problem's, and read-only. Run uses it.

   Run and Submit use DIFFERENT testbenches, and that is the
   whole design rather than an implementation detail:

     Run      compiles your design with the sample testbench the
              problem supplies. You see its console output, its
              checks, and its waveform. This is the one you work
              with, and everything in it is visible to you.

     Submit   compiles your design with the grading testbench
              from the solution file, which drives cases the
              sample one does not. No waveform is shown from it.

   **A successful compile is not a pass.** Grading reads the
   structured CHECK lines the grading testbench prints and
   requires every named check to have run and passed. A design
   that compiles and hangs scores nothing; a design that prints
   the word PASS and computes nothing scores nothing; a run that
   stops after three of six checks is *incomplete*, which is
   reported as itself rather than as 3/6. See gradeChecks() in
   js/hdl/toolchain.js — the names come from the problem, never
   from the output.

   And it is a simulator. Nothing here says a design that passes
   would synthesise, meet timing, or work on a device.
   ============================================================ */

(() => {
  const { el, register } = ProblemTypes;

  /* The one live editor and what it belongs to. One at a time, like
     the code type: ProblemView.leave() tears it down. */
  let state = null;

  /* The last run, so that changing tabs repaints it rather than
     re-running it. Keyed by problem id and kind so a stale one cannot
     be painted into the next problem. */
  let last = null;

  /* Monotonic, so a reply from a run that has been abandoned — the
     reader opened another problem, or pressed Run again — cannot write
     to the page. The same guard the code type uses, and for the same
     bug. */
  let epoch = 0;

  const ENGINE = () => (typeof BrowserHdl !== 'undefined' ? BrowserHdl : null);

  const designOf = p => (p.payload || {}).template || '';
  const testbenchOf = p => (p.payload || {}).testbench || '';
  const topOf = p => (p.payload || {}).top || 'dut';

  /* The reader's own testbench.

     The sample one answers "does my design pass the example". The
     question somebody actually has is "what does my design do when I
     poke it like THIS", and the only way to ask it was to edit a
     read-only file, which is to say there was no way.

     So: a second testbench that belongs to the reader, kept with their
     draft under the same problem id. It is run through the same
     simulator and it is NOT graded — there are no expected values
     here, because the reader wrote the stimulus and inventing an
     expectation for it would be inventing an answer. It gets a console
     and a waveform, and that is all. Submit never sees it, and the
     grading testbench is still never shown.

     Empty until asked for, rather than pre-filled with a copy of the
     sample: a tab that already contains something invites editing it
     by accident, and "Start from the sample" is one button away. */
  const MYTB_SLOT = '_mytb';
  const myTbOf = problem => Store.draft(problem.id, MYTB_SLOT) || '';
  const setMyTb = (problem, src) => Store.saveDraft(problem, MYTB_SLOT, src);

  function sourceFor(problem) {
    const draft = Store.draft(problem.id, 'sv');
    return draft || designOf(problem);
  }

  /* ---------------- a design made of several files ----------------

     Exactly the workspace the C++ projects use — js/filepane.js — with
     'sv' as the draft namespace. A module in one file instantiating a
     module in another is not a special case for the simulator: ivlpp
     is handed every source at once, which is what it does for the
     design and the testbench already.

     The testbench is NOT one of these files. It arrives beside them
     under the name testbench.sv, and the build refuses a problem whose
     own files claim that name. */

  const multi = () => !!(state && state.pane);
  const paneFiles = () => (multi() ? state.pane.files() : null);
  const activeEditor = () => (multi()
    ? state.pane.editor()
    : (state ? state.editor : null));

  const TB_NAME = 'testbench.sv';

  /* What goes to the simulator: every design file, then the testbench
     under the name the diagnostics will use for it. */
  function sourcesFor(tbSource) {
    const out = {};
    if (multi()) {
      for (const f of state.pane.files()) out[f.path] = f.content;
    } else {
      out['design.sv'] = state.editor.value;
    }
    out[TB_NAME] = tbSource;
    return out;
  }

  /* ---------------- rendering ---------------- */

  function render(problem, mount, ctx) {
    const pay = problem.payload || {};

    if (!state || state.problem.id !== problem.id) last = null;
    state = { problem, mount, editor: null, running: false, abort: null, pane: null };

    const head = el('div', { class: 'editor-head' }, [
      el('span', { class: 'pill pill-plain', title: 'The language generation the simulator is given' },
        ['SystemVerilog']),
      el('span', { class: 'tiny faint mono', title: 'The module the testbench instantiates' },
        [`top: ${topOf(problem)}`]),
    ]);
    mount.append(head);

    const editorHost = el('div', { class: 'ed-host' });
    mount.append(editorHost);

    /* Said under the editor, and only when it matters: the simulator is
       2.7 MB and the first Run fetches it. */
    const box = el('div', { class: 'judge-state', 'data-up': 'true' }, [
      el('span', { class: 'dot' }),
      el('span', { id: 'codeJudgeText', text: 'Icarus Verilog, in this tab' }),
    ]);
    mount.append(box);

    if (Workspace.isMulti(problem)) {
      editorHost.classList.add('ed-host-multi');
      state.pane = FilePane.create(editorHost, {
        problem,
        lang: 'sv',
        ctx,
        langOf: () => 'verilog',
        lint: false,
        onSaved: (ok, again) => noteSaved(ok, again),
        onRun: () => doRun(),
        onSubmit: () => {
          const btn = document.getElementById('submitBtn');
          if (btn) btn.click();
        },
      });
      state.editor = state.pane.editor();
      const carried = state.pane.carryForward();
      if (carried.length) {
        UI.toast(`Carried ${carried.length} file${carried.length === 1 ? '' : 's'} `
          + 'forward from the previous milestone.', 'info', 7000);
      }
      return;
    }

    state.editor = Editor.create(editorHost, {
      value: sourceFor(problem),
      /* There is a Verilog mode in the bundle now: the CodeMirror 5
         one, running under StreamLanguage. It tokenises by line rather
         than by parse tree, so there is no syntax-aware indentation or
         folding from it — what there is, is keywords, numbers, strings
         and comments told apart correctly, in the page's own colour
         tokens. C-like highlighting was the wrong answer and plain text
         was the honest one; this is better than either. */
      lang: 'verilog',
      profile: 'standard',
      readOnly: ctx.locked,
      onChange: src => {
        const ok = Store.saveDraft(problem, 'sv', src);
        noteSaved(ok, () => Store.saveDraft(problem, 'sv', src));
      },
      onRun: () => doRun(),
      onSubmit: () => {
        const btn = document.getElementById('submitBtn');
        if (btn) btn.click();
      },
    });
  }

  /* One implementation for every type — see js/savestate.js. What it
     says now depends on what storage said, rather than on a timer. */
  function noteSaved(ok = true, again = null) {
    SaveState.begin();
    SaveState.settle(ok !== false, { retry: again });
  }

  function resetTemplate(scope) {
    if (!state) return;
    /* On a workspace the page has already asked which, and what it
       would cost; the scope it decided on is the argument. */
    if (multi()) {
      state.pane.reset(scope === 'file' ? 'file' : 'all');
      noteSaved();
      return;
    }
    if (!state.editor) return;
    state.editor.value = designOf(state.problem);
    Store.saveDraft(state.problem, 'sv', state.editor.value);
    noteSaved();
  }

  /* ---------------- running ---------------- */

  const setExec = (kind, text) => {
    const node = document.getElementById('execState');
    if (!node) return;
    node.dataset.state = kind;
    node.textContent = text;
  };

  const showStop = on => {
    const b = document.getElementById('stopBtn');
    if (b) b.hidden = !on;
    const r = document.getElementById('runBtn');
    if (r) r.disabled = !!on;
    /* One simulator, so one run at a time, whichever button started it. */
    const m = document.getElementById('runMyTb');
    if (m) m.disabled = !!on || !((tbEditor && tbEditor.value) || '').trim();
  };

  /* Run, with either testbench. `own` picks the reader's; everything
     downstream of here is identical, which is the point — the same
     simulator, the same cancellation, the same waveform. What differs
     is that a run of the reader's testbench is not graded. */
  async function doRun({ own = false } = {}) {
    if (!state || !activeEditor()) return;
    const engine = ENGINE();
    if (!engine) {
      setExec('blocked', 'No simulator');
      return;
    }
    const problem = state.problem;
    const tbSource = own ? myTbOf(problem) : testbenchOf(problem);
    if (own && !tbSource.trim()) {
      setExec('blocked', 'Nothing to run');
      return;
    }
    const mine = epoch += 1;

    /* The result pane, open, before anything slow starts: a run whose
       only visible effect is in a tab nobody opened has no visible
       effect. */
    if (typeof ProblemView !== 'undefined' && ProblemView.openPane) ProblemView.openPane('results');

    state.abort = new AbortController();
    state.running = true;
    showStop(true);
    setExec('running', engine.ready ? 'Compiling…' : 'Fetching the simulator…');

    const off = engine.onProgress(p => {
      if (mine !== epoch) return;
      if (p.stage === 'download' && p.percent != null) setExec('running', `Simulator ${p.percent}%`);
      else if (p.stage === 'build') setExec('running', 'Compiling…');
      else if (p.stage === 'simulate') setExec('running', 'Simulating…');
    });

    let reply;
    try {
      reply = await engine.run(sourcesFor(tbSource), {
        generation: (problem.payload || {}).generation || '2012',
        wantWaveform: true,
        signal: state.abort.signal,
      });
    } finally {
      off();
    }

    /* Abandoned. Everything about this reply belongs to a problem that
       is no longer on screen, or to a run the reader replaced. */
    if (mine !== epoch) return;
    if (!state || state.problem.id !== problem.id) return;

    state.running = false;
    state.abort = null;
    showStop(false);

    const graded = own ? null : gradeSample(problem, reply);
    last = { problemId: problem.id, kind: own ? 'mine' : 'sample', reply, graded,
      at: Date.now() };
    jumpAt = null;

    setExec(
      (reply.cancelled || reply.timedOut) ? 'blocked'
        : !reply.ok ? 'bad'
          /* A run of the reader's own testbench has no verdict to
             report, so it reports that it ran rather than borrowing
             the green of a pass it never established. */
          : own ? 'ran'
            : graded.correct ? 'ok' : 'bad',
      reply.cancelled ? 'Stopped'
        : reply.timedOut ? `Stopped after ${Math.round(reply.ms / 1000)}s`
          : !reply.built ? 'Did not compile'
            : own ? 'Ran your testbench'
              : `${graded.passed}/${graded.total} sample checks`,
    );

    /* A compile that failed sends the reader where the reason is. Only
       a failure: taking the pane away after a successful run would take
       them away from the results they pressed Run for. */
    repaintResult();
    const compilerSpoke = reply.built === false && !reply.cancelled && !reply.timedOut;
    if (compilerSpoke && typeof ProblemView !== 'undefined' && ProblemView.openPane) {
      ProblemView.openPane('compiler');
    }
  }

  function stop() {
    const engine = ENGINE();
    epoch += 1;
    if (state && state.abort) state.abort.abort();
    if (engine) engine.stop();
    if (state) { state.running = false; state.abort = null; }
    showStop(false);
    setExec('blocked', 'Stopped');
  }

  /* The sample run, graded against the checks the PROBLEM declares as
     visible. Shown in full — expected and actual, per check — because
     these are the reader's to see. */
  function gradeSample(problem, reply) {
    const want = ((problem.payload || {}).checks) || [];
    if (!reply || !reply.ok) {
      return { rows: [], passed: 0, total: want.length, correct: false,
        incomplete: null, score: 0 };
    }
    return HdlGrade.gradeChecks(reply.output, want, { finished: reply.finished });
  }

  /* ---------------- the panes ---------------- */

  /* Which extra tabs this type puts in the work strip. The problem page
     asks, rather than knowing. */
  /* "Testbench" next to "Design" read as though it might be yours to
     edit. It is the problem's, it is read-only, and Submit uses a
     different one — so the strip says which. */
  const TABS = [
    { id: 'editor', label: 'Design' },
    { id: 'tb', label: 'Sample testbench' },
    { id: 'mytb', label: 'My testbench' },
    { id: 'results', label: 'Results' },
    { id: 'waves', label: 'Waveforms' },
    { id: 'subs', label: 'Submissions' },
    /* "Diagnostics" was this one tab's own word for what every other
       language on the site calls Compiler output. Same thing, same
       name. */
    { id: 'compiler', label: 'Compiler output' },
  ];

  let viewer = null;
  /* The reader's testbench editor. A pane is rebuilt from nothing every
     time it is painted, so an editor left behind here is a CodeMirror
     instance with listeners on a node nobody can see. */
  let tbEditor = null;

  function fillPane(pane, tab, problem) {
    if (viewer) { viewer.destroy(); viewer = null; }
    if (tbEditor) { tbEditor.destroy(); tbEditor = null; }

    if (tab === 'tb') { fillTestbench(pane, problem); return true; }
    if (tab === 'mytb') { fillMyTestbench(pane, problem); return true; }
    if (tab === 'results') { fillResults(pane, problem); return true; }
    if (tab === 'waves') { fillWaves(pane, problem); return true; }
    if (tab === 'compiler') { fillDiagnostics(pane, problem); return true; }
    return false;
  }

  function fillTestbench(pane, problem) {
    const src = testbenchOf(problem);
    pane.append(el('p', { class: 'tiny faint' }, [
      'The testbench Run uses. It is the problem’s, not yours, and it is '
      + 'read-only — Submit drives your design with a different one that tries '
      + 'cases this does not.',
    ]));
    const checks = ((problem.payload || {}).checks) || [];
    if (checks.length) {
      pane.append(el('p', { class: 'tiny faint' }, [
        `It prints ${checks.length} check${checks.length === 1 ? '' : 's'}: `,
        el('span', { class: 'mono', text: checks.join(', ') }),
        '.',
      ]));
    }
    /* Coloured, like the code blocks in a problem statement and like
       the two editors either side of it. The statement's blocks go
       through Highlight on their way out of the markdown renderer;
       this one is built by hand, so it has to ask. Escaped first:
       run() takes already-escaped text and returns markup. */
    const code = el('code');
    if (typeof Highlight !== 'undefined' && Highlight.run) {
      const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      code.innerHTML = Highlight.run(esc, 'verilog');
    } else {
      code.textContent = src;
    }
    pane.append(el('pre', { class: 'code-block', 'data-lang': 'verilog' }, [code]));
  }

  /* The reader's testbench, editable, with its own Run.

     Deliberately not wired to the toolbar's Run simulation button:
     that button means "the problem's sample cases", everywhere on the
     site, and quietly changing what it does depending on which tab is
     open is how a reader comes to distrust a button. This one says
     what it runs. */
  function fillMyTestbench(pane, problem) {
    const checks = ((problem.payload || {}).checks) || [];
    pane.append(el('p', { class: 'tiny faint' }, [
      'Stimulus of your own, for trying things the sample does not. It is '
      + 'yours to edit, it is kept with your draft, and nothing here is '
      + 'graded — you wrote the inputs, so there is no expected output to '
      + 'compare against. Submit does not use it.',
    ]));
    pane.append(el('p', { class: 'tiny faint' }, [
      'It is compiled with your design from the ',
      el('b', { text: 'Design' }),
      ' tab, so it should instantiate ',
      el('span', { class: 'mono', text: topOf(problem) }),
      '. For a waveform, call ',
      el('span', { class: 'mono', text: '$dumpfile' }),
      ' and ',
      el('span', { class: 'mono', text: '$dumpvars' }),
      ', and end with ',
      el('span', { class: 'mono', text: '$finish' }),
      ' — a testbench that never finishes is stopped by the time limit.',
    ]));

    const host = el('div', { class: 'ed-host ed-host-sm' });
    pane.append(host);

    const buttons = el('div', { class: 'row', style: 'gap:.4rem;flex-wrap:wrap;margin-top:.5rem' });
    const note = el('span', { class: 'tiny faint', id: 'myTbNote', text: myTbNote });

    tbEditor = Editor.create(host, {
      value: myTbOf(problem),
      lang: 'verilog',
      profile: 'standard',
      onChange: src => { setMyTb(problem, src); noteSaved(); refreshMyTbButtons(); },
      onRun: () => doRun({ own: true }),
    });

    const runBtn = el('button', {
      class: 'btn btn-sm btn-primary', type: 'button', id: 'runMyTb',
      onclick: () => {
        myTbNote = '';
        note.textContent = '';
        doRun({ own: true });
      },
    }, ['Run my testbench']);

    const seedBtn = el('button', {
      class: 'btn btn-sm', type: 'button', id: 'seedMyTb',
      title: 'Copy the sample testbench in here, to change',
      onclick: () => {
        const have = (tbEditor && tbEditor.value) || '';
        /* Only ever a question when there is work to lose. */
        if (have.trim()
          && !window.confirm('Replace what is here with a copy of the sample testbench?')) return;
        const copy = testbenchOf(problem);
        tbEditor.value = copy;
        setMyTb(problem, copy);
        noteSaved();
        myTbNote = 'Copied. Change it however you like — the sample itself is untouched.';
        note.textContent = myTbNote;
        refreshMyTbButtons();
      },
    }, ['Start from the sample']);

    buttons.append(runBtn, seedBtn, note);
    pane.append(buttons);

    if (checks.length) {
      pane.append(el('p', { class: 'tiny faint' }, [
        'The sample prints checks the site reads — ',
        el('span', { class: 'mono', text: checks.join(', ') }),
        '. Yours does not have to print anything of the sort; if it does, '
        + 'the names are not graded either.',
      ]));
    }
    refreshMyTbButtons();
  }

  let myTbNote = '';

  /* Nothing to run is nothing to run, and a button that does nothing is
     worse than a disabled one. */
  function refreshMyTbButtons() {
    const b = document.getElementById('runMyTb');
    if (!b) return;
    const empty = !((tbEditor && tbEditor.value) || '').trim();
    b.disabled = empty || !!(state && state.running);
    b.title = empty ? 'Write a testbench first' : 'Compile your design with this testbench';
  }

  /* What the four tabs are for, before anything has run.

     Shown only on the first hardware exercise somebody opens, because
     after that it is in the way; dismissible, because it is in the way
     for some people immediately. Not a tour, not a modal, and nothing
     to click through — a reader who ignores it entirely loses nothing,
     which is the test of whether an explanation is optional. */
  const SEEN_KEY = 'hdlWalkthrough';

  function walkthrough(problem) {
    if (Store.pref(SEEN_KEY, false)) return null;

    const box = el('details', { class: 'hdl-walk', open: true }, [
      el('summary', { class: 'small' }, ['New to this? How a hardware exercise works']),
      el('div', { class: 'hdl-walk-body' }, [
        el('ol', {}, [
          el('li', {}, [el('b', { text: 'Design' }),
            ' — your module. It is the tab you write in, and it saves as you type.']),
          el('li', {}, [el('b', { text: 'Sample testbench' }),
            ' — the problem\u2019s, not yours, and read-only. It drives your module '
            + 'and prints a check for each thing it tries. Run uses this one.']),
          el('li', {}, [el('b', { text: 'Results' }),
            ' — every check with what was expected, what your design produced, and '
            + 'the simulated time. Click a check to see that instant on the waveform.']),
          el('li', {}, [el('b', { text: 'Waveforms' }),
            ' — the signals over time. Click to put a cursor down and read every '
            + 'value at that moment; the arrow keys move it.']),
        ]),
        el('p', { class: 'tiny faint' }, [
          'Run compiles and simulates with the sample testbench. ',
          el('b', { text: 'Submit' }),
          ' uses a different testbench that tries cases the sample one does not, '
          + 'so passing Run is not the same as passing. Everything happens in this '
          + 'tab \u2014 there is nothing to install.',
        ]),
        el('p', { class: 'tiny faint' }, [
          'This is simulation. It says nothing about whether a design would '
          + 'synthesise, meet timing, or work on a real device.',
        ]),
        el('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', id: 'hdlWalkDone',
          onclick: () => {
            Store.setPref(SEEN_KEY, true);
            const n = document.querySelector('.hdl-walk');
            if (n) n.remove();
          },
        }, ['Got it, do not show this again']),
      ]),
    ]);
    return box;
  }

  function fillResults(pane, problem) {
    if (!last || last.problemId !== problem.id) {
      const walk = walkthrough(problem);
      if (walk) pane.append(walk);
      pane.append(el('p', { class: 'muted small',
        text: 'Press Run simulation, or Submit.' }));
      return;
    }
    const { reply, graded, kind } = last;

    if (reply.cancelled) {
      pane.append(el('p', { class: 'small', text: 'Stopped before it finished.' }));
      return;
    }

    /* A run that was stopped — by the time limit or by the reader —
       reports that it was stopped, and nothing else.

       This used to only catch the case where the COMPILE was stopped,
       because it tested `!reply.built`. A simulation that hit the ten
       second limit has built fine, so it fell through to the ordinary
       verdict and was reported as "0 of 3 checks passed" — which is a
       score, for a run that never produced one, and reads as "your
       design is wrong" rather than "it never stopped". */
    if (reply.timedOut || (reply.blocked && !reply.built)) {
      pane.append(el('div', { class: 'verdict', 'data-kind': 'wrong' }, [
        el('h4', { text: reply.timedOut ? 'Stopped' : 'Could not run' }),
        el('p', { class: 'small', text: reply.blocked }),
        reply.timedOut === 'simulate'
          ? el('p', { class: 'tiny faint', text: 'Nothing is graded from a run that had '
            + 'to be stopped: whatever it printed first is not a result.' })
          : null,
      ]));
      if (reply.output) {
        pane.append(el('h5', { class: 'hdl-head', text: 'What it printed before it was stopped' }));
        pane.append(el('pre', { class: 'run-out-pre', text: reply.output }));
      }
      return;
    }

    if (reply.built === false) {
      /* The messages are in Compiler output, and only there. This used
         to print them here as well, which is two copies of one list
         and a reader deciding which is authoritative. */
      const errs = (reply.diagnostics || []).filter(d => d.level === 'error').length;
      pane.append(el('div', { class: 'buildline', 'data-kind': 'error' }, [
        el('h4', { text: errs
          ? `It did not compile — ${errs} ${errs === 1 ? 'error' : 'errors'}`
          : 'It did not compile' }),
        el('p', { class: 'tiny faint', text: 'Nothing was simulated, so there is '
          + 'nothing here to score. Icarus\u2019s own messages, with the file and the '
          + 'line, are in Compiler output.' }),
        compilerButton(),
      ]));
      return;
    }

    /* A run of the reader's own testbench. It built and it ran; what it
       did is in the console and on the waveform, and there is no score
       because nothing here declared what the right answer was. Said
       plainly, so that a reader who gets what they hoped for out of
       their own stimulus does not read it as having passed the
       exercise. */
    if (kind === 'mine') {
      pane.append(el('div', { class: 'verdict', 'data-kind': 'part' }, [
        el('div', { class: 'verdict-head' }, [
          el('h4', { text: 'Your testbench ran' }),
          el('span', { class: 'tiny faint', text: 'your testbench' }),
        ]),
        el('p', { class: 'small', text: 'Nothing was graded and nothing was recorded. '
          + 'This is what your design did under the stimulus you wrote — to be '
          + 'marked, press Run simulation for the sample checks, or Submit.' }),
        reply.finishedAt != null
          ? el('p', { class: 'tiny faint', text: `$finish at ${reply.finishedAt} (simulated), `
            + `${reply.ms} ms of real time.` })
          : el('p', { class: 'tiny faint', text: `${reply.ms} ms of real time; the simulation `
            + 'ended without $finish.' }),
      ]));
      pane.append(el('h5', { class: 'hdl-head', text: 'Console' }));
      pane.append(el('pre', { class: 'run-out-pre', text: reply.output || '(nothing printed)' }));
      if (reply.vcd) {
        pane.append(el('p', { class: 'tiny faint', text: 'The Waveforms tab has the trace.' }));
      } else {
        pane.append(el('p', { class: 'tiny faint', text: 'No waveform: add $dumpfile and '
          + '$dumpvars to your testbench for one.' }));
      }
      if (reply.clipped) {
        pane.append(el('p', { class: 'tiny', style: 'color:var(--warn)',
          text: 'Output was longer than the limit and has been cut off here.' }));
      }
      return;
    }

    /* The verdict, and it is about the checks rather than about the
       compile. */
    const kindWord = graded.incomplete ? 'part'
      : graded.correct ? 'right' : 'wrong';
    pane.append(el('div', { class: 'verdict', 'data-kind': kindWord }, [
      el('div', { class: 'verdict-head' }, [
        el('h4', { text: graded.incomplete ? 'Incomplete'
          : graded.correct ? `All ${graded.total} checks passed`
            : `${graded.passed} of ${graded.total} checks passed` }),
        el('span', { class: 'tiny faint', text: kind === 'grade' ? 'grading testbench' : 'sample testbench' }),
      ]),
      graded.incomplete
        ? el('p', { class: 'small', text: `${graded.incomplete}. A run that does not `
          + 'finish is not a pass, whatever it printed before it stopped.' })
        : null,
      reply.finishedAt != null
        ? el('p', { class: 'tiny faint', text: `$finish at ${reply.finishedAt} (simulated), `
          + `${reply.ms} ms of real time.` })
        : el('p', { class: 'tiny faint', text: `${reply.ms} ms of real time; the simulation `
          + 'ended without $finish.' }),
    ]));

    /* Per check: expected, actual, and when — and, when there is a
       waveform to look at, a way in.

       A failed check tells you a value was wrong at t=30. The useful
       question is what the inputs were at t=30, and the answer is on
       the waveform. Clicking the check opens it with the cursor on
       that instant, which turns a number into a picture of the moment
       it went wrong.

       Only for the SAMPLE run: a grading run has no waveform, on
       purpose, because its cases are not the reader's to see. */
    const canJump = kind !== 'grade' && reply.vcd;
    if (graded.rows.length) {
      pane.append(el('div', { class: 'hdl-checks' }, graded.rows.map(r => {
        const state = r.missing ? 'missing' : r.pass ? 'pass' : 'fail';
        const body = [
          el('span', { class: 'hdl-check-name mono', text: r.name }),
          r.missing
            ? el('span', { class: 'tiny', text: 'never ran' })
            : el('span', { class: 'tiny mono' }, [
              'expected ', el('b', { text: String(r.expect) }),
              ', got ', el('b', { text: String(r.actual) }),
              r.at != null ? ` at t=${r.at}` : '',
            ]),
        ];
        if (canJump && r.at != null) {
          body.push(el('span', { class: 'hdl-check-go tiny' },
            [r.pass ? 'show me' : 'show me when']));
          return el('button', {
            class: 'hdl-check', type: 'button', 'data-state': state,
            title: `Open the waveform with the cursor at t=${r.at}`,
            onclick: () => jumpTo(r.at),
          }, body);
        }
        return el('div', { class: 'hdl-check', 'data-state': state }, body);
      })));
    }

    /* Warnings are not errors and do not belong in a verdict, but a
       design that compiles with four of them is worth knowing about.
       The count, and one click to the text. */
    const warns = (reply.diagnostics || []).filter(d => d.level === 'warning').length;
    if (warns) {
      pane.append(el('div', { class: 'buildline', 'data-kind': 'warn' }, [
        el('span', { class: 'lbl', text: `It compiled, with ${warns} `
          + `${warns === 1 ? 'warning' : 'warnings'}` }),
        compilerButton(),
      ]));
    }

    /* The console. Everything the design and the testbench printed. */
    pane.append(el('h5', { class: 'hdl-head', text: 'Console' }));
    pane.append(el('pre', { class: 'run-out-pre', text: reply.output || '(nothing printed)' }));
    if (reply.clipped) {
      pane.append(el('p', { class: 'tiny', style: 'color:var(--warn)',
        text: 'Output was longer than the limit and has been cut off here.' }));
    }
  }

  /* Open the waveform at an instant. The viewer is rebuilt whenever
     the pane is painted, so the time is remembered and applied by
     fillWaves rather than reached into from here. */
  let jumpAt = null;
  function jumpTo(t) {
    jumpAt = t;
    if (typeof ProblemView !== 'undefined' && ProblemView.openPane) ProblemView.openPane('waves');
  }

  function fillWaves(pane, problem) {
    if (!last || last.problemId !== problem.id || !last.reply.vcd) {
      pane.append(el('p', { class: 'muted small', text: last && last.kind === 'grade'
        ? 'No waveform from a submission. The grading testbench drives cases the '
          + 'sample one does not, and showing its waveform would show them. '
          + 'Press Run simulation to see your design under the sample testbench.'
        : last && last.kind === 'mine'
          ? 'Your testbench produced no waveform. Add $dumpfile and $dumpvars to it.'
          : 'Run the simulation and the waveform appears here.' }));
      return;
    }

    let doc;
    try {
      doc = VCD.parse(last.reply.vcd);
    } catch (err) {
      pane.append(el('p', { class: 'small', text: `The waveform file could not be read: ${err.message}` }));
      return;
    }
    if (!doc.signals.length) {
      pane.append(el('p', { class: 'muted small', text: 'The simulation produced no waveform. '
        + 'A testbench needs $dumpfile and $dumpvars for there to be one.' }));
      return;
    }

    /* A check's `AT` is in the testbench's time unit; a VCD counts in
       its precision. With `timescale 1ns/1ps` those differ by a
       thousand, so every time that crosses from a check to the
       waveform has to be scaled — the axis mark below and the cursor
       a click on a check asks for. */
    const scale = VCD.timescaleOf(
      last.kind === 'mine' ? myTbOf(problem) : testbenchOf(problem));
    /* One tick back from the reported instant.

       A testbench typically checks a value and then immediately drives
       the next case, both at the same simulated time. A VCD records the
       SETTLED value for a timestamp, so reading the trace at exactly
       the reported instant shows the inputs for the case AFTER the one
       that failed — which was observed, and was baffling: the check
       said a=0 b=1 and the cursor said a=1 b=0.

       One precision tick earlier is the state the check actually saw. */
    const toTicks = t => Math.max(0, Math.round(t * scale.ratio) - 1);

    /* A failing check's time, marked on the axis, so "it went wrong at
       t=35" is something you can see rather than read. */
    const marks = [];
    const f = last.graded && last.graded.firstFailure;
    if (f && f.at != null) marks.push({ t: toTicks(f.at), label: f.name, kind: 'fail' });

    const box = el('div', { class: 'wave-host' });
    pane.append(box);
    if (last.reply.vcdClipped) {
      pane.append(el('p', { class: 'tiny', style: 'color:var(--warn)',
        text: 'The waveform file hit the size limit and was cut off; what is shown is the start of it.' }));
    }
    /* Two values that are not 0 or 1, explained where they are drawn.
       A red band is the first thing a reader meets on their first
       simulation — before anything has driven a signal — and "x" on its
       own explains nothing. */
    pane.append(el('div', { class: 'wave-legend tiny' }, [
      el('span', { class: 'wave-key', 'data-v': 'x' }, [
        el('i'), el('b', { text: 'x' }),
        ' unknown — nothing has driven this yet, or two things drive it differently. '
        + 'The simulator will not guess a value it does not have.',
      ]),
      el('span', { class: 'wave-key', 'data-v': 'z' }, [
        el('i'), el('b', { text: 'z' }),
        ' high impedance — nothing is driving it at all. A floating wire.',
      ]),
    ]));
    pane.append(el('p', { class: 'tiny faint', text: 'Click to put the cursor down and read '
      + 'every value at that instant; arrow keys move it, Home and End jump to the ends. '
      + 'Shift+drag pans, Ctrl+scroll zooms, f fits. This is a simulation: passing here says '
      + 'nothing about synthesis, timing or a real device.' }));

    viewer = Wave.create(box, doc, {
      marks,
      scale,
      /* Where a click on a failed check asked to be, in the same unit
         the check reported. */
      cursor: jumpAt == null ? null : toTicks(jumpAt),
      onDownload: () => {
        const blob = new Blob([last.reply.vcd], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${problem.id}.vcd`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
    });
  }

  function fillDiagnostics(pane, problem) {
    const rows = (last && last.problemId === problem.id && last.reply.diagnostics) || [];
    if (!rows.length) {
      pane.append(el('p', { class: 'muted small',
        text: 'Nothing from the compiler yet. Run the simulation.' }));
      return;
    }
    pane.append(diagnosticsNode(rows));
  }

  const compilerButton = () => el('button', {
    class: 'btn btn-sm', type: 'button', id: 'toCompilerOut',
    onclick: () => {
      if (typeof ProblemView !== 'undefined' && ProblemView.openPane) {
        ProblemView.openPane('compiler');
      }
    },
  }, ['Compiler output']);

  function diagnosticsNode(rows) {
    const wrap = el('div', { class: 'diags' });
    for (const d of rows) {
      /* Clickable when it is a file the reader can open. The testbench
         is read-only and the grading one is not shown at all, so a
         diagnostic in either stays a label rather than becoming a
         button that goes nowhere. */
      const canOpen = !!(d.file && d.line && multi() && state.pane.has(d.file));
      const where = canOpen
        ? el('button', {
          class: 'diag-where mono tiny', type: 'button',
          title: `Open ${d.file} at line ${d.line}`,
          onclick: () => {
            state.pane.goTo(d.file, d.line, d.column || 1);
            state.editor = state.pane.editor();
            if (typeof ProblemView !== 'undefined' && ProblemView.openPane) {
              ProblemView.openPane('editor');
            }
          },
        }, [`${d.file}:${d.line}`])
        : el('span', { class: 'diag-where mono tiny' },
          [d.file ? `${d.file}:${d.line}` : '—']);

      wrap.append(el('div', { class: 'diag', 'data-level': d.level }, [
        where,
        el('span', { class: 'diag-level tiny', text: d.level }),
        el('span', { class: 'diag-msg', text: d.message }),
      ]));
    }
    return wrap;
  }

  function repaintResult() {
    if (typeof ProblemView !== 'undefined' && ProblemView.repaintPane) ProblemView.repaintPane();
  }

  /* ---------------- the type contract ---------------- */

  register('hdl', {
    render,
    TABS,
    fillPane,
    run: doRun,
    stop,
    resetTemplate,
    /* What Reset would put back, so the page can tell "nothing to lose"
       from "an afternoon to lose" before asking. */
    startingSource: (problem) => {
      if (multi()) return state.pane.starterOf(state.pane.active);
      return designOf(problem);
    },

    /* The same four questions the code type answers, so the page's
       Reset menu, its submission list and its tests do not have to
       know which type they are looking at. */
    multiFile: () => multi(),
    files: () => paneFiles(),
    /* The workspace widget itself, for the controls that belong to the
       page rather than to the type: the explorer toggle and Reset
       layout. Null on a single-file problem, which has no explorer. */
    pane: () => (multi() ? state.pane : null),
    activeFile: () => (multi() ? state.pane.active : null),
    openFile: path => (multi() ? state.pane.open(path, { focus: true }) : false),
    resetCost: () => (multi() ? state.pane.cost() : null),

    /* Putting a submitted design back. One file or a whole workspace;
       the second is one string holding every file, and all of them go
       back rather than the top one alone. */
    loadSource(lang, source) {
      if (!state) return false;
      const doc = Workspace.unpack(String(source));
      if (doc && multi()) {
        const n = state.pane.load(doc);
        noteSaved();
        const ed = activeEditor();
        if (ed) ed.focus();
        void n;
        return true;
      }
      const ed = activeEditor();
      if (!ed) return false;
      ed.value = String(source);
      Store.saveDraft(state.problem, 'sv', ed.value);
      noteSaved();
      ed.focus();
      return true;
    },

    editor: () => activeEditor(),
    /* The reader's own testbench, as the pane's editor if that tab is
       open and as the stored text either way. The tests drive it
       through here for the same reason they drive the design editor
       through editor(): reaching into CodeMirror's internals from
       outside is a test that breaks when CodeMirror is upgraded. */
    myTestbench: () => tbEditor,

    teardown() {
      epoch += 1;
      if (viewer) { viewer.destroy(); viewer = null; }
      if (tbEditor) {
        try { tbEditor.destroy(); } catch { /* already gone */ }
        tbEditor = null;
      }
      myTbNote = '';
      const engine = ENGINE();
      if (engine) engine.stop();
      if (state && state.pane) state.pane.destroy();
      else if (state && state.editor && state.editor.destroy) {
        try { state.editor.destroy(); } catch { /* already gone */ }
      }
      state = null;
      last = null;
      SaveState.cancel();
    },

    emptyMessage(mount, problem) {
      if (multi()) {
        return 'Nothing has been changed yet. The files are as the exercise '
          + 'shipped them, and submitting that would count as an attempt for '
          + 'nothing.';
      }
      if (!state || !state.editor) return 'The editor is not ready yet.';
      if (!state.editor.value.trim()) return 'The editor is empty — write a module before submitting.';
      return 'That is still the starting template, unchanged.';
    },

    collect(mount, problem) {
      if (multi()) {
        const files = state.pane.files();
        if (state.pane.untouched()) return null;
        if (!files.some(f => f.content.trim())) return null;
        return {
          lang: 'sv',
          source: Workspace.pack({ entry: Workspace.entryOf(problem), files }),
          files,
        };
      }
      if (!state || !state.editor) return null;
      const src = state.editor.value.trim();
      if (!src) return null;
      if (src === designOf(problem).trim()) return null;
      return { lang: 'sv', source: state.editor.value };
    },

    /* key: { harness: "<grading testbench>", checks: ["name", …] }

       Async, because the answer is on the other side of a worker.

       Nothing in here looks at the sample testbench or at the sample
       checks: a submission is graded by the grading testbench alone,
       and the names it must produce come from the key. */
    async grade(response, key, problem) {
      const engine = ENGINE();
      if (!engine) {
        return {
          correct: false, score: 0, noAttempt: true,
          feedback: 'There is no simulator in this browser, so nothing was graded.',
        };
      }
      const harness = key.harness;
      const want = key.checks || [];
      if (!harness || !want.length) {
        return {
          correct: false, score: 0, noAttempt: true,
          feedback: 'This exercise has no grading testbench, so it cannot be graded.',
        };
      }

      /* Submitting is a compile and a simulation, and the first one on
         a page also fetches 2.7 MB. The Submit button says "Checking…"
         on its own, which for a download is not enough — so the same
         chip the Run button drives says what stage it is at. */
      showStop(true);
      const off = engine.onProgress(pr => {
        if (pr.stage === 'download' && pr.percent != null) setExec('running', `Simulator ${pr.percent}%`);
        else if (pr.stage === 'build') setExec('running', 'Compiling…');
        else if (pr.stage === 'simulate') setExec('running', 'Grading…');
      });
      setExec('running', engine.ready ? 'Compiling…' : 'Fetching the simulator…');

      let reply;
      try {
        /* What was submitted, not what the editor holds by the time
           the simulator answers. */
        const sources = {};
        if (response.files) for (const f of response.files) sources[f.path] = f.content;
        else sources['design.sv'] = response.source;
        sources[TB_NAME] = harness;

        reply = await engine.run(sources, {
          generation: (problem.payload || {}).generation || '2012',
          /* Never. The grading testbench drives cases the sample one does
             not, and a waveform of it is a picture of them. */
          wantWaveform: false,
        });
      } finally {
        off();
        showStop(false);
      }

      /* The three outcomes that are NOT a wrong answer, kept apart
         because calling any of them wrong blames the reader for
         something that is not theirs. */
      if (reply.cancelled) {
        setExec('blocked', 'Stopped');
        return { correct: false, score: 0, noAttempt: true, feedback: 'Stopped before it finished.' };
      }
      if (!reply.built && reply.blocked) {
        return { correct: false, score: 0, noAttempt: true, lang: 'sv', reply, feedback: reply.blocked };
      }
      const limit = reply.output ? HdlGrade.toolchainLimit(reply.output) : null;
      if (limit) {
        return {
          correct: false, score: 0, noAttempt: true, lang: 'sv', reply,
          feedback: `The simulator could not run this: ${limit}. That is a limit of `
            + 'this build of Icarus Verilog, not a wrong answer, so nothing was recorded.',
        };
      }

      /* A compile failure IS a wrong answer: the design is the answer,
         and one that does not elaborate has not answered. */
      if (reply.built === false) {
        setExec('bad', 'Did not compile');
        const first = (reply.diagnostics || []).find(d => d.level === 'error');
        return {
          correct: false, score: 0, lang: 'sv', reply,
          built: false,
          diagnostics: reply.diagnostics || [],
          feedback: `It did not compile${first ? `: ${first.file}:${first.line}: ${first.message}` : '.'}`,
        };
      }

      const graded = HdlGrade.gradeChecks(reply.output, want, { finished: reply.finished });
      last = { problemId: problem.id, kind: 'grade', reply, graded, at: Date.now() };
      setExec(graded.correct ? 'ok' : 'bad',
        graded.incomplete ? 'Incomplete' : `${graded.passed}/${graded.total} graded checks`);

      /* A run stopped by the wall-clock limit is not graded on what it
         managed to print first. */
      if (reply.timedOut) {
        return {
          correct: false, score: 0, lang: 'sv', reply, graded,
          passed: graded.passed, total: graded.total,
          feedback: `${reply.blocked} Nothing is graded from a run that had to be stopped.`,
        };
      }

      const bits = [];
      if (graded.incomplete) {
        bits.push(`Incomplete: ${graded.incomplete}.`);
        bits.push('A run that does not finish is not a pass, whatever it printed first.');
      } else if (graded.correct) {
        bits.push(`All ${graded.total} checks passed.`);
      } else {
        const f = graded.firstFailure;
        bits.push(`${graded.passed} of ${graded.total} checks passed.`);
        if (f && !f.missing) {
          bits.push(`${f.name}: expected ${f.expect}, got ${f.actual}`
            + `${f.at != null ? ` at t=${f.at}` : ''}.`);
        }
      }
      bits.push('Simulation only — this says nothing about synthesis or timing.');

      return {
        correct: graded.correct,
        /* Incomplete scores nothing, by design: partial credit for a
           design that hung after two checks would reward the hang. */
        score: graded.incomplete ? 0 : graded.score,
        lang: 'sv',
        passed: graded.passed,
        total: graded.total,
        reply,
        graded,
        feedback: bits.join(' '),
      };
    },

    mark() { /* the result pane is the marking */ },

    /* Nothing to reveal into the widget: the solution tab carries the
       reference design and the explanation like any other problem. */
    reveal() {},

    /* For the tests, and for the audit script. */
    _peek: () => ({ last, state: state && { id: state.problem.id, running: state.running } }),
  });
})();
