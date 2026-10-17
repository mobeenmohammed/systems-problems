# Patches written here, for upstream

Work that belongs in somebody else's repository, kept here with the
evidence that it is correct.

## `clif2wasm-smulhi.patch`

**What it fixes.** The in-browser Rust compiler
([AngelOnFira/weblings](https://github.com/AngelOnFira/weblings), a
rustc built to WebAssembly with the Cranelift backend) cannot compile
`parse::<i64>()` or `parse::<u64>()`. Every program that reads a 64-bit
integer out of a string fails to build, with:

```
error: wasm emission failed: translating function
  `_RNvMsr_NtCs5YIeRrg71Nh_4core3numx16from_ascii_radix`:
  lowering `v135 = smulhi.i64 v133, v132`:
  unimplemented binary opcode smulhi on i64
```

`from_ascii_radix` accumulates digits with `checked_mul`, which needs
the high half of a 64x64 product. Cranelift emits `smulhi.i64` for it.
WebAssembly has no such instruction, and the CLIF-to-wasm translator
maps each CLIF opcode onto exactly one wasm operator — so an opcode
that needs a *sequence* falls off the end of the table and becomes a
hard error.

**Where.** `AngelOnFira/rust`, branch `riw-wasm20`, in
`compiler/rustc_codegen_cranelift/clif2wasm/src/`.

**Why it is small.** The translator already contains a correct unsigned
64x64-to-high-64 multiply: it is written inline inside
`i128_lower::mul`, which is how the i128 path gets its partial
products. The patch lifts that sequence into a named helper, uses it
from both places, and adds the signed correction:

```
smulhi(a, b) = umulhi(a, b) - ((a >> 63) & b) - ((b >> 63) & a)
```

An arithmetic shift by 63 is all-ones for a negative value and zero
otherwise, so each term subtracts the other operand exactly when this
one is negative. Branchless, and it is the standard identity.

**How it was verified.** `scripts/verify-mulhi.mjs` in this repository
assembles *the instruction sequence the patch emits* — instruction for
instruction — into a real WebAssembly module, validates it, instantiates
it, and compares every result against BigInt's exact 128-bit
arithmetic. Not a JavaScript model of wasm semantics: the actual module,
run by the engine.

```
$ node scripts/verify-mulhi.mjs --fuzz=500000
assembled 263 bytes of WebAssembly, validated and instantiated

31x31 boundary pairs: all agree
38 steps of an actual i64 decimal parse: all agree
500,000 random pairs: all agree

500,999 pairs checked, 1001998 comparisons.
The lowering agrees with exact 128-bit arithmetic on every case.
```

The boundary set is the one that hides bugs in wide multiplies:
`i64::MIN`, `i64::MAX`, both neighbours of each, zero, ±1, ±2, and the
powers of two either side of the 32-bit split where the partial products
carry. The parse walk is what `from_ascii_radix` actually does — the
accumulator at every step of reading `9223372036854775807`, in both
signs, up to the digit that must overflow.

The verifier has teeth: deleting one of the two signed corrections
produces 25,207 disagreements, the first at `smulhi(1, -1)`.

**How big the gap actually is.** Bigger than the parse, and this was
measured rather than assumed. `scripts/probe-rust-gap.mjs` compiles
sixteen small programs with the real browser compiler under the site's
own flags (`--edition 2024 -O -Cpanic=abort`):

```
  i64 multiply           builds and runs
  i64 add, sub, div, rem builds and runs
  i64 wrapping_mul       builds and runs
  i64 checked_mul        NO — smulhi.i64
  i64 overflowing_mul    NO — smulhi.i64
  i64 saturating_mul     NO — smulhi.i64
  u64 checked_mul        NO — umulhi.i64
  i128 multiply          builds and runs
  usize multiply         builds and runs
  sum() over i64         builds and runs
  product() over i64     NO — smulhi.i64
  parse::<i32>()         builds and runs
  parse::<i64>()         NO — smulhi.i64
  parse::<u64>()         NO — umulhi.i64
  parse::<f64>()         builds and runs
  i64 to_string()        builds and runs
```

So it is *anything that checks a 64-bit multiply for overflow*, by
whichever road it arrives — and `umulhi.i64` is missing as well as
`smulhi.i64`, which is why this patch adds both. The one-line summary
the site used to show a reader ("reading a 64-bit integer out of a
string, and nothing else") was too narrow, and the README's claim that
`checked_mul` was fine was simply wrong: the test that said so
multiplied two compile-time constants, which rustc folds before any
lowering is reached.

**Can a flag avoid it instead?** No, and this was worth asking, because
the sysroot is precompiled and did not come through the broken
translator — a program that *called* core's parse rather than inlining a
copy and codegening that copy locally would never reach the gap. The
same script tries it:

```
  the site’s own flags        smulhi.i64  in core::num::from_ascii_radix
  no cross-crate inlining     smulhi.i64  in core::num::from_ascii_radix
  no MIR inlining             smulhi.i64  in core::num::from_ascii_radix
  no MIR optimisation         smulhi.i64  in core::num::from_ascii_radix
  no shared generics          smulhi.i64  in core::num::from_ascii_radix
  both, together              smulhi.i64  in core::num::from_ascii_radix
  optimise for size           smulhi.i64  in core::num::from_ascii_radix
  no optimisation at all      smulhi.i64  in prog::main
```

`from_ascii_radix` is generic, so the caller's crate monomorphises it
whatever the inlining settings say, and codegen for that copy goes
through the translator with no lowering. The last line is the
interesting one: with optimisation off the failure moves **into `main`**,
because a debug build checks `n * 2` for overflow too. There is no flag
behind which this hides.

**Building it.** `scripts/build-rustc-wasm.sh` does, following
`AngelOnFira/wasm-rustc`'s own CI workflow: clone `AngelOnFira/rust` at
`riw-wasm20`, apply this patch, fetch WASI SDK 32, `x.py install`. It is
resumable — every phase writes a marker and is skipped on a re-run — and
it needs no root. Four things had to be fixed before it would get
anywhere, and each of them is the kind of thing only a real build finds:

**The patch did not apply.** Its empty context lines were written as
empty lines rather than as a single space, and two hunk headers counted
the wrong number of lines, so `git apply` called it corrupt at line 137
and refused the whole thing. Fixed; it now applies to the live branch
with an offset of a few lines.

**The patch did not compile.** It ended with `cx.define(result, v)`, and
`FnCx` has no `define`. The method is `bind1`, which is what every other
arm of that match uses. The arithmetic was verified to the digit and the
one line of glue around it had never been through a compiler — which is
exactly the hole a verification script cannot see, and the reason
"verified" and "built" are different words.

**The prebuilt LLVM is gone.** The branch's `bootstrap.toml` sets
`download-ci-llvm = true`, and bootstrap resolves this branch to upstream
commit `116458d0`, for which `ci-artifacts.rust-lang.org` now 404s — CI
artifacts do not live forever and that commit is from July. This is not
a local problem: the upstream workflow would fail at the same step today,
on a GitHub runner, for anyone.

**And LLVM cannot simply be dropped.** Tempting, on a tree whose host is
wasm32 and whose backend is Cranelift: set `codegen-backends =
["cranelift"]` and there is nothing to download. It gets as far as
`compiler_builtins`, which has x86 inline assembly that Cranelift cannot
assemble — `Failed to assemble ... fma_with_fma__inline_asm`. The
x86_64 side needs a real LLVM. The script fetches the official LLVM
21.1.0 Linux release (the tree panics below 21) and points
`llvm-config` at it, which needs no root and nothing installed
system-wide.

One more, found on the way: the pinned stage0 beta (1.95.0-beta.1) ICEs
compiling `rustc_codegen_ssa` — `slice index starts at 5 but ends at 4`
in `check_mod_deathness` — with incremental compilation on. `incremental
= false` gets past it.

**Where it stands.** The build is configured and resumable; the clone,
the patch, the WASI SDK and the configuration are done, and what remains
is the LLVM download and the compile itself, which is hours. Until those
artifacts exist and `scripts/vendor-rust.mjs` pins them,
`data/rust-support.json` still says 2 of 7, because 2 of 7 is what the
*shipped* compiler does. Nothing in the site claims otherwise.

The other route is `rubrc`, and it is blocked for a different reason:
it needs `SharedArrayBuffer`, which needs cross-origin isolation, which
needs COOP and COEP headers that GitHub Pages does not send. A service
worker can synthesise them — `prototype/coi/` is a working one, and it
reports `crossOriginIsolated` true with a shared-memory round-trip
through a worker. What that does not solve is that rubrc publishes no
prebuilt artifacts and loads 13.7 MB of its own UI before it compiles
anything. The prototype is kept because the isolation question comes up
again for anything threaded, not because this is the way in.
