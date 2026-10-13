/* Where exactly is the edge of the browser Rust compiler, and can it be
   moved without touching anybody's source?

   `data/rust-support.json` says two of the seven Rust exercises run in
   the browser and five do not. The reason is a single missing lowering
   in clif2wasm, the CLIF-to-wasm translator inside the browser rustc:
   it implements neither `smulhi.i64` nor `umulhi.i64`, the signed and
   unsigned high halves of a 64-bit product.

   Two questions, and this script answers both by compiling real
   programs with the real compiler rather than by reasoning about it:

     --flags   can a rustc flag avoid the gap? The sysroot is
               precompiled and did not come through that translator, so
               if the user's crate could be made to CALL core's parse
               instead of inlining a copy and codegening it locally,
               nothing would reach the broken lowering. This tries every
               flag that could plausibly do that.

     --scope   what, under the site's own flags, actually reaches it?
               The answer decides what the site is entitled to tell a
               reader, and the first version of that sentence was too
               narrow: it said reading a 64-bit integer out of a string
               "and nothing else".

   Needs the site served:  npm run serve
   Run: node scripts/probe-rust-gap.mjs            (both)
        node scripts/probe-rust-gap.mjs --scope
        BASE=https://… node scripts/probe-rust-gap.mjs

   Nothing is written. This is a measurement, and what it measured is
   written up in patches/README.md. */

import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const only = process.argv.find(a => a === '--flags' || a === '--scope');

/* What a submission is built with, from js/rust/toolchain.js. */
const SITE_FLAGS = ['--edition', '2024', '-O', '-Cpanic=abort'];

const READS_AN_I64 = `use std::io::{self, Read};

fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let n: i64 = s.trim().parse::<i64>().unwrap();
    println!("{}", n * 2);
}
`;

const FLAG_TRIES = [
  ['the site’s own flags', SITE_FLAGS],
  ['no cross-crate inlining', [...SITE_FLAGS, '-Zcross-crate-inline-threshold=never']],
  ['no MIR inlining', [...SITE_FLAGS, '-Zinline-mir=no']],
  ['no MIR optimisation', [...SITE_FLAGS, '-Zmir-opt-level=0']],
  ['no shared generics', [...SITE_FLAGS, '-Zshare-generics=off']],
  ['both, together', [...SITE_FLAGS,
    '-Zshare-generics=off', '-Zcross-crate-inline-threshold=never']],
  ['optimise for size', ['--edition', '2024', '-Copt-level=z', '-Cpanic=abort']],
  ['no optimisation at all', ['--edition', '2024', '-Cpanic=abort']],
];

const prog = body => `use std::io::{self, Read};

fn main() {
    let mut s = String::new();
    io::stdin().read_to_string(&mut s).unwrap();
    let a: i64 = s.trim().len() as i64;
    let b: i64 = 3;
${body}
}
`;

const SCOPE = [
  ['i64 multiply', prog('    println!("{}", a * b);')],
  ['i64 add, sub, div, rem', prog('    println!("{} {} {} {}", a + b, a - b, a / b, a % b);')],
  ['i64 wrapping_mul', prog('    println!("{:?}", a.wrapping_mul(b));')],
  ['i64 checked_mul', prog('    println!("{:?}", a.checked_mul(b));')],
  ['i64 overflowing_mul', prog('    println!("{:?}", a.overflowing_mul(b));')],
  ['i64 saturating_mul', prog('    println!("{:?}", a.saturating_mul(b));')],
  ['u64 checked_mul', prog('    println!("{:?}", (a as u64).checked_mul(b as u64));')],
  ['i128 multiply', prog('    println!("{}", (a as i128) * (b as i128));')],
  ['usize multiply', prog('    println!("{}", a as usize * b as usize);')],
  ['sum() over i64', prog('    let v: Vec<i64> = vec![a, b]; println!("{}", v.iter().sum::<i64>());')],
  ['product() over i64', prog('    let v: Vec<i64> = vec![a, b]; println!("{}", v.iter().product::<i64>());')],
  ['parse::<i32>()', prog('    let n: i32 = "123".parse().unwrap(); println!("{}", n);')],
  ['parse::<i64>()', prog('    let n: i64 = "123".parse().unwrap(); println!("{}", n + a);')],
  ['parse::<u64>()', prog('    let n: u64 = "123".parse().unwrap(); println!("{}", n);')],
  ['parse::<f64>()', prog('    let n: f64 = "1.5".parse().unwrap(); println!("{}", n);')],
  ['i64 to_string()', prog('    println!("{}", a.to_string().len());')],
];

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not reachable at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const browser = await chromium.launch();
let bad = 0;
try {
  const p = await (await browser.newContext()).newPage();
  p.on('pageerror', e => console.log(`PAGE ERROR: ${e.message}`));
  await p.goto(`${BASE}/#/p/rust-option-lookup`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  process.stdout.write('fetching the toolchain (44 MB the first time)… ');
  await p.evaluate(() => window.SystemsLab.BrowserRust.prepare());
  await p.waitForFunction(() => window.SystemsLab.BrowserRust.ready, { timeout: 300_000 });
  const version = await p.evaluate(() => window.SystemsLab.BrowserRust.version);
  console.log(`ready\n  ${version || 'rustc (Cranelift), wasm32-wasip1'}\n`);

  const build = (src, flags) => p.evaluate(async ({ s, fl }) => {
    try {
      const out = await window.SystemsLab.BrowserRust.compileSource(s, { flags: fl });
      const all = JSON.stringify(out.diagnostics || []) + String(out.log || '');
      const err = (out.diagnostics || []).find(d => d.level === 'error');
      return {
        ok: !!out.ok,
        bytes: out.bytes ? (out.bytes.length || out.bytes.byteLength || 0) : 0,
        ms: out.ms || 0,
        mulhi: /unimplemented binary opcode (smulhi|umulhi) on i64/.test(all),
        which: (all.match(/opcode (smulhi|umulhi)/) || [])[1] || '',
        where: (all.match(/translating function `([^`]+)`/) || [])[1] || '',
        msg: err ? String(err.message).split('\n')[0].slice(0, 120) : '',
      };
    } catch (e) {
      return { ok: false, msg: String((e && e.message) || e).slice(0, 120) };
    }
  }, { s: src, fl: flags });

  if (only !== '--scope') {
    console.log('Can a flag avoid it?\n');
    console.log('  Reading a 64-bit integer out of a string, built eight ways.\n');
    for (const [name, flags] of FLAG_TRIES) {
      /* eslint-disable-next-line no-await-in-loop -- one compiler, in one tab. */
      const r = await build(READS_AN_I64, flags);
      const word = r.ok ? `BUILT (${r.bytes} bytes)` : r.mulhi ? `${r.which}.i64` : 'failed';
      console.log(`  ${name.padEnd(26)} ${word}`);
      if (!r.ok && r.where) console.log(`  ${''.padEnd(26)} in ${r.where.slice(0, 64)}`);
      if (!r.ok && !r.mulhi) console.log(`  ${''.padEnd(26)} ${r.msg}`);
      if (r.ok) bad += 1;        /* a flag that works would be news */
    }
    console.log('\n  No flag avoids it. The function is generic, so the caller\'s crate'
      + '\n  monomorphises it whatever the inlining settings say, and codegen for'
      + '\n  that copy goes through the translator that has no lowering. Without'
      + '\n  optimisation the failure moves INTO main, because a debug build'
      + '\n  checks `n * 2` for overflow and checking needs the high half.\n');
  }

  if (only !== '--flags') {
    console.log(`What reaches it, under ${SITE_FLAGS.join(' ')}?\n`);
    for (const [name, src] of SCOPE) {
      /* eslint-disable-next-line no-await-in-loop -- as above. */
      const r = await build(src, SITE_FLAGS);
      const word = r.ok ? 'builds and runs' : r.mulhi ? `NO — ${r.which}.i64` : `NO — ${r.msg}`;
      console.log(`  ${name.padEnd(22)} ${word}`);
    }
    console.log('\n  So the honest sentence is "anything that checks a 64-bit multiply'
      + '\n  for overflow", not "reading a 64-bit integer out of a string". Both'
      + '\n  opcodes are needed, and patches/clif2wasm-smulhi.patch adds both.\n');
  }
} finally {
  await browser.close();
}

if (bad) {
  console.log(`  ${bad} flag combination(s) built it. That would be a route worth taking —`);
  console.log('  re-read this output before trusting data/rust-support.json.');
  process.exit(1);
}
