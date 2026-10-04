/* ============================================================
   editor.js — a code editor with syntax highlighting and real
   compiler diagnostics.

   The highlighting is the standard overlay technique: a coloured
   <pre> sits exactly behind a transparent <textarea>, and the two
   are kept in scroll sync. The textarea keeps every behaviour a
   textarea has — the caret, selection, undo, IME, accessibility,
   mobile keyboards — which is what makes this worth doing rather
   than reimplementing an editor over a contenteditable div.

   Everything about the two layers that affects where a glyph
   lands must match exactly: font, size, line height, letter
   spacing, tab size, padding, and white-space handling. One
   pixel of difference anywhere shows up as text sitting beside
   its own colour. The pairs that matter are marked below and
   enforced by a test.

   Diagnostics come from js/lint.js: a bracket scanner on every
   keystroke, and the real compiler through the judge shortly
   after you stop typing.
   ============================================================ */

const Editor = (() => {

  const INDENT = '  ';
  /* Past this, re-highlighting the whole buffer on each keystroke stops being
     free. Nothing on this site is near it, and a pasted file might be. */
  const HIGHLIGHT_LINE_LIMIT = 3000;

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

    /* ---------------- structure ---------------- */

    const gutter = document.createElement('div');
    gutter.className = 'ed-gutter';
    gutter.setAttribute('aria-hidden', 'true');

    const highlight = document.createElement('pre');
    highlight.className = 'ed-highlight';
    highlight.setAttribute('aria-hidden', 'true');
    const highlightCode = document.createElement('code');
    highlight.append(highlightCode);

    const area = document.createElement('textarea');
    area.className = 'ed-input';
    area.spellcheck = false;
    area.autocapitalize = 'off';
    area.autocomplete = 'off';
    area.setAttribute('autocorrect', 'off');
    area.setAttribute('aria-label', 'Your solution');
    area.value = value;
    area.readOnly = readOnly;

    const stack = document.createElement('div');
    stack.className = 'ed-stack';
    stack.append(highlight, area);

    const wrap = document.createElement('div');
    wrap.className = 'ed';
    wrap.dataset.lang = lang;
    wrap.append(gutter, stack);

    const status = document.createElement('div');
    status.className = 'ed-status';

    const problems = document.createElement('div');
    problems.className = 'ed-problems';
    problems.hidden = true;

    mount.append(wrap, status, problems);

    /* ---------------- state ---------------- */

    let currentLang = lang;
    let currentProfile = profile;
    let diagnostics = [];
    let checkedBy = null;      /* 'local' | 'compiler' */
    let watcher = null;

    /* ---------------- painting ---------------- */

    function paintHighlight() {
      const text = area.value;
      const lines = text.split('\n');

      if (lines.length > HIGHLIGHT_LINE_LIMIT) {
        wrap.dataset.plain = 'true';
        highlightCode.textContent = '';
        return;
      }
      delete wrap.dataset.plain;

      /* The trailing newline is the one thing the two layers disagree about:
         a <pre> ending in a newline renders no final line box, while the
         textarea gives you a caret row. A sentinel space restores it. */
      const escaped = MD.escapeHtml(text.endsWith('\n') ? text + ' ' : text);
      highlightCode.innerHTML = Highlight.supports(currentLang)
        ? Highlight.run(escaped, currentLang)
        : escaped;
    }

    function paintGutter() {
      const count = Math.max(area.value.split('\n').length, 1);
      const bad = new Map();
      for (const d of diagnostics) {
        const was = bad.get(d.line);
        if (!was || (was !== 'error' && d.severity === 'error')) bad.set(d.line, d.severity);
      }

      /* Built as one string: a 400-line file would otherwise be 400 nodes
         rebuilt on every keystroke. */
      let html = '';
      for (let n = 1; n <= count; n += 1) {
        const mark = bad.get(n);
        html += mark
          ? `<span class="ed-ln" data-mark="${mark}">${n}</span>`
          : `<span class="ed-ln">${n}</span>`;
      }
      gutter.innerHTML = html;
      gutter.scrollTop = area.scrollTop;
    }

    function paintProblems() {
      if (!doLint || !diagnostics.length) {
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
            (d.from === 'local' ? '<span class="ed-problem-from">brackets</span>' : '');
          row.addEventListener('click', () => goToLine(d.line, d.column));
          return row;
        }));
      }

      const errors = diagnostics.filter(d => d.severity === 'error').length;
      status.dataset.state = errors ? 'error'
        : diagnostics.length ? 'warning'
        : checkedBy ? 'clean' : 'idle';
      status.textContent = doLint
        ? (checkedBy === 'compiler'
            ? `${Lint.summarise(diagnostics, { checkedBy })} · checked by the compiler`
            : Lint.summarise(diagnostics, { checkedBy }))
        : '';
    }

    const repaint = () => { paintHighlight(); paintGutter(); };

    /* ---------------- scroll sync ----------------
       The overlay has no scrollbar of its own; it is moved to match. */
    area.addEventListener('scroll', () => {
      highlight.scrollTop = area.scrollTop;
      highlight.scrollLeft = area.scrollLeft;
      gutter.scrollTop = area.scrollTop;
    });

    /* ---------------- editing ---------------- */

    function setDiagnostics(list, by) {
      diagnostics = Array.isArray(list) ? list : [];
      checkedBy = by;
      paintGutter();
      paintProblems();
    }

    if (doLint) {
      watcher = Lint.watch({
        getSource: () => area.value,
        get lang() { return currentLang; },
        lang: currentLang,
        profile: currentProfile,
        onLocal: list => setDiagnostics(list, 'local'),
        onRemote: res => setDiagnostics(res.diagnostics, 'compiler'),
      });
    }

    function changed() {
      repaint();
      onChange(area.value);
      if (watcher) watcher.changed();
    }

    area.addEventListener('input', changed);

    function goToLine(line, column = 1) {
      const lines = area.value.split('\n');
      let at = 0;
      for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) at += lines[i].length + 1;
      at += Math.max(0, column - 1);
      area.focus();
      area.setSelectionRange(at, at);
      /* Put the line roughly a third down rather than at the very top. */
      const lineHeight = area.scrollHeight / Math.max(lines.length, 1);
      area.scrollTop = Math.max(0, (line - 1) * lineHeight - area.clientHeight / 3);
      highlight.scrollTop = area.scrollTop;
      gutter.scrollTop = area.scrollTop;
    }

    area.addEventListener('keydown', e => {
      /* Run and submit first, so they work with a selection active. */
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey && onSubmit) onSubmit();
        else if (onRun) onRun();
        return;
      }

      if (e.key === 'Tab') {
        /* Tab in a code box should indent. Losing focus to the next control
           mid-expression is never what anyone wanted. Shift+Tab dedents, and a
           multi-line selection indents as a block. */
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = area;

        if (a !== b && value.slice(a, b).includes('\n')) {
          const from = value.lastIndexOf('\n', a - 1) + 1;
          const lines = value.slice(from, b).split('\n');
          const next = e.shiftKey
            ? lines.map(l => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^[ \t]/, '')))
            : lines.map(l => INDENT + l);
          area.setRangeText(next.join('\n'), from, b, 'select');
        } else if (e.shiftKey) {
          const from = value.lastIndexOf('\n', a - 1) + 1;
          const lineText = value.slice(from, a);
          const cut = lineText.startsWith(INDENT) ? INDENT.length : (/^[ \t]/.test(lineText) ? 1 : 0);
          if (cut) {
            area.setRangeText('', from, from + cut, 'end');
            area.selectionStart = area.selectionEnd = a - cut;
          }
        } else {
          area.setRangeText(INDENT, a, b, 'end');
        }
        changed();
        return;
      }

      if (e.key === 'Enter') {
        /* Carry the current line's indent onto the new one, and go one deeper
           after an opening brace. Without this, writing a function body means
           re-typing the indent on every line. */
        const { selectionStart: a, value } = area;
        const from = value.lastIndexOf('\n', a - 1) + 1;
        const lineText = value.slice(from, a);
        const indent = (lineText.match(/^[ \t]*/) || [''])[0];
        const deeper = /[{([:]\s*$/.test(lineText) ? INDENT : '';
        /* Typing Enter between a brace pair puts the closer on its own line,
           which is what every editor does and its absence is immediately
           annoying. */
        const closerNext = /^[\s]*[}\])]/.test(value.slice(a));
        if (!indent && !deeper) return;
        e.preventDefault();
        if (deeper && closerNext) {
          area.setRangeText(`\n${indent}${deeper}\n${indent}`, a, area.selectionEnd, 'end');
          const caret = a + 1 + indent.length + deeper.length;
          area.setSelectionRange(caret, caret);
        } else {
          area.setRangeText(`\n${indent}${deeper}`, a, area.selectionEnd, 'end');
        }
        changed();
        return;
      }

      /* Typing a closer where one already sits just moves over it. */
      if ([')', ']', '}'].includes(e.key)) {
        const { selectionStart: a, selectionEnd: b, value } = area;
        if (a === b && value[a] === e.key) {
          e.preventDefault();
          area.setSelectionRange(a + 1, a + 1);
        }
        return;
      }

      /* Auto-close a bracket, but only at the end of a line or before
         whitespace or another closer — inserting a ')' in the middle of an
         existing expression is never wanted. */
      const CLOSE = { '(': ')', '[': ']', '{': '}' };
      if (CLOSE[e.key]) {
        const { selectionStart: a, selectionEnd: b, value } = area;
        const after = value[a] || '\n';
        if (a === b && /[\s)\]};,]/.test(after)) {
          e.preventDefault();
          area.setRangeText(e.key + CLOSE[e.key], a, b, 'end');
          area.setSelectionRange(a + 1, a + 1);
          changed();
        }
      }
    });

    repaint();
    if (doLint) setDiagnostics(Lint.local(area.value, currentLang), 'local');

    /* ---------------- the handle ---------------- */

    return {
      get value() { return area.value; },
      set value(v) {
        area.value = v;
        repaint();
        if (doLint) {
          setDiagnostics(Lint.local(area.value, currentLang), 'local');
          if (watcher) watcher.changed();
        }
      },
      get diagnostics() { return diagnostics.slice(); },
      get lang() { return currentLang; },
      setLang(next, nextProfile) {
        currentLang = next;
        if (nextProfile) currentProfile = nextProfile;
        wrap.dataset.lang = next;
        if (watcher) watcher.cancel();
        if (doLint) {
          watcher = Lint.watch({
            getSource: () => area.value,
            lang: currentLang,
            profile: currentProfile,
            onLocal: list => setDiagnostics(list, 'local'),
            onRemote: res => setDiagnostics(res.diagnostics, 'compiler'),
          });
        }
        repaint();
        if (doLint) setDiagnostics(Lint.local(area.value, currentLang), 'local');
      },
      setReadOnly(ro) { area.readOnly = ro; },
      focus: () => area.focus(),
      goToLine,
      textarea: area,
      element: wrap,
    };
  }

  return { create, INDENT, HIGHLIGHT_LINE_LIMIT };
})();
