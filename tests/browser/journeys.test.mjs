/* The reported failures, as journeys, in a real browser.

   Every interaction here is a real mouse click or a real keystroke through
   Chromium. Setting .value and dispatching an input event proves nothing
   about whether a person can type into the page — that is how three editor
   bugs survived a suite that passed.

   Needs the site served:   npm run serve
   and a way to run C++:    npm run proxy   (or a local runner on 2000)

   The proxy is preferred, because it is the configuration the published site
   is in: no runner on the machine, execution over HTTP, and every result
   labelled Hosted.

   Run: node tests/browser/journeys.test.mjs
        SHOTS=1 node tests/browser/journeys.test.mjs    (also write screenshots) */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const PROXY = process.env.PROXY || 'http://127.0.0.1:8787';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

/* The site has to be up; a connection refused is a setup problem, not a
   failing test, and saying which is the difference between a useful run and
   a confusing one. */
try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${res.status}`);
} catch (err) {
  console.log(`\n  the site is not being served at ${BASE}`);
  console.log('  start it with:  npm run serve');
  console.log(`  (${err.message})`);
  process.exit(1);
}

const browser = await chromium.launch();

/* Whether anything can compile C++ right now, and how. Checked once, so the
   run says plainly which backend the journeys below exercised rather than
   leaving it to be inferred from a timeout. */
const reachable = async url => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok; }
  catch { return false; }
};
const proxyUp = await reachable(`${PROXY}/health`);
const runnerUp = await reachable('http://127.0.0.1:2000/health');
if (!proxyUp && !runnerUp) {
  console.log('\n  nothing can compile C++: start one with  npm run proxy');
  console.log('  (the editor journeys would pass, but Run and Submit cannot)');
  process.exit(1);
}
console.log(`  --    compiled languages run via ${proxyUp ? 'the hosted proxy' : 'a local runner'}`);

async function page({ width = 1440, height = 900, state = null, theme = null } = {}) {
  const p = await browser.newPage({ viewport: { width, height } });
  /* Pasting is how a whole program gets into the editor here: typing one
     character at a time through auto-closing brackets produces doubled
     braces, which is a picture of the test's own mistake rather than of the
     page. The typing path has its own section above. */
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  if (proxyUp) await p.addInitScript(u => localStorage.setItem('systems-lab/hosted-url', u), PROXY);
  p.on('pageerror', e => { consoleErrors.push('pageerror: ' + e.message); });
  /* A refused connection to the local runner is the page correctly finding
     out that there is no runner here, which is the normal state on any
     machine that has not started one — and the state this suite runs in.
     Everything else on the console is a real defect. */
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|Failed to load resource/.test(m.text())) return;
    consoleErrors.push(m.text());
  });
  if (state || theme) {
    await p.addInitScript(([s, t]) => {
      if (s) localStorage.setItem('systems-lab/state/v1', JSON.stringify(s));
      if (t) {
        const cur = JSON.parse(localStorage.getItem('systems-lab/state/v1') || '{}');
        cur.equipped = { ...(cur.equipped || {}), theme: t };
        localStorage.setItem('systems-lab/state/v1', JSON.stringify(cur));
      }
    }, [state, theme]);
  }
  return p;
}

let consoleErrors = [];
const resetErrors = () => { consoleErrors = []; };

const open = async (p, hash) => {
  await p.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
};

const shot = async (p, name) => {
  if (!process.env.SHOTS) return;
  await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/* CodeMirror's text lives in .cm-content; typing goes through a real click
   then real keys. */
const code = p => p.locator('.cm-content').first();
const docText = p => p.evaluate(() =>
  window.SystemsLab.ProblemTypes.get('code').editor().value);

async function typeCode(p, text) {
  await code(p).click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.keyboard.type(text, { delay: 0 });
  await p.waitForTimeout(120);
}

/* Pasted where a whole program is wanted. Typing one character at a time
   through an editor that closes brackets for you produces doubled braces,
   because a person using such an editor does not type the closers — so a
   test that types them is testing something nobody does. Both paths are
   exercised below: this one by paste, and the next by typing naturally. */
const CPP_OK = `#include <iostream>
int main() {
    int n = 0;
    std::cin >> n;
    for (int i = 0; i < n; i++) {
        int x = 0;
        std::cin >> x;
        std::cout << x << "\\n";
    }
}`;

/* Typed the way someone actually types in an editor with auto-closing
   brackets: open a brace, press Enter, write the body, and step past the
   closer the editor supplied rather than typing one. */
async function typeProgramNaturally(p) {
  await code(p).click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.keyboard.type('#include <iostream>');
  await p.keyboard.press('Enter');
  await p.keyboard.type('int main() {');
  await p.keyboard.press('Enter');
  await p.keyboard.type('int n = 0;');
  await p.keyboard.press('Enter');
  await p.keyboard.type('std::cin >> n;');
  await p.keyboard.press('Enter');
  await p.keyboard.type('std::cout << n * 2;');
  await p.waitForTimeout(120);
}

async function paste(p, text) {
  await code(p).click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  /* A real clipboard paste, not setting a value. */
  await p.evaluate(async t => { await navigator.clipboard.writeText(t); }, text);
  await p.keyboard.press('Control+v');
  await p.waitForTimeout(200);
}

/* ================================================================== */

section('the editor accepts real typing');
{
  resetErrors();
  const p = await page();
  await open(p, '#/p/algo-running-max');

  ok('CodeMirror mounted', await p.locator('.cm-editor').count() === 1);
  ok('with a gutter', await p.locator('.cm-gutters').count() === 1);

  /* Click into the middle of the document, then type. */
  await code(p).click();
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.keyboard.type('int x = 1;');
  check('typed text arrives', await docText(p), 'int x = 1;');

  /* Every editing key the brief names. */
  await p.keyboard.press('Backspace');
  check('Backspace', await docText(p), 'int x = 1');
  await p.keyboard.press('Home');
  await p.keyboard.press('Delete');
  check('Delete', await docText(p), 'nt x = 1');
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.keyboard.type('two');
  check('Enter opens a line', await docText(p), 'nt x = 1\ntwo');
  await p.keyboard.press('Tab');
  const indented = await docText(p);
  ok('Tab indents the line rather than moving focus away',
    /\n\s+two$/.test(indented));
  ok('and focus is still in the editor',
    await p.evaluate(() => !!document.activeElement.closest('.cm-editor')));

  /* Selection, cut, paste. */
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Control+x');
  check('select all and cut empties it', await docText(p), '');
  await p.keyboard.press('Control+v');
  ok('paste puts it back', (await docText(p)).includes('nt x = 1'));

  /* Undo and redo. */
  const beforeUndo = await docText(p);
  await p.keyboard.press('Control+z');
  const afterUndo = await docText(p);
  ok('undo changes the document', afterUndo !== beforeUndo);
  await p.keyboard.press('Control+y');
  const afterRedo = await docText(p);
  ok('redo is available', afterRedo === beforeUndo || afterRedo !== afterUndo);

  check('no console errors while editing', consoleErrors, []);
  await p.close();
}

section('type a whole solution, run it, change the last character, run again');
{
  const p = await page();
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(p, '#/p/algo-running-max');

  /* Typed, the way a person types with auto-closing brackets on. */
  await typeProgramNaturally(p);
  const typed = await docText(p);
  ok('the program typed is the program in the document',
    typed.includes('#include <iostream>') && typed.includes('std::cout << n * 2;'));
  ok('the editor closed the brace rather than leaving it open',
    (typed.match(/\{/g) || []).length === (typed.match(/\}/g) || []).length);

  /* Pasting a whole program gives exactly the program. */
  await paste(p, CPP_OK);
  check('pasting gives back exactly what was pasted', await docText(p), CPP_OK);

  /* Run, then change the final character and run again with no pause: the
     second run must see the edit. */
  await p.locator('#runBtn').click();
  await p.waitForTimeout(1500);
  const firstSource = await p.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);

  await code(p).click();
  await p.keyboard.press('Control+End');
  await p.keyboard.type('//EDIT');
  /* No wait at all — straight to Run, which is the reported failure. */
  await p.locator('#runBtn').click();
  const sentSecond = await p.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  await p.waitForTimeout(1200);

  ok('the second run sees the edit', sentSecond.endsWith('//EDIT'));
  ok('and it differs from the first', sentSecond !== firstSource);
  await shot(p, 'run-after-edit');
  await p.close();
}

section('clicking places the caret where it looks');
{
  const p = await page();
  await open(p, '#/p/algo-running-max');
  await typeCode(p, 'line one\nline two\nline three\nline four');

  /* Click the middle of "line three" by asking the browser where it is. */
  const target = await p.evaluate(() => {
    const lines = [...document.querySelectorAll('.cm-content .cm-line')];
    const r = lines[2].getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
  });
  await p.mouse.click(target.x, target.y);
  const caret = await p.evaluate(() => {
    const v = window.SystemsLab.ProblemTypes.get('code').editor().view;
    const pos = v.state.selection.main.head;
    const line = v.state.doc.lineAt(pos);
    return { line: line.number, col: pos - line.from };
  });
  check('caret lands on the line clicked', caret.line, 3);
  ok('and a few characters in, not at column 0', caret.col > 0);
  await p.close();
}

section('the last character typed is the one that gets run');
{
  const p = await page();
  await open(p, '#/p/algo-running-max');
  await typeCode(p, 'print("a");');

  /* No waiting: read what Run would send the instant after the keystroke. */
  await p.keyboard.type('Z');
  const sent = await p.evaluate(() => {
    const ed = window.SystemsLab.ProblemTypes.get('code').editor();
    return { value: ed.value, painted: document.querySelector('.cm-content').textContent };
  });
  ok('the editor value has the final character', sent.value.endsWith('Z'));
  ok('and so does what is painted', sent.painted.endsWith('Z'));

  /* And the draft the store holds matches, with no debounce to wait out. */
  await p.waitForTimeout(150);
  const same = await p.evaluate(() => {
    const lang = document.querySelector('.lang-tab[aria-pressed="true"]').dataset.lang;
    const ed = window.SystemsLab.ProblemTypes.get('code').editor();
    return ed.value === window.SystemsLab.Store.draft('algo-running-max', lang);
  });
  ok('the saved draft matches the document', same);
  await p.close();
}

section('long lines and long files');
{
  const p = await page();
  await open(p, '#/p/algo-running-max');
  const lines = Array.from({ length: 80 }, (_, i) =>
    `int v${i} = ${i};${i === 20 ? ' // ' + 'y'.repeat(240) : ''}`);
  await typeCode(p, lines.join('\n'));

  const g = await p.evaluate(() => {
    const sc = document.querySelector('.cm-scroller');
    const ed = document.querySelector('.ed');
    const sr = sc.getBoundingClientRect(), er = ed.getBoundingClientRect();
    return {
      gapBelowScroller: Math.round(er.bottom - sr.bottom),
      hScroll: sc.scrollWidth > sc.clientWidth,
      vScroll: sc.scrollHeight > sc.clientHeight,
      editorBottomOnScreen: er.bottom <= innerHeight + 1,
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 2,
      pageHScroll: document.documentElement.scrollWidth > innerWidth + 2,
    };
  });
  ok('the editor scrolls horizontally', g.hScroll);
  ok('and vertically', g.vScroll);
  check('the scroller reaches the bottom of the editor, so its scrollbar is there',
    g.gapBelowScroller <= 2, true);
  ok('the editor stays inside the window', g.editorBottomOnScreen);
  ok('the page itself does not scroll', !g.pageScrolls);
  ok('and never sideways', !g.pageHScroll);

  /* Line numbers stay with their lines after scrolling. */
  await p.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 600; });
  await p.waitForTimeout(150);
  const aligned = await p.evaluate(() => {
    const n = document.querySelector('.cm-lineNumbers .cm-gutterElement:nth-child(2)');
    const l = document.querySelector('.cm-content .cm-line');
    return Math.abs(n.getBoundingClientRect().top - l.getBoundingClientRect().top);
  });
  ok(`line numbers stay aligned after scrolling (${aligned}px out)`, aligned <= 2);

  /* And typing still works down there. The click lands while the scroll it
     follows is still being painted, so the caret move is given a frame to
     settle before anything is typed — otherwise this reads as a typing bug
     when it is the test racing the renderer. */
  await code(p).click();
  await p.waitForTimeout(150);
  await p.keyboard.press('Control+End');
  await p.waitForTimeout(100);
  await p.keyboard.type('\nint tail = 1;');
  await p.waitForTimeout(100);
  ok('typing works after scrolling', (await docText(p)).endsWith('int tail = 1;'));
  await shot(p, 'editor-long-file');
  await p.close();
}

section('resizing the panels, and browser zoom');
{
  const p = await page();
  await open(p, '#/p/algo-running-max');
  await typeCode(p, CPP_OK);

  const gutter = p.locator('.ws-gutter');
  ok('there is a vertical divider', await gutter.count() === 1);
  const box = await gutter.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + 220, box.y + box.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(250);

  const after = await p.evaluate(() =>
    Number(document.querySelector('.ws-body').style.getPropertyValue('--split')));
  ok(`dragging moved the divider (now ${after})`, after > 0.45);

  /* Typing still lands, and the gutter is still aligned, after a resize. */
  await code(p).click();
  await p.keyboard.press('Control+End');
  await p.keyboard.type('//resized');
  ok('typing works after a resize', (await docText(p)).endsWith('//resized'));

  const alignedAfterResize = await p.evaluate(() => {
    const n = document.querySelector('.cm-lineNumbers .cm-gutterElement:nth-child(2)');
    const l = document.querySelector('.cm-content .cm-line');
    return Math.abs(n.getBoundingClientRect().top - l.getBoundingClientRect().top);
  });
  ok('and the gutter is still aligned', alignedAfterResize <= 2);

  /* Zoom. A browser zoom scales every CSS pixel, which for layout purposes
     is a bigger root font in a smaller window. body.style.zoom was tried
     first and is the wrong tool: it breaks hit testing, so the check was
     measuring Playwright rather than the page. */
  await p.setViewportSize({ width: 1100, height: 700 });
  await p.evaluate(() => { document.documentElement.style.fontSize = '19px'; });
  await p.waitForTimeout(400);
  await code(p).click();
  await p.keyboard.press('Control+End');
  await p.keyboard.type('//zoomed');
  ok('typing works at a larger root size', (await docText(p)).endsWith('//zoomed'));
  const zoomed = await p.evaluate(() => {
    const n = document.querySelector('.cm-lineNumbers .cm-gutterElement:nth-child(2)');
    const l = document.querySelector('.cm-content .cm-line');
    return {
      drift: Math.abs(n.getBoundingClientRect().top - l.getBoundingClientRect().top),
      hOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      vOverflow: document.documentElement.scrollHeight > innerHeight + 2,
    };
  });
  ok(`the gutter is still aligned when zoomed (${zoomed.drift}px)`, zoomed.drift <= 2);
  ok('the page still does not scroll sideways', !zoomed.hOverflow);
  ok('nor down', !zoomed.vOverflow);
  await p.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await p.close();
}

section('a draft per problem and per language, across a reload');
{
  const p = await page();
  await open(p, '#/p/algo-running-max');

  await typeCode(p, '// my cpp draft');
  await p.waitForTimeout(150);

  /* Switch language through the real tab. */
  await p.locator('.lang-tab[data-lang="js"]').click();
  await p.waitForTimeout(400);
  await typeCode(p, '// my js draft');
  await p.waitForTimeout(150);

  await p.locator('.lang-tab[data-lang="cpp"]').click();
  await p.waitForTimeout(400);
  check('switching back restores the C++ draft', await docText(p), '// my cpp draft');

  await p.locator('.lang-tab[data-lang="js"]').click();
  await p.waitForTimeout(400);
  check('and the JavaScript one is still there', await docText(p), '// my js draft');

  /* Reload. */
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const restored = await p.evaluate(() => ({
    cpp: window.SystemsLab.Store.draft('algo-running-max', 'cpp'),
    js: window.SystemsLab.Store.draft('algo-running-max', 'js'),
  }));
  check('the C++ draft survives a reload', restored.cpp, '// my cpp draft');
  check('and so does the JavaScript one', restored.js, '// my js draft');
  await p.close();
}

section('resetting to the template asks first');
{
  const p = await page();
  await open(p, '#/p/algo-running-max');
  await typeCode(p, '// mine');

  let asked = false;
  p.on('dialog', async d => { asked = true; await d.dismiss(); });
  const reset = p.locator('button', { hasText: 'Reset to template' });
  if (await reset.count()) {
    await reset.first().click();
    await p.waitForTimeout(300);
    ok('it asked before discarding', asked);
    check('and dismissing kept the draft', await docText(p), '// mine');
  } else {
    ok('a reset control exists', false);
  }
  await p.close();
}

/* ================================================================== */

section('a wrong MCQ answer is retryable and discloses nothing');
{
  const p = await page();
  await open(p, '#/p/dist-partition-choice');

  const key = await p.evaluate(async () =>
    (await (await fetch('solutions/dist-partition-choice.json')).json()).key);

  const wrongAt = await p.evaluate(k => {
    const labels = [...document.querySelectorAll('#answerWidget .opt')];
    return labels.findIndex((_, i) => i !== k.answer);
  }, key);

  await p.locator('#answerWidget .opt').nth(wrongAt).click();
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(700);

  const after = await p.evaluate(() => {
    const w = document.querySelector('#answerWidget');
    return {
      verdict: (document.querySelector('.verdict h4') || {}).textContent,
      enabled: [...w.querySelectorAll('input')].filter(i => !i.disabled).length,
      total: w.querySelectorAll('input').length,
      marks: [...w.querySelectorAll('.opt')].map(n => n.dataset.mark || ''),
      whyShown: w.querySelectorAll('.why').length,
      solutionLocked: !!document.querySelector('.tab[data-tab="solution"][data-locked]'),
      status: window.SystemsLab.Store.record('dist-partition-choice').status,
      xp: window.SystemsLab.Store.state.xp,
    };
  });

  check('it says it is wrong', after.verdict, 'Not right');
  check('every option stays clickable', after.enabled, after.total);
  check('no option is marked as the missed right one',
    after.marks.filter(m => m === 'missed' || m === 'right').length, 0);
  check('no distractor explanation is shown', after.whyShown, 0);
  ok('the Solution tab stays locked', after.solutionLocked);
  check('it is recorded as attempted, not solved', after.status, 'attempted');
  check('and nothing was awarded', after.xp, 0);

  /* Now pick the right one and submit again, without reloading. */
  await p.locator('#answerWidget .opt').nth(key.answer).click();
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(700);
  const second = await p.evaluate(() => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent,
    status: window.SystemsLab.Store.record('dist-partition-choice').status,
    solutionLocked: !!document.querySelector('.tab[data-tab="solution"][data-locked]'),
    xp: window.SystemsLab.Store.state.xp,
  }));
  check('the retry is accepted', second.verdict, 'Right');
  check('and recorded as solved', second.status, 'solved');
  ok('the Solution tab is open now', !second.solutionLocked);
  ok('and it paid out', second.xp > 0);
  await shot(p, 'mcq-after-correct');
  await p.close();
}

section('a wrong multi-select does not hand over the combination');
{
  const p = await page();
  const multiId = 'cpp-sizeof-and-types';
  await open(p, `#/p/${multiId}`);
  const isMulti = await p.evaluate(() =>
    window.SystemsLab.Catalog.meta(location.hash.replace('#/p/', '')).type === 'multi');
  ok(`${multiId} is a multi-select problem`, isMulti);

  if (isMulti) {
    const key = await p.evaluate(async id =>
      (await (await fetch(`solutions/${id}.json`)).json()).key, multiId);

    /* Tick one right and one wrong, the partial-credit case. */
    const picks = await p.evaluate(k => {
      const total = document.querySelectorAll('#answerWidget .opt').length;
      const right = k.answers.map(Number);
      const wrong = [...Array(total).keys()].find(i => !right.includes(i));
      return [right[0], wrong];
    }, key);
    for (const i of picks) await p.locator('#answerWidget .opt').nth(i).click();
    await p.locator('#submitBtn').click();
    await p.waitForTimeout(700);

    const after = await p.evaluate(() => {
      const w = document.querySelector('#answerWidget');
      return {
        feedback: (document.querySelector('.verdict p') || {}).textContent || '',
        marks: [...w.querySelectorAll('.opt')].map(n => n.dataset.mark || ''),
        enabled: [...w.querySelectorAll('input')].filter(i => !i.disabled).length,
        total: w.querySelectorAll('input').length,
        why: w.querySelectorAll('.why').length,
      };
    });
    check('no option is marked at all', after.marks.filter(Boolean).length, 0);
    check('every checkbox stays usable', after.enabled, after.total);
    check('no distractor notes', after.why, 0);
    ok('the feedback does not say how many options are correct',
      !/of \d+ right/.test(after.feedback) && !/All \d+/.test(after.feedback));
    ok('but it does say something useful',
      /tick|those|that one|Nothing/i.test(after.feedback));
    await shot(p, 'multi-after-wrong');
  }
  await p.close();
}

section('a reload after a failed attempt keeps the state and reveals nothing');
{
  const p = await page();
  await open(p, '#/p/dist-partition-choice');
  const key = await p.evaluate(async () =>
    (await (await fetch('solutions/dist-partition-choice.json')).json()).key);
  const wrongAt = await p.evaluate(k => {
    const n = document.querySelectorAll('#answerWidget .opt').length;
    return [...Array(n).keys()].find(i => i !== k.answer);
  }, key);
  await p.locator('#answerWidget .opt').nth(wrongAt).click();
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(600);

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const after = await p.evaluate(() => ({
    status: window.SystemsLab.Store.record('dist-partition-choice').status,
    attempts: window.SystemsLab.Store.record('dist-partition-choice').attempts,
    solutionLocked: !!document.querySelector('.tab[data-tab="solution"][data-locked]'),
    marks: [...document.querySelectorAll('#answerWidget .opt')].map(n => n.dataset.mark || ''),
    enabled: [...document.querySelectorAll('#answerWidget input')].filter(i => !i.disabled).length,
  }));
  check('the attempt is remembered', after.attempts, 1);
  check('still attempted', after.status, 'attempted');
  ok('the solution is still hidden after the reload', after.solutionLocked);
  check('and nothing is marked', after.marks.filter(Boolean).length, 0);
  ok('the controls are usable again', after.enabled > 0);
  await p.close();
}

section('revealing is deliberate, confirmed, and recorded as reviewed');
{
  const p = await page();
  await open(p, '#/p/dist-partition-choice');

  let confirmed = false;
  p.on('dialog', async d => { confirmed = true; await d.accept(); });

  await p.locator('.ws-menu summary').click();
  await p.waitForTimeout(150);
  const revealBtn = p.locator('.ws-menu-body button', { hasText: 'Reveal' });
  ok('Reveal is offered', await revealBtn.count() > 0);
  await revealBtn.first().click();
  await p.waitForTimeout(700);

  ok('it asked for confirmation', confirmed);
  const after = await p.evaluate(() => {
    const r = window.SystemsLab.Store.record('dist-partition-choice');
    return {
      status: r.status, revealed: r.revealed, xp: window.SystemsLab.Store.state.xp,
      statusShown: (document.querySelector('.ws-head .status-word') || {}).textContent,
      solutionLocked: !!document.querySelector('.tab[data-tab="solution"][data-locked]'),
    };
  });
  check('recorded as read, not solved', after.status, 'read');
  check('and shown as Solution reviewed', after.statusShown, 'Solution reviewed');
  ok('the solution is open', !after.solutionLocked);
  check('and it paid nothing', after.xp, 0);
  await p.close();
}

section('a solved problem can be practised again, for nothing');
{
  const solved = {
    xp: 25, coins: 25,
    streak: { current: 1, longest: 1, lastDay: '2026-10-05' },
    progress: {
      'dist-partition-choice': {
        id: 'dist-partition-choice', topic: 'dist', difficulty: 'beginner', type: 'mcq',
        status: 'solved', attempts: 1, hintsUsed: 0, xpEarned: 15,
        solvedAt: '2026-10-04', firstSeenAt: '2026-10-04T10:00:00.000Z',
        flagged: false, revealed: false, notes: '', perceived: null, reviewOn: '',
        bestScore: 1,
      },
    },
    readings: {}, owned: ['theme-dark'],
    equipped: { theme: 'theme-dark', accent: 'accent-default', avatar: 'avatar-chip', frame: 'frame-none', title: '' },
    achievements: [],
  };
  const p = await page({ state: solved });
  await open(p, '#/p/dist-partition-choice');

  const before = await p.evaluate(() => window.SystemsLab.Store.state.xp);
  ok('Submit is still offered on a solved problem', await p.locator('#submitBtn').count() === 1);
  ok('and the controls are live',
    await p.evaluate(() => [...document.querySelectorAll('#answerWidget input')].every(i => !i.disabled)));

  const key = await p.evaluate(async () =>
    (await (await fetch('solutions/dist-partition-choice.json')).json()).key);
  await p.locator('#answerWidget .opt').nth(key.answer).click();
  await p.locator('#submitBtn').click();
  await p.waitForTimeout(700);

  const after = await p.evaluate(() => ({
    xp: window.SystemsLab.Store.state.xp,
    note: (document.querySelector('.verdict .award') || {}).textContent || '',
  }));
  check('practising again pays nothing', after.xp, before);
  ok('and says so', /no more points|Already solved/i.test(after.note));
  await p.close();
}

/* ================================================================== */

section('the workspace layout');
for (const [w, h, label] of [[1440, 900, '1440x900'], [1920, 1080, '1920x1080']]) {
  const p = await page({ width: w, height: h });
  await open(p, '#/p/algo-running-max');
  await paste(p, CPP_OK);

  const m = await p.evaluate(() => {
    const box = s => { const n = document.querySelector(s); if (!n) return null;
      const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      head: box('.ws-head'), left: box('.ws-left'), right: box('.ws-right'),
      toolbar: box('.ws-toolbar'), editor: box('.ws-editor'), results: box('.ws-results'),
      run: box('#runBtn'), submit: box('#submitBtn'),
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 2,
      pageHScroll: document.documentElement.scrollWidth > innerWidth + 2,
      scrollers: [...document.querySelectorAll('*')].filter(n => {
        const cs = getComputedStyle(n);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
          && n.scrollHeight > n.clientHeight + 2;
      }).map(n => n.className && String(n.className).split(' ')[0]).filter(Boolean),
    };
  });

  ok(`${label}: a compact header`, m.head && m.head.h <= 60);
  ok(`${label}: the editor is wider than the statement`, m.right.w > m.left.w);
  ok(`${label}: Run and Submit are on screen`, m.run && m.submit && m.submit.y < h);
  ok(`${label}: the results pane is below the editor`, m.results.y > m.editor.y);
  ok(`${label}: the page does not scroll`, !m.pageScrolls);
  ok(`${label}: and never sideways`, !m.pageHScroll);
  ok(`${label}: the workspace fills the window`,
    (m.right.y + m.right.h) >= h - 4);
  console.log(`  --    ${label} scrolling elements: ${m.scrollers.join(', ') || 'none'}`);
  await shot(p, `workspace-${label}`);
  await p.close();
}

section('mobile stacks rather than squeezing');
{
  const p = await page({ width: 390, height: 844 });
  await open(p, '#/p/algo-running-max');
  await paste(p, CPP_OK);
  const m = await p.evaluate(() => {
    const b = s => { const n = document.querySelector(s); if (!n) return null;
      const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; };
    return { left: b('.ws-left'), right: b('.ws-right'),
      hScroll: document.documentElement.scrollWidth > innerWidth + 2 };
  });
  ok('the editor column is below the statement, not beside it', m.right.y > m.left.y);
  ok('both use the full width', Math.abs(m.left.w - m.right.w) < 4);
  ok('and the page does not scroll sideways', !m.hScroll);
  /* Back to the top before the picture: clicking into the editor scrolls the
     stacked layout down to it, and a screenshot of the middle of the page
     shows nothing about how it is laid out. */
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(200);
  await shot(p, 'workspace-mobile');
  await p.close();
}

section('both themes render the workspace');
for (const theme of ['theme-dark', 'theme-paper']) {
  const p = await page({ theme });
  await open(p, '#/p/algo-running-max');
  await paste(p, CPP_OK);
  const painted = await p.evaluate(() => {
    const c = document.querySelector('.cm-content');
    const coloured = [...c.querySelectorAll('span')].filter(n => {
      const col = getComputedStyle(n).color;
      return col && col !== 'rgba(0, 0, 0, 0)';
    }).length;
    return { coloured, bg: getComputedStyle(document.body).backgroundColor };
  });
  ok(`${theme}: the code is syntax-coloured (${painted.coloured} spans)`, painted.coloured > 5);
  await shot(p, `workspace-${theme}`);
  await p.close();
}

report('browser/journeys');
