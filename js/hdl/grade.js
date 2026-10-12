/* ============================================================
   hdl/grade.js — reading what a testbench said.

   Pure functions, no DOM, no simulator. Three callers need
   them and they are in three different module systems, which
   is why this file is written the way it is: an IIFE that
   assigns a global, with no import and no export.

     the page              loads it as an ordinary <script>, like
                           every other file here, and gets
                           `HdlGrade`
     js/hdl/toolchain.js   a module, in a worker and in Node,
                           side-effect-imports it
     scripts/*.mjs         imports it and reads globalThis

   One copy of the grading rules, in all three. A second copy
   is how a grader and an audit come to disagree about what a
   pass is.

   ---------------- the protocol ----------------

   A testbench proves a design works by printing checks:

     CHECK <name> <expected> <actual>
     CHECK <name> <expected> <actual> AT <time>
     DONE <count>

   Three properties follow, and they are the whole reason for a
   format at all rather than reading the output for words:

     · a check is identified by a NAME that comes from the
       problem, not from the output. A grading run missing one
       is incomplete rather than passed, so a design that hangs
       after two of six checks cannot score 2/6 — it scores
       nothing, because DONE never arrived.
     · a check carries both values, so a failure can say what
       was expected, what happened, and at which simulated
       instant.
     · nothing anywhere treats printed text as evidence. A
       design that prints PASS and computes nothing produces no
       CHECK lines and no DONE line, and is graded as exactly
       that.
   ============================================================ */

(() => {
  const CHECK_RE = /^\s*CHECK\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+AT\s+(\d+))?\s*$/;
  const DONE_RE = /^\s*DONE\s+(\d+)\s*$/;

  function parseChecks(output) {
    const checks = [];
    let done = null;
    for (const line of String(output || '').split('\n')) {
      const c = CHECK_RE.exec(line);
      if (c) {
        checks.push({
          name: c[1],
          expect: c[2],
          actual: c[3],
          at: c[4] == null ? null : Number(c[4]),
          pass: c[2] === c[3],
        });
        continue;
      }
      const d = DONE_RE.exec(line);
      if (d) done = Number(d[1]);
    }
    return { checks, done };
  }

  /* Grade a run against the checks the problem says must happen.

     `want` is the list of names from the problem (for a sample run) or
     from the solution key (for a submission). Every one has to appear,
     and pass.

     A run that ends without DONE, or whose DONE count disagrees with
     the checks it printed, is INCOMPLETE — a third outcome, not a
     fraction. Partial credit for a design that hung after two checks
     would be paying for the hang. */
  function gradeChecks(output, want = [], { finished = true } = {}) {
    const { checks, done } = parseChecks(output);
    const byName = new Map();
    for (const c of checks) byName.set(c.name, c);

    const rows = want.map(name => {
      const got = byName.get(name);
      return got
        ? { ...got, missing: false }
        : { name, expect: null, actual: null, at: null, pass: false, missing: true };
    });

    const missing = rows.filter(r => r.missing);
    const failed = rows.filter(r => !r.missing && !r.pass);
    const passed = rows.filter(r => r.pass).length;

    let incomplete = null;
    if (!finished) incomplete = 'the simulation was stopped before it ended';
    else if (done == null) {
      incomplete = missing.length === want.length
        ? 'the grading testbench printed no results at all'
        : 'the simulation ended before the testbench finished';
    } else if (done !== checks.length) {
      incomplete = `the testbench reported ${done} checks and printed ${checks.length}`;
    } else if (missing.length) {
      incomplete = `${missing.length} of ${want.length} checks never ran`;
    }

    return {
      rows,
      passed,
      total: want.length,
      correct: !incomplete && !failed.length && passed === want.length,
      incomplete,
      firstFailure: failed[0] || missing[0] || null,
      score: want.length ? passed / want.length : 0,
    };
  }

  /* vvp refusing to start, as opposed to a wrong answer.

     A design can be entirely correct and still not run here, because
     this build of Icarus does not have every system task: `$isunknown`
     is one it lacks, and the refusal arrives at run time as "System
     task/function $isunknown() is not defined by any module" followed
     by "Program not runnable". Grading that as a wrong answer would be
     blaming the reader for the toolchain, so the caller reports it as
     ungraded with a retry path instead. */
  function toolchainLimit(output) {
    const text = String(output || '');
    const m = /System task\/function (\$\w+)\(\) is not defined/.exec(text);
    if (m) return `${m[1]} is not available in this build of the simulator`;
    if (/Program not runnable/.test(text)) return 'the simulator refused to start the program';
    return null;
  }

  globalThis.HdlGrade = { parseChecks, gradeChecks, toolchainLimit };
})();
