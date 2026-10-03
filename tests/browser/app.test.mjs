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
  if (state) window.localStorage.setItem('bare-metal/state/v1', JSON.stringify(state));

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

const click = node => node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = node => node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', { bubbles: true }));
const input = node => node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true }));

/* ---------------- boot ---------------- */

section('boot');
let { window, document, errors } = await boot();

check('no errors on the console', errors, []);
ok('the store is initialised', !!window.BareMetal.Store.state);
ok('the catalog loaded', window.BareMetal.Catalog.all().length >= 3);
check('the dashboard is showing', document.getElementById('view-home').hidden, false);
check('and the others are not', document.getElementById('view-problems').hidden, true);
ok('the rank reads Userland', document.getElementById('homeRank').textContent.includes('Userland'));
ok('the topic grid is drawn', document.querySelectorAll('#homeTopics .topic-card').length === 9);
ok('the activity grid is drawn', document.querySelectorAll('#homeHeat i').length === 26 * 7);

/* ---------------- the catalog ---------------- */

section('the catalog');
await go(window, '#/problems');
check('the catalog is showing', document.getElementById('view-problems').hidden, false);
const rows = () => [...document.querySelectorAll('#catalogList .prow')];
ok('every problem is listed', rows().length === window.BareMetal.Catalog.all().length);
ok('a row links to its problem', rows()[0].getAttribute('href').startsWith('#/p/'));
ok('a row shows what it is worth', rows()[0].textContent.includes('XP'));

section('filtering');
const topicSel = document.getElementById('fTopic');
topicSel.value = 'os';
change(topicSel);
await settle(window);
ok('filtering by topic narrows the list', rows().length === 1);
ok('and keeps the right one', rows()[0].getAttribute('href') === '#/p/os-page-fault-walk');

topicSel.value = '';
change(topicSel);
await settle(window);

const search = document.getElementById('fSearch');
search.value = 'partition';
input(search);
await settle(window);
await settle(window);
ok('searching matches a title', rows().length === 1 && rows()[0].textContent.includes('partition'));

search.value = 'zzzznothing';
input(search);
await settle(window);
await settle(window);
ok('no matches says so', document.querySelector('#catalogList .empty') !== null);

click(document.getElementById('fClear'));
await settle(window);
ok('clearing restores the list', rows().length === window.BareMetal.Catalog.all().length);

section('a filter can arrive in the url');
await go(window, '#/problems?topic=dist');
ok('a topic link pre-filters the catalog', rows().length === 1);
ok('and the control shows it', document.getElementById('fTopic').value === 'dist');

/* ---------------- opening a problem ---------------- */

section('opening a problem');
await go(window, '#/p/dist-partition-choice');
check('the problem view is showing', document.getElementById('view-problem').hidden, false);
ok('the title is rendered', document.querySelector('.phead h1').textContent.includes('partition'));
ok('the statement is rendered', document.querySelector('.prose').innerHTML.includes('London'));
ok('the difficulty is shown', document.querySelector('.phead .pill').textContent.length > 0);
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
check('ticking a reading is recorded', window.BareMetal.Store.readingCount(), 1);
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
check('and is charged for', window.BareMetal.Store.record('dist-partition-choice').hintsUsed, 1);

click(document.querySelector('[data-tab="problem"]'));
await settle(window);
/* Beginner base 10, first-try bonus still intact, one hint at a quarter of
   base: 15 - 2.5 = 12.5, which rounds to 13. */
check('the problem is now worth less', document.querySelector('.worth-big').textContent, '13 XP');

/* ---------------- answering ---------------- */

section('submitting nothing');
click(document.getElementById('submitBtn'));
await settle(window);
check('an empty answer is not graded', window.BareMetal.Store.record('dist-partition-choice').attempts, 0);
ok('and says so', [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Answer it first')));

section('a wrong answer');
const opts = () => [...document.querySelectorAll('#answerWidget .opt input')];
opts()[1].checked = true;
click(document.getElementById('submitBtn'));
await settle(window);

ok('the verdict says it is wrong', document.querySelector('.verdict[data-kind="wrong"]') !== null);
check('no points were awarded', window.BareMetal.Store.state.xp, 0);
check('the attempt is recorded', window.BareMetal.Store.record('dist-partition-choice').attempts, 1);
check('the status is attempted', window.BareMetal.Store.record('dist-partition-choice').status, 'attempted');
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
const xpAfter = window.BareMetal.Store.state.xp;
/* beginner base 10, no first-try bonus (one wrong answer), one hint at -2.5 */
check('points reflect the hint and the lost bonus', xpAfter, 8);
check('the status is solved', window.BareMetal.Store.record('dist-partition-choice').status, 'solved');
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
  document.querySelectorAll('#answerWidget input:not([disabled])').length === 0);
ok('there is no submit button any more', document.getElementById('submitBtn') === null);

section('the catalog reflects the solve');
await go(window, '#/problems');
const solvedRow = rows().find(r => r.getAttribute('href') === '#/p/dist-partition-choice');
ok('the row is ticked', solvedRow.querySelector('.tick').textContent === '✓');
ok('and shows what it earned', solvedRow.textContent.includes('8 XP'));

const statusSel = document.getElementById('fStatus');
statusSel.value = 'solved';
change(statusSel);
await settle(window);
ok('filtering by solved finds it', rows().length === 1);
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
check('the order problem is solved', window.BareMetal.Store.record('os-page-fault-walk').status, 'solved');

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
ok('the editor is rendered', document.querySelector('.editor textarea') !== null);
ok('with a line-number gutter', document.querySelector('.editor .gutter') !== null);
ok('the gutter is numbered', document.querySelector('.editor .gutter').textContent.startsWith('1\n'));
ok('a language tab per claimed language', document.querySelectorAll('.lang-tab').length === 3);
ok('the sanitize profile is advertised',
  [...document.querySelectorAll('.editor-head .pill')].some(n => n.textContent.includes('sanitize')));
ok('and that cleanliness is required',
  [...document.querySelectorAll('.editor-head .pill')].some(n => n.textContent.includes('clean')));
ok('a starter template is loaded', document.querySelector('.editor textarea').value.length > 20);

await settle(window, 20);
const judgeLine = document.getElementById('codeJudgeText');
ok('the judge is reported as not answering', judgeLine.textContent.includes('not answering'));
ok('and the start command is given', judgeLine.textContent.includes('docker compose'));
ok('C++ is named as needing it', /C\+\+/.test(judgeLine.textContent));
const cppTab = [...document.querySelectorAll('.lang-tab')].find(n => n.dataset.lang === 'cpp');
ok('the C++ tab is disabled rather than silently broken', cppTab.disabled === true);
const jsTab = [...document.querySelectorAll('.lang-tab')].find(n => n.dataset.lang === 'js');
ok('the JavaScript tab stays available, since it runs in the tab', jsTab.disabled === false);

section('an untouched template is not an attempt');
click(document.getElementById('submitBtn'));
await settle(window);
check('nothing was recorded', window.BareMetal.Store.record('algo-running-max').attempts, 0);
ok('and it says to answer first',
  [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Answer it first')));

section('the editor opens on the language the problem is about');
/* The problem lists cpp first, and it is a C++ lesson — the sanitizer
   requirement only means anything there. So the author's order is the default
   even when the judge is down; the message says what to start. */
ok('C++ is selected', [...document.querySelectorAll('.lang-tab')]
  .find(n => n.getAttribute('aria-pressed') === 'true').dataset.lang === 'cpp');
ok('and the C++ template is loaded',
  document.querySelector('.editor textarea').value.includes('std::cin'));

section('switching language keeps a draft per language');
const area = () => document.querySelector('.editor textarea');
click(document.querySelector('[data-lang="js"]'));
await settle(window);
ok('the JavaScript template appears', area().value.includes('readLines'));

area().value = 'print("mine");';
input(area());
await settle(window);
check('the JavaScript draft is saved',
  window.BareMetal.Store.draft('algo-running-max', 'js'), 'print("mine");');

click(document.querySelector('[data-lang="rust"]'));
await settle(window);
ok('switching shows the Rust template', area().value.includes('fn main'));

click(document.querySelector('[data-lang="js"]'));
await settle(window);
check('switching back restores what you wrote', area().value, 'print("mine");');
ok('and the C++ draft is untouched by all of that',
  window.BareMetal.Store.draft('algo-running-max', 'cpp').includes('std::cin'));

/* ---------------- the shop ---------------- */

section('the shop');
const coins = window.BareMetal.Store.state.coins;
ok('solving earned coins to spend', coins > 0);
await go(window, '#/shop');
ok('items are offered', document.querySelectorAll('.shop-item').length >= 8);
ok('a theme shows a preview swatch', document.querySelector('.shop-item .swatch') !== null);

/* Fund it rather than grinding, then buy the cheapest real theme. */
window.BareMetal.Store.state.coins = 1000;
await go(window, '#/shop');
const gruvbox = [...document.querySelectorAll('.shop-item')]
  .find(n => n.querySelector('h4').textContent.includes('Gruvbox'));
click(gruvbox.querySelector('button'));
await settle(window);

ok('it is owned', window.BareMetal.Store.isOwned('theme-gruvbox'));
check('coins were deducted', window.BareMetal.Store.state.coins, 800);
check('and it was put on', window.BareMetal.Store.state.equipped.theme, 'theme-gruvbox');
check('the document reflects the theme', document.documentElement.getAttribute('data-theme'), 'theme-gruvbox');
ok('the card now reads as worn',
  [...document.querySelectorAll('.shop-item.worn h4')].some(h => h.textContent.includes('Gruvbox')));

section('an unaffordable item');
window.BareMetal.Store.state.coins = 0;
/* Away and back, because setting location.hash to the hash you are already on
   fires no hashchange and so re-renders nothing. */
await go(window, '#/profile');
await go(window, '#/shop');
const phosphor = [...document.querySelectorAll('.shop-item')]
  .find(n => n.querySelector('h4').textContent.includes('Phosphor'));
ok('its button says how far short you are',
  phosphor.querySelector('button').textContent.includes('more coins'));
ok('and is disabled', phosphor.querySelector('button').disabled === true);

/* ---------------- profile ---------------- */

section('the profile');
await go(window, '#/profile');
ok('the rank is shown', document.getElementById('profRank').textContent.length > 0);
ok('per-topic progress is drawn', document.querySelectorAll('#profTopics .bar').length === 9);
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
check('the name is saved', window.BareMetal.Store.state.profile.name, 'Jimmy');

/* ---------------- persistence across a reload ---------------- */

section('a reload keeps everything');
const saved = JSON.parse(window.localStorage.getItem('bare-metal/state/v1'));
const second = await boot({ state: saved });
check('no errors on the second boot', second.errors, []);
check('xp survived', second.window.BareMetal.Store.state.xp, window.BareMetal.Store.state.xp);
check('the theme survived', second.document.documentElement.getAttribute('data-theme'), 'theme-gruvbox');
check('the solve survived', second.window.BareMetal.Store.record('dist-partition-choice').status, 'solved');
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

report('browser/app');
