/* Which Rust problems can the browser toolchain actually run?

   Not a guess, and not a list maintained by hand. Every Rust problem's own
   reference solution is compiled with the in-browser rustc and run against
   that problem's own visible and hidden cases, exactly as a reader's
   submission would be. A problem is marked browser-capable only if its
   reference builds, runs and gets every case right.

   The compiler is a real rustc with the Cranelift backend, built to
   WebAssembly (AngelOnFira/weblings, MIT). It is a real rustc: the borrow
   checker, the trait solver and the diagnostics are the ones from the
   release. What is not complete is the Cranelift → wasm lowering, and the
   gap that matters here is narrow and specific:

     parse::<i64>() and parse::<u64>() do not compile.

   `core::num::from_ascii_radix` lowers a `smulhi.i64`, and that opcode is
   not implemented for i64 in this backend. 64-bit arithmetic is fine;
   printing an i64 is fine; i32, u32, usize and f64 all parse. It is
   reading a 64-bit integer out of a string, and nothing else, and it is
   reported as such rather than as "it failed".

   Three classes are excluded before a compiler is involved:

     · anything graded on a sanitizer. There is no sanitizer for wasm32,
       and the undefined behaviour those problems are *about* does not
       trap here either.
     · anything whose answer depends on 64-bit pointers. This target is
       wasm32: usize is four bytes.
     · anything with no Rust reference solution to check against.

   Two questions are asked of every problem, and they are different
   questions with different answers:

     checks   does the reference solution pass rustc's front end — the
              parser, the type checker, the trait solver and the borrow
              checker? This is `--emit=metadata`, which stops before
              code generation, so it is unaffected by every gap in the
              Cranelift → wasm lowering. It is also what the editor
              does on every keystroke, so this column is the one that
              says whether a reader gets real E0382 / E0502 / E0621
              diagnostics in the browser.

     runs     does it then generate wasm, link, execute, and get every
              case right?

   Reporting one number for both would be wrong in whichever direction
   it rounded: "Rust works on 2 of 7" hides that the borrow checker is
   available on all of them, and "Rust works on 7 of 7" would be a lie
   about running code. So both are written down, per problem.

   The result is written to data/rust-support.json, which the site reads at
   run time, and the file is checked by tests/content.test.mjs so it cannot
   drift from the problems.

   Run: npm run audit:rust
        npm run audit:rust -- --check   (fail if the committed file is stale)
        npm run audit:rust -- --only=slices */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'rust');
const OUT = path.join(ROOT, 'data', 'rust-support.json');
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

const { Toolchain, TOOLCHAIN } =
  await import(new URL('../js/rust/toolchain.js', import.meta.url).href);
const wasiMod = await import(new URL(`file://${VENDOR.replace(/\\/g, '/')}/../cxx/wasi/index.js`).href);
const { runCase } = await import(new URL('../js/cxx/toolchain.js', import.meta.url).href);

/* ---------------- the problems ---------------- */

/* Both pools. An assessment problem is a problem that has to run, and
   nothing about its being in the timed bank changes which toolchain can
   build it — so it is certified here exactly like a practice one. */
const index = ['data/index.json', 'data/assessment-index.json']
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')));
const problemFiles = fs.readdirSync(path.join(ROOT, 'problems'), { recursive: true })
  .filter(f => String(f).endsWith('.json'));

const findProblem = id => {
  const f = problemFiles.find(x => String(x).endsWith(`${id}.json`));
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'problems', f), 'utf8'));
};
const findSolution = id =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'solutions', `${id}.json`), 'utf8'));

function disqualify(problem) {
  const pay = problem.payload || {};
  if (pay.requireClean || pay.profile === 'sanitize') {
    return 'This one is graded on what a sanitizer says, and there is no sanitizer '
      + 'for WebAssembly. Worse, the mistake it is about does not even crash here — '
      + 'wasm linear memory starts at address zero and reading past an array quietly '
      + 'returns rubbish. Running it in the browser would hide the point of the '
      + 'exercise.';
  }
  if (pay.profile === 'parallel') {
    return 'This one is about threads, and this target has none.';
  }
  if (pay.profile && pay.profile !== 'standard') {
    return `This one is built with the "${pay.profile}" profile, which the browser `
      + 'toolchain cannot reproduce. Compiler flags are never quietly relaxed to '
      + 'make a problem fit.';
  }
  return null;
}

/* The one known gap, recognised so the report says what it is rather than
   quoting an internal Cranelift opcode at somebody. */
const SMULHI = /unimplemented binary opcode smulhi on i64/;

function explain(stderr) {
  if (SMULHI.test(stderr)) {
    return 'The reference solution reads a 64-bit integer out of a string, and '
      + '`parse::<i64>()` does not compile with this backend: the Cranelift → '
      + 'WebAssembly lowering has no `smulhi` for i64, which is what '
      + '`core::num::from_ascii_radix` needs. 64-bit arithmetic and printing are '
      + 'both fine — it is reading a 64-bit integer out of a string, and nothing '
      + 'else. The exercise itself is unchanged; the gap is in the WebAssembly '
      + 'backend of the compiler, not in the exercise.';
  }
  const first = stderr.split('\n').find(l => /^error/.test(l)) || '';
  return 'The reference solution does not compile for WebAssembly'
    + `${first ? `: ${first.trim()}` : '.'}`;
}

async function tryProblem(tc, meta) {
  const problem = findProblem(meta.id);
  const pay = problem.payload || {};
  if (!(pay.langs || []).includes('rust')) return { id: meta.id, verdict: 'no-rust' };

  const solution = findSolution(meta.id);
  const reference = (solution.key && solution.key.reference && solution.key.reference.rust) || null;
  if (!reference) {
    return {
      id: meta.id, verdict: 'native-only',
      reason: 'There is no Rust reference solution to check this against, so it '
        + 'cannot be certified for the browser toolchain.',
    };
  }

  /* Disqualified from *running* — a sanitizer profile, threads — but
     its front end is still rustc's, so the check column is measured
     anyway rather than assumed. */
  const blocked = disqualify(problem);
  if (blocked) {
    const only = await tc.check(reference);
    return { id: meta.id, verdict: 'native-only', checks: only.ok, reason: blocked };
  }

  const cases = [...(pay.cases || []), ...((solution.key && solution.key.cases) || [])];
  if (!cases.length) return { id: meta.id, verdict: 'native-only', reason: 'No test cases.' };

  /* The front end first, and separately. A problem whose reference
     type-checks but will not codegen is a problem where the reader
     still gets the whole of rustc's diagnostics in the editor, and
     saying so is the difference between "Rust does not work here" and
     what is actually true. */
  const checked = await tc.check(reference);

  const built = await tc.compile(reference);
  if (!built.ok) {
    return {
      id: meta.id, verdict: 'native-only',
      checks: checked.ok,
      reason: explain(built.stderr),
      detail: built.stderr.trim().split('\n').slice(0, 4).join('\n'),
    };
  }

  const module = await WebAssembly.compile(built.bytes);
  const norm = s => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  let failures = 0;
  let firstFailure = null;
  for (const c of cases) {
    const r = await runCase(module, c.stdin || '', wasiMod);
    const got = norm(r.stdout);
    const want = norm(c.expect == null ? '' : c.expect);
    if (r.exit !== 0 || got !== want) {
      failures += 1;
      if (!firstFailure) {
        firstFailure = r.exit !== 0
          ? `exit ${r.exit}${r.crash ? ` (${r.crash})` : ''}${r.stderr ? ` — ${r.stderr.trim().split('\n')[0]}` : ''}`
          : `output differs (wanted ${JSON.stringify(want.slice(0, 40))}, got ${JSON.stringify(got.slice(0, 40))})`;
      }
    }
  }

  if (failures) {
    return {
      id: meta.id, verdict: 'native-only',
      checks: checked.ok,
      reason: `The reference solution compiles for WebAssembly but ${failures} of `
        + `${cases.length} cases behave differently there — ${firstFailure}. That is a `
        + 'real difference between the two platforms, not a problem with your code.',
    };
  }

  return {
    id: meta.id, verdict: 'browser',
    checks: checked.ok,
    cases: cases.length,
    warnings: built.diagnostics.filter(d => d.level === 'warning').length,
  };
}

/* ---------------- go ---------------- */

const tc = new Toolchain({
  baseUrl: new URL(`file://${VENDOR.replace(/\\/g, '/')}/`).href,
});

process.stdout.write('loading the toolchain… ');
const t0 = Date.now();
await tc.init();
const version = await tc.version();
console.log(`${Date.now() - t0} ms`);
console.log(`${version || TOOLCHAIN.compiler}, ${TOOLCHAIN.target}, ${TOOLCHAIN.flags}\n`);

const rustProblems = index.filter(p => p.type === 'code' && (p.langs || []).includes('rust'))
  .filter(p => !ONLY || p.id.includes(ONLY));

const results = [];
for (const meta of rustProblems) {
  const t = Date.now();
  const r = await tryProblem(tc, meta);
  results.push(r);
  const mark = r.verdict === 'browser' ? 'ok  ' : '--  ';
  console.log(`${mark}${r.id.padEnd(34)} ${r.verdict === 'browser'
    ? `${r.cases} cases, ${Date.now() - t} ms`
    : (r.reason || '').slice(0, 76)}`);
  if (r.detail) console.log(`      ${r.detail.split('\n').join('\n      ')}`);
}

const supported = results.filter(r => r.verdict === 'browser');
const nativeOnly = results.filter(r => r.verdict === 'native-only');

const checks = results.filter(r => r.checks);

console.log(`\n${checks.length} of ${results.length} Rust problems type-check in the browser`
  + ' — the borrow checker, the trait solver and the diagnostics.');
console.log(`${supported.length} of ${results.length} also compile to wasm and run.`);
console.log(`${nativeOnly.length} need the native toolchain to run.`);

const doc = {
  _note: 'GENERATED by scripts/audit-rust.mjs. Every entry here was produced by '
    + "compiling that problem's own reference solution with the browser rustc and "
    + "running it against that problem's own cases. `checks` is the front end "
    + '(--emit=metadata: parser, types, traits, borrows) and `browser` is codegen '
    + 'plus execution plus every case right. Do not edit by hand.',
  toolchain: { ...TOOLCHAIN, version: version || null },
  generated: results.length,
  /* Two columns, because they are two different capabilities. See the
     header of this script for why collapsing them would be wrong in
     whichever direction it rounded. */
  checks: checks.map(r => r.id).sort(),
  browser: supported.map(r => r.id).sort(),
  nativeOnly: Object.fromEntries(nativeOnly.map(r => [r.id, r.reason])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))),
};

const text = `${JSON.stringify(doc, null, 2)}\n`;

if (CHECK) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== text) {
    console.error('\ndata/rust-support.json is stale. Run: npm run audit:rust');
    process.exit(1);
  }
  console.log('\ndata/rust-support.json is current.');
  process.exit(0);
}

fs.writeFileSync(OUT, text);
console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
