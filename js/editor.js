/* ============================================================
   editor.js — the code editor, on CodeMirror 6.

   ---------------- why this was replaced ----------------

   The previous editor was the standard overlay trick: a coloured
   <pre> behind a transparent <textarea>, kept in step by hand.
   Three bugs were reported against it, and all three turned out
   to be the same architectural problem — two layers with
   independent geometry and independent scroll state:

     · The textarea kept a min-height while the gutter and the
       overlay grew with the content, so with 60 lines the
       textarea was 315px inside a 1261px editor. Its horizontal
       scrollbar therefore sat 946px above the bottom, with
       highlighted code painting below it.

     · Typing past the visible rows scrolled the textarea
       implicitly to follow the caret. That does not reliably
       fire a scroll event, and repainting the overlay reset its
       scrollTop anyway — measured at textarea 540, overlay 0.
       The painted text froze while the caret moved away, which
       is what "the display is a character behind" looks like.

     · The editor grew past the viewport, so the sticky action
       bar ended up over it. A click halfway down hit the bar,
       not the textarea, and typing went nowhere.

   Each is fixable in isolation. Keeping them fixed, through
   panel resizes, browser zoom, font-size changes, IME, mobile
   keyboards and paste, is a project — and it is the project
   CodeMirror has already finished. It has one scroll container
   with the gutter inside it, so the alignment cannot drift and
   the horizontal scrollbar is at the bottom by construction.

   The cost is a 730 KB vendored bundle, which is why it is
   vendored rather than fetched: this site is meant to work on a
   laptop with no network. The site still has no build step —
   the bundle is committed, and scripts/build-editor.mjs is run
   by hand when the editor's feature set changes.

   If the bundle fails to load, a plain textarea takes over, with
   no highlighting but with every editing behaviour intact. A
   missing nicety is better than a page you cannot type into.

   Diagnostics still come from js/lint.js: a bracket scanner on
   every keystroke, and the real compiler shortly after you stop.
   ============================================================ */

const Editor = (() => {

  const INDENT = '  ';
  const FONT_SIZES = [12, 13, 14, 16, 18];
  const DEFAULT_FONT = 14;

  /* Wrapping is a reading preference, not a property of one file, so it
     is shared by every editor on the page exactly as the font size is.
     Off by default: these are mostly short lines, and a wrapped line
     makes the line numbers lie about where you are. */
  const wrapOn = () => Store.pref('editorWrap', false) === true;

  const ready = () => typeof window !== 'undefined' && !!window.CM;

  /* The reader's chosen size, shared by every editor on the page. Kept with
     the other view preferences rather than with progress. */
  function fontSize() {
    const v = Number(Store.pref('editorFontSize', DEFAULT_FONT));
    return FONT_SIZES.includes(v) ? v : DEFAULT_FONT;
  }

  function create(mount, {
    value = '',
    lang = 'cpp',
    profile = 'standard',
    onChange = () => {},
    onRun = null,
    onSubmit = null,
    readOnly = false,
    lint: doLint = true,
  } = {}) {
    return ready()
      ? createCM(mount, { value, lang, profile, onChange, onRun, onSubmit, readOnly, lint: doLint })
      : createFallback(mount, { value, lang, onChange, onRun, onSubmit, readOnly });
  }

  /* ---------------- the real one ---------------- */

  function createCM(mount, opts) {
    const {
      EditorState, EditorView, Compartment,
      keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
      highlightSpecialChars, drawSelection, dropCursor,
      defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
      indentMore, indentLess, toggleComment,
      search, searchKeymap, openSearchPanel, closeSearchPanel, searchPanelOpen,
      gotoLine, highlightSelectionMatches,
      syntaxHighlighting, indentUnit, bracketMatching,
      closeBrackets, closeBracketsKeymap,
      autocompletion, completionKeymap,
      lintGutter, setDiagnostics: cmSetDiagnostics,
      highlightStyle, LANGUAGES,
    } = window.CM;

    let currentLang = opts.lang;
    let currentProfile = opts.profile;
    let diagnostics = [];
    let checkedBy = null;
    /* Which compiler, in words. There are two now — a native one behind
       the runner and a rustc in this tab — and they do not check the
       same amount, so the row says which. */
    let checkedWith = null;
    let watcher = null;

    const language = new Compartment();
    const editable = new Compartment();
    const theming = new Compartment();
    const completions = new Compartment();
    const wrapping = new Compartment();

    const host = document.createElement('div');
    host.className = 'ed';
    host.dataset.lang = currentLang;

    const status = document.createElement('div');
    status.className = 'ed-status';

    const problems = document.createElement('div');
    problems.className = 'ed-problems';
    problems.hidden = true;

    mount.append(host, status, problems);

    const langExtension = id => {
      const make = LANGUAGES[id];
      return make ? make() : [];
    };

    /* C++ gets js/complete-cpp.js, because the C++ language package ships
       a parser and no completions. Python and JavaScript already provide
       their own through language data, so they are left alone — passing
       `override` would replace those with nothing.

       Switched off, the extension still loads: `activateOnTyping: false`
       keeps Ctrl+Space working for somebody who wants a suggestion once
       without wanting a popup on every identifier. Off should mean "stop
       interrupting me", not "take the feature away". */
    const OWN_SOURCE = {
      cpp: () => (typeof CppComplete !== 'undefined' ? CppComplete.source : null),
      rust: () => (typeof RustComplete !== 'undefined' ? RustComplete.source : null),
      /* SystemVerilog, under every name the mode answers to. Syntactic
         only: keywords, system tasks, a few whole constructs, and the
         words already in the file. There is no elaborator here, so
         nothing offers a port it has not read. */
      verilog: () => (typeof SvComplete !== 'undefined' ? SvComplete.source : null),
      sv: () => (typeof SvComplete !== 'undefined' ? SvComplete.source : null),
      systemverilog: () => (typeof SvComplete !== 'undefined' ? SvComplete.source : null),
    };

    const completion = (id) => {
      const typing = Store.completionOn(id);
      const own = (OWN_SOURCE[id] || (() => null))();
      return own
        ? autocompletion({ override: [own], icons: false, activateOnTyping: typing })
        : autocompletion({ icons: false, activateOnTyping: typing });
    };

    /* Colours and metrics come from the page's tokens, so a theme bought in
       the shop repaints the editor too. Only the handful CodeMirror needs as
       real values are set here; the rest is in css/styles.css. */
    const siteTheme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: `${fontSize()}px`,
        backgroundColor: 'var(--bg-inset)',
        color: 'var(--text)',
      },
      '.cm-scroller': {
        fontFamily: 'var(--mono)',
        lineHeight: '1.6',
        /* The one scroll container. Both scrollbars belong to it, which is
           what keeps the horizontal one at the bottom of the editor. */
        overflow: 'auto',
      },
      '.cm-content': { caretColor: 'var(--text)', paddingBlock: '.6rem' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-elev)',
        color: 'var(--text-faint)',
        borderRight: '1px solid var(--border)',
      },
      '.cm-activeLineGutter': { backgroundColor: 'var(--bg-elev-2)', color: 'var(--text-dim)' },
      '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 .5rem 0 .7rem' },
      '&.cm-editor.cm-focused': { outline: 'none' },
      '.cm-lint-marker-error': { content: 'none' },

      /* The completion popup. CodeMirror styles it itself otherwise, and
         because this theme declares dark: true it stayed the same slab of
         #333338 in the Paper theme as in Midnight — readable, but the one
         part of the editor that did not belong to the page. */
      '.cm-tooltip.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-s)',
        boxShadow: 'var(--shadow-2)',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete ul': { fontFamily: 'var(--mono)', maxHeight: '14rem' },
      '.cm-tooltip-autocomplete ul li': {
        color: 'var(--text-dim)', padding: '.18rem .55rem', lineHeight: '1.5',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--accent-soft)', color: 'var(--text)',
      },
      /* The header beside a std:: name is the useful half of that row, so
         it is dimmed rather than hidden, and never italicised into
         illegibility. */
      '.cm-completionDetail': {
        color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '.75rem',
      },
      '.cm-completionMatchedText': {
        color: 'var(--accent)', textDecoration: 'none', fontWeight: '600',
      },

      /* The find panel. CodeMirror ships a serviceable one and styles it
         for its own themes, which here meant a strip of browser-default
         grey across the top of an editor that is otherwise the page's
         colours. Only the surface, the fields and the buttons are
         restated; the behaviour is untouched. */
      '.cm-panels': { backgroundColor: 'var(--bg-elev)', color: 'var(--text)' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
      '.cm-panel.cm-search': {
        padding: '.4rem .5rem', fontFamily: 'var(--font)', fontSize: '.8rem',
      },
      '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
        fontFamily: 'inherit', fontSize: 'inherit',
      },
      '.cm-panel.cm-search input[type=text]': {
        backgroundColor: 'var(--bg-inset)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-s)',
        padding: '.2rem .4rem', minWidth: '9rem',
      },
      '.cm-panel.cm-search input[type=text]:focus-visible': {
        outline: '2px solid var(--accent)', outlineOffset: '-1px',
      },
      '.cm-panel.cm-search button:not([name=close])': {
        backgroundColor: 'var(--bg-elev-2)', backgroundImage: 'none',
        color: 'var(--text-dim)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-s)', padding: '.2rem .5rem', cursor: 'pointer',
      },
      '.cm-panel.cm-search button:not([name=close]):hover': { color: 'var(--text)' },
      '.cm-panel.cm-search button[name=close]': {
        color: 'var(--text-faint)', cursor: 'pointer',
        /* The default is a 30px-wide absolutely positioned x that lands
           on top of the last button on a narrow panel. */
        padding: '0 .4rem', fontSize: '1rem',
      },
      '.cm-panel.cm-search label': { color: 'var(--text-dim)' },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, var(--warn) 35%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
      },
      '.cm-selectionMatch': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)',
      },
    }, { dark: true });

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: opts.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          bracketMatching(),
          closeBrackets(),
          completions.of(completion(currentLang)),
          wrapping.of(wrapOn() ? EditorView.lineWrapping : []),
          /* `top: true` puts the panel above the code rather than over
             the horizontal scrollbar at the bottom, where it covered the
             last line of a file that happened to end at the fold. */
          search({ top: true }),
          highlightSelectionMatches(),
          lintGutter(),
          indentUnit.of(INDENT),
          EditorState.tabSize.of(2),
          syntaxHighlighting(highlightStyle),
          language.of(langExtension(currentLang)),
          editable.of(EditorView.editable.of(!opts.readOnly)),
          theming.of(siteTheme),
          keymap.of([
            /* Run and submit first, so they win over anything else bound to
               Enter and work with a selection active. */
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: () => { if (opts.onRun) opts.onRun(); return true; },
            },
            {
              key: 'Mod-Shift-Enter',
              preventDefault: true,
              run: () => { if (opts.onSubmit) opts.onSubmit(); return true; },
            },
            ...closeBracketsKeymap,
            /* Before defaultKeymap, so Enter accepts the highlighted
               completion rather than inserting a newline underneath the
               popup, and Escape closes the popup before anything else
               claims it. */
            ...completionKeymap,
            /* Find, find-again and go-to-line — minus two bindings.

               `Mod-d` (select next occurrence) and `Mod-Shift-l` (select
               all occurrences) are multi-cursor conveniences nobody asked
               for here, and Ctrl+D is how a browser bookmarks a page. A
               shortcut that quietly stops the browser doing its own job
               has to earn it; these two do not.

               `Mod-f` does shadow the browser's find, and keeps it: a
               find that searched the rendered viewport would miss every
               line CodeMirror has not drawn, so inside the editor it
               would be the broken one. It is only bound while the editor
               has focus, the panel says Escape closes it, and the
               browser's own find is a click away in the statement. */
            ...searchKeymap.filter(b => !['Mod-d', 'Mod-Shift-l'].includes(b.key)),
            /* Alt+Z, as every other editor spells it. */
            { key: 'Alt-z', preventDefault: true, run: () => { setWrap(!wrapOn()); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
            /* Tab indents rather than leaving the editor. Escape then Tab
               still moves focus out, which is the accessible escape hatch
               CodeMirror provides and a bare textarea does not. */
            indentWithTab,
          ]),
          EditorView.updateListener.of(u => {
            if (!u.docChanged) return;
            opts.onChange(view.state.doc.toString());
            if (watcher) watcher.changed();
          }),
        ],
      }),
    });

    /* ---------------- diagnostics ---------------- */

    const SEVERITY = { error: 'error', warning: 'warning', info: 'info' };

    function paintProblems() {
      if (!opts.lint || !diagnostics.length) {
        problems.hidden = true;
        problems.replaceChildren();
      } else {
        problems.hidden = false;
        problems.replaceChildren(...diagnostics.slice(0, 20).map(d => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'ed-problem';
          row.dataset.severity = d.severity;
          row.innerHTML =
            `<span class="ed-problem-at">${d.line}:${d.column}</span>` +
            `<span class="ed-problem-msg">${MD.escapeHtml(d.message)}</span>` +
            '<span class="ed-problem-from">compiler</span>';
          row.addEventListener('click', () => goToLine(d.line, d.column));
          return row;
        }));
      }

      const errors = diagnostics.filter(d => d.severity === 'error').length;
      status.dataset.state = errors ? 'error'
        : diagnostics.length ? 'warning'
        : checkedBy ? 'clean' : 'idle';

      /* Nothing until a compiler has actually looked. The line used to say
         "Syntax colouring only. Press Run to compile it." on every problem
         from the moment it opened, which is a standing notice about
         something that has not happened yet — and it sat under the editor
         on every one of them. What the compiler said, when it has said
         anything, is worth the row; the absence of a compiler is not. */
      status.textContent = (!opts.lint || checkedBy !== 'compiler') ? ''
        : `${Lint.summarise(diagnostics, { checkedBy })} · checked by ${checkedWith || 'the compiler'}`;
      status.hidden = !status.textContent;
    }

    /* Our diagnostics carry a line and a column; CodeMirror wants document
       offsets. A line past the end of the document is clamped rather than
       dropped, because a compiler reporting "at end of input" is pointing at
       a line that may not exist yet. */
    function toOffsets(list) {
      const doc = view.state.doc;
      return list.map(d => {
        const lineNo = Math.min(Math.max(1, d.line || 1), doc.lines);
        const line = doc.line(lineNo);
        const from = Math.min(line.from + Math.max(0, (d.column || 1) - 1), line.to);
        return {
          from,
          to: Math.min(line.to, from + 1),
          severity: SEVERITY[d.severity] || 'info',
          message: d.message || '',
          source: d.from === 'local' ? 'brackets' : 'compiler',
        };
      });
    }

    function setDiagnostics(list, by, withWhat = null) {
      diagnostics = Array.isArray(list) ? list : [];
      checkedBy = by;
      checkedWith = withWhat;
      view.dispatch(cmSetDiagnostics(view.state, toOffsets(diagnostics)));
      paintProblems();
    }

    function startWatching() {
      if (!opts.lint) return;
      if (watcher) watcher.cancel();
      watcher = Lint.watch({
        getSource: () => view.state.doc.toString(),
        get lang() { return currentLang; },
        lang: currentLang,
        profile: currentProfile,
        onRemote: res => setDiagnostics(res.diagnostics, 'compiler', res.by),
      });
    }
    startWatching();

    function goToLine(line, column = 1) {
      const doc = view.state.doc;
      const lineNo = Math.min(Math.max(1, line), doc.lines);
      const l = doc.line(lineNo);
      const at = Math.min(l.from + Math.max(0, column - 1), l.to);
      view.dispatch({
        selection: { anchor: at },
        /* "center" rather than "nearest", so a diagnostic you clicked is not
           left pinned to the very top edge. */
        effects: EditorView.scrollIntoView(at, { y: 'center' }),
        scrollIntoView: true,
      });
      view.focus();
    }

    /* Shared by every editor on the page, so flipping it in one file of
       a workspace flips it in the file you open next — the alternative
       is a setting that appears to have been forgotten. The others are
       told by re-reading the preference when they are built; this one is
       reconfigured live because it is the one you are looking at. */
    function setWrap(on) {
      Store.setPref('editorWrap', !!on);
      view.dispatch({
        effects: wrapping.reconfigure(on ? EditorView.lineWrapping : []),
      });
      view.requestMeasure();
      return !!on;
    }

    /* Nothing is marked up until a compiler has said something. */
    if (opts.lint) setDiagnostics([], null);

    /* ---------------- the handle ----------------

       The same shape the overlay editor exposed, so problem.js and the code
       type did not have to change. `value` is read straight out of the live
       document, which is what makes "the last character typed before Run" a
       non-question: there is no second copy to fall behind. */

    return {
      get value() { return view.state.doc.toString(); },
      set value(v) {
        const next = String(v);
        if (next === view.state.doc.toString()) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          /* A programmatic replacement is not something to undo back through
             one keystroke at a time. */
          annotations: [],
        });
        /* The old diagnostics belonged to the old text. They go, and the
           compiler is asked again. */
        if (opts.lint) {
          setDiagnostics([], null);
          if (watcher) watcher.changed();
        }
      },
      get diagnostics() { return diagnostics.slice(); },
      get lang() { return currentLang; },
      setLang(next, nextProfile) {
        currentLang = next;
        if (nextProfile) currentProfile = nextProfile;
        host.dataset.lang = next;
        view.dispatch({ effects: [
          language.reconfigure(langExtension(next)),
          /* Or the C++ word list would keep offering std::vector in the
             Python tab. */
          completions.reconfigure(completion(next)),
        ] });
        startWatching();
        /* A C++ diagnostic means nothing about the Rust in front of you. */
        if (opts.lint) setDiagnostics([], null);
      },
      setReadOnly(ro) {
        view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!ro)) });
      },
      /* The reader can make the code bigger without zooming the whole page,
         which on a split layout would cost them the statement. */
      get fontSize() { return fontSize(); },
      setFontSize(px) {
        const want = FONT_SIZES.includes(px) ? px : DEFAULT_FONT;
        Store.setPref('editorFontSize', want);
        /* The size rides on top of the base theme rather than replacing it,
           so nothing else in the theme has to be repeated here. */
        view.dispatch({
          effects: theming.reconfigure([
            siteTheme,
            EditorView.theme({ '&': { fontSize: `${want}px` } }),
          ]),
        });
        view.requestMeasure();
        return want;
      },
      focus: () => view.focus(),
      goToLine,

      /* ---- the editing tools, as commands ----

         Every one of these is already on a key. They are on the handle
         as well so the shortcuts menu can be a menu rather than a list
         of things to memorise, and so a reader on a tablet with no
         modifier keys is not locked out of them.

         All of them are syntactic. `toggleComment` knows where a line
         starts and what the language's comment token is; it does not
         know what the line means. */
      find: () => { openSearchPanel(view); },
      closeFind: () => { closeSearchPanel(view); view.focus(); },
      get finding() { return searchPanelOpen(view.state); },
      promptLine: () => { gotoLine(view); },
      indent: () => { indentMore(view); view.focus(); },
      outdent: () => { indentLess(view); view.focus(); },
      comment: () => { toggleComment(view); view.focus(); },
      get wrap() { return wrapOn(); },
      setWrap,
      /* Panel resizing and zoom: CodeMirror measures lazily, so it is told to
         re-measure rather than left to notice. */
      refresh: () => view.requestMeasure(),
      destroy: () => { if (watcher) watcher.cancel(); view.destroy(); },
      undo: () => undo(view),
      redo: () => redo(view),
      element: host,
      view,
      backend: 'codemirror',
    };
  }

  /* ---------------- the fallback ----------------

     If vendor/codemirror.js did not load, the page still has to be usable.
     A plain textarea: no highlighting, no gutter, every editing behaviour a
     browser gives you for free, and the same handle. */

  function createFallback(mount, opts) {
    const host = document.createElement('div');
    host.className = 'ed ed-plain';
    host.dataset.lang = opts.lang;

    const area = document.createElement('textarea');
    area.className = 'ed-input';
    area.spellcheck = false;
    area.autocapitalize = 'off';
    area.autocomplete = 'off';
    area.setAttribute('autocorrect', 'off');
    area.setAttribute('aria-label', 'Your solution');
    area.value = opts.value;
    area.readOnly = opts.readOnly;
    host.append(area);

    const status = document.createElement('div');
    status.className = 'ed-status';
    status.dataset.state = 'warning';
    status.textContent = 'Syntax highlighting is unavailable — vendor/codemirror.js did not load. '
      + 'Everything else works.';

    mount.append(host, status);

    area.addEventListener('input', () => opts.onChange(area.value));
    area.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey && opts.onSubmit) opts.onSubmit();
        else if (opts.onRun) opts.onRun();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b } = area;
        area.setRangeText(INDENT, a, b, 'end');
        opts.onChange(area.value);
      }
    });

    let currentLang = opts.lang;
    return {
      get value() { return area.value; },
      set value(v) { area.value = String(v); opts.onChange(area.value); },
      get diagnostics() { return []; },
      get lang() { return currentLang; },
      setLang(next) { currentLang = next; host.dataset.lang = next; },
      setReadOnly(ro) { area.readOnly = ro; },
      get fontSize() { return fontSize(); },
      setFontSize(px) { Store.setPref('editorFontSize', px); area.style.fontSize = `${px}px`; return px; },
      focus: () => area.focus(),
      /* The textarea fallback has the browser's own find, its own
         wrapping and no notion of a comment token. These keep the shape
         of the handle so callers need no branch; the menu reads
         `backend` and leaves the rows out rather than offering a
         button that does nothing. */
      find: () => {},
      closeFind: () => {},
      get finding() { return false; },
      promptLine: () => {},
      indent: () => {},
      outdent: () => {},
      comment: () => {},
      get wrap() { return true; },
      setWrap: () => true,
      goToLine(line) {
        const lines = area.value.split('\n');
        let at = 0;
        for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) at += lines[i].length + 1;
        area.focus();
        area.setSelectionRange(at, at);
      },
      refresh: () => {},
      destroy: () => {},
      undo: () => document.execCommand && document.execCommand('undo'),
      redo: () => document.execCommand && document.execCommand('redo'),
      element: host,
      textarea: area,
      backend: 'textarea',
    };
  }

  return { create, INDENT, FONT_SIZES, DEFAULT_FONT, available: ready };
})();
