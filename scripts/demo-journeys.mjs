/* A narrated walk through the two journeys, printed as a transcript.

   This is not a test suite. The suites assert; this one shows. It drives the
   real site in a real browser, with no local runner and no proxy, and prints
   what a person would actually see at each step: the download progress, the
   compiler diagnostics, the verdict wording, the feedback on a wrong answer.

   Point it at the deployed site, which is the only place the claim matters:

     BASE=https://mobeenmohammed.github.io/systems-problems BROWSER=msedge \
       node scripts/demo-journeys.mjs

   SHOTS=1 also writes screenshots into _shots/. */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHANNEL = process.env.BROWSER || null;
const SHOTS = process.env.SHOTS ? path.join(process.cwd(), '_shots') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const clock = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const step = s => console.log(`\n  [${clock()}] ${s}`);
const saw = (label, value) => console.log(`         ${label}: ${value}`);
const head = s => console.log(`\n${'='.repeat(72)}\n  ${s}\n${'='.repeat(72)}`);

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});

/* The whole point: nothing on this machine is serving execution. The runner
   address is pointed at a port nothing listens on and the hosted proxy is
   cleared, so anything that runs, runs in the browser. */
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.addInitScript(() => {
    localStorage.setItem('systems-lab/judge-url', 'http://127.0.0.1:2999');
    localStorage.removeItem('systems-lab/hosted-url');
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log(`         !! page error: ${e.message}`));
  return p;
};

const open = async (p, hash, wait = 1500) => {
  await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(wait);
};

const typeInto = async (p, lines) => {
  const text = Array.isArray(lines) ? lines.join('\n') : lines;
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.evaluate(async t => { await navigator.clipboard.writeText(t); }, text);
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(250);
};

/* Wait for a button to go busy and come back, so the timings are real. */
const settled = async (p, sel = '#runBtn', ms = 240000) => {
  await p.waitForFunction(s => {
    const b = document.querySelector(s); return b && b.disabled;
  }, sel, { timeout: 20000 }).catch(() => {});
  await p.waitForFunction(s => {
    const b = document.querySelector(s); return b && !b.disabled;
  }, sel, { timeout: ms });
};

const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const look = p => p.evaluate(() => {
  const txt = s => (document.querySelector(s) || {}).textContent || '';
  const ed = document.querySelector('.cm-content');
  return {
    chip: txt('#execState').trim(),
    pane: txt('#resultPane').trim().replace(/\s+/g, ' ').slice(0, 220),
    note: txt('.judge-state').trim().replace(/\s+/g, ' ').slice(0, 220),
    verdict: txt('.verdict h4').trim(),
    detail: txt('.verdict p').trim(),
    diags: txt('.diags').trim().replace(/\s+/g, ' ').slice(0, 260),
    cases: document.querySelectorAll('.case').length,
    got: [...document.querySelectorAll('.case .io pre.diff-ok, .case .io pre.diff-bad')]
      .map(n => n.textContent.trim()).join(' | ').slice(0, 160),
    passes: document.querySelectorAll('.case.pass, .case.ok').length,
    editable: ed ? !ed.matches('[contenteditable="false"]') : null,
    status: txt('#problemHost .status-word').trim(),
  };
});

/* The newline inside the C++ source is spelled once, here, as a raw string:
   every other route to it loses a backslash somewhere between the shell,
   this file and the clipboard. `NL` in a source line is replaced by it. */
const NL = String.raw`"\n"`;
const cxx = lines => lines.map(l => l.split('NL').join(NL));

/* The right program for cpp-greet-and-sum. */
const CORRECT = [
  '#include <algorithm>',
  '#include <iostream>',
  '#include <map>',
  '#include <string>',
  '#include <vector>',
  '',
  'int add(int a, int b) { return a + b; }',
  '',
  'std::string greeting(const std::string& name) {',
  '    return "Hello, " + name + "!";',
  '}',
  '',
  'int main() {',
  '    std::string name;',
  '    int a = 0, b = 0;',
  '    std::getline(std::cin, name);',
  '    std::cin >> a >> b;',
  '    std::cout << greeting(name) << NL;',
  '    std::cout << a << " + " << b << " = " << add(a, b) << NL;',
  '    return 0;',
  '}',
];

/* The same thing with the greeting wrong, and with map, vector and
   algorithm really used - that is the header set the brief names. */
const WRONG = [
  '#include <algorithm>',
  '#include <iostream>',
  '#include <map>',
  '#include <string>',
  '#include <vector>',
  '',
  'int add(int a, int b) { return a + b; }',
  '',
  'std::string greeting(const std::string& name) {',
  '    std::map<std::string, int> seen;',
  '    seen[name] += 1;',
  '    std::vector<std::string> v{name};',
  '    std::sort(v.begin(), v.end());',
  '    return "Hi, " + v.front() + "!";   // wrong greeting, on purpose',
  '}',
  '',
  'int main() {',
  '    std::string name;',
  '    int a = 0, b = 0;',
  '    std::getline(std::cin, name);',
  '    std::cin >> a >> b;',
  '    std::cout << greeting(name) << NL;',
  '    std::cout << a << " + " << b << " = " << add(a, b) << NL;',
  '    return 0;',
  '}',
];

/* ====================================================================
   Journey one: C++ in the browser, on the deployed site, no runner.
   ==================================================================== */

head('JOURNEY ONE - browser C++ on the deployed site, with no runner at all');
console.log(`  site:    ${BASE}`);
console.log(`  browser: ${CHANNEL || 'bundled chromium'}`);
console.log('  runner:  http://127.0.0.1:2999  (nothing listens there)');
console.log('  hosted:  cleared');

{
  const p = await fresh();

  step('Open a C++ problem. Nothing has been downloaded yet.');
  await open(p, '#/p/cpp-greet-and-sum');
  saw('execution chip', (await look(p)).chip);
  await shot(p, 'j1-01-cold');

  step('Type a wrong attempt - iostream, string, vector, map, algorithm.');
  await typeInto(p, cxx(WRONG));

  const seen = new Set();
  await p.locator('#runBtn').click();
  /* Watch the progress the brief asks to be understandable. */
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    const now = await p.evaluate(() => ({
      text: (document.querySelector('#cxxDlText') || {}).textContent || '',
      busy: (document.querySelector('#runBtn') || {}).disabled,
      stop: !!document.querySelector('#stopBtn')
        && !document.querySelector('#stopBtn').hidden,
    }));
    if (now.text && !seen.has(now.text)) {
      seen.add(now.text);
      saw('progress', `${now.text}${now.stop ? '   [Stop offered]' : ''}`);
    }
    if (!now.busy && seen.size) break;
    await p.waitForTimeout(250);
  }
  await settled(p);
  saw('cold first run, download included', clock());
  let r = await look(p);
  saw('sample cases', `${r.passes} of ${r.cases} passing`);
  await shot(p, 'j1-02-samples');

  step('Submit it, wrong.');
  await p.locator('#submitBtn').click();
  await settled(p, '#submitBtn');
  r = await look(p);
  saw('verdict', r.verdict);
  saw('detail', r.detail.slice(0, 160));
  saw('editor still editable', r.editable);
  await shot(p, 'j1-03-wrong');

  step('Correct the greeting and submit again.');
  await typeInto(p, cxx(CORRECT));
  await p.locator('#submitBtn').click();
  await settled(p, '#submitBtn');
  r = await look(p);
  saw('verdict', r.verdict);
  saw('status now', r.status);
  await shot(p, 'j1-04-accepted');

  step('A compile error, to see the diagnostics.');
  await typeInto(p, '#include <iostream>\nint main() { std::cout << undefined_thing; }');
  await p.locator('#runBtn').click();
  await settled(p);
  r = await look(p);
  saw('what the result pane says', r.pane || '(empty)');
  saw('diagnostics', r.diags || '(none captured)');
  saw('standing submission verdict, untouched', `${r.verdict} - ${r.detail}`);
  await shot(p, 'j1-05-compile-error');

  step('An infinite loop, to see the timeout.');
  await typeInto(p, 'int main() { for (;;) {} }');
  let mark = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  saw('took', `${((Date.now() - mark) / 1000).toFixed(1)}s`);
  r = await look(p);
  saw('what the result pane says', r.pane || '(empty)');
  saw('it did build', await p.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').lastBuildOk()));
  await shot(p, 'j1-06-timeout');

  step('Then a valid program straight afterwards - the compiler survived.');
  await typeInto(p, cxx([
    '#include <iostream>',
    'int main() { std::cout << "alive" << NL; }',
  ]));
  mark = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  saw('took', `${((Date.now() - mark) / 1000).toFixed(1)}s  (no 90MB re-download)`);
  saw('cases ran', (await look(p)).cases);
  await shot(p, 'j1-07-recovered');

  step('Cancellation: start a long run and press Stop.');
  await typeInto(p, 'int main() { for (;;) {} }');
  await p.locator('#runBtn').click();
  await p.waitForFunction(() => !document.getElementById('stopBtn').hidden,
    { timeout: 40000 });
  saw('Stop offered mid-run', true);
  await p.waitForTimeout(400);
  mark = Date.now();
  await p.locator('#stopBtn').click();
  await settled(p);
  saw('came back in', `${((Date.now() - mark) / 1000).toFixed(1)}s`);
  r = await look(p);
  saw('what the result pane says', r.pane || '(empty)');
  saw('Stop put away', await p.evaluate(() =>
    document.getElementById('stopBtn').hidden));
  saw('Run usable again',
    await p.evaluate(() => !document.querySelector('#runBtn').disabled));
  await shot(p, 'j1-08-cancelled');

  step('And a run straight after the cancellation.');
  await typeInto(p, cxx([
    '#include <iostream>',
    'int main() { std::cout << "still here" << NL; }',
  ]));
  mark = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  saw('took', `${((Date.now() - mark) / 1000).toFixed(1)}s`);
  saw('cases ran', (await look(p)).cases);

  step('A reload, to show the assets are cached rather than re-fetched.');
  mark = Date.now();
  await open(p, '#/p/cpp-greet-and-sum');
  await typeInto(p, cxx([
    '#include <iostream>',
    'int main() { std::cout << "cached" << NL; }',
  ]));
  await p.locator('#runBtn').click();
  await settled(p);
  saw('reload, type and run', `${((Date.now() - mark) / 1000).toFixed(1)}s`);

  step('The platform the code actually runs on, printed by the code itself.');
  await typeInto(p, cxx([
    '#include <cstdint>',
    '#include <iostream>',
    'int main() {',
    '    std::cout << "int="    << sizeof(int)',
    '              << " long="  << sizeof(long)',
    '              << " ptr="   << sizeof(void*)',
    '              << " size_t="<< sizeof(std::size_t)',
    '              << " ll="    << sizeof(long long) << NL;',
    '}',
  ]));
  await p.locator('#runBtn').click();
  await settled(p);
  saw('what it printed', (await look(p)).got);
  saw('(native Linux x86-64 would say int=4 long=8 ptr=8 size_t=8 ll=8)', '');
  await shot(p, 'j1-09-platform');

  step('A problem the audit marked native-only.');
  await open(p, '#/p/algo-running-max');
  const native = await look(p);
  saw('execution chip', native.chip);
  saw('the note under it', native.note || '(none)');
  saw('language tabs', await p.evaluate(() =>
    [...document.querySelectorAll('.lang-tab')].map(b =>
      `${b.textContent.trim()}${b.disabled ? ' (disabled)' : ''}`
      + `${b.getAttribute('aria-pressed') === 'true' ? ' <- selected' : ''}`).join(', ')));
  saw('Run disabled right now', await p.evaluate(() =>
    document.getElementById('runBtn').disabled));
  /* C++ is the one the audit blocked and it is the selected tab, disabled,
     titled "Nothing available can run this". Run is still clickable, because
     JavaScript on the same problem can run - so press it and see what it
     says, which is the thing that actually matters. */
  await p.locator('#runBtn').click();
  await p.waitForTimeout(3500);
  saw('pressing Run anyway says', await p.evaluate(() =>
    (document.getElementById('resultPane') || {}).textContent
      .replace(/\s+/g, ' ').trim().slice(0, 420)));
  saw('and records', await p.evaluate(() =>
    window.SystemsLab.Store.record('algo-running-max').status));
  saw('what describe() returns', await p.evaluate(async () =>
    JSON.stringify(await window.SystemsLab.Runners
      .describe(['cpp'], 'algo-running-max'))));
  await shot(p, 'j1-10-native-only');

  await p.context().close();
}

/* ====================================================================
   Journey two: solving mathematics.
   ==================================================================== */

head('JOURNEY TWO - solving mathematics');

const mlook = p => p.evaluate(() => {
  const txt = s => (document.querySelector(s) || {}).textContent || '';
  return {
    verdict: txt('.verdict h4').trim(),
    detail: txt('.verdict p').trim(),
    syntax: txt('.maths-syntax').trim().replace(/\s+/g, ' ').slice(0, 150),
    preview: txt('.maths-preview').trim(),
    note: txt('.needs-answer').trim(),
    status: txt('#problemHost .status-word').trim(),
    katex: document.querySelectorAll('.katex').length,
    mathml: document.querySelectorAll('.katex-mathml').length,
    dollars: (txt('.statement').match(/\$/g) || []).length,
  };
});

{
  const p = await fresh();

  step('Switch subject to Mathematics.');
  await open(p, '#/problems');
  await p.locator('.subject-btn', { hasText: /Math/i }).click();
  await p.waitForTimeout(800);
  const cat = await p.evaluate(() => ({
    rows: document.querySelectorAll('.prow').length,
    topics: [...document.querySelectorAll('#fTopic option')].map(o => o.textContent.trim()),
    subject: ((document.querySelector('.subject-btn[aria-pressed="true"]') || {})
      .textContent || '').trim(),
  }));
  saw('subject', cat.subject);
  saw('problems listed', cat.rows);
  saw('topics offered', cat.topics.join(' / '));
  await shot(p, 'j2-01-catalogue');

  step('Search still crosses subjects.');
  await p.locator('#fSearch').fill('cache');
  await p.waitForTimeout(700);
  saw('what it says', await p.evaluate(() => ({
    count: (document.getElementById('catalogCount') || {}).textContent.trim(),
    rows: document.querySelectorAll('#catalogList .prow').length,
  })).then(r => `${r.rows} rows - "${r.count}"`));
  await p.locator('#fClear').click();

  step('Open a probability problem with an exact numeric answer.');
  await open(p, '#/p/prob-bayes-screening');
  let m = await mlook(p);
  saw('typeset spans', m.katex);
  saw('MathML copies for a screen reader', m.mathml);
  saw('unrendered dollars left in the statement', m.dollars);
  saw('syntax help shown', m.syntax);
  await shot(p, 'j2-02-statement');

  const field = () => p.locator('.maths-answer input, .maths-answer textarea').first();

  step('Type something that is not an answer at all.');
  await field().fill('3/(');
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(900);
  m = await mlook(p);
  saw('verdict', m.verdict || '(none - and that is the point)');
  saw('told instead', (m.note || m.detail).slice(0, 220));
  await shot(p, 'j2-03-syntax');

  step('Now a wrong answer: the reversed conditional.');
  await field().fill('0.99');
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(900);
  m = await mlook(p);
  saw('verdict', m.verdict);
  saw('feedback', m.detail.slice(0, 280));
  await shot(p, 'j2-04-misconception');

  step('The right value, typed as the quotient rather than the number.');
  const key = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'solutions/prob-bayes-screening.json'), 'utf8'));
  saw('stored key', JSON.stringify(key.key));
  /* Deliberately not the stored string: the whole quotient, unsimplified,
     the way it falls out of the theorem. If this is accepted, equivalence
     is being decided rather than strings compared. */
  const typed = '(99/100 * 1/200) / (99/100 * 1/200 + 5/100 * 199/200)';
  saw('typed instead', typed);
  await field().fill(typed);
  await p.waitForTimeout(600);
  saw('live preview', (await mlook(p)).preview);
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(900);
  m = await mlook(p);
  saw('verdict', m.verdict);
  saw('status', m.status);
  await shot(p, 'j2-05-accepted');

  step('A written proof: saved, never marked.');
  await open(p, '#/p/metric-continuity-epsilon-delta');
  const hasProof = await p.evaluate(() => !!document.querySelector('.proof-box'));
  saw('free-form proof box', hasProof);
  if (hasProof) {
    await p.locator('.proof-box').fill(
      'Let x be a point of X and let eps > 0. Since f is continuous at x there '
      + 'is delta > 0 such that d(x, y) < delta implies d(f(x), f(y)) < eps. '
      + 'Hence f(B(x, delta)) is contained in B(f(x), eps), as required.');
    await p.waitForTimeout(900);
    saw('autosaved while writing', await p.evaluate(() =>
      `${(window.SystemsLab.Store
        .draft('metric-continuity-epsilon-delta', 'proof') || '').length} characters`));

    await p.locator('#submitBtn').click();
    await p.waitForTimeout(900);
    m = await mlook(p);
    saw('verdict', m.verdict);
    saw('which says', m.detail.slice(0, 200));
    saw('status recorded by submitting', await p.evaluate(() =>
      window.SystemsLab.Store.record('metric-continuity-epsilon-delta').status));
    saw('model proof still behind an explicit action', await p.evaluate(() =>
      !!document.querySelector('.tab[data-tab="solution"][data-locked="true"]')));
    await shot(p, 'j2-06-proof-saved');

    step('Reveal the model proof and self-review against the rubric.');
    const rubric = await p.evaluate(() => ({
      items: [...document.querySelectorAll('.rubric li')]
        .map(n => n.textContent.trim().replace(/\s+/g, ' ').slice(0, 78)),
      model: !!document.getElementById('showModel'),
      done: !!document.getElementById('reviewDone'),
    }));
    for (const it of rubric.items) saw('rubric', it);
    saw('a button to reveal the model proof', rubric.model);

    if (rubric.model) {
      /* Revealing goes through a real confirm(), which is the explicit
         action. Print what it asks before agreeing to it. */
      p.once('dialog', async d => {
        saw('it asks first', d.message().replace(/\s+/g, ' ').slice(0, 180));
        await d.accept();
      });
      await p.locator('#showModel').click();
      await p.waitForTimeout(1200);
      saw('Solution tab now open', await p.evaluate(() =>
        !document.querySelector('.tab[data-tab="solution"][data-locked="true"]')));
      saw('a model proof is on screen', await p.evaluate(() => {
        const n = document.querySelector('#panel-solution, .panel[data-panel="solution"]')
          || [...document.querySelectorAll('.panel')].find(x => !x.hidden);
        return n ? `${n.textContent.trim().length} characters` : '(not found)';
      }));
      saw('and the record says', await p.evaluate(() =>
        window.SystemsLab.Store.record('metric-continuity-epsilon-delta').status));
    }

    step('Tick the rubric and record the self-review.');
    await p.evaluate(() => {
      document.querySelectorAll('.rubric input').forEach(c => {
        c.checked = true;
        c.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await p.locator('#reviewDone').click();
    await p.waitForTimeout(1200);
    m = await mlook(p);
    saw('status word on the page', m.status);
    saw('what the store holds', await p.evaluate(() => {
      const r = window.SystemsLab.Store.record('metric-continuity-epsilon-delta');
      return `status=${r.status} selfReviewed=${r.selfReviewed} `
        + `rubric=${(r.rubric || []).length} lines`;
    }));
    await shot(p, 'j2-07-self-reviewed');
  }

  step('Working is autosaved: go away, come back, look again.');
  await p.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await open(p, '#/p/metric-continuity-epsilon-delta');
  saw('proof text still there', await p.evaluate(() => {
    const b = document.querySelector('.proof-box');
    return b ? `${b.value.length} characters` : '(no box)';
  }));

  step('Progress is shared across subjects, not partitioned by the switch.');
  await open(p, '#/profile');
  saw('xp', await p.evaluate(() =>
    (document.querySelector('#purseXp') || {}).textContent));
  saw('stats', await p.evaluate(() =>
    ((document.querySelector('.stat-row') || {}).textContent || '')
      .replace(/\s+/g, ' ').trim().slice(0, 220)));
  await shot(p, 'j2-08-profile');

  await p.context().close();
}

console.log(`\n  done in ${clock()}\n`);
await browser.close();
