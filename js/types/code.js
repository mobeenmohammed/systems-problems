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

    const judgeBox = el('div', { class: 'judge-state', 'data-up': 'false', style: 'margin-bottom:.6rem' }, [
      el('span', { class: 'dot' }),
      el('span', { id: 'codeJudgeText', text: 'Checking what can run…' }),
    ]);
    mount.append(judgeBox);

    const editorHost = el('div', {});
    mount.append(editorHost);

    state.editor = Editor.create(editorHost, {
      value: sourceFor(problem, lang),
      readOnly: ctx.locked,
      onChange: src => Store.saveDraft(problem, state.lang, src),
      onRun: () => doRun(false),
      onSubmit: () => {
        const btn = document.getElementById('submitBtn');
        if (btn) btn.click();
      },
    });

    const controls = el('div', { class: 'row', style: 'margin-top:.6rem' }, [
      ctx.locked ? null : el('button', {
        class: 'btn', type: 'button', id: 'runBtn',
        onclick: () => doRun(false),
      }, ['Run the samples']),
      ctx.locked ? null : el('span', { class: 'tiny faint' }, ['Ctrl+Enter to run · Ctrl+Shift+Enter to submit']),
      el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button',
        onclick: () => {
          if (!confirm('Replace what you have written with the starting template?')) return;
          state.editor.value = templateFor(problem, state.lang);
          Store.saveDraft(problem, state.lang, state.editor.value);
        },
      }, ['Reset to template']),
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

    /* Which languages are actually runnable is a question for the judge, and
       the answer can change while the page is open — so it is asked here and
       the tabs are updated when it comes back, rather than being guessed. */
    Runners.available(langs).then(rows => {
      const judge = Runners.judge;
      const text = document.getElementById('codeJudgeText');
      const ready = rows.filter(r => r.ready).map(r => LABEL[r.id] || r.id);
      const notReady = rows.filter(r => !r.ready).map(r => LABEL[r.id] || r.id);

      if (text) {
        judgeBox.dataset.up = String(judge.up);
        if (judge.up) {
          text.textContent = `Ready: ${ready.join(', ')}.`;
        } else if (notReady.length) {
          text.textContent =
            `${ready.length ? `${ready.join(', ')} runs here. ` : ''}` +
            `${notReady.join(' and ')} ${notReady.length === 1 ? 'needs' : 'need'} the judge, ` +
            `which is not answering at ${judge.url}. Start it with: ` +
            `docker compose -f judge/compose.yml up -d`;
        } else {
          text.textContent = `Ready: ${ready.join(', ')}.`;
        }
      }

      for (const node of tabs.querySelectorAll('.lang-tab')) {
        const row = rows.find(r => r.id === node.dataset.lang);
        if (row && !row.ready) {
          node.disabled = true;
          node.title = 'Needs the judge, which is not running';
        } else if (row && row.version) {
          node.title = `${row.where} — ${row.version}`;
        }
      }
    });
  }

  function switchLang(id) {
    if (!state || state.lang === id) return;
    /* The draft is saved per language, so flipping to C++ to look at the
       template and back does not cost you what you had written. */
    Store.saveDraft(state.problem, state.lang, state.editor.value);
    state.lang = id;
    state.editor.value = sourceFor(state.problem, id);
    for (const node of state.mount.querySelectorAll('.lang-tab')) {
      node.setAttribute('aria-pressed', String(node.dataset.lang === id));
    }
    state.out.replaceChildren();
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
    state.out.replaceChildren(el('p', { class: 'muted small', text: 'Compiling and running…' }));

    const reply = await Runners.run(state.lang, state.editor.value, cases, {
      profile: pay.profile || 'standard',
      compileMs: (pay.limits || {}).compileMs,
      runMs: (pay.limits || {}).runMs,
    });

    const verdict = RunHarness.judgeRun(reply, cases.map(c => c.expect), { requireClean: !!pay.requireClean });
    paint(verdict, reply, false);

    state.running = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Run the samples'; }
    return verdict;
  }

  /* ---------------- output ---------------- */

  function paint(verdict, reply, isSubmission) {
    const host = state.out;
    host.replaceChildren();

    if (reply.judgeDown) {
      host.append(el('div', { class: 'compile-out', 'data-kind': 'error' }, [
        el('span', { class: 'lbl', text: 'the judge is not answering' }),
        `${reply.judgeError || 'no connection'}\n\nStart it with:\n  docker compose -f judge/compose.yml up -d\n\n` +
        `Then press Check in Settings. The address it is trying is ${Store.config.judgeUrl}.`,
      ]));
      return;
    }

    /* Compiler output is shown whenever there is any, including on a build
       that succeeded. A warning you never read is a warning that taught you
       nothing, and -Wall -Wextra is on every profile for that reason. */
    const cstderr = (reply.compile && reply.compile.stderr || '').trim();
    if (cstderr) {
      host.append(el('div', {
        class: 'compile-out',
        'data-kind': verdict.built ? 'warn' : 'error',
      }, [
        el('span', { class: 'lbl', text: verdict.built ? 'compiler warnings' : 'it did not build' }),
        cstderr,
      ]));
    }

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

  /* ---------------- the registry contract ---------------- */

  register('code', {
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
        return {
          correct: false, score: 0, lang: response.lang,
          feedback: 'The judge is not answering, so this could not be run. Nothing was recorded against the problem.',
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
      state.editor.setReadOnly(false);
      if (result && result.verdict) paint(result.verdict, result.reply || {}, true);
    },
  });
})();
