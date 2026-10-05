/* ============================================================
   types/code.js — "code": write a program, compile it, run it.

   Every code problem is stdin to stdout. That is the one contract
   that means the same thing in JavaScript, Python, C++ and Rust,
   so one grader serves all four and a problem can accept any of
   them. Parsing the input is part of the exercise.

   Visible cases live in the problem file and run on "Run". The
   hidden cases arrive with the answer key on "Submit", so passing
   the samples is not the same as solving it.

   grade() is async here, which the registry allows: it has to
   reach a Worker or the judge. The verdict it returns is built by
   RunHarness, which is pure and tested on its own.
   ============================================================ */

(() => {
  const { el, register } = ProblemTypes;

  const LABEL = { js: 'JavaScript', python: 'Python', cpp: 'C++', rust: 'Rust' };

  /* The starting point per language. For the compiled ones this is the I/O
     boilerplate, because a problem about tiled matrix multiply should not also
     be a problem about remembering how to read a line in Rust. */
  const TEMPLATE = {
    js: `// Read with readStdin() or readLines(); write with print().
const lines = readLines();

print(lines[0]);
`,
    python: `import sys

data = sys.stdin.read().split()

print(data[0])
`,
    cpp: `#include <iostream>
#include <vector>
#include <string>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n;
    std::cin >> n;

    std::cout << n << "\\n";
    return 0;
}
`,
    rust: `use std::io::{self, Read, Write};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let mut it = input.split_whitespace();

    let n: i64 = it.next().unwrap().parse().unwrap();

    let stdout = io::stdout();
    let mut out = stdout.lock();
    writeln!(out, "{}", n).unwrap();
}
`,
  };

  /* Per-problem UI state. Only one problem is ever on screen, so a single
     slot is honest rather than a map that never gets cleaned out. */
  let state = null;

  /* The last run, kept so the Results and Compiler output panes can be
     repainted when the reader switches between them — the panes belong to the
     workspace, the output belongs here. */
  let last = { verdict: null, reply: null, submission: false };

  function templateFor(problem, lang) {
    const given = (problem.payload.templates || {})[lang];
    return given != null ? given : (TEMPLATE[lang] || '');
  }

  function sourceFor(problem, lang) {
    const draft = Store.draft(problem.id, lang);
    return draft || templateFor(problem, lang);
  }

  /* ---------------- rendering ---------------- */

  function render(problem, mount, ctx) {
    const pay = problem.payload || {};
    const langs = pay.langs || ['js'];
    const record = Store.record(problem.id);
    const lang = langs.includes(record.lang) ? record.lang : langs[0];

    /* Opening a different problem must not inherit the last one's result.
       The workspace redraws in place, though, so the result is kept when the
       problem is the same — that is what puts "Ran on Hosted" back on the
       chip and the cases back in the pane after a redraw. */
    if (!state || state.problem.id !== problem.id) {
      last = { verdict: null, reply: null, submission: false };
    }
    state = { problem, mount, lang, editor: null, out: null, langs, running: false };

    const head = el('div', { class: 'editor-head' });
    const tabs = el('div', { class: 'lang-tabs', role: 'group', 'aria-label': 'Language' });
    head.append(tabs);

    if (pay.profile && pay.profile !== 'standard') {
      head.append(el('span', { class: 'pill pill-plain', title: 'The compiler flags this problem is built with' },
        [pay.profile]));
    }
    if (pay.requireClean) {
      head.append(el('span', {
        class: 'pill', style: 'color:var(--warn)',
        title: 'Right output is not enough: the sanitizer must also be quiet',
      }, ['must be clean']));
    }
    mount.append(head);

    const editorHost = el('div', { class: 'ed-host' });
    mount.append(editorHost);

    /* Under the editor, not above it, and hidden by CSS whenever everything
       can run — the toolbar chip says Hosted or Local in the ordinary case.
       This is for when it cannot: "No runner" on its own does not tell
       anybody which runner, or what to do about it. It is after the editor
       in the DOM because the editor is the row the workspace grid gives the
       leftover height to. */
    const judgeBox = el('div', { class: 'judge-state', 'data-up': 'false' }, [
      el('span', { class: 'dot' }),
      el('span', { id: 'codeJudgeText', text: 'Checking what can run…' }),
    ]);
    mount.append(judgeBox);

    state.editor = Editor.create(editorHost, {
      value: sourceFor(problem, lang),
      lang,
      profile: pay.profile || 'standard',
      readOnly: ctx.locked,
      onChange: src => {
        Store.saveDraft(problem, state.lang, src);
        noteSaved();
      },
      onRun: () => doRun(false),
      onSubmit: () => {
        const btn = document.getElementById('submitBtn');
        if (btn) btn.click();
      },
    });

    /* Run and Submit are rendered by the problem page, together, in a bar that
       sticks to the bottom of this column. What stays here is the editor's own
       housekeeping. */
    const controls = el('div', { class: 'editor-tools' }, [
      el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button',
        title: 'Put the starting template back',
        onclick: () => {
          if (!confirm('Replace what you have written with the starting template?')) return;
          state.editor.value = templateFor(problem, state.lang);
          Store.saveDraft(problem, state.lang, state.editor.value);
          noteSaved('reset to the template');
        },
      }, ['Reset to template']),
      el('span', { class: 'tiny faint', id: 'draftNote' }, ['']),
    ]);
    mount.append(controls);

    state.out = el('div', { class: 'run-out', id: 'runOut' });
    mount.append(state.out);

    /* The tabs are built after the editor so switching one can reach it. */
    for (const id of langs) {
      tabs.append(el('button', {
        class: 'lang-tab', type: 'button', 'data-lang': id,
        'aria-pressed': String(id === lang),
        onclick: () => switchLang(id),
      }, [LABEL[id] || id]));
    }

    /* Which languages are actually runnable — and *where* each would run —
       is a question for the runners, and the answer can change while the page
       is open. So it is asked here and the tabs are updated when it comes
       back, rather than being guessed. The backend is always named: Hosted,
       Local or Browser. Nothing quietly assumes localhost. */
    refreshExec();
  }

  /* Repaints the toolbar chip, the sentence under the tabs, and which tabs
     are selectable, from a fresh look at what can run right now. Called on
     mount and again whenever the language changes, because the three
     backends do not all offer the same languages. */
  function refreshExec() {
    if (!state) return;
    const { langs, mount } = state;
    const tabs = mount.querySelector('.lang-tabs');
    const judgeBox = mount.querySelector('.judge-state');

    setExec('checking', 'Checking…');

    return Promise.all([Runners.available(langs), Runners.describe(langs)])
      .then(([rows, said]) => {
        /* The page may have moved on while the probes were out. */
        if (!state || state.mount !== mount) return;

        /* The workspace redraws after every run, which remounts this widget,
           so the chip has to be rebuilt from what is known rather than left
           as whatever doRun last wrote into it. Three things it can say, in
           order of what the reader most needs: what just happened, what
           would happen, and that nothing can. */
        const here = rows.find(r => r.id === state.lang);

        const text = document.getElementById('codeJudgeText');
        if (text) {
          /* Hidden when the language in front of the reader can run. Another
             language being unavailable is worth saying somewhere, but not
             worth a standing notice over the editor of the one that works. */
          if (judgeBox) judgeBox.dataset.up = String(!!(here && here.ready));
          text.textContent = said.text;
        }
        const ran = last.reply && last.reply.lang === state.lang;
        if (ran && last.reply.judgeDown) {
          setExec('blocked', `Could not run — ${Runners.label(last.reply.backend)}`);
        } else if (ran) {
          setExec('ready', `Ran on ${Runners.label(last.reply.backend)}`);
        } else if (here && here.ready) {
          setExec('ready', here.version ? `${here.where} · ${here.version}` : here.where);
        } else {
          setExec('blocked', 'No runner');
        }

        if (!tabs) return;
        for (const node of tabs.querySelectorAll('.lang-tab')) {
          const row = rows.find(r => r.id === node.dataset.lang);
          if (!row) continue;
          node.disabled = !row.ready;
          node.title = row.ready
            ? `${row.where}${row.version ? ` — ${row.version}` : ''}`
            : 'Nothing available can run this — see the note under the tabs';
        }
      });
  }

  function switchLang(id) {
    if (!state || state.lang === id) return;
    /* The draft is saved per language, so flipping to C++ to look at the
       template and back does not cost you what you had written. */
    Store.saveDraft(state.problem, state.lang, state.editor.value);
    state.lang = id;
    /* The language drives both the highlighting and which compiler lints it,
       so the editor has to be told before the new source goes in. */
    state.editor.setLang(id, (state.problem.payload || {}).profile || 'standard');
    state.editor.value = sourceFor(state.problem, id);
    for (const node of state.mount.querySelectorAll('.lang-tab')) {
      node.setAttribute('aria-pressed', String(node.dataset.lang === id));
    }
    state.out.replaceChildren();
    /* C++ may be hosted while JavaScript runs in the browser, so the chip has
       to be re-asked rather than carried over from the previous language. */
    refreshExec();
  }

  /* Drafts were already saved on every keystroke; what was missing was any
     sign of it, which is the difference between a feature and a feature
     someone trusts. The note is debounced so it reads "Saved" rather than
     flickering on every character. */
  let savedTimer = null;

  function noteSaved(what = '') {
    const node = document.getElementById('draftNote')
      || document.getElementById('draftState');
    if (!node) return;
    node.textContent = 'Saving\u2026';
    node.dataset.state = 'saving';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      const at = new Date();
      const hh = String(at.getHours()).padStart(2, '0');
      const mm = String(at.getMinutes()).padStart(2, '0');
      node.textContent = what ? `Saved \u2014 ${what}` : `Saved at ${hh}:${mm}`;
      node.dataset.state = 'saved';
    }, 420);
  }

  /* ---------------- running ---------------- */

  async function doRun(hidden) {
    if (!state || state.running) return;
    const { problem } = state;
    const pay = problem.payload || {};
    const cases = pay.cases || [];

    state.running = true;
    const btn = document.getElementById('runBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    if (state.out) state.out.replaceChildren(el('p', { class: 'muted small', text: 'Compiling and running…' }));
    setExec('running', 'Compiling and running…');

    const reply = await Runners.run(state.lang, state.editor.value, cases, {
      profile: pay.profile || 'standard',
      compileMs: (pay.limits || {}).compileMs,
      runMs: (pay.limits || {}).runMs,
    });

    const verdict = RunHarness.judgeRun(reply, cases.map(c => c.expect), { requireClean: !!pay.requireClean });
    last = { verdict, reply, submission: false };
    paint(verdict, reply, false);

    /* Say where it just ran, every time. A reader who cannot tell Hosted from
       Local cannot tell a service outage from a runner they forgot to start. */
    if (reply.judgeDown) setExec('blocked', 'Could not run');
    else setExec('ready', `Ran on ${Runners.label(reply.backend)}`);

    state.running = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Run samples'; }
    /* Show the reader what just happened rather than leaving the result in a
       tab they are not looking at. */
    if (typeof ProblemView !== 'undefined' && ProblemView.showResults) ProblemView.showResults();
    return verdict;
  }

  /* ---------------- output ---------------- */

  /* The execution-status chip in the workspace toolbar. */
  function setExec(kind, text) {
    const node = document.getElementById('execState');
    if (!node) return;
    node.dataset.state = kind;
    node.textContent = text;
  }

  /* What to tell someone whose run did not happen. An execution failure is
     not a wrong answer, and the advice has to match the backend that actually
     failed: telling a visitor on the public site to run `npm run runner` is
     wrong, and so is telling someone whose own runner died to go and wait for
     a hosted service to recover. */
  function downAdvice(backend) {
    if (backend === 'local') {
      return 'Start it with:\n  npm run runner\n\nThen press Check connection in '
        + `Settings. The address it is trying is ${Store.config.judgeUrl}.`;
    }
    if (backend === 'hosted') {
      return 'That is the hosted runner, not your code. Your work is saved — try '
        + 'again in a moment, or start a local runner and point Settings at it.';
    }
    return 'Nothing available can run this language. Settings can point the page '
      + 'at a hosted runner, or you can start a local one with npm run runner.';
  }

  function paint(verdict, reply, isSubmission, into) {
    const host = into || state.out;
    if (!host) return;
    host.replaceChildren();

    if (reply.judgeDown) {
      host.append(el('div', { class: 'compile-out', 'data-kind': 'error' }, [
        el('span', { class: 'lbl', text: `could not run — ${reply.backend ? Runners.label(reply.backend) : 'no runner'}` }),
        `${reply.judgeError || 'no connection'}\n\n${downAdvice(reply.backend)}`,
      ]));
      return;
    }

    /* Compiler output is shown whenever there is any, including on a build
       that succeeded. A warning you never read is a warning that taught you
       nothing, and -Wall -Wextra is on every profile for that reason. */
    const cstderr = (reply.compile && reply.compile.stderr || '').trim();
    if (cstderr) host.append(diagnosticsNode(cstderr, verdict.built));

    if (!verdict.built) return;

    host.append(el('p', { class: 'small muted' }, [
      `${verdict.passed} of ${verdict.cases.length} ` +
      `${isSubmission ? 'hidden ' : 'sample '}${verdict.cases.length === 1 ? 'case' : 'cases'} passed.`,
    ]));

    verdict.cases.forEach((c, i) => {
      const open = !c.pass;
      const body = el('div', { class: 'io' }, [
        el('div', {}, [el('h5', { text: 'stdin' }), el('pre', { text: (c.stdinShown || '') || '(none)' })]),
        el('div', {}, [el('h5', { text: 'expected' }), el('pre', { text: c.expect || '(nothing)' })]),
        el('div', {}, [
          el('h5', { text: 'got' }),
          el('pre', { class: c.pass ? 'diff-ok' : 'diff-bad', text: c.stdout || '(nothing)' }),
        ]),
        (c.stderr || '').trim()
          ? el('div', { style: 'grid-column:1/-1' }, [
              el('h5', { text: c.sanitizer ? 'sanitizer' : 'stderr' }),
              el('pre', { class: c.sanitizer ? 'diff-bad' : '', text: c.stderr.trim() }),
            ])
          : null,
      ]);
      body.hidden = !open;

      const node = el('div', { class: 'case', 'data-pass': String(c.pass) }, [
        el('div', {
          class: 'case-head',
          onclick: () => { body.hidden = !body.hidden; },
        }, [
          el('span', { text: c.pass ? '✓' : '✗' }),
          el('span', { text: `Case ${i + 1}` }),
          el('span', { class: 'faint tiny', text: c.why }),
          el('span', { class: 'faint tiny mono', style: 'margin-left:auto', text: `${c.ms} ms` }),
        ]),
        body,
      ]);
      host.append(node);
    });
  }

  /* ---------------- readable diagnostics ----------------

     A compiler's answer arrives as one blob with absolute paths, notes
     attached to errors, and a caret diagram in the middle. Read as a wall of
     text it teaches nothing; the useful shape is a list of places with a
     severity and a message, each one clickable.

     So the blob is parsed into rows and rendered as a list, with the original
     text still available underneath - because the caret diagrams and the
     template backtraces are sometimes exactly what you need, and a parser
     that throws them away is worse than no parser. */

  /* The path is not anchored on, because it can be a Windows drive letter,
     a WSL path, or "<source>" depending on who compiled. What is reliable is
     ":line:col: severity:". */
  const DIAG_LINE = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note|help)(?:\[([^\]]*)\])?:\s*(.*)$/;
  /* GCC and Clang name the flag at the END of the message - "unused variable
     'mid' [-Wunused-variable]" - while rustc puts a code right after the
     severity. Both are worth showing, and in the same place. */
  const TRAILING_FLAG = /\s*\[(-W[\w=+-]+|[A-Z]\d{3,})\]\s*$/;
  /* Python has no column and says it differently. */
  const PY_LINE = /^\s*File "([^"]*)", line (\d+)/;
  /* The line of a traceback that actually says what is wrong. */
  const PY_MESSAGE = /^[A-Za-z_][\w.]*(Error|Warning|Exception|Interrupt)\b/;

  function parseDiagnostics(text) {
    const rows = [];
    const lines = String(text).split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      const m = DIAG_LINE.exec(line);
      if (m) {
        const severity = m[4] === 'fatal error' ? 'error' : m[4];
        /* note/help lines belong to the diagnostic above them: they are the
           explanation, not a separate problem. */
        if ((severity === 'note' || severity === 'help') && rows.length) {
          rows[rows.length - 1].notes.push({
            line: Number(m[2]), message: m[6],
          });
          continue;
        }
        let message = m[6];
        let code = m[5] || '';
        const trailing = TRAILING_FLAG.exec(message);
        if (trailing) {
          code = code || trailing[1];
          message = message.slice(0, trailing.index);
        }
        rows.push({
          line: Number(m[2]),
          column: Number(m[3]),
          severity,
          code,
          message,
          notes: [],
        });
        continue;
      }

      const py = PY_LINE.exec(line);
      if (py) {
        /* A traceback frame is three or four lines: the location, the source
           echoed back, a caret, and then the exception. The echo looks like
           ordinary text, so the exception is found by its shape - a name
           ending in Error or Exception followed by a colon - rather than by
           counting lines, which differs between versions. */
        let message = '';
        for (let j = i + 1; j < lines.length; j += 1) {
          const candidate = lines[j].trim();
          if (!candidate) continue;
          if (PY_MESSAGE.test(candidate)) { message = candidate; break; }
          /* Another frame: this one has no exception of its own. */
          if (PY_LINE.test(lines[j])) break;
        }
        rows.push({
          line: Number(py[2]), column: 1, severity: 'error', code: '',
          message: message || 'syntax error', notes: [],
        });
      }
    }

    return rows;
  }

  const SEVERITY_WORD = { error: 'error', warning: 'warning', note: 'note', help: 'help' };

  function diagnosticsNode(text, built) {
    const rows = parseDiagnostics(text);
    const errors = rows.filter(r => r.severity === 'error').length;
    const warnings = rows.filter(r => r.severity === 'warning').length;

    const summary = built
      ? (warnings
          ? `It built, with ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
          : 'It built')
      : (errors
          ? `It did not build \u2014 ${errors} ${errors === 1 ? 'error' : 'errors'}`
          : 'It did not build');

    const node = el('div', { class: 'diags', 'data-kind': built ? 'warn' : 'error' }, [
      el('div', { class: 'diags-head' }, [
        el('span', { class: 'lbl', text: summary }),
        warnings && built
          ? el('span', { class: 'tiny faint', text: 'warnings are on deliberately \u2014 they are usually the lesson' })
          : null,
      ]),
    ]);

    if (!rows.length) {
      /* Nothing matched the shape - a linker error, or a toolchain speaking
         for itself. Show it verbatim rather than claiming there is nothing. */
      node.append(el('pre', { class: 'diags-raw', text: text }));
      return node;
    }

    const list = el('ol', { class: 'diags-list' });
    for (const r of rows) {
      list.append(el('li', { class: 'diag', 'data-severity': r.severity }, [
        el('button', {
          class: 'diag-where', type: 'button',
          title: `Go to line ${r.line}`,
          onclick: () => {
            if (state && state.editor && state.editor.goToLine) {
              state.editor.goToLine(r.line, r.column);
              state.editor.focus();
            }
          },
        }, [`${r.line}:${r.column}`]),
        el('span', { class: 'diag-sev', text: SEVERITY_WORD[r.severity] || r.severity }),
        el('span', { class: 'diag-msg' }, [
          r.message,
          r.code ? el('span', { class: 'diag-code', text: ` [${r.code}]` }) : null,
        ]),
        r.notes.length
          ? el('ul', { class: 'diag-notes' }, r.notes.map(n =>
              el('li', { text: `line ${n.line}: ${n.message}` })))
          : null,
      ]));
    }
    node.append(list);

    node.append(el('details', { class: 'diags-full' }, [
      el('summary', { text: 'The compiler\u2019s own words' }),
      el('pre', { class: 'diags-raw', text: text }),
    ]));

    return node;
  }

  /* ---------------- the registry contract ---------------- */

  register('code', {
    /* The Run button now lives in the problem page's action bar, beside
       Submit, so the two are in one place rather than one being buried under
       the editor. The type module still owns running. */
    run: doRun,

    /* The workspace owns the panes; this module owns what goes in them. */
    editor: () => (state ? state.editor : null),
    repaintOutput(into) {
      if (!into) return;
      if (last.verdict) paint(last.verdict, last.reply || {}, last.submission, into);
      else into.replaceChildren(el('p', { class: 'muted small', text: 'Nothing run yet.' }));
    },
    lastCompilerOutput: () => ((last.reply && last.reply.compile && last.reply.compile.stderr) || '').trim(),
    lastBuildOk: () => !!(last.reply && last.reply.compile && last.reply.compile.ok),

    /* Exposed so the presentation can be tested without a toolchain: the
       parser's job is turning one blob into rows, and that is checkable
       against captured compiler output. */
    parseDiagnostics, diagnosticsNode,
    render,

    collect(mount, problem) {
      if (!state || !state.editor) return null;
      const src = state.editor.value.trim();
      if (!src) return null;
      /* An untouched template is not an attempt. Grading it would mark the
         problem attempted and burn the first-try bonus for nothing. */
      if (src === templateFor(problem, state.lang).trim()) return null;
      return { lang: state.lang, source: state.editor.value };
    },

    /* key: { cases: [{ stdin, expect }], reference: { cpp: "…", … } }

       Async, because the answer is on the other side of a Worker or an HTTP
       call. problem.js awaits it, which costs the synchronous types nothing. */
    async grade(response, key, problem) {
      const pay = problem.payload || {};
      const hidden = key.cases || [];
      const all = [...(pay.cases || []), ...hidden];

      const reply = await Runners.run(response.lang, response.source, all, {
        profile: pay.profile || 'standard',
        compileMs: (pay.limits || {}).compileMs,
        runMs: (pay.limits || {}).runMs,
      });

      const verdict = RunHarness.judgeRun(reply, all.map(c => c.expect), { requireClean: !!pay.requireClean });

      /* Stash what the stdin was so the painted output can show it; the judge
         does not echo it back. */
      verdict.cases.forEach((c, i) => { c.stdinShown = (all[i] || {}).stdin || ''; });

      if (reply.judgeDown) {
        /* Name the backend. "The judge is not answering" was written when
           there was only one, and reading it on the published site — where
           the judge is a hosted service the reader has never heard of — is
           no help at all. */
        return {
          correct: false, score: 0, lang: response.lang,
          backend: reply.backend || null,
          feedback: reply.judgeError
            || `${reply.backend ? Runners.label(reply.backend) : 'Nothing available'} could not run this.`,
          noAttempt: true, reply, verdict,
        };
      }

      return {
        correct: verdict.correct,
        score: verdict.score,
        feedback: verdict.feedback,
        lang: response.lang,
        /* Passing under the sanitizer with nothing to report is a stronger
           claim than passing, and the profile achievement counts it. */
        sanitized: (pay.profile === 'sanitize') && verdict.correct && !verdict.cases.some(c => c.sanitizer),
        reply, verdict,
      };
    },

    mark(mount, { result }) {
      if (!state) return;
      /* The editor is never locked by an attempt: a compile error, a wrong
         answer and a timeout all leave the code exactly as written, and the
         next attempt is one keystroke away. */
      state.editor.setReadOnly(false);
      if (result && result.verdict) {
        last = { verdict: result.verdict, reply: result.reply || {}, submission: true };
      }
    },
  });
})();
