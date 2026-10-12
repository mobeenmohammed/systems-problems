/* The Submissions tab: what you sent, what it did, and getting it back.

   Real submissions, in a real browser, on a JavaScript problem — because
   JavaScript runs in the page itself, so this suite needs nothing but the
   site served. No runner, no proxy, no toolchain. Everything here goes
   through Submit, which also runs the hidden cases: that is the difference
   between a submission and a Run, and it is the whole reason this list is
   worth keeping.

   Needs the site served:   npm run serve
   Run: node tests/browser/submissions.test.mjs
        SHOTS=1 node tests/browser/submissions.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { section, check, ok, report, toEditorTab } from '../harness.mjs';

const CHANNEL = process.env.BROWSER || null;
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not being served at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  /* No local runner here, and the page is correctly finding that out. */
  if (/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|Failed to load resource/.test(m.text())) return;
  errors.push('console: ' + m.text());
});

/* algo-running-max: two visible cases, five hidden, and JavaScript among its
   languages. Seven cases is enough for "1 of 7" to be a different sentence
   from "failed". */
const PROBLEM = 'algo-running-max';
const CASES = 7;

const open = async (hash, wait = 1200) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* goto() to the address the page is already at is a same-document
   navigation, so the store keeps whatever it has in memory and a write
   straight into localStorage is painted over rather than read. Anything
   that has to come back off disk reloads properly. */
const reload = async (wait = 1300) => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* The language is a dropdown in the tab strip now, not a row of tabs, so
   choosing one means opening it first - which is what a person does too. */
const pickLang = async (id) => {
  await page.locator('.lang-pick-btn').click();
  await page.waitForTimeout(150);
  await page.locator(`.lang-opt[data-lang="${id}"]`).click();
  await page.waitForTimeout(400);
};

/* A real clipboard paste. Typing a program one character at a time through
   an editor that closes brackets for you produces doubled braces, which is
   a picture of the test's own mistake. */
async function paste(text) {
  await toEditorTab(page);
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.evaluate(async t => { await navigator.clipboard.writeText(t); }, text);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
}

const tab = name => page.locator(`.ws-tabs-work .tab[data-tab="${name}"]`);
const openTab = async (name) => { await tab(name).click(); await page.waitForTimeout(300); };

async function submit() {
  await page.locator('#submitBtn').click();
  /* The button says "Checking…" while it is out and comes back on its own. */
  await page.waitForFunction(
    () => { const b = document.getElementById('submitBtn'); return b && !b.disabled; },
    null, { timeout: 30000 });
  await page.waitForTimeout(400);
}

const rows = () => page.evaluate(() => [...document.querySelectorAll('.subs .sub')].map(d => ({
  outcome: (d.querySelector('.sub-verdict') || {}).dataset?.outcome || '',
  verdict: (d.querySelector('.sub-verdict') || {}).textContent || '',
  cases: (d.querySelector('.sub-cases') || {}).textContent || '',
  lang: (d.querySelector('.sub-lang') || {}).textContent || '',
  when: (d.querySelector('.sub-when') || {}).textContent || '',
  at: (d.querySelector('.sub-when') || {}).getAttribute?.('title') || '',
  ms: (d.querySelector('.sub-ms') || {}).textContent || '',
  n: (d.querySelector('.sub-n') || {}).textContent || '',
  open: d.open,
})));

/* One value, then nothing: right for the single-value case and wrong for the
   other six. "1 of 7" is a more useful thing to read back than "wrong". */
const NEARLY = `const data = readStdin().split(/\\s+/).filter(s => s.length);
print(data[1]);
`;

const RIGHT = `const data = readStdin().split(/\\s+/).filter(s => s.length);
const n = Number(data[0]);
let best = 0;
for (let i = 0; i < n; i++) {
  const v = Number(data[i + 1]);
  if (i === 0 || v > best) best = v;
  print(String(best));
}
`;

/* ---------------- nothing sent yet ---------------- */

section('the tab is there before there is anything in it');
await open(`#/p/${PROBLEM}`);
{
  const m = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tabs-work .tab')].map(t => t.dataset.tab),
    labels: [...document.querySelectorAll('.ws-tabs-work .tab')].map(t => t.textContent.trim()),
    badge: !!document.querySelector('.ws-tabs-work .tab[data-tab="subs"] .badge'),
  }));
  ok(`it is one of the result tabs (${m.tabs.join(', ')})`, m.tabs.includes('subs'));
  ok('labelled Submissions', m.labels.some(t => t.startsWith('Submissions')));
  ok('with no count on it, because there is nothing to count', !m.badge);

  await openTab('subs');
  const text = await page.locator('#resultPane').textContent();
  ok('and it says so rather than showing an empty list', /Nothing submitted yet/.test(text));
  ok('naming what does count', /Run tests does not count/.test(text));
  check('with no rows', (await rows()).length, 0);
}

/* ---------------- a run is not a submission ---------------- */

section('Run tests is not a submission');
await pickLang('js');
await paste(RIGHT);
{
  await page.locator('#runBtn').click();
  await page.waitForFunction(
    () => { const b = document.getElementById('runBtn'); return b && !b.disabled; },
    null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await openTab('results');
  const ran = (await page.locator('#resultPane').textContent() || '').trim();
  ok(`the samples did run (${ran.slice(0, 48)}…)`, /case|passed|Correct/i.test(ran));
  await openTab('subs');
  check('and the submissions list is still empty', (await rows()).length, 0);
  check('nor is one in the store', await page.evaluate(
    () => window.SystemsLab.Store.submissions('algo-running-max').length), 0);
}

/* ---------------- a real submission ---------------- */

section('a submission that passes some of the cases');
await paste(NEARLY);
await submit();
{
  await openTab('subs');
  const list = await rows();
  check('one row', list.length, 1);
  check('marked as failed', list[0].outcome, 'failed');
  check('in those words', list[0].verdict, 'Failed');
  check(`and not as nothing — the sample case passed (${list[0].cases})`,
    list[0].cases, `1/${CASES} cases`);
  check('the language it was written in', list[0].lang, 'JavaScript');
  check('when, in a form you can read', list[0].when, 'just now');
  ok(`with the exact stamp underneath (${list[0].at})`, !Number.isNaN(Date.parse(list[0].at)));
  /* Seven small cases of JavaScript finish inside the millisecond the
     runner can measure, so this is "<1 ms" rather than "0 ms" — but it is
     there, rather than the row going quiet about it. */
  ok(`how long it took (${list[0].ms})`, /\d/.test(list[0].ms));
  check('and which attempt it was', list[0].n, '#1');
  ok('folded shut, because the point is scanning the verdicts', !list[0].open);

  check('the tab now carries the count',
    await tab('subs').locator('.badge').textContent(), '1');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'submissions.png') });
}

section('and one that passes all of them');
await paste(RIGHT);
await submit();
{
  await openTab('subs');
  const list = await rows();
  check('two rows now', list.length, 2);
  check('the newest first', list[0].n, '#2');
  check('which is the one that passed', list[0].outcome, 'passed');
  check('in those words', list[0].verdict, 'Passed');
  check('with every case', list[0].cases, `${CASES}/${CASES} cases`);
  check('and the earlier one still below it', list[1].n, '#1');
  check('still saying what it did', list[1].cases, `1/${CASES} cases`);
  check('the count followed',
    await tab('subs').locator('.badge').textContent(), '2');
  ok('the problem is solved', await page.evaluate(() =>
    window.SystemsLab.Store.record('algo-running-max').status === 'solved'));
}

section('the code is in there, exactly as it was sent');
{
  await page.locator('.subs .sub').first().locator('summary').click();
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => ({
    open: document.querySelector('.subs .sub').open,
    src: (document.querySelector('.subs .sub .sub-src') || {}).textContent || '',
  }));
  ok('the row opens', m.open);
  check('and holds the program', m.src.trim(), RIGHT.trim());
  ok('with nothing cut off it', !/characters were kept/.test(
    await page.locator('.subs .sub').first().textContent()));
}

/* ---------------- getting it back ---------------- */

section('an old submission can be put back in the editor');
{
  /* The second row is the near miss. Loading it replaces the editor, which
     is the only copy of what is in there, so it asks first. */
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.accept(); });
  const second = page.locator('.subs .sub').nth(1);
  await second.locator('summary').click();
  await page.waitForTimeout(200);
  await second.locator('button', { hasText: 'Load into the editor' }).click();
  await page.waitForTimeout(500);

  ok(`it asked before replacing what was there (“${asked.slice(0, 48)}…”)`,
    /replaced/i.test(asked));
  const now = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  check('the editor holds the submission', now.trim(), NEARLY.trim());
  check('and it was saved as the draft, not just displayed',
    (await page.evaluate(() => window.SystemsLab.Store.draft('algo-running-max', 'js'))).trim(),
    NEARLY.trim());
}

section('loading one written in another language switches to it');
{
  /* A C++ submission, recorded the way the page records one, so the
     language switch can be exercised without a toolchain. */
  await page.evaluate(() => {
    const S = window.SystemsLab.Store;
    const p = window.SystemsLab.Catalog.meta('algo-running-max');
    S.submit(p, {
      correct: false, score: 0, lang: 'cpp', built: false,
      source: 'int main() { this is not C++ }',
    });
  });
  await reload();
  await openTab('subs');
  const list = await rows();
  check('it is at the top', list[0].lang, 'C++');
  check('and reads as a build failure, not a wrong answer', list[0].outcome, 'build-failed');
  check('in those words', list[0].verdict, 'Did not build');
  check('claiming no cases, because none ran', list[0].cases, '');

  page.once('dialog', d => d.accept());
  await page.locator('.subs .sub').first().locator('summary').click();
  await page.waitForTimeout(200);
  await page.locator('.subs .sub').first()
    .locator('button', { hasText: 'Load into the editor' }).click();
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => ({
    lang: window.SystemsLab.Store.record('algo-running-max').lang,
    src: window.SystemsLab.ProblemTypes.get('code').editor().value,
    picked: document.querySelector('.lang-pick').dataset.lang,
    named: document.querySelector('.lang-pick-name').textContent,
    pressed: [...document.querySelectorAll('.lang-opt')]
      .filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.dataset.lang),
  }));
  check('the editor switched language', m.lang, 'cpp');
  check('exactly one option is marked', m.pressed.join(','), 'cpp');
  check('and the picker says it in words', m.named, 'C++');
  check('rather than still claiming the one it left', m.picked, 'cpp');
  ok('and the program came with it', m.src.includes('this is not C++'));
}

/* ---------------- it is storage, not a session ---------------- */

section('they survive a reload');
{
  await reload();
  await openTab('subs');
  const list = await rows();
  check('all three are still there', list.length, 3);
  check('in the same order', list.map(r => r.n).join(','), '#3,#2,#1');
  ok('the times are no longer "just now" relative to nothing',
    list.every(r => r.when.length > 0));
}

section('a submission whose code was dropped still says what it did');
{
  /* What the store does when the quota is reached: the oldest verdicts
     and their programs go together, and a program that could not be
     written at all leaves its verdict behind. The row has to be honest
     about which happened — and must not offer a Load button that
     cannot work. */
  const dropped = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('invariant/state/v1'));
    const subs = raw.progress['algo-running-max'].subs;
    /* The oldest, which is the one at the bottom of the list. */
    subs[0].stored = false;
    subs[0].source = null;
    localStorage.setItem('invariant/state/v1', JSON.stringify(raw));
    return subs.length;
  });
  check('three are stored before the reload', dropped, 3);
  await reload();
  await openTab('subs');
  const first = page.locator('.subs .sub').last();
  await first.locator('summary').click();
  await page.waitForTimeout(200);
  const text = await first.textContent();
  ok(`it says no code was kept ("${text.replace(/\s+/g, ' ').slice(0, 60)}")`,
    /No code was kept|could not be saved/.test(text));
  ok('rather than showing an empty program', !(await first.locator('.sub-src').count()));
  ok('and offers no button that cannot work',
    !(await first.locator('button', { hasText: 'Load into the editor' }).count()));
  check('while the verdict is still readable',
    (await first.locator('.sub-cases').textContent()), `1/${CASES} cases`);
}

/* ---------------- it has to fit ---------------- */

section('a long line scrolls inside the row, not the page');
{
  /* Into the newest, which is the row at the top. Written where
     programs actually live now — the vault — rather than inline on the
     verdict, so this exercises the path the page really takes. */
  await page.evaluate(async () => {
    const S = window.SystemsLab;
    const subs = S.Store.submissions('algo-running-max');
    const newest = subs[0];
    const long = `const x = ${'"a very long line indeed" + '.repeat(60)}"end";`;
    await S.Sources.put('algo-running-max', newest.at, long);
    S.Sources.forget();
    /* And the verdict's own figures, which the row reads before the
       program arrives. */
    const raw = JSON.parse(localStorage.getItem('invariant/state/v1'));
    const list = raw.progress['algo-running-max'].subs;
    const at = list[list.length - 1];
    at.stored = true;
    at.source = null;
    at.bytes = long.length;
    localStorage.setItem('invariant/state/v1', JSON.stringify(raw));
  });
  for (const w of [1500, 1024, 768, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await reload();
    await openTab('subs');
    /* Opened, not toggled: this runs once per width and a second
       click on the same summary would shut it again. */
    await page.evaluate(() => {
      const d = document.querySelector('.subs .sub');
      if (d) d.open = true;
    });
    /* The program is read out of IndexedDB when the row is opened, not
       when the list is painted, so this waits for the node rather than
       for a guessed number of milliseconds. */
    await page.waitForFunction(() => [...document.querySelectorAll('.sub-src')]
      .some(n => n.textContent.includes('very long line indeed')), { timeout: 15_000 });
    const m = await page.evaluate(() => {
      /* The row that holds the long line, by its content rather than by
         where it happens to sit in the list. */
      const pre = [...document.querySelectorAll('.sub-src')]
        .find(n => n.textContent.includes('very long line indeed'));
      const pane = document.getElementById('resultPane');
      return {
        over: document.documentElement.scrollWidth - window.innerWidth,
        found: !!pre,
        scrolls: pre ? pre.scrollWidth > pre.clientWidth + 1 : false,
        inside: pre && pane
          ? pre.getBoundingClientRect().right <= pane.getBoundingClientRect().right + 1
          : false,
      };
    });
    ok(`${w}px: the long submission is on screen`, m.found);
    ok(`${w}px: the page does not scroll sideways (${m.over}px)`, m.over <= 2);
    ok(`${w}px: the program scrolls in its own box`, m.scrolls);
    ok(`${w}px: which stays inside the pane`, m.inside);
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
}

section('the program is coloured, and it is still only text');
{
  /* Displayed code is highlighted here, which means HTML is being inserted
     rather than text set. So: a program that is itself markup. */
  const NASTY = 'const bad = "<img src=x onerror=\'window.__pwned = 1\'>";\n'
    + 'print("</' + 'script><b>bold</b>");\n';
  await page.evaluate(async (src) => {
    /* Where programs live: the vault, keyed by the verdict's `at`. */
    const S = window.SystemsLab;
    const newest = S.Store.submissions('algo-running-max')[0];
    await S.Sources.put('algo-running-max', newest.at, src);
    S.Sources.forget();
    const raw = JSON.parse(localStorage.getItem('invariant/state/v1'));
    const subs = raw.progress['algo-running-max'].subs;
    subs[subs.length - 1].source = null;
    subs[subs.length - 1].stored = true;
    subs[subs.length - 1].bytes = src.length;
    subs[subs.length - 1].lang = 'js';
    localStorage.setItem('invariant/state/v1', JSON.stringify(raw));
  }, NASTY);
  await reload();
  await openTab('subs');
  await page.locator('.subs .sub').first().locator('summary').click();
  await page.waitForFunction(() => {
    const pre = document.querySelector('.sub-src');
    return pre && pre.textContent.includes('onerror');
  }, { timeout: 15_000 });

  const m = await page.evaluate(() => {
    const pre = document.querySelector('.sub-src');
    return {
      text: pre.textContent,
      coloured: pre.querySelectorAll('.hl-keyword, .hl-string, .hl-fn').length,
      /* Anything the browser built out of the program rather than printing. */
      elements: pre.querySelectorAll('img, b, script').length,
      pwned: !!window.__pwned,
    };
  });
  ok(`it is coloured (${m.coloured} spans)`, m.coloured > 0);
  ok('the markup in it is text', m.text.includes('<img src=x onerror='));
  ok('all of it', m.text.includes('<b>bold</b>'));
  check('nothing was built out of it', m.elements, 0);
  ok('and nothing ran', !m.pwned);
}

section('no uncaught errors');
ok(errors.length ? errors.join(' | ').slice(0, 300) : 'none', errors.length === 0);

await browser.close();
report('browser/submissions');
