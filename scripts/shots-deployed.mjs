/* Screenshots of the deployed site, in the order somebody walks it.

   Headed on purpose: headless Chromium uses overlay scrollbars, which
   take no layout space and never appear in a screenshot, so a headless
   shot cannot show whether a scrollbar is the right colour — which is
   half of what these are for.

   The journey suites assert; this only looks. Run it after a deploy to
   get the pictures that go with a report.

   Run: node scripts/shots-deployed.mjs      → _shots/deployed/ */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://mobeenmohammed.github.io/systems-problems';
const OUT = path.join(process.cwd(), '_shots', 'deployed');
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: false });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const p = await ctx.newPage();
p.on('dialog', d => d.accept());
const shot = (name, opts = {}) => p.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });

const go = async (hash, wait = 2600) => {
  await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(wait);
};
const settled = () => p.waitForFunction(() => {
  const e = document.querySelector('#execState');
  return e && e.textContent
    && !/Compil|Simulat|Fetch|Simulator|Running|Grading|Checking|Working/.test(e.textContent);
}, { timeout: 300_000 });
const tab = async (label) => {
  for (const t of await p.$$('.ws-tabs-work .tab')) {
    if ((await t.textContent()).trim().startsWith(label)) { await t.click(); return true; }
  }
  return false;
};

try {
  /* 1. the way in */
  await go('#/', 2000);
  await p.locator('#contentBtn').click();
  await p.waitForTimeout(500);
  await shot('01-content-menu');
  await p.locator('.navmenu-item').filter({ hasText: /Digital logic/i }).first().click();
  await p.waitForTimeout(1600);
  await shot('02-catalogue-systemverilog');

  /* 2. the multiplexer, as a reader meets it */
  await go('#/p/hdl-mux2');
  await shot('03-mux2-statement');

  /* 3. a wrong design, and the failed checks */
  await p.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('hdl').editor().value =
      'module mux2 (\n  input  logic a,\n  input  logic b,\n  input  logic sel,\n'
      + '  output logic y\n);\n  assign y = a;\nendmodule\n';
  });
  await p.waitForTimeout(400);
  await p.click('#runBtn');
  await settled();
  await p.waitForTimeout(900);
  await shot('04-mux2-failed-checks');

  /* 4. the waveform, with the cursor where a failed check put it */
  await p.locator('button.hdl-check[data-state="fail"]').first().click();
  await p.waitForTimeout(1500);
  await shot('05-mux2-waveform-cursor');

  /* 5. a testbench of the reader's own */
  await tab('My testbench');
  await p.waitForTimeout(600);
  await p.click('#seedMyTb');
  await p.waitForTimeout(700);
  await shot('06-my-testbench');

  /* 6. correct, submitted */
  const right = await (await fetch(`${BASE}/solutions/hdl-mux2.json`)).json();
  await tab('Design');
  await p.waitForTimeout(400);
  await p.evaluate(s => { window.SystemsLab.ProblemTypes.get('hdl').editor().value = s; },
    right.key.reference.sv);
  await p.waitForTimeout(400);
  await p.click('#submitBtn');
  await p.waitForFunction(() => {
    const s = document.querySelector('#submitBtn');
    return s && !s.disabled && /Submit/.test(s.textContent);
  }, { timeout: 300_000 });
  await p.waitForTimeout(900);
  await shot('07-mux2-submitted');

  /* 7. the Rust exercise from the report */
  await go('#/p/rust-borrow-shared-exclusive');
  await shot('08-rust-statement-and-scrollbar');
  const refRust = await (await fetch(`${BASE}/solutions/rust-borrow-shared-exclusive.json`)).json();
  await p.evaluate(s => { window.SystemsLab.ProblemTypes.get('code').editor().value = s; },
    refRust.key.reference.rust);
  await p.waitForTimeout(600);
  await p.click('#runBtn');
  await settled();
  await p.waitForTimeout(900);
  await shot('09-rust-platform-message');
  await p.evaluate(() => {
    const d = document.querySelector('.platform-detail');
    if (d) d.open = true;
  });
  await p.waitForTimeout(400);
  await shot('10-rust-platform-detail-open');

  /* 8. a Rust exercise that does run */
  await go('#/p/rust-option-lookup');
  const refOpt = await (await fetch(`${BASE}/solutions/rust-option-lookup.json`)).json();
  await p.evaluate(s => { window.SystemsLab.ProblemTypes.get('code').editor().value = s; },
    refOpt.key.reference.rust);
  await p.waitForTimeout(600);
  await p.click('#runBtn');
  await settled();
  await p.waitForTimeout(900);
  await shot('11-rust-ran');

  /* 9. inputs of a reader's own, on a C++ exercise */
  await go('#/p/cpp-count-digits');
  await p.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('code').editor().value =
      '#include <iostream>\n#include <string>\nint main() { std::string s; std::cin >> s;\n'
      + '  std::cout << s.size() << "\\n"; return 0; }\n';
  });
  await p.waitForTimeout(400);
  await tab('Test cases');
  await p.waitForTimeout(600);
  await p.click('#addMyCase');
  await p.waitForTimeout(300);
  await p.locator('.mycase-in').first().fill('hello');
  await p.waitForTimeout(500);
  await p.click('#runMyCases');
  await p.waitForFunction(() => {
    const n = document.querySelector('#myCasesNote');
    return n && /Ran \d+|not compile|Could not/.test(n.textContent);
  }, { timeout: 300_000 });
  await p.waitForTimeout(700);
  await shot('12-my-own-inputs');

  console.log(`wrote ${fs.readdirSync(OUT).length} screenshots to _shots/deployed`);
} finally { await b.close(); }
