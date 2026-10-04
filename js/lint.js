/* ============================================================
   lint.js — diagnostics for the editor, in two tiers.

   Tier 1, local and instant: a bracket scanner that knows about
   comments and string literals, so it does not report the brace
   inside a comment as unbalanced. Runs on every keystroke, needs
   nothing, and catches the single commonest mistake there is.

   Tier 2, the real compiler: the judge's /lint endpoint runs
   g++ -fsyntax-only (or rustc --emit=metadata, or py_compile, or
   node --check) and returns parsed diagnostics with line and
   column. Debounced, because it is a network call.

   The compiler wins when it answers. There is no point showing a
   hand-rolled guess next to the authoritative message, and the
   whole reason for the second tier is that the message you get
   while typing should be the message a build would give you.
   ============================================================ */

const Lint = (() => {

  const PAIRS = { '(': ')', '[': ']', '{': '}' };
  const CLOSERS = { ')': '(', ']': '[', '}': '{' };

  const FAMILY = {
    cpp:    { line: '//', block: ['/*', '*/'], strings: ['"', "'"], raw: false },
    rust:   { line: '//', block: ['/*', '*/'], strings: ['"'],      raw: false },
    js:     { line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'], raw: false },
    python: { line: '#',  block: null,         strings: ['"', "'"], triple: true },
  };

  /* ---------------- tier 1: local ---------------- */

  /* Walks the source once, tracking whether it is inside a comment or a string
     so that brackets in either are ignored. Without that it reports a smiley
     in a comment as an unbalanced paren, which is worse than no linting. */
  function scanBrackets(source, lang) {
    const f = FAMILY[lang] || FAMILY.cpp;
    const text = String(source || '');
    const stack = [];
    const out = [];

    let line = 1;
    let col = 1;
    let i = 0;

    const at = n => text[n] || '';
    const starts = s => text.startsWith(s, i);

    while (i < text.length) {
      const c = text[i];

      if (c === '\n') { line += 1; col = 1; i += 1; continue; }

      /* comments */
      if (f.line && starts(f.line)) {
        while (i < text.length && text[i] !== '\n') i += 1;
        continue;
      }
      if (f.block && starts(f.block[0])) {
        const startLine = line;
        i += f.block[0].length;
        let closed = false;
        while (i < text.length) {
          if (text[i] === '\n') { line += 1; col = 1; }
          if (text.startsWith(f.block[1], i)) { i += f.block[1].length; closed = true; break; }
          i += 1;
        }
        if (!closed) {
          out.push({ line: startLine, column: 1, severity: 'error',
                     message: `unterminated block comment opened on line ${startLine}` });
        }
        continue;
      }

      /* strings, including python's triple-quoted form */
      if (f.triple && (starts('"""') || starts("'''"))) {
        const q = text.slice(i, i + 3);
        const startLine = line;
        i += 3;
        let closed = false;
        while (i < text.length) {
          if (text[i] === '\n') { line += 1; col = 1; }
          if (text.startsWith(q, i)) { i += 3; closed = true; break; }
          i += 1;
        }
        if (!closed) {
          out.push({ line: startLine, column: 1, severity: 'error',
                     message: `unterminated triple-quoted string opened on line ${startLine}` });
        }
        continue;
      }

      if (f.strings.includes(c)) {
        const quote = c;
        const startLine = line;
        const startCol = col;
        i += 1; col += 1;
        let closed = false;
        while (i < text.length) {
          if (text[i] === '\\') { i += 2; col += 2; continue; }
          if (text[i] === '\n') {
            /* A newline inside a quote is an unterminated literal in every
               language here except a JS template string. */
            if (quote === '`') { line += 1; col = 1; i += 1; continue; }
            break;
          }
          if (text[i] === quote) { i += 1; col += 1; closed = true; break; }
          i += 1; col += 1;
        }
        if (!closed) {
          out.push({ line: startLine, column: startCol, severity: 'error',
                     message: 'unterminated string literal' });
        }
        continue;
      }

      /* brackets */
      if (PAIRS[c]) {
        stack.push({ char: c, line, column: col });
      } else if (CLOSERS[c]) {
        const top = stack.pop();
        if (!top) {
          out.push({ line, column: col, severity: 'error',
                     message: `unexpected '${c}' — nothing was opened` });
        } else if (PAIRS[top.char] !== c) {
          out.push({ line, column: col, severity: 'error',
                     message: `'${c}' closes '${top.char}' from line ${top.line}, which wanted '${PAIRS[top.char]}'` });
        }
      }

      i += 1; col += 1;
    }

    /* Anything still open. Reported at the opening position, which is where
       the fix goes — not at the end of the file, where the compiler points. */
    for (const open of stack.reverse()) {
      out.push({ line: open.line, column: open.column, severity: 'error',
                 message: `'${open.char}' opened here is never closed` });
    }

    return out.map(d => ({ ...d, from: 'local' }));
  }

  const local = (source, lang) => scanBrackets(source, lang);

  /* ---------------- tier 2: the compiler ---------------- */

  /* Which languages the judge can syntax-check, and whether it is up. Asked
     through Runners so there is one health check rather than two. */
  async function available(lang) {
    if (!['cpp', 'rust', 'python', 'js'].includes(lang)) return false;
    const judge = await Runners.checkJudge();
    /* Linting needs the token like everything else, so a reachable but
       unauthorised runner cannot lint and should not be asked to. */
    return judge.state === 'ready' && judge.languages.some(l => l.id === lang);
  }

  async function remote(source, lang, { profile = 'standard', timeoutMs = 15000 } = {}) {
    const url = Store.config.judgeUrl;
    try {
      await Runners.loadToken();
      const res = await fetch(`${url}/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...Runners.authHeaders() },
        body: JSON.stringify({ lang, source, profile }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, unavailable: true, diagnostics: [] };
      const body = await res.json();
      if (body.error) return { ok: false, unavailable: true, diagnostics: [] };
      return {
        ok: !!body.ok,
        ran: true,
        diagnostics: (body.diagnostics || []).map(d => ({ ...d, from: 'compiler' })),
      };
    } catch {
      /* The judge being down is a normal state, not an error. */
      return { ok: false, unavailable: true, diagnostics: [] };
    }
  }

  /* ---------------- what the editor calls ----------------

     Returns the local findings immediately through onLocal, then the
     compiler's through onRemote if it is reachable. The compiler's answer
     replaces the local one rather than being added to it: two descriptions of
     the same missing brace is not twice as helpful. */
  function watch({ getSource, lang, profile, onLocal, onRemote, debounceMs = 700 }) {
    let timer = null;
    let seq = 0;

    function changed() {
      const source = getSource();
      onLocal(local(source, lang));

      clearTimeout(timer);
      const mine = ++seq;
      timer = setTimeout(async () => {
        if (!(await available(lang))) return;
        const res = await remote(source, lang, { profile });
        /* A reply for a version of the source that has since been edited is
           worse than no reply, because it points at lines that have moved. */
        if (mine !== seq || !res.ran) return;
        onRemote(res);
      }, debounceMs);
    }

    return { changed, cancel: () => { clearTimeout(timer); seq += 1; } };
  }

  /* One line summarising a diagnostic list, for the status row. */
  function summarise(diagnostics, { checkedBy = null } = {}) {
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    if (!diagnostics.length) {
      return checkedBy === 'compiler' ? 'No problems found by the compiler.' : 'No unbalanced brackets.';
    }
    const bits = [];
    if (errors) bits.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`);
    if (warnings) bits.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
    return bits.join(', ');
  }

  return { local, remote, available, watch, summarise, scanBrackets };
})();
