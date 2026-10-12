/* ============================================================
   attempts.js — assessment attempts, and the clock.

   An attempt is a separate thing from practice progress. It has
   its own storage, it does not touch XP, streaks or a problem's
   solved status, and a retake is a new attempt rather than an
   edit of the old one.

   The clock is the part worth reading. It is a **deadline**, an
   absolute instant written down when the attempt starts — not a
   counter that is decremented. A counter stops in a background
   tab, because browsers throttle timers there to once a minute
   or stop them altogether, so a counter-based timer hands back
   minutes to anybody who switches tabs, and loses the attempt
   entirely on a reload. Everything here asks "what time is it,
   and what time was the deadline".

   The honest limits, said here and on the page rather than
   implied:

     · this is a personal practice mode, not a proctored exam.
       The deadline is in this browser's storage and the hidden
       cases are in a file this browser downloaded. Both can be
       edited by anybody who wants to. Nothing here pretends
       otherwise, and nothing here watches the reader to make
       up for it.
     · the clock is the device's clock. Changing it changes the
       deadline, which is the same bargain as every offline
       timer.
   ============================================================ */

const Attempts = (() => {

  const KEY = 'attempts/v1';

  /* Loaded once into memory and written through, because the attempt
     page reads this on every tick and IndexedDB is asynchronous. The
     write is awaited by the callers that must not lose it. */
  let cache = null;
  let loading = null;

  const now = () => Date.now();
  const iso = t => new Date(t).toISOString();

  function blank() {
    return { version: 1, attempts: [] };
  }

  async function load() {
    if (cache) return cache;
    if (loading) return loading;
    loading = (async () => {
      const got = await Vault.get(KEY);
      cache = (got && Array.isArray(got.attempts)) ? got : blank();
      return cache;
    })().finally(() => { loading = null; });
    return loading;
  }

  async function save() {
    if (!cache) return { ok: false };
    return Vault.set(KEY, cache);
  }

  const uid = () => `a${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  /* ---------------- reading ---------------- */

  const all = async () => (await load()).attempts.slice().reverse();

  async function get(id) {
    const s = await load();
    return s.attempts.find(a => a.id === id) || null;
  }

  async function forAssessment(assessmentId) {
    const s = await load();
    return s.attempts.filter(a => a.assessmentId === assessmentId).reverse();
  }

  /* The one in progress, if there is one. At most one at a time: two
     clocks running at once is a mode nobody can be in, and offering it
     would mean a reader losing one of them without noticing. */
  async function running() {
    const s = await load();
    return s.attempts.find(a => a.state === 'running') || null;
  }

  /* ---------------- the clock ----------------

     Every question about time is answered from the deadline. `left` can
     be negative, and the caller is expected to notice rather than being
     handed a clamped zero that looks like "just finished". */
  function msLeft(a, at = now()) {
    if (!a || !a.deadlineAt) return null;
    return Date.parse(a.deadlineAt) - at;
  }

  const isExpired = (a, at = now()) =>
    !!a && a.state === 'running' && a.deadlineAt != null && msLeft(a, at) <= 0;

  /* ---------------- starting ---------------- */

  async function start(def, { langs = {} } = {}) {
    const s = await load();

    /* An attempt already running is the reader's, and silently
       replacing it would throw away work. The caller decides; this
       reports. */
    const live = s.attempts.find(a => a.state === 'running');
    if (live) return { ok: false, reason: 'running', attempt: live };

    const startedAt = now();
    const attempt = {
      id: uid(),
      assessmentId: def.id,
      /* The version it was taken under. An assessment edited afterwards
         must not re-score an attempt against rules it was not sat
         under, and a result that cannot say which rules it used is not
         a result. */
      version: def.version,
      title: def.title,
      startedAt: iso(startedAt),
      deadlineAt: def.durationMin ? iso(startedAt + def.durationMin * 60_000) : null,
      durationMin: def.durationMin,
      timed: !!def.durationMin,
      state: 'running',
      finishedAt: null,
      /* Which attempt of this assessment this is, counted at the time
         so a deleted attempt cannot renumber the others. */
      ordinal: s.attempts.filter(a => a.assessmentId === def.id).length + 1,
      problems: def.problems.slice(),
      langs: { ...langs },
      /* Per problem: what was given, and what the grader said. */
      answers: {},
      /* Per problem, per language: the editor's contents. Whole, not
         truncated — a program cut to 6,000 characters is a program you
         cannot put back in the editor. */
      drafts: {},
      results: null,
      score: null,
    };
    s.attempts.push(attempt);
    const w = await save();
    return { ok: true, attempt, stored: w };
  }

  /* ---------------- during ---------------- */

  /* Returns what the write did, not merely that it was attempted. A
     draft that could not be stored is work about to be lost, and the
     only acceptable behaviour is to say so on screen — see the Saved /
     Saving / Save failed indicator in the assessment bar. */
  async function saveDraft(attemptId, problemId, lang, source) {
    const a = await get(attemptId);
    if (!a || a.state !== 'running') return { ok: false, reason: 'not running' };
    a.drafts[problemId] = a.drafts[problemId] || {};
    a.drafts[problemId][lang || '_'] = String(source == null ? '' : source);
    a.touchedAt = iso(now());
    const w = await save();
    return { ok: !!(w && w.ok !== false), write: w };
  }

  const draft = async (attemptId, problemId, lang) => {
    const a = await get(attemptId);
    return (a && a.drafts[problemId] && a.drafts[problemId][lang || '_']) || null;
  };

  /* What the reader has put down for a problem. `graded` is whatever the
     problem type's own grader returned, so an assessment never has a
     second opinion about what is right. */
  async function record(attemptId, problemId, entry) {
    const a = await get(attemptId);
    if (!a || a.state !== 'running') return false;
    const was = a.answers[problemId] || {};
    a.answers[problemId] = {
      ...was,
      ...entry,
      at: iso(now()),
      /* How many times this problem was submitted inside the attempt.
         Not a penalty — a fact for the review afterwards. */
      submits: (was.submits || 0) + (entry.submitted ? 1 : 0),
    };
    a.touchedAt = iso(now());
    await save();
    return true;
  }

  const answer = async (attemptId, problemId) => {
    const a = await get(attemptId);
    return (a && a.answers[problemId]) || null;
  };

  /* Three states per problem for the navigator, and they are three
     different things: nothing written, something written, something
     submitted. */
  function statusOf(a, problemId) {
    const ans = (a.answers || {})[problemId];
    if (ans && ans.submitted) return 'submitted';
    const d = (a.drafts || {})[problemId];
    const written = ans && ans.response != null;
    if (written || (d && Object.values(d).some(x => String(x).trim()))) return 'attempted';
    return 'unanswered';
  }

  /* ---------------- finishing ----------------

     Once. An attempt that is finished twice would be scored twice, and
     with a deadline firing in one tab while a Finish button is pressed
     in another that is a real race rather than a theoretical one. The
     state check is the guard and it is inside the same read-modify-write
     as the scoring. */
  async function finish(attemptId, def, { reason = 'finished' } = {}) {
    const a = await get(attemptId);
    if (!a) return null;
    if (a.state !== 'running') return a;   /* already finalised; idempotent */

    a.state = reason === 'expired' ? 'expired' : 'finished';
    a.finishedAt = iso(now());
    a.endedBecause = reason;
    a.results = score(a, def);
    a.score = a.results.total;
    await save();
    return a;
  }

  /* ---------------- scoring ----------------

     Weighted, with the weights from the definition. A problem's own
     grader produced the fraction; this only multiplies and adds. Three
     outcomes are kept apart because they mean different things and
     averaging them together would hide the one that is not the
     reader's fault:

       graded     the grader looked and said
       unanswered nothing was submitted
       errored    execution failed — no runner, a timeout on the
                  service rather than on the program, a backend that
                  threw. NOT counted as wrong, and not counted in the
                  total either, because nobody ever found out.
       review     a written proof. Nothing here marks one, and a
                  keyword search is not a reading, so it is held out
                  of the automatic total until the reader has read it
                  against the rubric themselves. A self-mark is
                  reported beside the automatic score and never
                  folded into it: they are different kinds of
                  evidence and adding them together would make the
                  automatic one a claim it cannot support. */
  function score(a, def) {
    const weights = (def && def.scoring && def.scoring.weights) || {};
    const partial = !(def && def.scoring && def.scoring.partialCredit === false);
    const rows = [];
    let earned = 0;
    let possible = 0;
    let ungraded = 0;

    for (const pid of a.problems) {
      const w = Number(weights[pid] != null ? weights[pid] : 1) || 0;
      const ans = (a.answers || {})[pid];
      const row = { id: pid, weight: w };

      if (ans && ans.errored) {
        row.outcome = 'errored';
        row.why = ans.errorWhy || 'execution failed';
        row.fraction = null;
        ungraded += w;
      } else if (ans && ans.selfReview) {
        row.outcome = 'review';
        row.why = 'a written proof — nothing here marks one';
        row.fraction = null;
        row.words = ans.words || null;
        /* A self-mark, if the reader has made one since. Carried on the
           row so the review page can show it; never added to `earned`. */
        row.selfMark = ans.selfMark || null;
        ungraded += w;
      } else if (!ans || !ans.submitted) {
        row.outcome = 'unanswered';
        row.fraction = 0;
        possible += w;
      } else {
        const f = Math.max(0, Math.min(1, Number(ans.fraction) || 0));
        const credited = partial ? f : (f >= 1 ? 1 : 0);
        row.outcome = f >= 1 ? 'right' : credited > 0 ? 'partial' : 'wrong';
        row.fraction = credited;
        earned += w * credited;
        possible += w;
      }
      rows.push(row);
    }

    const total = possible > 0 ? earned / possible : null;
    const passMark = def && def.scoring ? def.scoring.passMark : null;
    return {
      rows,
      earned: Math.round(earned * 100) / 100,
      possible,
      ungraded,
      total,
      /* No verdict when something never ran. A pass computed over the
         problems that happened to work is not a pass. */
      passed: (total == null || ungraded > 0 || passMark == null)
        ? null
        : total >= passMark,
      passMark,
      elapsedMs: Date.parse(a.finishedAt || iso(now())) - Date.parse(a.startedAt),
    };
  }

  /* Grading one answer of a FINISHED attempt, after an execution
     failure.

     The other write allowed on a finalised attempt, and allowed for the
     same reason as the self-mark: the answer is frozen. What is recorded
     here is the grader's verdict on the submission that was already
     made — the reader cannot edit anything, cannot add an answer to a
     question they left blank, and cannot change one they got wrong.
     Only a row whose outcome was `errored` can be resolved, which is
     the whole guard.

     The attempt is then re-scored, because the score it was given was
     computed with this row held out of the total. */
  async function resolve(attemptId, def, problemId, entry) {
    const a = await get(attemptId);
    if (!a) return { ok: false, why: 'no such attempt' };
    const was = a.answers[problemId];
    if (!was || !was.errored) return { ok: false, why: 'that answer was not ungraded' };

    a.answers[problemId] = {
      ...was,
      ...entry,
      errored: false,
      errorWhy: null,
      /* What happened, and when, kept so the review can say the result
         was obtained after the attempt rather than during it. */
      resolvedAt: iso(now()),
    };
    a.results = score(a, def);
    a.score = a.results.total;
    await save();
    return { ok: true, attempt: a };
  }

  /* A written proof, marked by the reader after the clock has stopped.

     The one write allowed on a finalised attempt, and it is allowed
     because it is not an answer: the proof itself is frozen and cannot
     be edited, and this records a judgement about it. It is kept on its
     own, outside `score.total`, for the reason the scoring doc gives —
     a self-mark and a grader's mark are different kinds of evidence. */
  async function selfMark(attemptId, problemId, mark) {
    const a = await get(attemptId);
    if (!a) return false;
    const ans = (a.answers || {})[problemId];
    if (!ans || !ans.selfReview) return false;
    if (mark == null) delete ans.selfMark;
    else ans.selfMark = { verdict: String(mark), at: iso(now()) };
    /* The stored rows carry it too, so the review page does not have to
       re-score a finished attempt to show it. */
    if (a.results && Array.isArray(a.results.rows)) {
      const row = a.results.rows.find(r => r.id === problemId);
      if (row) row.selfMark = ans.selfMark || null;
    }
    await save();
    return true;
  }

  /* ---------------- housekeeping ---------------- */

  async function remove(id) {
    const s = await load();
    const at = s.attempts.findIndex(a => a.id === id);
    if (at < 0) return false;
    s.attempts.splice(at, 1);
    await save();
    return true;
  }

  async function clear() {
    cache = blank();
    await save();
  }

  return {
    all, get, forAssessment, running, start, finish, remove, clear,
    saveDraft, draft, record, answer, statusOf, selfMark, resolve,
    msLeft, isExpired, score,
    KEY,
    /* Exposed so a test can drive the store without a page. */
    _reset: () => { cache = null; },
  };
})();
