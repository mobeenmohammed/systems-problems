/* ============================================================
   filepane.js — the workspace, when an exercise is several files.

   One implementation, two types. A C++ project and a hardware
   project are the same thing from here: a tree on the left, a
   row of tabs, one CodeMirror per file, and a draft per file
   under the problem's own id. Everything that differs — which
   language colours the editor, what the files are compiled
   into, what Run means — stays in the type module.

   ---------------- why one editor per file ----------------

   A document, a cursor, a selection, a scroll position and an
   undo history all live in the EditorState. Swapping the text
   of one editor to change file would keep none of them, and an
   undo on the second file would start rewriting the first.
   Keeping a view per file makes "switching tabs costs nothing"
   true by construction rather than by bookkeeping.

   They are created lazily — the first time a file is looked at
   — and the ones not yet created read their text from the
   draft store, so a file nobody has opened still goes to the
   compiler with whatever was last written in it.

   ---------------- what is NOT here ----------------

   Creating, renaming and deleting files. A workspace is the set
   of files the problem defines, which is what makes "reset the
   whole workspace" and "restore this submission" mean something
   exact. See docs/multi-file.md.
   ============================================================ */

const FilePane = (() => {
  const el = (tag, attrs, kids) => ProblemTypes.el(tag, attrs, kids);

  /* `readOnly` is honoured by the editor and said on the row. It is an
     editing aid: it keeps somebody from changing the interface by
     accident while they are chasing a bug in their own file. It is not
     a security boundary, nothing is graded on it, and the compiler is
     handed whatever the files say. */
  function create(host, {
    problem,
    lang,                       /* the draft namespace: 'cpp', 'sv' */
    ctx = {},
    langOf = () => lang,        /* which highlighting each file gets */
    lint = false,
    onSaved = () => {},
    onRun = () => {},
    onSubmit = () => {},
  }) {
    const files = Workspace.starters(problem).map(s => ({
      path: s.path,
      starter: s.content,
      readOnly: !!s.readOnly,
      entry: !!s.entry,
      note: s.note,
      view: null, host: null, btn: null, tab: null,
    }));

    const keyFor = path => Workspace.draftKey(lang, path);
    const fileAt = path => files.find(f => f.path === path) || null;

    /* What a file holds right now: the live editor if there is one, the
       saved draft if the file has not been opened yet, and the starter
       if it has never been touched. */
    const textOf = f => (f.view ? f.view.value : (Store.draft(problem.id, keyFor(f.path)) || f.starter));

    const list = () => files.map(f => ({ path: f.path, content: textOf(f) }));

    /* Has this file been changed from what the problem shipped? Shown as
       a dot on the row, which is the only cheap way to see at a glance
       which of five files you have actually touched. */
    const markEdited = (f) => {
      const on = textOf(f) !== f.starter;
      if (f.btn) f.btn.dataset.edited = String(on);
      if (f.tab) f.tab.dataset.edited = String(on);
    };

    let active = '';

    /* ---------------- the frame ---------------- */

    const open = !!Store.pref('filesPane', true);
    const wrap = el('div', { class: 'mf', 'data-files': String(open) });

    const tree = el('ul', { class: 'mf-tree' });
    const side = el('div', { class: 'mf-side' }, [
      el('div', { class: 'mf-side-head' }, [
        el('span', { class: 'tiny faint', text: 'Files' }),
        el('span', { class: 'tiny faint', text: `${files.length}` }),
      ]),
      tree,
      el('p', { class: 'mf-side-note tiny faint', text:
        'Every file is saved as you type. Run and Submit use all of them '
        + 'together.' }),
    ]);

    const tabs = el('div', { class: 'mf-tabs', role: 'tablist', 'aria-label': 'Open files' });
    const toggle = el('button', {
      class: 'mf-toggle', type: 'button',
      'aria-expanded': String(open),
      title: open ? 'Hide the file list' : 'Show the file list',
      onclick: () => {
        const now = wrap.dataset.files !== 'true';
        wrap.dataset.files = String(now);
        Store.setPref('filesPane', now);
        toggle.setAttribute('aria-expanded', String(now));
        toggle.title = now ? 'Hide the file list' : 'Show the file list';
        const ed = editor();
        if (ed) ed.refresh();
      },
    }, ['☰']);
    tabs.append(toggle);

    const stack = el('div', { class: 'mf-stack' });

    for (const f of files) {
      f.host = el('div', { class: 'mf-slot', hidden: true, 'data-path': f.path });
      stack.append(f.host);

      f.btn = el('button', {
        class: 'mf-file', type: 'button', 'data-path': f.path,
        'aria-current': 'false',
        title: f.readOnly
          ? `${f.path} — given, and not editable here`
          : (f.entry ? `${f.path} — the entry point` : f.path),
        onclick: () => show(f.path, { focus: true }),
      }, [
        el('span', { class: 'mf-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'mf-name', text: f.path }),
        f.entry ? el('span', { class: 'mf-tag', text: 'entry' }) : null,
        f.readOnly ? el('span', { class: 'mf-tag mf-tag-ro', text: 'given' }) : null,
      ]);
      tree.append(el('li', {}, [f.btn]));

      f.tab = el('button', {
        class: 'mf-tab', type: 'button', role: 'tab', 'data-path': f.path,
        'aria-selected': 'false',
        onclick: () => show(f.path, { focus: true }),
      }, [f.path]);
      tabs.append(f.tab);
    }

    wrap.append(side, el('div', { class: 'mf-main' }, [tabs, stack]));
    host.append(wrap);

    /* ---------------- the editors ---------------- */

    function make(f) {
      const key = keyFor(f.path);
      const saved = Store.draft(problem.id, key);
      f.view = Editor.create(f.host, {
        value: saved || f.starter,
        lang: langOf(f.path),
        profile: (problem.payload || {}).profile || 'standard',
        readOnly: !!ctx.locked || f.readOnly,
        /* No as-you-type compiler check on a workspace by default. A
           lint that builds one file on its own does not have the
           others, so every error would be about a definition the
           reader has already written. The real compiler still speaks
           on every Run, with the file and the line. */
        lint,
        onChange: (src) => {
          Store.saveDraft(problem, key, src);
          markEdited(f);
          onSaved();
        },
        onRun,
        onSubmit,
      });
      markEdited(f);
    }

    function show(path, { focus = false, line = 0, column = 1 } = {}) {
      const f = fileAt(path);
      if (!f) return false;
      if (!f.view) make(f);

      active = f.path;
      Store.saveDraft(problem, Workspace.ACTIVE_SLOT, f.path);

      for (const other of files) {
        const on = other === f;
        if (other.host) other.host.hidden = !on;
        if (other.btn) other.btn.setAttribute('aria-current', String(on));
        if (other.tab) other.tab.setAttribute('aria-selected', String(on));
      }

      /* CodeMirror measured itself in a hidden box and has to look again. */
      f.view.refresh();
      if (line) f.view.goToLine(line, column);
      if (focus || line) f.view.focus();
      return true;
    }

    const editor = () => ((fileAt(active) || {}).view || null);

    /* Where to land. Whatever was last open; otherwise the file that
       says where the work goes, because that is the one the exercise is
       about; otherwise the first editable one. Opening a workspace on a
       read-only driver invites three seconds of typing that does
       nothing. */
    const want = Store.draft(problem.id, Workspace.ACTIVE_SLOT);
    const marked = files.find(f => !f.readOnly && /your code here/i.test(f.starter));
    const mine = marked || files.find(f => !f.readOnly);
    show(fileAt(want) ? want : (mine ? mine.path : Workspace.entryOf(problem)));

    /* ---------------- what the type module asks of it ---------------- */

    return {
      get active() { return active; },
      files: list,
      textOf: path => { const f = fileAt(path); return f ? textOf(f) : null; },
      has: path => !!fileAt(path),
      open: (path, opts) => show(path, opts || { focus: true }),
      editor,
      element: wrap,

      /* Where a diagnostic points. The compiler names the file, and in
         a workspace that is half the information — "line 34" is
         useless when there are three of them. */
      goTo(file, line, column = 1) {
        const name = String(file || '').replace(/^\.\//, '');
        const f = fileAt(name) || files.find(x => x.path.endsWith(`/${name}`));
        if (f) { show(f.path, { line, column }); return true; }
        const ed = editor();
        if (ed && ed.goToLine) { ed.goToLine(line, column); ed.focus(); }
        return false;
      },

      /* Put the starters back, for one file or for all of them. */
      reset(scope) {
        const targets = scope === 'file' ? [fileAt(active)].filter(Boolean) : files;
        for (const f of targets) {
          if (f.view) f.view.value = f.starter;
          Store.saveDraft(problem, keyFor(f.path), f.starter);
          markEdited(f);
        }
        const ed = editor();
        if (ed) ed.focus();
        return targets.map(f => f.path);
      },

      /* How much a Reset would cost, so the page can ask a question
         with a number in it rather than in the abstract. */
      cost() {
        const here = fileAt(active);
        return {
          file: active,
          fileChanged: !!here && textOf(here) !== here.starter,
          changed: files.filter(f => textOf(f) !== f.starter).map(f => f.path),
          total: files.length,
        };
      },

      untouched: () => files.every(f => textOf(f).trim() === f.starter.trim()),
      starterOf: (path) => { const f = fileAt(path); return f ? f.starter : ''; },

      /* Put a submitted workspace back. Only the files this problem
         has: one submitted under an earlier version of the exercise may
         name a file that no longer exists, and silently creating it
         would be inventing a file the build does not know about. */
      load(doc) {
        if (!doc) return 0;
        let n = 0;
        for (const got of doc.files) {
          const f = fileAt(got.path);
          if (!f) continue;
          if (f.view) f.view.value = got.content;
          Store.saveDraft(problem, keyFor(f.path), got.content);
          markEdited(f);
          n += 1;
        }
        return n;
      },

      /* A project is several exercises over one codebase, and the
         second milestone starts from what the reader built in the
         first. So when a milestone opens with no draft of its own, the
         file is seeded from the previous milestone's draft of the same
         name.

         Only when there is nothing there. A file the reader has already
         written in THIS milestone is never replaced, which is the whole
         rule: nothing is overwritten silently, and the earlier
         milestone keeps its own drafts and its own submissions
         untouched. A file they never changed has nothing of theirs to
         carry, so they get this milestone's version of it. */
      carryForward() {
        const from = ((problem.project || {}).continues) || '';
        if (!from) return [];
        const taken = [];
        for (const f of files) {
          if (f.readOnly) continue;
          const key = keyFor(f.path);
          if (Store.draft(problem.id, key)) continue;      /* already working on it */
          const earlier = Store.draft(from, key);
          if (!earlier || earlier === f.starter) continue;
          Store.saveDraft(problem, key, earlier);
          if (f.view) f.view.value = earlier;
          markEdited(f);
          taken.push(f.path);
        }
        return taken;
      },

      /* A file the problem gave as read-only stays read-only: that is a
         property of the exercise, not of the attempt. */
      unlock() {
        for (const f of files) if (f.view && !f.readOnly) f.view.setReadOnly(false);
      },

      refresh() { const ed = editor(); if (ed) ed.refresh(); },

      /* Every view, not only the one on top: each is a live CodeMirror
         with listeners on the document. */
      destroy() {
        for (const f of files) {
          try { if (f.view && f.view.destroy) f.view.destroy(); } catch { /* already gone */ }
          f.view = null;
        }
      },
    };
  }

  return { create };
})();
