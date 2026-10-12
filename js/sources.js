/* ============================================================
   sources.js — the programs you submitted, kept whole.

   A submission has two halves and they want different storage.

   The **verdict** is forty bytes: when, which language, how many
   cases passed, did it build. It is read on every paint of the
   Submissions tab and it has to be there synchronously, so it
   stays in `localStorage` with the rest of the progress state.

   The **program** is kilobytes, and the store used to cut it at
   6,000 characters and drop the oldest ones at 20,000 per
   problem. That cap was the right answer to the wrong question:
   it was protecting the five-megabyte origin quota, and a quota
   failure does not lose the submissions, it loses the whole
   state file including the XP. But a program cut in half is a
   program you cannot put back in the editor, and "Load this one
   back" is the only reason to keep it at all.

   So programs live in IndexedDB now, one record per problem,
   keyed by the submission's timestamp. They are not truncated.
   The verdict keeps a `bytes` figure and a `stored` flag so the
   list can say what happened without waiting for a read.

   Migration is automatic and lossless in the only direction it
   can be: the truncated text already in `localStorage` is copied
   across on first use and left where it is. Nothing is deleted
   by the migration — a migration that throws away the old copy
   before the new one is proven is how people lose things.
   ============================================================ */

const Sources = (() => {

  const KEY = id => `sources/${id}`;
  const MIGRATED = 'sources/migrated/v1';

  /* Per problem, so reading one problem's history is one record rather
     than one per submission, and so deleting a problem's history is one
     write. Cached because the Submissions tab paints often. */
  const cache = new Map();

  async function bundle(problemId) {
    if (cache.has(problemId)) return cache.get(problemId);
    const got = await Vault.get(KEY(problemId));
    const v = (got && typeof got === 'object') ? got : {};
    cache.set(problemId, v);
    return v;
  }

  /* `at` is the submission's ISO timestamp, which is what the verdict
     carries and what makes the two halves findable from each other. */
  async function put(problemId, at, source) {
    if (typeof source !== 'string' || !source) return { ok: true, skipped: true };
    const b = await bundle(problemId);
    b[at] = source;
    const w = await Vault.set(KEY(problemId), b);
    return w;
  }

  async function get(problemId, at) {
    const b = await bundle(problemId);
    return typeof b[at] === 'string' ? b[at] : null;
  }

  async function drop(problemId, at) {
    const b = await bundle(problemId);
    if (!(at in b)) return false;
    delete b[at];
    await Vault.set(KEY(problemId), b);
    return true;
  }

  /* Submissions the verdict list no longer mentions. Called after the
     store has rolled a problem's list, so the programs behind forgotten
     verdicts do not accumulate for ever.

     A program is only dropped when its verdict is gone, which is the
     policy in one sentence: the store keeps the last ten verdicts per
     problem, and a program is kept for exactly as long as its verdict
     is. Nothing is dropped to save space while its verdict is still
     listed. */
  async function prune(problemId, keepAts) {
    const b = await bundle(problemId);
    const keep = new Set(keepAts);
    let dropped = 0;
    for (const at of Object.keys(b)) {
      if (keep.has(at)) continue;
      delete b[at];
      dropped += 1;
    }
    if (dropped) await Vault.set(KEY(problemId), b);
    return dropped;
  }

  /* ---------------- migration ----------------

     The old store kept up to 6,000 characters of each program inline.
     Those are copied across once, so a reader's existing history keeps
     working and the truncated ones are at least still there. They stay
     marked truncated — copying a cut program does not uncut it, and
     saying otherwise would be worse than the cut. */
  async function migrate(progress) {
    if (await Vault.get(MIGRATED)) return { already: true, moved: 0 };
    let moved = 0;
    let failed = 0;
    for (const [id, r] of Object.entries(progress || {})) {
      const subs = (r && r.subs) || [];
      const mine = subs.filter(x => typeof x.source === 'string' && x.source);
      if (!mine.length) continue;
      const b = await bundle(id);
      for (const x of mine) {
        if (typeof b[x.at] === 'string') continue;
        b[x.at] = x.source;
        moved += 1;
      }
      const w = await Vault.set(KEY(id), b);
      if (!w.ok) failed += 1;
    }
    /* Marked done only if everything that was tried was written. A
       half-migration that calls itself finished is how the rest is
       lost. */
    if (!failed) await Vault.set(MIGRATED, { at: new Date().toISOString(), moved });
    return { already: false, moved, failed };
  }

  /* ---------------- export and import ---------------- */

  async function dump() {
    const out = {};
    for (const k of await Vault.keys()) {
      if (!k.startsWith('sources/') || k === MIGRATED) continue;
      const v = await Vault.get(k);
      if (v && Object.keys(v).length) out[k.slice('sources/'.length)] = v;
    }
    return out;
  }

  async function load(obj) {
    const bad = [];
    for (const [id, map] of Object.entries(obj || {})) {
      const b = await bundle(id);
      Object.assign(b, map);
      const w = await Vault.set(KEY(id), b);
      if (!w.ok) bad.push(id);
    }
    return { written: Object.keys(obj || {}).length - bad.length, failed: bad };
  }

  const forget = () => cache.clear();

  return { put, get, drop, prune, migrate, dump, load, forget, KEY, MIGRATED };
})();
