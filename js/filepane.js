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

   ---------------- the explorer ----------------

   A real tree, because a path may have directories in it and a
   flat list of `include/cache.hpp` beside `src/cache.cpp` hides
   the one thing the paths are telling you. A workspace with no
   directories renders as exactly the flat list it was before.

   It is collapsible (the pref outlives the problem, because
   "I do not want the sidebar" is about the reader rather than
   about the exercise) and resizable by the bar on its right,
   in pixels rather than as a fraction: this column holds file
   names, and a name is a fixed number of characters wide
   whatever the window is doing.

   ---------------- what is NOT here ----------------

   Creating, renaming and deleting files. A workspace is the set
   of files the problem defines, which is what makes "reset the
   whole workspace" and "restore this submission" mean something
   exact. See docs/multi-file.md.
   ============================================================ */

const FilePane = (() => {
  const el = (tag, attrs, kids) => ProblemTypes.el(tag, attrs, kids);

  /* The explorer's width, in pixels. Narrow enough that it is worth
     having on a 1280px laptop beside a statement and an editor; wide
     enough for `ring_buffer.hpp` without an ellipsis. */
  const SIDE_MIN = 120;
  const SIDE_MAX = 420;
  const SIDE_DEFAULT = 190;
  const WIDTH_PREF = 'filesPaneW';
  const OPEN_PREF = 'filesPane';
  const FOLD_PREF = 'filesFolded';

  const sideWidth = () => {
    const v = Number(Store.pref(WIDTH_PREF, SIDE_DEFAULT));
    return Number.isFinite(v) ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, v)) : SIDE_DEFAULT;
  };

  /* Which directories the reader has folded shut, per problem. Folding
     is about this exercise's shape rather than about the reader, so
     unlike the width it is keyed by problem id. */
  const foldedFor = (id) => {
    const all = Store.pref(FOLD_PREF, null);
    const mine = all && all[id];
    return new Set(Array.isArray(mine) ? mine : []);
  };
  const saveFolded = (id, set) => {
    const all = { ...(Store.pref(FOLD_PREF, null) || {}) };
    if (set.size) all[id] = [...set];
    else delete all[id];
    Store.setPref(FOLD_PREF, all);
  };

  /* paths -> a tree of { dir, name, path, kids } / { file }. Sorted
     directories first and then by name, which is what every file
     explorer does and what makes two workspaces comparable at a
     glance. */
  function treeOf(files) {
    const root = { dir: true, path: '', name: '', kids: [] };
    const at = { '': root };
    for (const f of files) {
      const parts = f.path.split('/');
      let here = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const path = parts.slice(0, i + 1).join('/');
        if (!at[path]) {
          at[path] = { dir: true, path, name: parts[i], kids: [] };
          here.kids.push(at[path]);
        }
        here = at[path];
      }
      here.kids.push({ dir: false, path: f.path, name: parts[parts.length - 1], file: f });
    }
    const sort = (node) => {
      node.kids.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      for (const k of node.kids) if (k.dir) sort(k);
    };
    sort(root);
    return root;
  }

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
    const folded = foldedFor(problem.id);

    /* ---------------- the frame ---------------- */

    const open = !!Store.pref(OPEN_PREF, true);
    const wrap = el('div', {
      class: 'mf', 'data-files': String(open),
      style: `--files-w:${sideWidth()}px`,
    });

    const tree = el('ul', {
      class: 'mf-tree', role: 'tree', 'aria-label': 'Files in this exercise',
    });
    const side = el('div', { class: 'mf-side' }, [
      el('div', { class: 'mf-side-head' }, [
        el('span', { class: 'tiny faint', text: 'Explorer' }),
        el('span', { class: 'tiny faint', text: `${files.length} files` }),
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
      title: open ? 'Hide the file list (Alt+B)' : 'Show the file list (Alt+B)',
      onclick: () => setOpen(wrap.dataset.files !== 'true'),
    }, ['☰']);
    tabs.append(toggle);

    function setOpen(now) {
      wrap.dataset.files = String(now);
      Store.setPref(OPEN_PREF, now);
      toggle.setAttribute('aria-expanded', String(now));
      toggle.title = now ? 'Hide the file list (Alt+B)' : 'Show the file list (Alt+B)';
      const ed = editor();
      if (ed) ed.refresh();
    }

    const stack = el('div', { class: 'mf-stack' });

    for (const f of files) {
      f.host = el('div', { class: 'mf-slot', hidden: true, 'data-path': f.path });
      stack.append(f.host);

      f.btn = el('button', {
        class: 'mf-file', type: 'button', role: 'treeitem',
        'data-path': f.path,
        'aria-current': 'false', tabindex: '-1',
        title: f.readOnly
          ? `${f.path} — given, and not editable here`
          : (f.entry ? `${f.path} — the entry point` : f.path),
        onclick: () => show(f.path, { focus: true }),
      }, [
        el('span', { class: 'mf-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'mf-name', text: f.path.split('/').pop() }),
        f.entry ? el('span', { class: 'mf-tag', text: 'entry' }) : null,
        f.readOnly ? el('span', { class: 'mf-tag mf-tag-ro', text: 'given' }) : null,
      ]);

      f.tab = el('button', {
        class: 'mf-tab', type: 'button', role: 'tab', 'data-path': f.path,
        'aria-selected': 'false',
        title: f.path,
        onclick: () => show(f.path, { focus: true }),
      }, [f.path.split('/').pop()]);
      tabs.append(f.tab);
    }

    /* ---- the tree, built once and folded in place ---- */

    const dirRows = [];        /* { path, row, group } */

    function paintTree() {
      const fill = (node, into, depth) => {
        for (const kid of node.kids) {
          if (kid.dir) {
            const shut = folded.has(kid.path);
            const group = el('ul', { class: 'mf-group', role: 'group' });
            const row = el('button', {
              class: 'mf-dir', type: 'button', role: 'treeitem',
              'data-path': kid.path,
              'aria-expanded': String(!shut), tabindex: '-1',
              style: `--mf-depth:${depth}`,
              onclick: () => foldDir(kid.path, folded.has(kid.path)),
            }, [
              el('span', { class: 'mf-caret', 'aria-hidden': 'true', text: '▸' }),
              el('span', { class: 'mf-name', text: kid.name }),
            ]);
            const li = el('li', {}, [row, group]);
            li.hidden = false;
            group.hidden = shut;
            into.append(li);
            dirRows.push({ path: kid.path, row, group });
            fill(kid, group, depth + 1);
          } else {
            kid.file.btn.style.setProperty('--mf-depth', String(depth));
            into.append(el('li', {}, [kid.file.btn]));
          }
        }
      };
      fill(treeOf(files), tree, 0);
    }

    function foldDir(path, openIt) {
      if (openIt) folded.delete(path); else folded.add(path);
      saveFolded(problem.id, folded);
      for (const d of dirRows) {
        if (d.path !== path) continue;
        d.row.setAttribute('aria-expanded', String(openIt));
        d.group.hidden = !openIt;
      }
    }

    /* Open every directory on the way to a file, so selecting one from a
       tab or from a diagnostic never leaves it invisible in the tree. */
    function revealIn(path) {
      const parts = path.split('/');
      for (let i = 0; i < parts.length - 1; i += 1) {
        const dir = parts.slice(0, i + 1).join('/');
        if (folded.has(dir)) foldDir(dir, true);
      }
    }

    paintTree();

    /* ---- keyboard: the usual tree keys ----

       One tab stop for the whole explorer (roving tabindex), then the
       arrows walk it. Left on an open directory shuts it and on
       anything else goes to the parent, which is what every file tree
       in every editor does. */

    const visibleRows = () =>
      [...tree.querySelectorAll('.mf-dir, .mf-file')].filter(b => b.offsetParent !== null);

    const focusRow = (row) => {
      if (!row) return;
      for (const b of tree.querySelectorAll('.mf-dir, .mf-file')) b.tabIndex = -1;
      row.tabIndex = 0;
      row.focus();
    };

    tree.addEventListener('keydown', (e) => {
      const row = e.target.closest('.mf-dir, .mf-file');
      if (!row) return;
      const rows = visibleRows();
      const at = rows.indexOf(row);
      const isDir = row.classList.contains('mf-dir');
      let handled = true;

      if (e.key === 'ArrowDown') focusRow(rows[at + 1]);
      else if (e.key === 'ArrowUp') focusRow(rows[at - 1]);
      else if (e.key === 'Home') focusRow(rows[0]);
      else if (e.key === 'End') focusRow(rows[rows.length - 1]);
      else if (e.key === 'ArrowRight') {
        if (isDir && row.getAttribute('aria-expanded') === 'false') foldDir(row.dataset.path, true);
        else if (isDir) focusRow(rows[at + 1]);
        else handled = false;
      } else if (e.key === 'ArrowLeft') {
        if (isDir && row.getAttribute('aria-expanded') === 'true') foldDir(row.dataset.path, false);
        else {
          const parent = row.dataset.path.split('/').slice(0, -1).join('/');
          const up = parent && dirRows.find(d => d.path === parent);
          if (up) focusRow(up.row); else handled = false;
        }
      } else if ((e.key === 'Enter' || e.key === ' ') && !isDir) {
        show(row.dataset.path, { focus: true });
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    });

    /* ---- the divider between the explorer and the editor ---- */

    const grip = el('div', {
      class: 'mf-gutter', role: 'separator', 'aria-orientation': 'vertical',
      'aria-label': 'Resize the file explorer',
      tabindex: '0',
      'aria-valuemin': String(SIDE_MIN), 'aria-valuemax': String(SIDE_MAX),
      'aria-valuenow': String(sideWidth()),
      onkeydown: (e) => {
        const step = e.shiftKey ? 48 : 12;
        if (e.key === 'ArrowLeft') setWidth(sideWidth() - step);
        else if (e.key === 'ArrowRight') setWidth(sideWidth() + step);
        else if (e.key === 'Home') setWidth(SIDE_MIN);
        else if (e.key === 'End') setWidth(SIDE_MAX);
        else if (e.key === 'Enter' || e.key === ' ') setWidth(SIDE_DEFAULT);
        else return;
        e.preventDefault();
      },
    });

    function setWidth(px) {
      const w = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, px)));
      Store.setPref(WIDTH_PREF, w);
      wrap.style.setProperty('--files-w', `${w}px`);
      grip.setAttribute('aria-valuenow', String(w));
      const ed = editor();
      if (ed) ed.refresh();
    }

    grip.addEventListener('pointerdown', (e) => {
      try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      wrap.dataset.dragging = 'true';
      document.body.dataset.resizing = 'true';
      const move = (ev) => setWidth(ev.clientX - wrap.getBoundingClientRect().left);
      const done = () => {
        try { grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        delete wrap.dataset.dragging;
        delete document.body.dataset.resizing;
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', done);
        grip.removeEventListener('pointercancel', done);
        grip.removeEventListener('lostpointercapture', done);
        window.removeEventListener('pointerup', done);
        window.removeEventListener('blur', done);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', done);
      grip.addEventListener('pointercancel', done);
      grip.addEventListener('lostpointercapture', done);
      window.addEventListener('pointerup', done);
      window.addEventListener('blur', done);
      e.preventDefault();
    });

    wrap.append(side, grip, el('div', { class: 'mf-main' }, [tabs, stack]));
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
          /* The result goes to the caller rather than being dropped:
             whether this keystroke reached storage is the only thing
             the status row has to say. */
          const ok = Store.saveDraft(problem, key, src);
          markEdited(f);
          onSaved(ok, () => Store.saveDraft(problem, key, src));
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
      revealIn(f.path);

      for (const other of files) {
        const on = other === f;
        if (other.host) other.host.hidden = !on;
        if (other.btn) {
          other.btn.setAttribute('aria-current', String(on));
          other.btn.tabIndex = on ? 0 : -1;
        }
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

      /* The same files with what the EXERCISE said about them, which
         `files()` deliberately does not carry: that list goes to a
         compiler and into a packed submission, and neither has any use
         for a note or a read-only flag. Quick Open, workspace search
         and the ZIP all do — a read-only file has to be labelled as
         given rather than presented as the reader's own work. */
      info: () => files.map(f => ({
        path: f.path,
        content: textOf(f),
        readOnly: !!f.readOnly,
        note: f.note || '',
        entry: !!f.entry,
      })),
      textOf: path => { const f = fileAt(path); return f ? textOf(f) : null; },
      has: path => !!fileAt(path),
      open: (path, opts) => show(path, opts || { focus: true }),
      editor,
      element: wrap,

      /* The explorer, for the page's own controls and its shortcut. */
      sidebarOpen: () => wrap.dataset.files === 'true',
      toggleSidebar: () => setOpen(wrap.dataset.files !== 'true'),

      /* Show a directory: open the explorer if it is shut and unfold
         that directory and everything above it. What a breadcrumb can
         usefully do in a workspace with no navigation of its own —
         "where does this file live" answered by pointing at it. */
      revealDir(path) {
        const want = String(path || '');
        if (!want) return false;
        let any = false;
        const parts = want.split('/');
        let walked = '';
        for (const part of parts) {
          walked = walked ? `${walked}/${part}` : part;
          if (folded.has(walked)) { foldDir(walked, true); any = true; }
        }
        saveFolded(problem.id, folded);
        if (wrap.dataset.files !== 'true') { setOpen(true); any = true; }
        const row = wrap.querySelector(`.mf-dir[data-path="${CSS.escape(want)}"]`);
        if (row) { row.scrollIntoView({ block: 'nearest' }); row.focus(); }
        return any;
      },

      /* Back to the shipped layout. The folds are the reader's view of
         this exercise and are part of the layout, so they go too; the
         drafts are not and do not. */
      resetLayout() {
        Store.setPref(WIDTH_PREF, SIDE_DEFAULT);
        Store.setPref(OPEN_PREF, true);
        for (const path of [...folded]) foldDir(path, true);
        saveFolded(problem.id, folded);
        setWidth(SIDE_DEFAULT);
        setOpen(true);
      },

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

  return { create, SIDE_DEFAULT, SIDE_MIN, SIDE_MAX, WIDTH_PREF, OPEN_PREF, FOLD_PREF };
})();
