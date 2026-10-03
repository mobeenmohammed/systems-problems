/* ============================================================
   runners/harness.js — the pure part of running a submission:
   comparing what came out against what was expected, and turning
   a judge's reply into a verdict.

   None of this touches the DOM, the network or a Worker, which is
   why it can be unit-tested in node. The runners are thin shells
   around it, so what gets tested is the part that decides whether
   you were right.
   ============================================================ */

const RunHarness = (() => {

  /* Program output, compared the way a person would: trailing whitespace on a
     line and a missing final newline are forgiven, because no problem here is
     about either. An internal blank line IS significant — a program printing
     an extra blank line between records got the format wrong. */
  const normalize = s => String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n+$/, '');

  const same = (got, want) => normalize(got) === normalize(want);

  /* Where the first difference is, in line and column, so the UI can say
     "line 3" rather than making you diff two blocks by eye. */
  function firstDifference(got, want) {
    const a = normalize(got).split('\n');
    const b = normalize(want).split('\n');
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if (a[i] === b[i]) continue;
      if (a[i] === undefined) return { line: i + 1, reason: 'output ended early' };
      if (b[i] === undefined) return { line: i + 1, reason: 'extra output after the expected end' };
      let col = 0;
      while (col < a[i].length && col < b[i].length && a[i][col] === b[i][col]) col += 1;
      return { line: i + 1, column: col + 1, got: a[i], want: b[i], reason: 'lines differ' };
    }
    return null;
  }

  /* One case's outcome. Separated out so every runner reports the same shape
     and the UI never has to know which backend ran. */
  function judgeCase(result, expect, { requireClean = false } = {}) {
    const out = {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exit: result.exit,
      signal: result.signal || null,
      timedOut: !!result.timedOut,
      ms: result.ms || 0,
      sanitizer: !!result.sanitizer,
      expect,
      pass: false,
      why: '',
    };

    /* The order here is the order a person would read them in: a timeout is
       not a wrong answer, and a crash is not a wrong answer either. Reporting
       all three as "wrong output" is what makes a judge useless to learn from. */
    if (out.timedOut) {
      out.why = 'Timed out — it was still running when the limit was reached.';
      return out;
    }
    if (requireClean && out.sanitizer) {
      out.why = 'The sanitizer reported a problem. The output may be right, but the program is not.';
      return out;
    }
    if (out.signal) {
      out.why = `Killed by ${out.signal}.`;
      return out;
    }
    if (out.exit !== 0) {
      out.why = `Exited with status ${out.exit}.`;
      return out;
    }
    if (!same(out.stdout, expect)) {
      const d = firstDifference(out.stdout, expect);
      out.diff = d;
      out.why = d
        ? (d.reason === 'lines differ'
            ? `Wrong output: line ${d.line} differs.`
            : `Wrong output: ${d.reason} at line ${d.line}.`)
        : 'Wrong output.';
      return out;
    }

    out.pass = true;
    out.why = out.sanitizer ? 'Correct — but the sanitizer had something to say.' : 'Correct.';
    return out;
  }

  /* The whole submission. `cases` pairs each result with what it expected. */
  function judgeRun(reply, expects, { requireClean = false } = {}) {
    const compile = reply.compile || { ok: true, stdout: '', stderr: '', ms: 0 };

    if (!compile.ok) {
      return {
        correct: false,
        score: 0,
        built: false,
        compile,
        cases: [],
        /* A build failure is its own kind of result. Saying "0 of 5 passed"
           when nothing ran would be true and useless. */
        feedback: compile.timedOut
          ? 'The compiler timed out.'
          : 'It did not build. The compiler output is below.',
      };
    }

    const cases = (reply.cases || []).map((r, i) =>
      judgeCase(r, expects[i] === undefined ? '' : expects[i], { requireClean }));

    const passed = cases.filter(c => c.pass).length;
    const total = cases.length || 1;
    const correct = cases.length > 0 && passed === cases.length;

    let feedback;
    if (correct) {
      feedback = `All ${cases.length} ${cases.length === 1 ? 'case' : 'cases'} passed.`;
      if (cases.some(c => c.sanitizer)) feedback += ' The sanitizer still had something to say — worth reading.';
      else if ((compile.stderr || '').trim()) feedback += ' The compiler had warnings — worth reading.';
    } else {
      const first = cases.find(c => !c.pass);
      feedback = `${passed} of ${cases.length} passed. ${first ? first.why : ''}`.trim();
    }

    return {
      correct,
      score: passed / total,
      built: true,
      compile,
      cases,
      passed,
      feedback,
    };
  }

  return { normalize, same, firstDifference, judgeCase, judgeRun };
})();

if (typeof globalThis !== 'undefined') globalThis.RunHarness = RunHarness;
