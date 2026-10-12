/* Which hardware exercises can the browser simulator actually run, and
   which parts of SystemVerilog does it actually support?

   Two things, written to one file, and neither is a list maintained by
   hand:

     browser    every hdl problem's own reference design, compiled with
                that problem's own sample testbench AND its grading
                testbench, and required to pass every named check in
                both. A problem is certified only if both pass.

     features   the output of scripts/probe-hdl.mjs, which is a
                program per language feature whose expected output is
                stated in advance. This is the published supported
                subset, and it is measured rather than inferred from
                the name of a generation flag — "SystemVerilog-2012"
                is what ivl is told, not what it implements.

   The result is data/hdl-support.json, which the site reads at run
   time and tests/content.test.mjs checks for staleness.

     npm run audit:hdl
     npm run audit:hdl -- --check     (fail if the committed file is stale)
     npm run audit:hdl -- --only=mux */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Simulator, GENERATION, TOOLCHAIN } from '../js/hdl/toolchain.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = `file://${path.join(ROOT, 'vendor', 'verilog').replace(/\\/g, '/')}/`;
const OUT = path.join(ROOT, 'data', 'hdl-support.json');
const CHECK = process.argv.includes('--check');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);

const { gradeChecks } = globalThis.HdlGrade;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/verilog/manifest.json'), 'utf8'));

const index = ['data/index.json', 'data/assessment-index.json']
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .filter(p => p.type === 'hdl')
  .filter(p => !ONLY || p.id.includes(ONLY));

const files = fs.readdirSync(path.join(ROOT, 'problems'), { recursive: true })
  .filter(f => String(f).endsWith('.json'));
const findProblem = id => JSON.parse(fs.readFileSync(
  path.join(ROOT, 'problems', files.find(f => String(f).endsWith(`${id}.json`))), 'utf8'));
const findSolution = id => JSON.parse(fs.readFileSync(
  path.join(ROOT, 'solutions', `${id}.json`), 'utf8'));

const sim = new Simulator({ baseUrl: VENDOR, load: n => import(new URL(n, VENDOR).href) });
await sim.init();

/* ---------------- the exercises ---------------- */

async function tryProblem(meta) {
  const problem = findProblem(meta.id);
  const sol = findSolution(meta.id);
  const pay = problem.payload || {};
  const ref = ((sol.key || {}).reference || {}).sv;

  if (!ref) {
    return { id: meta.id, verdict: 'native-only',
      reason: 'There is no reference design to certify this against.' };
  }

  const runs = [];
  for (const [what, tb, want] of [
    ['sample', pay.testbench, pay.checks || []],
    ['grading', (sol.key || {}).harness, (sol.key || {}).checks || []],
  ]) {
    if (!tb) {
      return { id: meta.id, verdict: 'native-only', reason: `no ${what} testbench` };
    }
    const built = await sim.build({ 'design.sv': ref, 'testbench.sv': tb },
      { generation: String(pay.generation || GENERATION) });
    if (!built.ok) {
      return {
        id: meta.id, verdict: 'native-only',
        reason: `the reference design does not compile with the ${what} testbench`,
        detail: built.stderr.split('\n').slice(0, 4).join('\n'),
      };
    }
    const ran = await sim.simulate(built.vvp);
    const graded = gradeChecks(ran.output, want, { finished: ran.finished });
    if (!graded.correct) {
      const f = graded.firstFailure;
      return {
        id: meta.id, verdict: 'native-only',
        reason: `the reference design does not pass its own ${what} testbench: `
          + (graded.incomplete
            || `${f && f.name}: expected ${f && f.expect}, got ${f && f.actual}`),
      };
    }
    runs.push({ what, checks: graded.total, ms: ran.ms, vcd: ran.vcd ? ran.vcd.length : 0 });
  }

  return { id: meta.id, verdict: 'browser', runs };
}

const results = [];
for (const meta of index) {
  const t = Date.now();
  const r = await tryProblem(meta);
  results.push(r);
  const mark = r.verdict === 'browser' ? 'ok  ' : '--  ';
  console.log(`${mark}${r.id.padEnd(22)} ${r.verdict === 'browser'
    ? r.runs.map(x => `${x.what} ${x.checks} checks`).join(', ') + `, ${Date.now() - t} ms`
    : (r.reason || '').slice(0, 80)}`);
  if (r.detail) console.log(`      ${r.detail.split('\n').join('\n      ')}`);
}

/* ---------------- the supported subset ---------------- */

/* Run the probe as a child process and take its JSON. A child rather
   than an import because the probe is a script with a `process.exit`
   in it, and because its 14 cases are the single copy of what has
   been measured — duplicating them here is how the published subset
   and the thing that verified it come to disagree. */
let features = [];
try {
  const out = execFileSync(process.execPath,
    [path.join(ROOT, 'scripts', 'probe-hdl.mjs'), '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  features = JSON.parse(out.slice(out.indexOf('{'))).results
    .map(r => ({ id: r.id, what: r.what, ok: r.ok, note: r.note }));
} catch (err) {
  console.error('\nthe feature probe failed, so the supported subset cannot be written:');
  console.error(String(err.stdout || err.message).slice(-2000));
  process.exit(1);
}

const supported = results.filter(r => r.verdict === 'browser');
const nativeOnly = results.filter(r => r.verdict !== 'browser');

console.log(`\n${supported.length} of ${results.length} hardware exercises `
  + 'simulate in the browser (reference design, both testbenches, every check).');
console.log(`${features.filter(f => f.ok).length} of ${features.length} language `
  + 'features behave as specified.');

const doc = {
  _note: 'GENERATED by scripts/audit-hdl.mjs. `browser` is the exercises whose own '
    + 'reference design passes both their sample and their grading testbench under the '
    + 'vendored simulator. `features` is scripts/probe-hdl.mjs: one program per '
    + 'language feature, each with its expected output stated in advance. Do not edit '
    + 'by hand.',
  toolchain: {
    ...TOOLCHAIN,
    generationFlag: GENERATION,
    /* The pinned commit, which is also the cache-busting version: it
       goes on the query string of every module and .wasm the simulator
       loads, so re-pinning the simulator is a different URL rather
       than a stale file beside a fresh one. */
    pin: manifest.commit,
    bytes: Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0),
  },
  /* Said in the data rather than only in the prose, because anything
     reading this file is one step from claiming something it should
     not. */
  _notSynthesis: 'This is simulation. A design that passes every check has not been '
    + 'shown to be synthesisable, to meet timing, to fit a device, or to work on '
    + 'hardware. There is no synthesiser here and no place-and-route.',
  generated: results.length,
  browser: supported.map(r => r.id).sort(),
  nativeOnly: Object.fromEntries(nativeOnly.map(r => [r.id, r.reason])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  features,
};

const text = `${JSON.stringify(doc, null, 2)}\n`;

if (CHECK) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== text) {
    console.error('\ndata/hdl-support.json is stale. Run: npm run audit:hdl');
    process.exit(1);
  }
  console.log('\ndata/hdl-support.json is current.');
  process.exit(0);
}

fs.writeFileSync(OUT, text);
console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
