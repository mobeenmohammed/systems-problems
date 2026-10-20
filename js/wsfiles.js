/* ============================================================
   wsfiles.js — what files the reader can actually see.

   Three features need the same answer and must never disagree
   about it: Quick Open, workspace-wide search, and the ZIP
   download. Each of them could work it out from the type module
   on its own, and the day one of them worked it out slightly
   differently would be the day a grading file left the browser.

   So it is worked out once, here, from sources that are visible
   by construction rather than by being filtered afterwards:

     · a multi-file workspace is `payload.files`, which is the
       set the explorer draws and the only set it has;
     · an HDL exercise is the design, the SAMPLE testbench, and
       the reader's own testbench if they have written one;
     · a single-file exercise is the one document, named after
       the language it is being written in.

   What is deliberately not reachable from here:

     · the grading testbench, which lives in the solution file
       and is the whole reason Submit tries cases Run does not;
     · reference solutions;
     · hidden cases.

   None of those is a file in any workspace, so none of them is
   excluded by a rule somebody could forget to apply — there is
   simply nothing here that reads them. `role` says which of the
   visible kinds each file is, so a caller can label a read-only
   file as given rather than pretending the reader wrote it.
   ============================================================ */

const WsFiles = (() => {

  /* What a single-file exercise's document is called. It has no name
     of its own — there is one editor and no explorer — but search
     results, breadcrumbs and a ZIP all have to call it something, and
     "your code" is not a filename. These are the names the toolchains
     use for it internally, so what a reader downloads matches what a
     compiler error talks about. */
  const SOLO_NAME = {
    cpp: 'main.cpp', c: 'main.c', rust: 'main.rs', python: 'main.py',
    js: 'main.js', javascript: 'main.js', sv: 'design.sv',
    verilog: 'design.sv', systemverilog: 'design.sv',
  };
  const soloName = lang => SOLO_NAME[lang] || 'main.txt';

  const impl = problem => (problem ? ProblemTypes.get(problem.type) : null);

  /* ---------------- the list ----------------

     Always an array, never null: a caller that got null would have to
     decide what that meant, and "no files" and "not a workspace" lead
     to the same empty search either way. */
  function visible(problem) {
    const type = impl(problem);
    if (!problem || !type) return [];

    /* A multi-file workspace, of either kind. The explorer knows which
       of its files the exercise gave as read-only; `info()` carries
       that through where `files()` does not, because `files()` feeds
       the compiler and a submission and has no use for it. */
    if (type.multiFile && type.multiFile()) {
      const pane = type.pane && type.pane();
      if (pane && pane.info) {
        return pane.info().map(f => ({
          path: f.path,
          content: f.content,
          readOnly: f.readOnly,
          role: f.readOnly ? 'given' : 'yours',
          note: f.note || '',
        }));
      }
      const list = (type.files && type.files()) || [];
      return list.map(f => ({
        path: f.path, content: f.content, readOnly: false, role: 'yours', note: '',
      }));
    }

    const ed = type.editor && type.editor();

    /* Hardware. The sample testbench is on screen in its own tab and
       is as much a part of understanding the exercise as the design
       is, so searching the workspace without it would be searching
       half of it. It is read-only and says so. The grading testbench
       is NOT this one and is not reachable from here. */
    if (problem.type === 'hdl') {
      const out = [];
      if (ed) {
        out.push({
          path: 'design.sv', content: ed.value, readOnly: false,
          role: 'yours', note: 'The module you are writing.',
        });
      }
      const sample = (problem.payload || {}).testbench || '';
      if (sample) {
        out.push({
          path: 'testbench.sv', content: sample, readOnly: true, role: 'sample-tb',
          note: 'The sample testbench Run uses. Submit uses a different one.',
        });
      }
      const mine = Store.draft(problem.id, '_mytb');
      if (mine && mine.trim()) {
        out.push({
          path: 'my-testbench.sv', content: mine, readOnly: false, role: 'mine',
          note: 'Your own testbench. Never graded.',
        });
      }
      return out;
    }

    if (!ed) return [];
    return [{
      path: soloName(ed.lang), content: ed.value, readOnly: false,
      role: 'yours', note: '',
    }];
  }

  /* Is there more than one thing to choose between? Quick Open and a
     workspace-wide search are both answers to "which file", and on an
     exercise with one file the question does not arise — offering them
     anyway is chrome that does nothing.

     Answered from the problem rather than from the live page, because
     the tab strip is built during the draw that mounts the editor and
     a live answer at that moment would be the PREVIOUS problem's. A
     workspace's shape is a property of the exercise; it does not
     depend on what has been typed into it. */
  function many(problem) {
    if (!problem) return false;
    if (Workspace.isMulti(problem)) return true;
    /* Hardware is always at least the design and the sample
       testbench, which is on screen and worth searching. */
    return problem.type === 'hdl' && !!(problem.payload || {}).testbench;
  }

  /* ---------------- going there ----------------

     `at` is { line, column }, 1-based, as a search result and a
     compiler diagnostic both give it. Returns whether it landed. */
  function open(problem, path, at = null) {
    const type = impl(problem);
    if (!type) return false;
    const line = at && at.line ? at.line : null;
    const column = at && at.column ? at.column : 1;

    if (type.multiFile && type.multiFile()) {
      const pane = type.pane && type.pane();
      if (!pane) return false;
      return !!pane.open(path, line ? { line, column } : { focus: true });
    }

    /* One editor, so the only question is where in it. On hardware the
       sample testbench and the reader's own one are panes rather than
       files, and the strip is what opens them; a line number in a pane
       that is a <pre> has nowhere to put a cursor, so the tab is as far
       as this goes. */
    if (problem.type === 'hdl' && path !== 'design.sv') {
      const tab = path === 'testbench.sv' ? 'tb' : 'mytb';
      if (typeof ProblemView !== 'undefined' && ProblemView.setWorkTab) {
        ProblemView.setWorkTab(tab);
        return true;
      }
      return false;
    }

    if (typeof ProblemView !== 'undefined' && ProblemView.setWorkTab) ProblemView.setWorkTab('editor');
    const ed = type.editor && type.editor();
    if (!ed) return false;
    if (line && ed.goToLine) ed.goToLine(line, column);
    else ed.focus();
    return true;
  }

  return { visible, many, open, soloName, SOLO_NAME };
})();
