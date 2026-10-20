/* Comparing versions, taking the code away, and knowing whether it saved.

   What is being claimed, and therefore what is checked:

     · two saved submissions can be compared, and a submission can be
       compared with what is in the editor now
     · a multi-file comparison names the files that differ, counts the
       lines, folds the long unchanged runs, and reports an added or a
       deleted file as that rather than as a rewrite
     · comparing never touches the code: the draft, the editor and the
       stored submissions are the same afterwards
     · restoring is still a separate button and still asks first
     · a submission with no stored program says so by name instead of
       showing an empty diff
     · the ZIP holds every file on screen at its own relative path,
       plus a README, and holds nothing else — no reference solution,
       no grading harness
     · the archive is one a real unzip can read
     · the save row says Saving, then Saved on this device, and says
       Could not save when the write was refused — with the text still
       in the editor and a way out that does not need storage

   Needs the site served:   npm run serve
   Run: node tests/browser/versions.test.mjs */

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { section, check, ok, report, toEditorTab } from '../harness.mjs';

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

const DIRS = 'proj-cache-sim-1';
const HDL = 'hdl-sequence-fsm';
const ONE = 'algo-running-max';

/* A ZIP reader, for STOREd entries, which is all this writer makes.
   Reading the archive back with something that is not the code that
   wrote it is the point: a writer that agrees with its own reader
   proves nothing. */
function readZip(buf) {
  const out = [];
  for (let i = 0; i + 30 <= buf.length; i += 1) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extraLen;
    out.push({
      name: buf.subarray(i + 30, i + 30 + nameLen).toString('utf8'),
      method,
      crc,
      flags: buf.readUInt16LE(i + 6),
      content: buf.subarray(start, start + size).toString('utf8'),
    });
    i = start + size - 1;
  }
  return out;
}

function crc32(bytes) {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = t[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
const asked = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => { asked.push(d.message()); d.dismiss(); });

const go = async (hash, wait = 2400) => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

const tmp = path.join(os.tmpdir(), 'invariant-zip-test');
fs.mkdirSync(tmp, { recursive: true });

/* ---------------- the archive ---------------- */

section('taking the code away');

for (const [id, want] of [
  [DIRS, ['include/cache.hpp', 'src/cache.cpp', 'main.cpp', 'README.txt']],
  [HDL, ['design.sv', 'testbench.sv', 'README.txt']],
  [ONE, ['main.cpp', 'README.txt']],
]) {
  await go(`#/p/${id}`);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.SystemsLab.ProblemView.downloadWorkspace()),
  ]);
  const file = path.join(tmp, `${id}.zip`);
  await dl.saveAs(file);
  const entries = readZip(fs.readFileSync(file));

  check(`${id} downloads as its own id`, dl.suggestedFilename(), `${id}.zip`);
  check(`and holds exactly what is on screen, plus a README`,
    entries.map(e => e.name.replace(`${id}/`, '')), want);
  ok('every entry under one folder, at its own relative path',
    entries.every(e => e.name.startsWith(`${id}/`)));
  ok('stored rather than deflated, so the bytes are the bytes',
    entries.every(e => e.method === 0));
  ok('with the UTF-8 name flag set',
    entries.every(e => (e.flags & 0x0800) !== 0));
  ok('and every checksum agrees with its own contents',
    entries.every(e => crc32(Buffer.from(e.content, 'utf8')) === e.crc));

  const readme = entries.find(e => e.name.endsWith('README.txt')).content;
  ok('the README names every file and what it is for',
    want.filter(w => w !== 'README.txt').every(w => readme.includes(w)));
  ok('and says what is deliberately not in the archive',
    /What is not in here/.test(readme) && /reference solution/i.test(readme));
  ok('and that storage here is this device, not an account',
    /this browser/i.test(readme) && /device/i.test(readme));
  ok('it is plain ASCII, so it opens the same in any editor',
    [...readme].every(c => c.charCodeAt(0) < 128));

  /* The claim that matters: the answer is not in the archive. */
  const all = entries.map(e => e.content).join('\n');
  const secrets = await page.evaluate(async (pid) => {
    const res = await fetch(`solutions/${pid}.json`);
    if (!res.ok) return [];
    const sol = await res.json();
    const key = sol.key || {};
    const bodies = [
      typeof key.harness === 'string' ? key.harness : '',
      ...Object.values(key.reference || {}),
      ...(Array.isArray(key.cases) ? key.cases.map(c => String(c.expect || '')) : []),
    ].filter(t => typeof t === 'string' && t.length > 40);
    /* Lines of the solution that are in NOTHING the reader can see.
       `std::ios::sync_with_stdio(false);` is in the reference and in
       the starter both, and finding it in the archive says only that
       the starter is in the archive — which it is supposed to be.
       What would be evidence is a line never shown to anybody. */
    const onScreen = window.SystemsLab.WsFiles
      .visible(window.SystemsLab.ProblemView.problem())
      .map(f => f.content).join('\n');
    return bodies.flatMap(t => t.split('\n').map(l => l.trim()))
      .filter(l => l.length > 24 && !onScreen.includes(l)).slice(0, 40);
  }, id);
  ok(`nothing the reader has not been shown is in the archive `
    + `(${secrets.length} distinctive lines looked for)`,
  secrets.length > 0 && !secrets.some(l => all.includes(l)));
}

const buildWords = fs.readFileSync(path.join(tmp, `${DIRS}.zip`));
const cxxReadme = readZip(buildWords).find(e => e.name.endsWith('README.txt')).content;
ok('a C++ project is told how to build it with a real command',
  /g\+\+ -O2 -std=c\+\+20/.test(cxxReadme));
ok('and told where the browser differs from that',
  /-fno-exceptions/.test(cxxReadme) && /WASI/.test(cxxReadme));
const hdlReadme = readZip(fs.readFileSync(path.join(tmp, `${HDL}.zip`)))
  .find(e => e.name.endsWith('README.txt')).content;
ok('a hardware exercise gets an iverilog line', /iverilog -g2012/.test(hdlReadme));
ok('and is told the grading testbench is a different one',
  /SAMPLE/.test(hdlReadme) && /not included/.test(hdlReadme));

/* ---------------- comparing ---------------- */

section('comparing two versions');

await go(`#/p/${DIRS}`);

/* Two submissions planted into the stores the page reads, rather than
   two real compiles: what is being tested is the comparison. */
const planted = await page.evaluate(async () => {
  const S = window.SystemsLab;
  const prob = S.ProblemView.problem();
  const files = S.ProblemTypes.get('code').files();
  const entry = S.Workspace.entryOf(prob);
  const older = S.Workspace.pack({ entry, files: files.map(f => (f.path === 'src/cache.cpp'
    ? { ...f, content: `// an older attempt\n${f.content}` } : f)) });
  const newer = S.Workspace.pack({ entry, files });
  const put = async (source, at, outcome) => {
    await S.Sources.put(prob.id, at, source);
    const r = S.Store.record(prob.id);
    r.subs = r.subs || [];
    r.subs.push({ at, outcome, lang: 'cpp', passed: 1, total: 1, ms: 12,
      stored: true, bytes: source.length });
    S.Store.save();
  };
  await put(older, new Date(Date.now() - 7200e3).toISOString(), 'failed');
  await put(newer, new Date(Date.now() - 3600e3).toISOString(), 'passed');
  return S.Store.submissions(prob.id).length;
});
check('two submissions to compare', planted, 2);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2400);

/* Something in the draft that is in neither of them. */
await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').openFile('src/cache.cpp'));
await page.waitForTimeout(500);
await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().goToLine(1, 1));
await page.keyboard.type('// a line I just typed\n');
await page.waitForTimeout(800);

const draftBefore = await page.evaluate(() => ({
  cache: window.SystemsLab.ProblemTypes.get('code').pane().textOf('src/cache.cpp'),
  hpp: window.SystemsLab.ProblemTypes.get('code').pane().textOf('include/cache.hpp'),
}));
const subsBefore = await page.evaluate(() =>
  window.SystemsLab.Store.submissions(window.SystemsLab.ProblemView.problem().id)
    .map(s => `${s.at}:${s.outcome}`));

await page.locator('.ws-tabs-work .tab[data-tab="subs"]').click();
await page.waitForTimeout(700);
ok('the submissions tab offers a comparison',
  await page.evaluate(() => !!document.querySelector('.cmp')));
ok('shut until it is asked for',
  await page.evaluate(() => !document.querySelector('.cmp').open));

await page.locator('.cmp-summary').click();
await page.waitForTimeout(900);

const shown = () => page.evaluate(() => ({
  left: document.querySelector('#cmpLeft').value,
  right: document.querySelector('#cmpRight').value,
  head: (document.querySelector('#cmpOut p') || {}).textContent,
  files: [...document.querySelectorAll('.diff-file')].map(f => ({
    path: f.querySelector('.mono').textContent,
    state: f.querySelector('.diff-state').textContent,
    adds: f.querySelectorAll('.diff-row[data-kind="add"]').length,
    dels: f.querySelectorAll('.diff-row[data-kind="del"]').length,
    gaps: f.querySelectorAll('.diff-gap').length,
    signs: [...f.querySelectorAll('.diff-row[data-kind="add"] .diff-sign')]
      .map(s => s.textContent),
  })),
}));

const first = await shown();
check('it opens on the newest submission against the editor',
  { left: first.left, right: first.right }, { left: '0', right: 'draft' });
check('and names only the file that differs',
  first.files.map(f => f.path), ['src/cache.cpp']);
check('as changed rather than as new', first.files[0].state, 'changed');
check('with the one line that was typed', first.files[0].adds, 1);
ok(`counted in the summary ("${first.head}")`, /1 of 3 files differ/.test(first.head));
ok('the long unchanged run is folded away', first.files[0].gaps > 0);
ok('and a changed line is marked by a sign, not only by a colour',
  first.files[0].signs.every(s => s === '+'));

await page.selectOption('#cmpRight', '1');
await page.waitForTimeout(900);
const pair = await shown();
ok(`two submissions compare too ("${pair.head}")`, /files differ/.test(pair.head));
check('on the file that really differs between them',
  pair.files.map(f => f.path), ['src/cache.cpp']);

await page.selectOption('#cmpRight', '0');
await page.waitForTimeout(700);
ok('the same version on both sides is refused rather than answered',
  /same version/.test((await shown()).head || ''));

section('comparing changes nothing');

check('the draft is exactly as it was',
  await page.evaluate(() => ({
    cache: window.SystemsLab.ProblemTypes.get('code').pane().textOf('src/cache.cpp'),
    hpp: window.SystemsLab.ProblemTypes.get('code').pane().textOf('include/cache.hpp'),
  })), draftBefore);
check('and so are the submissions',
  await page.evaluate(() =>
    window.SystemsLab.Store.submissions(window.SystemsLab.ProblemView.problem().id)
      .map(s => `${s.at}:${s.outcome}`)), subsBefore);
check('and nothing asked to replace anything', asked, []);

/* Restoring is the other button, and it is the one that asks. */
await page.locator('.sub > summary').first().click();
await page.waitForTimeout(900);
const restore = page.locator('.sub-body button', { hasText: 'Load into the editor' }).first();
ok('a submission still offers to be put back', await restore.count() > 0);
await restore.click();
await page.waitForTimeout(700);
ok(`and asks first (${asked.length} question${asked.length === 1 ? '' : 's'})`,
  asked.length === 1 && /replaced|put this submission back/i.test(asked[0]));
check('and leaves the draft alone when the answer is no',
  await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').pane().textOf('src/cache.cpp')),
  draftBefore.cache);

section('a submission with no program kept');

await page.evaluate(() => {
  const S = window.SystemsLab;
  const r = S.Store.record(S.ProblemView.problem().id);
  r.subs.push({ at: new Date().toISOString(), outcome: 'failed', lang: 'cpp',
    passed: 0, total: 1, ms: 5, stored: false, bytes: 0 });
  S.Store.save();
});
await page.locator('.ws-tabs-work .tab[data-tab="editor"]').click();
await page.waitForTimeout(300);
await page.locator('.ws-tabs-work .tab[data-tab="subs"]').click();
await page.waitForTimeout(700);
const opts = await page.evaluate(() =>
  [...document.querySelectorAll('#cmpLeft option')]
    .map(o => ({ text: o.textContent, off: o.disabled })));
ok('is listed, labelled, and cannot be picked',
  opts.some(o => /no code kept/.test(o.text) && o.off));
ok('while the ones that do have code can be',
  opts.filter(o => !/no code kept/.test(o.text)).every(o => !o.off));

/* ---------------- the save row ---------------- */

section('whether it actually saved');

await go(`#/p/${ONE}`);
const row = () => page.evaluate(() => {
  const n = document.getElementById('draftNote');
  return n ? {
    state: n.dataset.state,
    text: n.textContent,
    acts: [...n.querySelectorAll('.save-act')].map(b => b.textContent),
    title: n.title,
  } : null;
});

/* Back to the editor first. A hidden CodeMirror cannot take focus, and
   the keystrokes would land on the page, where a single letter is a
   navigation shortcut — which is what a reader would get too. */
await toEditorTab(page);
await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().focus());
await page.keyboard.type('// hello');
await page.waitForTimeout(150);
check('it says Saving while the write is in flight', (await row()).state, 'saving');
await page.waitForTimeout(800);
const saved = await row();
check('then Saved', saved.state, 'saved');
check('on this device, which is the whole truth about it',
  saved.text, 'Saved on this device');
ok('and says what that means', /no account|nothing is synchronised/i.test(saved.title));

/* Storage refuses, the way a full quota does. */
await page.evaluate(() => {
  const real = Storage.prototype.setItem;
  window.__restore = () => { Storage.prototype.setItem = real; };
  Storage.prototype.setItem = function blocked(k, v) {
    if (String(k).startsWith('invariant/state')) {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    return real.call(this, k, v);
  };
});
await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().focus());
await page.keyboard.type(' x');
await page.waitForTimeout(1000);
const bad = await row();
check('a refused write says so', bad.state, 'failed');
check('in those words', bad.text.startsWith('Could not save'), true);
check('and offers both ways out', bad.acts, ['Try again', 'Download it']);
ok('explaining that this is local storage, not an account',
  /this browser|this device/i.test(bad.title));
ok('the editor keeps every character', await page.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').editor().value.includes('// hello x')));

const toasts = await page.evaluate(() =>
  [...document.querySelectorAll('.toast')].map(t => t.textContent));
check('and it is said once, not once per keystroke', toasts.length, 1);

await page.locator('.save-act', { hasText: 'Try again' }).click();
await page.waitForTimeout(1000);
check('trying again while it is still broken stays honest',
  (await row()).state, 'failed');
await page.evaluate(() => window.__restore());
await page.locator('.save-act', { hasText: 'Try again' }).click();
await page.waitForTimeout(1000);
const fixed = await row();
check('and once it works, it says so', fixed.state, 'saved');
check('with the buttons gone', fixed.acts, []);

/* The way out that does not go through the storage that refused. */
await page.evaluate(() => {
  const real = Storage.prototype.setItem;
  Storage.prototype.setItem = function blocked(k) {
    if (String(k).startsWith('invariant/state')) throw new Error('QuotaExceededError');
    return real.call(this, k, arguments[1]);
  };
});
await page.evaluate(() => window.SystemsLab.ProblemTypes.get('code').editor().focus());
await page.keyboard.type('y');
await page.waitForTimeout(1000);
const [rescue] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('.save-act', { hasText: 'Download it' }).click(),
]);
check('and the download works when storage does not',
  rescue.suggestedFilename(), `${ONE}.zip`);

check('no uncaught errors on the page', errors, []);

await browser.close();
report('browser/versions');
