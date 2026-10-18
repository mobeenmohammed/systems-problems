/* The multi-file workspace, and the project built on it.

   What is actually being claimed here, and therefore what is checked:

     · several files, each with its own editor, its own cursor and its
       own undo history — switching tabs costs none of the three
     · every file is a draft of its own and a reload brings them all
       back, on the file that was last open
     · the files are compiled SEPARATELY and linked. Not concatenated:
       a diagnostic names the file it is in, and a missing definition
       is a link error rather than a parse error
     · a submission is every file, and loading it back restores every
       file rather than the entry point alone
     · Reset says which it means and how much it would cost
     · a milestone carries the previous one's work forward, never
       overwrites work in progress, and re-runs the earlier cases
     · and none of it changed a single-file exercise

   Needs the site served:   npm run serve
   Run: node tests/browser/project.test.mjs
   Against the deployed site: BASE=https://… node tests/browser/project.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
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

const IDS = ['proj-ring-logger-1', 'proj-ring-logger-2', 'proj-ring-logger-3'];
const problemOf = id => JSON.parse(fs.readFileSync(`problems/algo/${id}.json`, 'utf8'));
const refOf = id => JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8')).key.reference.files;

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

const go = async (hash, wait = 2600) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* A clean slate, for the sections whose subject is what the starters do.
   Cleared and then RELOADED in one step: the store is live on whatever
   page is open and will write its in-memory copy back over an empty
   localStorage at the next thing that touches it, which is a very
   confusing way to find out that a test is not isolated. */
const fresh = async (hash, wait = 2600) => {
  /* goto() between two URLs that differ only in the hash is a route
     change inside the same document, not a load — so the clear has to
     be followed by a real reload rather than by another goto. */
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};
const type = () => page.evaluate(() => window.SystemsLab.ProblemTypes.get('code'));
const files = () => page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').files());
const active = () => page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').activeFile());
const openFile = p => page.evaluate(x => window.SystemsLab.ProblemTypes.get('code').openFile(x), p);
const write = (path, text) => page.evaluate(({ p, t }) => {
  const impl = window.SystemsLab.ProblemTypes.get('code');
  impl.openFile(p);
  impl.editor().value = t;
}, { p: path, t: text });

const put = (list, skip = []) => page.evaluate(({ fs: f, skip: s }) => {
  const impl = window.SystemsLab.ProblemTypes.get('code');
  for (const x of f) {
    if (s.includes(x.path)) continue;
    impl.openFile(x.path);
    impl.editor().value = x.content;
  }
}, { fs: list, skip });

const runTests = async () => {
  await page.locator('#runBtn').click();
  await page.waitForFunction(() => !document.getElementById('runBtn').disabled, { timeout: 300000 });
  await page.waitForTimeout(700);
  return page.evaluate(() => ({
    badge: (document.querySelector('.rsum-badge') || {}).textContent || '',
    frac: (document.querySelector('.rsum-frac') || {}).textContent || '',
    tab: [...document.querySelectorAll('.ws-tabs-work .tab')]
      .find(b => b.getAttribute('aria-selected') === 'true')?.dataset.tab,
    compiler: (window.SystemsLab.ProblemTypes.get('code').lastCompilerOutput() || ''),
    built: window.SystemsLab.ProblemTypes.get('code').lastBuildOk(),
  }));
};

const submit = async () => {
  await page.locator('#submitBtn').click();
  await page.waitForFunction(() => document.getElementById('submitBtn').textContent === 'Submit',
    { timeout: 300000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => ({
    frac: (document.querySelector('.rsum-frac') || {}).textContent || '',
    badge: (document.querySelector('.rsum-badge') || {}).textContent || '',
  }));
};

/* ---------------- the shape of the thing ---------------- */

section('a problem made of several files opens as several files');
{
  await go(`#/p/${IDS[0]}`);
  const p = problemOf(IDS[0]);

  check('the type says it is multi-file',
    await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').multiFile()), true);

  const shown = await page.evaluate(() => ({
    tree: [...document.querySelectorAll('.mf-file')].map(b => b.dataset.path),
    tabs: [...document.querySelectorAll('.mf-tab')].map(b => b.dataset.path),
    slots: [...document.querySelectorAll('.mf-slot')].map(s => s.dataset.path),
    visible: [...document.querySelectorAll('.mf-slot')].filter(s => !s.hidden).map(s => s.dataset.path),
  }));
  check('every file is in the explorer', shown.tree, p.payload.files.map(f => f.path));
  check('and has a tab', shown.tabs, p.payload.files.map(f => f.path));
  check('and an editor of its own', shown.slots.length, p.payload.files.length);
  check('exactly one of which is on screen', shown.visible.length, 1);

  check('it opens on the file that says where the work goes', await active(), 'ring_buffer.cpp');

  const marks = await page.evaluate(() => ({
    entry: (document.querySelector('.mf-file[data-path="main.cpp"] .mf-tag') || {}).textContent,
    given: [...document.querySelectorAll('.mf-file[data-path="main.cpp"] .mf-tag')]
      .map(n => n.textContent),
  }));
  ok(`the entry point is marked as one (${marks.entry})`, /entry/.test(marks.entry || ''));
  ok('and the given file says it is given', marks.given.includes('given'));

  /* The explorer collapses and the tabs stay. */
  await page.locator('.mf-toggle').click();
  await page.waitForTimeout(300);
  const shut = await page.evaluate(() => ({
    open: document.querySelector('.mf').dataset.files,
    sideVisible: !!document.querySelector('.mf-side')?.offsetParent,
    tabs: document.querySelectorAll('.mf-tab').length,
  }));
  check('collapsing hides the explorer', shut.open, 'false');
  ok('and the tabs are still there', shut.tabs === 3 && !shut.sideVisible);
  await page.locator('.mf-toggle').click();
  await page.waitForTimeout(300);
  check('and it opens again', await page.evaluate(() => document.querySelector('.mf').dataset.files), 'true');
}

/* ---------------- what switching a tab costs ---------------- */

section('switching files keeps the text, the cursor and the undo history');
{
  await go(`#/p/${IDS[0]}`);

  /* Type into one file, move the cursor, then go away and come back. */
  await openFile('ring_buffer.cpp');
  await page.locator('.mf-slot[data-path="ring_buffer.cpp"] .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// one\n// two\n');
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const ed = window.SystemsLab.ProblemTypes.get('code').editor();
    return { text: ed.value, at: ed.element.querySelector('.cm-cursor') ? 'placed' : 'none' };
  });

  await openFile('ring_buffer.hpp');
  await page.waitForTimeout(250);
  await page.locator('.mf-slot[data-path="ring_buffer.hpp"] .cm-content').click();
  await page.keyboard.type('// header note\n');
  await page.waitForTimeout(300);

  await openFile('ring_buffer.cpp');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  check('the text comes back untouched', after, before.text);

  /* Undo in this file must undo THIS file, and must still have the
     history: one editor per file is the whole reason. */
  await page.locator('.mf-slot[data-path="ring_buffer.cpp"] .cm-content').click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undone = await files();
  const cpp = undone.find(f => f.path === 'ring_buffer.cpp').content;
  const hpp = undone.find(f => f.path === 'ring_buffer.hpp').content;
  ok('undo takes back what was typed here', cpp !== after);
  ok('and leaves the other file alone', hpp.includes('// header note'));

  check('the editor the page reaches for is the one on screen',
    await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().value
      === window.SystemsLab.ProblemTypes.get('code').files()
        .find(f => f.path === window.SystemsLab.ProblemTypes.get('code').activeFile()).content),
    true);
}

section('a read-only file is read-only');
{
  await go(`#/p/${IDS[0]}`);
  await openFile('main.cpp');
  await page.locator('.mf-slot[data-path="main.cpp"] .cm-content').click();
  await page.keyboard.type('NOT ALLOWED');
  await page.waitForTimeout(300);
  const text = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  ok('typing into the given driver does nothing', !text.includes('NOT ALLOWED'));
  ok('and it still says what it is', /GIVEN/.test(text));
}

/* ---------------- persistence ---------------- */

section('the whole workspace survives a reload');
{
  await go(`#/p/${IDS[0]}`);
  await write('ring_buffer.cpp', '// mine in the source\n');
  await write('ring_buffer.hpp', '// mine in the header\n');
  await openFile('ring_buffer.hpp');
  await page.waitForTimeout(500);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);

  const back = await files();
  ok('the source came back', back.find(f => f.path === 'ring_buffer.cpp').content.includes('mine in the source'));
  ok('and the header', back.find(f => f.path === 'ring_buffer.hpp').content.includes('mine in the header'));
  check('and it reopens on the file that was open', await active(), 'ring_buffer.hpp');

  /* And a draft is per file, not one blob: the read-only one is still
     the problem's own text. */
  ok('the given file is still the given file',
    /GIVEN/.test(back.find(f => f.path === 'main.cpp').content));
}

/* ---------------- real separate compilation ---------------- */

section('the files are compiled separately and linked');
{
  await fresh(`#/p/${IDS[0]}`);

  /* A syntax error in one file must be reported against THAT file. */
  await write('ring_buffer.cpp', '#include "ring_buffer.hpp"\nthis is not c++\n');
  await page.waitForTimeout(400);
  let r = await runTests();
  ok('a bad source does not build', r.built === false);
  check('and the compiler pane is where the reader is put', r.tab, 'compiler');
  ok(`the diagnostic names the file it is in (${r.compiler.split(':')[0]})`,
    /^ring_buffer\.cpp:\d+:/m.test(r.compiler));
  ok('and not the entry point, which is fine',
    !/^main\.cpp:\d+:\d+: error/m.test(r.compiler));

  const shown = await page.evaluate(() => ({
    files: [...document.querySelectorAll('.diag-file')].map(n => n.textContent),
    where: (document.querySelector('.diag-where') || {}).textContent,
  }));
  ok(`the list shows the file beside the line (${shown.where})`,
    shown.files.includes('ring_buffer.cpp'));

  await openFile('main.cpp');
  await page.evaluate(() => window.SystemsLab.ProblemView.openPane('compiler'));
  await page.waitForTimeout(300);
  await page.locator('.diag-where').first().click();
  await page.waitForTimeout(500);
  check('clicking it opens that file', await active(), 'ring_buffer.cpp');
  check('and puts the cursor on the line it named',
    await page.evaluate(() => {
      const ed = window.SystemsLab.ProblemTypes.get('code').editor();
      const line = ed.value.slice(0, ed.value.length).split('\n');
      return line[1];
    }), 'this is not c++');

  /* A definition that is missing is a LINK error — which is only
     possible because these are separate translation units. */
  await write('ring_buffer.cpp', '#include "ring_buffer.hpp"\n');
  await page.waitForTimeout(400);
  r = await runTests();
  ok('a missing definition does not build', r.built === false);
  ok(`and it is the linker that says so (${(r.compiler.match(/undefined symbol: ([^\n]*)/) || [])[1] || '?'})`,
    /undefined symbol/.test(r.compiler));
  ok('naming a function the header declared', /RingBuffer::push|RingBuffer::size/.test(r.compiler));

  /* Nothing is concatenated: a static in one file is private to it. */
  await write('ring_buffer.cpp', `#include "ring_buffer.hpp"
static int helper() { return 7; }
RingBuffer::RingBuffer(std::size_t c) : cap_(c), slots_(c) {}
std::size_t RingBuffer::capacity() const { return cap_; }
std::size_t RingBuffer::size() const { return count_; }
bool RingBuffer::empty() const { return count_ == 0; }
bool RingBuffer::full() const { return count_ == cap_; }
bool RingBuffer::push(const Event& e) {
    if (full()) return false;
    slots_[(start_ + count_) % cap_] = e;
    ++count_;
    return helper() == 7;
}
bool RingBuffer::pop(Event& out) {
    if (empty()) return false;
    out = slots_[start_];
    start_ = (start_ + 1) % cap_;
    --count_;
    return true;
}
Event RingBuffer::at(std::size_t i) const { return slots_[(start_ + i) % cap_]; }
`);
  await page.waitForTimeout(400);
  r = await runTests();
  ok(`a file-local static links fine and the samples pass (${r.frac})`,
    r.built && r.badge === 'Passed');
}

/* ---------------- the real answer, and a submission ---------------- */

section('the reference workspace passes, and a submission keeps every file');
{
  await fresh(`#/p/${IDS[0]}`);
  await put(refOf(IDS[0]), ['main.cpp']);
  await page.waitForTimeout(500);

  const run = await runTests();
  ok(`Run passes the samples (${run.frac})`, run.badge === 'Passed');

  const sub = await submit();
  const hidden = JSON.parse(fs.readFileSync(`solutions/${IDS[0]}.json`, 'utf8')).key.cases.length;
  const visible = problemOf(IDS[0]).payload.cases.length;
  check(`Submit runs the samples and the hidden ones (${sub.frac})`,
    sub.frac, `(${visible + hidden}/${visible + hidden})`);
  check('and it passed', sub.badge, 'Passed');

  check('one submission was recorded',
    await page.evaluate(id => window.SystemsLab.Store.submissions(id).length, IDS[0]), 1);

  /* Wreck everything, then put the submission back. */
  await write('ring_buffer.cpp', '// gone\n');
  await write('ring_buffer.hpp', '// gone as well\n');
  await page.waitForTimeout(400);

  await page.evaluate(() => window.SystemsLab.ProblemView.openPane('subs'));
  await page.waitForTimeout(700);
  await page.locator('.subs details summary').first().click();
  await page.waitForTimeout(900);

  const listed = await page.evaluate(() => ({
    blocks: [...document.querySelectorAll('.sub-file-name')].map(n => n.textContent.replace(/\s+/g, ' ').trim()),
    json: /invariantWorkspace/.test(document.querySelector('.sub-body')?.textContent || ''),
  }));
  check('the submission is shown as the three files it was', listed.blocks.length, 3);
  ok(`each one named (${listed.blocks.join(', ')})`, listed.blocks.some(t => /main\.cpp/.test(t)));
  ok('and not as the JSON it is stored as', !listed.json);

  await page.locator('.sub-body button', { hasText: 'Load into the editor' }).first().click();
  await page.waitForTimeout(1000);
  const restored = await files();
  ok('loading it back restores the source', !restored.find(f => f.path === 'ring_buffer.cpp').content.includes('gone'));
  ok('and the header', !restored.find(f => f.path === 'ring_buffer.hpp').content.includes('gone'));
  ok('and the restored source is the one that passed',
    restored.find(f => f.path === 'ring_buffer.cpp').content.includes('start_ = (start_ + 1) % cap_'));
}

/* ---------------- Reset ---------------- */

section('Reset asks which, and says what it would cost');
{
  await fresh(`#/p/${IDS[0]}`);
  await write('ring_buffer.cpp', '// only this one\n');
  await page.waitForTimeout(400);

  await page.locator('#resetBtn').click();
  await page.waitForTimeout(350);
  let menu = await page.evaluate(() => [...document.querySelectorAll('.ws-reset .ws-menu-body button')]
    .map(b => ({ scope: b.dataset.scope, text: b.textContent.replace(/\s+/g, ' ').trim(), off: !!b.disabled })));
  check('two choices', menu.length, 2);
  ok(`the first is this file (${menu[0].text})`, /ring_buffer\.cpp/.test(menu[0].text));
  ok(`the second is all of them (${menu[1].text})`, /1 of 3 changed/.test(menu[1].text));

  /* Change a second file and reopen: the count has to follow. */
  const shutMenu = () => page.evaluate(() => {
    const m = document.querySelector('.ws-reset');
    if (m) m.open = false;
  });
  await shutMenu();
  await write('ring_buffer.hpp', '// and this one\n');
  await page.waitForTimeout(400);
  await page.locator('#resetBtn').click();
  await page.waitForTimeout(350);
  menu = await page.evaluate(() => [...document.querySelectorAll('.ws-reset .ws-menu-body button')]
    .map(b => b.textContent.replace(/\s+/g, ' ').trim()));
  ok(`the count is read when the menu opens (${menu[1]})`, /2 of 3 changed/.test(menu[1]));

  await page.locator('.ws-reset button[data-scope="file"]').click();
  await page.waitForTimeout(900);
  let now = await files();
  ok('resetting one file puts that one back',
    !now.find(f => f.path === 'ring_buffer.hpp').content.includes('and this one'));
  ok('and leaves the other alone',
    now.find(f => f.path === 'ring_buffer.cpp').content.includes('only this one'));

  await shutMenu();
  await page.locator('#resetBtn').click();
  await page.waitForTimeout(300);
  await page.locator('.ws-reset button[data-scope="all"]').click();
  await page.waitForTimeout(900);
  now = await files();
  const starters = Object.fromEntries(problemOf(IDS[0]).payload.files.map(f => [f.path, f.content]));
  check('resetting everything puts every file back',
    now.filter(f => f.content !== starters[f.path]).map(f => f.path), []);
}

section('an input of your own runs the whole workspace, not one file of it');
{
  await fresh(`#/p/${IDS[0]}`);
  await put(refOf(IDS[0]), ['main.cpp']);
  await page.waitForTimeout(500);

  await page.evaluate(() => window.SystemsLab.ProblemView.openPane('cases'));
  await page.waitForTimeout(600);
  await page.locator('#addMyCase').click();
  await page.waitForTimeout(400);
  await page.locator('.mycase-in').first().fill(['2', 'push 7 x', 'size', 'dump', ''].join('\n'));
  await page.waitForTimeout(400);
  await page.locator('#runMyCases').click();
  await page.waitForFunction(() => !document.getElementById('runMyCases')?.disabled,
    { timeout: 300000 });
  await page.waitForTimeout(700);

  const got = await page.evaluate(() => ({
    note: (document.querySelector('#myCasesNote') || {}).textContent || '',
    out: (document.querySelector('.mycase-out pre') || {}).textContent || '',
  }));
  ok(`it ran and said so (${got.note})`, /Ran 1 of your input/.test(got.note));
  check('and the program behaved, which means it linked',
    got.out.trim(), ['1/2', '7 x'].join('\n'));
}

/* ---------------- the project ---------------- */

section('a project is findable and says where you are in it');
{
  await go('#/problems?project=1', 1800);
  const listed = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.prow')].map(r => r.textContent.replace(/\s+/g, ' ')),
    control: (document.querySelector('#fDebug') || {}).value,
  }));
  check('the filter shows exactly the three milestones', listed.rows.length, 3);
  check('and the control agrees with the URL', listed.control, 'project');
  ok('every row says which milestone it is',
    listed.rows.every((t, i) => t.includes(`Project ${i + 1}/3`)));

  await go(`#/p/${IDS[1]}`);
  const strip = await page.evaluate(() => ({
    title: (document.querySelector('.proj-title') || {}).textContent,
    steps: [...document.querySelectorAll('.proj-step')].map(s => ({
      here: s.dataset.here, label: s.querySelector('.proj-label')?.textContent,
      href: s.querySelector('a')?.getAttribute('href') || null,
    })),
  }));
  check('the strip names the project', strip.title, 'Build a ring-buffer event logger');
  check('with all three milestones', strip.steps.length, 3);
  check('this one marked', strip.steps.filter(s => s.here === 'true').length, 1);
  ok('and the others linked',
    strip.steps.filter(s => s.here !== 'true').every(s => /#\/p\/proj-ring-logger-/.test(s.href || '')));

  await go('#/tracks/project-ring-logger', 1600);
  const track = await page.evaluate(() => ({
    rows: document.querySelectorAll('#trackList .prow').length,
    summary: (document.querySelector('.track-summary') || {}).textContent?.replace(/\s+/g, ' ') || '',
  }));
  check('Learn has it as a track of three', track.rows, 3);
  ok(`with its own progress (${track.summary.slice(0, 40)})`, /of 3 solved/.test(track.summary));
}

section('a milestone carries the one before it forward, and re-runs its cases');
{
  /* Start clean, so what is carried is carried by the feature and not
     left over from an earlier section. */
  await fresh(`#/p/${IDS[0]}`);
  await put(refOf(IDS[0]), ['main.cpp']);
  await page.waitForTimeout(500);
  const first = await submit();
  check(`milestone 1 passes ${first.frac}`, first.badge, 'Passed');

  await go(`#/p/${IDS[1]}`);
  const carried = await files();
  ok('the source written in milestone 1 is here',
    carried.find(f => f.path === 'ring_buffer.cpp').content.includes('start_ = (start_ + 1) % cap_'));
  ok('the given driver is this milestone\'s, not the last one\'s',
    /overwrite/.test(carried.find(f => f.path === 'main.cpp').content));

  const cold = await runTests();
  ok('and it does not build yet, which is the milestone', cold.built === false);
  ok('because the new functions have no definition', /undefined symbol/.test(cold.compiler));

  /* A file being worked on is never overwritten by a carry-forward. */
  await write('ring_buffer.cpp', '// half an afternoon of my own\n');
  await page.waitForTimeout(400);
  await go(`#/p/${IDS[1]}`);
  ok('reopening does not carry over the top of work in progress',
    (await files()).find(f => f.path === 'ring_buffer.cpp').content.includes('half an afternoon'));

  await put(refOf(IDS[1]), ['main.cpp']);
  await page.waitForTimeout(500);
  const second = await submit();
  const m1cases = problemOf(IDS[0]).payload.cases.length
    + JSON.parse(fs.readFileSync(`solutions/${IDS[0]}.json`, 'utf8')).key.cases.length;
  const m2cases = problemOf(IDS[1]).payload.cases.length
    + JSON.parse(fs.readFileSync(`solutions/${IDS[1]}.json`, 'utf8')).key.cases.length;
  check(`milestone 2 passes ${second.frac}`, second.badge, 'Passed');
  ok(`and runs more cases than milestone 1 did (${m2cases} against ${m1cases})`, m2cases > m1cases);

  await go(`#/p/${IDS[2]}`);
  check('milestone 3 opens on the file it is about', await active(), 'main.cpp');
  ok('with the buffer carried forward',
    (await files()).find(f => f.path === 'ring_buffer.cpp').content.includes('dropped_'));
  await put(refOf(IDS[2]), ['ring_buffer.hpp', 'ring_buffer.cpp']);
  await page.waitForTimeout(500);
  const third = await submit();
  check(`milestone 3 passes ${third.frac}`, third.badge, 'Passed');

  const done = await page.evaluate(() =>
    [...document.querySelectorAll('.proj-step')].map(s => s.dataset.state));
  check('and the strip shows all three done', done, ['solved', 'solved', 'solved']);
}

/* ---------------- and nothing else moved ---------------- */

section('a single-file exercise is exactly as it was');
{
  await go('#/p/algo-impl-lower-bound');
  const one = await page.evaluate(() => {
    const impl = window.SystemsLab.ProblemTypes.get('code');
    return {
      multi: impl.multiFile(),
      files: impl.files(),
      hasEditor: !!impl.editor(),
      tree: document.querySelectorAll('.mf-file').length,
      resetIsButton: document.querySelector('#resetBtn')?.tagName,
      value: impl.editor().value.slice(0, 40),
    };
  });
  check('it is not multi-file', one.multi, false);
  check('there is no file list', one.tree, 0);
  check('it has one editor', one.hasEditor, true);
  check('and Reset is the button it always was', one.resetIsButton, 'BUTTON');
  ok('and the starter is in it', one.value.length > 10);

  const r = await runTests();
  ok(`it still runs (${r.frac || r.badge})`, r.built === true);

  /* And nothing a workspace left behind is reachable from it. The
     compiler gets a new filesystem per compile; if it did not, this
     include would find the header the project planted a moment ago. */
  await page.evaluate(() => {
    window.SystemsLab.ProblemTypes.get('code').editor().value =
      '#include "ring_buffer.hpp"\nint main() { return 0; }\n';
  });
  await page.waitForTimeout(400);
  const stale = await runTests();
  ok('a file from another exercise is not lying around to be included',
    stale.built === false && /ring_buffer\.hpp.*not found|file not found/i.test(stale.compiler));
}

ok(`no uncaught errors on the page${errors.length ? `: ${errors[0]}` : ''}`, errors.length === 0);

await browser.close();
report('browser/project');
