/* The workspace layout: the two panels a reader can fold away, the
   explorer they can drag, and the fact that none of it loses anything.

   What is being claimed, and therefore what is checked:

     · the description panel collapses, and the freed width goes to the
       editor rather than to padding
     · there is always a visible way back, and Alt+D is the other one
     · the explorer collapses and resizes, in both directions, and both
       limits hold
     · a workspace with directories in its paths renders as a tree, the
       folders fold, and folding one hides exactly its own children
     · the tree is walkable with the arrow keys
     · every panel size and visibility survives a reload, and so does
       the active file, its cursor and its undo history
     · Reset layout puts the panels back and leaves the drafts alone
     · going between a multi-file problem and a single-file one, in
       both directions, leaves neither of them confused

   Needs the site served:   npm run serve
   Run: node tests/browser/workspace.test.mjs
   Against the deployed site: BASE=https://… node tests/browser/workspace.test.mjs */

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

/* A flat multi-file C++ project, a multi-file project with directories,
   a multi-file hardware project and a single-file exercise. */
const FLAT = 'proj-ring-logger-1';
const DIRS = 'proj-cache-sim-1';
const HDL = 'proj-sync-fifo-1';
const ONE = 'algo-impl-circular-queue';

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

const go = async (hash, wait = 2200) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

/* goto() between two hashes of one document is a route change rather
   than a load, so clearing has to be followed by a real reload — see
   the same note in project.test.mjs. */
const fresh = async (hash, wait = 2200) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const widths = () => page.evaluate(() => {
  const box = n => {
    const e = document.querySelector(n);
    return e ? Math.round(e.getBoundingClientRect().width) : 0;
  };
  return {
    left: box('.ws-left'),
    right: box('.ws-right'),
    gutter: box('.ws-gutter'),
    side: box('.mf-side'),
    main: box('.mf-main'),
    mode: (document.querySelector('.ws-body') || {}).dataset?.paneMode,
    foot: box('.ws-foot'),
    run: !!document.querySelector('#runBtn'),
    submit: !!document.querySelector('#submitBtn'),
    files: (document.querySelector('.mf') || {}).dataset?.files,
    showDesc: !!document.querySelector('.ws-show-desc')
      && getComputedStyle(document.querySelector('.ws-show-desc')).display !== 'none',
  };
});

/* ---------------- either panel, or both ---------------- */

section('either panel can have the window to itself');

await fresh(`#/p/${FLAT}`);
const open = await widths();
ok(`it starts split (${open.left} | ${open.right})`,
  open.mode === 'split' && open.left > 300 && open.right > 300);
check('and the Show control is out of the way', open.showDesc, false);
ok('all three modes are offered',
  await page.evaluate(() => document.querySelectorAll('.ws-mode-btn').length) === 3);

/* --- code only --- */
await page.locator('#descHide').click();
await page.waitForTimeout(350);
const codeOnly = await widths();
check('the fold control gives the window to the code', codeOnly.mode, 'code');
check('the statement column is gone entirely', codeOnly.left, 0);
check('and so is the divider, which now divides nothing', codeOnly.gutter, 0);
ok(`the editor took all of it (${open.right} -> ${codeOnly.right}px)`,
  codeOnly.right >= open.right + open.left + open.gutter - 2);
check('and there is a visible way back', codeOnly.showDesc, true);
ok('Run and Submit are still there', codeOnly.run && codeOnly.submit && codeOnly.foot > 0);

await page.locator('#descShow').click();
await page.waitForTimeout(350);
check('which brings the statement back', (await widths()).mode, 'split');
check('at the width it had', (await widths()).left, open.left);

/* --- description only --- */
await page.locator('.ws-mode-btn[data-mode="desc"]').click();
await page.waitForTimeout(350);
const descOnly = await widths();
check('the other direction works too', descOnly.mode, 'desc');
check('the code column is gone entirely', descOnly.right, 0);
check('and the divider with it', descOnly.gutter, 0);
ok(`the statement took the window (${open.left} -> ${descOnly.left}px)`,
  descOnly.left >= open.left + open.right + open.gutter - 2);
ok('and Run and Submit are STILL there, under both panels',
  descOnly.run && descOnly.submit && descOnly.foot > 0);

/* --- never both --- */
await page.evaluate(() => window.SystemsLab.ProblemView.setPaneMode('nonsense'));
await page.waitForTimeout(300);
check('an unknown mode falls back to split rather than to nothing',
  (await widths()).mode, 'split');
for (const m of ['desc', 'code', 'split']) {
  await page.locator(`.ws-mode-btn[data-mode="${m}"]`).click();
  await page.waitForTimeout(250);
  const g = await widths();
  ok(`${m}: at least one panel has width (${g.left} | ${g.right})`,
    g.left > 0 || g.right > 0);
  check(`${m}: and the control says so`,
    await page.evaluate(() => [...document.querySelectorAll('.ws-mode-btn')]
      .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.mode)),
    [m]);
}

/* Alt+D and Alt+E from inside the editor are the cases that matter:
   CodeMirror's surface is contentEditable, and the typing guard in
   app.js would swallow an unmodified key. */
await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().focus());
await page.keyboard.press('Alt+d');
await page.waitForTimeout(300);
check('Alt+D gives the window to the statement', (await widths()).mode, 'desc');
await page.keyboard.press('Alt+d');
await page.waitForTimeout(300);
check('and again splits it', (await widths()).mode, 'split');
await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().focus());
await page.keyboard.press('Alt+e');
await page.waitForTimeout(300);
check('Alt+E gives it to the code', (await widths()).mode, 'code');
await page.keyboard.press('Alt+e');
await page.waitForTimeout(300);
check('and again splits it', (await widths()).mode, 'split');

section('and the choice is remembered, and stays on this page');

await page.locator('.ws-mode-btn[data-mode="code"]').click();
await page.waitForTimeout(300);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
check('a reload finds it still code-only', (await widths()).mode, 'code');

/* Workspace layout is a property of the workspace. The catalogue and
   the Learn graph have their own widths and must not inherit a
   half-collapsed grid from a problem page. */
await go('#/problems');
const elsewhere = await page.evaluate(() => ({
  ws: document.body.dataset.workspace || null,
  body: !!document.querySelector('.ws-body'),
  split: getComputedStyle(document.body).getPropertyValue('--split').trim(),
  list: document.querySelectorAll('#catalogList .prow').length,
}));
check('the catalogue is not in workspace mode', elsewhere.ws, null);
check('and has no collapsed grid on it', elsewhere.body, false);
check('nor a split fraction leaked onto the body', elsewhere.split, '');
ok(`and it still lists problems (${elsewhere.list})`, elsewhere.list > 50);

await go(`#/p/${ONE}`);
check('a single-file problem has the same three modes',
  await page.evaluate(() => document.querySelectorAll('.ws-mode-btn').length), 3);
check('and remembers the choice across problems', (await widths()).mode, 'code');
await page.locator('.ws-mode-btn[data-mode="split"]').click();
await page.waitForTimeout(300);
await go(`#/p/${FLAT}`);

section('the explorer collapses and resizes');

const sideNow = await widths();
ok(`it starts open (${sideNow.side}px)`, sideNow.files === 'true' && sideNow.side > 100);

const drag = async (dx) => {
  const box = await page.locator('.mf-gutter').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  return (await widths()).side;
};

const wider = await drag(90);
ok(`dragging right widens it (${sideNow.side} -> ${wider}px)`, wider > sideNow.side + 40);
const narrower = await drag(-120);
ok(`dragging left narrows it (${wider} -> ${narrower}px)`, narrower < wider - 60);

const tiny = await drag(-600);
check('and it stops at the minimum rather than vanishing', tiny, 120);
const huge = await drag(900);
check('and at the maximum rather than eating the editor', huge, 420);

await page.locator('.mf-gutter').focus();
await page.keyboard.press('Home');
await page.waitForTimeout(200);
check('Home takes it to the minimum', (await widths()).side, 120);
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
check('and the arrows step it', (await widths()).side, 144);

await page.locator('.mf-toggle').click();
await page.waitForTimeout(250);
const hidden = await widths();
check('the toggle collapses it', hidden.files, 'false');
check('to nothing at all', hidden.side, 0);
ok(`and the editor took the room (${hidden.main}px)`, hidden.main > sideNow.main);

await page.keyboard.press('Alt+b');
await page.waitForTimeout(250);
check('Alt+B brings it back', (await widths()).files, 'true');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
check('and the width survives a reload', (await widths()).side, 144);

/* ---------------- directories ---------------- */

section('a workspace with directories is a tree');

await fresh(`#/p/${DIRS}`);
const tree = await page.evaluate(() => ({
  dirs: [...document.querySelectorAll('.mf-dir')].map(b => b.dataset.path),
  files: [...document.querySelectorAll('.mf-file')].map(b => b.dataset.path),
  names: [...document.querySelectorAll('.mf-file .mf-name')].map(n => n.textContent),
  depths: [...document.querySelectorAll('.mf-file')]
    .map(b => b.style.getPropertyValue('--mf-depth')),
}));
ok(`the directories are rows of their own (${tree.dirs.join(', ')})`, tree.dirs.length >= 2);
ok('every file is under one', tree.files.length >= 3);
ok('a row shows the name rather than the whole path',
  tree.names.every(n => !n.includes('/')));
ok('and a file inside a directory is indented',
  tree.depths.some(d => Number(d) > 0));

const firstDir = tree.dirs[0];
const kidsOf = d => page.evaluate(p => {
  const row = document.querySelector(`.mf-dir[data-path="${p}"]`);
  const group = row.parentElement.querySelector('.mf-group');
  return {
    expanded: row.getAttribute('aria-expanded'),
    hidden: group.hidden,
    visible: [...document.querySelectorAll('.mf-file')].filter(b => b.offsetParent).length,
  };
}, d);

const before = await kidsOf(firstDir);
await page.locator(`.mf-dir[data-path="${firstDir}"]`).click();
await page.waitForTimeout(200);
const after = await kidsOf(firstDir);
check('clicking a directory folds it', after.expanded, 'false');
ok(`and hides exactly its own files (${before.visible} -> ${after.visible})`,
  after.visible < before.visible && after.visible > 0);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
check('the fold is remembered', (await kidsOf(firstDir)).expanded, 'false');
await page.locator(`.mf-dir[data-path="${firstDir}"]`).click();
await page.waitForTimeout(200);
check('and opening it again restores the children',
  (await kidsOf(firstDir)).visible, before.visible);

section('and it is walkable with the keyboard');

await page.evaluate(() => document.querySelector('.mf-tree .mf-dir, .mf-tree .mf-file').focus());
const focused = () => page.evaluate(() => ({
  path: (document.activeElement || {}).dataset?.path,
  kind: (document.activeElement || {}).className,
}));
const first = await focused();
ok(`focus starts on a row (${first.path})`, !!first.path);
await page.keyboard.press('ArrowDown');
const second = await focused();
ok(`ArrowDown moves on (${second.path})`, second.path && second.path !== first.path);
await page.keyboard.press('ArrowUp');
check('ArrowUp comes back', (await focused()).path, first.path);
await page.keyboard.press('End');
const last = await focused();
ok(`End goes to the bottom (${last.path})`, last.path !== first.path);

/* Left on an open directory shuts it; the next Left goes to the parent. */
await page.evaluate(p => document.querySelector(`.mf-dir[data-path="${p}"]`).focus(), firstDir);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(150);
check('ArrowLeft folds the directory under the cursor',
  (await kidsOf(firstDir)).expanded, 'false');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
check('and ArrowRight opens it', (await kidsOf(firstDir)).expanded, 'true');

await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const opened = await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').activeFile());
ok(`Enter on a file opens it (${opened})`, !!opened);

/* ---------------- nothing is lost ---------------- */

section('folding and dragging lose neither the text nor the undo history');

await fresh(`#/p/${FLAT}`);
await page.evaluate(() => {
  const impl = window.SystemsLab.ProblemTypes.get('code');
  impl.openFile('ring_buffer.cpp');
  impl.editor().focus();
});
await page.keyboard.type('// one');
await page.keyboard.press('Enter');
await page.keyboard.type('// two');
await page.waitForTimeout(300);

await page.locator('#descHide').click();
await page.locator('.mf-toggle').click();
await page.waitForTimeout(300);
await page.locator('.mf-toggle').click();
await page.locator('#descShow').click();
await page.waitForTimeout(400);

const after2 = await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').editor().value);
ok('the text is still there', after2.includes('// one') && after2.includes('// two'));

await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().focus());
await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
const undone = await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').editor().value);
ok('and undo still reaches what was typed before the fold',
  undone.includes('// one') && !undone.includes('// two'));

section('the other panes are reachable without the editor shrinking');

/* The brief this was built to is explicit about it: Results, Compiler
   output and the waveform have to be reachable, and reaching them must
   not cost the editor any room permanently. They are tabs over the same
   grid row rather than a split, so the editor is either full height or
   not displayed — and the CodeMirror behind it is never rebuilt. */
{
  const edBox = () => page.evaluate(() => {
    const e = document.querySelector('.ws-editor');
    const b = e.getBoundingClientRect();
    return { h: Math.round(b.height), shown: getComputedStyle(e).display !== 'none' };
  });
  const before = await edBox();
  ok(`the editor fills its column (${before.h}px)`, before.h > 400);

  for (const tab of ['results', 'cases', 'compiler', 'subs']) {
    await page.locator(`.ws-tabs-work .tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(250);
    const gone = await edBox();
    check(`${tab} replaces the editor rather than squeezing it`, gone.shown, false);
    const pane = await page.evaluate(() =>
      Math.round(document.querySelector('#resultPane').getBoundingClientRect().height));
    ok(`and ${tab} gets the whole column (${pane}px)`, pane > 400);
  }

  await page.locator('.ws-tabs-work .tab[data-tab="editor"]').click();
  await page.waitForTimeout(300);
  const back2 = await edBox();
  check('coming back, the editor is the size it was', back2.h, before.h);
  const still = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  ok('and it still holds what was typed in it', still.includes('// one'));
}

section('Reset layout puts the panels back and leaves the work alone');

await page.locator('#descHide').click();
await page.waitForTimeout(200);
await drag(-200);
await page.locator('.mf-toggle').click();
await page.waitForTimeout(300);

await page.evaluate(() => window.SystemsLab.ProblemView.resetLayout());
await page.waitForTimeout(1600);
const reset = await widths();
check('both panels are back', reset.mode, 'split');
check('the explorer is back', reset.files, 'true');
check('at its shipped width', reset.side, 190);
const kept = await page.evaluate(() => {
  const impl = window.SystemsLab.ProblemTypes.get('code');
  impl.openFile('ring_buffer.cpp');
  return impl.editor().value;
});
ok('and the draft was not touched', kept.includes('// one'));

/* ---------------- moving between shapes ---------------- */

section('going between a workspace and a single-file exercise');

await go(`#/p/${ONE}`);
const single = await page.evaluate(() => ({
  multi: window.SystemsLab.ProblemTypes.get('code').multiFile(),
  tree: !!document.querySelector('.mf-tree'),
  editor: !!document.querySelector('.cm-editor'),
  showDesc: !!document.querySelector('.ws-show-desc'),
  /* Carried so that a failure says which of two very different things
     went wrong: no editor was built at all, or Editor.create took its
     textarea fallback because vendor/codemirror.js did not arrive.
     This assertion failed once against the deployed site and the
     answer took a day to narrow down, because the name said neither. */
  backend: (() => {
    try { return window.SystemsLab.ProblemTypes.get('code').editor().backend; }
    catch { return 'no editor'; }
  })(),
  cm: !!window.CM,
}));
check('it is not multi-file', single.multi, false);
check('there is no explorer', single.tree, false);
check(`there is still an editor (${single.backend}, window.CM ${single.cm})`,
  single.editor, true);

await go(`#/p/${HDL}`);
const hdlSide = await page.evaluate(() => ({
  multi: window.SystemsLab.ProblemTypes.get('hdl').multiFile(),
  tree: [...document.querySelectorAll('.mf-file')].map(b => b.dataset.path),
  side: Math.round((document.querySelector('.mf-side') || { getBoundingClientRect: () => ({ width: 0 }) })
    .getBoundingClientRect().width),
}));
check('a hardware workspace has the same explorer', hdlSide.multi, true);
ok(`with its design files in it (${hdlSide.tree.join(', ')})`, hdlSide.tree.length >= 1);
check('at the width the C++ one was left at', hdlSide.side, 190);

await go(`#/p/${FLAT}`);
check('and back to a C++ workspace, still itself',
  await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').multiFile()), true);

check('no uncaught errors on the page', errors, []);

await browser.close();
report('browser/workspace');
