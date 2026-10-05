/* The panel dividers, dragged with a real pointer.

   The report was "dragging the divider does not visibly resize the panels".
   The mechanism worked; the divider was a 1px hairline in --border inside a
   10px box, which is to say invisible, so a press-and-drag aimed by eye
   mostly landed on the pane behind it and scrolled that instead. It is now a
   visible bar with a grip, and the area that accepts the pointer is wider
   than the bar.

   Everything here measures getBoundingClientRect() before and after. A test
   that asserts a handle exists, or that a CSS rule is present, would have
   passed against the hairline — which is exactly the problem.

   Needs the site served:   npm run serve
   Run: node tests/browser/resize.test.mjs
        SHOTS=1 ... (also write screenshots) */

import { chromium } from 'playwright';

import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report } from '../harness.mjs';

/* BROWSER=msedge runs the whole suite through the Edge installed on this
   machine rather than Playwright's bundled Chromium. Same engine, different
   build and different default settings — and Edge on Windows is what this
   site is actually read in. */
const CHANNEL = process.env.BROWSER || null;
const launch = () => chromium.launch(CHANNEL ? { channel: CHANNEL } : {});

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

const browser = await launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const open = async (hash = '#/p/algo-running-max') => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
};

const cols = () => page.evaluate(() => {
  const r = s => {
    const n = document.querySelector(s);
    return n ? Math.round(n.getBoundingClientRect().width) : null;
  };
  return { left: r('.ws-left'), right: r('.ws-right') };
});

const rows = () => page.evaluate(() => {
  const r = s => {
    const n = document.querySelector(s);
    return n ? Math.round(n.getBoundingClientRect().height) : null;
  };
  return { editor: r('.ws-editor'), results: r('.ws-results') };
});

const cmWidth = () => page.evaluate(() => {
  const n = document.querySelector('.cm-scroller');
  return n ? Math.round(n.getBoundingClientRect().width) : null;
});

await open();

/* ---------------- can you see it, and can you hit it? ---------------- */

section('the divider is something you can find and grab');
{
  const look = await page.evaluate(() => {
    const g = document.querySelector('.ws-gutter');
    const cs = getComputedStyle(g);
    const bar = getComputedStyle(g, '::before');
    const box = g.getBoundingClientRect();
    const paneBg = getComputedStyle(document.querySelector('.ws-pane')).backgroundColor;
    /* How many pixels across the middle of the divider actually belong to
       it, asked of the browser rather than of the stylesheet. */
    const mid = box.left + box.width / 2;
    let span = 0;
    for (let d = -14; d <= 14; d += 1) {
      const n = document.elementFromPoint(mid + d, box.top + 200);
      if (n && n.classList.contains('ws-gutter')) span += 1;
    }
    return {
      width: Math.round(box.width),
      span,
      cursor: cs.cursor,
      barBg: bar.backgroundColor,
      barWidth: bar.width,
      paneBg,
      hasGrip: getComputedStyle(g, '::after').content !== 'none',
      role: g.getAttribute('role'),
      label: g.getAttribute('aria-label'),
      tabbable: g.tabIndex >= 0,
    };
  });
  ok(`the target is a generous ${look.span}px across`, look.span >= 16);
  check('with a resize cursor', look.cursor, 'col-resize');
  ok(`the bar you can see is ${look.barWidth} of it`, parseFloat(look.barWidth) >= 8);
  ok('and is a different colour from the panels either side',
    look.barBg !== look.paneBg && look.barBg !== 'rgba(0, 0, 0, 0)');
  ok('with a visible grip', look.hasGrip);
  check('it announces itself as a separator', look.role, 'separator');
  ok('and says what it resizes', (look.label || '').length > 10);
  ok('and is in the tab order', look.tabbable);
}

/* ---------------- the drag itself ---------------- */

section('dragging moves the panels, continuously');
{
  const before = await cols();
  const beforeCm = await cmWidth();
  if (process.env.SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'resize-before.png') });
  }

  const g = await page.locator('.ws-gutter').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 300);
  await page.mouse.down();

  const seen = [];
  for (const dx of [40, 90, 150, 220, 260]) {
    await page.mouse.move(g.x + g.width / 2 + dx, g.y + 300);
    await page.waitForTimeout(50);
    seen.push((await cols()).left);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = await cols();
  const afterCm = await cmWidth();

  ok(`the statement panel grew (${before.left} → ${after.left}px)`,
    after.left > before.left + 150);
  ok(`and the editor panel shrank (${before.right} → ${after.right}px)`,
    after.right < before.right - 150);
  ok('the two still fill the window between them',
    Math.abs((after.left + after.right) - (before.left + before.right)) < 20);

  /* Continuous, not one jump at the end. */
  const rising = seen.every((v, i) => i === 0 || v > seen[i - 1]);
  ok(`it moved on every step, not once at the end (${seen.join(' → ')})`, rising);

  ok(`CodeMirror re-measured with it (${beforeCm} → ${afterCm}px)`,
    afterCm !== null && Math.abs(afterCm - beforeCm) > 150);
  if (process.env.SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'resize-after.png') });
  }
}

section('and it is remembered');
{
  const before = await cols();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  const after = await cols();
  ok(`the width came back after a reload (${before.left} → ${after.left}px)`,
    Math.abs(after.left - before.left) < 12);
}

/* ---------------- it cannot be dragged to nothing ---------------- */

section('neither panel can be dragged away');
{
  const g = await page.locator('.ws-gutter').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 300);
  await page.mouse.down();
  await page.mouse.move(5, 300, { steps: 12 });      /* hard left */
  await page.waitForTimeout(80);
  const squashedLeft = await cols();
  await page.mouse.move(1435, 300, { steps: 12 });   /* hard right */
  await page.waitForTimeout(80);
  const squashedRight = await cols();
  await page.mouse.up();
  await page.waitForTimeout(150);

  ok(`the statement keeps a usable width (${squashedLeft.left}px)`, squashedLeft.left >= 250);
  ok(`and so does the editor (${squashedRight.right}px)`, squashedRight.right >= 250);
}

/* ---------------- ending the drag ---------------- */

section('every way a drag can end, ends it');
{
  const stuck = () => page.evaluate(() => ({
    dragging: !!document.querySelector('[data-dragging]'),
    resizing: !!document.body.dataset.resizing,
  }));

  /* 1. an ordinary release, but far away from the divider */
  const g = await page.locator('.ws-gutter').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 300);
  await page.mouse.down();
  await page.mouse.move(300, 870, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  check('releasing outside the divider ends it', await stuck(), { dragging: false, resizing: false });

  /* 2. pointercancel, which is what a touch gesture turning into a scroll
        sends, and what the browser sends when it takes the pointer away */
  const g2 = await page.locator('.ws-gutter').boundingBox();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + 300);
  await page.mouse.down();
  await page.mouse.move(g2.x + 60, g2.y + 300, { steps: 4 });
  await page.evaluate(() => document.querySelector('.ws-gutter')
    .dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
  await page.waitForTimeout(120);
  check('a cancelled pointer ends it', await stuck(), { dragging: false, resizing: false });
  await page.mouse.up();

  /* 3. Escape */
  const g3 = await page.locator('.ws-gutter').boundingBox();
  await page.mouse.move(g3.x + g3.width / 2, g3.y + 300);
  await page.mouse.down();
  await page.mouse.move(g3.x + 60, g3.y + 300, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  check('Escape ends it', await stuck(), { dragging: false, resizing: false });
  await page.mouse.up();

  /* And the page is still selectable afterwards, which is what a stuck
     [data-dragging] would have taken away. */
  const selectable = await page.evaluate(() =>
    getComputedStyle(document.body).userSelect !== 'none');
  ok('the page can still be selected', selectable);
}

/* ---------------- the keyboard ---------------- */

section('resizing without a mouse');
{
  await open();
  await page.locator('.ws-gutter').focus();
  const focused = await page.evaluate(() =>
    document.activeElement.classList.contains('ws-gutter'));
  ok('the divider takes focus', focused);

  const before = await cols();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const right = await cols();
  ok(`ArrowRight widens the statement (${before.left} → ${right.left}px)`,
    right.left > before.left + 30);

  for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  const left = await cols();
  ok(`ArrowLeft narrows it again (${right.left} → ${left.left}px)`, left.left < right.left - 30);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const reset = await cols();
  ok(`Enter puts it back to the default (${reset.left}px)`,
    Math.abs(reset.left - 0.42 * (reset.left + reset.right)) < 40);

  const announced = await page.evaluate(() =>
    document.querySelector('.ws-gutter').getAttribute('aria-valuenow'));
  ok(`and it says where it is (aria-valuenow="${announced}")`, Number(announced) > 0);
}

/* ---------------- the horizontal one ---------------- */

section('the editor and results divider');
{
  await open();
  const before = await rows();
  const g = await page.locator('.ws-hgutter').boundingBox();
  ok('it is there', !!g);
  check('with a row cursor', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.ws-hgutter')).cursor), 'row-resize');

  await page.mouse.move(g.x + 200, g.y + g.height / 2);
  await page.mouse.down();
  const seen = [];
  for (const dy of [-40, -90, -140]) {
    await page.mouse.move(g.x + 200, g.y + g.height / 2 + dy);
    await page.waitForTimeout(50);
    seen.push((await rows()).editor);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await rows();

  ok(`the editor shrank (${before.editor} → ${after.editor}px)`,
    after.editor < before.editor - 60);
  ok(`and the results pane grew (${before.results} → ${after.results}px)`,
    after.results > before.results + 60);
  const falling = seen.every((v, i) => i === 0 || v < seen[i - 1]);
  ok(`continuously (${seen.join(' → ')})`, falling);
}

/* ---------------- a smaller window ---------------- */

section('a split saved on a big screen does not ruin a small one');
{
  await open();
  await page.evaluate(() => {
    const ui = JSON.parse(localStorage.getItem('systems-lab/ui/v1') || '{}');
    ui.splitFraction = 0.8;
    localStorage.setItem('systems-lab/ui/v1', JSON.stringify(ui));
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  const wide = await cols();
  ok(`at 1920 the saved 0.8 is honoured (${wide.left}/${wide.right})`, wide.right < 420);

  for (const width of [1280, 1024, 960]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    const c = await cols();
    ok(`at ${width} the editor is still usable (${c.left}/${c.right})`, c.right >= 280);
  }

  /* And the preference itself was not rewritten by the small window. */
  const pref = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('systems-lab/ui/v1') || '{}').splitFraction);
  check('the reader\'s choice is still what they chose', pref, 0.8);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(400);
  const back = await cols();
  ok(`and it comes back on a big screen again (${back.left}/${back.right})`, back.right < 420);
  await page.setViewportSize({ width: 1440, height: 900 });
}

/* ---------------- reset ---------------- */

section('Reset layout');
{
  await open();
  await page.evaluate(() => {
    const ui = JSON.parse(localStorage.getItem('systems-lab/ui/v1') || '{}');
    ui.splitFraction = 0.75;
    localStorage.setItem('systems-lab/ui/v1', JSON.stringify(ui));
  });
  /* A draft, so it can be shown that resetting the layout does not touch it. */
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('// keep me');
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);

  const skewed = await cols();
  await page.locator('.ws-menu > summary').click();
  await page.waitForTimeout(150);
  await page.locator('#resetLayoutBtn').click();
  await page.waitForTimeout(500);

  const reset = await cols();
  ok(`it goes back to the default (${skewed.left} → ${reset.left}px)`,
    reset.left < skewed.left - 100);
  const doc = await page.evaluate(() =>
    window.SystemsLab.ProblemTypes.get('code').editor().value);
  ok('and the draft is untouched', doc.includes('// keep me'));
  const xp = await page.evaluate(() => window.SystemsLab.Store.state.xp);
  ok('and so is progress', typeof xp === 'number');
}

check('no uncaught errors', errors, []);
await browser.close();
report('browser/resize');
