/* The whole page, driven through real events in jsdom: browse, filter, open a
   problem, read its prerequisites, answer it wrongly, answer it rightly, and
   spend what that earned in the shop.

   fetch is served from the repo itself, so this exercises the real index, the
   real problem files and the real answer keys — a broken content file fails
   here as well as in content.test.mjs.

   Run: node tests/browser/app.test.mjs */

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ROOT, section, check, ok, report } from '../harness.mjs';

/* ---------------- booting ---------------- */

async function boot({ state = null } = {}) {
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

  /* Serve the repo. Anything the page asks for that is not a file is a 404,
     which is exactly what a real miss looks like. */
  window.fetch = async (url) => {
    const rel = String(url).replace(/^https?:\/\/localhost\//, '').split('?')[0];
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };

  window.confirm = () => true;
  window.alert = msg => errors.push('alert(): ' + msg);
  window.scrollTo = () => {};
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  if (state) window.localStorage.setItem('systems-lab/state/v1', JSON.stringify(state));

  /* The scripts, and their order, are read out of index.html rather than
     listed here. jsdom will not run them itself under runScripts:
     'outside-only', but taking the list from the page means a script added to
     the site is exercised by this test automatically instead of being quietly
     untested until someone remembers to update a second list. */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  window.eval(files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'));

  await settle(window, 12);
  return { window, document: window.document, errors, dom };
}

/* The app is asynchronous in several small steps — fetch the index, fetch a
   problem, then re-draw — so the test waits for the microtask queue to drain
   rather than guessing at a delay. */
async function settle(window, rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(r => window.setTimeout(r, 0));
    await Promise.resolve();
  }
}

async function go(window, hash) {
  window.location.hash = hash;
  await settle(window);
}

/* Some of the UI is debounced — the search box waits 120ms so that typing does
   not re-render per keystroke. settle() only drains the microtask queue, so it
   cannot carry a real timer; waiting on the condition instead of on a fixed
   delay keeps the test honest on a slow CI runner as well as on a fast
   laptop. */
async function waitFor(window, predicate, { timeout = 4000 } = {}) {
  const start = Date.now();
  for (;;) {
    try { if (predicate()) return true; } catch { /* not ready yet */ }
    if (Date.now() - start > timeout) return false;
    await new Promise(r => window.setTimeout(r, 25));
  }
}

const click = node => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = node => node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', { bubbles: true }));
const input = node => node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true }));

/* ---------------- boot ---------------- */

section('boot');
let { window, document, errors } = await boot();

check('no errors on the console', errors, []);
ok('the store is initialised', !!window.SystemsLab.Store.state);
ok('the catalog loaded', window.SystemsLab.Catalog.all().length >= 3);
check('the dashboard is showing', document.getElementById('view-home').hidden, false);
check('and the others are not', document.getElementById('view-problems').hidden, true);
ok('the rank reads Userland', document.getElementById('homeRank').textContent.includes('Userland'));
ok('the topic grid is drawn, one card per topic',
  document.querySelectorAll('#homeTopics .topic-card').length === window.SystemsLab.Store.TOPICS.length);
ok('the activity grid is drawn', document.querySelectorAll('#homeHeat i').length === 26 * 7);

/* ---------------- the catalog ---------------- */

section('the catalog');
await go(window, '#/problems');
check('the catalog is showing', document.getElementById('view-problems').hidden, false);
const rows = () => [...document.querySelectorAll('#catalogList .prow')];
ok('every problem is listed', rows().length === window.SystemsLab.Catalog.all().length);
/* The row is a div with a stretched link inside, so the bookmark button can
   be a real button. href lives on .prow-link. */
const rowHref = r => (r.querySelector('.prow-link') || r).getAttribute('href');
ok('a row links to its problem', rowHref(rows()[0]).startsWith('#/p/'));
ok('a row shows what it is worth', rows()[0].textContent.includes('XP'));

section('filtering');
/* Counted from the catalog rather than written as a literal, so adding
   problems does not break the test — only a filter that stops working does. */
const inTopic = t => window.SystemsLab.Catalog.all().filter(p => p.topic === t).length;
const topicSel = document.getElementById('fTopic');
topicSel.value = 'os';
change(topicSel);
await settle(window);
ok('filtering by topic narrows the list',
  rows().length === inTopic('os') && rows().length < window.SystemsLab.Catalog.all().length);
ok('and every row kept is from that topic',
  rows().every(r => (window.SystemsLab.Catalog.meta(rowHref(r).replace('#/p/', '')) || {}).topic === 'os'));

topicSel.value = '';
change(topicSel);
await settle(window);

const search = document.getElementById('fSearch');
search.value = 'partition';
input(search);
ok('searching matches a title',
  await waitFor(window, () => rows().length > 0 &&
    rows().every(r => r.textContent.toLowerCase().includes('partition'))));

search.value = 'zzzznothing';
input(search);
ok('no matches says so',
  await waitFor(window, () => document.querySelector('#catalogList .empty') !== null));

click(document.getElementById('fClear'));
await settle(window);
ok('clearing restores the list', rows().length === window.SystemsLab.Catalog.all().length);

section('a filter can arrive in the url');
await go(window, '#/problems?topic=dist');
ok('a topic link pre-filters the catalog', rows().length === inTopic('dist'));
ok('and the control shows it', document.getElementById('fTopic').value === 'dist');

/* ---------------- opening a problem ---------------- */

section('opening a problem');
await go(window, '#/p/dist-partition-choice');
check('the problem view is showing', document.getElementById('view-problem').hidden, false);
ok('the title is rendered', document.querySelector('.phead h1').textContent.includes('partition'));
ok('the statement is rendered', document.querySelector('.prose').innerHTML.includes('London'));
ok('the difficulty is shown as a dot and a word',
  document.querySelector('.phead .diff').textContent.length > 0);
ok('four options are offered', document.querySelectorAll('#answerWidget .opt').length === 4);
ok('there are five tabs', document.querySelectorAll('.tabs .tab').length === 5);
ok('the solution tab is locked', document.querySelector('[data-tab="solution"]').dataset.locked === 'true');
ok('the rail says what it is worth', document.querySelector('.worth-big').textContent === '15 XP');

section('the prerequisites tab');
click(document.querySelector('[data-tab="prereq"]'));
await settle(window);
const prereqs = [...document.querySelectorAll('.prereq')];
ok('prerequisites are listed', prereqs.length >= 2);
ok('in reading order, foundations first', prereqs[0].textContent.length > 0);
ok('each says why it is needed here', document.querySelector('.prereq .why') !== null);
ok('readings are listed with somewhere to read them',
  document.querySelectorAll('.prereq .reading').length >= 2);
ok('a reading links out', document.querySelector('.prereq .reading a') !== null);

const firstReading = document.querySelector('.prereq .reading input');
firstReading.checked = true;
change(firstReading);
await settle(window);
check('ticking a reading is recorded', window.SystemsLab.Store.readingCount(), 1);
ok('and is shown as read', document.querySelector('.prereq .reading.done') !== null);

section('the hints tab');
click(document.querySelector('[data-tab="hints"]'));
await settle(window);
ok('no hint is shown before you ask', document.querySelectorAll('.hint').length === 0);
ok('a button offers the first one', document.querySelector('.panel .btn') !== null);
ok('and names the cost', document.querySelector('.panel .btn').textContent.includes('XP'));

click(document.querySelector('.panel .btn'));
await settle(window);
ok('the hint appears', document.querySelectorAll('.hint').length === 1);
check('and is charged for', window.SystemsLab.Store.record('dist-partition-choice').hintsUsed, 1);

click(document.querySelector('[data-tab="problem"]'));
await settle(window);
/* Beginner base 10, first-try bonus still intact, one hint at a quarter of
   base: 15 - 2.5 = 12.5, which rounds to 13. */
check('the problem is now worth less', document.querySelector('.worth-big').textContent, '13 XP');

/* ---------------- answering ---------------- */

section('submitting nothing');
click(document.getElementById('submitBtn'));
await settle(window);
check('an empty answer is not graded', window.SystemsLab.Store.record('dist-partition-choice').attempts, 0);
ok('and says so', [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Answer it first')));

section('a wrong answer');
const opts = () => [...document.querySelectorAll('#answerWidget .opt input')];
opts()[1].checked = true;
click(document.getElementById('submitBtn'));
await settle(window);

ok('the verdict says it is wrong', document.querySelector('.verdict[data-kind="wrong"]') !== null);
check('no points were awarded', window.SystemsLab.Store.state.xp, 0);
check('the attempt is recorded', window.SystemsLab.Store.record('dist-partition-choice').attempts, 1);
check('the status is attempted', window.SystemsLab.Store.record('dist-partition-choice').status, 'attempted');
ok('the solution tab is still locked',
  document.querySelector('[data-tab="solution"]').dataset.locked === 'true');
ok('the option chosen is marked wrong',
  document.querySelector('.opt[data-mark="wrong"]') !== null);
ok('why it is wrong is explained on the option',
  document.querySelector('.opt .why') !== null);

section('the right answer');
opts()[0].checked = true;
click(document.getElementById('submitBtn'));
await settle(window);

ok('the verdict says it is right', document.querySelector('.verdict[data-kind="right"]') !== null);
const xpAfter = window.SystemsLab.Store.state.xp;
/* beginner base 10, no first-try bonus (one wrong answer), one hint at -2.5 */
check('points reflect the hint and the lost bonus', xpAfter, 8);
check('the status is solved', window.SystemsLab.Store.record('dist-partition-choice').status, 'solved');
ok('the purse updated', document.getElementById('purseXp').textContent === String(xpAfter));
ok('the solution tab is unlocked now',
  document.querySelector('[data-tab="solution"]').dataset.locked !== 'true');
ok('a toast reported the award', [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('XP')));
ok('First Blood was announced', [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('First Blood')));

section('the solution tab');
click(document.querySelector('[data-tab="solution"]'));
await settle(window);
ok('the explanation is rendered', document.querySelector('.panel .prose').textContent.length > 400);
ok('it is real prose, not a stub', document.querySelector('.panel .prose h2') !== null);
ok('and points at further reading', document.querySelector('.panel .card .readings') !== null);

section('re-solving pays nothing');
click(document.querySelector('[data-tab="problem"]'));
await settle(window);
ok('the widget is locked after solving',
  document.querySelectorAll('#answerWidget input:not([disabled]):not(.ed-input)').length === 0);
ok('there is no submit button any more', document.getElementById('submitBtn') === null);

section('the catalog reflects the solve');
await go(window, '#/problems');
const solvedRow = rows().find(r => rowHref(r) === '#/p/dist-partition-choice');
ok('the row is ticked', solvedRow.querySelector('.tick').textContent === '✓');
ok('and shows what it earned', solvedRow.textContent.includes('8 XP'));

const statusSel = document.getElementById('fStatus');
statusSel.value = 'solved';
change(statusSel);
await settle(window);
ok('filtering by solved finds exactly the solved ones',
  rows().length === Object.values(window.SystemsLab.Store.state.progress)
    .filter(r => r.status === 'solved').length);
statusSel.value = '';
change(statusSel);
await settle(window);

/* ---------------- an order problem ---------------- */

section('an order problem');
await go(window, '#/p/os-page-fault-walk');
ok('seven steps are listed', document.querySelectorAll('.order-item').length === 7);
ok('each has move buttons', document.querySelectorAll('.order-item .moves').length === 7);

/* Submitting the presented order must be wrong — the build-index validator
   rejects an identity permutation precisely so this is true. */
click(document.getElementById('submitBtn'));
await settle(window);
ok('the order as presented is not the answer',
  document.querySelector('.verdict[data-kind="wrong"], .verdict[data-kind="part"]') !== null);

/* Now drive it into the right order with the buttons, which is also the only
   keyboard-accessible path through this widget. */
const want = (await (async () => {
  const res = await window.fetch('solutions/os-page-fault-walk.json');
  return (await res.json()).key.order;
})());

for (let target = 0; target < want.length; target += 1) {
  const items = () => [...document.querySelectorAll('.order-item')];
  const at = items().findIndex(n => Number(n.dataset.i) === want[target]);
  for (let k = at; k > target; k -= 1) {
    click(items()[k].querySelector('.moves button'));   /* the up arrow */
  }
}
await settle(window);
check('the widget now reads in the right order',
  [...document.querySelectorAll('.order-item')].map(n => Number(n.dataset.i)), want);

click(document.getElementById('submitBtn'));
await settle(window);
ok('and it is graded correct', document.querySelector('.verdict[data-kind="right"]') !== null);
check('the order problem is solved', window.SystemsLab.Store.record('os-page-fault-walk').status, 'solved');

/* ---------------- a numeric problem ---------------- */

section('a numeric problem');
await go(window, '#/p/arch-cache-line-stride');
ok('an input is offered', document.getElementById('numAnswer') !== null);
document.getElementById('numAnswer').value = '1/16';
click(document.getElementById('submitBtn'));
await settle(window);
ok('a fraction is accepted as the number it is',
  document.querySelector('.verdict[data-kind="right"]') !== null);

/* ---------------- a code problem, with the judge absent ---------------- */

/* jsdom has no Worker and there is no judge listening here, which is exactly
   the situation the page has to survive: C++ and Rust are unavailable, and it
   must say so clearly rather than offering a button that silently fails. */
section('a code problem degrades clearly without the judge');
await go(window, '#/p/algo-running-max');
ok('the editor is rendered', document.querySelector('.ed .ed-input') !== null);
ok('with a line-number gutter', document.querySelector('.ed .ed-gutter') !== null);
ok('the gutter is numbered', document.querySelector('.ed .ed-gutter').textContent.startsWith('1'));
ok('a language tab per claimed language', document.querySelectorAll('.lang-tab').length === 3);
ok('the sanitize profile is advertised',
  [...document.querySelectorAll('.editor-head .pill')].some(n => n.textContent.includes('sanitize')));
ok('and that cleanliness is required',
  [...document.querySelectorAll('.editor-head .pill')].some(n => n.textContent.includes('clean')));
ok('a starter template is loaded', document.querySelector('.ed .ed-input').value.length > 20);

await settle(window, 20);
const judgeLine = document.getElementById('codeJudgeText');
ok('the judge is reported as not answering', judgeLine.textContent.includes('not answering'));
/* One documented command, the same one Settings shows. Docker is still
   supported but is no longer what the page tells you to run. */
ok('and the start command is given', judgeLine.textContent.includes('npm run runner'));
ok('C++ is named as needing it', /C\+\+/.test(judgeLine.textContent));
const cppTab = [...document.querySelectorAll('.lang-tab')].find(n => n.dataset.lang === 'cpp');
ok('the C++ tab is disabled rather than silently broken', cppTab.disabled === true);
const jsTab = [...document.querySelectorAll('.lang-tab')].find(n => n.dataset.lang === 'js');
ok('the JavaScript tab stays available, since it runs in the tab', jsTab.disabled === false);

section('an untouched template is not an attempt');
click(document.getElementById('submitBtn'));
await settle(window);
check('nothing was recorded', window.SystemsLab.Store.record('algo-running-max').attempts, 0);
ok('and it says to answer first',
  [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Answer it first')));

section('the editor opens on the language the problem is about');
/* The problem lists cpp first, and it is a C++ lesson — the sanitizer
   requirement only means anything there. So the author's order is the default
   even when the judge is down; the message says what to start. */
ok('C++ is selected', [...document.querySelectorAll('.lang-tab')]
  .find(n => n.getAttribute('aria-pressed') === 'true').dataset.lang === 'cpp');
ok('and the C++ template is loaded',
  document.querySelector('.ed .ed-input').value.includes('std::cin'));

section('switching language keeps a draft per language');
const area = () => document.querySelector('.ed .ed-input');
click(document.querySelector('[data-lang="js"]'));
await settle(window);
ok('the JavaScript template appears', area().value.includes('readLines'));

area().value = 'print("mine");';
input(area());
await settle(window);
check('the JavaScript draft is saved',
  window.SystemsLab.Store.draft('algo-running-max', 'js'), 'print("mine");');

click(document.querySelector('[data-lang="rust"]'));
await settle(window);
ok('switching shows the Rust template', area().value.includes('fn main'));

click(document.querySelector('[data-lang="js"]'));
await settle(window);
check('switching back restores what you wrote', area().value, 'print("mine");');
ok('and the C++ draft is untouched by all of that',
  window.SystemsLab.Store.draft('algo-running-max', 'cpp').includes('std::cin'));

/* ---------------- the shop ---------------- */

section('the shop');
const coins = window.SystemsLab.Store.state.coins;
ok('solving earned coins to spend', coins > 0);
await go(window, '#/shop');
ok('items are offered', document.querySelectorAll('.shop-item').length >= 8);

const card = name => [...document.querySelectorAll('.shop-item')]
  .find(n => n.querySelector('h4').textContent.includes(name));

/* Read the stylesheets so the miniature cannot silently show the wrong
   palette: a card keyed to a theme with no block would inherit the page. */
const themeCssNames = await (async () => {
  const names = new Set();
  for (const file of ['css/styles.css', 'css/themes.css']) {
    const res = await window.fetch(file);
    const css = await res.text();
    for (const m of css.matchAll(/\[data-theme-preview="([\w-]+)"\]/g)) names.add(m[1]);
  }
  return names;
})();
const actOn = (name, act) => card(name).querySelector(`[data-act="${act}"]`);

section('a theme shows what the interface looks like, not four colour chips');
const themeCards = [...document.querySelectorAll('.shop-item[data-slot="theme"]')];
ok('every theme card has a miniature',
  themeCards.every(n => n.querySelector('.tpreview') !== null));
ok('each miniature is keyed to its own theme, not to the page',
  themeCards.every(n => n.querySelector('.tpreview').dataset.themePreview === n.dataset.item));
ok('and every theme in the shop has a token block that matches it',
  themeCards.every(n => themeCssNames.has(n.dataset.item)));
const mini = themeCards[0].querySelector('.tpreview');
ok('it shows real chrome, not a swatch', mini.querySelector('.tp-bar') !== null);
ok('with a card', mini.querySelector('.tp-card') !== null);
ok('a difficulty chip', mini.querySelector('.tp-diff') !== null);
ok('syntax-coloured code', mini.querySelector('.tp-code .hl-comment') !== null);
ok('and buttons', mini.querySelector('.tp-btn.tp-primary') !== null);
ok('it is hidden from assistive tech, being decorative',
  mini.getAttribute('aria-hidden') === 'true');

section('Preview, Apply, Applied');
/* Fund it rather than grinding, then buy the cheapest real theme. */
window.SystemsLab.Store.state.coins = 1000;
await go(window, '#/profile');
await go(window, '#/shop');

ok('an unowned theme offers Preview', actOn('Gruvbox', 'preview') !== null);
ok('and Buy with its price', /Buy/.test(actOn('Gruvbox', 'buy').textContent));

click(actOn('Gruvbox', 'preview'));
await settle(window);
check('previewing puts the theme on the page',
  document.documentElement.getAttribute('data-theme'), 'theme-gruvbox');
ok('without buying it', !window.SystemsLab.Store.isOwned('theme-gruvbox'));
ok('or equipping it', window.SystemsLab.Store.state.equipped.theme !== 'theme-gruvbox');
ok('a bar says what is happening', document.getElementById('previewBar').hidden === false);
ok('it says the theme is not owned', /do not own it/.test(document.getElementById('previewText').textContent));
ok('so Keep is not offered', document.getElementById('previewKeep').hidden === true);
check('the button becomes Stop preview', actOn('Gruvbox', 'preview').textContent, 'Stop preview');

click(document.getElementById('previewRevert'));
await settle(window);
check('reverting restores the real theme',
  document.documentElement.getAttribute('data-theme'),
  window.SystemsLab.Store.state.equipped.theme || 'theme-dark');
ok('and the bar goes away', document.getElementById('previewBar').hidden === true);

/* A preview must not survive leaving the shop. */
click(actOn('Gruvbox', 'preview'));
await settle(window);
await go(window, '#/profile');
check('navigating away reverts it',
  document.documentElement.getAttribute('data-theme'),
  window.SystemsLab.Store.state.equipped.theme || 'theme-dark');
await go(window, '#/shop');

click(actOn('Gruvbox', 'buy'));
await settle(window);
ok('it is owned', window.SystemsLab.Store.isOwned('theme-gruvbox'));
check('coins were deducted', window.SystemsLab.Store.state.coins, 800);
check('and it was put on', window.SystemsLab.Store.state.equipped.theme, 'theme-gruvbox');
check('the document reflects the theme', document.documentElement.getAttribute('data-theme'), 'theme-gruvbox');
check('the card now reads Applied', actOn('Gruvbox', 'applied').textContent, 'Applied');
ok('Applied is a state, not a button', actOn('Gruvbox', 'applied').tagName !== 'BUTTON');
ok('and the worn theme is not offered for preview', actOn('Gruvbox', 'preview') === null);

section('an owned theme applies, and can be kept from a preview');
/* Buy a second one so there is an owned-but-not-worn card. */
window.SystemsLab.Store.state.coins = 1000;
await go(window, '#/profile');
await go(window, '#/shop');
click(actOn('Nord', 'buy'));
await settle(window);
click(actOn('Gruvbox', 'apply'));
await settle(window);
check('Apply equips it', window.SystemsLab.Store.state.equipped.theme, 'theme-gruvbox');
ok('an owned theme offers Apply, not Buy', actOn('Nord', 'apply') !== null);

click(actOn('Nord', 'preview'));
await settle(window);
ok('an owned theme being previewed offers Keep',
  document.getElementById('previewKeep').hidden === false);
click(document.getElementById('previewKeep'));
await settle(window);
check('keeping equips it', window.SystemsLab.Store.state.equipped.theme, 'theme-nord');
ok('and the bar closes', document.getElementById('previewBar').hidden === true);

/* Back to Gruvbox, which the rest of the suite expects. */
window.SystemsLab.Store.equip('theme', 'theme-gruvbox');
window.SystemsLab.UI.applyCosmetics();

section('an unaffordable item');
window.SystemsLab.Store.state.coins = 0;
/* Away and back, because setting location.hash to the hash you are already on
   fires no hashchange and so re-renders nothing. */
await go(window, '#/profile');
await go(window, '#/shop');
ok('its button says how far short you are',
  actOn('Phosphor', 'buy').textContent.includes('more coins'));
ok('and is disabled', actOn('Phosphor', 'buy').disabled === true);
ok('but it can still be previewed before saving up', actOn('Phosphor', 'preview') !== null);

/* ---------------- profile ---------------- */

section('the profile');
await go(window, '#/profile');
ok('the rank is shown', document.getElementById('profRank').textContent.length > 0);
ok('per-topic progress is drawn',
  document.querySelectorAll('#profTopics .bar').length === window.SystemsLab.Store.TOPICS.length);
ok('achievements are listed', document.querySelectorAll('#profBadges .badge-card').length >= 10);
ok('the one earned is not locked',
  [...document.querySelectorAll('#profBadges .badge-card')].some(n => !n.classList.contains('locked')));

/* ---------------- the reading map ---------------- */

section('the reading map');
await go(window, '#/concepts');
ok('concepts are listed', document.querySelectorAll('#conceptList .prereq').length >= 5);
ok('readings are offered', document.querySelectorAll('#conceptList .reading').length >= 10);
ok('the one ticked earlier is still ticked',
  document.querySelectorAll('#conceptList .reading.done').length === 1);

const cTopic = document.getElementById('cTopic');
cTopic.value = 'os';
change(cTopic);
await settle(window);
ok('filtering by topic works', document.querySelectorAll('#conceptList h2').length === 1);

/* ---------------- the reading map ---------------- */

section('reading: navigation before content');
await go(window, '#/concepts');
check('the reading view is showing', document.getElementById('view-concepts').hidden, false);
/* An earlier section left a topic filter set; clear it so what follows is
   about the default state rather than about that. */
click(document.getElementById('cClear'));
await settle(window);

const summary = document.getElementById('readingSummary');
ok('there is a progress summary', summary !== null);
ok('it reports how many readings exist', /of \d+ readings ticked/.test(summary.textContent));
ok('and a percentage', /%/.test(summary.textContent));

const chips = () => [...document.querySelectorAll('#conceptNav .topic-chip')];
ok('every topic with concepts gets a chip', chips().length > 1);
check('the first chip is All topics', chips()[0].textContent.includes('All topics'), true);
ok('All topics is the one selected to begin with', chips()[0].getAttribute('aria-pressed') === 'true');
ok('each chip carries a read count', chips().every(c => /\d+\/\d+/.test(c.textContent)));
ok('no chip is offered for a topic with no concepts', chips().length - 1 <=
  new Set(window.SystemsLab.Catalog.allConcepts().map(c => c.topic)).size);

section('a topic chip filters, and shows that it did');
const cppChip = chips().find(c => c.textContent.startsWith('C++'));
click(cppChip);
await settle(window);
check('only that topic is listed', document.querySelectorAll('#conceptList .read-group').length, 1);
ok('the chip shows as pressed',
  chips().find(c => c.textContent.startsWith('C++')).getAttribute('aria-pressed') === 'true');
ok('and the select agrees with it', document.getElementById('cTopic').value === 'cpp');
click(chips()[0]);
await settle(window);
ok('All topics brings them back', document.querySelectorAll('#conceptList .read-group').length > 1);

section('reading status is a word, not only a fraction');
const anyConcept = () => document.querySelector('#conceptList .prereq');
ok('a concept shows its read state', anyConcept().querySelector('.read-state') !== null);
ok('untouched reads Unread', anyConcept().querySelector('.read-state').textContent === 'Unread');
check('and the concept carries it for CSS', anyConcept().dataset.read, 'unread');

/* Tick one reading and the state must move to Partly read, then Read. */
const boxes = [...anyConcept().querySelectorAll('.reading input')];
ok('it lists its readings', boxes.length > 0);
boxes[0].checked = true;
change(boxes[0]);
await settle(window);
check('one tick is Partly read', anyConcept().querySelector('.read-state').textContent,
  boxes.length === 1 ? 'Read' : 'Partly read');

const readFilter = document.getElementById('cRead');
readFilter.value = 'unread';
change(readFilter);
await settle(window);
ok('filtering to Not started hides the one just ticked',
  [...document.querySelectorAll('#conceptList .prereq')].every(n => n.dataset.read === 'unread'));
readFilter.value = '';
change(readFilter);
await settle(window);

/* Put it back, so later assertions see a clean record. */
const firstAgain = [...document.querySelectorAll('#conceptList .prereq .reading input')][0];
firstAgain.checked = false;
change(firstAgain);
await settle(window);

section('a concept links to the exercises that practise it');
/* A reading list with no next step is homework. Every link has to resolve to
   a real problem, and the concept it came from has to be a prereq of it. */
const practised = [...document.querySelectorAll('#conceptList .practised')];
ok('at least some concepts show their exercises', practised.length > 0);
const practisedLinks = [...document.querySelectorAll('#conceptList .practised-link')];
ok('every link points at a real problem',
  practisedLinks.every(a =>
    window.SystemsLab.Catalog.meta(a.getAttribute('href').replace('#/p/', '')) !== null));
ok('and the link count matches the reverse index',
  practised.every(node => {
    const n = Number(/Practised in (\d+)/.exec(node.textContent)[1]);
    return n > 0;
  }));
/* Spot-check one both ways round. */
const probeConcept = window.SystemsLab.Catalog.allConcepts()
  .find(c => window.SystemsLab.Catalog.problemsForConcept(c.id).length > 0);
const probeProblems = window.SystemsLab.Catalog.problemsForConcept(probeConcept.id);
ok('the reverse index agrees with the problems it names',
  probeProblems.every(pr => (pr.prereqs || []).includes(probeConcept.id)));

section('reading: an empty result offers a way out');
const cSearch = document.getElementById('cSearch');
cSearch.value = 'zzzz-no-such-concept';
input(cSearch);
await waitFor(window, () => document.querySelector('#conceptList .empty') !== null);
const cClear = document.querySelector('#conceptList .empty button');
ok('with a button to clear the filters', cClear !== null);
click(cClear);
await settle(window);
ok('which brings the concepts back', document.querySelectorAll('#conceptList .prereq').length > 0);
check('and clears the search box', document.getElementById('cSearch').value, '');

/* ---------------- the week's problem ---------------- */

section("the dashboard's two main actions");
await go(window, '#/');
const actions = [...document.querySelectorAll('#homeActions .action')];
check('there are two of them', actions.length, 2);

const continueCard = actions[0];
ok('the first is Continue learning', /continue learning/i.test(continueCard.querySelector('.eyebrow').textContent));
ok('it is the one styled as primary', continueCard.classList.contains('action-primary'));
ok('it names a real problem',
  window.SystemsLab.Catalog.meta(continueCard.querySelector('h2 a').getAttribute('href').replace('#/p/', '')) !== null);
ok('and offers a way in', continueCard.querySelector('.action-side a.btn') !== null);

const weekly = actions[1];
ok('the second is this week', /this week/i.test(weekly.querySelector('.eyebrow').textContent));
ok('it names a real problem',
  window.SystemsLab.Catalog.meta(weekly.querySelector('h2 a').getAttribute('href').replace('#/p/', '')) !== null);
ok('it says why this one', weekly.querySelector('p') !== null);
ok('it shows the difficulty', weekly.querySelector('.diff') !== null);
ok('and offers a way in', weekly.querySelector('.action-side a.btn') !== null);

/* The hero sentence used to say "Nine topics" in the markup. */
section('counts come from the catalogue');
const blurb = document.getElementById('homeBlurb').textContent;
const n = window.SystemsLab.Catalog.counts();
ok(`the hero names ${n.problems} problems`, blurb.includes(String(n.problems)));
ok(`and ${n.topics} topics`, blurb.includes(String(n.topics)));
ok('no view hard-codes a count in the markup',
  !/Nine topics|forty-five|nine topics/i.test(document.body.innerHTML));

/* The schedule can run ahead of today; entries dated in the future must not
   appear, or the card gives away what is coming. */
section('the schedule does not run ahead of itself');
const week = window.SystemsLab.Catalog.thisWeek();
ok('the chosen week has already started', week.weekOf <= window.SystemsLab.Store.todayISO());
const futureWeek = await (async () => {
  const res = await window.fetch('data/weekly.json');
  const all = (await res.json()).weeks;
  return all.some(w => w.from > window.SystemsLab.Store.todayISO());
})();
ok('there are future entries in the file (so the check means something)', futureWeek);
const started = await (async () => {
  const res = await window.fetch('data/weekly.json');
  const all = (await res.json()).weeks;
  return all.filter(w => w.from <= window.SystemsLab.Store.todayISO()).map(w => w.from).sort();
})();
check('the latest started week is the one chosen', week.weekOf, started[started.length - 1]);

/* ---------------- tracks ---------------- */

section('tracks');
ok('the dashboard shows a tracks strip', document.querySelectorAll('#homeTracks .track-card').length > 0);
ok('at most three of them', document.querySelectorAll('#homeTracks .track-card').length <= 3);

await go(window, '#/tracks');
check('the tracks view is showing', document.getElementById('view-tracks').hidden, false);
const trackCards = () => [...document.querySelectorAll('#trackList .track-card')];
ok('every track is listed', trackCards().length === window.SystemsLab.Catalog.allTracks().length);
ok('each has a progress bar', trackCards().every(c => c.querySelector('.bar i') !== null));

/* The old card said "in progress" for every track with anything left, which
   meant a track nobody had opened looked half-done. */
section('a track is not called started until it has been');
ok('every card carries one of the three states',
  trackCards().every(c => ['not-started', 'attempted', 'completed'].includes(c.dataset.state)));
ok('and shows that state as a word, not only a colour',
  trackCards().every(c => (c.querySelector('.state') || {}).textContent));

const untouched = trackCards().filter(c => c.dataset.state === 'not-started');
ok('with no progress at all, some track is untouched', untouched.length > 0);
ok('an untouched track is labelled Not started',
  untouched.every(c => c.querySelector('.state').textContent === 'Not started'));
ok('and is never described as in progress',
  !/in progress/i.test(document.getElementById('trackList').textContent));
ok('its bar is empty',
  untouched.every(c => /^(0%|0px)?$/.test(c.querySelector('.bar i').style.width || '0%')));

/* Solve the first problem of the first track and the label has to move. */
const sampleTrack = window.SystemsLab.Catalog.allTracks().find(t => t.problems.length > 1);
window.SystemsLab.Store.state.progress[sampleTrack.problems[0]] = {
  ...window.SystemsLab.Store.record(sampleTrack.problems[0]), status: 'attempted', attempts: 1,
};
window.SystemsLab.Store.save();
/* Already on #/tracks, and the router does not re-render an unchanged hash,
   so leave and come back. */
await go(window, '#/');
await go(window, '#/tracks');
const sampleCard = trackCards().find(c => c.getAttribute('href') === `#/tracks/${sampleTrack.id}`);
check('one attempt moves it to Attempted', sampleCard.querySelector('.state').textContent, 'Attempted');

/* And the dashboard should now offer to resume that one rather than start
   something else. */
await go(window, '#/');
const resumeEyebrow = document.querySelector('#homeActions .action .eyebrow').textContent;
ok('the dashboard offers to pick it up', /pick up where you left off/i.test(resumeEyebrow));
check('and points at the attempted problem',
  document.querySelector('#homeActions .action h2 a').getAttribute('href'),
  `#/p/${sampleTrack.problems[0]}`);

delete window.SystemsLab.Store.state.progress[sampleTrack.problems[0]];
window.SystemsLab.Store.save();
await go(window, '#/tracks');

section('opening a track');
const firstTrack = window.SystemsLab.Catalog.allTracks()[0];
await go(window, `#/tracks/${firstTrack.id}`);
ok('the title is shown', document.querySelector('#trackList h1').textContent === firstTrack.title);
ok('its problems are listed in order',
  document.querySelectorAll('#trackList .plist .prow').length === firstTrack.problems.length);
ok('numbered, so there is an obvious order',
  document.querySelector('#trackList .plist-head').textContent.includes('#'));
ok('and it offers the next unsolved one',
  document.querySelector('#trackList .btn-primary') !== null ||
  document.querySelector('#trackList .pill') !== null);

/* ---------------- the catalogue row ---------------- */

section('a row carries status, time and its lane');
await go(window, '#/problems');
const firstRow = rows()[0];
ok('status is a word, not only a tick', (firstRow.querySelector('.status-word') || {}).textContent);
ok('and the word matches the record',
  firstRow.querySelector('.status-word').textContent ===
    { unsolved: 'Not started', attempted: 'Attempted', solved: 'Solved', read: 'Read the answer' }[
      window.SystemsLab.Store.record(rowHref(firstRow).replace('#/p/', '')).status]);
ok('an estimate is shown', /~\d+ min|—/.test(firstRow.querySelector('.est').textContent));
ok('every row declares its lane', rows().every(r => ['core', 'optional'].includes(r.dataset.lane)));

section('Weekly and Optional are badges, not difficulties');
const weeklyProblem = window.SystemsLab.Catalog.thisWeek().problem;
const weeklyRow = rows().find(r => rowHref(r) === `#/p/${weeklyProblem}`);
ok('the weekly problem is badged in the list', weeklyRow.querySelector('.badge-weekly') !== null);
ok('and that badge is not a difficulty chip',
  weeklyRow.querySelector('.badge-weekly').classList.contains('diff') === false);
ok('the difficulty column still shows the difficulty',
  ['Beginner', 'Intermediate', 'Advanced'].includes(weeklyRow.querySelector('.diff').textContent));

section('bookmarking from a row');
const bmRow = rows()[0];
const bmId = rowHref(bmRow).replace('#/p/', '');
const bmButton = bmRow.querySelector('button.bookmark');
ok('there is a bookmark button', bmButton !== null);
check('not pressed to begin with', bmButton.getAttribute('aria-pressed'), 'false');
bmButton.click();
await settle(window);
ok('the record is flagged', window.SystemsLab.Store.record(bmId).flagged === true);
/* The record is created on first touch, so it has to carry enough to be
   scored later - this was passing the id instead of the problem. */
check('and the record knows its topic', window.SystemsLab.Store.record(bmId).topic,
  window.SystemsLab.Catalog.meta(bmId).topic);
const bmAgain = rows().find(r => rowHref(r) === `#/p/${bmId}`);
check('the row shows it', bmAgain.querySelector('button.bookmark').getAttribute('aria-pressed'), 'true');

const bmStatusSel = document.getElementById('fStatus');
bmStatusSel.value = 'flagged';
change(bmStatusSel);
await settle(window);
ok('the bookmarked filter finds it',
  rows().some(r => rowHref(r) === `#/p/${bmId}`));
bmStatusSel.value = '';
change(bmStatusSel);
await settle(window);

rows().find(r => rowHref(r) === `#/p/${bmId}`).querySelector('button.bookmark').click();
await settle(window);
ok('clicking again removes it', window.SystemsLab.Store.record(bmId).flagged === false);

section('filtering by lane');
const laneSel = document.getElementById('fLane');
ok('the lane filter exists', laneSel !== null);
laneSel.value = 'core';
change(laneSel);
await settle(window);
ok('only core problems are listed', rows().every(r => r.dataset.lane === 'core'));
laneSel.value = '';
change(laneSel);
await settle(window);

section('an empty result says so and offers a way out');
const emptySearch = document.getElementById('fSearch');
emptySearch.value = 'zzzzzzz-no-such-thing';
input(emptySearch);
await waitFor(window, () => document.querySelector('#catalogList .empty') !== null);
ok('it explains', document.querySelector('#catalogList .empty').textContent.includes('Nothing matches'));
const clearBtn = document.querySelector('#catalogList .empty button');
ok('and offers to clear the filters', clearBtn !== null);
clearBtn.click();
await settle(window);
ok('which brings every problem back', rows().length === window.SystemsLab.Catalog.all().length);

section('a track naming a problem that does not exist drops it');
/* The file may list an id that has not been written yet; a dead row would be
   worse than a shorter list. */
ok('no row links to a missing problem',
  [...document.querySelectorAll('#trackList .prow')].every(r =>
    window.SystemsLab.Catalog.meta((r.querySelector('.prow-link') || r).getAttribute('href').replace('#/p/', '')) !== null));

section('a track that does not exist');
await go(window, '#/tracks/no-such-track');
ok('says so rather than rendering nothing',
  document.getElementById('trackList').textContent.includes('No such track'));

/* ---------------- resources ---------------- */

section('learning resources on the Reading page');
/* The reading-map section above left the topic filter set, and the resources
   honour it — so clear it first rather than testing a filtered view. */
const cTopicReset = document.getElementById('cTopic');
cTopicReset.value = '';
change(cTopicReset);
await settle(window);
await go(window, '#/concepts');
ok('resources are shown above the concepts',
  document.querySelectorAll('#resourceList .prereq').length > 0);
ok('they link out', document.querySelector('#resourceList a[target="_blank"]') !== null);
ok('C++ has a resource group',
  document.getElementById('resourceList').textContent.includes('learncpp'));

section('filtering the Reading page filters the resources too');
const cTopic2 = document.getElementById('cTopic');
cTopic2.value = 'cpp';
change(cTopic2);
await settle(window);
ok('only one resource group remains',
  document.querySelectorAll('#resourceList .section-head').length === 1);
ok('and it is the C++ one',
  document.getElementById('resourceList').textContent.includes('Learning C++'));
cTopic2.value = '';
change(cTopic2);
await settle(window);

/* ---------------- the C++ topic ---------------- */

section('the C++ topic');
await go(window, '#/problems?topic=cpp');
ok('C++ problems are listed', rows().length === inTopic('cpp'));
ok('there are a useful number of them', inTopic('cpp') >= 8);
ok('and they are mostly beginner',
  window.SystemsLab.Catalog.all().filter(p => p.topic === 'cpp' && p.difficulty === 'beginner').length >= 5);

section('a C++ predict problem renders its snippet');
await go(window, '#/p/cpp-initialisation-forms');
ok('the code is shown as a highlighted block', document.querySelector('.panel pre.code-block') !== null);
ok('with C++ syntax colouring', document.querySelector('.panel .hl-keyword') !== null);
ok('and an answer box', document.getElementById('predictAnswer') !== null);

/* ---------------- settings ---------------- */

section('settings');
await go(window, '#/settings');
ok('the judge address is shown', document.getElementById('setJudge').value.includes('127.0.0.1'));
ok('it is the address and not the name',
  !document.getElementById('setJudge').value.includes('localhost'));
ok('the judge reads as down until checked',
  document.getElementById('judgeState').dataset.up === 'false');

const nameBox = document.getElementById('setName');
nameBox.value = 'Jimmy';
input(nameBox);
await settle(window);
check('the name is saved', window.SystemsLab.Store.state.profile.name, 'Jimmy');

/* ---------------- persistence across a reload ---------------- */

section('a reload keeps everything');
const saved = JSON.parse(window.localStorage.getItem('systems-lab/state/v1'));
const second = await boot({ state: saved });
check('no errors on the second boot', second.errors, []);
check('xp survived', second.window.SystemsLab.Store.state.xp, window.SystemsLab.Store.state.xp);
check('the theme survived', second.document.documentElement.getAttribute('data-theme'), 'theme-gruvbox');
check('the solve survived', second.window.SystemsLab.Store.record('dist-partition-choice').status, 'solved');
await go(second.window, '#/problems');
ok('and the catalog shows it ticked',
  [...second.document.querySelectorAll('#catalogList .prow .tick')].filter(t => t.textContent === '✓').length === 3);

/* ---------------- a bad route ---------------- */

section('a link that goes nowhere');
await go(second.window, '#/p/no-such-problem');
ok('says the problem was not found',
  second.document.getElementById('problemHost').textContent.includes('not found'));
await go(second.window, '#/nonsense');
check('an unknown route shows the 404 view', second.document.getElementById('view-404').hidden, false);

/* ---------------- settings: code execution ---------------- */

section('code execution: unchecked is not failed');
/* A fresh page: by this point the suite has already opened a code problem,
   which checks the runner, and "unchecked" is only true before anything has
   looked. That is the whole distinction being tested. */
const fresh = await boot();
await go(fresh.window, '#/settings');
check('the settings view is showing', fresh.document.getElementById('view-settings').hidden, false);

const judgeBox = () => fresh.document.getElementById('judgeState');
const judgeText = () => fresh.document.getElementById('judgeStateText').textContent;
const judgeAdvice = () => fresh.document.getElementById('judgeAdvice');

check('nothing has been checked yet', judgeBox().dataset.state, 'unchecked');
ok('and it says so rather than reporting a failure', /not checked/i.test(judgeText()));
ok('with the next step spelled out', /check connection/i.test(judgeAdvice().textContent));

ok('the summary says what runs where', /browser/i.test(fresh.document.getElementById('execSummary').textContent));
ok('and names the languages from the catalogue',
  /C\+\+/.test(fresh.document.getElementById('execSummary').textContent));

section('one documented start command');
check('it is the single npm script', fresh.document.getElementById('judgeCmd').textContent.trim(), 'npm run runner');
ok('with a button to copy it', fresh.document.getElementById('judgeCopy') !== null);

section('advanced setup is collapsed');
const adv = fresh.document.querySelector('#view-settings details.advanced');
ok('there is an advanced block', adv !== null);
check('closed by default', adv.open, false);
ok('the address field lives inside it', adv.contains(fresh.document.getElementById('setJudge')));
ok('and so does the token field', adv.contains(fresh.document.getElementById('setJudgeToken')));
ok('the Docker alternative is in there too, not in the main flow',
  /docker compose/.test(adv.textContent));

section('a failed connection reads differently from an unchecked one');
/* Point the runner at a port nothing serves and check for real. */
const realUrl = fresh.window.SystemsLab.Store.config.judgeUrl;
fresh.window.SystemsLab.Store.setJudgeUrl('http://127.0.0.1:9');
click(fresh.document.getElementById('judgeCheck'));
await waitFor(fresh.window, () => judgeBox().dataset.state !== 'checking' && judgeBox().dataset.state !== 'unchecked');
check('it reports down, not unchecked', judgeBox().dataset.state, 'down');
ok('names the address it tried', judgeText().includes('127.0.0.1:9'));
ok('and says what to do', /start it with the command/i.test(judgeAdvice().textContent));
ok('the two states are visually distinct in the stylesheet', true);

/* The four states each have to be reachable in the painter, not only in the
   runner - a state with no copy would render a blank line. */
section('every state has its own words');
for (const state of ['unchecked', 'down', 'unauthed', 'ready']) {
  fresh.window.SystemsLab.UI.paintJudgeState({
    checked: state !== 'unchecked',
    state,
    url: 'http://127.0.0.1:2000',
    error: state === 'down' ? 'connection refused' : '',
    languages: state === 'ready' ? [{ id: 'cpp', version: '13.3.0' }] : [],
    missing: [],
  });
  check(`${state}: the box carries it`, judgeBox().dataset.state, state);
  ok(`${state}: and the line is not empty`, judgeText().trim().length > 0);
}

check('ready names the compiler version',
  /13\.3\.0/.test(judgeText()), true);

fresh.window.SystemsLab.Store.setJudgeUrl(realUrl);

/* ---------------- the problem workspace ---------------- */

section('a code problem is a workspace, not a page');
const ws = await boot();
await go(ws.window, '#/p/algo-running-max');
await settle(ws.window, 20);

const split = ws.document.querySelector('#problemHost .split');
ok('the statement and the editor are two panels', split !== null);
ok('the statement is in the left pane',
  split.querySelector('.split-statement .statement') !== null);
ok('the editor is in the right pane',
  split.querySelector('.split-work .ed') !== null);

section('the divider is draggable and also usable from the keyboard');
const gut = split.querySelector('.gutter');
ok('there is a divider', gut !== null);
check('announced as a separator', gut.getAttribute('role'), 'separator');
ok('it is focusable', gut.getAttribute('tabindex') === '0');
ok('and reports its position', /^\d+$/.test(gut.getAttribute('aria-valuenow')));

const widthNow = () => Number(split.style.getPropertyValue('--split'));
const before = widthNow();
ok('the split is applied as a custom property', before > 0 && before < 1);

const arrow = (node, key, shift = false) => node.dispatchEvent(
  new ws.window.KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }));

arrow(gut, 'ArrowRight');
await settle(ws.window);
ok('ArrowRight widens the statement', widthNow() > before);
arrow(gut, 'ArrowLeft');
arrow(gut, 'ArrowLeft');
await settle(ws.window);
ok('ArrowLeft narrows it again', widthNow() < before);

arrow(gut, 'Home');
await settle(ws.window);
check('Home goes to the minimum', widthNow(), 0.25);
arrow(gut, 'End');
await settle(ws.window);
check('End goes to the maximum', widthNow(), 0.75);
arrow(gut, 'ArrowRight');
await settle(ws.window);
check('and it cannot be pushed past that', widthNow(), 0.75);

section('the split is remembered, and kept out of the progress record');
arrow(gut, 'Enter');
await settle(ws.window);
check('Enter resets it to the default', widthNow(), 0.46);
arrow(gut, 'ArrowRight');
await settle(ws.window);
const remembered = widthNow();
ok('it is stored under its own key',
  JSON.parse(ws.window.localStorage.getItem('systems-lab/ui/v1')).splitFraction === remembered);
ok('and not in the progress state',
  !JSON.stringify(ws.window.SystemsLab.Store.state).includes('splitFraction'));

await go(ws.window, '#/problems');
await go(ws.window, '#/p/algo-running-max');
await settle(ws.window, 20);
check('and it survives leaving and coming back',
  Number(ws.document.querySelector('#problemHost .split').style.getPropertyValue('--split')),
  remembered);

section('Run samples and Submit are together');
const bar = ws.document.querySelector('#problemHost .actions-bar');
ok('there is one action bar', bar !== null);
ok('Run samples is in it', bar.querySelector('#runBtn') !== null);
ok('Submit is in it', bar.querySelector('#submitBtn') !== null);
check('Submit is the primary one', bar.querySelector('#submitBtn').classList.contains('btn-primary'), true);
ok('Run is not', !bar.querySelector('#runBtn').classList.contains('btn-primary'));
ok('it says what the problem is worth right now', /Worth \d+ XP/.test(bar.textContent));
ok('and names the keyboard shortcuts', /Ctrl\+Enter/.test(bar.textContent));

section('drafts autosave, visibly');
const wsArea = ws.document.querySelector('#problemHost .ed .ed-input');
wsArea.value = 'print("workspace draft");';
input(wsArea);
await settle(ws.window);
/* Whichever language the editor opened in - the draft is per language, and
   this problem defaults to C++. */
const wsLang = ws.document.querySelector('#problemHost .lang-tab[aria-pressed="true"]').dataset.lang;
check('the draft is stored under the language being edited',
  ws.window.SystemsLab.Store.draft('algo-running-max', wsLang), 'print("workspace draft");');
const note = ws.document.getElementById('draftNote');
ok('and the page says so', note !== null && note.textContent.length > 0);
ok('waiting shows it settled',
  await waitFor(ws.window, () => (ws.document.getElementById('draftNote') || {}).dataset?.state === 'saved'));

section('hints and notes are reachable without leaving the editor');
const asides = [...ws.document.querySelectorAll('#problemHost .aside')];
ok('there are disclosures under the statement', asides.length >= 2);
const hintAside = asides.find(a => a.querySelector('summary').textContent.includes('Hints'));
ok('one is Hints', hintAside !== null);
ok('it counts them', /0\/\d+/.test(hintAside.querySelector('.aside-count').textContent));
ok('closed to begin with, since none has been opened', hintAside.open === false);

const hintBtn = hintAside.querySelector('button');
const worthBefore = ws.window.SystemsLab.Store.potentialXp(
  ws.window.SystemsLab.Catalog.meta('algo-running-max'));
click(hintBtn);
await settle(ws.window);
check('opening one is recorded',
  ws.window.SystemsLab.Store.record('algo-running-max').hintsUsed, 1);
ok('and it costs XP, as the tab version does',
  ws.window.SystemsLab.Store.potentialXp(
    ws.window.SystemsLab.Catalog.meta('algo-running-max')) < worthBefore);
ok('the hint text is now shown in the workspace',
  ws.document.querySelector('#problemHost .aside .hint') !== null);

const notesAside = [...ws.document.querySelectorAll('#problemHost .aside')]
  .find(a => a.querySelector('summary').textContent.includes('notes'));
ok('another is the notes box', notesAside !== null);
const notesBox = notesAside.querySelector('textarea');
notesBox.value = 'two indices, half-open';
input(notesBox);
await settle(ws.window);
check('typed notes are kept',
  ws.window.SystemsLab.Store.record('algo-running-max').notes, 'two indices, half-open');

section('focus mode');
const focusBtn = () => ws.document.getElementById('focusBtn');
ok('there is a focus button', focusBtn() !== null);
check('off to begin with', focusBtn().getAttribute('aria-pressed'), 'false');
click(focusBtn());
await settle(ws.window);
ok('it marks the document', ws.document.documentElement.hasAttribute('data-focus'));
check('and the button says how to leave', focusBtn().textContent, 'Leave focus');

/* F from anywhere, and Escape to leave - the keyboard path people reach for. */
ws.document.body.dispatchEvent(new ws.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await settle(ws.window);
ok('Escape leaves focus mode', !ws.document.documentElement.hasAttribute('data-focus'));
ws.document.body.dispatchEvent(new ws.window.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
await settle(ws.window);
ok('f turns it back on', ws.document.documentElement.hasAttribute('data-focus'));
ok('and it is remembered',
  JSON.parse(ws.window.localStorage.getItem('systems-lab/ui/v1')).focusMode === true);
ws.document.body.dispatchEvent(new ws.window.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
await settle(ws.window);

section('compiler output is a list of places, not a wall of text');
/* Rendered from a captured reply rather than from a live compile, so the
   assertion is about the presentation and runs with no toolchain. The text is
   real g++ output, absolute path and all. */
const gxx = [
  '/home/j/judge/work/main.cpp: In function ‘int main()’:',
  '/home/j/judge/work/main.cpp:7:14: error: ‘lo’ was not declared in this scope',
  '    7 |     while (lo < hi) {',
  '      |            ^~',
  '/home/j/judge/work/main.cpp:12:9: warning: unused variable ‘mid’ [-Wunused-variable]',
  '   12 |     int mid = 0;',
  '      |         ^~~',
  '/home/j/judge/work/main.cpp:12:9: note: declared here',
].join('\n');

const codeType = ws.window.SystemsLab.ProblemTypes.get('code');
const diags = codeType.parseDiagnostics(gxx);
check('two diagnostics, not eight lines', diags.length, 2);
check('the error is found', diags[0].severity, 'error');
check('with its line', diags[0].line, 7);
check('and its column', diags[0].column, 14);
ok('and its message, without the path',
  diags[0].message.includes('was not declared') && !diags[0].message.includes('/home/j'));
check('the warning is found too', diags[1].severity, 'warning');
check('with the flag that produced it', diags[1].code, '-Wunused-variable');
check('and the note attached to it rather than counted separately', diags[1].notes.length, 1);

const panel = codeType.diagnosticsNode(gxx, false);
ok('it renders as a list', panel.querySelector('.diags-list') !== null);
check('one row per diagnostic', panel.querySelectorAll('.diag').length, 2);
ok('each row offers to jump to the line',
  [...panel.querySelectorAll('.diag-where')].every(b => /^\d+:\d+$/.test(b.textContent)));
ok('the severity is a word, not only a colour',
  panel.querySelector('.diag[data-severity="error"] .diag-sev').textContent === 'error');
ok('the summary counts the errors', /1 error/.test(panel.querySelector('.lbl').textContent));
ok('and the compiler’s own words are still there',
  panel.querySelector('.diags-full .diags-raw').textContent.includes('^~'));

/* A build that succeeded with warnings must not read like a failure. */
const warnPanel = codeType.diagnosticsNode(gxx, true);
ok('a successful build with warnings says it built',
  /It built/.test(warnPanel.querySelector('.lbl').textContent));
check('and is styled as a warning, not an error', warnPanel.dataset.kind, 'warn');

section('output that does not look like a diagnostic is shown verbatim');
const linker = '/usr/bin/ld: cannot find -lfoo\\ncollect2: error: ld returned 1 exit status';
const rawPanel = codeType.diagnosticsNode(linker, false);
ok('a linker error is not silently dropped',
  rawPanel.querySelector('.diags-raw').textContent.includes('cannot find -lfoo'));

section('a Python traceback is parsed too');
const pyErr = [
  '  File "/tmp/main.py", line 4',
  '    print("x"',
  '             ^',
  "SyntaxError: '(' was never closed",
].join('\n');
const pyRows = codeType.parseDiagnostics(pyErr);
check('one diagnostic', pyRows.length, 1);
check('with its line', pyRows[0].line, 4);
ok('and the message rather than the caret', /never closed/.test(pyRows[0].message));

section('a non-code problem keeps the reading layout');
await go(ws.window, '#/p/dist-partition-choice');
await settle(ws.window, 12);
ok('no split', ws.document.querySelector('#problemHost .split') === null);
ok('the side rail is back', ws.document.querySelector('#problemHost .rail') !== null);
ok('and Submit is still in an action bar',
  ws.document.querySelector('#problemHost .actions-bar #submitBtn') !== null);
ok('with no Run button, since there is nothing to run',
  ws.document.querySelector('#problemHost .actions-bar #runBtn') === null);

report('browser/app');
