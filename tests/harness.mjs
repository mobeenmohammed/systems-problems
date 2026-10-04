/* ============================================================
   harness.mjs — the few lines of test plumbing every suite uses.

   No test framework: the suites are plain node scripts, so
   `node tests/store.test.mjs` is the whole story and there is
   nothing to keep up to date between the runner and the tests.

   Browser-side modules are loaded into a vm sandbox rather than
   imported, because they are written as plain <script> globals
   (`const Store = (() => …)()`) with no module system — which is
   what lets index.html load them with no build step. A trailing
   `;Store;` makes the script's completion value the handle.
   ============================================================ */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const readJson = rel => JSON.parse(read(rel));

/* ---------------- assertions ---------------- */

let pass = 0;
let fail = 0;
const failures = [];

export function section(name) {
  console.log(`\n  ${name}`);
}

export function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  ok    ${label}`); return true; }
  fail += 1;
  failures.push(label);
  console.log(`  FAIL  ${label}\n          got      ${a}\n          expected ${e}`);
  return false;
}

export function ok(label, value) {
  return check(label, !!value, true);
}

export function near(label, actual, expected, tol = 1e-9) {
  const good = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (good) { pass += 1; console.log(`  ok    ${label}`); return true; }
  fail += 1;
  failures.push(label);
  console.log(`  FAIL  ${label}\n          got      ${actual}\n          expected ${expected} (+/-${tol})`);
  return false;
}

export function throws(label, fn) {
  try { fn(); } catch { return check(label, 'threw', 'threw'); }
  return check(label, 'did not throw', 'threw');
}

/* Ends the suite. On failures it exits 1; on success it exits 0 rather than
   returning, because a suite that reports and then keeps running is a suite
   whose skip path falls straight into the checks it just skipped.
   tests/browser/runner.test.mjs did exactly that, and the only place it showed
   was CI — where the local runner is, correctly, never up. */
export function report(suite) {
  console.log(`\n  ${suite}: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\n  failing:');
    for (const f of failures) console.log(`    - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

/* ---------------- loading browser modules ---------------- */

/* A localStorage good enough for the store: it is the only browser API the
   store touches, and a Map behaves the same for every use the store makes. */
export function memoryStorage(seed = {}) {
  const mem = new Map(Object.entries(seed));
  return {
    get length() { return mem.size; },
    key: i => [...mem.keys()][i] ?? null,
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: k => { mem.delete(k); },
    clear: () => mem.clear(),
    __dump: () => Object.fromEntries(mem),
  };
}

/* Loads the named site scripts into one sandbox, in order, and returns the
   sandbox plus a `grab` for pulling out a lexically declared global. */
export function loadScripts(files, extra = {}) {
  const sandbox = {
    console,
    URL, URLSearchParams, Blob: globalThis.Blob,
    setTimeout, clearTimeout, AbortSignal,
    localStorage: memoryStorage(),
    fetch: async () => ({ ok: false, status: 404, statusText: 'Not Found' }),
    ...extra,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  for (const f of files) {
    vm.runInContext(read(f), sandbox, { filename: f });
  }

  return {
    sandbox,
    grab: name => vm.runInContext(`${name};`, sandbox),
  };
}
