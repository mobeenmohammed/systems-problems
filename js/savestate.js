/* ============================================================
   savestate.js — saying whether the draft actually saved.

   What was here before was three debounced timers, one in
   js/types/code.js, one in js/types/hdl.js and one in
   js/problem.js, each of which wrote "Saved" four hundred
   milliseconds after a keystroke. None of them looked at
   whether the write had worked. `Store.save()` has returned a
   boolean and emitted `storage-error` the whole time, and
   nothing read either, so a browser with no room left said
   "Saved" exactly as convincingly as one with plenty.

   One place now, driven by the result:

     Saving…              a write is in flight
     Saved on this device the write returned true
     Could not save       it did not

   "On this device" because that is the whole truth about it.
   There is no account and nothing is synchronised; a different
   browser, a private window or cleared site data is a different
   set of drafts. Somebody who reads "Saved" and assumes
   otherwise has been misled by one word.

   On failure the editor keeps every character — nothing here
   touches the document — and the row grows two buttons: try the
   write again, and download the workspace, which is the one
   route out that does not depend on the storage that just
   refused.
   ============================================================ */

const SaveState = (() => {

  /* Two places, because inside an assessment the save status belongs in
     the assessment's own header: it is one of the things that bar is
     required to show, and the editor's own note scrolls away with the
     toolbar on a narrow screen. */
  const slots = () => [
    document.getElementById('draftNote') || document.getElementById('draftState'),
    document.getElementById('oaSave'),
    document.querySelector('#answerSaved'),
  ].filter(Boolean);

  const SETTLE_MS = 420;

  let timer = null;
  /* Did anything in the current burst of keystrokes fail? A single
     false in a window of thirty writes means the draft on disk is not
     what is on screen, which is the thing worth saying. */
  let bad = false;
  let note = '';
  let retry = null;

  function label(node, state, text) {
    node.dataset.state = state;
    /* The assessment header has room for a word and no more. */
    node.textContent = node.id === 'oaSave' || node.id === 'answerSaved'
      ? ({ saving: 'Saving…', saved: 'Saved', failed: 'Not saved' }[state] || '')
      : text;
  }

  /* The failed row: what happened, and the two things that can be done
     about it. Built rather than written as HTML because one of the
     buttons has to call back into the page. */
  function failed(node) {
    if (node.id === 'oaSave' || node.id === 'answerSaved') {
      label(node, 'failed', '');
      return;
    }
    node.dataset.state = 'failed';
    node.replaceChildren();
    node.title = 'Drafts are kept in this browser, on this device. '
      + 'There is no account and nothing is synchronised, so this is '
      + 'local storage refusing the write — usually because it is full, '
      + 'or because the browser is blocking storage for this site.';

    const say = document.createElement('span');
    say.textContent = 'Could not save';
    node.append(say);

    if (retry) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'save-act';
      again.textContent = 'Try again';
      again.addEventListener('click', () => {
        const fn = retry;
        if (!fn) return;
        begin();
        let ok = false;
        try { ok = fn() !== false; } catch { ok = false; }
        settle(ok, { note, retry: fn });
      });
      node.append(again);
    }

    /* The way out that does not go through the storage that just
       refused. Only on a workspace, which is the only place there is
       something to put in an archive. */
    if (typeof ProblemView !== 'undefined' && ProblemView.downloadWorkspace) {
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'save-act';
      save.textContent = 'Download it';
      save.title = 'Every file you can see, as a ZIP. Nothing is lost if '
        + 'this tab closes.';
      save.addEventListener('click', () => ProblemView.downloadWorkspace());
      node.append(save);
    }
  }

  /* ---------------- the three states ---------------- */

  function paint() {
    for (const node of slots()) {
      if (bad) { failed(node); continue; }
      node.title = 'Kept in this browser, on this device. There is no '
        + 'account and nothing is synchronised.';
      label(node, 'saved', note ? `Saved — ${note}` : 'Saved on this device');
    }
  }

  /* A write has started. Said immediately, because the gap between
     typing and knowing is the thing this exists to close. */
  function begin() {
    for (const node of slots()) {
      if (node.dataset.state === 'failed') node.replaceChildren();
      label(node, 'saving', 'Saving…');
    }
  }

  /* A write has finished, and this is what it said. Debounced, so that
     thirty keystrokes read as one "Saved" rather than a flicker — but
     a failure anywhere in the burst survives to the end of it. */
  function settle(okay, opts = {}) {
    if (okay === false) bad = true;
    if (opts.note !== undefined) note = opts.note || '';
    if (opts.retry) retry = opts.retry;
    clearTimeout(timer);
    timer = setTimeout(() => {
      paint();
      /* The next burst starts clean: a failure that has been reported
         and then succeeded on retry must not keep the row red. */
      bad = false;
      note = '';
    }, SETTLE_MS);
  }

  /* The common shape: run the write, show both halves of it, and hand
     back what the write said so the caller can act on it too. */
  function around(fn, opts = {}) {
    begin();
    let ok = false;
    try { ok = fn() !== false; } catch { ok = false; }
    settle(ok, { ...opts, retry: opts.retry || fn });
    return ok;
  }

  /* A write somewhere else in the page ran out of room. The drafts are
     in the same quota, so this row is where it shows. */
  function watch() {
    if (typeof Store === 'undefined' || !Store.on) return;
    Store.on((event) => {
      if (event === 'storage-error') settle(false);
    });
  }

  /* Leaving the problem. A pending settle would paint the last
     exercise's result into the next one's row, several seconds after
     the row it was about stopped existing. */
  function cancel() {
    clearTimeout(timer);
    timer = null;
    bad = false;
    note = '';
    retry = null;
  }

  return { begin, settle, around, cancel, watch, SETTLE_MS };
})();
