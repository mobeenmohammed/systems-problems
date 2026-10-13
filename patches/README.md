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

**What it does not do.** It is not built. Turning this into a browser
artifact means building a patched rustc for wasm32 — `AngelOnFira/rust`
at `riw-wasm20` through the `AngelOnFira/wasm-rustc` build repository,
which produces `rustc-wasm.tar.zst` and the sysroots. That is a
multi-hour bootstrap on Linux and it is not something this repository
does or should do. The patch and its evidence are here so that it can be
sent upstream; `data/rust-support.json` still says 2 of 7, because 2 of
7 is what the shipped compiler does.
