/* ============================================================
   lint.js — compiler diagnostics for the editor.

   Two sources, and both are a real compiler.

   For Rust there is now one in this tab: the vendored rustc
   run with --emit=metadata, which stops after the borrow
   checker and before code generation. It takes about a fifth
   of a second, it needs no runner and no network, and it is
   the real borrow checker — so a Rust problem is checked as
   you type on a deployed page, which nothing here could do
   before.

   For everything else it is the judge's /lint endpoint, which
   runs g++ -fsyntax-only (or py_compile, or node --check) and
   returns parsed diagnostics with line and column. Debounced,
   because it is a network call.

   A local judge wins for Rust when there is one: it is the
   native rustc, and it sees the whole program rather than
   stopping where the wasm backend does.

   There used to be a second tier: a hand-written bracket scanner
   that ran on every keystroke and reported "No unbalanced
   brackets". It is gone, and deliberately so. CodeMirror already
   matches and closes brackets while you type, which is the part
   that helps; what the scanner added on top was a verdict, and a
   verdict from something that is not a compiler is worse than no
   verdict at all. "No unbalanced brackets" sat under the editor
   looking like a check had passed, when nothing had been
   compiled and the program might not even parse.

   So the editor now colours and matches, and the compiler is the
   only thing that ever says whether the code is good.
   ============================================================ */

const Lint = (() => {

  const rust = () => (typeof BrowserRust !== 'undefined' ? BrowserRust : null);

  /* Whether the in-tab rustc could check this. A separate question from
     whether a problem can RUN here: --emit=metadata stops before the
     code generation that the Cranelift gap is in, so this is true for
     every Rust problem including the ones the audit marks native-only
     for running. */
  function rustInTab(lang) {
    return lang === 'rust' && !!rust() && rust().capable();
  }

  async function available(lang) {
    if (!['cpp', 'rust', 'python', 'js'].includes(lang)) return false;
    const judge = await Runners.checkJudge();
    if (judge.state === 'ready' && judge.languages.some(l => l.id === lang)) return true;
    /* No runner, but Rust can still be checked here. */
    return rustInTab(lang);
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
        by: 'the runner',
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
  /* Rust, checked in this tab. rustc's own JSON diagnostics, mapped to
     the shape the editor already draws for the judge's — so a borrow
     error from here and one from a native rustc are the same object by
     the time anything looks at them. */
  async function inTab(source, lang) {
    if (!rustInTab(lang)) return { ok: false, unavailable: true, diagnostics: [] };
    try {
      const res = await rust().check(source);
      if (!res) return { ok: false, unavailable: true, diagnostics: [] };
      return {
        ok: !res.diagnostics.some(d => d.level === 'error'),
        ran: true,
        /* Named, because "the compiler" is now two different compilers
           and which one looked at your program changes what its silence
           is worth: this one stops at the borrow checker. */
        by: res.version ? `${res.version}, in this tab` : 'rustc, in this tab',
        diagnostics: res.diagnostics.map(d => ({
          severity: d.level === 'warning' ? 'warning' : 'error',
          line: d.line,
          column: d.col,
          endLine: d.endLine,
          endColumn: d.endCol,
          message: d.message,
          code: d.code,
          rendered: d.rendered,
          from: 'compiler',
        })),
      };
    } catch {
      /* A compiler that will not start is a compiler that is not there,
         not an error to put in front of somebody writing code. */
      return { ok: false, unavailable: true, diagnostics: [] };
    }
  }

  function watch({ getSource, lang, profile, onRemote, debounceMs = 700 }) {
    let timer = null;
    let seq = 0;

    function changed() {
      const source = getSource();
      clearTimeout(timer);
      const mine = ++seq;
      timer = setTimeout(async () => {
        const judge = await Runners.checkJudge();
        const hasJudge = judge.state === 'ready'
          && judge.languages.some(l => l.id === lang);
        /* The native rustc first when there is one: it sees the whole
           program, where the in-tab one stops at the borrow checker. */
        if (!hasJudge && !rustInTab(lang)) return;
        const res = hasJudge
          ? await remote(source, lang, { profile })
          : await inTab(source, lang);
        /* A reply for a version of the source that has since been edited is
           worse than no reply, because it points at lines that have moved. */
        if (mine !== seq || !res.ran) return;
        onRemote(res);
      }, debounceMs);
    }

    return { changed, cancel: () => { clearTimeout(timer); seq += 1; } };
  }

  /* One line summarising a diagnostic list, for the status row.

     With nothing checked there is nothing to say. The editor says what it
     is doing instead — colouring, not verifying — because an empty status
     under a code editor reads as approval. */
  function summarise(diagnostics, { checkedBy = null } = {}) {
    if (!checkedBy) return '';
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    if (!diagnostics.length) return 'No problems found by the compiler.';
    const bits = [];
    if (errors) bits.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`);
    if (warnings) bits.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
    return bits.join(', ');
  }

  return { remote, inTab, available, watch, summarise, rustInTab };
})();
