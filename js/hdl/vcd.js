/* ============================================================
   hdl/vcd.js — reading a Value Change Dump.

   A VCD is a header declaring signals and a body of timestamped
   changes. It is a sparse format by design: a signal appears in
   the body only at the instants its value changes, which is why
   a waveform viewer has to carry each signal's value forward
   rather than looking it up per pixel.

   The parser produces, per signal, a sorted list of
   `[time, value]` pairs, and the renderer asks "what was this
   at time t" with a binary search. That is the whole data
   structure, and it is what makes panning and zooming a
   million-sample trace cost nothing.

   Values are kept as the strings the file carries — "1", "0",
   "x", "z" for a scalar, and "b1010 1" style for a vector,
   stored without the leading b. They are NOT converted to
   numbers, for two reasons: a bus with an x in one bit has no
   numeric value and must still be displayable, and a 64-bit bus
   does not survive a double.
   ============================================================ */

const VCD = (() => {

  /* Scales, as the file writes them. The viewer shows times in the
     unit the file declares rather than converting, because a testbench
     written in `1ns/1ps` and reported in picoseconds is confusing in
     exactly the way a timing question should not be. */
  const UNITS = ['s', 'ms', 'us', 'ns', 'ps', 'fs'];

  function parseTimescale(text) {
    /* `$timescale 1ps $end`, or `1 ps`, or `10ns`. */
    const m = /\$timescale\s+(\d+)\s*(s|ms|us|ns|ps|fs)\s*\$end/.exec(text);
    if (!m) return { magnitude: 1, unit: 'ns' };
    return { magnitude: Number(m[1]), unit: m[2] };
  }

  /* One pass. The header and the body are separated by
     `$enddefinitions`, and everything before it is declarations. */
  function parse(text) {
    const src = String(text || '');
    const vars = {};          /* id -> { id, name, path, width, kind } */
    const order = [];         /* declaration order, which is the useful one */
    const scope = [];
    const timescale = parseTimescale(src);

    const lines = src.split('\n');
    let i = 0;
    let definitionsEnded = false;

    /* ---- the header ---- */
    for (; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('$enddefinitions')) { definitionsEnded = true; i += 1; break; }

      if (line.startsWith('$scope')) {
        const m = /\$scope\s+\w+\s+(\S+)/.exec(line);
        if (m) scope.push(m[1]);
        continue;
      }
      if (line.startsWith('$upscope')) { scope.pop(); continue; }

      if (line.startsWith('$var')) {
        /* `$var wire 4 ! y [3:0] $end` — kind, width, id, name, and an
           optional bit range that is part of the displayed name. */
        const m = /\$var\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(\[[^\]]*\])?\s*\$end/.exec(line);
        if (!m) continue;
        const [, kind, width, id, name, range] = m;
        if (!vars[id]) {
          vars[id] = {
            id,
            kind,
            width: Number(width),
            name: name + (range || ''),
            path: [...scope, name].join('.'),
            scope: scope.join('.'),
            changes: [],
          };
          order.push(id);
        } else {
          /* The same signal declared under two scopes — a port and the
             net it connects to. One series, both names. */
          vars[id].aliases = vars[id].aliases || [];
          vars[id].aliases.push([...scope, name].join('.'));
        }
      }
    }

    /* ---- the body ---- */
    let t = 0;
    let end = 0;
    const push = (id, value) => {
      const v = vars[id];
      if (!v) return;
      const last = v.changes[v.changes.length - 1];
      if (last && last[0] === t) { last[1] = value; return; }
      if (last && last[1] === value) return;   /* a repeat carries no information */
      v.changes.push([t, value]);
    };

    for (; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;

      const c = line[0];
      if (c === '#') {
        const next = Number(line.slice(1));
        if (Number.isFinite(next)) { t = next; if (t > end) end = t; }
        continue;
      }
      if (c === '$') continue;   /* $dumpvars, $dumpall, $end and friends */

      if (c === 'b' || c === 'B') {
        const sp = line.indexOf(' ');
        if (sp < 0) continue;
        push(line.slice(sp + 1).trim(), line.slice(1, sp));
        continue;
      }
      if (c === 'r' || c === 'R') {
        const sp = line.indexOf(' ');
        if (sp < 0) continue;
        push(line.slice(sp + 1).trim(), line.slice(1, sp));
        continue;
      }
      /* A scalar: one character of value, then the id with no space. */
      if ('01xXzZuU-'.includes(c)) {
        push(line.slice(1).trim(), c.toLowerCase());
      }
    }

    /* A signal that never changed after its initial value still has to
       be drawable to the end of the trace. */
    for (const id of order) {
      const v = vars[id];
      if (!v.changes.length) v.changes.push([0, 'x'.repeat(v.width) || 'x']);
    }

    return { vars, order, timescale, end, signals: order.map(id => vars[id]) };
  }

  /* What a signal was at time `t`. Binary search over the change list,
     which is sorted because the body of a VCD is in time order. */
  function valueAt(v, t) {
    const ch = v.changes;
    if (!ch.length) return null;
    if (t < ch[0][0]) return null;
    let lo = 0;
    let hi = ch.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ch[mid][0] <= t) lo = mid; else hi = mid - 1;
    }
    return ch[lo][1];
  }

  /* ---------------- how a value is shown ----------------

     A scalar is 0, 1, x or z. A vector is a string of those, one per
     bit, most significant first — and shortened by the writer, so a
     4-bit signal can arrive as "b0" meaning 0000. It is padded here
     rather than at every call site.

     A vector containing any x or z has no numeric value. Showing it as
     a number would be inventing one, so it is shown as the bits, or as
     the single character when every bit agrees. */
  function pad(value, width) {
    const s = String(value);
    if (!width || s.length >= width) return s;
    /* VCD extends with the leading character for x and z, and with 0
       for a value that starts with 0 or 1. */
    const fill = (s[0] === 'x' || s[0] === 'z') ? s[0] : '0';
    return fill.repeat(width - s.length) + s;
  }

  const hasUnknown = s => /[xzu-]/i.test(String(s));

  function format(value, width, base = 'hex') {
    if (value == null) return '';
    const bits = pad(value, width);

    if (width === 1) return bits;

    if (hasUnknown(bits)) {
      /* All the same unknown — the common case — says so once. */
      const uniq = new Set(bits.split(''));
      if (uniq.size === 1) return [...uniq][0].repeat(Math.min(width, 4));
      return base === 'bin' ? bits : bits;
    }

    if (base === 'bin') return bits;
    if (base === 'dec') {
      /* BigInt, because a 64-bit bus does not fit in a double. */
      try { return BigInt(`0b${bits}`).toString(10); } catch { return bits; }
    }
    /* hex, grouped from the right. */
    try {
      const hex = BigInt(`0b${bits}`).toString(16);
      return hex.padStart(Math.ceil(width / 4), '0');
    } catch { return bits; }
  }

  /* The time, in the unit the file declared, with the unit on it. */
  function timeText(t, timescale) {
    const n = t * (timescale.magnitude || 1);
    return `${n} ${timescale.unit}`;
  }

  /* Which signals are worth showing by default, and in what order.

     A VCD from `$dumpvars(0, tb)` contains the testbench's own
     variables and every port of every instance under it, which is two
     or three copies of each signal under different names. Showing all
     of them is a wall. So: the top scope's signals, in declaration
     order, with a clock first if one is recognisable. */
  function defaultSelection(doc, limit = 10) {
    const top = doc.signals.filter(v => !v.scope.includes('.'));
    const pool = top.length ? top : doc.signals;
    const isClock = v => /^(clk|clock|ck)\b/i.test(v.name);
    const clocks = pool.filter(isClock);
    const rest = pool.filter(v => !isClock(v) && v.kind !== 'parameter');
    return [...clocks, ...rest].slice(0, limit).map(v => v.id);
  }

  /* ---------------- two clocks, and they do not agree ----------------

     A testbench's `$time` is in its TIME UNIT; a VCD's timestamps are
     in its PRECISION. With the usual `timescale 1ns/1ps` those differ
     by a thousand, so a check that says "wrong at t=20" and a waveform
     tick numbered 20 are 20ns and 20ps — different instants by three
     orders of magnitude.

     That was a real bug in the click-to-the-failure feature: the
     cursor landed at 20ps, which is before anything in the simulation
     has happened, and the values it read out were all zero.

     The ratio is recoverable because the testbench declares both. This
     reads it from the source, which is the only place it is written
     down. Defaults to 1 when there is no directive, which is what a
     simulator does. */
  const EXP = { s: 0, ms: -3, us: -6, ns: -9, ps: -12, fs: -15 };

  function timescaleOf(source) {
    const m = /`timescale\s+(\d+)\s*(s|ms|us|ns|ps|fs)\s*\/\s*(\d+)\s*(s|ms|us|ns|ps|fs)/
      .exec(String(source || ''));
    if (!m) return { ratio: 1, unit: null, magnitude: 1 };
    const [, uMag, uUnit, pMag, pUnit] = m;
    const ratio = (Number(uMag) / Number(pMag)) * (10 ** (EXP[uUnit] - EXP[pUnit]));
    return {
      /* VCD ticks per one of the testbench's time units. */
      ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
      unit: uUnit,
      magnitude: Number(uMag),
    };
  }

  return {
    parse, valueAt, format, pad, hasUnknown, timeText, defaultSelection, UNITS,
    timescaleOf,
  };
})();
