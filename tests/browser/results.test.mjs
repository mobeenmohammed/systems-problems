/* The Results pane: the summary above the cases, and the rows under it.

   A list of eight rows answers "which one failed". The question you have the
   moment a run finishes is "did it pass", and these checks are mostly about
   that being answerable without opening anything.

   JavaScript again, because it runs in the page: this suite needs the site
   served and nothing else.

   Needs the site served:   npm run serve
   Run: node tests/browser/results.test.mjs
        SHOTS=1 node tests/browser/results.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

import { section, check, ok, report } from '../harness.mjs';

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
  if (/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|Failed to load resource/.test(m.text())) return;
  errors.push('console: ' + m.text());
});

const PROBLEM = 'algo-running-max';   /* 2 sample cases, 5 hidden, JS among its languages */

const open = async (hash, wait = 1200) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

async function paste(text) {
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.evaluate(async t => { await navigator.clipboard.writeText(t); }, text);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
}

const press = async (id) => {
  await page.locator(`#${id}`).click();
  await page.waitForFunction(
    btn => { const b = document.getElementById(btn); return b && !b.disabled; },
    id, { timeout: 30000 });
  await page.waitForTimeout(400);
};

const summary = () => page.evaluate(() => {
  const s = document.querySelector('.rsum');
  if (!s) return null;
  const tile = k => {
    const t = [...document.querySelectorAll('.rtile')]
      .find(x => x.querySelector('.rtile-label').textContent === k);
    return t ? t.querySelector('.rtile-value').textContent : null;
  };
  return {
    kind: s.dataset.kind,
    heading: (s.querySelector('h4') || {}).textContent.replace(/\s+/g, ' ').trim(),
    frac: (s.querySelector('.rsum-frac') || {}).textContent,
    badge: (s.querySelector('.rsum-badge') || {}).textContent,
    when: (s.querySelector('.rsum-when') || {}).textContent,
    total: tile('Total'), passed: tile('Passed'), failed: tile('Failed'),
    why: (s.querySelector('.rsum-why') || {}).textContent || '',
    whyKind: (s.querySelector('.rsum-why') || {}).dataset?.kind || '',
    note: (s.querySelector('.rsum-note') || {}).textContent || '',
  };
});

const rows = () => page.evaluate(() => [...document.querySelectorAll('.case')].map(c => ({
  pass: c.dataset.pass,
  name: (c.querySelector('.case-name') || {}).textContent || '',
  why: (c.querySelector('.case-why') || {}).textContent || '',
  ms: (c.querySelector('.case-ms') || {}).textContent || '',
  status: (c.querySelector('.case-status') || {}).textContent || '',
  head: (c.querySelector('.case-head') || {}).tagName,
  expanded: (c.querySelector('.case-head') || {}).getAttribute?.('aria-expanded'),
  bodyShown: !(c.querySelector('.io') || {}).hidden,
})));

/* One value and then nothing: right for the single-value sample, wrong for
   the other. A half-right run says more than an all-wrong one. */
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

/* ---------------- nothing run yet ---------------- */

section('before anything has run');
await open(`#/p/${PROBLEM}`);
{
  await page.locator('.ws-tabs-sm .tab[data-tab="results"]').click();
  await page.waitForTimeout(300);
  const text = await page.locator('#resultPane').textContent();
  ok('it says what to press rather than showing an empty summary',
    /Press Run samples, or Submit/.test(text));
  check('and there is no summary to misread', await summary(), null);
}

/* ---------------- a run that half works ---------------- */

section('the editor opens on a template that says where your code goes');
{
  /* The markers live in the problem files and in the four generic starters;
     tests/content.test.mjs holds every one of them to the rule. This is the
     one check that the marker actually arrives in the editor. */
  /* JavaScript, because it is the one language this suite can be sure is
     selectable: with no runner and no toolchain here, the compiled tabs are
     disabled on purpose. */
  await page.locator('.lang-tab[data-lang="js"]').click();
  await page.waitForTimeout(500);
  const starter = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  ok('the starter says where to write', /your code here/i.test(starter));
  ok('and what to write there',
    /your code here\s*[—:-]\s*\S.{10,}/i.test(starter));
}

section('a run that passes one of two samples');
await page.locator('.lang-tab[data-lang="js"]').click();
await page.waitForTimeout(400);
await paste(NEARLY);
await press('runBtn');
{
  const m = await summary();
  ok('the summary is there', m !== null);
  check('it leads with the fraction', m.heading, 'Result (1/2)');
  check('the word for it', m.badge, 'Failed');
  check('and the whole box is marked failed', m.kind, 'failed');
  check('total', m.total, '2');
  check('passed', m.passed, '1');
  check('failed', m.failed, '1');
  ok(`how long it took (${m.when})`, /^Run · /.test(m.when) && /\d/.test(m.when));
  ok(`the first failure is at the top ("${m.why}")`,
    /^Case 1:/.test(m.why) && m.why.length > 12);
  check('shown as a failure, not a note', m.whyKind, 'failed');
  ok(`and it says what ran (${m.note})`,
    /2 sample cases/.test(m.note) && /Submit also runs the hidden ones/.test(m.note));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'results-failed.png') });
}

section('the rows under it');
{
  const list = await rows();
  check('one per case', list.length, 2);
  check('named the same way the Test cases tab names them', list[0].name, 'Case 1');
  check('each says what happened', list[0].status, 'Failed');
  check('and the one that worked says so', list[1].status, 'Passed');
  ok(`with the reason on the row ("${list[0].why}")`, list[0].why.length > 8);
  ok(`and the time (${list[0].ms})`, /ms|s$/.test(list[0].ms.trim()));

  /* A failure opens, a pass stays shut: the one you want is the one you did
     not ask for. */
  ok('the failing one is already open', list[0].bodyShown);
  ok('the passing one is folded away', !list[1].bodyShown);
  check('and the row says which it is', list[0].expanded, 'true');
  check('as does the shut one', list[1].expanded, 'false');
}

section('an open row shows the input that produced it');
{
  /* Run used to show "stdin (none)" on every row: the judge does not echo
     the input back and only Submit stashed it. "(none)" is not "we did not
     keep it" - it is a claim about the case. */
  const io = await page.evaluate(() =>
    [...document.querySelector('.case').querySelectorAll('.io > div')].map(d => ({
      label: (d.querySelector('h5') || {}).textContent,
      body: (d.querySelector('pre') || {}).textContent,
    })));
  const by = k => (io.find(x => x.label === k) || {}).body || '';
  check('three boxes', io.map(x => x.label).join(','), 'stdin,expected,got');
  ok(`the input is the case's own (${JSON.stringify(by('stdin').slice(0, 14))})`,
    /3 1 4 1 5/.test(by('stdin')));
  ok('rather than a claim that there was none', by('stdin') !== '(none)');
  ok(`beside what it should have printed (${JSON.stringify(by('expected').slice(0, 8))})`,
    by('expected').trim().length > 0);
}

section('a row can be opened from the keyboard');
{
  /* It was a div with a click handler, which the keyboard cannot reach at
     all. */
  check('the head is a button', (await rows())[1].head, 'BUTTON');
  await page.locator('.case').nth(1).locator('.case-head').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const after = (await rows())[1];
  ok('Enter opens it', after.bodyShown);
  check('and the row says so', after.expanded, 'true');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  ok('Enter again closes it', !(await rows())[1].bodyShown);
}

/* ---------------- a run that works ---------------- */

section('a run that passes everything');
await paste(RIGHT);
await press('runBtn');
{
  const m = await summary();
  check('the fraction', m.heading, 'Result (2/2)');
  check('the word', m.badge, 'Passed');
  check('the box', m.kind, 'passed');
  check('nothing failed', m.failed, '0');
  check('and there is no banner to read', m.why, '');
  const list = await rows();
  ok('every row passed', list.every(r => r.status === 'Passed'));
  ok('and all of them are folded away', list.every(r => !r.bodyShown));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, 'results-passed.png') });
}

/* ---------------- a submission says what it ran ---------------- */

section('a submission runs the samples and the hidden ones, and says so');
{
  await page.locator('#submitBtn').click();
  await page.waitForFunction(
    () => { const b = document.getElementById('submitBtn'); return b && !b.disabled; },
    null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const m = await summary();
  check('all seven', m.heading, 'Result (7/7)');
  check('counted as seven', m.total, '7');
  ok(`and described as what it was (${m.note})`,
    /7 cases: the samples and the hidden ones/.test(m.note));
  ok(`the header says it was a submission (${m.when})`, /^Submission · /.test(m.when));
  /* The old wording for this was "7 hidden cases passed", which was never
     true: a submission runs the visible ones too. */
  ok('and does not call them all hidden', !/hidden cases passed/.test(m.note));
}

/* ---------------- it has to fit ---------------- */

section('the summary holds its shape on a narrow screen');
for (const w of [1500, 1024, 768, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const s = document.querySelector('.rsum');
    const pane = document.getElementById('resultPane');
    const tiles = [...document.querySelectorAll('.rtile')];
    return {
      over: document.documentElement.scrollWidth - window.innerWidth,
      inside: s && pane ? s.getBoundingClientRect().right <= pane.getBoundingClientRect().right + 1 : false,
      threeAcross: tiles.length === 3
        && Math.abs(tiles[0].getBoundingClientRect().top - tiles[2].getBoundingClientRect().top) < 2,
      readable: tiles.every(t => t.getBoundingClientRect().width > 40),
    };
  });
  ok(`${w}px: the page does not scroll sideways (${m.over}px)`, m.over <= 2);
  ok(`${w}px: the summary stays inside the pane`, m.inside);
  ok(`${w}px: the three counts stay on one row`, m.threeAcross);
  ok(`${w}px: and stay wide enough to read`, m.readable);
}
await page.setViewportSize({ width: 1500, height: 1000 });

section('no uncaught errors');
ok(errors.length ? errors.join(' | ').slice(0, 300) : 'none', errors.length === 0);

await browser.close();
report('browser/results');
