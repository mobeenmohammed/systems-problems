/* ============================================================
   complete-sv.js — completion for SystemVerilog, on the same
   terms as js/complete-cpp.js and js/complete-rust.js:
   keywords, the constructs these exercises actually reach for,
   and whatever is already in the buffer.

   Syntactic only, and deliberately so. There is no elaborator
   here and no parse tree — StreamLanguage tokenises by line —
   so nothing in this file knows what a name refers to. It does
   not offer the ports of a module it has not read, it does not
   complete hierarchical names after a dot, and it does not
   guess a width. Offering those would mean being confidently
   wrong about the thing a reader is least able to check, which
   is the one mistake a completion list can make that is worse
   than being absent.

   What it does know is the shape of the language and the
   contents of the file, and between them that covers what a
   small RTL exercise is made of.
   ============================================================ */

const SvComplete = (() => {

  /* IEEE 1800 keywords, minus the ones nothing here would ever
     want offered (UVM-era class and coverage machinery, the
     specify block, PLA tasks). A list that offers everything is
     a list nobody reads. */
  const KEYWORDS = (
    'always always_comb always_ff always_latch and assert assign automatic begin bit break '
    + 'buf byte case casex casez const continue default defparam disable do else end endcase '
    + 'endfunction endgenerate endinterface endmodule endpackage endtask enum extern final for '
    + 'force foreach forever fork function generate genvar if iff initial inout input int '
    + 'integer interface join localparam logic longint macromodule modport module nand negedge '
    + 'nor not or output package parameter posedge priority real reg repeat return shortint '
    + 'signed static string struct supply0 supply1 task time timeunit tri tri0 tri1 typedef '
    + 'union unique unsigned var vector void wait wand while wire wor xnor xor'
  ).split(' ');

  /* The system tasks a testbench is built out of. The note beside
     each is what it is for, which is the part worth being
     reminded of at the moment you are typing it. */
  const SYSTEM = {
    $display: 'print a line',
    $write: 'print without a newline',
    $monitor: 'print whenever one of these changes',
    $strobe: 'print at the end of the time step',
    $finish: 'end the simulation — a testbench without one is stopped by the time limit',
    $stop: 'pause the simulation',
    $time: 'the current simulated time, in this unit',
    $realtime: 'the current simulated time, as a real',
    $dumpfile: 'name the VCD file — needed for a waveform',
    $dumpvars: 'record signals into it: $dumpvars(0, tb)',
    $random: 'a random 32-bit value',
    $urandom_range: 'a random value in a range',
    $signed: 'reinterpret as signed',
    $unsigned: 'reinterpret as unsigned',
    $bits: 'the width of a type or expression',
    $clog2: 'ceiling of log base 2 — for sizing a counter',
    $error: 'report an error and carry on',
    $fatal: 'report an error and stop',
    $sformatf: 'format into a string',
  };

  /* Whole constructs, because the thing somebody is about to get
     wrong in a sequential block is the edge list and the reset,
     not the spelling of `always_ff`. Each is one choice with the
     cursor landing in the body. */
  const SNIPPETS = [
    {
      label: 'always_ff', detail: 'clocked block, synchronous reset',
      apply: 'always_ff @(posedge clk) begin\n  if (rst) begin\n    \n  end else begin\n    \n  end\nend',
    },
    {
      label: 'always_ff @(posedge clk or posedge rst)',
      detail: 'clocked block, asynchronous reset',
      apply: 'always_ff @(posedge clk or posedge rst) begin\n  if (rst) begin\n    \n  end else begin\n    \n  end\nend',
    },
    {
      label: 'always_comb', detail: 'combinational block',
      apply: 'always_comb begin\n  \nend',
    },
    {
      label: 'case', detail: 'case statement with a default',
      apply: 'case (sel)\n  : ;\n  default: ;\nendcase',
    },
    {
      label: 'typedef enum', detail: 'state type for a machine',
      apply: 'typedef enum logic [1:0] {\n  IDLE,\n  \n} state_t;',
    },
    {
      label: 'initial', detail: 'testbench stimulus block',
      apply: 'initial begin\n  \n  $finish;\nend',
    },
    {
      label: '$dumpfile', detail: 'open a VCD and record everything under tb',
      apply: '$dumpfile("dump.vcd");\n$dumpvars(0, tb);',
    },
    {
      label: 'module', detail: 'module with a port list',
      apply: 'module name (\n  input  logic clk,\n  input  logic rst,\n  output logic q\n);\n\nendmodule',
    },
  ];

  /* Every word already in the file, minus the keywords — the same
     idea as the C++ and Rust sources, and the reason a port called
     `wr_en` is offered on its second use without anybody declaring
     anywhere that it exists. `\w` only: a hierarchical name is two
     identifiers and a dot, and both halves get offered separately
     rather than pretending to know the hierarchy. */
  function identifiers(text, skip) {
    const seen = new Set();
    for (const m of text.matchAll(/[A-Za-z_]\w{1,}/g)) {
      if (m[0] !== skip && !KEYWORDS.includes(m[0])) seen.add(m[0]);
    }
    return [...seen];
  }

  function source(context) {
    const doc = context.state.doc.toString();

    /* A system task starts with $, which is not a word character, so
       it needs its own match or the popup closes the moment it is
       typed. */
    const dollar = context.matchBefore(/\$\w*/);
    if (dollar) {
      return {
        from: dollar.from,
        options: Object.entries(SYSTEM).map(([label, detail]) => ({
          label, detail, type: 'function', boost: 1,
        })).concat(SNIPPETS.filter(s => s.label.startsWith('$')).map(s => ({
          label: s.label, detail: s.detail, type: 'snippet', apply: s.apply,
        }))),
        validFor: /^\$\w*$/,
      };
    }

    /* A compiler directive, likewise: `timescale, `define, `include. */
    const tick = context.matchBefore(/`\w*/);
    if (tick) {
      return {
        from: tick.from,
        options: [
          { label: '`timescale 1ns/1ps', detail: 'unit and precision', type: 'keyword' },
          { label: '`define', type: 'keyword' },
          { label: '`ifdef', type: 'keyword' },
          { label: '`ifndef', type: 'keyword' },
          { label: '`endif', type: 'keyword' },
          { label: '`include', type: 'keyword' },
          { label: '`default_nettype none', detail: 'make undeclared wires an error', type: 'keyword' },
        ],
        validFor: /^`[\w/\s.]*$/,
      };
    }

    const word = context.matchBefore(/\w+/);
    if (!word && !context.explicit) return null;
    const typed = word ? word.text : '';
    /* Ctrl+Space asks for everything; typing asks after two letters,
       so that `a` does not put a list over the line being written. */
    if (!context.explicit && typed.length < 2) return null;

    return {
      from: word ? word.from : context.pos,
      options: [
        ...SNIPPETS.filter(s => !s.label.startsWith('$')).map(s => ({
          label: s.label,
          detail: s.detail,
          type: 'snippet',
          apply: s.apply,
          boost: 2,
        })),
        ...KEYWORDS.map(label => ({ label, type: 'keyword' })),
        ...Object.entries(SYSTEM).map(([label, detail]) => ({
          label, detail, type: 'function',
        })),
        ...identifiers(doc, typed).map(label => ({ label, type: 'variable' })),
      ],
      validFor: /^\w*$/,
    };
  }

  return { source, KEYWORDS, SYSTEM, SNIPPETS, identifiers };
})();
