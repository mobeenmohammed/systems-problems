/* ============================================================
   editor.js — a textarea with a line-number gutter.

   Deliberately not a syntax-highlighting editor. Doing that over
   a textarea means keeping a coloured <pre> in exact scroll and
   metric sync underneath it, and every divergence shows up as
   text sitting a pixel off its own highlight. That is a lot of
   fiddly code for a cosmetic win on a site where the interesting
   output is the compiler's. Code that is only *displayed* is
   highlighted — see js/highlight.js.

   What it does do is the handful of things whose absence is
   actually painful: line numbers, Tab for indent instead of
   losing focus, auto-indent on Enter, and bracket-aware dedent.
   ============================================================ */

const Editor = (() => {

  const INDENT = '  ';

  function create(mount, { value = '', onChange = () => {}, onRun = null, onSubmit = null, readOnly = false } = {}) {
    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    gutter.setAttribute('aria-hidden', 'true');

    const area = document.createElement('textarea');
    area.spellcheck = false;
    area.autocapitalize = 'off';
    area.autocomplete = 'off';
    area.setAttribute('aria-label', 'Your solution');
    area.value = value;
    area.readOnly = readOnly;

    const wrap = document.createElement('div');
    wrap.className = 'editor';
    wrap.append(gutter, area);
    mount.append(wrap);

    function renderGutter() {
      const lines = area.value.split('\n').length;
      /* Built as text rather than as elements: a 400-line submission would
         otherwise be 400 nodes rebuilt on every keystroke. */
      let out = '';
      for (let i = 1; i <= Math.max(lines, 1); i += 1) out += `${i}\n`;
      gutter.textContent = out;
      gutter.scrollTop = area.scrollTop;
    }

    /* The gutter is a separate scroller, so it has to be dragged along. */
    area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; });

    area.addEventListener('input', () => {
      renderGutter();
      onChange(area.value);
    });

    area.addEventListener('keydown', e => {
      /* Ctrl/Cmd+Enter to run, Ctrl/Cmd+Shift+Enter to submit. Checked before
         anything else so they work with a selection active. */
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey && onSubmit) onSubmit();
        else if (onRun) onRun();
        return;
      }

      if (e.key === 'Tab') {
        /* Tab in a code box should indent. Losing focus to the next control
           mid-expression is never what anyone wanted. Shift+Tab dedents, and
           a multi-line selection indents as a block. */
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = area;

        if (a !== b && value.slice(a, b).includes('\n')) {
          const from = value.lastIndexOf('\n', a - 1) + 1;
          const block = value.slice(from, b);
          const lines = block.split('\n');
          const next = e.shiftKey
            ? lines.map(l => l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^[ \t]/, ''))
            : lines.map(l => INDENT + l);
          const text = next.join('\n');
          area.setRangeText(text, from, b, 'select');
        } else if (e.shiftKey) {
          const from = value.lastIndexOf('\n', a - 1) + 1;
          const line = value.slice(from, a);
          const cut = line.startsWith(INDENT) ? INDENT.length : (/^[ \t]/.test(line) ? 1 : 0);
          if (cut) {
            area.setRangeText('', from, from + cut, 'end');
            area.selectionStart = area.selectionEnd = a - cut;
          }
        } else {
          area.setRangeText(INDENT, a, b, 'end');
        }
        renderGutter();
        onChange(area.value);
        return;
      }

      if (e.key === 'Enter') {
        /* Carry the current line's indent onto the new one, and go one deeper
           after an opening brace. Without this, writing a loop body means
           re-typing the indent on every line. */
        const { selectionStart: a, value } = area;
        const from = value.lastIndexOf('\n', a - 1) + 1;
        const line = value.slice(from, a);
        const indent = (line.match(/^[ \t]*/) || [''])[0];
        const deeper = /[{([:]\s*$/.test(line) ? INDENT : '';
        if (!indent && !deeper) return;      /* let the browser do the simple case */
        e.preventDefault();
        area.setRangeText(`\n${indent}${deeper}`, a, area.selectionEnd, 'end');
        renderGutter();
        onChange(area.value);
      }
    });

    renderGutter();

    return {
      get value() { return area.value; },
      set value(v) { area.value = v; renderGutter(); },
      focus: () => area.focus(),
      setReadOnly: ro => { area.readOnly = ro; },
      textarea: area,
    };
  }

  return { create, INDENT };
})();
