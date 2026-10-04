/* The store: scoring, streaks, the shop, achievements and the export shape.
   Loaded into a vm sandbox with a memory localStorage and no network.

   Run: node tests/store.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab, sandbox } = loadScripts(['js/store.js']);
const Store = grab('Store');

await Store.init();

const P = (id, difficulty = 'intermediate', extra = {}) =>
  ({ id, topic: 'os', type: 'mcq', difficulty, hints: ['one', 'two'], ...extra });

const fresh = async () => { Store.reset(); };

/* ---------------- scoring ---------------- */

section('scoring — base rates');
await fresh();
check('beginner base',     Store.potentialXp(P('b', 'beginner')),     15);  /* 10 * 1.5 */
check('intermediate base', Store.potentialXp(P('i', 'intermediate')), 38);  /* 25 * 1.5 = 37.5 -> 38 */
check('advanced base',     Store.potentialXp(P('a', 'advanced')),     90);  /* 60 * 1.5 */

section('scoring — the first-try bonus');
await fresh();
let p = P('p1');
check('fresh problem includes the bonus', Store.potentialXp(p), 38);
Store.submit(p, { correct: false, score: 0 });
check('one wrong answer removes it',      Store.potentialXp(p), 25);
Store.submit(p, { correct: false, score: 0 });
check('a second wrong answer costs no more', Store.potentialXp(p), 25);
check('status is attempted',              Store.record('p1').status, 'attempted');
check('attempts counted',                 Store.record('p1').attempts, 2);

section('scoring — hints');
await fresh();
p = P('p2');
Store.openHint(p);
check('one hint off a first-try solve', Store.potentialXp(p), 31);  /* 37.5 - 6.25 */
Store.openHint(p);
check('two hints',                      Store.potentialXp(p), 25);  /* 37.5 - 12.5 */
Store.openHint(p);
check('a third hint does not exist, so nothing changes', Store.potentialXp(p), 25);
check('hintsUsed is capped at the number of hints', Store.record('p2').hintsUsed, 2);

section('scoring — awarding');
await fresh();
p = P('p3');
let out = Store.submit(p, { correct: true, score: 1 });
check('awards the potential',   out.xp, 38);
check('coins match the xp',     out.coins - out.streakBonus, 38);
check('xp banked',              Store.state.xp, 38);
check('status solved',          Store.record('p3').status, 'solved');
check('solve is dated',         Store.record('p3').solvedAt, Store.todayISO());

out = Store.submit(p, { correct: true, score: 1 });
check('re-solving pays nothing',   out.xp, 0);
check('re-solving is flagged',     out.alreadySolved, true);
check('xp did not move',           Store.state.xp, 38);

section('scoring — revealing the answer');
await fresh();
p = P('p4');
Store.reveal(p);
check('revealed is worth nothing',      Store.potentialXp(p), 0);
check('revealing marks it read',        Store.record('p4').status, 'read');
out = Store.submit(p, { correct: true, score: 1 });
check('a correct answer after revealing pays nothing', out.xp, 0);
check('and stays read rather than solved', Store.record('p4').status, 'read');
check('no xp banked',                   Store.state.xp, 0);

section('scoring — partial credit does not count as solved');
await fresh();
p = P('p5');
out = Store.submit(p, { correct: false, score: 0.5 });
check('no points for a partial answer', out.xp, 0);
check('best score is remembered',       Store.record('p5').bestScore, 0.5);
Store.submit(p, { correct: false, score: 0.2 });
check('a worse later answer does not lower it', Store.record('p5').bestScore, 0.5);

/* ---------------- streaks ---------------- */

section('streaks');
await fresh();
out = Store.submit(P('s1'), { correct: true, score: 1 });
check('first solve starts a streak',  Store.state.streak.current, 1);
ok('and pays a streak bonus',         out.streakBonus > 0);

out = Store.submit(P('s2'), { correct: true, score: 1 });
check('a second solve the same day does not extend it', Store.state.streak.current, 1);
check('and pays no second bonus',     out.streakBonus, 0);

/* Walk the clock by moving lastDay back, which is what a new day looks like
   to the store. */
Store.state.streak.lastDay = Store.addDays(Store.todayISO(), -1);
Store.submit(P('s3'), { correct: true, score: 1 });
check('solving the next day extends it', Store.state.streak.current, 2);

/* A nine-day run, three days ago. Real history would have recorded the
   longest as it went, so the fixture sets both. */
Store.state.streak.lastDay = Store.addDays(Store.todayISO(), -3);
Store.state.streak.current = 9;
Store.state.streak.longest = 9;
Store.submit(P('s4'), { correct: true, score: 1 });
check('a missed day resets it to 1',  Store.state.streak.current, 1);
check('but the longest is kept',      Store.state.streak.longest, 9);

section('streaks — a gap is noticed on load, not only on solving');
Store.state.streak.current = 5;
Store.state.streak.lastDay = Store.addDays(Store.todayISO(), -4);
Store.save();
await Store.init();
check('a stale streak is cleared at startup', Store.state.streak.current, 0);
check('the longest survives it',              Store.state.streak.longest, 9);

section('dates — day arithmetic is timezone-safe');
check('a day forward',       Store.addDays('2026-10-03', 1), '2026-10-04');
check('across a month end',  Store.addDays('2026-10-31', 1), '2026-11-01');
check('across a year end',   Store.addDays('2026-12-31', 1), '2027-01-01');
check('backwards over a year end', Store.addDays('2027-01-01', -1), '2026-12-31');
check('a leap day exists',   Store.addDays('2028-02-28', 1), '2028-02-29');
check('days between',        Store.daysBetween('2026-10-01', '2026-10-04'), 3);
check('days between, reversed', Store.daysBetween('2026-10-04', '2026-10-01'), -3);
check('today is a plain date string', /^\d{4}-\d{2}-\d{2}$/.test(Store.todayISO()), true);

/* ---------------- the shop ---------------- */

section('the shop');
await fresh();
check('starts with nothing to spend', Store.state.coins, 0);
let res = Store.buy('theme-gruvbox');
check('cannot buy what you cannot afford', res.ok, false);
check('and is told how short you are',     res.short, 200);

Store.state.coins = 250;
res = Store.buy('theme-gruvbox');
check('buying works when funded', res.ok, true);
check('coins are deducted',       Store.state.coins, 50);
check('the item is owned',        Store.isOwned('theme-gruvbox'), true);
check('and is put on at once',    Store.state.equipped.theme, 'theme-gruvbox');

check('buying it twice is refused', Store.buy('theme-gruvbox').ok, false);
check('coins are unchanged',        Store.state.coins, 50);
check('an unknown item is refused', Store.buy('theme-nonexistent').ok, false);

check('cannot wear what you do not own', Store.equip('theme-nord', 'theme-nord'), false);
check('can wear what you do own',        Store.equip('theme', 'theme-dark'), true);
check('spending never touches xp',       Store.state.xp, 0);

section('titles are earned, not bought');
await fresh();
check('no titles at the start',        Store.earnedTitles().length, 0);
check('cannot wear an unearned title', Store.equip('title', 'Bug Hunter'), false);
check('title stays empty',             Store.state.equipped.title, '');

/* ---------------- achievements ---------------- */

section('achievements');
await fresh();
out = Store.submit(P('a1'), { correct: true, score: 1 });
check('first solve unlocks First Blood',
  out.newAchievements.map(a => a.id), ['first-blood']);

await fresh();
for (let i = 0; i < 5; i += 1) {
  Store.submit(P(`loc${i}`, 'beginner', { type: 'locate' }), { correct: true, score: 1 });
}
ok('five located bugs unlocks Bug Hunter', Store.state.achievements.includes('bug-hunter'));
ok('and grants its title',                 Store.earnedTitles().includes('Bug Hunter'));
check('which can then be worn',            Store.equip('title', 'Bug Hunter'), true);

await fresh();
for (let i = 0; i < 5; i += 1) {
  Store.submit(P(`adv${i}`, 'advanced'), { correct: true, score: 1 });
}
ok('five advanced solves unlocks Deep End', Store.state.achievements.includes('advanced-5'));

await fresh();
for (const t of Store.TOPICS) {
  Store.submit({ id: `t-${t.id}`, topic: t.id, difficulty: 'beginner', type: 'mcq' },
    { correct: true, score: 1 });
}
ok('one in every topic unlocks Broad Church', Store.state.achievements.includes('topic-all'));

section('achievements — only a real solve counts');
await fresh();
p = P('r1');
Store.reveal(p);
Store.submit(p, { correct: true, score: 1 });
check('reading the answer unlocks nothing', Store.state.achievements.length, 0);

/* ---------------- readings ---------------- */

section('readings');
await fresh();
Store.markReading('virtual-memory', 0);
Store.markReading('virtual-memory', 1);
check('two readings ticked',   Store.readingCount(), 2);
check('and each is remembered', [Store.hasRead('virtual-memory', 0), Store.hasRead('virtual-memory', 1)], [true, true]);
Store.markReading('virtual-memory', 0, false);
check('un-ticking works',      Store.readingCount(), 1);
check('ticking the same one twice does not double-count',
  (Store.markReading('virtual-memory', 1), Store.readingCount()), 1);

/* ---------------- ranks ---------------- */

section('ranks');
await fresh();
check('start at Userland',        Store.rankFor(0).label, 'Userland');
check('99 is still Userland',     Store.rankFor(99).label, 'Userland');
check('100 is Libc',              Store.rankFor(100).label, 'Libc');
check('6000 is Silicon',          Store.rankFor(6000).label, 'Silicon');
check('beyond the top stays top', Store.rankFor(99999).label, 'Silicon');
check('progress into a rank',     Store.rankProgress(150).into, 50);
check('span of a rank',           Store.rankProgress(150).span, 200);
check('the top rank has no next', Store.rankProgress(6000).next, null);

section('ranks — a rank-up is reported');
await fresh();
Store.state.xp = 95;
out = Store.submit(P('ru', 'beginner'), { correct: true, score: 1 });
check('crossing 100 reports the new rank', out.rankUp && out.rankUp.label, 'Libc');
await fresh();
Store.state.xp = 10;
out = Store.submit(P('ru2', 'beginner'), { correct: true, score: 1 });
check('not crossing reports nothing', out.rankUp, null);

/* ---------------- export ---------------- */

section('export to the Learning Tree');
await fresh();
const catalog = [
  { id: 'e1', title: 'Easy one',   tags: ['caches'] },
  { id: 'e2', title: 'Hard one',   tags: ['raft'] },
  { id: 'e3', title: 'Read one',   tags: [] },
];
Store.submit(P('e1', 'beginner'), { correct: true, score: 1 });

const hinted = P('e2', 'advanced');
Store.openHint(hinted);
Store.submit(hinted, { correct: true, score: 1 });

const revealed = P('e3', 'intermediate');
Store.reveal(revealed);
Store.setPerceived(revealed, 4);

const solves = Store.exportSolves(catalog);
const byId = Object.fromEntries(solves.map(s => [s.problemId, s]));

check('every finished problem is exported', solves.length, 3);
check('source is the custom one',    byId.e1.source, 'systems');
check('beginner maps to easy',       byId.e1.level, 'easy');
check('advanced maps to hard',       byId.e2.level, 'hard');
check('intermediate maps to medium', byId.e3.level, 'medium');
check('a clean solve is independent', byId.e1.independence, 'independent');
check('a hinted solve says hint',     byId.e2.independence, 'hint');
check('a revealed one says solution', byId.e3.independence, 'solution');
check('title comes from the catalog', byId.e1.title, 'Easy one');
check('tags come from the catalog',   byId.e1.tags, ['caches']);
check('perceived difficulty travels', byId.e3.perceived, 4);
check('attempts travel',              byId.e1.attempts, 1);
ok('solvedAt is a plain date',        /^\d{4}-\d{2}-\d{2}$/.test(byId.e1.solvedAt));
check('an unsolved problem is not exported',
  Store.exportSolves([...catalog, { id: 'never', title: 'x' }]).length, 3);

/* ---------------- persistence ---------------- */

section('persistence');
await fresh();
Store.submit(P('keep1', 'advanced'), { correct: true, score: 1 });
Store.state.coins = 777;
Store.save();
const before = Store.state.xp;
await Store.init();
check('xp survives a reload',      Store.state.xp, before);
check('coins survive a reload',    Store.state.coins, 777);
check('the solve survives',        Store.record('keep1').status, 'solved');

section('importing a snapshot');
const snapshot = Store.exportState();
Store.reset();
check('reset clears it', Store.state.xp, 0);
Store.importState(snapshot);
check('import restores xp',     Store.state.xp, before);
check('import restores solves', Store.record('keep1').status, 'solved');

section('importing junk does not break it');
Store.importState(null);
check('null gives a blank state', Store.state.xp, 0);
Store.importState({ xp: -50, coins: 'lots', owned: ['nope'], progress: { x: { status: 'invented' } } });
check('negative xp is floored',       Store.state.xp, 0);
check('a non-numeric balance is zero', Store.state.coins, 0);
check('unknown items are dropped',     Store.isOwned('nope'), false);
check('the defaults are still owned',  Store.isOwned('theme-dark'), true);
check('an invented status falls back', Store.record('x').status, 'unsolved');

section('an equipped item you no longer own falls back');
Store.importState({ owned: [], equipped: { theme: 'theme-phosphor' } });
check('back to the default theme', Store.state.equipped.theme, 'theme-dark');

section('progress carries over from the old storage key');
/* The site was renamed, and the storage key with it. Anyone who had solved
   something under the old name must not open the renamed site to an empty
   profile. */
Store.reset();
Store.submit(P('legacy1', 'advanced'), { correct: true, score: 1 });
const legacySnapshot = JSON.stringify(Store.exportState());
const legacyXp = Store.state.xp;

sandbox.localStorage.clear();
sandbox.localStorage.setItem('bare-metal/state/v1', legacySnapshot);
await Store.init();
check('the old key is read',                 Store.state.xp, legacyXp);
check('and the solve came with it',          Store.record('legacy1').status, 'solved');
check('the migration is reported',           Store.migratedFrom, 'bare-metal');
ok('it is written under the new key',        !!sandbox.localStorage.getItem('systems-lab/state/v1'));
ok('and the old key is left alone, so the rename is reversible',
  !!sandbox.localStorage.getItem('bare-metal/state/v1'));

section('the new key wins when both exist');
sandbox.localStorage.setItem('systems-lab/state/v1', JSON.stringify({ xp: 42 }));
await Store.init();
check('the current key is preferred', Store.state.xp, 42);
check('and no migration is claimed',  Store.migratedFrom, null);

report('store');
