/* Verify the missing `smulhi.i64` lowering by RUNNING it.

   `smulhi.i64 a, b` is the high 64 bits of the signed 128-bit product.
   WebAssembly has no such instruction, which is why the browser Rust
   compiler's CLIF-to-wasm translator refuses it — and why
   `parse::<i64>()` does not compile there, since
   `core::num::from_ascii_radix` reaches it through `checked_mul`.

   This builds the replacement instruction sequence, assembles it into a
   real WebAssembly module, instantiates it, and checks every result
   against BigInt's exact 128-bit arithmetic. Not a model of wasm
   semantics written in JavaScript: the actual module, run by the actual
   engine, which is the only reference worth having.

   The sequence is the one the patch emits, instruction for instruction,
   so a pass here is evidence about the patch rather than about the
   idea.

     node scripts/verify-mulhi.mjs
     node scripts/verify-mulhi.mjs --fuzz=200000

   Exit code 1 if any case disagrees. */

const FUZZ = Number((process.argv.find(a => a.startsWith('--fuzz=')) || '').slice(7)) || 50_000;

/* ---------------- a very small wasm encoder ---------------- */

const u8 = n => [n & 0xff];
const uleb = n => {
  const out = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return out;
};
const sleb = value => {
  const out = [];
  let v = BigInt(value);
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    if ((v === 0n && !signBit) || (v === -1n && signBit)) { out.push(byte); break; }
    out.push(byte | 0x80);
  }
  return out;
};
const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
const vec = items => [...uleb(items.length), ...items.flat()];

const I64 = 0x7e;
const OP = {
  localGet: i => [0x20, ...uleb(i)],
  localSet: i => [0x21, ...uleb(i)],
  localTee: i => [0x22, ...uleb(i)],
  i64Const: v => [0x42, ...sleb(v)],
  i64Add: [0x7c], i64Sub: [0x7d], i64Mul: [0x7e],
  i64And: [0x83], i64ShrS: [0x87], i64ShrU: [0x88],
  end: [0x0b],
};

/* ---------------- the sequence under test ----------------

   Locals: 0 = a, 1 = b (parameters), then scratch.

   umulhi64(a, b), the carry-correct 32-bit partial-product form — the
   same shape the translator's existing i128 multiply already uses, so
   this is lifting code that is already shipping rather than inventing
   any arithmetic:

     al = a & 0xffffffff   ah = a >>> 32
     bl = b & 0xffffffff   bh = b >>> 32
     lo_lo = al*bl
     mid1  = ah*bl + (lo_lo >>> 32)
     mid2  = al*bh + (mid1 & 0xffffffff)
     hi    = ah*bh + (mid1 >>> 32) + (mid2 >>> 32)

   and then the signed correction, which is the whole of the addition:

     smulhi(a,b) = umulhi(a,b) - ((a >> 63) & b) - ((b >> 63) & a)

   `>> 63` arithmetic is all-ones when the value is negative and zero
   otherwise, so each term subtracts the other operand exactly when this
   one is negative. Branchless, and it is the identity that turns an
   unsigned wide multiply into a signed one. */

const L = { a: 0, b: 1, al: 2, ah: 3, bl: 4, bh: 5, lolo: 6, mid1: 7, mid2: 8, hi: 9 };
const SCRATCH = 8; /* locals 2..9 */

function umulhiBody() {
  const c = [];
  const push = (...xs) => c.push(...xs.flat());

  push(OP.localGet(L.a), OP.i64Const(0xffffffffn), OP.i64And, OP.localSet(L.al));
  push(OP.localGet(L.a), OP.i64Const(32), OP.i64ShrU, OP.localSet(L.ah));
  push(OP.localGet(L.b), OP.i64Const(0xffffffffn), OP.i64And, OP.localSet(L.bl));
  push(OP.localGet(L.b), OP.i64Const(32), OP.i64ShrU, OP.localSet(L.bh));

  /* lo_lo = al*bl */
  push(OP.localGet(L.al), OP.localGet(L.bl), OP.i64Mul, OP.localSet(L.lolo));
  /* mid1 = ah*bl + (lo_lo >>> 32) */
  push(OP.localGet(L.ah), OP.localGet(L.bl), OP.i64Mul);
  push(OP.localGet(L.lolo), OP.i64Const(32), OP.i64ShrU, OP.i64Add, OP.localSet(L.mid1));
  /* mid2 = al*bh + (mid1 & 0xffffffff) */
  push(OP.localGet(L.al), OP.localGet(L.bh), OP.i64Mul);
  push(OP.localGet(L.mid1), OP.i64Const(0xffffffffn), OP.i64And, OP.i64Add, OP.localSet(L.mid2));
  /* hi = ah*bh + (mid1 >>> 32) + (mid2 >>> 32) */
  push(OP.localGet(L.ah), OP.localGet(L.bh), OP.i64Mul);
  push(OP.localGet(L.mid1), OP.i64Const(32), OP.i64ShrU, OP.i64Add);
  push(OP.localGet(L.mid2), OP.i64Const(32), OP.i64ShrU, OP.i64Add, OP.localSet(L.hi));

  return c;
}

function umulhiFn() {
  return [...umulhiBody(), ...OP.localGet(L.hi), ...OP.end];
}

function smulhiFn() {
  const c = [...umulhiBody()];
  const push = (...xs) => c.push(...xs.flat());
  /* hi -= (a >> 63) & b */
  push(OP.localGet(L.hi));
  push(OP.localGet(L.a), OP.i64Const(63), OP.i64ShrS, OP.localGet(L.b), OP.i64And, OP.i64Sub);
  /* hi -= (b >> 63) & a */
  push(OP.localGet(L.b), OP.i64Const(63), OP.i64ShrS, OP.localGet(L.a), OP.i64And, OP.i64Sub);
  push(OP.end);
  return c;
}

function moduleBytes() {
  const type = section(1, vec([[0x60, ...vec([[I64], [I64]]), ...vec([[I64]])]]));
  const func = section(3, vec([uleb(0), uleb(0)]));
  const name = s => [...uleb(s.length), ...[...s].map(ch => ch.charCodeAt(0))];
  const exp = section(7, vec([
    [...name('umulhi'), 0x00, ...uleb(0)],
    [...name('smulhi'), 0x00, ...uleb(1)],
  ]));
  const locals = vec([[...uleb(SCRATCH), I64]]);
  const bodyOf = code => {
    const b = [...locals, ...code];
    return [...uleb(b.length), ...b];
  };
  const codeSec = section(10, vec([bodyOf(umulhiFn()), bodyOf(smulhiFn())]));
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...type, ...func, ...exp, ...codeSec,
  ]);
}

/* ---------------- the independent reference ----------------

   BigInt, with no clever arithmetic in it: multiply the two values
   exactly, shift down 64, and take the low 64 bits of the result. There
   is nothing here that could share a bug with the sequence above. */

const asS64 = v => BigInt.asIntN(64, v);
const asU64 = v => BigInt.asUintN(64, v);

const refSmulhi = (a, b) => asS64((asS64(a) * asS64(b)) >> 64n);
const refUmulhi = (a, b) => asU64((asU64(a) * asU64(b)) >> 64n);

/* ---------------- run it ---------------- */

const bytes = moduleBytes();
let mod;
try {
  mod = new WebAssembly.Module(bytes);
} catch (err) {
  console.error('the module did not validate:', err.message);
  process.exit(1);
}
const { umulhi, smulhi } = new WebAssembly.Instance(mod).exports;
console.log(`assembled ${bytes.length} bytes of WebAssembly, validated and instantiated\n`);

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

/* Every boundary that has ever hidden a bug in a wide multiply: the
   extremes, the signs, the powers of two either side of the 32-bit
   split where the partial products carry, and the values a parser
   actually reaches. */
const EDGE = [
  0n, 1n, -1n, 2n, -2n,
  I64_MIN, I64_MAX, I64_MIN + 1n, I64_MAX - 1n,
  0x7fffffffn, 0x80000000n, 0x80000001n, 0xffffffffn, 0x100000000n,
  -0x7fffffffn, -0x80000000n, -0x80000001n, -0xffffffffn, -0x100000000n,
  0xffffffffffffffffn, 0xfffffffffffffffen,
  3n, 10n, -10n, 1000000007n, -1000000007n,
  /* what a decimal parser multiplies by, and the values it approaches */
  10n, 100n, 1000n, 922337203685477580n, -922337203685477580n,
];

let checked = 0;
const bad = [];
const check = (a, b) => {
  checked += 1;
  const gotS = smulhi(a, b);
  const wantS = refSmulhi(a, b);
  if (gotS !== wantS) bad.push({ op: 'smulhi', a, b, got: gotS, want: wantS });
  const gotU = BigInt.asUintN(64, umulhi(a, b));
  const wantU = refUmulhi(a, b);
  if (gotU !== wantU) bad.push({ op: 'umulhi', a, b, got: gotU, want: wantU });
};

for (const a of EDGE) for (const b of EDGE) check(asS64(a), asS64(b));
console.log(`${EDGE.length}x${EDGE.length} boundary pairs: ${bad.length ? 'FAILED' : 'all agree'}`);

/* The parsing path itself: what from_ascii_radix does to build an i64
   from decimal digits, one checked_mul at a time, right up to the point
   where it must overflow. */
const parseWalk = [];
for (const sign of [1n, -1n]) {
  let acc = 0n;
  for (const d of '9223372036854775807') {
    const next = acc * 10n + BigInt(d);
    parseWalk.push([asS64(sign * acc), 10n]);
    acc = next;
  }
}
for (const [a, b] of parseWalk) check(a, b);
console.log(`${parseWalk.length} steps of an actual i64 decimal parse: `
  + `${bad.length ? 'FAILED' : 'all agree'}`);

/* And fuzz, with the full 64-bit range reachable. */
const rnd64 = () => {
  let v = 0n;
  for (let i = 0; i < 4; i += 1) v = (v << 16n) | BigInt(Math.floor(Math.random() * 65536));
  return asS64(v);
};
for (let i = 0; i < FUZZ; i += 1) check(rnd64(), rnd64());
console.log(`${FUZZ.toLocaleString()} random pairs: ${bad.length ? 'FAILED' : 'all agree'}`);

console.log(`\n${checked.toLocaleString()} pairs checked, ${checked * 2} comparisons.`);
if (bad.length) {
  console.error(`\n${bad.length} disagreements. The first five:`);
  for (const d of bad.slice(0, 5)) {
    console.error(`  ${d.op}(${d.a}, ${d.b}) = ${d.got}, should be ${d.want}`);
  }
  process.exit(1);
}
console.log('The lowering agrees with exact 128-bit arithmetic on every case.');
