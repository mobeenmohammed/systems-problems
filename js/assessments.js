/* ============================================================
   assessments.js — the definitions and the separate problem
   pool they draw from.

   Two files, loaded lazily the first time somebody goes to
   #/assess, because nobody browsing the catalogue should pay
   for them:

     data/assessments.json        the definitions
     data/assessment-index.json   metadata for the pool

   The pool is registered into the catalogue's id lookup but
   NOT into its list. That is the whole trick, and it is worth
   stating plainly: `Catalog.get(id)` and `Catalog.meta(id)`
   work for an assessment problem, so the ordinary problem page
   renders one with no changes at all; `Catalog.all()` does not
   contain it, so the catalogue cannot list it, no filter can
   reach it, and every count on the site stays a count of the
   practice catalogue.
   ============================================================ */

const Assessments = (() => {

  let defs = [];
  let pool = [];
  let loaded = null;
  let error = null;

  function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const [a, p] = await Promise.all([
        fetch('data/assessments.json', { cache: 'no-cache' })
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch('data/assessment-index.json', { cache: 'no-cache' })
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!a || !Array.isArray(a.assessments)) {
        error = 'data/assessments.json could not be read';
        defs = [];
      } else {
        defs = a.assessments;
      }
      pool = Array.isArray(p) ? p : [];
      /* Into the id lookup only. See the note at the top. */
      if (pool.length) Catalog.registerPool(pool);
      return { defs, pool, error };
    })();
    return loaded;
  }

  const all = () => defs;
  const byId = id => defs.find(d => d.id === id) || null;
  const inPool = id => pool.some(p => p.id === id);

  /* Which languages a problem may be written in *inside this
     assessment*: the definition's list if it names one, otherwise
     whatever the problem itself offers. Never more than the problem
     offers — an assessment cannot invent a language. */
  function langsFor(def, problemId) {
    const meta = Catalog.meta(problemId) || {};
    const offered = meta.langs || [];
    const want = (def.langs || {})[problemId];
    if (!want || !want.length) return offered;
    return want.filter(l => offered.includes(l));
  }

  /* Everything a reader is owed before the clock starts, in one object
     so the pre-flight card cannot disagree with the attempt. */
  function brief(def) {
    const problems = def.problems.map(id => ({
      id,
      meta: Catalog.meta(id) || null,
      langs: langsFor(def, id),
      weight: Number(((def.scoring || {}).weights || {})[id] ?? 1),
    }));
    const weights = problems.reduce((n, p) => n + p.weight, 0);
    return {
      problems,
      count: problems.length,
      missing: problems.filter(p => !p.meta).map(p => p.id),
      weights,
      langs: [...new Set(problems.flatMap(p => p.langs))],
      code: problems.filter(p => p.meta && p.meta.type === 'code').length,
      timed: !!def.durationMin,
      scoring: def.scoring || {},
      feedback: def.feedback || {},
    };
  }

  /* Whether this device can run everything the assessment needs, asked
     BEFORE the clock starts rather than discovered at problem three
     with eleven minutes left. */
  async function readiness(def) {
    const b = brief(def);
    const rows = [];
    for (const p of b.problems) {
      if (!p.meta || p.meta.type !== 'code') continue;
      /* eslint-disable-next-line no-await-in-loop -- a handful of
         problems, and the answers are cached by the runners. */
      const avail = await Runners.available(p.langs, p.id);
      rows.push({
        id: p.id,
        title: (p.meta || {}).title || p.id,
        langs: avail,
        ready: avail.some(r => r.ready),
      });
    }
    return {
      rows,
      ready: rows.every(r => r.ready),
      /* Which toolchains would have to come down, so the download can
         happen before the clock rather than inside it. */
      engines: [...new Set(rows.flatMap(r => r.langs)
        .filter(l => l.ready && /^browser/.test(l.backend || ''))
        .map(l => l.backend))],
    };
  }

  /* Pull the toolchains down now. Returns what it prepared, so the
     pre-flight can say "ready" with something behind the word. */
  async function warmUp(def, onProgress = null) {
    const r = await readiness(def);
    const jobs = [];
    const engines = {
      browsercpp: typeof BrowserCpp !== 'undefined' ? BrowserCpp : null,
      browserpy: typeof BrowserPy !== 'undefined' ? BrowserPy : null,
      browserrust: typeof BrowserRust !== 'undefined' ? BrowserRust : null,
    };
    for (const name of r.engines) {
      const e = engines[name];
      if (!e || e.ready) continue;
      if (onProgress) e.onProgress(p => onProgress({ engine: name, ...p }));
      jobs.push(e.prepare().catch(err => ({ engine: name, error: err.message })));
    }
    const out = await Promise.all(jobs);
    return { prepared: r.engines, failures: out.filter(Boolean) };
  }

  /* ---------------- grading a frozen answer again ----------------

     An execution failure is not a wrong answer, so the attempt records
     it as ungraded and refuses to produce a pass verdict while one is
     present. That is honest, and on its own it is a dead end: the
     reader is told the service failed and given nothing to do about it.

     This is the something to do. It takes the submission that was
     already made — the program, byte for byte, or the answer object —
     runs the problem's own grader over it again, and records the
     result against the attempt.

     What it cannot do is let anybody answer a question after the
     deadline. It reads the stored submission and never the editor; it
     refuses any row that is not `errored`; and the attempt's own
     `resolve` refuses as well. The answer is frozen and this grades
     the frozen thing. */
  async function regrade(attemptId, problemId) {
    const a = await Attempts.get(attemptId);
    if (!a) return { graded: false, why: 'no such attempt' };
    const ans = (a.answers || {})[problemId];
    if (!ans) return { graded: false, why: 'nothing was submitted for it' };
    if (!ans.errored) return { graded: false, why: 'that answer has already been graded' };

    const def = byId(a.assessmentId);
    const problem = await Catalog.get(problemId);
    const solution = await Catalog.solution(problemId);
    if (!problem || !solution) return { graded: false, why: 'the problem could not be loaded' };

    const impl = ProblemTypes.get(problem.type);
    if (!impl) return { graded: false, why: `nothing can grade a "${problem.type}"` };

    /* The frozen submission, in the shape its own grader takes. */
    const response = problem.type === 'code'
      ? (ans.source ? { lang: ans.lang, source: ans.source } : null)
      : ans.response;
    if (response == null) {
      return { graded: false, why: 'the submission itself was not stored, so there is '
        + 'nothing to grade again' };
    }

    let result;
    try {
      result = await impl.grade(response, solution.key, problem, solution);
    } catch (err) {
      return { graded: false, why: (err && err.message) || String(err) };
    }

    /* Still nothing. The row stays ungraded and the answer stays where
       it is — a second failure must not turn into a zero. */
    if (result.noAttempt) return { graded: false, why: result.feedback || 'still could not run' };

    const w = await Attempts.resolve(attemptId, def, problemId, {
      submitted: true,
      correct: !!result.correct,
      fraction: typeof result.score === 'number' ? result.score : (result.correct ? 1 : 0),
      lang: result.lang || ans.lang || null,
      passedCases: result.passed != null ? result.passed : null,
      totalCases: result.total != null ? result.total : null,
    });
    if (!w.ok) return { graded: false, why: w.why };
    return { graded: true, attempt: w.attempt, result };
  }

  return {
    load, all, byId, inPool, langsFor, brief, readiness, warmUp, regrade,
    get error() { return error; },
    get pool() { return pool; },
  };
})();
