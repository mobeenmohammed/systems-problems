/* SystemVerilog in the browser: the whole exercise, in a real tab.

   The things that are easy to get wrong, and none of them is visible
   from a single happy run:

     · a successful compile is not a pass. A design that compiles and
       prints nothing, and one that prints the word PASS and computes
       nothing, must both score zero.
     · a run that stops part way is INCOMPLETE, not a fraction. A
       design that hangs after two of seven checks must not score 2/7.
     · an endless simulation must not freeze the page, must be
       stoppable, and must time out on its own — and a good run has to
       work immediately afterwards.
     · the grading testbench's waveform is never shown. It drives
       cases the sample one does not, and a picture of them is a
       picture of the answer.
     · nothing leaves this origin. The simulator is vendored.

   Needs the site served:   npm run serve

   Run: node tests/browser/hdl.test.mjs
        BASE=https://… node tests/browser/hdl.test.mjs
        SHOTS=1 ... (also write screenshots) */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

const CHANNEL = process.env.BROWSER || null;
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not being served at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const support = JSON.parse(fs.readFileSync('data/hdl-support.json', 'utf8'));
const problems = JSON.parse(fs.readFileSync('data/index.json', 'utf8'))
  .filter(p => p.type === 'hdl');
const solutionOf = id => JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8'));
const problemOf = (id) => {
  const dirs = fs.readdirSync('problems');
  for (const d of dirs) {
    const f = path.join('problems', d, `${id}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return null;
};

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback/.test(m.text())) return;
    errors.push(m.text());
  });
  p.on('dialog', d => d.accept());
  return { ctx, p };
}

const go = async (p, hash, wait = 1800) => {
  await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(wait);
};

const setSource = (p, src) => p.evaluate(s => {
  window.SystemsLab.ProblemTypes.get('hdl').editor().value = s;
}, src);

const runSettled = p => p.waitForFunction(() => {
  const e = document.querySelector('#execState');
  return e && e.textContent && !/Compil|Simulat|Fetch|Simulator|Grading/.test(e.textContent);
}, { timeout: 120_000 });

const submitSettled = p => p.waitForFunction(() => {
  const b = document.querySelector('#submitBtn');
  return b && !b.disabled && b.textContent.trim() === 'Submit';
}, { timeout: 120_000 });

const readResults = p => p.evaluate(() => ({
  exec: (document.querySelector('#execState') || {}).textContent,
  verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
  body: (document.querySelector('.verdict') || {}).textContent || '',
  checks: [...document.querySelectorAll('.hdl-check')].map(n => ({
    name: n.querySelector('.hdl-check-name').textContent,
    state: n.dataset.state,
  })),
  diags: [...document.querySelectorAll('.diag')].map(n => ({
    level: n.dataset.level,
    where: (n.querySelector('.diag-where') || {}).textContent,
  })),
  console: (document.querySelector('.run-out-pre') || {}).textContent || '',
}));

/* The strip puts a count badge inside the tab button, so Submissions
   reads "Submissions1" once there is one. Matched by prefix. */
const openTab = async (p, label) => {
  for (const t of await p.$$('.ws-tabs-work .tab')) {
    if ((await t.textContent()).trim().startsWith(label)) { await t.click(); return true; }
  }
  return false;
};

const COUNTER = 'hdl-counter';
const MUX = 'hdl-mux2';
const RIGHT = solutionOf(COUNTER).key.reference.sv;

/* ---------------- the toolchain is pinned and local ---------------- */

section('the simulator is vendored, pinned, and GPL-noticed');
{
  check('there are hardware exercises at all', problems.length >= 4, true);
  const manifest = JSON.parse(fs.readFileSync('vendor/verilog/manifest.json', 'utf8'));
  check('six artifacts are pinned', Object.keys(manifest.files).length, 6);
  ok('every one has a sha256',
    Object.values(manifest.files).every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
  ok('the licence travels with them', fs.existsSync('vendor/verilog/COPYING'));
  ok('and it is the GPL',
    /GNU GENERAL PUBLIC LICENSE/.test(fs.readFileSync('vendor/verilog/COPYING', 'utf8')));
  ok('the manifest says so too', /GPL-2\.0/.test(manifest.licence));
  ok('and names the upstream source', /iverilog/.test(manifest.simulatorSource));
  check('the support file agrees on the pin', support.toolchain.pin, manifest.commit);
  ok('the support file refuses to claim synthesis',
    /not been shown to be synthesisable/.test(support._notSynthesis));
}

/* ---------------- the workspace ---------------- */

section('the hardware workspace');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);

  const shape = await p.evaluate(() => ({
    workspace: document.body.dataset.workspace,
    tabs: [...document.querySelectorAll('.ws-tabs-work .tab')].map(t => t.textContent.trim()),
    run: (document.querySelector('#runBtn') || {}).textContent,
    editor: !!document.querySelector('.cm-content'),
    top: [...document.querySelectorAll('.editor-head span')].map(s => s.textContent.trim()),
  }));
  check('it owns the window like a coding exercise', shape.workspace, 'true');
  check('the design, two testbenches, results, waveforms, submissions and compiler output',
    shape.tabs,
    ['Design', 'Sample testbench', 'My testbench', 'Results', 'Waveforms', 'Submissions', 'Compiler output']);
  check('Run says what it does', shape.run.trim(), 'Run simulation');
  ok('there is an editor', shape.editor);
  ok(`the top module is named (${shape.top.join(' ')})`,
    shape.top.some(t => /top: \w+/.test(t)));

  await openTab(p, 'Sample testbench');
  await p.waitForTimeout(300);
  const tb = await p.evaluate(() => ({
    text: (document.querySelector('#resultPane pre code') || {}).textContent || '',
    editable: !!document.querySelector('#resultPane textarea, #resultPane .cm-content'),
  }));
  ok('the sample testbench is shown', tb.text.includes('module tb'));
  ok('and is not editable', !tb.editable);
  ok('it is the problem’s own', tb.text === problemOf(COUNTER).payload.testbench);

  await ctx.close();
}

/* ---------------- a correct design ---------------- */

section('a correct design runs, passes, and draws a waveform');
let waveState = null;
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  await setSource(p, RIGHT);
  await p.waitForTimeout(300);

  const started = Date.now();
  await p.click('#runBtn');
  await runSettled(p);
  const took = Date.now() - started;
  ok(`it compiled and simulated (${took} ms, including the first fetch)`, took < 120_000);

  const r = await readResults(p);
  check('every sample check passed',
    r.checks.filter(c => c.state === 'pass').length, r.checks.length);
  ok(`the verdict says so (${r.verdict})`, /All \d+ checks passed/.test(r.verdict));
  ok('the console carries what the testbench printed', /CHECK reset/.test(r.console));
  ok('and the simulated finish time', /\$finish at \d+/.test(r.body));

  await openTab(p, 'Waveforms');
  await p.waitForTimeout(900);
  waveState = await p.evaluate(() => {
    const c = document.querySelector('.wave-canvas');
    return {
      canvas: !!c,
      width: c ? c.width : 0,
      height: c ? c.height : 0,
      names: [...document.querySelectorAll('.wave-name')].map(n => n.textContent.trim()),
      buttons: [...document.querySelectorAll('.wave-bar button')].map(n => n.textContent.trim()),
      bases: [...document.querySelectorAll('#waveBase option')].map(n => n.value),
      pickable: document.querySelectorAll('.wave-pick-row').length,
    };
  });
  ok('there is a waveform', waveState.canvas);
  ok(`it is drawn at device resolution (${waveState.width}x${waveState.height})`,
    waveState.width > 300 && waveState.height > 60);
  ok(`the clock is one of the traces (${waveState.names.join(', ')})`,
    waveState.names.some(n => /^clk/.test(n)));
  ok('the counter output is another', waveState.names.some(n => /^q/.test(n)));
  ok('fit, zoom and pan are all there',
    ['Fit', '−', '+', '◀', '▶'].every(b => waveState.buttons.includes(b)));
  check('a bus can be read in three bases', waveState.bases, ['hex', 'bin', 'dec']);
  ok('the VCD can be downloaded', waveState.buttons.includes('Download VCD'));
  ok(`more signals can be added (${waveState.pickable} available)`, waveState.pickable > 4);

  /* The cursor, and the values at it. */
  const box = await p.evaluate(() => {
    const b = document.querySelector('.wave-canvas').getBoundingClientRect();
    return { x: Math.round(b.x + b.width * 0.6), y: Math.round(b.y + b.height / 2) };
  });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(300);
  const cursor = await p.evaluate(() => ({
    at: (document.querySelector('#waveAt') || {}).textContent || '',
    values: [...document.querySelectorAll('.wave-val')].map(n => n.textContent.trim()),
    peek: null,
  }));
  /* The time is said in the TESTBENCH's unit rather than the VCD's
     precision, so that a check reporting "wrong at t=30" and the cursor
     agree. It is therefore not always a whole number. */
  ok(`clicking puts a cursor down with a time and a unit (${cursor.at})`,
    /t = [\d.]+ (ps|ns|us|ms|s|fs)/.test(cursor.at));
  ok(`and every trace's value at it (${cursor.values.slice(0, 3).join(' | ')})`,
    cursor.values.length === waveState.names.length);

  /* Arrow keys move it; Fit changes the window. */
  const before = await p.evaluate(() => document.querySelector('#waveAt').textContent);
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => document.querySelector('#waveAt').textContent);
  ok(`the arrow keys move it (${before} -> ${after})`, before !== after);

  /* Hex and binary say different things about the same bus. */
  const hex = await p.evaluate(() => [...document.querySelectorAll('.wave-val b')].map(n => n.textContent));
  await p.selectOption('#waveBase', 'bin');
  await p.waitForTimeout(250);
  const bin = await p.evaluate(() => [...document.querySelectorAll('.wave-val b')].map(n => n.textContent));
  ok(`the base control changes how a bus reads (${hex.join(',')} -> ${bin.join(',')})`,
    hex.join() !== bin.join());

  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'hdl-waveform.png') });
  await ctx.close();
}

/* ---------------- a compile is not a pass ---------------- */

section('a successful compile is not a passed exercise');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);

  /* Compiles, simulates, prints nothing the grader asked for — and
     prints the word PASS, which must count for nothing. */
  await setSource(p, `module counter #(parameter int N = 4) (
  input logic clk, input logic rst, input logic en, output logic [N-1:0] q
);
  initial $display("PASS PASS PASS everything is fine");
  assign q = '0;
endmodule
`);
  await p.waitForTimeout(300);
  await p.click('#submitBtn');
  await submitSettled(p);
  await p.waitForTimeout(400);

  const r = await readResults(p);
  ok(`it did not pass (${r.verdict})`, !/All \d+ checks passed/.test(r.verdict));
  ok('the word PASS did reach the output', /PASS PASS PASS/.test(r.console));
  ok('and counted for nothing: no check is named after it',
    r.checks.every(c => !/pass/i.test(c.name)));
  ok(`most checks failed (${r.checks.filter(c => c.state === 'pass').length} of ${r.checks.length})`,
    r.checks.filter(c => c.state === 'pass').length * 2 < r.checks.length);
  const state = await p.evaluate(() => window.SystemsLab.Store.record('hdl-counter').status);
  ok(`and it is not recorded as solved (${state})`, state !== 'solved');
  await ctx.close();
}

section('a run that stops part way is incomplete, not a fraction');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  /* Right for the first checks, then $finish before the rest. The
     timescale matters: without it the design's delays are in whatever
     unit the compiler defaults to, and #45 lands after everything. */
  await setSource(p, `\`timescale 1ns/1ps
module counter #(parameter int N = 4) (
  input logic clk, input logic rst, input logic en, output logic [N-1:0] q
);
  always_ff @(posedge clk) begin
    if (rst)     q <= '0;
    else if (en) q <= q + 1'b1;
  end
  // Stop the whole simulation from inside the design, part way through
  // the grading testbench.
  initial #45 $finish;
endmodule
`);
  await p.waitForTimeout(300);
  await p.click('#submitBtn');
  await submitSettled(p);
  await p.waitForTimeout(400);

  const r = await readResults(p);
  ok(`the verdict is Incomplete rather than a score (${r.verdict})`, /Incomplete/.test(r.verdict));
  ok('and it says a run that does not finish is not a pass',
    /not a pass/.test(r.body));
  ok('the checks that never ran say so',
    r.checks.some(c => c.state === 'missing'));
  const state = await p.evaluate(() => window.SystemsLab.Store.record('hdl-counter').status);
  ok(`not solved (${state})`, state !== 'solved');
  await ctx.close();
}

/* ---------------- a wrong design, and a broken one ---------------- */

section('a deliberately wrong design fails, and says where');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  await setSource(p, `module counter #(parameter int N = 4) (
  input logic clk, input logic rst, input logic en, output logic [N-1:0] q
);
  // saturates instead of wrapping, and ignores the width
  always_ff @(posedge clk) begin
    if (rst) q <= '0;
    else if (en && q != 4'hF) q <= q + 1'b1;
  end
endmodule
`);
  await p.waitForTimeout(300);
  await p.click('#submitBtn');
  await submitSettled(p);
  await p.waitForTimeout(400);

  const r = await readResults(p);
  ok(`some checks passed and some did not (${r.verdict})`, /\d of \d checks passed/.test(r.verdict));
  ok('the wrapping check is the one that failed',
    r.checks.some(c => c.name === 'wraps' && c.state === 'fail'));
  ok('the early checks still passed',
    r.checks.some(c => c.name === 'reset' && c.state === 'pass'));
  const state = await p.evaluate(() => window.SystemsLab.Store.record('hdl-counter').status);
  ok(`not solved (${state})`, state !== 'solved');
  await ctx.close();
}

section('a design that does not compile is told which line');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  await setSource(p, `module counter #(parameter int N = 4) (
  input logic clk, input logic rst, input logic en, output logic [N-1:0] q
);
  always_ff @(posedge clk) q <= q + ;
endmodule
`);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await runSettled(p);
  await p.waitForTimeout(400);

  /* A failed compile opens the pane that explains it, rather than
     printing the list into Results as well. Two copies of one list is
     a reader deciding which is authoritative. */
  await p.waitForTimeout(400);
  const landed = await p.evaluate(() => ({
    tab: [...document.querySelectorAll('.ws-tabs-work .tab')]
      .find(t => t.getAttribute('aria-selected') === 'true' || t.dataset.active === 'true')
      ?.textContent.trim(),
    diags: [...document.querySelectorAll('#resultPane .diag')].map(d => ({
      level: d.dataset.level,
      where: (d.querySelector('.diag-where') || {}).textContent,
    })),
  }));
  ok(`it lands on Compiler output (${landed.tab})`, /Compiler output/.test(landed.tab || ''));
  ok('with at least one error', landed.diags.some(d => d.level === 'error'));
  ok(`naming the file and line (${(landed.diags[0] || {}).where})`,
    landed.diags.some(d => /design\.sv:\d+/.test(d.where || '')));

  await openTab(p, 'Results');
  await p.waitForTimeout(300);
  const res = await p.evaluate(() => ({
    verdict: (document.querySelector('.buildline h4') || {}).textContent || '',
    copies: document.querySelectorAll('#resultPane .diag').length,
    toCompiler: !!document.querySelector('#toCompilerOut'),
    score: /\d+ of \d+ checks/.test((document.querySelector('#resultPane') || {}).innerText || ''),
  }));
  ok(`Results says it did not compile (${res.verdict})`, /did not compile/i.test(res.verdict));
  check('and does not repeat the compiler\u2019s list', res.copies, 0);
  ok('it offers the way to it instead', res.toCompiler);
  ok('and invents no failed-check count', !res.score);
  await ctx.close();
}

/* ---------------- an endless simulation ---------------- */

section('an endless simulation does not freeze the page');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  await setSource(p, `module counter #(parameter int N = 4) (
  input logic clk, input logic rst, input logic en, output logic [N-1:0] q
);
  // A forever loop with no delay in it: simulated time never advances
  // and vvp never returns. Icarus rejects a delayless always block at
  // compile time, but it accepts this.
  integer k = 0;
  initial forever k = k + 1;
  always_ff @(posedge clk) q <= q + 1'b1;
endmodule
`);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await p.waitForTimeout(2500);

  const during = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent,
    stop: !!document.querySelector('#stopBtn') && !document.querySelector('#stopBtn').hidden,
    /* The page is answering at all, which it could not if the
       simulation were on this thread. */
    menu: (() => {
      const b = document.getElementById('contentBtn');
      b.click();
      const open = b.getAttribute('aria-expanded');
      b.click();
      return open;
    })(),
    scrolls: (() => {
      const el = document.querySelector('#leftPane');
      if (!el) return null;
      const was = el.scrollTop;
      el.scrollTop = was + 50;
      const now = el.scrollTop;
      el.scrollTop = was;
      return now !== was || el.scrollHeight <= el.clientHeight;
    })(),
  }));
  ok(`it is still simulating (${during.exec})`, /Simulat/.test(during.exec));
  ok('Stop is offered', during.stop);
  check('the navigation still answers', during.menu, 'true');
  ok('and the statement still scrolls', during.scrolls !== false);

  await p.click('#stopBtn', { force: true });
  await p.waitForTimeout(600);
  const stopped = await p.textContent('#execState');
  ok(`Stop stops it (${stopped})`, /Stopped/.test(stopped));

  /* And the thing that matters most: the next run works. */
  await setSource(p, RIGHT);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await runSettled(p);
  const after = await readResults(p);
  ok(`a good simulation works straight after a stopped one (${after.exec})`,
    /All \d+ checks passed/.test(after.verdict));
  await ctx.close();
}

section('and it stops itself if nobody presses Stop');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  await setSource(p, `module counter #(parameter int N = 4) (
  input logic clk, input logic rst, input logic en, output logic [N-1:0] q
);
  integer k = 0;
  initial forever k = k + 1;
  assign q = '0;
endmodule
`);
  await p.waitForTimeout(300);
  const t0 = Date.now();
  await p.click('#runBtn');
  await runSettled(p);
  const took = Date.now() - t0;
  const r = await readResults(p);
  ok(`it gave up on its own after ${(took / 1000).toFixed(1)}s`, took < 40_000);
  ok(`and said why (${r.verdict})`, /Stopped/i.test(r.verdict) || /Stopped/i.test(r.exec));
  ok(`naming the two shapes that do it (${r.body.slice(0, 90)}…)`,
    /no \$finish|never advances/.test(r.body));
  ok('and refusing to report a score for it', !/\d of \d checks passed/.test(r.verdict));
  await ctx.close();
}

/* ---------------- the grading testbench stays hidden ---------------- */

section('the grading testbench is not shown, and neither is its waveform');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  const harness = solutionOf(COUNTER).key.harness;
  const marker = harness.split('\n').find(l => l.includes('CHECK wraps'));

  const body = await p.evaluate(() => document.body.innerText);
  ok('the grading testbench is nowhere on the page', !body.includes(marker.trim()));

  await setSource(p, RIGHT);
  await p.waitForTimeout(300);
  await p.click('#submitBtn');
  await submitSettled(p);
  await p.waitForTimeout(400);

  await openTab(p, 'Waveforms');
  await p.waitForTimeout(600);
  const waves = await p.evaluate(() => ({
    canvas: !!document.querySelector('.wave-canvas'),
    says: (document.querySelector('#resultPane p') || {}).textContent || '',
  }));
  ok('a submission draws no waveform', !waves.canvas);
  ok(`and says why (${waves.says.slice(0, 60)}…)`, /grading testbench/.test(waves.says));

  const after = await p.evaluate(() => document.body.innerText);
  ok('the grading source is still nowhere on the page', !after.includes(marker.trim()));
  await ctx.close();
}

/* ---------------- a testbench of the reader's own ----------------

   The grading testbench is the site's, the sample one is the
   problem's, and this third one is the reader's. The ways it could go
   wrong are the interesting part: it must not be graded, it must not
   touch the record, it must not be confused with the sample by the Run
   button, its waveform must work, and it must still be there after a
   reload. */

section('a testbench of your own runs, draws a waveform, and is graded by nothing');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${MUX}`);
  const right = solutionOf(MUX).key.reference.sv;
  await setSource(p, right);
  await p.waitForTimeout(300);

  ok('there is a tab for it', await openTab(p, 'My testbench'));
  await p.waitForTimeout(500);

  const empty = await p.evaluate(() => ({
    run: (document.querySelector('#runMyTb') || {}).disabled,
    seed: !!document.querySelector('#seedMyTb'),
    editor: !!document.querySelector('#resultPane .ed-host-sm'),
  }));
  ok('with an editor of its own', empty.editor);
  ok('a way to start from the sample', empty.seed);
  check('and nothing to run until something is written', empty.run, true);

  await p.click('#seedMyTb');
  await p.waitForTimeout(500);
  const seeded = await p.evaluate(() => ({
    stored: window.SystemsLab.Store.draft('hdl-mux2', '_mytb') || '',
    run: document.querySelector('#runMyTb').disabled,
    note: (document.querySelector('#myTbNote') || {}).textContent || '',
  }));
  ok('the sample copies in', seeded.stored.includes('module tb'));
  check('the copy is the sample, character for character',
    seeded.stored === problemOf(MUX).payload.testbench, true);
  ok('and now it can be run', !seeded.run);
  ok(`it says the sample is untouched (${seeded.note.slice(0, 40)}…)`,
    /untouched/.test(seeded.note));

  /* Stimulus the sample does not drive, printing something only this
     testbench could have printed. */
  const MINE = ['`timescale 1ns/1ps', 'module tb;',
    '  logic a, b, sel; wire y;',
    `  ${problemOf(MUX).payload.top} dut(.a(a), .b(b), .sel(sel), .y(y));`,
    '  initial begin',
    '    $dumpfile("dump.vcd"); $dumpvars(0, tb);',
    '    a = 1; b = 0; sel = 0; #10;',
    '    $display("MINE sel=%b y=%b", sel, y);',
    '    sel = 1; #10;',
    '    $display("MINE sel=%b y=%b", sel, y);',
    '    $finish;', '  end', 'endmodule', ''].join('\n');

  await p.evaluate(src => {
    window.SystemsLab.ProblemTypes.get('hdl').myTestbench().value = src;
  }, MINE);
  await p.waitForTimeout(500);
  ok('editing it saves it',
    (await p.evaluate(() => window.SystemsLab.Store.draft('hdl-mux2', '_mytb'))).includes('MINE'));

  await p.click('#runMyTb');
  await runSettled(p);
  await p.waitForTimeout(600);

  const ran = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent || '',
    state: (document.querySelector('#execState') || {}).dataset.state,
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    body: (document.querySelector('.verdict') || {}).textContent || '',
    out: (document.querySelector('.run-out-pre') || {}).textContent || '',
    checks: document.querySelectorAll('.hdl-check').length,
    status: window.SystemsLab.Store.record('hdl-mux2').status,
    attempts: window.SystemsLab.Store.record('hdl-mux2').attempts,
  }));
  check('it ran', ran.verdict, 'Your testbench ran');
  ok(`and the status word says so without a colour it did not earn (${ran.exec})`,
    ran.state === 'ran' && /your testbench/i.test(ran.exec));
  ok('it says nothing was graded', /Nothing was graded/.test(ran.body));
  ok('there is no score', !/passed/.test(ran.verdict));
  check('and no check rows, because it declared no expected values', ran.checks, 0);
  ok('what my testbench printed is there', /MINE sel=0 y=1/.test(ran.out)
    && /MINE sel=1 y=0/.test(ran.out));
  check('the problem is still unsolved', ran.status, 'unsolved');
  check('and no attempt was recorded', ran.attempts, 0);

  await openTab(p, 'Waveforms');
  await p.waitForTimeout(900);
  const waves = await p.evaluate(() => ({
    canvas: !!document.querySelector('.wave-canvas'),
    names: [...document.querySelectorAll('.wave-name .mono')].map(n => n.textContent.trim()),
  }));
  ok('my testbench has a waveform', waves.canvas);
  ok(`with my signals on it (${waves.names.join(' ')})`,
    ['a', 'b', 'sel', 'y'].every(n => waves.names.includes(n)));

  /* Run simulation has not changed its meaning. */
  await p.click('#runBtn');
  await runSettled(p);
  await p.waitForTimeout(500);
  const sample = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent || '',
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
  }));
  ok(`Run simulation still means the sample checks (${sample.exec})`,
    /sample checks/.test(sample.exec) && /checks passed/.test(sample.verdict));

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await openTab(p, 'My testbench');
  await p.waitForTimeout(600);
  ok('and my testbench is still there after a reload',
    (await p.evaluate(() =>
      (window.SystemsLab.ProblemTypes.get('hdl').myTestbench() || {}).value || '')).includes('MINE'));

  await ctx.close();
}

/* ---------------- drafts and submissions ---------------- */

section('the design is a draft, and a submission is kept whole');
{
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${COUNTER}`);
  const mine = `${RIGHT}\n// a comment of my own, ${'x'.repeat(200)}\n`;
  await p.evaluate(s => {
    const ed = window.SystemsLab.ProblemTypes.get('hdl').editor();
    ed.value = s;
    /* Through the editor's own change path, which is what a keystroke
       does — setting .value alone would not save a draft. */
    window.SystemsLab.Store.saveDraft({ id: 'hdl-counter' }, 'sv', s);
  }, mine);
  await p.waitForTimeout(400);

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  const back = await p.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('hdl').editor().value);
  check('the draft survives a real reload', back.trim(), mine.trim());

  await p.click('#submitBtn');
  await submitSettled(p);
  await p.waitForTimeout(800);

  const opened = await openTab(p, 'Submissions');
  ok('there is a Submissions tab', opened);
  await p.waitForTimeout(1200);
  const subs = await p.evaluate(async () => {
    const list = window.SystemsLab.Store.submissions('hdl-counter');
    const first = list[0] || {};
    /* Sources is keyed by problem AND by the submission's timestamp,
       which is what lets ten submissions of one problem live in one
       record without overwriting each other. */
    const stored = first.at
      ? await window.SystemsLab.Sources.get('hdl-counter', first.at) : null;
    return {
      rows: document.querySelectorAll('#resultPane .subs > li').length,
      recorded: list.length,
      lang: first.lang,
      bytes: first.bytes,
      truncated: !!first.truncated,
      stored,
    };
  });
  ok(`the submission is listed (${subs.rows} shown, ${subs.recorded} recorded)`, subs.rows > 0);
  check('it is recorded as SystemVerilog', subs.lang, 'sv');
  ok('nothing was truncated', !subs.truncated);
  ok(`and the design was kept whole (${subs.bytes} characters)`,
    typeof subs.stored === 'string' && subs.stored.includes('x'.repeat(200)));
  await ctx.close();
}

/* ---------------- every exercise, by its own reference ---------------- */

section('every certified exercise passes its own grading testbench in the browser');
for (const meta of problems) {
  if (!support.browser.includes(meta.id)) {
    console.log(`  --    ${meta.id}: not certified for the browser`);
    continue;
  }
  const { ctx, p } = await freshPage();
  await go(p, `#/p/${meta.id}`);
  await setSource(p, solutionOf(meta.id).key.reference.sv);
  await p.waitForTimeout(300);
  await p.click('#submitBtn');
  await submitSettled(p);
  await p.waitForTimeout(400);
  const r = await readResults(p);
  ok(`${meta.id}: ${r.verdict}`, /All \d+ checks passed/.test(r.verdict));
  await ctx.close();
}

/* ---------------- nothing leaves this origin ---------------- */

section('the simulator is fetched from here and nowhere else');
{
  const { ctx, p } = await freshPage();
  const outbound = [];
  p.on('request', r => {
    const u = r.url();
    if (u.startsWith(BASE) || u.startsWith('blob:') || u.startsWith('data:')) return;
    /* Loopback is the site asking whether a local runner is listening,
       which it does on any coding page. Nothing leaves the machine, and
       on a hardware exercise nothing comes of it either — there is no
       native path for these. The claim being made here is that the
       simulator is vendored and nothing is sent to a third party. */
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(u)) return;
    outbound.push(`${r.method()} ${u}`);
  });
  await go(p, `#/p/${COUNTER}`);
  await setSource(p, RIGHT);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await runSettled(p);
  check('no request went to a third party', outbound, []);
  await ctx.close();
}

section('no uncaught errors');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 400)}` : 'none', errors.length === 0);

await browser.close();
report('browser/hdl');
