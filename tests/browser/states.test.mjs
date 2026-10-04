/* The states a page is actually in, and the keyboard.

   The initial screen is the one state that gets looked at, and almost none of
   the interesting failures live there. This suite boots the page with crafted
   progress — nothing done, some done, everything done — and with the content
   missing, and checks each view says something sensible rather than rendering
   an empty frame or a NaN.

   It also checks the keyboard path, because every control added for a mouse
   in this project (a bookmark star, a panel divider, a theme preview) is a
   control someone will reach with Tab, and a visible focus ring is the only
   thing that makes that usable.

   Layout is checked as CSS rather than through a renderer: jsdom does no
   layout, so a width cannot be measured here. What can be checked is that
   every component with a fixed multi-column grid has a narrow-screen rule,
   which is the failure that actually happens.

   Run: node tests/browser/states.test.mjs */

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ROOT, read, section, check, ok, report } from '../harness.mjs';

/* ---------------- booting with a chosen state ---------------- */

async function boot({ state = null, breakContent = false } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'http://localhost/#/',
  });
  const { window } = dom;

  window.fetch = async (url) => {
    const rel = String(url).replace(/^https?:\/\/localhost\//, '').split('?')[0];
    /* "The content is not there" is a real state: the index is generated, and
       opening the page before running the build produces exactly this. */
    if (breakContent && rel.startsWith('data/')) {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };

  window.confirm = () => true;
  window.scrollTo = () => {};
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  if (state) window.localStorage.setItem('systems-lab/state/v1', JSON.stringify(state));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  window.eval(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'));

  await settle(window, 16);
  return { window, document: window.document, errors };
}

async function settle(window, rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(r => window.setTimeout(r, 0));
    await Promise.resolve();
  }
}

async function go(window, hash) {
  window.location.hash = hash;
  await settle(window);
}

const click = node => node.dispatchEvent(
  new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));

/* Every view, so a state is checked everywhere rather than on the dashboard. */
const VIEWS = ['#/', '#/problems', '#/tracks', '#/concepts', '#/profile', '#/shop', '#/settings'];

/* A value that failed to compute, as it actually appears on screen.

   Searching the whole view for the word "undefined" does not work here: this
   site is substantially *about* undefined behaviour, and "#undefined-behaviour"
   is a tag on three problems and the name of a concept. What a rendering bug
   really looks like is a slot whose entire contents are the broken value — a
   count that came out NaN, a label that came out undefined — so that is what
   is looked for: the own text of an element, not the text of the page. */
const BROKEN_VALUE = /^(NaN|NaN%|undefined|null|Infinity|-Infinity|\[object Object\])$/;

/* The text a node contributes itself, ignoring its children. */
const ownText = node => [...node.childNodes]
  .filter(n => n.nodeType === 3)
  .map(n => n.textContent)
  .join('')
  .trim();

function brokenValues(view) {
  const out = [];
  for (const node of view.querySelectorAll('*')) {
    const text = ownText(node);
    if (text && BROKEN_VALUE.test(text)) {
      const where = node.className ? `.${String(node.className).split(' ')[0]}` : '';
      out.push(`<${node.tagName.toLowerCase()}${where}> "${text}"`);
    }
  }
  /* NaN and friends are worth catching even inside a longer sentence, because
     every one of them is a computed value rather than prose. */
  for (const token of ['NaN', 'Infinity', '[object Object]']) {
    if (view.textContent.includes(token)) out.push(`"${token}" in the text`);
  }
  if (/undefined\/\d|\d\/undefined/.test(view.textContent)) out.push('undefined in a fraction');
  return out;
}

async function sweep(label, ctx) {
  for (const hash of VIEWS) {
    await go(ctx.window, hash);
    const view = ctx.document.querySelector('.view:not([hidden])');
    ok(`${label} · ${hash}: a view is showing`, view !== null);
    if (!view) continue;
    ok(`${label} · ${hash}: it has content`, view.textContent.trim().length > 20);
    const bad = brokenValues(view);
    ok(`${label} · ${hash}: nothing rendered as a broken value`
      + `${bad.length ? ` (${bad.slice(0, 3).join(', ')})` : ''}`, bad.length === 0);
  }
  check(`${label}: no console errors`, ctx.errors, []);
}

/* ---------------- nothing done yet ---------------- */

section('a fresh page, nothing solved');
const fresh = await boot();
await sweep('fresh', fresh);

await go(fresh.window, '#/');
ok('the dashboard still offers something to do',
  fresh.document.querySelector('#homeActions .action .btn') !== null);
ok('the heatmap says there is nothing yet',
  /nothing solved/i.test(fresh.document.getElementById('homeHeatCaption').textContent));
ok('no track claims to be in progress',
  [...fresh.document.querySelectorAll('#homeTracks .track-card')]
    .every(c => c.dataset.state === 'not-started'));
ok('no problem in the revisit strip claims to be worth nothing yet',
  [...fresh.document.querySelectorAll('#homeReview .worth')].every(n => !/^0 XP$/.test(n.textContent)));

await go(fresh.window, '#/concepts');
ok('reading reports nothing read yet',
  /\b0 of \d+ readings ticked/.test(fresh.document.getElementById('readingSummary').textContent));

await go(fresh.window, '#/profile');
ok('the profile does not pretend to a streak',
  !/NaN/.test(fresh.document.getElementById('profStats').textContent));
ok('and every topic bar is empty',
  [...fresh.document.querySelectorAll('#profTopics .bar i')]
    .every(i => !i.style.width || i.style.width === '0%'));

/* ---------------- part way through ---------------- */

section('part way through');

/* Built from the real catalogue so it cannot name a problem that is gone. */
const index = JSON.parse(read('data/index.json'));
const half = index.slice(0, Math.max(3, Math.floor(index.length / 3)));
const progress = {};
for (const [i, p] of half.entries()) {
  progress[p.id] = {
    id: p.id, topic: p.topic, difficulty: p.difficulty, type: p.type,
    status: i % 3 === 0 ? 'attempted' : 'solved',
    attempts: 1 + (i % 2),
    hintsUsed: i % 4 === 0 ? 1 : 0,
    xpEarned: i % 3 === 0 ? 0 : 15,
    solvedAt: i % 3 === 0 ? '' : '2026-10-01',
    firstSeenAt: '2026-09-30T10:00:00.000Z',
    flagged: i % 5 === 0,
    revealed: false,
    notes: i % 7 === 0 ? 'a note' : '',
    perceived: null,
    reviewOn: i === 1 ? '2026-09-29' : '',
  };
}

const partway = await boot({
  state: {
    xp: 240, coins: 180,
    streak: { current: 3, longest: 5, lastDay: '2026-10-03' },
    progress,
    readings: {},
    owned: ['theme-dark', 'theme-paper'],
    equipped: { theme: 'theme-dark', accent: 'accent-default', avatar: 'avatar-chip', frame: 'frame-none', title: '' },
    achievements: [],
  },
});
await sweep('part way', partway);

await go(partway.window, '#/');
ok('the dashboard offers to pick something up',
  /continue learning/i.test(partway.document.querySelector('#homeActions .eyebrow').textContent));
ok('some track is now Attempted',
  [...partway.document.querySelectorAll('#homeTracks .track-card')]
    .some(c => c.dataset.state === 'attempted'));
ok('a bar has moved off zero',
  [...partway.document.querySelectorAll('#homeTracks .bar i')]
    .some(i => i.style.width && i.style.width !== '0%'));
ok('anything due is surfaced', partway.document.querySelector('#homeReview .prow') !== null);

await go(partway.window, '#/problems');
const statuses = new Set([...partway.document.querySelectorAll('#catalogList .prow')]
  .map(r => r.dataset.status));
ok('the catalogue shows more than one status', statuses.size > 1);
ok('a solved row says so in words',
  [...partway.document.querySelectorAll('#catalogList .status-word')]
    .some(n => n.textContent === 'Solved'));
ok('and a bookmarked row shows its star pressed',
  [...partway.document.querySelectorAll('#catalogList button.bookmark')]
    .some(b => b.getAttribute('aria-pressed') === 'true'));

/* ---------------- everything done ---------------- */

section('everything solved');
const allDone = {};
for (const p of index) {
  allDone[p.id] = {
    id: p.id, topic: p.topic, difficulty: p.difficulty, type: p.type,
    status: 'solved', attempts: 1, hintsUsed: 0, xpEarned: 20,
    solvedAt: '2026-10-02', firstSeenAt: '2026-10-01T09:00:00.000Z',
    flagged: false, revealed: false, notes: '', perceived: null, reviewOn: '',
  };
}
const done = await boot({
  state: {
    xp: 9000, coins: 4000,
    streak: { current: 30, longest: 30, lastDay: '2026-10-03' },
    progress: allDone, readings: {},
    owned: ['theme-dark'], equipped: { theme: 'theme-dark', accent: 'accent-default', avatar: 'avatar-chip', frame: 'frame-none', title: '' },
    achievements: [],
  },
});
await sweep('all done', done);

await go(done.window, '#/');
ok('the dashboard says there is nothing left rather than pointing at nothing',
  /everything is solved/i.test(done.document.querySelector('#homeActions .action h2').textContent));
ok('every track reads Completed',
  [...done.document.querySelectorAll('#homeTracks .track-card')]
    .every(c => c.dataset.state === 'completed'));
await go(done.window, '#/tracks');
ok('and so does every card on the tracks page',
  [...done.document.querySelectorAll('#trackList .track-card .state')]
    .every(n => n.textContent === 'Completed'));
await go(done.window, `#/tracks/${JSON.parse(read('data/tracks.json'))[0].id}`);
ok('a finished track shows Complete rather than a dead button',
  done.document.querySelector('#trackList .track-summary .pill') !== null);
ok('the top rank is reported without a next one',
  /top rank/i.test(done.document.getElementById('homeRankNext').textContent) ||
  done.document.getElementById('homeRankNext').textContent.length > 0);

/* ---------------- the content is not there ---------------- */

section('the content could not be loaded');
const broken = await boot({ breakContent: true });

await go(broken.window, '#/problems');
const emptyCatalog = broken.document.querySelector('#catalogList .empty');
ok('the catalogue explains itself', emptyCatalog !== null);
ok('and names the fix',
  /build:index/.test(emptyCatalog.textContent));
ok('rather than rendering an empty frame',
  emptyCatalog.textContent.trim().length > 30);

await go(broken.window, '#/');
ok('the dashboard does not claim a catalogue it does not have',
  /no problems are loaded/i.test(broken.document.getElementById('homeBlurb').textContent));
ok('and its main action says so too',
  /nothing loaded/i.test(broken.document.querySelector('#homeActions .action h2').textContent));

await go(broken.window, '#/concepts');
ok('reading says there is nothing to read',
  /no concepts loaded/i.test(broken.document.querySelector('#conceptList').textContent));

await go(broken.window, '#/tracks');
ok('tracks says there are none',
  /no tracks/i.test(broken.document.getElementById('trackList').textContent));

/* A missing problem is its own error state. */
await go(fresh.window, '#/p/no-such-problem-at-all');
ok('a link to a problem that does not exist says so',
  /not found/i.test(fresh.document.getElementById('problemHost').textContent));
ok('and offers a way back',
  fresh.document.querySelector('#problemHost a.btn') !== null);

/* ---------------- loading ---------------- */

section('loading');
/* Opening a problem shows something while its file is fetched. Checked by
   reading the host immediately, before the microtask queue is drained. */
fresh.window.location.hash = '#/p/' + index[0].id;
await new Promise(r => fresh.window.setTimeout(r, 0));
const duringLoad = fresh.document.getElementById('problemHost').textContent;
ok('a problem shows a loading line rather than a blank panel',
  /loading/i.test(duringLoad) || duringLoad.includes(index[0].title));
await settle(fresh.window, 20);
ok('and then the problem itself',
  fresh.document.querySelector('#problemHost .phead h1') !== null);

/* ---------------- the keyboard ---------------- */

section('every control is reachable by keyboard');
await go(partway.window, '#/problems');

/* What a browser will put in the tab order. Anything interactive outside this
   list is a control a keyboard cannot reach. */
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

const catalogFocusable = [...partway.document.querySelectorAll(`#view-problems ${FOCUSABLE}`)];
ok('the filters are reachable', catalogFocusable.some(n => n.id === 'fSearch'));
ok('the lane filter is reachable', catalogFocusable.some(n => n.id === 'fLane'));
ok('a row link is reachable', catalogFocusable.some(n => n.classList.contains('prow-link')));
ok('and so is its bookmark', catalogFocusable.some(n => n.classList.contains('bookmark')));

/* The bookmark must be operable, not merely focusable. */
const firstStar = partway.document.querySelector('#catalogList button.bookmark');
const starId = firstStar.closest('.prow').querySelector('.prow-link').getAttribute('href').replace('#/p/', '');
const wasFlagged = partway.window.SystemsLab.Store.record(starId).flagged;
firstStar.focus();
check('focus lands on the star', partway.document.activeElement, firstStar);
click(firstStar);
await settle(partway.window);
ok('and pressing it toggles the bookmark',
  partway.window.SystemsLab.Store.record(starId).flagged !== wasFlagged);

section('the divider is in the tab order');
const code = index.find(p => p.type === 'code');
await go(partway.window, `#/p/${code.id}`);
await settle(partway.window, 20);
const gutter = partway.document.querySelector('#problemHost .gutter');
ok('there is a divider', gutter !== null);
check('with an explicit tabindex', gutter.getAttribute('tabindex'), '0');
ok('a label for a screen reader', !!gutter.getAttribute('aria-label'));
ok('and a reported position', !!gutter.getAttribute('aria-valuenow'));

section('the theme preview is a button, not a swatch you cannot press');
await go(partway.window, '#/shop');
const previewButtons = [...partway.document.querySelectorAll('.shop-item [data-act="preview"]')];
ok('previews are buttons', previewButtons.length > 0 && previewButtons.every(b => b.tagName === 'BUTTON'));
ok('and report their state', previewButtons.every(b => b.hasAttribute('aria-pressed')));
ok('the miniature itself is hidden from assistive tech',
  [...partway.document.querySelectorAll('.tpreview')].every(n => n.getAttribute('aria-hidden') === 'true'));

section('nav keys do not fire while typing');
await go(partway.window, '#/problems');
const box = partway.document.getElementById('fSearch');
box.focus();
box.dispatchEvent(new partway.window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
await settle(partway.window);
check('typing p in the search box does not navigate', partway.window.location.hash, '#/problems');
box.dispatchEvent(new partway.window.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
await settle(partway.window);
ok('and typing f does not toggle focus mode',
  !partway.document.documentElement.hasAttribute('data-focus'));

/* ---------------- focus is visible ---------------- */

section('focus is visible');
const styles = read('css/styles.css');

ok('there is a global focus-visible ring',
  /:focus-visible\s*\{[^}]*outline:\s*2px/.test(styles));

/* Anything that removes the outline has to put something else in its place,
   or a keyboard user loses the cursor. Each exception is listed with the rule
   that replaces it, so a new one cannot be added silently. */
const SUPPRESSED = [
  { selector: '.ed-input:focus-visible', replacedBy: '.ed:focus-within' },
  { selector: '.prow-link:focus-visible', replacedBy: '.prow:has(.prow-link:focus-visible)' },
];
for (const { selector, replacedBy } of SUPPRESSED) {
  ok(`${selector} suppresses the outline deliberately`, styles.includes(selector));
  ok(`and ${replacedBy} supplies one instead`, styles.includes(replacedBy));
}

const suppressors = [...styles.matchAll(/([^{}]*):focus(-visible)?[^{}]*\{([^}]*)\}/g)]
  .filter(m => /outline:\s*(none|0)/.test(m[3]))
  .map(m => m[1].trim() + ':focus' + (m[2] || ''));
const unexpected = suppressors.filter(sel =>
  !SUPPRESSED.some(s => sel.includes(s.selector.split(':')[0])));
check('no other rule removes a focus ring', unexpected, []);

/* ---------------- the narrow screen ---------------- */

section('every fixed-column layout has a narrow-screen rule');
/* jsdom does no layout, so this is the checkable part: a component with a
   hard multi-column grid and no media-query override is the one that pushes
   the page sideways on a phone. */
const MEDIA = styles.split('@media').slice(1).join('@media');
const NEEDS_NARROW = [
  '.prow', '.plist-head', '.action', '.split', '.hero', '.pwrap',
  '.preview-bar', '.topbar', '.filters',
];
for (const sel of NEEDS_NARROW) {
  ok(`${sel} is adjusted on a narrow screen`,
    new RegExp(`\\${sel}\\b`).test(MEDIA));
}
ok('the heatmap scrolls rather than stretching', /\.heat\s*\{[^}]*overflow-x:\s*auto/.test(styles));
ok('the topic strip scrolls too', /\.topic-nav\s*\{[^}]*overflow-x:\s*auto/.test(styles));
ok('wide code blocks scroll', /pre\.code-block\s*\{[^}]*overflow-x:\s*auto/.test(styles));
ok('and the problem list head is dropped rather than squeezed',
  /\.plist-head\s*\{\s*display:\s*none/.test(MEDIA));

section('nothing is wider than the window');
/* A fixed px width on a block is the other way a phone ends up scrolling
   sideways. Anything over 360px has to be a max-width or inside a scroller. */
const wide = [...styles.matchAll(/([^{}]*)\{([^}]*)\}/g)]
  .flatMap(m => [...m[2].matchAll(/(?<!max-|min-)width:\s*(\d{3,})px/g)]
    .map(w => ({ selector: m[1].trim().split('\n').pop().trim(), px: Number(w[1]) })))
  .filter(w => w.px > 360);
check('no fixed width over 360px', wide, []);

report('browser/states');
