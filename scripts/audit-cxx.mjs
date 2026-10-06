/* Which C++ problems can the browser toolchain actually run?

   Not a guess, and not a list maintained by hand. Every C++ problem's own
   reference solution is compiled with the browser toolchain and run against
   that problem's own visible and hidden cases, exactly as a reader's
   submission would be. A problem is marked browser-capable only if its
   reference builds, runs and gets every case right.

   Two classes of problem are excluded before a compiler is involved,
   because for them a pass would be the wrong answer:

     · anything on the `sanitize` profile or requiring a clean run. There is
       no ASan for wasm32-wasi, and worse, the undefined behaviour those
       problems are *about* does not even trap here — reading past the end
       of a vector returns rubbish instead of crashing. Letting such a
       problem run in the browser would delete its entire lesson.

     · anything whose answer depends on x86-64 integer or pointer sizes.
       This target is wasm32: long, void* and size_t are four bytes.

   The result is written to data/cxx-support.json, which the site reads at
   run time, and the file is checked by tests/content.test.mjs so it cannot
   drift from the problems.

   Run: npm run audit:cxx
        npm run audit:cxx -- --check   (fail if the committed file is stale) */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'cxx');
const OUT = path.join(ROOT, 'data', 'cxx-support.json');
const CHECK = process.argv.includes('--check');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);

/* Node's fetch has no file: scheme, and the toolchain module fetches its
   assets by URL because that is what it does in a browser. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const s = String(u && u.url ? u.url : u);
  if (s.startsWith('file:')) {
    const clean = s.split('?')[0];
    return new Response(await fsp.readFile(fileURLToPath(clean)));
  }
  return realFetch(u, o);
};

const { Toolchain, BROWSER_FLAGS, runCase, TOOLCHAIN } =
  await import(new URL('../js/cxx/toolchain.js', import.meta.url).href);
const { default: Clang } = await import(new URL(`file://${VENDOR}/browsercc/clang.js`).href);
const { default: LLD } = await import(new URL(`file://${VENDOR}/browsercc/lld.js`).href);
const wasiMod = await import(new URL(`file://${VENDOR}/wasi/index.js`).href);

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

/* Reasons a problem is native-only that no amount of compiling would
   change. Checked first so the report says *why*, not just "failed". */
function disqualify(problem) {
  const pay = problem.payload || {};
  if (pay.requireClean || pay.profile === 'sanitize') {
    return 'This one is graded on what AddressSanitizer says, and there is no '
      + 'sanitizer for WebAssembly. Worse, the mistake it is about does not even '
      + 'crash here — wasm linear memory starts at address zero and reading past '
      + 'an array quietly returns rubbish. Running it in the browser would hide '
      + 'the entire point of the exercise.';
  }
  if (pay.profile === 'parallel') {
    return 'This one is built with OpenMP and threads, which this target does not have.';
  }
  if (pay.profile && pay.profile !== 'standard') {
    return `This one is built with the "${pay.profile}" profile, which the browser `
      + 'toolchain cannot reproduce. Compiler flags are never quietly relaxed to '
      + 'make a problem fit.';
  }
  return null;
}

/* ---------------- run one problem through the browser toolchain ---------------- */

async function tryProblem(tc, meta) {
  const problem = findProblem(meta.id);
  const pay = problem.payload || {};
  if (!(pay.langs || []).includes('cpp')) return { id: meta.id, verdict: 'no-cpp' };

  const blocked = disqualify(problem);
  if (blocked) return { id: meta.id, verdict: 'native-only', reason: blocked };

  const solution = findSolution(meta.id);
  const reference = (solution.key && solution.key.reference && solution.key.reference.cpp) || null;
  if (!reference) {
    return {
      id: meta.id, verdict: 'native-only',
      reason: 'There is no C++ reference solution to check this against, so it '
        + 'cannot be certified for the browser toolchain.',
    };
  }

  const cases = [...(pay.cases || []), ...((solution.key && solution.key.cases) || [])];
  if (!cases.length) return { id: meta.id, verdict: 'native-only', reason: 'No test cases.' };

  const built = await tc.compile(reference, BROWSER_FLAGS);
  if (!built.ok) {
    const first = built.stderr.split('\n').find(l => /error:/.test(l)) || '';
    return {
      id: meta.id, verdict: 'native-only',
      reason: 'The reference solution does not compile for WebAssembly'
        + `${first ? `: ${first.replace(/^main\.cpp:\d+:\d+:\s*/, '').trim()}` : '.'}`,
      detail: built.stderr.trim().split('\n').slice(0, 6).join('\n'),
    };
  }

  const norm = s => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  let failures = 0;
  let firstFailure = null;
  for (const c of cases) {
    const r = await runCase(built.module, c.stdin || '', wasiMod);
    const got = norm(r.stdout);
    const want = norm(c.expect == null ? '' : c.expect);
    if (r.exit !== 0 || got !== want) {
      failures += 1;
      if (!firstFailure) {
        firstFailure = r.exit !== 0
          ? `exit ${r.exit}${r.crash ? ` (${r.crash})` : ''}`
          : `output differs (wanted ${JSON.stringify(want.slice(0, 40))}, got ${JSON.stringify(got.slice(0, 40))})`;
      }
    }
  }

  if (failures) {
    return {
      id: meta.id, verdict: 'native-only',
      reason: `The reference solution compiles for WebAssembly but ${failures} of `
        + `${cases.length} cases behave differently there — ${firstFailure}. That is a `
        + 'real difference between the two platforms, not a problem with your code.',
    };
  }

  return {
    id: meta.id, verdict: 'browser',
    cases: cases.length,
    warnings: (built.stderr.match(/warning:/g) || []).length,
  };
}

/* ---------------- go ---------------- */

const tc = new Toolchain({
  baseUrl: new URL(`file://${VENDOR.replace(/\\/g, '/')}/`).href,
  Clang, LLD,
});

process.stdout.write('loading the toolchain… ');
const t0 = Date.now();
await tc.init();
console.log(`${Date.now() - t0} ms`);
console.log(`${TOOLCHAIN.compiler}, ${TOOLCHAIN.target}, ${TOOLCHAIN.flags}\n`);

const cppProblems = index.filter(p => p.type === 'code' && (p.langs || []).includes('cpp'))
  .filter(p => !ONLY || p.id.includes(ONLY));

const results = [];
for (const meta of cppProblems) {
  const t = Date.now();
  const r = await tryProblem(tc, meta);
  results.push(r);
  const mark = r.verdict === 'browser' ? 'ok  ' : '--  ';
  console.log(`${mark}${r.id.padEnd(38)} ${r.verdict === 'browser'
    ? `${r.cases} cases, ${Date.now() - t} ms`
    : (r.reason || '').slice(0, 72)}`);
  if (r.detail) console.log(`      ${r.detail.split('\n').join('\n      ')}`);
}

const supported = results.filter(r => r.verdict === 'browser');
const nativeOnly = results.filter(r => r.verdict === 'native-only');

console.log(`\n${supported.length} of ${results.length} C++ problems run in the browser.`);
console.log(`${nativeOnly.length} need the native toolchain.`);

const doc = {
  _note: 'GENERATED by scripts/audit-cxx.mjs. Every entry here was produced by '
    + 'compiling that problem\'s own reference solution with the browser toolchain '
    + 'and running it against that problem\'s own cases. Do not edit by hand.',
  toolchain: TOOLCHAIN,
  generated: results.length,
  browser: supported.map(r => r.id).sort(),
  nativeOnly: Object.fromEntries(nativeOnly.map(r => [r.id, r.reason]).sort((a, b) => a[0] < b[0] ? -1 : 1)),
};

const next = `${JSON.stringify(doc, null, 2)}\n`;

if (CHECK) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== next) {
    console.error('\ndata/cxx-support.json is out of date. Run: npm run audit:cxx');
    process.exit(1);
  }
  console.log('\ndata/cxx-support.json is current.');
} else if (ONLY) {
  console.log('\n(--only given, so data/cxx-support.json was not written)');
} else {
  fs.writeFileSync(OUT, next);
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
}
