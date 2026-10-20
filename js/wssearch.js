/* ============================================================
   wssearch.js — plain-text search across the files on screen.

   Deliberately plain text. Not a regular expression, not a
   fuzzy match, not a symbol index: you type what you remember
   writing and it tells you which file you wrote it in. Case
   sensitivity and whole-word are the two switches that change
   whether a result is what you meant, so those are here; a
   regular-expression mode would be a third syntax to get wrong
   on top of the one the exercise is already about.

   There is no replace. A workspace-wide replace that touched
   several files at once, in an editor the reader cannot undo
   across, is a way to lose an afternoon's work to one typo.
   Find/replace inside the file you are looking at is
   CodeMirror's own panel and is reachable with Ctrl+F.

   What it searches is whatever WsFiles.visible() says is on
   screen — which is the point of that module existing. There
   is no path from here to a grading testbench, a reference
   solution or a hidden case, because there is no path from
   WsFiles to them either.
   ============================================================ */

const WsSearch = (() => {

  /* Capped so that a one-character query on a large workspace cannot
     turn into a list with a row per character. The count is still
     reported honestly: the UI says how many were found and how many it
     is showing, rather than quietly truncating. */
  const MAX_PER_FILE = 200;
  const MAX_TOTAL = 1000;

  const WORD = /[A-Za-z0-9_$]/;

  /* A match is a whole word when neither side of it continues the word.
     `_` and `$` count as word characters here because this is searching
     source, where `max_run` is one name and finding `max` inside it is
     exactly what "whole word" is being asked to stop. */
  function wholeAt(text, at, len) {
    const before = at > 0 ? text[at - 1] : '';
    const after = at + len < text.length ? text[at + len] : '';
    return !(before && WORD.test(before)) && !(after && WORD.test(after));
  }

  /* Offsets -> 1-based line and column, in one pass over the file
     rather than one pass per hit. */
  function lineIndex(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '\n') starts.push(i + 1);
    }
    return starts;
  }

  function lineAt(starts, offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /* ---------------- the search ----------------

     Returns { query, files: [...], found, shown, capped }, where each
     file is { path, readOnly, role, hits: [...], found, capped } and
     each hit is { line, column, text, from, to } — `from`/`to` being
     offsets into the trimmed line, so the UI can mark the match inside
     the context it shows without searching the line again. */
  function run(files, query, opts = {}) {
    const q = String(query == null ? '' : query);
    const out = { query: q, files: [], found: 0, shown: 0, capped: false };
    if (!q) return out;

    const cased = !!opts.caseSensitive;
    const word = !!opts.wholeWord;
    const needle = cased ? q : q.toLowerCase();

    for (const f of files) {
      const text = String(f.content == null ? '' : f.content);
      const hay = cased ? text : text.toLowerCase();
      const starts = lineIndex(text);
      const hits = [];
      let found = 0;
      let at = hay.indexOf(needle);

      while (at !== -1) {
        if (!word || wholeAt(text, at, needle.length)) {
          found += 1;
          if (hits.length < MAX_PER_FILE && out.shown < MAX_TOTAL) {
            const ln = lineAt(starts, at);
            const lineStart = starts[ln];
            const lineEnd = ln + 1 < starts.length ? starts[ln + 1] - 1 : text.length;
            const raw = text.slice(lineStart, lineEnd);
            /* Leading indentation is noise in a list of one-line
               results, and dropping it moves the match, so the offsets
               are reported against what is actually shown. */
            const lead = raw.length - raw.replace(/^[ \t]+/, '').length;
            const column = at - lineStart + 1;
            hits.push({
              line: ln + 1,
              column,
              text: raw.slice(lead),
              from: Math.max(0, column - 1 - lead),
              to: Math.max(0, column - 1 - lead) + needle.length,
            });
            out.shown += 1;
          } else {
            out.capped = true;
          }
        }
        /* Overlapping matches are matches: searching `aa` in `aaa`
           finds two, which is what a reader counting them would say. */
        at = hay.indexOf(needle, at + 1);
      }

      if (found) {
        out.found += found;
        out.files.push({
          path: f.path,
          readOnly: !!f.readOnly,
          role: f.role || 'yours',
          note: f.note || '',
          found,
          capped: found > hits.length,
          hits,
        });
      }
    }

    /* Grouped by file, and the files in the order the explorer draws
       them, so the list reads like the workspace rather than like a
       ranking nobody asked for. */
    return out;
  }

  /* The convenience the UI actually calls: ask WsFiles what is on
     screen, then search that. Kept separate from run() so the search
     itself can be tested against a list of files with no page. */
  const inWorkspace = (problem, query, opts) =>
    run(WsFiles.visible(problem), query, opts);

  return { run, inWorkspace, MAX_PER_FILE, MAX_TOTAL };
})();
