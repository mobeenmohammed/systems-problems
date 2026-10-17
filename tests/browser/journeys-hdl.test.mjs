/* The journeys, walked the way somebody walks them.

   Not direct routes and not adapter calls: the homepage, then the
   links and buttons that are actually on it. Everything here is a
   click a reader could make, in the order they would make it, and the
   assertions are about what they would see.

     1. homepage → digital logic → the multiplexer → edit → simulate →
        read the waveform → submit
     2. homepage → search "SystemVerilog" → the four exercises
     3. the Rust exercise from the report, through its own workflow
     4. a wrong design, a design that does not build, one that never
        finishes, and one that is stopped
     5. leaving while something is compiling
     6. and the rest of the site still works

   Needs the site served:   npm run serve
   Run: node tests/browser/journeys-hdl.test.mjs
        BASE=https://mobeenmohammed.github.io/systems-problems node …
        SHOTS=1 … (also write screenshots into _shots/) */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHANNEL = process.env.BROWSER || null;
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

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

/* A reader who has never been here before: no storage, no cached
   toolchain, and no local runner to fall back on. */
async function visitor() {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback|favicon/.test(m.text())) return;
    errors.push(m.text());
  });
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  return { ctx, p };
}

const shot = async (p, name) => {
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const settled = p => p.waitForFunction(() => {
  const e = document.querySelector('#execState');
  return e && e.textContent && !/Compil|Simulat|Fetch|Simulator|Running|Grading|Checking/.test(e.textContent);
}, { timeout: 300_000 });

const submitSettled = p => p.waitForFunction(() => {
  const b = document.querySelector('#submitBtn');
  return b && !b.disabled && /Submit/.test(b.textContent);
}, { timeout: 300_000 });

const openTab = async (p, label) => {
  for (const t of await p.$$('.ws-tabs-work .tab')) {
    if ((await t.textContent()).trim().startsWith(label)) { await t.click(); return true; }
  }
  return false;
};

/* ============================================================
   1. the homepage to a working multiplexer
   ============================================================ */

section('a new visitor finds the hardware exercises from the homepage');
let mux2Url = null;
{
  const { ctx, p } = await visitor();
  await shot(p, 'j1-home');

  /* The Content menu, opened the way a visitor opens it. */
  const menu = p.locator('#contentBtn');
  ok('there is a Content menu in the header', await menu.count() > 0);
  await menu.click();
  await p.waitForTimeout(500);

  /* Only what is on screen counts: a link in a panel nobody can see is
     not a way in. */
  const items = await p.evaluate(() => [...document.querySelectorAll('.navmenu-item')]
    .filter(a => a.offsetParent !== null)
    .map(a => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') })));
  const logic = items.find(a => /digital logic|fpga/i.test(a.text));
  ok(`the menu offers a way into digital logic (${logic ? logic.text.slice(0, 40) : 'nothing found'})`,
    !!logic);
  await shot(p, 'j1-menu');

  const entry = p.locator('.navmenu-item').filter({ hasText: /Digital logic/i }).first();
  ok('and it is visible, not just in the DOM', await entry.isVisible());
  await entry.click();
  await p.waitForTimeout(1600);
  const listed = await p.evaluate(() => {
    const sel = ['.p-card', '.prob-card', '.prow', '.card']
      .map(s2 => [...document.querySelectorAll(s2)]).find(rows => rows.length >= 4) || [];
    return sel.map(c => c.textContent.replace(/\s+/g, ' ').trim());
  });
  ok(`the catalogue shows hardware exercises (${listed.length} cards)`, listed.length >= 4);
  ok('and names them as SystemVerilog',
    listed.some(t => /SystemVerilog/i.test(t)));
  await shot(p, 'j1-catalogue');

  /* The multiplexer, by its title, as a link. */
  const link = p.locator('a').filter({ hasText: /multiplexer/i }).first();
  ok('the multiplexer is one of them', await link.count() > 0);
  await link.click();
  await p.waitForTimeout(2000);
  mux2Url = await p.evaluate(() => location.hash);
  check('and opening it lands on its page', /hdl-mux2/.test(mux2Url), true);

  const page = await p.evaluate(() => ({
    title: (document.querySelector('h1, .ws-title') || {}).textContent || '',
    statement: (document.querySelector('.prose') || {}).innerText || '',
    tabs: [...document.querySelectorAll('.ws-tabs-work .tab')].map(t => t.textContent.trim()),
    editor: !!document.querySelector('.cm-content, #answerWidget textarea'),
    run: (document.querySelector('#runBtn') || {}).textContent || '',
  }));
  ok(`the statement explains the ports (${page.statement.length} chars)`,
    /sel/.test(page.statement) && /truth table/i.test(page.statement));
  ok('there is an editor', page.editor);
  ok('Run says what it does', /Run simulation/.test(page.run));
  ok('and the panes are named for what they hold',
    page.tabs.some(t => /^Design/.test(t)) && page.tabs.some(t => /Sample testbench/.test(t))
    && page.tabs.some(t => /Waveforms/.test(t)));
  await shot(p, 'j1-mux2');
  await ctx.close();
}

/* ============================================================
   2. and by searching for the words a visitor would search for
   ============================================================ */

section('searching for SystemVerilog finds them');
{
  const { ctx, p } = await visitor();
  for (const word of ['SystemVerilog', 'Verilog', 'FPGA', 'multiplexer']) {
    await p.goto(`${BASE}/#/problems`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);
    const box = p.locator('#search, input[type="search"], .search-input').first();
    await box.fill(word);
    await p.waitForTimeout(700);
    const found = await p.evaluate(() => {
      const rows = ['.p-card', '.prob-card', '.prow']
        .map(s2 => document.querySelectorAll(s2).length).find(n => n > 0);
      return rows || 0;
    });
    ok(`"${word}" finds something (${found})`, found >= 1);
  }
  await shot(p, 'j2-search');
  await ctx.close();
}

/* ============================================================
   3. the multiplexer, worked through
   ============================================================ */

section('writing, simulating, reading the waveform and submitting');
{
  const { ctx, p } = await visitor();
  await p.goto(`${BASE}/#/p/hdl-mux2`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);

  /* The starter is a starter: it must not be the answer. */
  const starter = await p.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('hdl').editor().value);
  ok('the starter leaves the work undone',
    /TODO|your|write|implement/i.test(starter) || !/assign\s+y\s*=/.test(starter));

  /* A wrong design first — a reader's first run usually is. This one
     is the mistake the exercise is about: the output follows a and
     ignores sel entirely. */
  const WRONG = `module mux2 (
  input  logic a,
  input  logic b,
  input  logic sel,
  output logic y
);
  assign y = a;
endmodule
`;
  await p.evaluate(s => { window.SystemsLab.ProblemTypes.get('hdl').editor().value = s; }, WRONG);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await settled(p);
  await p.waitForTimeout(600);

  const wrong = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    failed: [...document.querySelectorAll('.hdl-check[data-state="fail"]')].length,
    clickable: [...document.querySelectorAll('button.hdl-check')].length,
    exec: (document.querySelector('#execState') || {}).textContent || '',
  }));
  ok(`a design that ignores sel fails (${wrong.verdict})`, /of \d+ checks passed/.test(wrong.verdict));
  ok(`and the failures are there to click (${wrong.failed} failed)`, wrong.failed >= 1);
  ok('every check row is clickable, because there is a waveform', wrong.clickable >= 1);
  await shot(p, 'j3-wrong');

  /* Clicking a failed check puts the cursor where it went wrong. */
  await p.locator('button.hdl-check[data-state="fail"]').first().click();
  await p.waitForTimeout(1200);
  const jumped = await p.evaluate(() => ({
    pane: [...document.querySelectorAll('.ws-tabs-work .tab')]
      .find(t => t.getAttribute('aria-selected') === 'true' || t.dataset.active === 'true')
      ?.textContent.trim(),
    canvas: !!document.querySelector('.wave-canvas'),
    at: (document.querySelector('#waveAt') || {}).textContent || '',
    legend: [...document.querySelectorAll('.wave-key b')].map(n => n.textContent),
  }));
  ok('it opens the waveform', jumped.canvas);
  ok(`with the cursor on an instant (${jumped.at.trim() || 'nothing'})`, /\d/.test(jumped.at));
  check('and x and z are explained next to it', jumped.legend, ['x', 'z']);
  await shot(p, 'j3-waveform');

  /* Now the real thing. */
  const RIGHT = JSON.parse(fs.readFileSync('solutions/hdl-mux2.json', 'utf8')).key.reference.sv;
  await p.evaluate(s => { window.SystemsLab.ProblemTypes.get('hdl').editor().value = s; }, RIGHT);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await settled(p);
  await p.waitForTimeout(600);
  const right = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    kind: (document.querySelector('.verdict') || {}).dataset?.kind,
  }));
  ok(`a correct design passes every sample check (${right.verdict})`,
    /All \d+ checks passed/.test(right.verdict));
  check('and is shown as right', right.kind, 'right');
  await shot(p, 'j3-right');

  await p.click('#submitBtn');
  await submitSettled(p);
  await p.waitForTimeout(800);
  const submitted = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
    status: window.SystemsLab.Store.record('hdl-mux2').status,
    attempts: window.SystemsLab.Store.record('hdl-mux2').attempts,
    waves: (document.querySelector('#resultPane') || {}).innerText || '',
  }));
  ok(`submitting marks it solved (${submitted.verdict})`, submitted.status === 'solved');
  check('and counts the attempt', submitted.attempts >= 1, true);
  await shot(p, 'j3-submitted');

  await openTab(p, 'Waveforms');
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => ({
    canvas: !!document.querySelector('.wave-canvas'),
    says: (document.querySelector('#resultPane p') || {}).textContent || '',
  }));
  ok('a submission draws no waveform', !after.canvas);
  ok('and says why', /grading testbench/.test(after.says));
  await ctx.close();
}

/* ============================================================
   4. the three other hardware exercises, through the same workflow
   ============================================================ */

section('the counter, the edge detector, the state machine and the 4-to-1 mux');
{
  for (const id of ['hdl-counter', 'hdl-edge-detector', 'hdl-sequence-fsm', 'hdl-mux']) {
    const { ctx, p } = await visitor();
    await p.goto(`${BASE}/#/p/${id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const sol = JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8'));
    await p.evaluate(s => { window.SystemsLab.ProblemTypes.get('hdl').editor().value = s; },
      sol.key.reference.sv);
    await p.waitForTimeout(300);

    const says = await p.evaluate(() => (document.querySelector('.prose') || {}).innerText || '');
    /* Only the sequential ones have a clock to be precise about. The
       two multiplexers are combinational, and demanding a reset
       paragraph from them would be demanding a wrong statement. */
    const clocked = /hdl-counter|hdl-edge-detector|hdl-sequence-fsm/.test(id);
    if (clocked) {
      ok(`${id}: the statement is precise about the clock edge`,
        /posedge|rising edge/i.test(says));
      /* Spelled `rst` in the ports, and the paragraph about it says
         synchronous, active high, and what the output does. */
      ok(`${id}: and about reset`, /reset|\brst\b/i.test(says));
      ok(`${id}: and about when the output changes`,
        /cycle|edge|same instant|next/i.test(says));
    } else {
      ok(`${id}: a combinational exercise says so rather than inventing a clock`,
        /combinational|no clock/i.test(says));
    }

    await p.click('#runBtn');
    await settled(p);
    await p.waitForTimeout(500);
    const run = await p.evaluate(() => (document.querySelector('.verdict h4') || {}).textContent || '');
    ok(`${id}: the reference passes the sample checks (${run})`, /All \d+ checks passed/.test(run));

    await p.click('#submitBtn');
    await submitSettled(p);
    await p.waitForTimeout(600);
    const sub = await p.evaluate(id2 => ({
      verdict: (document.querySelector('.verdict h4') || {}).textContent || '',
      status: window.SystemsLab.Store.record(id2).status,
    }), id);
    ok(`${id}: and the grading testbench too (${sub.verdict})`, sub.status === 'solved');
    await ctx.close();
  }
}

/* ============================================================
   5. the ways it goes wrong
   ============================================================ */

section('a build error, a simulation that never ends, and one that is stopped');
{
  const { ctx, p } = await visitor();
  await p.goto(`${BASE}/#/p/hdl-mux2`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  /* Does not compile. */
  await p.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value =
      'module mux2(input logic a, b, sel, output logic y);\n  assign y = ;\nendmodule\n';
  });
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await settled(p);
  await p.waitForTimeout(600);
  const build = await p.evaluate(() => ({
    tab: [...document.querySelectorAll('.ws-tabs-work .tab')]
      .find(t => t.getAttribute('aria-selected') === 'true' || t.dataset.active === 'true')
      ?.textContent.trim(),
    diags: [...document.querySelectorAll('.diag')].map(d => d.textContent.replace(/\s+/g, ' ').trim()),
    status: window.SystemsLab.Store.record('hdl-mux2').status,
  }));
  ok(`a syntax error opens Compiler output (${build.tab})`, /Compiler output/.test(build.tab || ''));
  ok(`with a line to look at (${(build.diags[0] || '').slice(0, 50)}…)`,
    build.diags.length >= 1 && /\d+/.test(build.diags[0] || ''));
  check('and nothing is graded from it', build.status, 'unsolved');
  await shot(p, 'j5-build-error');

  /* Never finishes.

     A forever loop with a delay in it is not enough: the testbench's
     $finish ends the simulation anyway. This one has no delay, so
     simulated time never advances, $finish is never reached, and vvp
     never returns — which is the situation that has to be survivable. */
  const ENDLESS = `module mux2 (
  input  logic a,
  input  logic b,
  input  logic sel,
  output logic y
);
  assign y = sel ? b : a;
  integer k = 0;
  initial forever k = k + 1;
endmodule
`;
  await p.evaluate(src => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value = src;
  }, ENDLESS);
  await p.waitForTimeout(300);
  await p.click('#runBtn');

  /* While it is going: Stop is on offer and the page still answers. */
  await p.waitForTimeout(2500);
  const during = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent || '',
    stop: !!document.querySelector('#stopBtn') && !document.querySelector('#stopBtn').hidden,
    menu: (() => {
      const b = document.getElementById('contentBtn');
      if (!b) return null;
      b.click();
      const open = b.getAttribute('aria-expanded');
      b.click();
      return open;
    })(),
  }));
  ok(`it is still simulating (${during.exec})`, /Simulat/.test(during.exec));
  ok('Stop is offered while it runs', during.stop);
  check('and the navigation still answers', during.menu, 'true');
  await shot(p, 'j5-running');

  await settled(p);
  await p.waitForTimeout(600);
  const hung = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent || '',
    pane: (document.querySelector('#resultPane') || {}).innerText || '',
    status: window.SystemsLab.Store.record('hdl-mux2').status,
    runEnabled: !document.querySelector('#runBtn').disabled,
  }));
  ok(`a simulation that never ends is stopped (${hung.exec})`, /Stopped/.test(hung.exec));
  ok('and is not scored as a fraction', !/of \d+ checks passed/.test(hung.pane));
  ok('nothing is graded from it', hung.status === 'unsolved');
  ok('and Run works again', hung.runEnabled);
  await shot(p, 'j5-timeout');

  /* Stopped by hand, on the same endless design — a correct one
     finishes in milliseconds from a warm simulator, and a run that is
     already over cannot be cancelled. */
  await p.evaluate(src => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value = src;
  }, ENDLESS);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await p.waitForTimeout(1500);
  const stopVisible = await p.evaluate(() => {
    const b = document.querySelector('#stopBtn');
    return !!b && !b.hidden;
  });
  ok('Stop is there while it runs', stopVisible);
  if (stopVisible) await p.click('#stopBtn', { force: true });
  await p.waitForTimeout(900);
  const stopped = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent || '',
    code: window.SystemsLab.ProblemTypes.get('hdl').editor().value,
    status: window.SystemsLab.Store.record('hdl-mux2').status,
    runEnabled: !document.querySelector('#runBtn').disabled,
  }));
  ok(`stopping says so (${stopped.exec})`, /Stopped/.test(stopped.exec));
  ok('the design is exactly as it was left',
    stopped.code.includes('initial forever k = k + 1;'));
  ok('nothing was recorded', stopped.status === 'unsolved');
  ok('and it can be run again', stopped.runEnabled);

  const RIGHT = JSON.parse(fs.readFileSync('solutions/hdl-mux2.json', 'utf8')).key.reference.sv;
  await p.evaluate(src => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value = src;
  }, RIGHT);
  await p.waitForTimeout(300);
  await p.click('#runBtn');
  await settled(p);
  await p.waitForTimeout(500);
  ok('a real run works immediately after a cancellation',
    /checks passed/.test(await p.evaluate(() =>
      (document.querySelector('.verdict h4') || {}).textContent || '')));
  await ctx.close();
}

/* ============================================================
   6. leaving while it is working
   ============================================================ */

section('navigating away mid-simulation leaves nothing behind');
{
  const { ctx, p } = await visitor();
  await p.goto(`${BASE}/#/p/hdl-counter`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  const RIGHT = JSON.parse(fs.readFileSync('solutions/hdl-counter.json', 'utf8')).key.reference.sv;
  await p.evaluate(s => { window.SystemsLab.ProblemTypes.get('hdl').editor().value = s; }, RIGHT);
  await p.waitForTimeout(300);

  await p.click('#runBtn');
  await p.waitForTimeout(400);           /* mid-flight */
  await p.goto(`${BASE}/#/p/hdl-mux2`, { waitUntil: 'commit' });
  await p.waitForTimeout(3500);

  const landed = await p.evaluate(() => ({
    hash: location.hash,
    exec: (document.querySelector('#execState') || {}).textContent || '',
    pane: (document.querySelector('#resultPane') || {}).innerText || '',
    title: (document.querySelector('h1, .ws-title') || {}).textContent || '',
  }));
  ok(`it lands on the new problem (${landed.hash})`, /hdl-mux2/.test(landed.hash));
  ok('with no verdict from the one before it', !/checks passed/.test(landed.pane));
  ok('and nothing left saying it is working', !/Compiling|Simulating|Fetching/.test(landed.exec));

  /* And the same with the tab strip and the back button. */
  await p.click('#runBtn');
  await p.waitForTimeout(400);
  await p.goBack();
  await p.waitForTimeout(3000);
  await p.goForward();
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({
    exec: (document.querySelector('#execState') || {}).textContent || '',
    editor: !!document.querySelector('.cm-content'),
  }));
  ok('back and forward during a run leave a usable page', after.editor);
  ok('and no stale status', !/Compiling|Simulating/.test(after.exec));
  await ctx.close();
}

/* ============================================================
   7. the rest of the site is where it was
   ============================================================ */

section('the rest of the site still works');
{
  const { ctx, p } = await visitor();
  const views = [
    ['#/problems', '.p-card, .prob-card, .prow'],
    ['#/learn', '.track-card, .learn-graph, svg'],
    ['#/p/metric-discrete-distances', '#answerWidget'],
    ['#/p/cpp-count-digits', '.cm-content'],
    ['#/p/algo-impl-count', '.cm-content'],
    ['#/assess', '.card, .assess, .prose'],
    ['#/setup', '.prose'],
  ];
  for (const [hash, sel] of views) {
    await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const seen = await p.evaluate(s => !!document.querySelector(s), sel);
    ok(`${hash} still renders`, seen);
  }
  await shot(p, 'j7-learn');
  await ctx.close();
}

check('no uncaught errors anywhere in these journeys', errors, []);
await browser.close();
report('browser/journeys-hdl');
