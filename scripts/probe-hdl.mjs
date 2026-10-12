/* The SystemVerilog compatibility probe.

   Before anything is built on top of Icarus-in-the-browser, find out
   what it actually does — feature by feature, through the real
   vendored toolchain, with a program for each one whose output is
   known in advance.

   This is the list the work was specified against:

     modules, ports, parameters, bit vectors
     combinational logic
     logic, always_comb, always_ff
     clocked logic, non-blocking assignment, reset
     a small state machine
     testbench clock generation and $finish
     compiler diagnostics, and a failing check
     unknown (x) and high-impedance (z)

   plus the three that matter for not freezing a tab:

     an endless clock
     a zero-time loop
     a valid run straight after a stopped one

   Every case states what it expects. A case that compiles and runs
   but prints the wrong thing is a FAIL here, not a pass with a note —
   the point of the exercise is to find out which of these can be
   taught with, and a feature that silently does the wrong thing is
   worse than one that is missing.

     node scripts/probe-hdl.mjs
     node scripts/probe-hdl.mjs --only=fsm
     node scripts/probe-hdl.mjs --json   (machine-readable, for the report) */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Simulator, GENERATION, gradeChecks, toolchainLimit } from '../js/hdl/toolchain.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = `file://${path.join(ROOT, 'vendor', 'verilog').replace(/\\/g, '/')}/`;
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const JSON_OUT = process.argv.includes('--json');

const say = (...a) => { if (!JSON_OUT) console.log(...a); };

/* ---------------- the cases ---------------- */

const TB_HEAD = '`timescale 1ns/1ps\n';

const cases = [
  {
    id: 'module-ports-params',
    what: 'modules, named ports, a parameter and a bit vector',
    design: `module mux2 #(parameter int W = 4) (
  input  logic [W-1:0] a, b,
  input  logic         sel,
  output logic [W-1:0] y
);
  assign y = sel ? b : a;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic [7:0] a, b, y;
  logic sel;
  mux2 #(.W(8)) dut (.a(a), .b(b), .sel(sel), .y(y));
  initial begin
    a = 8'hA5; b = 8'h3C; sel = 0; #1;
    $display("CHECK low %h %h", 8'ha5, y);
    sel = 1; #1;
    $display("CHECK high %h %h", 8'h3c, y);
    $display("DONE 2");
    $finish;
  end
endmodule
`,
    want: ['low', 'high'],
  },

  {
    id: 'always-comb',
    what: '`logic`, `always_comb`, and a sensitivity list inferred',
    design: `module adder (
  input  logic [3:0] a, b,
  output logic [4:0] sum,
  output logic       any
);
  always_comb begin
    sum = a + b;
    any = |a;
  end
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic [3:0] a, b;
  logic [4:0] sum;
  logic any;
  adder dut (.a(a), .b(b), .sum(sum), .any(any));
  initial begin
    a = 4'd9; b = 4'd8; #1;
    $display("CHECK sum %0d %0d", 17, sum);
    $display("CHECK any 1 %b", any);
    a = 4'd0; #1;
    $display("CHECK zero 0 %b", any);
    $display("DONE 3");
    $finish;
  end
endmodule
`,
    want: ['sum', 'any', 'zero'],
  },

  {
    id: 'always-ff',
    what: '`always_ff`, a posedge clock, non-blocking assignment, sync reset',
    design: `module counter (
  input  logic       clk,
  input  logic       rst,
  input  logic       en,
  output logic [3:0] q
);
  always_ff @(posedge clk) begin
    if (rst)      q <= 4'd0;
    else if (en)  q <= q + 4'd1;
  end
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0, rst = 1, en = 0;
  logic [3:0] q;
  counter dut (.clk(clk), .rst(rst), .en(en), .q(q));
  always #5 clk = ~clk;
  initial begin
    @(posedge clk); @(negedge clk);
    $display("CHECK after_reset 0 %0d AT %0d", q, $time);
    rst = 0; en = 1;
    repeat (3) @(posedge clk);
    @(negedge clk);
    $display("CHECK counted_3 3 %0d AT %0d", q, $time);
    en = 0;
    repeat (2) @(posedge clk);
    @(negedge clk);
    $display("CHECK held 3 %0d AT %0d", q, $time);
    $display("DONE 3");
    $finish;
  end
endmodule
`,
    want: ['after_reset', 'counted_3', 'held'],
  },

  {
    id: 'async-reset',
    what: 'asynchronous reset in the sensitivity list',
    design: `module ff_async (
  input  logic clk,
  input  logic rst_n,
  input  logic d,
  output logic q
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) q <= 1'b0;
    else        q <= d;
  end
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0, rst_n = 1, d = 1, q;
  ff_async dut (.clk(clk), .rst_n(rst_n), .d(d), .q(q));
  always #5 clk = ~clk;
  initial begin
    @(posedge clk); #1;
    $display("CHECK loaded 1 %b", q);
    rst_n = 0; #1;
    $display("CHECK async_cleared 0 %b AT %0d", q, $time);
    rst_n = 1;
    @(posedge clk); #1;
    $display("CHECK reloaded 1 %b", q);
    $display("DONE 3");
    $finish;
  end
endmodule
`,
    want: ['loaded', 'async_cleared', 'reloaded'],
  },

  {
    id: 'fsm',
    what: 'an enum-typed state machine with a registered output',
    design: `module detect101 (
  input  logic clk,
  input  logic rst,
  input  logic din,
  output logic found
);
  typedef enum logic [1:0] { S0, S1, S10 } state_t;
  state_t state, next;

  // if/else rather than a ternary on purpose: the conditional
  // operator over two enum literals has an integral type, and Icarus
  // enforces the SystemVerilog rule that assigning that to an enum
  // needs an explicit cast, so the ternary form is rejected with
  // "This assignment requires an explicit cast."
  always_comb begin
    unique case (state)
      S0:  if (din) next = S1;  else next = S0;
      S1:  if (din) next = S1;  else next = S10;
      S10: if (din) next = S1;  else next = S0;
      default: next = S0;
    endcase
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      state <= S0;
      found <= 1'b0;
    end else begin
      state <= next;
      found <= (state == S10) && din;
    end
  end
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0, rst = 1, din = 0, found;
  detect101 dut (.clk(clk), .rst(rst), .din(din), .found(found));
  always #5 clk = ~clk;
  int hits = 0;
  logic [5:0] stim = 6'b101101;
  initial begin
    @(posedge clk); rst = 0;
    // 1 0 1 1 0 1  -> two overlapping 101s
    for (int i = 5; i >= 0; i--) begin
      din = stim[i];
      @(posedge clk);
      #1 if (found) hits++;
    end
    din = 0;
    @(posedge clk); #1;
    $display("CHECK hits 2 %0d", hits);
    $display("DONE 1");
    $finish;
  end
endmodule
`,
    want: ['hits'],
  },

  {
    id: 'x-and-z',
    what: 'unknown (x) and high-impedance (z)',
    design: `module tri_buf (
  input  logic oe,
  input  logic d,
  output wire  y
);
  assign y = oe ? d : 1'bz;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic oe, d;
  wire y;
  logic [3:0] un;
  tri_buf dut (.oe(oe), .d(d), .y(y));
  initial begin
    oe = 1; d = 1; #1;
    $display("CHECK driven 1 %b", y);
    oe = 0; #1;
    $display("CHECK floating z %b", y);
    $display("CHECK unknown xxxx %b", un);
    // The === operator is the four-state comparison and is in this
    // port. $isunknown() is NOT: see the unsupported-task probe.
    $display("CHECK is_x 1 %b", un[0] === 1'bx);
    $display("DONE 4");
    $finish;
  end
endmodule
`,
    want: ['driven', 'floating', 'unknown', 'is_x'],
  },

  {
    id: 'vcd',
    what: '$dumpfile / $dumpvars produce a VCD with the signals in it',
    design: `module wiggle (input logic clk, output logic [2:0] cnt);
  always_ff @(posedge clk) cnt <= cnt + 3'd1;
  initial cnt = 3'd0;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0;
  logic [2:0] cnt;
  wiggle dut (.clk(clk), .cnt(cnt));
  always #5 clk = ~clk;
  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (8) @(posedge clk);
    // After the clock edge, before the non-blocking update: #1 so the
    // value read is the one the edge produced. Getting this wrong is
    // the commonest testbench bug there is, and it is why every
    // exercise's harness samples away from the edge.
    #1 $display("CHECK cnt 0 %0d", cnt);
    $display("DONE 1");
    $finish;
  end
endmodule
`,
    want: ['cnt'],
    expectVcd: true,
  },

  {
    id: 'diagnostics',
    what: 'a compile error, with a file and a line',
    design: `module broken (input logic a, output logic y);
  assign y = a +;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic a, y;
  broken dut (.a(a), .y(y));
  initial begin $display("DONE 0"); $finish; end
endmodule
`,
    expectCompileError: true,
  },

  {
    id: 'missing-module',
    what: 'an elaboration error: the testbench names a module that is not there',
    design: `module something_else (input logic a, output logic y);
  assign y = a;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic a, y;
  counter dut (.a(a), .y(y));
  initial begin $display("DONE 0"); $finish; end
endmodule
`,
    expectCompileError: true,
  },

  {
    id: 'failing-check',
    what: 'a wrong design fails, and the failure says the expected and actual values',
    design: `module counter (
  input  logic clk, input logic rst, input logic en, output logic [3:0] q
);
  // deliberately wrong: ignores en
  always_ff @(posedge clk) q <= rst ? 4'd0 : q + 4'd1;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0, rst = 1, en = 0;
  logic [3:0] q;
  counter dut (.clk(clk), .rst(rst), .en(en), .q(q));
  always #5 clk = ~clk;
  initial begin
    @(posedge clk); @(negedge clk);
    rst = 0; en = 0;
    repeat (2) @(posedge clk); @(negedge clk);
    $display("CHECK held 0 %0d AT %0d", q, $time);
    $display("DONE 1");
    $finish;
  end
endmodule
`,
    want: ['held'],
    expectFail: true,
  },

  {
    id: 'premature-end',
    what: 'a run that stops before the testbench finishes is incomplete, not passed',
    design: `module dut_stub (input logic clk, output logic q);
  assign q = 1'b1;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0, q;
  dut_stub dut (.clk(clk), .q(q));
  initial begin
    $display("CHECK first 1 %b", q);
    $finish;                       // stops before the second check and DONE
    $display("CHECK second 1 %b", q);
    $display("DONE 2");
  end
endmodule
`,
    want: ['first', 'second'],
    expectIncomplete: true,
  },

  {
    id: 'unsupported-task',
    what: 'a system task this port does not have is a toolchain limit, not a wrong answer',
    design: `module pass_through (input logic d, output logic q);
  assign q = d;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic d = 1, q;
  logic [3:0] un;
  pass_through dut (.d(d), .q(q));
  initial begin
    $display("CHECK through 1 %b", q);
    $display("CHECK unknown 1 %b", $isunknown(un));   // not in this port
    $display("DONE 2");
    $finish;
  end
endmodule
`,
    want: ['through', 'unknown'],
    expectUnsupported: '$isunknown',
  },

  {
    id: 'endless-clock',
    what: 'a clock with no $finish — must be stopped from outside, not freeze',
    design: `module spin (input logic clk, output logic [7:0] n);
  always_ff @(posedge clk) n <= n + 8'd1;
  initial n = 0;
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0;
  logic [7:0] n;
  spin dut (.clk(clk), .n(n));
  always #5 clk = ~clk;
  initial $display("CHECK started 1 1");
  // no $finish, ever
endmodule
`,
    runaway: true,
  },

  {
    id: 'zero-time-loop',
    what: 'a loop that never advances simulated time',
    /* Found by trying four shapes rather than by assuming, and three
       of the four are NOT dangerous:

         always begin ... end with no delay   rejected at compile time,
           "always process does not have any delay. A runtime infinite
           loop will occur." — a diagnostic, not a hang.
         always_comb a = ~b; always_comb b = ~a;   settles. The values
           reach a consistent pair and nothing re-triggers.
         always @(a) a = ~a;   settles too, for the same reason.

       The one that really does spin forever is an unconditional
       `forever` with no delay in it, which Icarus accepts. */
    design: `module spin_forever (output logic [7:0] n);
  integer k = 0;
  initial forever k = k + 1;
  assign n = k[7:0];
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic [7:0] n;
  spin_forever dut (.n(n));
  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    $display("CHECK started 1 1");
    #100 $finish;        // never reached: time does not advance
  end
endmodule
`,
    runaway: true,
  },

  {
    id: 'delayless-always',
    what: 'an always block with no delay is refused at compile time, not at run time',
    design: `module no_delay (input logic clk, output logic [7:0] n);
  always begin n = n + 8'd1; end
endmodule
`,
    tb: `${TB_HEAD}module tb;
  logic clk = 0;
  logic [7:0] n;
  no_delay dut (.clk(clk), .n(n));
  initial begin $display("DONE 0"); $finish; end
endmodule
`,
    expectCompileError: true,
  },
];

/* ---------------- run them ---------------- */

const sim = new Simulator({
  baseUrl: VENDOR,
  load: name => import(new URL(name, VENDOR).href),
});

say('loading the simulator… ');
const t0 = Date.now();
await sim.init();
say(`${Date.now() - t0} ms`);
say(`${sim.constructor.name}: Icarus Verilog, generation ${GENERATION}\n`);

const results = [];
const todo = cases.filter(c => !ONLY || c.id.includes(ONLY));

for (const c of todo) {
  const started = Date.now();
  const row = { id: c.id, what: c.what };

  const built = await sim.build(
    { 'design.sv': c.design, 'testbench.sv': c.tb },
    { files: { 'design.sv': 'design.sv', 'testbench.sv': 'testbench.sv' } },
  );

  if (c.expectCompileError) {
    const errs = built.diagnostics.filter(d => d.level === 'error');
    const located = errs.filter(d => d.file && d.line);
    row.ok = !built.ok && errs.length > 0;
    row.note = row.ok
      ? `${errs.length} error(s), ${located.length} with a file and line`
        + `${located[0] ? ` — ${located[0].file}:${located[0].line}` : ''}`
      : (built.ok ? 'it compiled, and should not have' : 'it failed with no diagnostic');
    row.sample = (errs[0] || {}).rendered || null;
    results.push({ ...row, ms: Date.now() - started });
    continue;
  }

  if (!built.ok) {
    row.ok = false;
    row.note = `did not compile: ${built.stderr.split('\n')[0]}`;
    results.push({ ...row, ms: Date.now() - started });
    continue;
  }

  if (c.runaway) {
    /* Not run here. The whole point of these two is that they never
       return, so running them in this process would hang the probe —
       which is exactly what they would do to a tab without a worker
       to terminate. They are driven in tests/browser/hdl.test.mjs,
       where there is a worker to kill and a page to prove is still
       alive afterwards. */
    row.ok = true;
    row.note = 'compiles; bounded by terminating the worker — driven in the browser suite';
    results.push({ ...row, ms: Date.now() - started });
    continue;
  }

  const ran = await sim.simulate(built.vvp);
  const graded = gradeChecks(ran.output, c.want || [], { finished: ran.finished });

  if (c.expectUnsupported) {
    /* vvp refuses to start a program that calls a system task it does
       not have: "System task/function $x() is not defined by any
       module", then "Program not runnable". It compiles, so this is
       not a diagnostic a reader can act on by fixing their design —
       it is the simulator saying it does not have the feature, and
       grading it as a wrong answer would be blaming the reader for
       the toolchain. */
    const limit = toolchainLimit(ran.output);
    row.ok = !!limit && limit.includes(c.expectUnsupported);
    row.note = row.ok
      ? `recognised as a toolchain limit: ${limit}`
      : `expected to recognise ${c.expectUnsupported} as unsupported; got ${
        JSON.stringify(ran.output.slice(0, 120))}`;
  } else if (c.expectIncomplete) {
    row.ok = !!graded.incomplete && !graded.correct;
    row.note = row.ok
      ? `incomplete, as it should be: ${graded.incomplete}`
      : `expected an incomplete run, got correct=${graded.correct}`;
  } else if (c.expectFail) {
    const f = graded.firstFailure;
    row.ok = !graded.correct && !graded.incomplete && !!f && f.expect != null;
    row.note = row.ok
      ? `failed with values: ${f.name} expected ${f.expect}, got ${f.actual}`
        + `${f.at != null ? ` at t=${f.at}` : ''}`
      : `expected a value failure, got correct=${graded.correct} incomplete=${graded.incomplete}`;
  } else {
    row.ok = graded.correct;
    row.note = graded.correct
      ? `${graded.passed}/${graded.total} checks`
      : `${graded.passed}/${graded.total} — ${graded.incomplete
        || `${(graded.firstFailure || {}).name}: expected ${
          (graded.firstFailure || {}).expect}, got ${(graded.firstFailure || {}).actual}`}`;
    if (c.expectVcd) {
      const vcdOk = !!ran.vcd && /\$var/.test(ran.vcd) && /^#\d+/m.test(ran.vcd);
      row.ok = row.ok && vcdOk;
      row.note += vcdOk ? `, VCD ${ran.vcd.length} bytes` : ', NO USABLE VCD';
    }
  }
  row.output = ran.output.split('\n').slice(0, 6).join('\n');
  results.push({ ...row, ms: Date.now() - started });
}

for (const r of results) {
  say(`${r.ok ? 'ok  ' : 'FAIL'}${r.id.padEnd(20)} ${r.what}`);
  say(`      ${r.note}  (${r.ms} ms)`);
}

const bad = results.filter(r => !r.ok);
say(`\n${results.length - bad.length} of ${results.length} probes behave as specified.`);
if (bad.length) say(`failing: ${bad.map(r => r.id).join(', ')}`);

if (JSON_OUT) console.log(JSON.stringify({ generation: GENERATION, results }, null, 2));
process.exit(bad.length ? 1 : 0);
