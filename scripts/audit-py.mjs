/* Which Python problems can the in-browser interpreter actually run?

   Not a guess, and not a list maintained by hand. Every Python problem's
   own reference solution is run on Pyodide against that problem's own
   visible and hidden cases, exactly as a reader's submission would be. A
   problem is marked browser-capable only if its reference runs and gets
   every case right.

   Python has no compile step and no sanitizer, so there is no equivalent
   of the C++ audit's "this is graded on what ASan says" exclusion. What
   there is instead is the platform: wasm32, sys.platform == 'emscripten',
   a 32-bit sys.maxsize, no processes, no sockets, no threads worth the
   name and the standard library only. A problem whose answer depends on
   any of that fails here and is marked native-only with the difference
   named, rather than being quietly let through.

   The result is written to data/py-support.json, which the site reads at
   run time, and is checked by tests/content.test.mjs so it cannot drift.

   Run: npm run audit:py
        npm run audit:py -- --check   (fail if the committed file is stale)
        npm run audit:py -- --only=count */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'py-support.json');
const CHECK = process.argv.includes('--check');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);

/* The vendored copy, not node_modules: this has to certify the files the
   site actually serves. If they differ, that is the thing worth finding. */
const VENDOR = path.join(ROOT, 'vendor', 'py', 'pyodide');
const { loadPyodide } = await import(
  new URL(`file://${VENDOR.replace(/\\/g, '/')}/pyodide.mjs`).href);

const { HARNESS, RECURSION_LIMIT, RUN_LIMITS, RUNTIME } =
  await import(new URL('../js/py/interpreter.js', import.meta.url).href);

/* ---------------- the problems ---------------- */

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
const problemFiles = fs.readdirSync(path.join(ROOT, 'problems'), { recursive: true })
  .filter(f => String(f).endsWith('.json'));

const findProblem = id => {
  const f = problemFiles.find(x => String(x).endsWith(`${id}.json`));
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'problems', f), 'utf8'));
};
const findSolution = id =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'solutions', `${id}.json`), 'utf8'));

/* Reasons no amount of running would change, checked first so the report
   says why rather than just "failed". */
function disqualify(problem) {
  const pay = problem.payload || {};
  if (pay.requireClean || pay.profile === 'sanitize') {
    return 'This one is graded on a sanitizer, which is a C and C++ tool. '
      + 'Running the Python here would not be the same exercise.';
  }
  if (pay.profile === 'parallel') {
    return 'This one is about threads, and this interpreter is built without '
      + 'them: threading imports, but a thread only runs when the main one '
      + 'lets it.';
  }
  return null;
}

const norm = s => String(s == null ? '' : s)
  .replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');

async function tryProblem(py, run, meta) {
  const problem = findProblem(meta.id);
  const pay = problem.payload || {};
  if (!(pay.langs || []).includes('python')) return { id: meta.id, verdict: 'no-python' };

  const blocked = disqualify(problem);
  if (blocked) return { id: meta.id, verdict: 'native-only', reason: blocked };

  const solution = findSolution(meta.id);
  const reference = (solution.key && solution.key.reference && solution.key.reference.python)
    || null;
  if (!reference) {
    return {
      id: meta.id, verdict: 'native-only',
      reason: 'There is no Python reference solution to check this against, so '
        + 'it cannot be certified for the in-browser interpreter.',
    };
  }

  const cases = [...(pay.cases || []), ...((solution.key && solution.key.cases) || [])];
  if (!cases.length) return { id: meta.id, verdict: 'native-only', reason: 'No test cases.' };

  let failures = 0;
  let firstFailure = null;
  for (const c of cases) {
    const got = run(reference, c.stdin || '', RUN_LIMITS.maxOutput);
    const r = got.toJs ? got.toJs({ dict_converter: Object.fromEntries }) : got;
    if (got.destroy) got.destroy();

    const out = norm(r.stdout);
    const want = norm(c.expect);
    if (r.status !== 0 || out !== want) {
      failures += 1;
      if (!firstFailure) {
        firstFailure = r.status !== 0
          ? `it raised — ${(r.stderr || '').trim().split('\n').pop()}`
          : `output differs (wanted ${JSON.stringify(want.slice(0, 40))}, `
            + `got ${JSON.stringify(out.slice(0, 40))})`;
      }
    }
  }

  if (failures) {
    return {
      id: meta.id, verdict: 'native-only',
      reason: `The reference solution behaves differently on this interpreter: `
        + `${failures} of ${cases.length} cases — ${firstFailure}. That is a real `
        + 'difference between CPython on wasm32 and CPython on your machine, not '
        + 'a problem with your code.',
    };
  }

  return { id: meta.id, verdict: 'browser', cases: cases.length };
}

/* ---------------- go ---------------- */

process.stdout.write('starting the interpreter… ');
const t0 = Date.now();
const py = await loadPyodide({
  indexURL: `${VENDOR.replace(/\\/g, '/')}/`,
  packages: [],
  stdout: () => {},
  stderr: () => {},
});
py.runPython(`import sys\nsys.setrecursionlimit(${RECURSION_LIMIT})`);
py.runPython(HARNESS);
const run = py.globals.get('_run');
console.log(`${Date.now() - t0} ms`);

const platform = py.runPython(
  'import sys; f"{sys.version.split()[0]} on {sys.platform}, '
  + 'sys.maxsize {sys.maxsize.bit_length() + 1}-bit"');
console.log(`${platform}\n`);

const pyProblems = index.filter(p => p.type === 'code' && (p.langs || []).includes('python'))
  .filter(p => !ONLY || p.id.includes(ONLY));

const results = [];
for (const meta of pyProblems) {
  const t = Date.now();
  const r = await tryProblem(py, run, meta);
  results.push(r);
  const mark = r.verdict === 'browser' ? 'ok  ' : '--  ';
  console.log(`${mark}${r.id.padEnd(38)} ${r.verdict === 'browser'
    ? `${r.cases} cases, ${Date.now() - t} ms`
    : (r.reason || '').slice(0, 76)}`);
}

const supported = results.filter(r => r.verdict === 'browser');
const nativeOnly = results.filter(r => r.verdict === 'native-only');

console.log(`\n${supported.length} of ${results.length} Python problems run in the browser.`);
if (nativeOnly.length) console.log(`${nativeOnly.length} need a real Python.`);

const doc = {
  _note: 'GENERATED by scripts/audit-py.mjs. Every entry here was produced by '
    + "running that problem's own reference solution on the vendored Pyodide and "
    + "checking it against that problem's own cases. Do not edit by hand.",
  runtime: { ...RUNTIME, measured: platform },
  generated: results.length,
  browser: supported.map(r => r.id).sort(),
  nativeOnly: Object.fromEntries(
    nativeOnly.map(r => [r.id, r.reason]).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
};

const next = `${JSON.stringify(doc, null, 2)}\n`;

if (CHECK) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== next) {
    console.error('\ndata/py-support.json is out of date. Run: npm run audit:py');
    process.exit(1);
  }
  console.log('\ndata/py-support.json is current.');
} else if (ONLY) {
  console.log('\n(--only given, so data/py-support.json was not written)');
} else {
  fs.writeFileSync(OUT, next);
  console.log(`\nwritten to ${path.relative(ROOT, OUT)}`);
}
