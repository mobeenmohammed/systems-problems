/* Every Rust exercise, compiled and run in the browser against its own
   cases — and the arithmetic that could not be compiled at all until
   the high-half multiply was lowered.

   This is the suite that says whether browser Rust execution is
   finished. It does not consult data/rust-support.json for what *ought*
   to work: it takes every Rust problem in the catalogue, compiles that
   problem's own reference solution with the flags the site would use
   for it, runs it against the problem's own cases — the visible ones
   and the hidden ones — and compares.

   Then the things a working compiler has to get right that a passing
   exercise does not prove:

     · signed and unsigned 64-bit boundaries, arriving at RUNTIME so
       nothing can be const-folded: i64::MIN, i64::MAX, u64::MAX, and
       the multiplications either side of them
     · overflow, which must be caught rather than wrapped, because the
       sanitize profile asks for it
     · a read past the end of a slice, which must panic
     · a run that is cancelled, and the run after it

   Run: node tests/browser/rust-all.test.mjs
        BASE=https://… node tests/browser/rust-all.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHANNEL = process.env.BROWSER || null;

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not reachable at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync('data/index.json', 'utf8'));
const RUST = index.filter(p => (p.langs || []).includes('rust'));

const problemFile = (id) => {
  for (const d of fs.readdirSync('problems')) {
    const f = path.join('problems', d, `${id}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return null;
};
const solutionOf = id => JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8'));

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/#/p/rust-option-lookup`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.evaluate(() => window.SystemsLab.BrowserRust.prepare());
await page.waitForFunction(() => window.SystemsLab.BrowserRust.ready, { timeout: 420_000 });
const version = await page.evaluate(() => window.SystemsLab.BrowserRust.version);

/* Compile with the flags the site would use for this problem, run each
   case, and report. The same code path the workspace uses. */
const runAll = (src, cases, profile) => page.evaluate(async ({ s, cs, pr }) => {
  const B = window.SystemsLab.BrowserRust;
  const reply = await B.run(s, cs, { profile: pr });
  return {
    built: !!(reply.compile && reply.compile.ok),
    why: ((reply.compile || {}).stderr || '').split('\n').find(l => /^error/.test(l)) || '',
    judgeDown: !!reply.judgeDown,
    cases: (reply.cases || []).map(c => ({
      out: (c.stdout || '').trim(), exit: c.exit, err: (c.stderr || '').trim().slice(0, 120),
    })),
  };
}, { s: src, cs: cases, pr: profile });

const oneOff = (src, stdin, profile) => page.evaluate(async ({ s, i, pr }) => {
  const B = window.SystemsLab.BrowserRust;
  const reply = await B.run(s, [{ stdin: i }], { profile: pr });
  const c = (reply.cases || [])[0] || {};
  return {
    built: !!(reply.compile && reply.compile.ok),
    why: ((reply.compile || {}).stderr || '').split('\n').find(l => /^error/.test(l)) || '',
    out: (c.stdout || '').trim(),
    err: (c.stderr || '').trim(),
    exit: c.exit,
  };
}, { s: src, i: stdin, pr: profile });

/* ---------------- every exercise, end to end ---------------- */

section(`all ${RUST.length} Rust exercises, against their own cases (${version || 'rustc'})`);
let ran = 0;
{
  for (const meta of RUST) {
    const problem = problemFile(meta.id);
    const key = solutionOf(meta.id).key;
    const ref = (key.reference || {}).rust;
    const pay = problem.payload || {};
    const cases = [...(pay.cases || []), ...(key.cases || [])];
    if (!ref) { ok(`${meta.id}: has a Rust reference`, false); continue; }

    /* eslint-disable-next-line no-await-in-loop -- one compiler, in one tab. */
    const r = await runAll(ref, cases, pay.profile || 'standard');
    if (!r.built) {
      ok(`${meta.id}: its reference compiles (${r.why.slice(0, 80)})`, false);
      continue;
    }
    const wrong = r.cases
      .map((c, i) => ({ i, got: c.out, want: (cases[i].expect || '').trim(), exit: c.exit }))
      .filter(c => c.got !== c.want);
    const good = wrong.length === 0;
    ok(`${meta.id}: compiles and passes all ${cases.length} of its cases`
      + (good ? '' : ` — ${wrong.length} wrong, first: case ${wrong[0].i + 1} `
        + `got "${wrong[0].got.slice(0, 30)}" want "${wrong[0].want.slice(0, 30)}"`), good);
    if (good) ran += 1;
  }
  check(`${ran} of ${RUST.length} run in the browser`, ran, RUST.length);
}

/* ---------------- the arithmetic that could not be compiled ---------------- */

section('64-bit values that arrive at runtime, so nothing is const-folded');
{
  const SRC = `use std::io::{self, Read};
fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let mut it = s.split_whitespace();
    let a: i64 = it.next().unwrap().parse().unwrap();
    let b: i64 = it.next().unwrap().parse().unwrap();
    let u: u64 = it.next().unwrap().parse().unwrap();
    println!("{:?} {:?} {:?} {}",
        a.checked_mul(b), a.overflowing_mul(b), u.checked_mul(2), a.saturating_mul(b));
}
`;
  const want = [
    /* a, b, u                          checked      overflowing              u*2            saturating */
    ['2 3 4', 'Some(6) (6, false) Some(8) 6'],
    ['9223372036854775807 1 18446744073709551615',
      'Some(9223372036854775807) (9223372036854775807, false) None 9223372036854775807'],
    ['-9223372036854775808 1 0',
      'Some(-9223372036854775808) (-9223372036854775808, false) Some(0) -9223372036854775808'],
    ['9223372036854775807 2 0',
      'None (-2, true) Some(0) 9223372036854775807'],
    ['-9223372036854775808 -1 0',
      'None (-9223372036854775808, true) Some(0) 9223372036854775807'],
    ['-1 -1 9223372036854775808', 'Some(1) (1, false) None 1'],
  ];

  for (const [stdin, expect] of want) {
    /* eslint-disable-next-line no-await-in-loop -- as above. */
    const r = await oneOff(SRC, `${stdin}\n`, 'standard');
    if (!r.built) {
      ok(`${stdin}: it compiles (${r.why.slice(0, 90)})`, false);
      continue;
    }
    check(`${stdin.replace(/ /g, ', ')}`, r.out, expect);
  }

  /* parse::<u64>() of the largest u64 there is — the unsigned half of
     the same lowering, by the road the exercises actually take. */
  const U = `use std::io::{self, Read};
fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let u: u64 = s.trim().parse().unwrap();
    println!("{} {}", u, u / 3);
}
`;
  const u = await oneOff(U, '18446744073709551615\n', 'standard');
  ok('parse::<u64>() compiles', u.built);
  check('and reads u64::MAX exactly', u.out, '18446744073709551615 6148914691236517205');

  /* product() over i64, which reaches the same lowering through the
     iterator traits rather than through a method call. */
  const P = `use std::io::{self, Read};
fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let v: Vec<i64> = s.split_whitespace().map(|t| t.parse().unwrap()).collect();
    println!("{}", v.iter().product::<i64>());
}
`;
  const pr = await oneOff(P, '2 3 5 7 11 13\n', 'standard');
  ok('product() over i64 compiles', pr.built);
  check('and multiplies', pr.out, '30030');
}

/* ---------------- what the checks are for ---------------- */

section('overflow is caught and a read past the end panics');
{
  const OVER = `use std::io::{self, Read};
fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let a: i64 = s.trim().parse().unwrap();
    println!("{}", a * 2);
}
`;
  /* Under the sanitize profile the site builds with overflow checks
     on, as the native judge does, so this must abort rather than wrap. */
  const o = await oneOff(OVER, '9223372036854775807\n', 'sanitize');
  ok('a program that overflows compiles', o.built);
  ok(`and is stopped rather than wrapped (exit ${o.exit})`,
    o.exit !== 0 && /overflow/i.test(o.err));
  ok('with nothing printed', o.out === '');

  /* The same program without the checks is allowed to wrap: that is
     what -O means, and the difference between the two profiles is the
     point of having two. */
  const w = await oneOff(OVER, '9223372036854775807\n', 'standard');
  ok('without the checks it wraps instead', w.built && w.exit === 0 && w.out === '-2');

  const OOB = `use std::io::{self, Read};
fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let v: Vec<i64> = s.split_whitespace().map(|t| t.parse().unwrap()).collect();
    let mut t = 0i64;
    for i in 0..=v.len() { t += v[i]; }
    println!("{}", t);
}
`;
  const b = await oneOff(OOB, '1 2 3\n', 'sanitize');
  ok('reading past the end compiles', b.built);
  ok(`and panics (exit ${b.exit})`, b.exit !== 0);
  ok(`naming the index (${b.err.split('\n')[1] || b.err.slice(0, 60)})`,
    /index out of bounds/.test(b.err));
}

/* ---------------- stopping, and carrying on ---------------- */

section('a run can be stopped, and the next one still works');
{
  const LOOP = 'fn main() { let mut i: u64 = 0; loop { i = i.wrapping_add(1); '
    + 'if i == 0 { println!("never"); } } }\n';
  const stopped = await page.evaluate(async (src) => {
    const B = window.SystemsLab.BrowserRust;
    const ac = new AbortController();
    const p = B.run(src, [{ stdin: '' }], { signal: ac.signal });
    await new Promise(r => setTimeout(r, 1500));
    ac.abort();
    const reply = await p;
    return { cancelled: !!reply.cancelled, judgeDown: !!reply.judgeDown,
      says: reply.judgeError || '' };
  }, LOOP);
  ok('a cancelled run says it was stopped', stopped.cancelled || /Stopped/.test(stopped.says));
  ok('and records nothing', stopped.judgeDown);

  const after = await oneOff(
    'use std::io::{self, Read};\nfn main(){ let mut s=String::new(); '
    + 'io::stdin().read_to_string(&mut s).unwrap(); '
    + 'let n: i64 = s.trim().parse().unwrap(); println!("{}", n.checked_mul(3).unwrap()); }\n',
    '7\n', 'standard');
  ok('a real program runs straight afterwards', after.built && after.out === '21');

  /* And again, because a compiler that works once is not a compiler. */
  const again = await oneOff(
    'use std::io::{self, Read};\nfn main(){ let mut s=String::new(); '
    + 'io::stdin().read_to_string(&mut s).unwrap(); '
    + 'let n: u64 = s.trim().parse().unwrap(); println!("{}", n.checked_mul(4).unwrap()); }\n',
    '11\n', 'standard');
  ok('and again', again.built && again.out === '44');
}

check('no uncaught errors', errors, []);
await browser.close();
report('browser/rust-all');
