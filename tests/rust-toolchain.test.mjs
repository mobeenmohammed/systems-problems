/* The browser Rust toolchain, driven directly — no browser involved.

   The same rustc.wasm the page loads, the same sysroot bundle, the same
   flags, run under Node through the same WASI shim. What this suite is
   for is the claims the rest of the site makes about Rust:

     · it is a real rustc, with the real borrow checker
     · a type-check works on every Rust problem, including the ones that
       cannot be run here
     · the one thing that cannot be run is `parse::<i64>()`, and it is
       that specifically rather than "64-bit integers"
     · data/rust-support.json is not a list somebody maintains

   The last one matters most. A support list that drifts from the
   compiler offers the browser toolchain for a problem it cannot run, or
   withholds it from one it can, and nothing on the page would say so.

   Run: node tests/rust-toolchain.test.mjs */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJson, section, check, ok, report } from './harness.mjs';

const VENDOR = path.join(ROOT, 'vendor', 'rust');

/* Node's fetch has no file: scheme, and the toolchain module fetches its
   assets by URL because that is what it does in a browser. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const s = String(u && u.url ? u.url : u);
  if (s.startsWith('file:')) {
    return new Response(await fsp.readFile(fileURLToPath(s.split('?')[0])));
  }
  return realFetch(u, o);
};

const here = p => new URL(`file://${path.join(ROOT, p).replace(/\\/g, '/')}`).href;

const { Toolchain, BROWSER_FLAGS, parseDiagnostics } = await import(here('js/rust/toolchain.js'));
const wasiMod = await import(here('vendor/cxx/wasi/index.js'));
const { runCase } = await import(here('js/cxx/toolchain.js'));

const CHECK_FLAGS = ['--edition', '2024', '--emit=metadata', '-Cpanic=abort'];

/* ---------------- it is on disk and it is pinned ---------------- */

section('the toolchain is vendored and pinned');
{
  const manifest = readJson('vendor/rust/manifest.json');
  const crypto = await import('node:crypto');
  for (const [name, want] of Object.entries(manifest.files)) {
    const file = path.join(VENDOR, name);
    ok(`${name} is in the repository`, fs.existsSync(file));
    const bytes = fs.readFileSync(file);
    check(`${name} is the pinned size`, bytes.length, want.bytes);
    const got = crypto.createHash('sha256').update(bytes).digest('hex');
    check(`${name} is the pinned build`, got, want.sha256);
  }
  ok('the weblings licence is kept', fs.existsSync(path.join(VENDOR, 'LICENSE-weblings')));
  ok('and the standard library\'s both', fs.existsSync(path.join(VENDOR, 'LICENSE-MIT'))
    && fs.existsSync(path.join(VENDOR, 'LICENSE-APACHE')));
}

const tc = new Toolchain({ baseUrl: new URL(`file://${VENDOR.replace(/\\/g, '/')}/`).href });
await tc.init();
const version = await tc.version();

section('it is a real rustc');
ok(`it says what it is ("${version}")`, /^rustc \d+\.\d+/.test(version || ''));

/* ---------------- what it compiles and runs ---------------- */

const build = (src, flags) => tc.compile(src, flags);

async function runSource(src, stdin = '') {
  const built = await build(src, BROWSER_FLAGS);
  if (!built.ok) return { built: false, stderr: built.stderr };
  const module = await WebAssembly.compile(built.bytes);
  const r = await runCase(module, stdin, wasiMod);
  return { built: true, ...r };
}

section('a program compiles, runs, and reads its input');
{
  const r = await runSource(`
use std::io::{self, Read};

fn longest(words: &[String]) -> Option<&String> {
    words.iter().max_by_key(|w| w.len())
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let words: Vec<String> = input.split_whitespace().map(|s| s.to_string()).collect();
    match longest(&words) {
        Some(w) => println!("longest {}", w),
        None => println!("none"),
    }
    let v = vec![3, 1, 4, 1, 5];
    let tail: &[i32] = &v[2..];
    println!("tail {:?} sum {}", tail, tail.iter().sum::<i32>());
}
`, 'alpha bravo charlie\n');
  ok('it built', r.built);
  check('it exited cleanly', r.exit, 0);
  check('stdin reached it, and the slice is right',
    r.stdout.trim().split('\n'), ['longest charlie', 'tail [4, 1, 5] sum 10']);
}

section('a panic is a panic, with the line it happened on');
{
  const r = await runSource(`
fn main() {
    let v: Vec<i32> = vec![1, 2, 3];
    println!("before");
    println!("{}", v[10]);
}
`);
  ok('it built', r.built);
  check('what it printed first still arrived', r.stdout.trim(), 'before');
  ok('it did not exit cleanly', r.exit !== 0);
  ok(`the panic says what happened ("${(r.stderr || '').trim().split('\n').pop()}")`,
    /index out of bounds: the len is 3 but the index is 10/.test(r.stderr || ''));
  ok('and names the line', /prog\.rs:5/.test(r.stderr || ''));
}

/* ---------------- the borrow checker is the real one ---------------- */

section('the borrow checker is the real one, and a type-check reaches it');
{
  const cases = [
    ['a move', 'E0382', `fn main(){ let a = String::from("x"); let b = a; println!("{} {}", a, b); }`],
    ['two borrows', 'E0502', `fn main(){ let mut v=vec![1]; let f=&v[0]; v.push(2); println!("{}", f); }`],
    ['a type mismatch', 'E0308', `fn main(){ let n: i32 = "seven"; println!("{}", n); }`],
    ['a lifetime', 'E0621',
      `fn longest<'a>(x: &'a str, y: &str) -> &'a str { if x.len()>y.len() {x} else {y} }
fn main(){ println!("{}", longest("a","bb")); }`],
  ];
  for (const [what, code, src] of cases) {
    const r = await build(src, CHECK_FLAGS);
    const codes = r.diagnostics.map(d => d.code);
    ok(`${what} is ${code}`, codes.includes(code));
    const d = r.diagnostics.find(x => x.code === code);
    ok(`${what}: it points at a line (${d && d.line})`, !!(d && d.line > 0));
    ok(`${what}: with rustc's own rendering`, !!(d && d.rendered.includes(code)));
  }
}

section('a correct program has nothing to say about it');
{
  const r = await build('fn main(){ println!("fine"); }', CHECK_FLAGS);
  check('no diagnostics', r.diagnostics, []);
}

/* ---------------- the gap, named exactly ---------------- */

section('the one thing this backend cannot do is the high half of a 64-bit multiply');
{
  const parses = async ty => {
    const r = await build(
      `fn main(){ let s="41"; let n: ${ty} = s.parse().unwrap(); println!("{}", n); }`,
      BROWSER_FLAGS);
    return r.ok;
  };

  for (const ty of ['i32', 'u32', 'usize', 'f64']) {
    ok(`parse::<${ty}>() compiles`, await parses(ty));
  }
  for (const ty of ['i64', 'u64']) {
    ok(`parse::<${ty}>() does not`, !(await parses(ty)));
  }

  /* The point of pinning it this precisely: "64-bit is broken" would be
     wrong, and would be the kind of wrong that makes somebody stop
     looking for the real boundary.

     This block used to assert that `checked_mul` was fine, and it
     passed — on compile-time constants, which rustc folds before any
     lowering is reached. On values that arrive at RUNTIME the same call
     emits `smulhi.i64` and does not build, so the assertion was true of
     the program it ran and false of the claim it was making. Both sides
     are pinned now, and `scripts/probe-rust-gap.mjs` maps the whole
     boundary against the real compiler. */
  const arith = await runSource(`
fn main(){
    let a: i64 = 9_007_199_254_740_993;
    let b: u64 = 18_446_744_073_709_551_615;
    println!("{} {} {}", a, b, a / 7);
}
`);
  ok('64-bit arithmetic and printing are fine', arith.built && arith.exit === 0);
  check('and give the right answers', arith.stdout.trim(),
    '9007199254740993 18446744073709551615 1286742750677284');

  /* Runtime values, which is the case that matters: a reader's program
     multiplies what it read, not what the author typed. */
  const runtime = async (expr) => {
    const r = await build(`
use std::io::{self, Read};
fn main(){
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let a: i64 = s.trim().len() as i64;
    let b: i64 = 3;
    println!("{:?}", ${expr});
}
`, BROWSER_FLAGS);
    return { ok: r.ok, mulhi: /opcode (smulhi|umulhi) on i64/.test(JSON.stringify(r.diagnostics || []) + String(r.log || '')) };
  };

  for (const expr of ['a * b', 'a.wrapping_mul(b)', 'a + b', 'a / b', 'a % b',
    '(a as i128) * (b as i128)', 'a as usize * b as usize']) {
    const r = await runtime(expr);
    ok(`${expr} builds on runtime values`, r.ok);
  }
  for (const expr of ['a.checked_mul(b)', 'a.overflowing_mul(b)', 'a.saturating_mul(b)',
    '(a as u64).checked_mul(b as u64)']) {
    const r = await runtime(expr);
    ok(`${expr} does not \u2014 it needs the high half`, !r.ok && r.mulhi);
  }

  /* So the generated reason has to say that, rather than naming only
     the parse. A reader who reads "64-bit arithmetic is fine" and then
     writes checked_mul has been told something false. */
  const support = readJson('data/rust-support.json');
  const reason = Object.values(support.nativeOnly || {})
    .find(t => /high half|smulhi/.test(t)) || '';
  ok('the generated reason names the high half of a 64-bit multiply',
    /high half of a 64-bit multiplication/.test(reason));
  ok('and names checked_mul among what reaches it', /checked_mul/.test(reason));
  ok('and both opcodes', /smulhi/.test(reason) && /umulhi/.test(reason));
  ok('while still saying ordinary 64-bit arithmetic is fine',
    /wrapping_mul/.test(reason) && /is fine/.test(reason));

  /* And the gap is in code generation, not in checking — which is what
     makes the editor's diagnostics work on every Rust problem. */
  const src = `
use std::io::{self, Read};
fn main(){ let mut s=String::new(); io::stdin().read_to_string(&mut s).unwrap();
let n: i64 = s.trim().parse().unwrap();
let mut v = vec![n]; let first = &v[0]; v.push(1); println!("{}", first); }`;
  const built = await build(src, BROWSER_FLAGS);
  const checked = await build(src, CHECK_FLAGS);
  ok('a program that parses an i64 does not build', !built.ok);
  ok('but the borrow checker still sees it',
    checked.diagnostics.some(d => d.code === 'E0502'));
}

/* ---------------- the support list is generated, not maintained ---------------- */

section('data/rust-support.json agrees with the compiler');
{
  const support = readJson('data/rust-support.json');
  const index = readJson('data/index.json');
  const rustProblems = index.filter(p => p.type === 'code' && (p.langs || []).includes('rust'));

  const listed = new Set([...(support.browser || []), ...Object.keys(support.nativeOnly || {})]);
  check('every Rust problem has a verdict',
    rustProblems.filter(p => !listed.has(p.id)).map(p => p.id), []);
  check('and nothing is listed that is not a Rust problem',
    [...listed].filter(id => !rustProblems.some(p => p.id === id)), []);
  check('a problem is in one list or the other, never both',
    (support.browser || []).filter(id => support.nativeOnly[id]), []);
  ok('every native-only entry says why',
    Object.values(support.nativeOnly || {}).every(r => typeof r === 'string' && r.length > 40));

  const norm = s => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  const readProblem = id => {
    const files = fs.readdirSync(path.join(ROOT, 'problems'), { recursive: true })
      .filter(f => String(f).endsWith(`${id}.json`));
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'problems', String(files[0])), 'utf8'));
  };

  /* Every problem the file says runs here, actually run here, against
     its own cases. This is the assertion that makes the file worth
     having. */
  for (const id of support.browser || []) {
    const problem = readProblem(id);
    const sol = readJson(`solutions/${id}.json`);
    const cases = [...(problem.payload.cases || []), ...((sol.key && sol.key.cases) || [])];
    const built = await build(sol.key.reference.rust, BROWSER_FLAGS);
    if (!ok(`${id}: its reference solution builds`, built.ok)) {
      console.log(`        ${built.stderr.split('\n')[0]}`);
      continue;
    }
    const module = await WebAssembly.compile(built.bytes);
    let wrong = 0;
    for (const c of cases) {
      const r = await runCase(module, c.stdin || '', wasiMod);
      if (r.exit !== 0 || norm(r.stdout) !== norm(c.expect)) wrong += 1;
    }
    check(`${id}: and passes all ${cases.length} of its own cases`, wrong, 0);
  }

  /* And every problem it says cannot run here, cannot. A list that
     withholds the compiler from a problem it could run is the same
     failure in the other direction, and it is invisible. */
  for (const [id, reason] of Object.entries(support.nativeOnly || {})) {
    const problem = readProblem(id);
    const pay = problem.payload || {};
    /* `sanitize` is no longer one of these. Rust has no sanitizer in
       the native profile either — the judge builds such a problem with
       debug assertions and overflow checks, and the safety the exercise
       is about comes from the language: indexing past the end of a
       slice is a bounds-checked panic, in wasm too. So a sanitize
       problem is compiled like any other and excluded only if the
       compiler says so. The C++ reason is not Rust's reason. */
    const beforeCompiling = pay.profile
      && pay.profile !== 'standard' && pay.profile !== 'sanitize';
    if (beforeCompiling) {
      ok(`${id}: excluded before a compiler was involved`, /profile|threads/.test(reason));
      continue;
    }
    const sol = readJson(`solutions/${id}.json`);
    const ref = sol.key && sol.key.reference && sol.key.reference.rust;
    if (!ref) { ok(`${id}: has no Rust reference to certify`, true); continue; }
    const built = await build(ref, BROWSER_FLAGS);
    ok(`${id}: really does not build here`, !built.ok);
  }
}

/* ---------------- diagnostics parsing ---------------- */

section('the diagnostic parser takes only diagnostics');
{
  const log = [
    'some plain text rustc printed',
    '{"$message_type":"diagnostic","level":"error","message":"boom","code":{"code":"E0001"},'
      + '"spans":[{"is_primary":true,"line_start":3,"column_start":5,"line_end":3,"column_end":9}],'
      + '"rendered":"error[E0001]: boom\\n --> /work/prog.rs:3:5"}',
    '{"$message_type":"diagnostic","level":"note","message":"ignored","spans":[],"rendered":"n"}',
    '{"not":"a diagnostic"}',
    'not json at all',
  ].join('\n');
  const got = parseDiagnostics(log);
  check('one diagnostic survives', got.length, 1);
  check('with its code', got[0].code, 'E0001');
  check('its line', got[0].line, 3);
  check('and its column', got[0].col, 5);
  ok('the internal path is not shown to anybody',
    !got[0].rendered.includes('/work/prog.rs') && got[0].rendered.includes('program:3:5'));
  ok('notes are left out — they are context, not a verdict',
    !got.some(d => d.level === 'note'));
}

report('rust-toolchain');
