/* ============================================================
   maths/expr.js — what a typed mathematical answer means.

   Three jobs, kept apart on purpose:

     tokenise/parse   turn "3/8" or "(1+sqrt 5)/2" into a tree,
                      or say precisely where it stopped making
                      sense. A syntax error is not a wrong
                      answer and must never be reported as one.

     evaluate         turn that tree into an EXACT value.

     equal            decide whether two exact values are the
                      same number.

   ---------------- the value domain, stated ----------------

   Exact values live in Q(√d): numbers of the form

       p + q√d        p, q rational, d a square-free integer > 1

   which is closed under +, −, × and ÷, so the comparison is a
   decision procedure rather than a guess. Rationals are the
   case q = 0 and cover every probability answer here.

   What is deliberately NOT supported, and says so rather than
   guessing: π, e, logs, trigonometry, two different surds in
   one expression (√2 + √3), and symbolic variables. A problem
   whose answer needs any of those is authored as an
   `approximate` answer with a stated tolerance instead, which
   is an honest claim about what is being checked.

   ---------------- two rules ----------------

   No eval, anywhere. The parser is a few hundred lines and
   every production is written out; an answer box wired to
   eval() is a remote code execution hole in a learning site.

   No sampling. Agreeing at a few points is not equality, and a
   grader that says it is will one day accept x²−1 for (x−1)².
   Equality here is structural on a canonical form.
   ============================================================ */

const MathsExpr = (() => {

  /* ---------------- exact rationals ---------------- */

  const abs = x => (x < 0n ? -x : x);
  function gcd(a, b) {
    let x = abs(a);
    let y = abs(b);
    while (y) { const t = x % y; x = y; y = t; }
    return x;
  }

  class Rat {
    constructor(n, d = 1n) {
      if (d === 0n) throw new MathsError('division by zero', 'math');
      if (d < 0n) { n = -n; d = -d; }
      const g = gcd(n, d) || 1n;
      this.n = n / g;
      this.d = d / g;
    }
    static of(n, d) { return new Rat(BigInt(n), BigInt(d === undefined ? 1 : d)); }
    get isZero() { return this.n === 0n; }
    get isInt() { return this.d === 1n; }
    add(o) { return new Rat(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { return new Rat(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { return new Rat(this.n * o.n, this.d * o.d); }
    div(o) {
      if (o.isZero) throw new MathsError('division by zero', 'math');
      return new Rat(this.n * o.d, this.d * o.n);
    }
    neg() { return new Rat(-this.n, this.d); }
    eq(o) { return this.n === o.n && this.d === o.d; }
    cmp(o) { const l = this.n * o.d; const r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
    get sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
    pow(k) {
      if (!Number.isInteger(k)) throw new MathsError('only whole-number powers are supported', 'unsupported');
      if (k < 0) return ONE.div(this.pow(-k));
      let r = ONE;
      for (let i = 0; i < k; i += 1) r = r.mul(this);
      return r;
    }
    toNumber() { return Number(this.n) / Number(this.d); }
    toString() { return this.isInt ? String(this.n) : `${this.n}/${this.d}`; }
    /* For display: the fraction, and the decimal if it is not obvious. */
    describe() {
      if (this.isInt) return String(this.n);
      const dec = this.toNumber();
      return `${this.n}/${this.d}${Number.isFinite(dec) ? ` (${+dec.toFixed(6)})` : ''}`;
    }
  }

  const ZERO = Rat.of(0);
  const ONE = Rat.of(1);

  /* ---------------- exact values in Q(√d) ---------------- */

  /* Pull every square factor out of n, so √12 becomes 2√3 and the radicand
     that remains is square-free. Comparison depends on this being canonical. */
  function squareFree(n) {
    if (n <= 0n) throw new MathsError('only the square root of a positive number is supported', 'unsupported');
    let outside = 1n;
    let rest = n;
    for (let f = 2n; f * f <= rest; f += 1n) {
      const sq = f * f;
      while (rest % sq === 0n) { rest /= sq; outside *= f; }
    }
    return { outside, radicand: rest };
  }

  /* p + q√d. d === 1n means q is zero and this is just the rational p. */
  class Exact {
    constructor(p, q = ZERO, d = 1n) {
      if (q.isZero) { this.p = p; this.q = ZERO; this.d = 1n; } else { this.p = p; this.q = q; this.d = d; }
    }
    static rat(r) { return new Exact(r); }
    static int(n) { return new Exact(Rat.of(n)); }
    get isRational() { return this.q.isZero; }

    /* Two surds can only be combined when they are over the same radicand.
       √2 + √3 is a real number this module cannot represent, and saying so
       is better than silently approximating it. */
    _align(o) {
      if (this.isRational) return o.d;
      if (o.isRational || this.d === o.d) return this.d;
      throw new MathsError(
        `this would mix √${this.d} and √${o.d}, which this checker does not handle`,
        'unsupported',
      );
    }
    add(o) { const d = this._align(o); return new Exact(this.p.add(o.p), this.q.add(o.q), d); }
    sub(o) { const d = this._align(o); return new Exact(this.p.sub(o.p), this.q.sub(o.q), d); }
    neg() { return new Exact(this.p.neg(), this.q.neg(), this.d); }
    mul(o) {
      const d = this._align(o);
      /* (p + q√d)(r + s√d) = (pr + qsd) + (ps + qr)√d */
      const D = Rat.of(d);
      return new Exact(
        this.p.mul(o.p).add(this.q.mul(o.q).mul(D)),
        this.p.mul(o.q).add(this.q.mul(o.p)),
        d,
      );
    }
    div(o) {
      if (o.isRational) {
        if (o.p.isZero) throw new MathsError('division by zero', 'math');
        return new Exact(this.p.div(o.p), this.q.div(o.p), this.d);
      }
      /* Multiply above and below by the conjugate. */
      const D = Rat.of(o.d);
      const denom = o.p.mul(o.p).sub(o.q.mul(o.q).mul(D));
      if (denom.isZero) throw new MathsError('division by zero', 'math');
      const conj = new Exact(o.p, o.q.neg(), o.d);
      const top = this.mul(conj);
      return new Exact(top.p.div(denom), top.q.div(denom), top.d);
    }
    pow(k) {
      if (!Number.isInteger(k)) throw new MathsError('only whole-number powers are supported', 'unsupported');
      if (k < 0) return Exact.int(1).div(this.pow(-k));
      let r = Exact.int(1);
      for (let i = 0; i < k; i += 1) r = r.mul(this);
      return r;
    }
    eq(o) {
      if (this.isRational && o.isRational) return this.p.eq(o.p);
      if (this.isRational !== o.isRational) return false;
      return this.d === o.d && this.p.eq(o.p) && this.q.eq(o.q);
    }
    get sign() {
      if (this.isRational) return this.p.sign;
      return this.toNumber() < 0 ? -1 : this.toNumber() > 0 ? 1 : 0;
    }
    toNumber() {
      return this.p.toNumber() + (this.q.isZero ? 0 : this.q.toNumber() * Math.sqrt(Number(this.d)));
    }
    toString() {
      if (this.isRational) return this.p.toString();
      const q = this.q.eq(ONE) ? '' : this.q.eq(ONE.neg()) ? '-' : `${this.q}*`;
      const head = this.p.isZero ? '' : `${this.p} + `;
      return `${head}${q}sqrt(${this.d})`;
    }
    describe() {
      return this.isRational ? this.p.describe() : `${this} (${+this.toNumber().toFixed(6)})`;
    }
  }

  function sqrtOf(v) {
    if (!v.isRational) throw new MathsError('the square root of a surd is not supported', 'unsupported');
    const r = v.p;
    if (r.sign < 0) throw new MathsError('the square root of a negative number is not a real number', 'math');
    if (r.isZero) return Exact.int(0);
    /* √(n/m) = √(nm)/m */
    const inner = r.n * r.d;
    const { outside, radicand } = squareFree(inner);
    const coeff = new Rat(outside, r.d);
    if (radicand === 1n) return new Exact(coeff);
    return new Exact(ZERO, coeff, radicand);
  }

  /* ---------------- errors a reader can act on ---------------- */

  /* `kind` is the whole point. "syntax" means the checker could not read
     what was typed; "unsupported" means it read it and will not pretend to
     judge it; "math" means the expression is not a number at all. None of
     those is "your answer is wrong", and the page says so. */
  class MathsError extends Error {
    constructor(message, kind = 'syntax', at = null) {
      super(message);
      this.kind = kind;
      this.at = at;
    }
  }

  /* ---------------- tokens ---------------- */

  /* The characters a person actually types or pastes, folded to one form
     before anything tries to parse them. */
  const FOLD = new Map(Object.entries({
    '−': '-', '–': '-', '—': '-',
    '×': '*', '⋅': '*', '·': '*', '∗': '*',
    '÷': '/', '∕': '/', '⁄': '/',
    '（': '(', '）': ')', '［': '[', '］': ']', '｛': '{', '｝': '}',
    '’': "'", '“': '"', '”': '"',
    /* A space after, or "√9" tokenises as one identifier named sqrt9. */
    '√': 'sqrt ', '∞': 'infinity',
    '≤': '<=', '≥': '>=', '≠': '!=',
    '∪': 'U', '∅': '{}',
  }));

  function fold(input) {
    let out = '';
    for (const ch of String(input)) out += FOLD.has(ch) ? FOLD.get(ch) : ch;
    /* Superscript digits, which get pasted out of lecture notes. */
    return out.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, m =>
      `^${[...m].map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)).join('')}`);
  }

  const DIGIT = /[0-9]/;
  const IDSTART = /[A-Za-z_]/;
  const IDPART = /[A-Za-z_0-9]/;

  function tokenise(src) {
    const s = fold(src);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }

      if (DIGIT.test(c) || (c === '.' && DIGIT.test(s[i + 1] || ''))) {
        let j = i;
        while (j < s.length && DIGIT.test(s[j])) j += 1;
        if (s[j] === '.') { j += 1; while (j < s.length && DIGIT.test(s[j])) j += 1; }
        if (/[eE]/.test(s[j] || '') && /[-+0-9]/.test(s[j + 1] || '')) {
          j += 1;
          if (/[-+]/.test(s[j])) j += 1;
          while (j < s.length && DIGIT.test(s[j])) j += 1;
        }
        out.push({ t: 'num', v: s.slice(i, j), at: i });
        i = j;
        continue;
      }

      if (IDSTART.test(c)) {
        let j = i;
        while (j < s.length && IDPART.test(s[j])) j += 1;
        out.push({ t: 'id', v: s.slice(i, j), at: i });
        i = j;
        continue;
      }

      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '!=' || two === '**') {
        out.push({ t: two === '**' ? 'op' : 'cmp', v: two === '**' ? '^' : two, at: i });
        i += 2;
        continue;
      }

      if ('+-*/^(),{}[]!'.includes(c)) { out.push({ t: 'op', v: c, at: i }); i += 1; continue; }
      if ('<>='.includes(c)) { out.push({ t: 'cmp', v: c, at: i }); i += 1; continue; }

      throw new MathsError(`I do not understand the character "${c}"`, 'syntax', i);
    }
    out.push({ t: 'end', v: '', at: s.length });
    return out;
  }

  /* ---------------- the grammar ----------------

       expr    := term (('+' | '-') term)*
       term    := unary (('*' | '/' | implicit) unary)*
       unary   := ('-' | '+') unary | power
       power   := atom ('^' unary)? | atom '!'
       atom    := number | 'sqrt' '(' expr ')' | name '(' args ')'
                | '(' expr ')' | name
  */

  const FUNCTIONS = {
    sqrt: { arity: 1, fn: a => sqrtOf(a) },
    abs: { arity: 1, fn: a => (a.sign < 0 ? a.neg() : a) },
    min: { arity: 2, fn: (a, b) => (a.toNumber() <= b.toNumber() ? a : b) },
    max: { arity: 2, fn: (a, b) => (a.toNumber() >= b.toNumber() ? a : b) },
    /* Counting, which probability answers are full of. Exact, on BigInt. */
    choose: { arity: 2, fn: (a, b) => Exact.rat(binom(intOf(a, 'choose'), intOf(b, 'choose'))) },
    binom: { arity: 2, fn: (a, b) => Exact.rat(binom(intOf(a, 'binom'), intOf(b, 'binom'))) },
    C: { arity: 2, fn: (a, b) => Exact.rat(binom(intOf(a, 'C'), intOf(b, 'C'))) },
    P: { arity: 2, fn: (a, b) => Exact.rat(perm(intOf(a, 'P'), intOf(b, 'P'))) },
    perm: { arity: 2, fn: (a, b) => Exact.rat(perm(intOf(a, 'perm'), intOf(b, 'perm'))) },
    factorial: { arity: 1, fn: a => Exact.rat(Rat.of(fact(intOf(a, 'factorial')))) },
  };

  function intOf(v, who) {
    if (!v.isRational || !v.p.isInt) {
      throw new MathsError(`${who} needs whole numbers`, 'unsupported');
    }
    return v.p.n;
  }
  function fact(n) {
    if (n < 0n) throw new MathsError('a factorial needs a number that is not negative', 'math');
    if (n > 2000n) throw new MathsError('that factorial is too large to work out', 'unsupported');
    let r = 1n;
    for (let i = 2n; i <= n; i += 1n) r *= i;
    return r;
  }
  function binom(n, k) {
    if (k < 0n || k > n) return ZERO;
    if (n < 0n) throw new MathsError('choose needs a number that is not negative', 'math');
    let r = 1n;
    const kk = k > n - k ? n - k : k;
    for (let i = 0n; i < kk; i += 1n) r = (r * (n - i)) / (i + 1n);
    return Rat.of(r);
  }
  function perm(n, k) {
    if (k < 0n || k > n) return ZERO;
    let r = 1n;
    for (let i = 0n; i < k; i += 1n) r *= (n - i);
    return Rat.of(r);
  }

  /* Bare names. Deliberately short: anything not here is rejected by name
     rather than guessed at. */
  const CONSTANTS = {
    /* None are exact in Q(√d); they exist so the error can say so clearly
       instead of "I do not understand the character p". */
    pi: 'π', e: 'e', ln: 'ln', log: 'log', sin: 'sin', cos: 'cos', tan: 'tan',
    exp: 'exp', infinity: '∞',
  };

  function parse(src) {
    const ts = tokenise(src);
    let i = 0;
    const peek = () => ts[i];
    const eat = (t, v) => {
      const tok = ts[i];
      if (tok.t === t && (v === undefined || tok.v === v)) { i += 1; return tok; }
      return null;
    };
    const expect = (t, v, what) => {
      const tok = eat(t, v);
      if (!tok) {
        throw new MathsError(
          `expected ${what || v} but found ${ts[i].t === 'end' ? 'the end of the answer' : `"${ts[i].v}"`}`,
          'syntax', ts[i].at,
        );
      }
      return tok;
    };

    function number(tok) {
      const text = tok.v;
      if (!/[.eE]/.test(text)) return { k: 'num', v: Exact.rat(new Rat(BigInt(text))) };
      /* A decimal is exact: 0.25 is 1/4, not an approximation of it. */
      const m = /^(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(text);
      if (!m) throw new MathsError(`"${text}" is not a number I can read`, 'syntax', tok.at);
      const whole = m[1] || '0';
      const frac = m[2] || '';
      const exp = Number(m[3] || 0);
      let n = BigInt(whole + frac);
      let d = 10n ** BigInt(frac.length);
      if (exp > 0) n *= 10n ** BigInt(exp);
      if (exp < 0) d *= 10n ** BigInt(-exp);
      return { k: 'num', v: Exact.rat(new Rat(n, d)) };
    }

    function args() {
      const list = [];
      expect('op', '(', '(');
      if (!eat('op', ')')) {
        for (;;) {
          list.push(expr());
          if (eat('op', ',')) continue;
          expect('op', ')', ')');
          break;
        }
      }
      return list;
    }

    function atom() {
      const tok = peek();
      if (tok.t === 'num') { i += 1; return number(tok); }

      if (tok.t === 'op' && tok.v === '(') {
        i += 1;
        const e = expr();
        expect('op', ')', 'a closing bracket');
        return e;
      }

      if (tok.t === 'id') {
        i += 1;
        const name = tok.v;
        const fn = FUNCTIONS[name] || FUNCTIONS[name.toLowerCase()];
        if (fn) {
          /* `sqrt 2` is as common as `sqrt(2)` in handwriting. */
          const list = peek().t === 'op' && peek().v === '('
            ? args()
            : [unary()];
          if (list.length !== fn.arity) {
            throw new MathsError(
              `${name} takes ${fn.arity} ${fn.arity === 1 ? 'number' : 'numbers'}, not ${list.length}`,
              'syntax', tok.at,
            );
          }
          return { k: 'call', fn, name, args: list };
        }
        if (CONSTANTS[name.toLowerCase()]) {
          throw new MathsError(
            `this answer box checks exact values, and ${CONSTANTS[name.toLowerCase()]} is not one it can compare. `
            + 'If the question asked for a decimal, type the decimal.',
            'unsupported', tok.at,
          );
        }
        throw new MathsError(`I do not know what "${name}" means here`, 'syntax', tok.at);
      }

      throw new MathsError(
        tok.t === 'end' ? 'the answer stops here, and something was expected'
          : `"${tok.v}" is not something I can read here`,
        'syntax', tok.at,
      );
    }

    function power() {
      let base = atom();
      while (eat('op', '!')) base = { k: 'call', fn: FUNCTIONS.factorial, name: 'factorial', args: [base] };
      if (eat('op', '^')) return { k: 'pow', a: base, b: unary() };
      return base;
    }

    function unary() {
      if (eat('op', '-')) return { k: 'neg', a: unary() };
      if (eat('op', '+')) return unary();
      return power();
    }

    /* Implicit multiplication, but only where it cannot be ambiguous: a
       number or a closing bracket, followed by a NAME or an opening bracket.

       `2(3+1)` and `3 sqrt 2` work. `ab` does not become a*b, because that
       is far more likely to be a mistyped name. And `1 2` is refused rather
       than read as 2 — two numbers with a space between them is a typo
       every time, and quietly multiplying them would turn a slip into a
       wrong answer the reader cannot explain. */
    const startsImplicit = () => {
      const t = peek();
      return (t.t === 'id') || (t.t === 'op' && t.v === '(');
    };

    function term() {
      let left = unary();
      for (;;) {
        if (eat('op', '*')) { left = { k: 'mul', a: left, b: unary() }; continue; }
        if (eat('op', '/')) { left = { k: 'div', a: left, b: unary() }; continue; }
        const prev = ts[i - 1];
        if (startsImplicit() && prev && (prev.t === 'num' || (prev.t === 'op' && prev.v === ')'))) {
          left = { k: 'mul', a: left, b: unary() };
          continue;
        }
        return left;
      }
    }

    function expr() {
      let left = term();
      for (;;) {
        if (eat('op', '+')) { left = { k: 'add', a: left, b: term() }; continue; }
        if (eat('op', '-')) { left = { k: 'sub', a: left, b: term() }; continue; }
        return left;
      }
    }

    const tree = expr();
    if (peek().t !== 'end') {
      throw new MathsError(
        `there is something after the end of the expression: "${peek().v}"`,
        'syntax', peek().at,
      );
    }
    return tree;
  }

  function evaluate(node) {
    switch (node.k) {
      case 'num': return node.v;
      case 'neg': return evaluate(node.a).neg();
      case 'add': return evaluate(node.a).add(evaluate(node.b));
      case 'sub': return evaluate(node.a).sub(evaluate(node.b));
      case 'mul': return evaluate(node.a).mul(evaluate(node.b));
      case 'div': return evaluate(node.a).div(evaluate(node.b));
      case 'pow': {
        const b = evaluate(node.b);
        if (!b.isRational || !b.p.isInt) {
          throw new MathsError('only whole-number powers are supported', 'unsupported');
        }
        return evaluate(node.a).pow(Number(b.p.n));
      }
      case 'call': return node.fn.fn(...node.args.map(evaluate));
      default: throw new MathsError('that expression is more than this checker handles', 'unsupported');
    }
  }

  /* The one entry point most callers want: text in, exact value or a
     described failure out. Never throws. */
  function read(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: false, kind: 'empty', message: 'Nothing was entered.' };
    try {
      return { ok: true, value: evaluate(parse(raw)), text: raw };
    } catch (err) {
      if (err instanceof MathsError) {
        return { ok: false, kind: err.kind, message: err.message, at: err.at };
      }
      return { ok: false, kind: 'syntax', message: 'I could not read that as a number.' };
    }
  }

  /* Exact equality of two answers, as values rather than as strings. 1/2,
     0.5, 2/4 and (3-1)/4*1 are the same answer; "0.5" and "1/2" compared as
     text are not. */
  function sameValue(a, b) {
    const x = read(a);
    const y = read(b);
    if (!x.ok || !y.ok) return false;
    return x.value.eq(y.value);
  }

  /* ---------------- sets and intervals ----------------

     A separate little grammar, because `{2, 1}` is the same answer as
     `{1, 2}` and `[0,1]` is not the same as `(0,1)`, and neither fact
     survives a string comparison. */

  function readSet(text) {
    const raw = fold(String(text == null ? '' : text)).trim();
    if (!raw) return { ok: false, kind: 'empty', message: 'Nothing was entered.' };
    if (!/^\{[\s\S]*\}$/.test(raw)) {
      return {
        ok: false, kind: 'syntax',
        message: 'A set is written inside braces, like {1, 2, 3} — or {} for the empty set.',
      };
    }
    const inner = raw.slice(1, -1).trim();
    if (!inner) return { ok: true, members: [] };
    const parts = splitTop(inner, ',');
    const members = [];
    for (const part of parts) {
      const v = read(part);
      if (!v.ok) {
        return { ok: false, kind: v.kind, message: `in "${part.trim()}": ${v.message}` };
      }
      if (!members.some(m => m.eq(v.value))) members.push(v.value);
    }
    return { ok: true, members };
  }

  /* Split on a separator that is not inside brackets. */
  function splitTop(s, sep) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) depth -= 1;
      else if (c === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    }
    out.push(s.slice(start));
    return out;
  }

  function sameSet(a, b) {
    const x = readSet(a);
    const y = readSet(b);
    if (!x.ok || !y.ok) return false;
    if (x.members.length !== y.members.length) return false;
    return x.members.every(m => y.members.some(n => m.eq(n)));
  }

  /* An interval, or a union of them. `(0,1]`, `[0,1) U (2,3)`, `{}`. */
  function readIntervals(text) {
    const raw = fold(String(text == null ? '' : text)).trim();
    if (!raw) return { ok: false, kind: 'empty', message: 'Nothing was entered.' };
    if (raw === '{}' || /^(empty|emptyset)$/i.test(raw)) return { ok: true, parts: [] };

    const pieces = splitTop(raw, 'U').map(s => s.trim()).filter(Boolean);
    const parts = [];
    for (const piece of pieces) {
      const m = /^([[(])\s*([^,]+?)\s*,\s*([^,]+?)\s*([\])])$/.exec(piece);
      if (!m) {
        return {
          ok: false, kind: 'syntax',
          message: `"${piece}" is not an interval. Write them like (0,1), [0,1], (0,1] or [0,1), `
            + 'and join several with U.',
        };
      }
      const lo = read(m[2]);
      const hi = read(m[3]);
      if (!lo.ok) return { ok: false, kind: lo.kind, message: `the left end of ${piece}: ${lo.message}` };
      if (!hi.ok) return { ok: false, kind: hi.kind, message: `the right end of ${piece}: ${hi.message}` };
      if (lo.value.toNumber() > hi.value.toNumber()) {
        return {
          ok: false, kind: 'math',
          message: `${piece} has its ends the wrong way round.`,
        };
      }
      parts.push({
        lo: lo.value, hi: hi.value,
        loClosed: m[1] === '[', hiClosed: m[4] === ']',
      });
    }
    parts.sort((a, b) => a.lo.toNumber() - b.lo.toNumber()
      || (a.loClosed === b.loClosed ? 0 : a.loClosed ? -1 : 1));
    return { ok: true, parts };
  }

  function sameIntervals(a, b) {
    const x = readIntervals(a);
    const y = readIntervals(b);
    if (!x.ok || !y.ok) return false;
    if (x.parts.length !== y.parts.length) return false;
    return x.parts.every((p, i) => {
      const q = y.parts[i];
      return p.lo.eq(q.lo) && p.hi.eq(q.hi)
        && p.loClosed === q.loClosed && p.hiClosed === q.hiClosed;
    });
  }

  return {
    Rat, Exact, MathsError,
    tokenise, parse, evaluate, read, sameValue,
    readSet, sameSet, readIntervals, sameIntervals,
    sqrtOf, binom, perm, fact,
    /* Exposed so a grader can explain itself. */
    describe: text => { const r = read(text); return r.ok ? r.value.describe() : null; },
  };
})();
