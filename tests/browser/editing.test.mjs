/* The editing tools and the workspace-wide search.

   What is being claimed, and therefore what is checked:

     · find and replace, go to line, indent, outdent, toggle line
       comment and word wrap all work from the keyboard, inside the
       editor, on the real document rather than on the part on screen
     · Ctrl+D and Ctrl+Shift+L are NOT bound, so the browser keeps
       them; Ctrl+F is bound and says so, and Escape gives it back
     · word wrap is remembered, and a file opened afterwards has it
     · the breadcrumb strip names the file the editor is showing, on a
       single-file exercise as well as a workspace, and follows the
       explorer when the file changes
     · a read-only file is labelled as given wherever it appears
     · Quick Open finds a file by substring and by subsequence, opens
       it, and is offered only where there is more than one file
     · the workspace search finds matches in every visible file,
       groups them by filename, honours case and whole-word, and
       opens the exact line and column that was clicked
     · it searches the sample testbench and NEVER the grading one, the
       reference solution, or anything else not on screen
     · none of it leaks onto a page that is not a workspace

   Needs the site served:   npm run serve
   Run: node tests/browser/editing.test.mjs
   Against the deployed site: BASE=https://… node tests/browser/editing.test.mjs */

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

/* A workspace with directories in its paths, a hardware exercise with
   a sample testbench beside the design, and a single-file one. */
const DIRS = 'proj-cache-sim-1';
const HDL = 'hdl-sequence-fsm';
const ONE = 'algo-running-max';

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

const go = async (hash, wait = 2300) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const fresh = async (hash, wait = 2300) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const type = () => page.evaluate(() => (document.body.dataset.workspace
  ? (document.querySelector('.ws-tabs-work .tab[data-tab="tb"]') ? 'hdl' : 'code')
  : null));

/* The editor of whichever type is on screen, read through the type
   module exactly as the page reads it. */
const editorCall = (method, ...args) => page.evaluate(([m, a]) => {
  const t = document.querySelector('.ws-tabs-work .tab[data-tab="tb"]') ? 'hdl' : 'code';
  const ed = window.SystemsLab.ProblemTypes.get(t).editor();
  return ed[m](...a);
}, [method, args]);

const docLine = n => page.evaluate((i) => {
  const t = document.querySelector('.ws-tabs-work .tab[data-tab="tb"]') ? 'hdl' : 'code';
  return window.SystemsLab.ProblemTypes.get(t).editor().value.split('\n')[i];
}, n - 1);

const focusEditor = () => page.evaluate(() => {
  const t = document.querySelector('.ws-tabs-work .tab[data-tab="tb"]') ? 'hdl' : 'code';
  window.SystemsLab.ProblemTypes.get(t).editor().focus();
});

const crumbs = () => page.evaluate(() => {
  const nav = document.querySelector('#wsCrumbPath');
  if (!nav) return null;
  return {
    text: [...nav.children].map(n => n.textContent).join(''),
    leaf: (nav.querySelector('.ws-crumb-leaf') || {}).textContent || null,
    dirs: [...nav.querySelectorAll('.ws-crumb-dir')].map(b => b.textContent),
    tag: (nav.querySelector('.ws-crumb-tag') || {}).textContent || null,
  };
});

/* ---------------- editing, from the keyboard ---------------- */

section('find, go to line, indent and comment');

await fresh(`#/p/${ONE}`);
await focusEditor();

await page.keyboard.press('Control+f');
await page.waitForTimeout(350);
const find = await page.evaluate(() => {
  const panel = document.querySelector('.cm-panel.cm-search');
  return {
    open: !!panel,
    replace: !!(panel && panel.querySelector('input[name="replace"]')),
    inField: !!(document.activeElement && document.activeElement.closest('.cm-panel.cm-search')),
    themed: panel ? getComputedStyle(panel.closest('.cm-panels')).backgroundColor : null,
  };
});
ok('Ctrl+F opens the editor’s own find', find.open);
ok('with replace in it, which is the half the browser cannot do', find.replace);
ok('and the caret goes to the field', find.inField);
ok(`painted in the page’s colours, not the library’s (${find.themed})`,
  find.themed && find.themed !== 'rgba(0, 0, 0, 0)' && !/245, 245, 245/.test(find.themed));

await page.keyboard.type('int');
await page.waitForTimeout(300);
ok('and it marks what it found',
  await page.evaluate(() => document.querySelectorAll('.cm-searchMatch').length > 0));

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
ok('Escape closes it again',
  await page.evaluate(() => !document.querySelector('.cm-panel.cm-search')));

/* The two bindings the search package offers that were deliberately
   dropped, because the browser is already using them. */
await focusEditor();
await editorCall('goToLine', 1, 1);
const before = await docLine(1);
await page.keyboard.press('Control+d');
await page.waitForTimeout(250);
check('Ctrl+D is left to the browser', await page.evaluate(() => {
  const ed = window.SystemsLab.ProblemTypes.get('code').editor();
  return ed.view.state.selection.ranges.length;
}), 1);

await page.keyboard.press('Control+Slash');
await page.waitForTimeout(250);
const commented = await docLine(1);
ok(`Ctrl+/ comments the line ("${commented.slice(0, 24)}")`, /^\s*\/\//.test(commented));
await page.keyboard.press('Control+Slash');
await page.waitForTimeout(250);
check('and again takes it back', await docLine(1), before);

await page.keyboard.press('Control+BracketRight');
await page.waitForTimeout(250);
ok('Ctrl+] indents', (await docLine(1)).startsWith('  ') && !before.startsWith('  '));
await page.keyboard.press('Control+BracketLeft');
await page.waitForTimeout(250);
check('Ctrl+[ outdents back to where it was', await docLine(1), before);

await page.keyboard.press('Control+Alt+g');
await page.waitForTimeout(300);
ok('Ctrl+Alt+G asks which line',
  /Go to line/i.test(await page.evaluate(() =>
    (document.querySelector('.cm-panel') || {}).textContent || '')));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

section('word wrap is a preference, not a property of one file');

const wrapNow = () => page.evaluate(() => {
  const t = document.querySelector('.ws-tabs-work .tab[data-tab="tb"]') ? 'hdl' : 'code';
  return {
    handle: window.SystemsLab.ProblemTypes.get(t).editor().wrap,
    dom: !!document.querySelector('.cm-content.cm-lineWrapping'),
  };
});

check('off to begin with', await wrapNow(), { handle: false, dom: false });
await focusEditor();
await page.keyboard.press('Alt+z');
await page.waitForTimeout(300);
check('Alt+Z turns it on, in the handle and in the DOM',
  await wrapNow(), { handle: true, dom: true });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2300);
check('and a reload finds it still on', await wrapNow(), { handle: true, dom: true });
await go(`#/p/${DIRS}`);
check('as does a different exercise', (await wrapNow()).dom, true);
await focusEditor();
await page.keyboard.press('Alt+z');
await page.waitForTimeout(300);
check('and off again', await wrapNow(), { handle: false, dom: false });

/* ---------------- the file you are in ---------------- */

section('the strip says which file, and whose');

await go(`#/p/${DIRS}`);
const first = await crumbs();
ok(`a workspace opens on a file and says so (${first.text})`, !!first.leaf);
ok('with its directories as separate steps', first.dirs.length >= 1);

await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').openFile('include/cache.hpp'));
await page.waitForTimeout(500);
await page.evaluate(() => window.SystemsLab.ProblemView.paintCrumbs());
const hpp = await crumbs();
check('opening another file moves the strip', hpp.leaf, 'cache.hpp');
check('and names the folder it is in', hpp.dirs, ['include']);
check('a file the reader owns carries no tag', hpp.tag, null);

/* The read-only file in this project, which has to be labelled
   wherever it is shown. */
const ro = await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').pane().info()
    .filter(f => f.readOnly).map(f => f.path));
ok(`the project has a given file (${ro.join(', ')})`, ro.length >= 1);
await page.evaluate(p => window.SystemsLab.ProblemTypes.get('code').openFile(p), ro[0]);
await page.waitForTimeout(500);
await page.evaluate(() => window.SystemsLab.ProblemView.paintCrumbs());
check('and the strip says it is not yours', (await crumbs()).tag, 'given');

await go(`#/p/${ONE}`);
const solo = await crumbs();
check('a single-file exercise is named too', solo.leaf, 'main.cpp');
check('with no folders to show', solo.dirs, []);

section('the shortcuts menu');

await go(`#/p/${DIRS}`);
await page.locator('.ws-menu-keys > summary').click();
await page.waitForTimeout(350);
const menu = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.ws-key-row')].map(r =>
    r.querySelector('.ws-key-what').textContent.trim()),
  combos: [...document.querySelectorAll('.ws-key-combo')].map(c => c.textContent),
  honest: [...document.querySelectorAll('.ws-keys p')].map(p => p.textContent).join(' '),
}));
for (const want of ['Find and replace', 'Go to line', 'Indent', 'Outdent',
  'Toggle line comment', 'Open a file by name', 'Search every file']) {
  ok(`it offers ${want}`, menu.rows.some(r => r.startsWith(want)));
}
ok('with the keys beside them', menu.combos.filter(Boolean).length >= 8);
ok('and says these are text tools, not a language server',
  /no symbol index/i.test(menu.honest));

/* Every row is a button that does something: a menu of labels that
   only describe shortcuts would be useless on a tablet. */
await page.evaluate(() => {
  const r = [...document.querySelectorAll('.ws-key-row')]
    .find(x => /^Toggle line comment/.test(x.textContent));
  r.click();
});
await page.waitForTimeout(350);
ok('and clicking one runs it', /^\s*\/\//.test(await docLine(1)));
await page.evaluate(() => {
  const r = [...document.querySelectorAll('.ws-key-row')]
    .find(x => /^Toggle line comment/.test(x.textContent));
  r.click();
});
await page.waitForTimeout(300);

/* ---------------- Quick Open ---------------- */

section('opening a file by name');

await go(`#/p/${DIRS}`);
await page.keyboard.press('Alt+p');
await page.waitForTimeout(400);
const all = await page.evaluate(() => ({
  open: !!document.querySelector('.qopen'),
  rows: [...document.querySelectorAll('.qopen-row .qopen-name')].map(n => n.textContent),
  dirs: [...document.querySelectorAll('.qopen-row .qopen-dir')].map(n => n.textContent),
  tags: [...document.querySelectorAll('.qopen-row .ws-crumb-tag')].map(n => n.textContent),
}));
ok('Alt+P opens the list', all.open);
ok(`with every file in it (${all.rows.join(', ')})`, all.rows.length >= 3);
ok('each with the folder it is in', all.dirs.some(Boolean));
ok('and the given one labelled there too', all.tags.includes('given'));

await page.fill('#qopenInput', 'cache.h');
await page.waitForTimeout(300);
check('a substring of the path narrows it', await page.evaluate(() =>
  [...document.querySelectorAll('.qopen-row .qopen-name')].map(n => n.textContent)), ['cache.hpp']);

await page.fill('#qopenInput', 'cch');
await page.waitForTimeout(300);
const seq = await page.evaluate(() =>
  [...document.querySelectorAll('.qopen-row .qopen-name')].map(n => n.textContent));
ok(`a subsequence works too — "cch" finds cache.hpp (${seq.join(', ')})`,
  seq.includes('cache.hpp'));

await page.fill('#qopenInput', 'zzzz');
await page.waitForTimeout(300);
check('and nothing matching says so', await page.evaluate(() =>
  document.querySelector('.qopen-count').textContent), 'No file matches that.');

await page.fill('#qopenInput', 'cache.c');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
check('Enter opens the one that is highlighted', await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').activeFile()), 'src/cache.cpp');
ok('and the list goes away', await page.evaluate(() => !document.querySelector('.qopen')));
check('with the strip following it', (await crumbs()).leaf, 'cache.cpp');

await page.keyboard.press('Alt+p');
await page.waitForTimeout(350);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('Escape closes it without opening anything',
  await page.evaluate(() => !document.querySelector('.qopen')));
check('leaving the file that was there', await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').activeFile()), 'src/cache.cpp');

await go(`#/p/${ONE}`);
ok('a single-file exercise is not offered it',
  await page.evaluate(() => !document.querySelector('#quickOpenBtn')));
await page.keyboard.press('Alt+p');
await page.waitForTimeout(300);
ok('and Alt+P there does nothing',
  await page.evaluate(() => !document.querySelector('.qopen')));

/* ---------------- searching every file ---------------- */

section('finding something across the workspace');

await go(`#/p/${DIRS}`);
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll('.ws-tabs-work .tab')].map(t => t.dataset.tab));
ok(`a workspace has a Search files tab (${tabs.join(', ')})`, tabs.includes('search'));

await page.locator('.ws-tabs-work .tab[data-tab="search"]').click();
await page.waitForTimeout(500);
await page.fill('#wssInput', 'cache');
await page.waitForTimeout(450);

const hits = () => page.evaluate(() => ({
  summary: document.querySelector('#wssSummary').textContent,
  files: [...document.querySelectorAll('.wss-file')].map(f => ({
    path: f.querySelector('.wss-file-head .mono').textContent,
    count: Number(f.querySelector('.wss-count').textContent),
    tag: (f.querySelector('.ws-crumb-tag') || {}).textContent || null,
    rows: f.querySelectorAll('.wss-hit').length,
    marked: [...f.querySelectorAll('.wss-hit mark')].map(m => m.textContent),
  })),
}));

const found = await hits();
ok(`it finds matches (${found.summary})`, /matches in/.test(found.summary));
ok('grouped by filename', found.files.length >= 2);
ok('each with a count and a row per match',
  found.files.every(f => f.count > 0 && f.rows === f.count));
ok('and the match marked inside the line',
  found.files.every(f => f.marked.every(m => m.toLowerCase() === 'cache')));
ok('the given file is searched and labelled',
  found.files.some(f => f.tag === 'given'));

/* Nothing the reader cannot see. The grading testbench, the reference
   solution and the hidden cases are not files in any workspace, so
   there is no path from the search to them — this is the assertion
   that would fail if one were ever added to the visible set. */
const paths = found.files.map(f => f.path);
const visible = await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').pane().info().map(f => f.path));
ok(`every file in the results is one the explorer draws (${paths.join(', ')})`,
  paths.every(p => visible.includes(p)));
ok('and none of them is a solution or a grader',
  !paths.some(p => /solution|reference|grade|hidden|answer/i.test(p)));

/* Case and whole word. */
await page.fill('#wssInput', 'CACHE');
await page.waitForTimeout(400);
const loose = (await hits()).summary;
await page.locator('.wss-opt[title="Match capitals exactly"]').click();
await page.waitForTimeout(400);
const strict = await hits();
ok(`Aa changes the answer ("${loose}" -> "${strict.summary}")`, loose !== strict.summary);
ok('and every match now has the capitals asked for',
  strict.files.every(f => f.marked.every(m => m === 'CACHE')));
await page.locator('.wss-opt[title="Match capitals exactly"]').click();
await page.waitForTimeout(350);

await page.fill('#wssInput', 'get');
await page.waitForTimeout(400);
const anyGet = (await hits()).files.reduce((n, f) => n + f.count, 0);
await page.locator('.wss-opt[title^="Whole words only"]').click();
await page.waitForTimeout(400);
const wordGet = await hits();
const wordTotal = wordGet.files.reduce((n, f) => n + f.count, 0);
ok(`whole-word narrows it (${anyGet} -> ${wordTotal})`, wordTotal <= anyGet);
await page.locator('.wss-opt[title^="Whole words only"]').click();
await page.waitForTimeout(350);

/* Clicking a result. A row says which line and column it will open;
   the claim worth testing is that the editor lands on exactly that. */
await page.fill('#wssInput', 'cache');
await page.waitForTimeout(450);
const target = await page.evaluate(() => {
  /* A match that is NOT at the start of its line, so landing at the
     margin would look like success. */
  const hit = [...document.querySelectorAll('.wss-hit')]
    .find(h => Number(h.dataset.col) > 1);
  if (!hit) return null;
  return {
    path: hit.closest('.wss-file').querySelector('.wss-file-head .mono').textContent,
    line: Number(hit.dataset.line),
    column: Number(hit.dataset.col),
  };
});
ok(`there is a match partway along a line (${target && target.path}:${target && target.line}:${target && target.column})`,
  !!target);
await page.evaluate(() => {
  [...document.querySelectorAll('.wss-hit')].find(h => Number(h.dataset.col) > 1).click();
});
await page.waitForTimeout(700);
const landed = await page.evaluate(() => {
  const ed = window.SystemsLab.ProblemTypes.get('code').editor();
  const head = ed.view.state.selection.main.head;
  const line = ed.view.state.doc.lineAt(head);
  return {
    path: window.SystemsLab.ProblemTypes.get('code').activeFile(),
    line: line.number,
    column: head - line.from + 1,
    pane: document.querySelector('.ws-right').dataset.pane,
  };
});
check('clicking a result opens that file, at that line and column',
  { path: landed.path, line: landed.line, column: landed.column }, target);
check('with the editor showing', landed.pane, 'editor');

/* A search is a question about the exercise it was typed into. */
await go(`#/p/${HDL}`);
await page.locator('.ws-tabs-work .tab[data-tab="search"]').click();
await page.waitForTimeout(500);
check('and does not follow you to the next exercise',
  await page.evaluate(() => document.querySelector('#wssInput').value), '');

section('hardware: the sample testbench, and only the sample one');

await page.fill('#wssInput', 'module');
await page.waitForTimeout(450);
const hdl = await hits();
const hdlPaths = hdl.files.map(f => f.path);
ok(`it searches the design and the sample testbench (${hdlPaths.join(', ')})`,
  hdlPaths.includes('design.sv') && hdlPaths.includes('testbench.sv'));
check('the sample one is labelled as such',
  (hdl.files.find(f => f.path === 'testbench.sv') || {}).tag, 'sample');

/* The grading testbench drives cases the sample one does not, and the
   whole of Submit rests on the reader not having read it. It lives in
   the solution file, which the page does fetch — so "it is not in the
   bundle" is not the claim being made. The claim is that nothing
   reachable from the search has ever been shown it. */
const guard = await page.evaluate(async () => {
  const prob = window.SystemsLab.ProblemView.problem();
  const visible = window.SystemsLab.WsFiles.visible(prob);
  const sample = (visible.find(f => f.path === 'testbench.sv') || {}).content || '';
  const res = await fetch(`solutions/${prob.id}.json`);
  /* The grading harness and the reference design both live under
     `key` in the solution file — the two things the exercise exists
     to keep from the reader until they have finished. */
  const sol = res.ok ? await res.json() : {};
  const grading = ((sol.key || {}).harness) || '';
  const reference = Object.values(((sol.key || {}).reference) || {}).join('\n');
  const everything = visible.map(f => f.content).join('\n');
  return {
    paths: visible.map(f => f.path),
    differ: !!grading && !!sample && grading !== sample,
    /* The port list of the reference IS the port list of the starter,
       and has to be — the design being written is the same module.
       What must not be visible is the body, so the test is the same
       one as for the harness: a line of its own, nowhere on screen. */
    refSecret: reference.split('\n').map(l => l.trim())
      .filter(l => l.length > 18 && !everything.includes(l))[0] || null,
    /* A line of the grading testbench that appears in nothing the
       reader can see. If the search finds this, it is handing out the
       cases Submit is supposed to be trying for the first time. */
    secret: grading.split('\n').map(l => l.trim())
      .filter(l => l.length > 18 && !everything.includes(l))[0] || null,
  };
});
check('the visible set is exactly the design and the sample',
  guard.paths, ['design.sv', 'testbench.sv']);
ok('and the grading testbench really is a different file', guard.differ);
ok(`the reference design has a line of its own too ("${(guard.refSecret || '').slice(0, 30)}…")`,
  !!guard.refSecret);
ok(`with a line of its own to look for ("${(guard.secret || '').slice(0, 32)}…")`,
  !!guard.secret);

for (const [what, needle] of [['grading testbench', guard.secret], ['reference design', guard.refSecret]]) {
  await page.fill('#wssInput', needle || 'a string that cannot occur');
  await page.waitForTimeout(450);
  check(`and the search cannot find the ${what}, because it is not on screen`,
    await page.evaluate(() => document.querySelector('#wssSummary').textContent),
    'Nothing in any file matches that.');
}

/* ---------------- it stays where it belongs ---------------- */

section('none of it leaks off the workspace');

await go('#/problems', 1100);
const away = await page.evaluate(() => ({
  crumbs: !!document.querySelector('.ws-crumbs'),
  qopen: !!document.querySelector('.qopen'),
  search: !!document.querySelector('.wss-bar'),
  keys: !!document.querySelector('.ws-menu-keys'),
  rows: document.querySelectorAll('#catalogList .prow').length,
}));
check('the catalogue has no breadcrumb strip', away.crumbs, false);
check('no Quick Open', away.qopen, false);
check('no search bar', away.search, false);
check('and no shortcuts menu', away.keys, false);
ok(`and still lists problems (${away.rows})`, away.rows > 50);

await page.keyboard.press('Alt+p');
await page.waitForTimeout(300);
check('Alt+P off a problem page opens nothing',
  await page.evaluate(() => !!document.querySelector('.qopen')), false);

check('no uncaught errors on the page', errors, []);

await browser.close();
report('browser/editing');
