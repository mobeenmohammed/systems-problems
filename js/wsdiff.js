/* ============================================================
   wsdiff.js — what changed between two versions of the work.

   A line diff, and for a multi-file workspace a diff per file
   with added and deleted files named as such. It compares; it
   never writes. Putting a submission back is a different
   button, asks first, and is the only thing that touches a
   draft.

   ---------------- how ----------------

   Longest common subsequence over lines, by the textbook
   dynamic program. Myers would be faster on large inputs and
   these are not large inputs: the biggest file in the catalogue
   is under three hundred lines, so the table is at worst a few
   tens of thousands of cells and the simple algorithm is the
   one that is obviously correct.

   There is still a cap, because "obviously correct" stops being
   a defence when the table is a gigabyte. Past it the two files
   are reported as wholly replaced, honestly labelled, rather
   than the tab being taken for a minute.

   Common prefixes and suffixes are stripped before the table is
   built, which is what makes a one-line change in a long file
   cost almost nothing.
   ============================================================ */

const WsDiff = (() => {

  /* 4 million cells: a 2000x2000 comparison, well past anything here,
     and about 16 MB of Int32Array. */
  const MAX_CELLS = 4e6;

  const split = text => String(text == null ? '' : text).split('\n');

  /* ---------------- lines ----------------

     Returns { rows, added, removed, same, truncated } where a row is
     { kind, a, b, text } and `a`/`b` are 1-based line numbers in the
     left and right texts, null where the line is not in that side. */
  function lines(leftText, rightText) {
    const A = split(leftText);
    const B = split(rightText);

    /* The identical ends, which no table needs to discover. */
    let head = 0;
    while (head < A.length && head < B.length && A[head] === B[head]) head += 1;
    let tail = 0;
    while (tail < A.length - head && tail < B.length - head
      && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail += 1;

    const a = A.slice(head, A.length - tail);
    const b = B.slice(head, B.length - tail);

    const rows = [];
    const push = (kind, ai, bi, text) => rows.push({ kind, a: ai, b: bi, text });
    for (let i = 0; i < head; i += 1) push('same', i + 1, i + 1, A[i]);

    if (a.length && b.length && (a.length + 1) * (b.length + 1) > MAX_CELLS) {
      a.forEach((t, i) => push('del', head + i + 1, null, t));
      b.forEach((t, i) => push('add', null, head + i + 1, t));
      for (let i = 0; i < tail; i += 1) {
        push('same', A.length - tail + i + 1, B.length - tail + i + 1, A[A.length - tail + i]);
      }
      return summarise(rows, true);
    }

    /* The table: lcs[i][j] is the length of the longest common
       subsequence of a[i..] and b[j..], filled from the end so that
       walking it forwards produces the rows in order. */
    const w = b.length + 1;
    const lcs = new Int32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lcs[i * w + j] = a[i] === b[j]
          ? lcs[(i + 1) * w + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + (j + 1)]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        push('same', head + i + 1, head + j + 1, a[i]);
        i += 1; j += 1;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + (j + 1)]) {
        push('del', head + i + 1, null, a[i]);
        i += 1;
      } else {
        push('add', null, head + j + 1, b[j]);
        j += 1;
      }
    }
    while (i < a.length) { push('del', head + i + 1, null, a[i]); i += 1; }
    while (j < b.length) { push('add', null, head + j + 1, b[j]); j += 1; }

    for (let k = 0; k < tail; k += 1) {
      push('same', A.length - tail + k + 1, B.length - tail + k + 1, A[A.length - tail + k]);
    }
    return summarise(rows, false);
  }

  function summarise(rows, truncated) {
    let added = 0;
    let removed = 0;
    for (const r of rows) {
      if (r.kind === 'add') added += 1;
      else if (r.kind === 'del') removed += 1;
    }
    return {
      rows, added, removed, same: rows.length - added - removed, truncated,
      changed: added > 0 || removed > 0,
    };
  }

  /* ---------------- hunks ----------------

     A diff of a 300-line file with one line changed is 299 rows of
     nothing happening. Unchanged runs longer than 2*context are
     folded into a gap that says how many lines it swallowed. */
  function hunks(result, context = 3) {
    const out = [];
    const rows = result.rows;
    let run = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].kind === 'same') { run += 1; continue; }
      /* A change: keep the last `context` same-rows before it. */
      const keepFrom = Math.max(0, i - Math.min(run, context));
      if (run > context) {
        const skipped = run - context;
        /* Only worth a gap if it hides more than it would cost. */
        if (skipped > context) out.push({ gap: skipped });
        else for (let k = i - run; k < keepFrom; k += 1) out.push(rows[k]);
      }
      for (let k = keepFrom; k <= i; k += 1) out.push(rows[k]);
      run = 0;
    }
    /* The tail after the last change. */
    if (run) {
      const start = rows.length - run;
      const keep = Math.min(run, context);
      for (let k = start; k < start + keep; k += 1) out.push(rows[k]);
      if (run - keep > context) out.push({ gap: run - keep });
    }
    /* Nothing changed at all: say so rather than printing the file. */
    return result.changed ? out : [];
  }

  /* ---------------- whole workspaces ----------------

     Each side is either a packed workspace or a single program. A
     single program is treated as a workspace of one file so that the
     two cases do not need two renderers; `path` is whatever the caller
     calls it.

     Added and deleted files are reported as themselves rather than as
     a file whose every line changed, because "this file is new" and
     "every line of this file is different" are different facts. */
  function workspaces(left, right) {
    const byPath = side => new Map((side || []).map(f => [f.path, String(f.content || '')]));
    const L = byPath(left);
    const R = byPath(right);

    /* Left's order first, then anything only the right side has, so
       the list reads like the workspace rather than alphabetically. */
    const paths = [...L.keys()];
    for (const p of R.keys()) if (!L.has(p)) paths.push(p);

    const files = paths.map((path) => {
      const inL = L.has(path);
      const inR = R.has(path);
      const a = L.get(path) || '';
      const b = R.get(path) || '';
      const state = !inL ? 'added' : !inR ? 'deleted' : (a === b ? 'same' : 'changed');
      return { path, state, diff: state === 'same' ? null : lines(a, b) };
    });

    const changed = files.filter(f => f.state !== 'same');
    return {
      files,
      changed,
      added: changed.reduce((n, f) => n + (f.diff ? f.diff.added : 0), 0),
      removed: changed.reduce((n, f) => n + (f.diff ? f.diff.removed : 0), 0),
      same: files.length - changed.length,
    };
  }

  return { lines, hunks, workspaces, MAX_CELLS };
})();
