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

  /* The catalogue owns this: it filters on the same list, and the Language
     filter's options and this picker's labels have to be the same words. */
  const LABEL = Catalog.LANG_LABEL;

  /* The starting point per language. For the compiled ones this is the I/O
     boilerplate, because a problem about tiled matrix multiply should not also
     be a problem about remembering how to read a line in Rust. */
  const TEMPLATE = {
    js: `// Read with readStdin() or readLines(); write with print().
const lines = readLines();

// your code here — the line below only shows how to print.
print(lines[0]);
`,
    python: `import sys

data = sys.stdin.read().split()

# your code here — the line below only shows how to print.
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

    // your code here — the lines around it only show how to read and write.
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

    // your code here — the lines around it only show how to read and write.

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
  /* `at` is what keeps a Run after a Submit from being overwritten. mark()
     runs on every redraw and used to re-adopt the submission's result
     unconditionally, so pressing Run on a solved problem showed the output
     of the submission before it — including "it built" for a program that
     had just failed to compile. */
  let last = { verdict: null, reply: null, submission: false, at: 0 };

  /* The Results pane owns the node; this module only fills it. It does
     not exist until that pane has been painted, which is why every run
     opens Results before it starts. */
  const outNode = () => document.getElementById('runOut');

  /* ---------------- starter code, and which one ----------------

     A practice template teaches. It carries the signature, and then it
     says what to do inside it: "walk s, and for each run of identical
     characters append the character and, only if the run is longer than
     one, its length. Jump past the whole run, not past one character."
     That is the right thing to hand somebody who is learning the idea,
     and it is the algorithm, written out, in the editor.

     Under a clock it is the answer. So an assessment problem carries a
     second starter — `payload.assessmentTemplates` — which keeps
     everything that is part of the interface (the includes, the
     signatures, the harness in `main` that reads the input and prints
     the result) and nothing that is part of the method. The task and
     its constraints go in the statement, where a specification belongs.

     Two authored files rather than one file with the comments stripped
     by a regex, because a regex cannot tell the difference between
     coaching and an interface contract, and a licence header is a
     comment too. The validator checks that both exist and that the
     assessment one has not had the solution left in it. */
  let assessMode = false;

  function templateFor(problem, lang) {
    const pay = problem.payload || {};
    if (assessMode) {
      const neutral = (pay.assessmentTemplates || {})[lang];
      /* No fallback to the teaching template. A missing assessment
         starter is caught by scripts/check-assessments.mjs before it can
         ship; falling back here would make that check cosmetic, and the
         failure it is guarding against is silent disclosure. */
      if (neutral != null) return neutral;
    }
    const given = (pay.templates || {})[lang];
    return given != null ? given : (TEMPLATE[lang] || '');
  }

  function sourceFor(problem, lang) {
    const draft = Store.draft(problem.id, lang);
    return draft || templateFor(problem, lang);
  }

  /* ---------------- a workspace of several files ----------------

     A problem with `payload.files` opens as a file tree and a row of
     tabs rather than one editor. The tree, the tabs, the per-file
     editors and the per-file drafts are js/filepane.js, which the
     hardware type uses too; what is here is the part that is about
     C++ — which files are translation units, and what Run sends.

     `state.pane` is the handle. `state.editor` follows whichever file
     is on top, so everything written against one editor — the font
     control, the report, loading a submission back — keeps working
     unchanged. */

  const multi = () => !!(state && state.pane);
  const pane = () => (state && state.pane) || null;
  const fileList = () => (multi() ? state.pane.files() : null);
  const activeEditor = () => (multi()
    ? state.pane.editor()
    : (state ? state.editor : null));

  /* Headers are C++ too — a .hpp with no colour in the middle of a C++
     exercise is worse than none. */
  function langOfFile(path) {
    const e = Workspace.ext(path);
    if (e === '.rs') return 'rust';
    if (e === '.py') return 'python';
    if (e === '.sv' || e === '.svh' || e === '.v') return 'sv';
    return 'cpp';
  }

  function buildWorkspace(host, problem, ctx) {
    state.pane = FilePane.create(host, {
      problem,
      lang: state.lang,
      ctx,
      langOf: langOfFile,
      lint: false,
      onSaved: () => noteSaved(),
      onRun: () => doRun(false),
      onSubmit: () => {
        const btn = document.getElementById('submitBtn');
        if (btn) btn.click();
      },
    });
    state.editor = state.pane.editor();
  }

  /* Opening a file makes it the one everything else means by "the
     editor". */
  function showFile(path, opts) {
    if (!multi()) return false;
    const ok = state.pane.open(path, opts);
    state.editor = state.pane.editor();
    return ok;
  }

  function goToDiagnostic(file, line, column) {
    if (!multi()) {
      const ed = activeEditor();
      if (ed && ed.goToLine) { ed.goToLine(line, column); ed.focus(); }
      return;
    }
    state.pane.goTo(file, line, column);
    state.editor = state.pane.editor();
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
      last = { verdict: null, reply: null, submission: false, at: 0 };
    }
    assessMode = !!ctx.assess;
    state = { problem, mount, lang, editor: null, langs, running: false, pane: null };

    const head = el('div', { class: 'editor-head' });
    /* One control rather than a row of them. Four languages across the top
       of the editor was four buttons saying what this problem could be
       written in; what the reader needs is one saying what it is being
       written in now, with the others a click away. */
    const pick = langPicker(langs, lang);
    head.append(pick);

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

    if (Workspace.isMulti(problem)) {
      /* Several files, one CodeMirror each, and a tree to move between
         them. state.editor follows whichever is on top so that
         everything written against one editor — the font control, the
         report, loading a submission back — keeps working unchanged. */
      editorHost.classList.add('ed-host-multi');
      buildWorkspace(editorHost, problem, ctx);
      const carried = state.pane.carryForward();
      if (carried.length) {
        /* Said, not silent. The reader is looking at their own code in
           an exercise they have just opened for the first time, and
           "where did this come from" is a question worth answering
           before it is asked. */
        UI.toast(`Carried ${carried.length} file${carried.length === 1 ? '' : 's'} `
          + 'forward from the previous milestone.', 'info', 7000);
      }
    } else {
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
    }

    /* Reset, Run and Submit are all rendered by the problem page, in one
       bar across the bottom of this column, and the output goes in the
       Results pane. Nothing of either is left in here — there used to be
       a second copy of every case under the editor, which survived as a
       stale duplicate the moment the panes stopped being redrawn
       together. */

    /* Which languages are actually runnable — and *where* each would run —
       is a question for the runners, and the answer can change while the page
       is open. So it is asked here and the tabs are updated when it comes
       back, rather than being guessed. The backend is always named: Hosted,
       Local or Browser. Nothing quietly assumes localhost. */
    refreshExec();
  }

  /* ---------------- the language picker ----------------

     A button that says which language, and a menu of the others, each
     with a line under it saying where it would run. refreshExec() fills
     those lines in from a live look at the backends.

     An option is never removed and never disabled. A language the
     problem accepts but nothing here can run is still worth opening —
     the template is the clearest statement of what the exercise wants in
     that language, and you may well be about to start a runner. What it
     gets instead of a disabled button is the reason and the way out,
     written where you are looking rather than hidden in a tooltip.

     "C++ only" is said in words, next to the name. It used to be a
     `title` on a disabled button, which is invisible to a reader and
     absent on a touchscreen — so a problem with one language looked
     exactly like a problem whose other languages had broken. */
  function langPicker(langs, lang) {
    const only = langs.length < 2;

    const name = el('span', { class: 'lang-pick-name', text: LABEL[lang] || lang });
    const btn = el('button', {
      class: 'lang-pick-btn', type: 'button',
      'aria-haspopup': only ? undefined : 'listbox',
      'aria-expanded': only ? undefined : 'false',
      disabled: only || undefined,
      title: only
        ? `This exercise is ${LABEL[lang] || lang} only — that is a property of `
          + 'the exercise, not of what is installed'
        : 'Which language to write it in',
    }, [
      el('span', { class: 'lang-mark', 'data-lang': lang, 'aria-hidden': 'true' }),
      name,
      only ? el('span', { class: 'lang-pick-only', text: 'only' }) : caret(),
    ]);

    const menu = el('div', {
      class: 'lang-menu', role: 'listbox', 'aria-label': 'Language', hidden: true,
    }, langs.map(id => el('button', {
      class: 'lang-opt', type: 'button', role: 'option', 'data-lang': id,
      'aria-selected': String(id === lang),
      onclick: () => { shutMenu(); switchLang(id); },
    }, [
      el('span', { class: 'lang-mark', 'data-lang': id, 'aria-hidden': 'true' }),
      el('span', { class: 'lang-opt-text' }, [
        el('span', { class: 'lang-opt-name', text: LABEL[id] || id }),
        el('span', { class: 'lang-opt-note tiny faint', text: 'checking\u2026' }),
      ]),
    ])));

    const wrap = el('div', { class: 'lang-pick', 'data-lang': lang }, [btn, menu]);

    function shutMenu() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }

    if (!only) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) {
          const first = menu.querySelector('.lang-opt[aria-selected="true"]') || menu.firstChild;
          if (first) first.focus();
        }
      });
      /* A menu left open over the editor is a menu in the way of the thing
         it is about. */
      document.addEventListener('click', e => {
        if (menu.hidden) return;
        if (!e.target.closest('.lang-pick')) shutMenu();
      });
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || menu.hidden) return;
        shutMenu();
        btn.focus();
      });
    }

    return wrap;
  }

  function caret() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lang-caret');
    svg.setAttribute('viewBox', '0 0 10 6');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path d="M1 1.4 5 4.8 9 1.4" fill="none" stroke="currentColor" '
      + 'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
    return svg;
  }

  /* Put the starting template back. Called from the bar at the foot of the
     column, which is where the other two things you can do to a program
     already are. */
  function resetTemplate(scope) {
    if (!state) return;
    /* On a workspace the page has already asked which, and what it
       would cost; the scope it decided on is the argument. */
    if (multi()) {
      const put = state.pane.reset(scope === 'file' ? 'file' : 'all');
      noteSaved(put.length === 1 ? `${put[0]} reset` : 'the whole workspace reset');
      return;
    }
    if (!confirm('Replace what you have written with the starting template?')) return;
    state.editor.value = templateFor(state.problem, state.lang);
    Store.saveDraft(state.problem, state.lang, state.editor.value);
    noteSaved('reset to the template');
    state.editor.focus();
  }

  /* Repaints the toolbar chip, the sentence under the tabs, and which tabs
     are selectable, from a fresh look at what can run right now. Called on
     mount and again whenever the language changes, because the three
     backends do not all offer the same languages. */
  function refreshExec() {
    if (!state) return;
    const { langs, mount } = state;
    /* Same reason as switchLang: the picker lives in the tab strip by now,
       which is outside this module's mount. */
    const pick = mount.querySelector('.lang-pick') || document.querySelector('.lang-pick');
    const judgeBox = mount.querySelector('.judge-state');

    setExec('checking', 'Checking…');

    const where = { multiFile: multi() };
    return Promise.all([
      Runners.available(langs, state.problem.id, where),
      Runners.describe(langs, state.problem.id, where),
    ])
      .then(([rows, said]) => {
        /* The page may have moved on while the probes were out. */
        if (!state || state.mount !== mount) return;

        /* The workspace redraws after every run, which remounts this widget,
           so the chip has to be rebuilt from what is known rather than left
           as whatever doRun last wrote into it. Three things it can say, in
           order of what the reader most needs: what just happened, what
           would happen, and that nothing can. */
        const here = rows.find(r => r.id === state.lang);

        /* The way out, offered exactly when it is needed. */
        const setupLink = document.getElementById('setupLink');
        if (setupLink) setupLink.hidden = !!(here && here.ready);

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
        } else if (said.checks && state.lang === 'rust') {
          /* "No runner" is wrong here, and wrong in the direction that
             matters: rustc's front end IS running, on every keystroke,
             with the real borrow checker. What cannot happen is code
             generation. The chip says which. */
          setExec('check', 'Checked, not run');
        } else {
          setExec('blocked', 'No runner');
        }

        if (!pick) return;
        for (const node of pick.querySelectorAll('.lang-opt')) {
          const row = rows.find(r => r.id === node.dataset.lang);
          if (!row) continue;
          /* Not disabled. The option stays usable and says why it would
             not run, which is the difference between "we removed this"
             and "here is what to do about it". */
          node.dataset.ready = String(!!row.ready);
          const note = node.querySelector('.lang-opt-note');
          const where = row.ready
            ? `${row.where}${row.version ? ` \u00b7 ${row.version}` : ''}`
            : whyNot(row.id, said);
          if (note) note.textContent = where;
          node.title = row.ready
            ? `Runs here: ${where}`
            : `${where}. You can still write it — see Running code for how to `
              + 'get a runner.';
        }
      });
  }

  /* Why a language the exercise accepts would not run, in the fewest words
     that still name the next action. The long version is the sentence
     under the editor and the Running code page; this is the four words
     that go in a menu. */
  function whyNot(id, said) {
    if (said && said.nativeOnly && (id === 'cpp' || id === 'python')) {
      return 'needs the native toolchain';
    }
    if (id === 'rust') return 'no runner here yet';
    return 'no runner \u2014 see Running code';
  }

  function switchLang(id) {
    if (!state || state.lang === id) return;
    /* Anything in flight belongs to the language being left, and the
       ticket is what tells it so: a run that is out when the language
       changes finds `current()` false and returns without painting.

       That is right for the chip and the result and wrong for the Run
       button, because a language switch does NOT redraw the page. The
       button is the same element the abandoned run disabled, and the
       abandoned run is the only code that would have enabled it. It sat
       on "Running…" until a reload — for ever, in practice.

       So the switch ends the run rather than merely disowning it. */
    runEpoch += 1;
    if (state.abort) {
      try { state.abort.abort(); } catch { /* already finished */ }
    }
    state.abort = null;
    state.running = false;
    showStop(false);
    showDownload(null);
    const stale = document.getElementById('runBtn');
    if (stale) { stale.disabled = false; stale.textContent = 'Run tests'; }
    last = { verdict: null, reply: null, submission: false, at: 0 };
    /* The draft is saved per language, so flipping to C++ to look at the
       template and back does not cost you what you had written. */
    Store.saveDraft(state.problem, state.lang, state.editor.value);
    state.lang = id;
    /* Remembered, so the redraw after a run does not put the reader back in
       the language they just left. */
    Store.setLang(state.problem, id);
    /* The language drives both the highlighting and which compiler lints it,
       so the editor has to be told before the new source goes in. */
    state.editor.setLang(id, (state.problem.payload || {}).profile || 'standard');
    state.editor.value = sourceFor(state.problem, id);
    /* The picker was moved into the workspace tab strip when the page
       mounted, so it is no longer inside this module's mount — hence the
       document-wide lookup. Its button is the only thing on screen saying
       which language this is, so it has to be told. */
    const pick = document.querySelector('.lang-pick');
    if (pick) {
      pick.dataset.lang = id;
      const name = pick.querySelector('.lang-pick-name');
      if (name) name.textContent = LABEL[id] || id;
      const mark = pick.querySelector('.lang-pick-btn .lang-mark');
      if (mark) mark.dataset.lang = id;
      for (const node of pick.querySelectorAll('.lang-opt')) {
        node.setAttribute('aria-selected', String(node.dataset.lang === id));
      }
      /* The pip beside the name on the button is the only other thing
         that has to follow; the notes are re-asked by refreshExec. */
    }
    if (outNode()) outNode().replaceChildren();
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
    /* Two places, because inside an assessment the save status belongs
       in the assessment's own header — it is one of the five things that
       bar is required to show, and the editor's own note scrolls away
       with the toolbar on a narrow screen. */
    const nodes = [
      document.getElementById('draftNote') || document.getElementById('draftState'),
      document.getElementById('oaSave'),
    ].filter(Boolean);
    if (!nodes.length) return;
    for (const node of nodes) {
      node.textContent = 'Saving\u2026';
      node.dataset.state = 'saving';
    }
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      const at = new Date();
      const hh = String(at.getHours()).padStart(2, '0');
      const mm = String(at.getMinutes()).padStart(2, '0');
      for (const node of nodes) {
        node.textContent = node.id === 'oaSave'
          ? 'Saved' : (what ? `Saved \u2014 ${what}` : `Saved at ${hh}:${mm}`);
        node.dataset.state = 'saved';
      }
    }, 420);
  }

  /* ---------------- running ----------------

     A run is slow enough that the reader can change the problem or the
     language before it answers. Every run takes a ticket, and every exit
     from a problem or a language takes a new one, so a late reply knows it
     belongs to a page that is no longer there and paints nothing. Without it
     a C++ result could land in a Rust editor, or in a different problem
     altogether. */

  let runEpoch = 0;

  async function doRun(hidden) {
    if (!state || state.running) return;
    const { problem } = state;
    const pay = problem.payload || {};
    const cases = pay.cases || [];
    const epoch = runEpoch;
    const lang = state.lang;

    state.running = true;
    const btn = document.getElementById('runBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    /* Open Results first, not at the end. A compile can take a minute the
       first time, and the reader should watch it happen in the pane that
       will hold the answer rather than at a spinner beside a button. It
       is also what creates #runOut for the progress bar to live in. */
    if (typeof ProblemView !== 'undefined' && ProblemView.showResults) ProblemView.showResults();
    if (outNode()) outNode().replaceChildren(el('p', { class: 'muted small', text: 'Compiling and running…' }));
    setExec('running', 'Compiling and running…');

    /* The source is read here, at the moment of the click, and it is read
       from CodeMirror's own document — there is no second copy to be stale.
       On a workspace that is every file, read the same way, and the
       entry point's text is what `source` means. */
    const files = multi() ? fileList() : null;
    const source = files
      ? (files.find(f => f.path === Workspace.entryOf(problem)) || files[0]).content
      : state.editor.value;

    /* Stop is a real button for as long as this takes, which with the
       in-browser compiler can be a 90 MB download on the first run. */
    state.abort = new AbortController();
    showStop(true);

    /* Only subscribe while a run is in flight, and only paint if the
       toolchain is not already loaded — on every run after the first there
       is nothing to download and nothing to show. */
    const engine = lang === 'python'
      ? (typeof BrowserPy !== 'undefined' ? BrowserPy : null)
      : lang === 'rust'
        ? (typeof BrowserRust !== 'undefined' ? BrowserRust : null)
        : (typeof BrowserCpp !== 'undefined' ? BrowserCpp : null);
    /* Is this run still the one on screen? Asked by everything that
       writes to the page, not only by the code that paints the result.

       A run that has been left behind keeps reporting: the backend calls
       onStage as it compiles and runs, and the download bar reports
       bytes. Those used to be written unconditionally, so opening
       another problem mid-compile left the NEW problem's bar saying
       "Running…" for ever — nothing was running, nothing would ever
       correct it, and the only thing that cleared it was a reload.
       Found by the Rust suite; the same code runs every language. */
    const current = () => epoch === runEpoch && state
      && state.problem.id === problem.id && state.lang === lang;

    const unwatch = (engine && !engine.ready)
      ? engine.onProgress(p => { if (current()) showDownload(p, lang); }) : null;

    let reply;
    try {
      reply = await Runners.run(lang, source, cases, {
        problemId: problem.id,
        files,
        sources: files ? Workspace.buildSources(problem) : null,
        entry: files ? Workspace.entryOf(problem) : null,
        profile: pay.profile || 'standard',
        compileMs: (pay.limits || {}).compileMs,
        runMs: (pay.limits || {}).runMs,
        signal: state.abort.signal,
        /* The stage AND how far through it.

           "Running…" on a fourteen-case problem is indistinguishable
           from stuck, and the difference matters most on exactly the
           runs that are slow. The count comes from the backend, which
           knows; nothing here estimates, and no percentage is invented
           for a stage whose length is not known. */
        onStage: (stage, detail) => {
          if (!current()) return;
          if (stage === 'running' && detail && detail.total > 1) {
            setExec('running',
              `Running case ${Math.min(detail.done + 1, detail.total)} of ${detail.total}…`);
            return;
          }
          setExec('running', {
            downloading: `Fetching the ${lang === 'python' ? 'interpreter' : 'compiler'}…`,
            compiling: 'Compiling…',
            running: 'Running…',
          }[stage] || 'Working…');
        },
      });
    } catch (err) {
      /* A throw from a backend must not leave Run disabled for ever. */
      reply = {
        lang, backend: null,
        compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
        cases: [], judgeDown: true,
        judgeError: `The runner threw an error: ${(err && err.message) || err}`,
      };
    }

    /* The subscription goes either way: a listener for a run nobody is
       watching is a listener that fires for ever. */
    if (unwatch) unwatch();

    /* Too late: the reader changed problem or language while this was
       out. Everything below this line belongs to whatever is on screen
       NOW, and this run is not it — the buttons, the chip and the
       download bar are the new page's, and a dead run must not reach
       across and reset them. The new page was drawn fresh; its Run
       button is already enabled and its Stop already hidden. */
    if (!current()) return;

    /* This page is not running anything any more. Unconditional from
       here down, because a Run button stuck on "Running…" for ever is
       worse than any wrong answer. */
    state.running = false;
    state.abort = null;
    showStop(false);
    showDownload(null);
    const liveBtn = document.getElementById('runBtn');
    if (liveBtn) { liveBtn.disabled = false; liveBtn.textContent = 'Run tests'; }

    const verdict = RunHarness.judgeRun(reply, cases.map(c => c.expect), { requireClean: !!pay.requireClean });

    /* The judge does not echo the input back, so a failing row showed
       "stdin (none)" on every Run - which is not "we did not keep it", it
       is a claim that the case had no input. Submit has always stashed it;
       Run never did. */
    verdict.cases.forEach((c, i) => { c.stdinShown = (cases[i] || {}).stdin || ''; });
    last = { verdict, reply, submission: false, at: Date.now() };
    paint(verdict, reply, false);

    /* A build failure sends the reader where the reason is — after the
       result is recorded, not before: the compiler pane renders from
       `last`, and opening it first showed "nothing from the compiler
       yet" about the build that had just failed. Only on a failure;
       taking the pane away after a successful run would take them away
       from the results they pressed Run for.

       And only when the COMPILER is what failed. A cancelled run and a
       toolchain that cannot build this exercise also leave built
       false, and neither has anything in the compiler pane to show —
       sending a reader there greeted them with "nothing from the
       compiler yet" about the run they had just stopped. */
    const compilerSpoke = !reply.judgeDown && !verdict.built;
    if (compilerSpoke && typeof ProblemView !== 'undefined' && ProblemView.openPane) {
      ProblemView.openPane('compiler');
    }

    /* Say where it just ran, every time. A reader who cannot tell Hosted from
       Local cannot tell a service outage from a runner they forgot to start. */
    if (reply.judgeDown) setExec('blocked', 'Could not run');
    else setExec('ready', `Ran on ${Runners.label(reply.backend)}`);

    void btn;
    return verdict;
  }

  /* ---------------- output ---------------- */

  /* Stop. Only shown while something is actually in flight, because a
     permanently visible Stop on a page with nothing running is noise — and
     because the first in-browser compile is a 90 MB download, which is far
     too long to offer no way out of. */
  function showStop(on) {
    const btn = document.getElementById('stopBtn');
    if (btn) btn.hidden = !on;
  }

  /* What is being fetched, in the words of whichever engine is fetching
     it. 90 MB — or 13 — with no feedback is indistinguishable from a page
     that has hung. */
  const ENGINE_WORDS = {
    cpp: {
      what: 'the C++ compiler',
      preparing: 'Preparing the compiler…',
      note: 'A real Clang, compiled to WebAssembly. It is fetched once and then '
        + 'cached, so this happens on the first C++ run and not again.',
    },
    python: {
      what: 'Python',
      preparing: 'Starting the interpreter…',
      note: 'A real CPython, compiled to WebAssembly. It is fetched once and then '
        + 'cached, so this happens on the first Python run and not again.',
    },
    rust: {
      what: 'the Rust compiler',
      preparing: 'Preparing the compiler…',
      note: 'A real rustc with the Cranelift backend, compiled to WebAssembly, '
        + 'with the wasm32-wasip1 standard library. It is fetched once and then '
        + 'cached, so this happens on the first Rust run and not again.',
    },
  };

  function showDownload(p, lang = 'cpp') {
    const host = outNode();
    if (!host) return;
    let bar = host.querySelector('.cxx-dl');
    if (!p) { if (bar) bar.remove(); return; }
    const words = ENGINE_WORDS[lang] || ENGINE_WORDS.cpp;
    if (!bar) {
      bar = el('div', { class: 'cxx-dl' }, [
        el('p', { class: 'small', id: 'cxxDlText' }, ['']),
        el('div', { class: 'bar' }, [el('i', { id: 'cxxDlFill', style: 'width:0%' })]),
        el('p', { class: 'tiny faint' }, [words.note]),
      ]);
      host.replaceChildren(bar);
    }
    const mb = n => (n / 1048576).toFixed(0);
    const text = bar.querySelector('#cxxDlText');
    const fill = bar.querySelector('#cxxDlFill');
    if (p.stage === 'preparing') {
      text.textContent = words.preparing;
      fill.style.width = '100%';
    } else if (p.stage === 'ready') {
      bar.remove();
    } else {
      const pct = p.percent !== undefined
        ? p.percent
        : Math.min(100, Math.round((p.loaded / Math.max(1, p.total)) * 100));
      text.textContent = `Fetching ${words.what} — ${mb(p.loaded)} of ${mb(p.total)} MB`;
      fill.style.width = `${pct}%`;
    }
  }

  /* The execution-status chip in the workspace toolbar. */
  function setExec(kind, text) {
    const node = document.getElementById('execState');
    if (!node) return;
    node.dataset.state = kind;
    node.textContent = text;
  }

  /* ---------------- why a run did not happen ----------------

     Five things can go wrong with a submission and they are not the
     same thing. Four of them are the reader's to act on and one is
     not, and the one that is not used to be reported in the words of
     the ones that are — a reader on the published site pressed Run on
     a Rust exercise and was told to install WSL and run `npm run
     runner`, for a limitation of the compiler they were already using.

       template    the editor still holds the starting template
       build       the compiler rejected their program
       wrong       it ran and printed something else
       runtime     it ran and crashed, or took too long
       platform    nothing here could build or run it

     Only `platform` is this function's business. The others are
     reported by the verdict and the diagnostics, which is right,
     because they are facts about the program.

     A platform failure: says what happened in one sentence, blames
     nobody, never counts as an attempt, keeps the draft exactly where
     it is, and offers the one useful action, which is to try again.
     The technical detail is real and is kept — behind a disclosure,
     because "the Cranelift → WebAssembly lowering has no smulhi for
     i64" is the right answer to a question most readers are not
     asking. */

  const PLATFORM = {
    toolchain: {
      head: 'Not your code — this exercise cannot be built here',
      say: 'The compiler that runs in this tab cannot build this particular '
        + 'exercise. That is a gap in the compiler, not a mistake in what you '
        + 'wrote: nothing has been graded, nothing has been recorded, and your '
        + 'code is exactly where you left it.',
      how: 'What you can do',
    },
    download: {
      head: 'Not your code — the compiler did not finish downloading',
      say: 'The compiler runs in this tab, which means it has to be fetched '
        + 'first — once, and then it is cached. That fetch did not finish. '
        + 'Nothing was graded, nothing was recorded, and your code is exactly '
        + 'where you left it, so pressing Try again picks up where this left '
        + 'off.',
      how: 'What you can do',
    },
    service: {
      head: 'Not your code — the runner did not answer',
      say: 'Your program was not run, so nothing has been graded or recorded '
        + 'and your code is where you left it.',
      how: 'What you can do',
    },
    nothing: {
      head: 'Not your code — nothing here can run this',
      say: 'Nothing available on this device can run this exercise, so nothing '
        + 'has been graded or recorded. Your code is where you left it.',
      how: 'What you can do',
    },
  };

  /* The node for a platform failure. Deliberately not a verdict: it has
     no score, no case list and no "not right" anywhere in it. */
  function platformNode(reply) {
    const kind = (reply && reply.kind) || (reply && reply.nativeOnly ? 'toolchain' : 'nothing');
    const words = PLATFORM[kind] || PLATFORM.nothing;
    const detail = (reply && reply.detail) || (reply && reply.nativeOnly) || '';

    const box = el('div', { class: 'platform', 'data-kind': kind }, [
      el('h4', { class: 'platform-head', text: words.head }),
      el('p', { class: 'platform-say', text: words.say }),
      /* Only when it adds something. On a toolchain gap the headline
         and the paragraph above have already said it, and a third
         sentence saying it again reads as padding. */
      /* Only when it adds something: on a toolchain gap and on an
         interrupted download the headline and the paragraph above have
         already said it, and the raw reason is behind the disclosure. */
      (kind !== 'toolchain' && kind !== 'download' && reply.judgeError)
        ? el('p', { class: 'platform-why small', text: reply.judgeError }) : null,
    ]);

    const acts = el('div', { class: 'platform-acts' }, [
      /* Try again, but only where trying again could work.

         A download that was cut off and a runner that did not answer
         are both transient, and the button is the whole answer. A
         compiler that cannot build this exercise is not transient:
         pressing it would reproduce the same message instantly, which
         is an invitation to sit there pressing it. Run is still
         enabled either way, so nothing is locked. */
      kind === 'toolchain' ? null : el('button', {
        class: 'btn btn-sm btn-primary', type: 'button', id: 'retryRunBtn',
        onclick: () => doRun(last.submission),
      }, ['Try again']),
      kind === 'toolchain'
        ? el('a', { class: 'btn btn-sm btn-ghost', href: '#/problems?type=code' },
          ['Other exercises in this language'])
        : null,
      /* Where code runs explains the optional local runner. On an
         interrupted download it is a wrong turn: nothing needs
         installing, the fetch just has to finish. */
      kind === 'download'
        ? null
        : el('a', { class: 'btn btn-sm btn-ghost', href: '#/setup' }, ['Where code runs']),
    ].filter(Boolean));
    box.append(acts);

    if (detail) {
      box.append(el('details', { class: 'platform-detail' }, [
        el('summary', { class: 'tiny' }, ['The technical reason']),
        el('p', { class: 'small', text: detail }),
      ]));
    }
    return box;
  }

  function paint(verdict, reply, isSubmission, into) {
    const host = into || outNode();
    if (!host) return;
    host.replaceChildren();

    if (reply.judgeDown) {
      host.append(platformNode(reply));
      return;
    }

    /* What the compiler said lives in the Compiler output pane, and
       only there. What goes here is one line about how the build went,
       and a way to the pane — because a reader who has just been told
       their program did not build has exactly one next question, and
       scrolling past a second copy of the same list to find the run
       that never happened is not an answer to it.

       The warnings are not hidden: -Wall -Wextra is on in every profile
       because the warnings are usually the lesson, and the count is
       here, in front of them, with one click to the text. */
    const cstderr = (reply.compile && reply.compile.stderr || '').trim();
    if (cstderr || !verdict.built) host.append(buildLine(cstderr, verdict.built));

    if (!verdict.built) return;

    host.append(resultSummary(verdict, reply, isSubmission));

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

      /* A button, not a clickable div: these rows are the one part of a
         result you have to open, and reaching them with the keyboard was
         not possible at all. */
      const head = el('button', {
        class: 'case-head', type: 'button', 'aria-expanded': String(open),
        onclick: () => {
          body.hidden = !body.hidden;
          head.setAttribute('aria-expanded', String(!body.hidden));
        },
      }, [
        el('span', { class: 'case-name', text: `Case ${i + 1}` }),
        el('span', { class: 'faint tiny case-why', text: c.why }),
        el('span', { class: 'faint tiny mono case-ms', text: dur(c.ms) }),
        el('span', { class: 'case-status', 'data-pass': String(c.pass),
          text: c.pass ? 'Passed' : 'Failed' }),
      ]);

      const node = el('div', { class: 'case', 'data-pass': String(c.pass) }, [head, body]);
      host.append(node);
    });
  }

  /* How long something took, in the words the rest of the page uses. */
  const dur = ms => (typeof ProblemView !== 'undefined' && ProblemView.duration
    ? ProblemView.duration(ms)
    : `${Math.round(ms)} ms`);

  /* ---------------- the summary above the cases ----------------

     A list of eight rows answers "which one failed". It does not answer "did
     it pass", which is the question you actually have the moment a run
     finishes, and which used to be one sentence in the same grey as
     everything else.

     So: the fraction, the word for it, the three counts, and — the part
     worth most — the first failure's reason at the top, rather than left to
     be found by opening rows one at a time. */
  function resultSummary(verdict, reply, isSubmission) {
    const cases = verdict.cases || [];
    const total = cases.length;
    const passed = cases.filter(c => c.pass).length;
    const failed = total - passed;
    const kind = failed ? 'failed' : 'passed';
    const ms = ((reply.compile && reply.compile.ms) || 0)
      + cases.reduce((n, c) => n + (c.ms || 0), 0);

    const first = cases.find(c => !c.pass);
    /* Passing with the sanitizer complaining is its own outcome: the output
       is right and the program is not. */
    const dirty = !first && cases.some(c => c.sanitizer);

    return el('div', { class: 'rsum', 'data-kind': kind }, [
      el('div', { class: 'rsum-head' }, [
        el('h4', {}, ['Result ', el('span', { class: 'rsum-frac', text: `(${passed}/${total})` })]),
        el('span', { class: 'rsum-badge', 'data-kind': kind, text: failed ? 'Failed' : 'Passed' }),
        el('span', { class: 'rsum-when', text: `${isSubmission ? 'Submission' : 'Run'} · ${dur(ms)}` }),
      ]),

      el('div', { class: 'rsum-tiles' }, [
        ['Total', total, ''],
        ['Passed', passed, 'passed'],
        ['Failed', failed, 'failed'],
      ].map(([label, n, k]) => el('div', { class: 'rtile', 'data-kind': k || undefined }, [
        el('span', { class: 'rtile-label', text: label }),
        el('span', { class: 'rtile-value', text: String(n) }),
      ]))),

      first ? el('p', { class: 'rsum-why', 'data-kind': 'failed' },
        [`Case ${cases.indexOf(first) + 1}: ${first.why}`]) : null,
      dirty ? el('p', { class: 'rsum-why', 'data-kind': 'warn' }, [
        'Every case passed and the sanitizer still had something to say. The '
        + 'output is right; the program is not.',
      ]) : null,

      /* What actually ran. "7 hidden cases passed" was never true of a
         submission: it runs the samples and the hidden ones together. */
      el('p', { class: 'rsum-note', text: isSubmission
        ? `${total} ${total === 1 ? 'case' : 'cases'}: the samples and the hidden ones.`
        : `${total} sample ${total === 1 ? 'case' : 'cases'}. Submit also runs the hidden ones.` }),
    ]);
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

  /* What the compiler calls a file, as the reader would write it.
     Clang is handed a relative path and prints it back; the native
     runner compiles out of a temp directory and prints that. Both come
     down to the name in the tree. "<source>" and "<stdin>" are not
     files and become nothing. */
  function fileNameOf(raw) {
    const t = String(raw || '').trim();
    if (!t || t.startsWith('<')) return '';
    const cut = t.replace(/\\/g, '/').replace(/^\.\//, '');
    /* An absolute path is the runner's temp directory and is not
       anything the reader can act on; a relative one is what the
       workspace calls the file, directory and all. */
    return /^(\/|[A-Za-z]:)/.test(cut) ? cut.split('/').pop() : cut;
  }

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
          /* The file, which on a workspace is half the information: "line
             34" means nothing when there are three of them. Trimmed to
             what the reader sees — the compiler writes the path it was
             handed, and a temp directory in front of it is noise. */
          file: fileNameOf(m[1]),
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
          file: fileNameOf(py[1]),
          line: Number(py[2]), column: 1, severity: 'error', code: '',
          message: message || 'syntax error', notes: [],
        });
      }
    }

    return rows;
  }

  const SEVERITY_WORD = { error: 'error', warning: 'warning', note: 'note', help: 'help' };

  /* One line about the build, and the way to the pane that has the
     detail. Not a verdict box: a build failure has no score, and
     dressing it as one is how "0 of 7 cases passed" came to be printed
     about a program that never ran. */
  function buildLine(text, built) {
    const rows = parseDiagnostics(text);
    const errors = rows.filter(r => r.severity === 'error').length;
    const warnings = rows.filter(r => r.severity === 'warning').length;

    const go = el('button', {
      class: 'btn btn-sm', type: 'button', id: 'toCompilerOut',
      onclick: () => {
        if (typeof ProblemView !== 'undefined' && ProblemView.openPane) {
          ProblemView.openPane('compiler');
        }
      },
    }, ['Compiler output']);

    if (!built) {
      return el('div', { class: 'buildline', 'data-kind': 'error' }, [
        el('h4', { text: errors
          ? `It did not build — ${errors} ${errors === 1 ? 'error' : 'errors'}`
          : 'It did not build' }),
        el('p', { class: 'tiny faint', text: 'Nothing ran, so there is nothing here '
          + 'to score. The compiler\u2019s own words, with the file and the line, are '
          + 'in Compiler output.' }),
        go,
      ]);
    }
    if (!warnings) return el('div', { class: 'buildline', 'data-kind': 'ok' }, [
      el('span', { class: 'tiny faint', text: 'It built cleanly.' }),
      go,
    ]);
    return el('div', { class: 'buildline', 'data-kind': 'warn' }, [
      el('span', { class: 'lbl', text: `It built, with ${warnings} `
        + `${warnings === 1 ? 'warning' : 'warnings'}` }),
      el('span', { class: 'tiny faint', text: 'warnings are on deliberately — '
        + 'they are usually the lesson' }),
      go,
    ]);
  }

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
          title: r.file && multi()
            ? `Open ${r.file} at line ${r.line}`
            : `Go to line ${r.line}`,
          onclick: () => goToDiagnostic(r.file, r.line, r.column),
        }, [
          /* The file is only named where there is more than one of
             them. On an ordinary exercise "main.cpp:12:5" is three
             characters of news and eight of noise. */
          r.file && multi() ? el('span', { class: 'diag-file', text: r.file }) : null,
          `${r.line}:${r.column}`,
        ].filter(Boolean)),
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

    /* Stop. Aborting the controller unwinds whatever stage the run is in —
       a download, a compile, or a case — and each of those knows how to
       clean up after itself. */
    stop() {
      if (state && state.abort) state.abort.abort();
    },

    /* The workspace owns the panes; this module owns what goes in them.
       On a multi-file problem this is the file on top, which is what
       the font control, the report and "load a submission" all mean. */
    editor: () => activeEditor(),

    /* Does this problem have several files, and which? The page asks so
       it can offer the right Reset and show the right submission. */
    multiFile: () => multi(),
    files: () => (multi() ? fileList() : null),
    /* The workspace widget itself, for the controls that belong to the
       page rather than to the type: the explorer toggle and Reset
       layout. Null on a single-file problem, which has no explorer. */
    pane: () => (multi() ? state.pane : null),
    activeFile: () => (multi() ? state.pane.active : null),
    openFile: path => showFile(path, { focus: true }),

    /* Reset is a button in the bar at the foot of the column, which the
       problem page builds; the template it puts back is this module's. */
    resetTemplate,
    /* What Reset would put back, so the page can tell "nothing to lose"
       from "an afternoon to lose" before asking. */
    startingSource: (problem) => {
      if (multi()) return state.pane.starterOf(state.pane.active);
      return templateFor(problem, state ? state.lang : (problem.payload.langs || [])[0]);
    },

    /* How much a Reset would cost, so the page can ask a question with
       a number in it rather than in the abstract. */
    resetCost: () => (multi() ? state.pane.cost() : null),

    /* The language names, so the Submissions tab can say "C++" without a
       fourth copy of the same four words. */
    LANG_LABEL: LABEL,

    /* The starters a problem gets when it supplies none of its own. Exported
       so the content suite can hold them to the same rule as the ones in the
       problem files: say where the reader's code goes. */
    TEMPLATE,

    /* Putting an old submission back in the editor. The language is switched
       first, because highlighting, linting and completion all follow it and a
       Rust program in a C++ buffer is lint noise from end to end. */
    loadSource(lang, source) {
      if (!state) return false;
      /* A workspace submission is one string holding every file. Put
         them all back, not just the entry point — half a submission
         restored is worse than none, because it looks complete. */
      const doc = Workspace.unpack(String(source));
      if (doc && multi()) {
        const n = state.pane.load(doc);
        noteSaved(`loaded a submission (${n} ${n === 1 ? 'file' : 'files'})`);
        const ed = activeEditor();
        if (ed) ed.focus();
        return true;
      }
      if (!state.editor) return false;
      if (lang && lang !== state.lang && state.langs.includes(lang)) switchLang(lang);
      state.editor.value = String(source);
      /* onChange saves the draft, but only when the text actually changed;
         loading a submission you have already loaded would otherwise leave
         the draft behind. */
      Store.saveDraft(state.problem, state.lang, state.editor.value);
      noteSaved('loaded a submission');
      state.editor.focus();
      return true;
    },

    /* Called by ProblemView.leave(). CodeMirror attaches listeners to the
       document and watches its own DOM, so hiding the view is not enough —
       thirty navigations used to leave thirty live editors behind. The lint
       watcher holds a timer and an in-flight request, and a run in flight has
       to be marked abandoned so its answer cannot be painted into whatever
       problem is on screen by the time it arrives. */
    teardown() {
      if (!state) return;
      runEpoch += 1;
      /* Every view, not only the one on top: each is a live CodeMirror
         with listeners on the document. Thirty navigations used to
         leave thirty editors behind, and a workspace leaves three at a
         time. */
      if (state.pane) state.pane.destroy();
      else {
        try { if (state.editor && state.editor.destroy) state.editor.destroy(); } catch { /* already gone */ }
      }
      state = null;
      last = { verdict: null, reply: null, submission: false, at: 0 };
      clearTimeout(savedTimer);
    },
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
    /* One renderer for a platform failure, shared with the problem
       page's own failure box so the two cannot drift into saying
       different things about the same event. */
    platformNode,
    render,

    /* collect() returns null for two quite different reasons, and saying
       "the editor is empty" about a full one is how you send somebody
       hunting for a bug that is not there. */
    emptyMessage(mount, problem) {
      if (multi()) {
        return 'Nothing has been changed yet. The files are as the exercise '
          + 'shipped them, and submitting that would count as an attempt for '
          + 'nothing.';
      }
      if (!state || !state.editor) return 'The editor is not ready yet.';
      if (!state.editor.value.trim()) return 'The editor is empty — write a program before submitting.';
      return 'That is still the starting template, unchanged. Write your solution '
        + 'first — submitting the template would count as an attempt for nothing.';
    },

    collect(mount, problem) {
      if (multi()) {
        /* Every file, as one string, so the vault stores one thing and
           puts one thing back. `files` rides alongside it so the
           grader does not have to unpack what it just packed. */
        const files = fileList();
        if (state.pane.untouched()) return null;
        if (!files.some(f => f.content.trim())) return null;
        return {
          lang: state.lang,
          source: Workspace.pack({ entry: Workspace.entryOf(problem), files }),
          files,
        };
      }
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

      /* problemId matters: the in-browser compiler is only offered for
         problems whose reference solution was verified against it, and
         leaving it out here meant Run worked and Submit did not. */
      /* Submit used to be silent. A submission on a cold toolchain
         fetches a compiler, builds, and runs a case set the reader
         cannot see — thirty seconds in which the only feedback was a
         disabled button, which is how a slow submission comes to look
         like a broken one. Same stages as Run, same download bar, and
         the same guard: a submission the reader has walked away from
         writes to nothing.

         The case COUNT is deliberately not shown here. The hidden
         cases are hidden, and "case 9 of 23" tells a reader exactly
         how many there are. */
      const mine = runEpoch;
      const live = () => mine === runEpoch && state && state.problem.id === problem.id;
      const engine = response.lang === 'python'
        ? (typeof BrowserPy !== 'undefined' ? BrowserPy : null)
        : response.lang === 'rust'
          ? (typeof BrowserRust !== 'undefined' ? BrowserRust : null)
          : (typeof BrowserCpp !== 'undefined' ? BrowserCpp : null);
      const unwatch = (engine && !engine.ready)
        ? engine.onProgress(p => { if (live()) showDownload(p, response.lang); }) : null;

      let reply;
      try {
        reply = await Runners.run(response.lang, response.source, all, {
          problemId: problem.id,
          /* The submission carries its own files, so what is graded is
             what was submitted rather than whatever the editor holds by
             the time the compiler answers. */
          files: response.files || null,
          sources: response.files ? Workspace.buildSources(problem) : null,
          entry: response.files ? Workspace.entryOf(problem) : null,
          profile: pay.profile || 'standard',
          compileMs: (pay.limits || {}).compileMs,
          runMs: (pay.limits || {}).runMs,
          signal: state && state.abort ? state.abort.signal : undefined,
          onStage: (stage) => {
            if (!live()) return;
            setExec('running', {
              downloading: `Fetching the ${response.lang === 'python' ? 'interpreter' : 'compiler'}…`,
              compiling: 'Compiling…',
              running: 'Running the full case set…',
            }[stage] || 'Working…');
          },
        });
      } finally {
        if (unwatch) unwatch();
        if (live()) showDownload(null);
      }

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
          /* The kind travels with it, so the page can render the same
             taxonomy on a submission as on a Run rather than falling
             back to a sentence and a shrug. */
          kind: reply.kind || (reply.nativeOnly ? 'toolchain' : 'nothing'),
          detail: reply.detail || reply.nativeOnly || null,
          feedback: reply.judgeError
            || `${reply.backend ? Runners.label(reply.backend) : 'Nothing available'} could not run this.`,
          noAttempt: true, reply, verdict, at: Date.now(),
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
        reply, verdict, at: Date.now(),
      };
    },

    mark(mount, { result }) {
      if (!state) return;
      /* The editor is never locked by an attempt: a compile error, a wrong
         answer and a timeout all leave the code exactly as written, and the
         next attempt is one keystroke away.

         A file the problem gave as read-only stays read-only, though:
         that is a property of the exercise, not of the attempt. */
      if (multi()) {
        state.pane.unlock();
      } else if (state.editor) {
        state.editor.setReadOnly(false);
      }
      /* Only if nothing has happened since. A redraw is not a new result. */
      if (result && result.verdict && (result.at || 0) >= last.at) {
        last = {
          verdict: result.verdict, reply: result.reply || {},
          submission: true, at: result.at || Date.now(),
        };
      }
    },
  });
})();
