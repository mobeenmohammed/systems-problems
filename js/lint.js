/* ============================================================
   lint.js — compiler diagnostics for the editor.

   One tier, and it is the real compiler: the judge's /lint
   endpoint runs g++ -fsyntax-only (or rustc --emit=metadata, or
   py_compile, or node --check) and returns parsed diagnostics
   with line and column. Debounced, because it is a network call.

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
  function watch({ getSource, lang, profile, onRemote, debounceMs = 700 }) {
    let timer = null;
    let seq = 0;

    function changed() {
      const source = getSource();
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

  return { remote, available, watch, summarise };
})();
