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

  function sourceFor(problem) {
    const draft = Store.draft(problem.id, 'sv');
    return draft || designOf(problem);
  }

  /* ---------------- rendering ---------------- */

  function render(problem, mount, ctx) {
    const pay = problem.payload || {};

    if (!state || state.problem.id !== problem.id) last = null;
    state = { problem, mount, editor: null, running: false, abort: null };

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

    state.editor = Editor.create(editorHost, {
      value: sourceFor(problem),
      /* CodeMirror has no SystemVerilog mode here, and C-like
         highlighting on Verilog is wrong in a way that misleads —
         `always_ff` is not a type and `logic` is not a keyword it
         knows. Plain text, monospaced, with the editor's own bracket
         matching and indentation, is honest. */
      lang: 'verilog',
      profile: 'standard',
      readOnly: ctx.locked,
      onChange: src => {
        Store.saveDraft(problem, 'sv', src);
        noteSaved();
      },
      onRun: () => doRun(),
      onSubmit: () => {
        const btn = document.getElementById('submitBtn');
        if (btn) btn.click();
      },
    });
  }

  let savedTimer = null;
  function noteSaved() {
    const nodes = [
      document.getElementById('draftNote') || document.getElementById('draftState'),
      document.getElementById('oaSave'),
    ].filter(Boolean);
    if (!nodes.length) return;
    for (const n of nodes) { n.textContent = 'Saving…'; n.dataset.state = 'saving'; }
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      for (const n of nodes) { n.textContent = 'Saved'; n.dataset.state = 'saved'; }
    }, 400);
  }

  function resetTemplate() {
    if (!state || !state.editor) return;
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
  };

  async function doRun() {
    if (!state || !state.editor) return;
    const engine = ENGINE();
    if (!engine) {
      setExec('blocked', 'No simulator');
      return;
    }
    const problem = state.problem;
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
      reply = await engine.run({
        'design.sv': state.editor.value,
        'testbench.sv': testbenchOf(problem),
      }, {
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

    const graded = gradeSample(problem, reply);
    last = { problemId: problem.id, kind: 'sample', reply, graded, at: Date.now() };
    jumpAt = null;

    setExec(
      (reply.cancelled || reply.timedOut) ? 'blocked'
        : !reply.ok ? 'bad'
          : graded.correct ? 'ok' : 'bad',
      reply.cancelled ? 'Stopped'
        : reply.timedOut ? `Stopped after ${Math.round(reply.ms / 1000)}s`
          : !reply.built ? 'Did not compile'
            : `${graded.passed}/${graded.total} sample checks`,
    );

    repaintResult();
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
    { id: 'results', label: 'Results' },
    { id: 'waves', label: 'Waveforms' },
    { id: 'subs', label: 'Submissions' },
    { id: 'compiler', label: 'Diagnostics' },
  ];

  let viewer = null;

  function fillPane(pane, tab, problem) {
    if (viewer) { viewer.destroy(); viewer = null; }

    if (tab === 'tb') { fillTestbench(pane, problem); return true; }
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
    pane.append(el('pre', { class: 'code-block', 'data-lang': 'verilog' },
      [el('code', { text: src })]));
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
      pane.append(el('div', { class: 'verdict', 'data-kind': 'wrong' }, [
        el('h4', { text: 'It did not compile' }),
        el('p', { class: 'tiny faint', text: 'The Diagnostics tab has every message, '
          + 'with the file and the line.' }),
      ]));
      pane.append(diagnosticsNode(reply.diagnostics || []));
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
    const scale = VCD.timescaleOf(testbenchOf(problem));
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

  function diagnosticsNode(rows) {
    const wrap = el('div', { class: 'diags' });
    for (const d of rows) {
      wrap.append(el('div', { class: 'diag', 'data-level': d.level }, [
        el('span', { class: 'diag-where mono tiny' },
          [d.file ? `${d.file}:${d.line}` : '—']),
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
    startingSource: problem => templateFor(problem,
      'sv'),
    editor: () => (state ? state.editor : null),

    teardown() {
      epoch += 1;
      if (viewer) { viewer.destroy(); viewer = null; }
      const engine = ENGINE();
      if (engine) engine.stop();
      if (state && state.editor && state.editor.destroy) {
        try { state.editor.destroy(); } catch { /* already gone */ }
      }
      state = null;
      last = null;
      clearTimeout(savedTimer);
    },

    emptyMessage(mount, problem) {
      if (!state || !state.editor) return 'The editor is not ready yet.';
      if (!state.editor.value.trim()) return 'The editor is empty — write a module before submitting.';
      return 'That is still the starting template, unchanged.';
    },

    collect(mount, problem) {
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
        reply = await engine.run({
          'design.sv': response.source,
          'testbench.sv': harness,
        }, {
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
