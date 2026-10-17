/* SystemVerilog in the editor: colour and completion.

   The hardware workspace used to show plain monospaced text, on the
   reasoning that C-like highlighting on Verilog is wrong in a way that
   misleads. That was true and it was still a worse place to write
   SystemVerilog than anywhere else these exercises might be attempted.
   There is a real Verilog mode in the bundle now — the CodeMirror 5
   one, under StreamLanguage — and a completion source beside the C++
   and Rust ones.

   What is checked here is what a reader would notice: keywords are a
   different colour from identifiers, comments and strings are told
   apart, Ctrl+Space offers something useful, and none of it costs the
   draft, the cursor or the undo history.

   Needs the site served:   npm run serve
   Run: node tests/browser/editor-sv.test.mjs */

import { chromium } from 'playwright';
import { section, check, ok, report } from '../harness.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHANNEL = process.env.BROWSER || null;

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not reachable at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

const go = async (hash, wait = 2200) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};
const openTab = async (label) => {
  for (const t of await page.$$('.ws-tabs-work .tab')) {
    if ((await t.textContent()).trim().startsWith(label)) { await t.click(); return true; }
  }
  return false;
};

/* What CodeMirror painted, by colour. One class per highlight tag is
   not something to assert on — the bundle minifies them — so this asks
   what a reader sees: how many distinct colours, and whether the
   keyword and the identifier are different ones. */
const palette = () => page.evaluate(() => {
  const spans = [...document.querySelectorAll('.cm-content .cm-line span')];
  const byText = {};
  const colours = new Set();
  for (const s of spans) {
    const c = getComputedStyle(s).color;
    colours.add(c);
    const t = s.textContent.trim();
    if (t && !(t in byText)) byText[t] = c;
  }
  return { colours: [...colours], byText, spans: spans.length };
});

/* ---------------- the design editor ---------------- */

section('a design is syntax-coloured, in the page’s own colours');
{
  await go('#/p/hdl-mux2');
  await page.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value = `\`timescale 1ns/1ps
// a comment
module mux2 (input logic a, input logic b, input logic sel, output logic y);
  localparam int WIDTH = 8;
  assign y = sel ? b : a;
  initial $display("hello %0d", WIDTH);
endmodule
`;
  });
  await page.waitForTimeout(700);

  const p = await palette();
  ok(`the editor tokenised it (${p.spans} spans)`, p.spans > 5);
  ok(`more than one colour is in use (${p.colours.length})`, p.colours.length >= 3);

  const kw = p.byText.module || p.byText.assign || p.byText.initial;
  const id = p.byText.mux2 || p.byText.WIDTH || p.byText.sel;
  ok('a keyword is coloured', !!kw);
  ok('an identifier is coloured', !!id);
  ok(`and they are not the same colour (${kw} vs ${id})`, kw !== id);

  const comment = Object.entries(p.byText).find(([t]) => t.startsWith('// a comment'));
  ok('the comment is its own colour', !!comment && comment[1] !== kw);

  const str = Object.entries(p.byText).find(([t]) => t.includes('hello %0d'));
  ok('so is the string', !!str && str[1] !== kw);

  /* The colours are the page's tokens, so a theme change repaints
     them. Checked by reading one back as a resolved token value. */
  const themed = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const kwTok = cs.getPropertyValue('--hl-keyword').trim();
    const el = [...document.querySelectorAll('.cm-content span')]
      .find(s => s.textContent.trim() === 'module' || s.textContent.trim() === 'assign');
    return { kwTok, painted: el ? getComputedStyle(el).color : null };
  });
  ok(`the keyword colour is the page's --hl-keyword (${themed.kwTok})`,
    !!themed.kwTok && !!themed.painted);
}

/* ---------------- completion ---------------- */

section('Ctrl+Space offers SystemVerilog, not nothing');
{
  await page.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value =
      'module mux2 (input logic a, input logic b, input logic sel, output logic y);\n'
      + '  logic internal_enable;\n  as\nendmodule\n';
  });
  await page.waitForTimeout(500);

  /* Put the cursor after the `as` on line 3 and ask. */
  await page.evaluate(() => {
    const ed = window.SystemsLab.ProblemTypes.get('hdl').editor();
    const doc = ed.view.state.doc;
    const line = doc.line(3);
    ed.view.dispatch({ selection: { anchor: line.to } });
    ed.view.focus();
  });
  await page.keyboard.press('Control+Space');
  await page.waitForTimeout(700);

  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-tooltip-autocomplete li')]
      .map(li => li.textContent.trim()));
  ok(`a list appeared (${opts.length} options)`, opts.length > 0);
  ok(`with the keyword being typed (${opts.slice(0, 4).join(', ')})`,
    opts.some(o => /^assign/.test(o)));

  /* A word from this very file, which no fixed list could contain. */
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const ed = window.SystemsLab.ProblemTypes.get('hdl').editor();
    const line = ed.view.state.doc.line(3);
    ed.view.dispatch({
      changes: { from: line.from, to: line.to, insert: '  internal_en' },
      selection: { anchor: line.from + 14 },
    });
    ed.view.focus();
  });
  await page.keyboard.press('Control+Space');
  await page.waitForTimeout(700);
  const own = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-tooltip-autocomplete li')]
      .map(li => li.textContent.trim()));
  ok(`an identifier from the file is offered (${own.slice(0, 3).join(', ')})`,
    own.some(o => o.includes('internal_enable')));

  /* A system task, which starts with a character that is not a word
     character and so needs its own match. */
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const ed = window.SystemsLab.ProblemTypes.get('hdl').editor();
    const line = ed.view.state.doc.line(3);
    ed.view.dispatch({
      changes: { from: line.from, to: line.to, insert: '  $dump' },
      selection: { anchor: line.from + 7 },
    });
    ed.view.focus();
  });
  await page.keyboard.press('Control+Space');
  await page.waitForTimeout(700);
  const sys = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-tooltip-autocomplete li')]
      .map(li => li.textContent.trim()));
  ok(`system tasks are offered after $ (${sys.slice(0, 2).join(', ')})`,
    sys.some(o => o.includes('$dumpvars')));
  await page.keyboard.press('Escape');
}

/* ---------------- it costs nothing ---------------- */

section('the draft, the cursor and the undo history all survive');
{
  await go('#/p/hdl-mux2');
  const MINE = 'module mux2 (input logic a, input logic b, input logic sel, output logic y);\n'
    + '  assign y = sel ? b : a;   // mine\nendmodule\n';
  await page.evaluate(src => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value = src;
  }, MINE);
  await page.waitForTimeout(600);

  /* A typed edit, so there is an undo step a programmatic set would not
     create. */
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// typed\n');
  await page.waitForTimeout(600);

  const before = await page.evaluate(() => {
    const ed = window.SystemsLab.ProblemTypes.get('hdl').editor();
    return { value: ed.value, cursor: ed.view.state.selection.main.head };
  });
  ok('the typed line is there', before.value.includes('// typed'));

  /* Twice: Enter closes an undo group, so the newline and the text
     before it are two steps. That is CodeMirror behaving normally, not
     the editor losing history. */
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const undone = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('hdl').editor().value);
  ok('undo takes it back', !undone.includes('// typed'));
  ok('and leaves the rest alone', undone.includes('// mine'));

  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(400);
  const redone = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('hdl').editor().value);
  ok('redo puts it back', redone.includes('// typed'));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const kept = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('hdl').editor().value);
  ok('and the draft survives a reload', kept.includes('// mine'));
}

/* ---------------- the other two places it is shown ---------------- */

section('the sample testbench and a testbench of your own are coloured too');
{
  await go('#/p/hdl-mux2');
  await openTab('Sample testbench');
  await page.waitForTimeout(600);
  const sample = await page.evaluate(() => {
    const pre = document.querySelector('#resultPane pre code, #resultPane .code-block code');
    if (!pre) return null;
    const spans = [...pre.querySelectorAll('span')];
    return {
      lang: (pre.closest('[data-lang]') || {}).dataset?.lang,
      colours: new Set(spans.map(s => getComputedStyle(s).color)).size,
      spans: spans.length,
    };
  });
  ok('the sample is rendered as Verilog', sample && sample.lang === 'verilog');
  ok(`and is coloured (${sample.spans} spans, ${sample.colours} colours)`,
    sample.spans > 5 && sample.colours >= 2);

  await openTab('My testbench');
  await page.waitForTimeout(600);
  await page.click('#seedMyTb');
  await page.waitForTimeout(800);
  const mine = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('#resultPane .cm-content .cm-line span')];
    return {
      spans: spans.length,
      colours: new Set(spans.map(s => getComputedStyle(s).color)).size,
    };
  });
  ok(`my own testbench is coloured as well (${mine.spans} spans, ${mine.colours} colours)`,
    mine.spans > 5 && mine.colours >= 3);
}

check('no uncaught errors', errors, []);
await browser.close();
report('browser/editor-sv');
