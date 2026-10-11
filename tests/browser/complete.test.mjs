/* Completion, through real keystrokes.

   tests/complete.test.mjs drives the word lists directly. This one types
   into the real editor, because a completion source that returns the
   right options and a popup nobody can see or accept are different
   things — and because adding a keymap is exactly the kind of change
   that quietly breaks Enter, Escape or Tab.

   Needs the site served:   npm run serve
   Run: node tests/browser/complete.test.mjs */

import { chromium } from 'playwright';

import { section, check, ok, report } from '../harness.mjs';

const CHANNEL = process.env.BROWSER || null;
const BASE = process.env.BASE || 'http://127.0.0.1:8000';

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

/* A clean editor per case. Completion state is sticky by design — a
   dismissed popup stays dismissed — so sharing one page between cases
   tests the previous case's leftovers. */
async function editor(problem = 'cpp-greet-and-sum') {
  const p = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${BASE}/#/p/${problem}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.keyboard.press('Delete');
  await p.waitForTimeout(120);
  return p;
}

const popup = p => p.evaluate(() => ({
  open: !!document.querySelector('.cm-tooltip-autocomplete'),
  items: [...document.querySelectorAll('.cm-tooltip-autocomplete li')]
    .map(li => li.textContent.trim()),
}));

const doc = p => p.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').editor().value);

const type = async (p, text, wait = 650) => {
  await p.keyboard.type(text, { delay: 20 });
  await p.waitForTimeout(wait);
};

/* ---------------- it appears ---------------- */

section('typing a header name offers headers');
{
  const p = await editor();
  await type(p, '#include <vec');
  const m = await popup(p);
  ok('the popup is open', m.open);
  ok(`and offers vector (${m.items.join(', ')})`, m.items.some(i => i.startsWith('vector')));
  await p.close();
}

section('typing std:: offers the library, with its headers');
{
  const p = await editor();
  await type(p, 'std::acc');
  const m = await popup(p);
  ok('the popup is open', m.open);
  ok(`std::accumulate is offered with <numeric> beside it (${m.items[0]})`,
    m.items.some(i => /accumulate/.test(i) && /numeric/.test(i)));
  await p.close();
}

section('a dot on a declared container offers that container');
{
  const p = await editor();
  await type(p, '#include <vector>\nstd::vector<int> numbers;\nnumbers.');
  const m = await popup(p);
  ok('the popup is open', m.open);
  ok(`push_back is there (${m.items.slice(0, 5).join(', ')})`, m.items.includes('push_back'));
  ok('and substr is not, because this is not a string', !m.items.includes('substr'));
  await p.close();
}

section('and accepting one types it');
{
  const p = await editor();
  await type(p, '#include <vector>\nstd::vector<int> numbers;\nnumbers.push_ba');
  const before = await popup(p);
  ok(`one candidate is left (${before.items.join(', ')})`, before.items.includes('push_back'));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const after = await doc(p);
  ok(`the word was completed (${JSON.stringify(after.slice(-24))})`,
    /numbers\.push_back$/.test(after.trim()));
  ok('and the popup closed', !(await popup(p)).open);
  await p.close();
}

section('your own names complete');
{
  const p = await editor();
  await type(p, 'int runningTotal = 0;\nrunningT');
  const m = await popup(p);
  ok(`runningTotal is offered back to you (${m.items.join(', ')})`,
    m.items.includes('runningTotal'));
  await p.close();
}

/* ---------------- it keeps out of the way ---------------- */

section('Enter is still Enter when no popup is open');
{
  const p = await editor();
  /* Ending on a semicolon leaves no popup open, so Enter means Enter
     without anything having to be dismissed first. */
  await type(p, 'int total = 0;', 400);
  const open = (await popup(p)).open;
  await p.keyboard.press('Enter');
  await p.keyboard.type('int other = 1;');
  await p.waitForTimeout(300);
  const text = await doc(p);
  ok(`no popup was in the way (open: ${open})`, !open);
  ok(`Enter made a new line (${JSON.stringify(text)})`, /\n/.test(text));
  ok('and the typing landed on it', /int other = 1;/.test(text));
  await p.close();
}

section('the first Escape closes the popup and keeps your cursor');
{
  /* Two things wanted Escape once completion arrived: the popup, and the
     site's "leave the field you are typing in". They used to both fire,
     so dismissing a suggestion you did not want also threw you out of
     the editor — and the next letter you typed was read as a navigation
     shortcut, which is how this was found. */
  const p = await editor();
  await type(p, 'std::vec');
  ok('the popup is open', (await popup(p)).open);

  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const first = await p.evaluate(() => ({
    popup: !!document.querySelector('.cm-tooltip-autocomplete'),
    inEditor: document.querySelector('.cm-editor').contains(document.activeElement),
  }));
  ok('it closed the popup', !first.popup);
  ok('and left the cursor where it was', first.inEditor);
  check('changing nothing', (await doc(p)).trim(), 'std::vec');

  /* Which it would not be if the cursor had gone: this types on. */
  await p.keyboard.type('tor counts;');
  await p.waitForTimeout(300);
  check('so you can carry on typing', (await doc(p)).trim(), 'std::vector counts;');

  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const second = await p.evaluate(() =>
    document.querySelector('.cm-editor').contains(document.activeElement));
  ok('a second Escape does leave the editor, as it always has', !second);
  await p.close();
}

section('Tab still indents while you are typing');
{
  const p = await editor();
  await type(p, 'int total = 0;', 400);
  await p.keyboard.press('Enter');
  await p.keyboard.press('Tab');
  await p.keyboard.type('x');
  await p.waitForTimeout(300);
  const text = await doc(p);
  ok(`Tab indented rather than leaving (${JSON.stringify(text.split('\n')[1])})`,
    /^\s+x/.test(text.split('\n')[1] || ''));
  await p.close();
}

section('Ctrl+Enter still runs, with a popup open');
{
  /* The binding that matters most: Run is Mod-Enter, the completion
     keymap also wants Enter, and Run is declared first on purpose. */
  const p = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
  });
  await p.goto(`${BASE}/#/p/cpp-greet-and-sum`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.keyboard.press('Delete');
  await p.keyboard.type('std::vec', { delay: 20 });
  await p.waitForTimeout(500);
  ok('a popup is open', (await popup(p)).open);
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(1200);
  const ran = await p.evaluate(() => {
    const b = document.getElementById('runBtn');
    const pane = (document.getElementById('resultPane') || {}).textContent || '';
    return { busyOrDone: b.disabled || pane.length > 0, pane: pane.slice(0, 60) };
  });
  ok(`Run still fired (${ran.pane.trim() || 'button busy'})`, ran.busyOrDone);
  await p.close();
}

/* ---------------- the other languages ---------------- */

section('Python gets its own completions, not the C++ word list');
{
  const p = await editor('algo-impl-count');
  /* Through the editor rather than the tab: the Python tab is disabled
     whenever nothing can run Python, and what is checked here is the
     completion source, which has nothing to do with running. */
  const switched = await p.evaluate(() => {
    const ed = window.SystemsLab.ProblemTypes.get('code').editor();
    if (!ed || !ed.setLang) return false;
    ed.setLang('python');
    return ed.lang === 'python';
  });
  ok('the editor is in Python', switched);
  await p.waitForTimeout(500);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.keyboard.press('Delete');
  await type(p, ['def running_total(xs):', '    return 0', '', 'running_'].join('\n'));
  const m = await popup(p);
  ok(`it completes the function you just wrote (${m.items.join(', ')})`,
    m.items.some(i => i.startsWith('running_total')));
  ok('and does not offer the C++ word list', !m.items.some(i => /std::/.test(i)));
  await p.close();
}

section('no uncaught errors');
ok(errors.length ? errors.join(' | ').slice(0, 200) : 'none', errors.length === 0);

await browser.close();
report('browser/complete');
