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
ok('it is written under the new key',        !!sandbox.localStorage.getItem('invariant/state/v1'));
ok('and the old key is left alone, so the rename is reversible',
  !!sandbox.localStorage.getItem('bare-metal/state/v1'));

section('the new key wins when both exist');
sandbox.localStorage.setItem('invariant/state/v1', JSON.stringify({ xp: 42 }));
await Store.init();
check('the current key is preferred', Store.state.xp, 42);
check('and no migration is claimed',  Store.migratedFrom, null);

/* ---------------- two renames deep ---------------- */

section('a reader who has been here since Bare Metal keeps everything');
/* Bare Metal -> Systems Lab -> Invariant. Each rename moved the prefix, and
   every old prefix has to stay readable: somebody who solved things under
   the first name and has not opened the site since the second must still
   not land on an empty profile. */
Store.reset();
Store.submit(P('old-solve', 'advanced'), { correct: true, score: 1 });
const twoRenamesAgo = JSON.stringify(Store.exportState());
const twoRenamesXp = Store.state.xp;

sandbox.localStorage.clear();
sandbox.localStorage.setItem('systems-lab/state/v1', twoRenamesAgo);
await Store.init();
check('the Systems Lab key is read',   Store.state.xp, twoRenamesXp);
check('the solve came with it',        Store.record('old-solve').status, 'solved');
check('and the migration names it',    Store.migratedFrom, 'systems-lab');
ok('it is written forward',            !!sandbox.localStorage.getItem('invariant/state/v1'));

section('the newest prefix present wins, in order');
sandbox.localStorage.clear();
sandbox.localStorage.setItem('bare-metal/state/v1',  JSON.stringify({ xp: 1 }));
sandbox.localStorage.setItem('systems-lab/state/v1', JSON.stringify({ xp: 2 }));
await Store.init();
check('Systems Lab beats Bare Metal', Store.state.xp, 2);
sandbox.localStorage.setItem('invariant/state/v1',   JSON.stringify({ xp: 3 }));
await Store.init();
check('Invariant beats both',         Store.state.xp, 3);
check('and claims no migration',      Store.migratedFrom, null);

section('a corrupt old key is skipped, not migrated');
sandbox.localStorage.clear();
sandbox.localStorage.setItem('systems-lab/state/v1', '{not json');
await Store.init();
check('it starts clean rather than throwing', Store.state.xp, 0);

section('the runner address survives the rename too');
/* Settings are not progress, but retyping a runner address because the site
   changed its name is still the site losing something the reader set. */
sandbox.localStorage.clear();
sandbox.localStorage.setItem('systems-lab/judge-url', 'http://127.0.0.1:2222');
sandbox.localStorage.setItem('systems-lab/ui/v1', JSON.stringify({ splitFraction: 0.31 }));
await Store.init();
check('the old runner address is still used', Store.config.judgeUrl, 'http://127.0.0.1:2222');
check('and copied under the new name',
  sandbox.localStorage.getItem('invariant/judge-url'), 'http://127.0.0.1:2222');
check('interface preferences come across', Store.pref('splitFraction'), 0.31);

/* ---------------- editor completion ---------------- */

section('completion is on until somebody turns it off');
sandbox.localStorage.removeItem('invariant/ui/v1');
{
  const c = Store.completionPref();
  ok('the master switch defaults on', c.on);
  ok('and so does every language',
    Store.COMPLETION_LANGS.every(id => c.langs[id] === true));
  ok('so asking about one says yes', Store.completionOn('cpp'));
}

section('the master switch covers everything');
{
  Store.setCompletion({ on: false });
  ok('every language goes quiet', Store.COMPLETION_LANGS.every(id => !Store.completionOn(id)));
  ok('even though each is still individually on',
    Store.completionPref().langs.cpp === true);
  Store.setCompletion({ on: true });
  ok('and comes back', Store.completionOn('cpp'));
}

section('one language can be switched off on its own');
{
  Store.setCompletion({ langs: { python: false } });
  ok('Python is off', !Store.completionOn('python'));
  ok('C++ is not', Store.completionOn('cpp'));
  ok('and the master switch is untouched', Store.completionPref().on);

  Store.setCompletion({ langs: { cpp: false } });
  ok('two can be off at once',
    !Store.completionOn('python') && !Store.completionOn('cpp'));
  ok('without disturbing the others',
    Store.completionOn('rust') && Store.completionOn('js'));
}

section('it survives a reload, and an old prefs blob');
{
  Store.setCompletion({ on: true, langs: { rust: false } });
  await Store.init();
  ok('the setting is still there after init', !Store.completionOn('rust'));

  /* A prefs blob written before this setting existed has no completion
     key at all, and must not read as "everything off". */
  sandbox.localStorage.setItem('invariant/ui/v1',
    JSON.stringify({ splitFraction: 0.5 }));
  await Store.init();
  ok('an older prefs blob defaults to on',
    Store.COMPLETION_LANGS.every(id => Store.completionOn(id)));

  /* And a half-written one. */
  sandbox.localStorage.setItem('invariant/ui/v1',
    JSON.stringify({ completion: { langs: { cpp: false } } }));
  await Store.init();
  ok('a blob with no master key still reads as on', Store.completionPref().on);
  ok('while honouring the language it does name', !Store.completionOn('cpp'));
}

section('a language nobody configured is not silently off');
{
  sandbox.localStorage.removeItem('invariant/ui/v1');
  await Store.init();
  ok('an unknown language follows the master switch', Store.completionOn('fortran'));
  Store.setCompletion({ on: false });
  ok('including when it is off', !Store.completionOn('fortran'));
  Store.setCompletion({ on: true });
}

/* ---------------- submissions ---------------- */

section('a submission is what you sent, not just that you sent something');
await fresh();
{
  const c = P('code-1', 'intermediate', { type: 'code' });
  Store.submit(c, {
    correct: false, score: 0.25, lang: 'cpp', source: 'int main() { return 1; }',
    passed: 1, total: 4, ms: 1234,
  });
  const list = Store.submissions('code-1');
  check('it is recorded', list.length, 1);
  /* The verdict says a program was kept and how big it is; the
     program itself is in the vault, keyed by this record's `at`. */
  check('with a note that the program was kept', list[0].stored, true);
  check('and how long it was', list[0].bytes, 'int main() { return 1; }'.length);
  check('the language',            list[0].lang, 'cpp');
  check('how many cases passed',   `${list[0].passed}/${list[0].total}`, '1/4');
  check('how long it took',        list[0].ms, 1234);
  check('and the outcome',         list[0].outcome, 'failed');
  ok('stamped with a time',        !Number.isNaN(Date.parse(list[0].at)));
  check('the attempt is still counted the old way too',
    Store.record('code-1').attempts, 1);
}

section('a verdict nobody reached is not stored as a wrong answer');
await fresh();
{
  const c = P('code-2', 'intermediate', { type: 'code' });
  /* The compiler refused it, so no case ever ran. */
  Store.submit(c, { correct: false, score: 0, lang: 'rust', source: 'fn main() {', built: false });
  const sub = Store.submissions('code-2')[0];
  check('the outcome says so', sub.outcome, 'build-failed');
  check('and it claims no cases', `${sub.passed}/${sub.total}`, '0/0');

  Store.submit(c, {
    correct: true, score: 1, lang: 'rust', source: 'fn main() {}',
    passed: 4, total: 4, built: true,
  });
  check('a passing one is marked passed', Store.submissions('code-2')[0].outcome, 'passed');
}

section('newest first, because that is the order anybody reads them');
await fresh();
{
  const c = P('code-3', 'intermediate', { type: 'code' });
  for (const n of ['a', 'bb', 'ccc']) {
    Store.submit(c, { correct: false, score: 0, lang: 'js', source: n });
  }
  check('the last one is at the top',
    Store.submissions('code-3').map(x => x.bytes), [3, 2, 1]);
  ok('and the list handed out is a copy',
    Store.submissions('code-3') !== Store.submissions('code-3'));
}

section('nothing to show means nothing stored');
await fresh();
{
  /* The gate is the source: a multiple-choice answer has nothing to keep
     that the record does not already say. */
  Store.submit(P('mcq-1'), { correct: true, score: 1 });
  check('an answer with no program records no submission', Store.submissions('mcq-1').length, 0);
  Store.submit(P('mcq-2'), { correct: true, score: 1, source: '   ' });
  check('and neither does an empty one', Store.submissions('mcq-2').length, 0);
}

section('the verdicts are capped; the programs are not truncated');
await fresh();
{
  const c = P('code-4', 'intermediate', { type: 'code' });
  for (let i = 1; i <= Store.SUBS_MAX + 4; i += 1) {
    Store.submit(c, { correct: false, score: 0, lang: 'js', source: `attempt ${i}` });
  }
  const list = Store.submissions('code-4');
  check(`no more than ${Store.SUBS_MAX} verdicts are kept`, list.length, Store.SUBS_MAX);
  check('the newest is the last one sent', list[0].bytes, `attempt ${Store.SUBS_MAX + 4}`.length);
  ok('every one of them says a program was kept', list.every(x => x.stored));
}

section('a program is not cut, however long it is');
await fresh();
{
  /* The old store cut one at 6,000 characters. The only reason to keep
     a program is to load it back, and a program cut in half cannot be
     loaded back — so the cap went, and the program went to IndexedDB
     where there is room for it. */
  const c = P('code-5', 'intermediate', { type: 'code' });
  const huge = 'x'.repeat(60_000);
  Store.submit(c, { correct: false, score: 0, lang: 'js', source: huge });
  const sub = Store.submissions('code-5')[0];
  ok('the verdict says a program was kept', sub.stored);
  check('and says how big it was, in full', sub.bytes, huge.length);
  check('nothing is marked truncated any more', sub.truncated, false);
  /* And the verdict itself is still small, which is what kept the
     localStorage quota safe in the first place. */
  ok(`the verdict is a few dozen bytes (${JSON.stringify(sub).length})`,
    JSON.stringify(sub).length < 300);
}

section('the state file stays small however much code is submitted');
await fresh();
{
  const c = P('code-6', 'intermediate', { type: 'code' });
  for (let i = 1; i <= 10; i += 1) {
    Store.submit(c, { correct: false, score: 0, lang: 'js', source: 'y'.repeat(50_000) });
  }
  const raw = sandbox.localStorage.getItem('invariant/state/v1');
  /* Half a megabyte of programs; the file that holds the XP must not
     have grown by any of it. A quota failure here does not lose the
     submissions, it loses everything. */
  ok(`half a megabyte of programs, ${raw.length} bytes of state`, raw.length < 20_000);
  check('and all ten verdicts are there', Store.submissions('code-6').length, 10);
}

section('out of room: the oldest history goes, the draft and the XP stay');
await fresh();
{
  const c = P('code-7', 'intermediate', { type: 'code' });
  /* A draft in progress, which is the thing that must NOT be shed: it
     is work somebody is in the middle of and the only copy of it. */
  Store.saveDraft(c, 'js', 'the thing I am writing right now');
  for (let i = 1; i <= 8; i += 1) {
    Store.submit(c, { correct: false, score: 0, lang: 'js', source: `attempt ${i}` });
  }

  /* One write fails the way a full quota fails, and only one. */
  const real = sandbox.localStorage.setItem;
  let thrown = 0;
  sandbox.localStorage.setItem = (k, v) => {
    if (thrown === 0) { thrown = 1; const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    return real(k, v);
  };
  const out = Store.submit(c, { correct: true, score: 1, lang: 'js', source: 'second attempt' });
  sandbox.localStorage.setItem = real;

  check('the solve was still awarded', out.xp > 0, true);
  check('and it is in the saved state',
    JSON.parse(sandbox.localStorage.getItem('invariant/state/v1')).xp, Store.state.xp);
  const left = Store.submissions('code-7').length;
  ok(`the oldest verdicts were pruned to make the write fit (${left} left)`,
    left <= Store.SUBS_KEEP_WHEN_FULL + 1);
  ok('and some history survived rather than all of it going',
    left >= Store.SUBS_KEEP_WHEN_FULL);
  /* The whole point of choosing verdicts over drafts. */
  check('the draft in progress was not touched',
    Store.draft('code-7', 'js'), 'the thing I am writing right now');
}

section('submissions survive an export and import');
await fresh();
{
  const c = P('code-8', 'intermediate', { type: 'code' });
  Store.submit(c, { correct: true, score: 1, lang: 'cpp', source: 'int main(){}', passed: 3, total: 3 });
  const snapshot = Store.exportState();
  Store.reset();
  check('reset clears them', Store.submissions('code-8').length, 0);
  Store.importState(snapshot);
  const sub = Store.submissions('code-8')[0];
  /* The verdict travels in the state snapshot; the program travels in
     the vault's half of the export. See tests/vault.test.mjs. */
  ok('and the import brings the verdict back', !!sub);
  check('with the numbers intact', `${sub.passed}/${sub.total}`, '3/3');
  check('and the note that a program exists for it', sub.stored, true);
}

section('a snapshot from elsewhere cannot talk the caps up');
await fresh();
{
  Store.importState({
    progress: {
      'code-9': {
        status: 'attempted',
        subs: Array.from({ length: 40 }, (_, i) => ({
          at: '2026-01-01T00:00:00.000Z', lang: 'js', outcome: 'failed',
          source: `s${i}`, passed: 99, total: 3,
        })),
      },
    },
  });
  const list = Store.submissions('code-9');
  check('the list is cut to the cap on the way in', list.length, Store.SUBS_MAX);
  check('keeping the newest end', list[0].source, 's39');
  check('and a passed count above the total is clamped', list[0].passed, 3);
}

section('rubbish in a submission is not trusted either');
await fresh();
{
  Store.importState({
    progress: {
      'code-10': {
        subs: [{ outcome: 'brilliant', passed: -4, total: 'lots', ms: -1, source: 42 }],
      },
    },
  });
  const sub = Store.submissions('code-10')[0];
  check('an unknown outcome reads as failed', sub.outcome, 'failed');
  check('a negative count reads as zero',     sub.passed, 0);
  check('a total that is not a number too',   sub.total, 0);
  check('so does a negative duration',        sub.ms, 0);
  /* Not '': a program that was dropped and a program that was empty are
     different things, and only one of them is worth saying. */
  check('and a source that is not text is no source at all', sub.source, null);
}

/* ---------------- reading an import before trusting it ----------------

   `importState` replaces everything, and used to run the moment a file
   was chosen. These are the two functions that let the page say what a
   file holds and what it would do, and the merge that is the safe
   answer to "I have two browsers". */

section('an import can be described before it is applied');
{
  await fresh();

  check('rubbish is refused', Store.describeImport(null).ok, false);
  check('and so is JSON that is not an export',
    Store.describeImport({ hello: 'world' }).ok, false);
  ok('with a reason somebody can act on',
    /no progress in that file/i.test(Store.describeImport({ hello: 'world' }).why));

  /* A file from another browser. */
  const file = {
    _format: 'invariant/export/v2',
    exportedAt: '2026-01-02T03:04:05.000Z',
    progress: {
      xp: 120,
      progress: {
        a: { id: 'a', status: 'solved', xpEarned: 30, subs: [{ at: '1', outcome: 'passed' }] },
        b: { id: 'b', status: 'attempted', attempts: 2, notes: 'from the file' },
        c: { id: 'c', status: 'solved', draft: { cpp: 'int main(){}' } },
      },
    },
    sources: { a: { 1: 'int main(){}' } },
    attempts: { version: 1, attempts: [{ id: 'x' }] },
  };

  const look = Store.describeImport(file);
  check('it reads', look.ok, true);
  check('the format', look.format, 'invariant/export/v2');
  check('how many problems', look.has.problems, 3);
  check('how many solved', look.has.solved, 2);
  check('how many drafts', look.has.drafts, 1);
  check('how many notes', look.has.notes, 1);
  check('how many submission verdicts', look.has.submissions, 1);
  check('how many programs', look.has.programs, 1);
  check('how many attempts', look.has.attempts, 1);

  /* A v1 file is the progress object itself, and must still read. */
  check('an older export is still readable',
    Store.describeImport(file.progress).ok, true);
  check('and says which it is',
    Store.describeImport(file.progress).format, 'invariant/export/v1');

  /* Nothing has been applied by describing it. */
  check('describing changes nothing', Store.record('a').status, 'unsolved');
}

section('and the impact is computed against what is here');
{
  await fresh();
  Store.submit({ id: 'b', difficulty: 'beginner' }, { correct: true, score: 1 });
  Store.submit({ id: 'z', difficulty: 'beginner' }, { correct: true, score: 1 });

  const file = {
    progress: {
      progress: {
        a: { id: 'a', status: 'solved' },
        b: { id: 'b', status: 'attempted' },
      },
    },
  };
  const look = Store.describeImport(file);
  check('one problem is only in the file', look.impact.onlyThere, 1);
  check('one is only here', look.impact.onlyHere, 1);
  check('and one would go backwards on a replace', look.impact.wouldLose, 1);
}

section('keeping both never makes anything worse');
{
  await fresh();

  Store.submit({ id: 'solved-here', difficulty: 'beginner' }, { correct: true, score: 1 });
  Store.saveDraft({ id: 'drafted-here' }, 'cpp', 'MINE');
  Store.setNotes({ id: 'noted-here' }, 'my note');

  const before = Store.record('solved-here').status;

  Store.mergeState({
    xp: 9999,
    progress: {
      'solved-here': { id: 'solved-here', status: 'attempted', attempts: 7 },
      'drafted-here': { id: 'drafted-here', status: 'solved', draft: { cpp: 'THEIRS' } },
      'noted-here': { id: 'noted-here', status: 'unsolved', notes: 'their note' },
      'new-one': { id: 'new-one', status: 'solved', xpEarned: 20 },
    },
  });

  check('a solved problem is not downgraded', Store.record('solved-here').status, before);
  check('but a higher attempt count is taken', Store.record('solved-here').attempts, 7);
  check('a draft in this browser is never overwritten',
    Store.draft('drafted-here', 'cpp'), 'MINE');
  check('while the status beside it is taken', Store.record('drafted-here').status, 'solved');
  check('a note here is kept', Store.record('noted-here').notes, 'my note');
  check('and one the file has alone arrives', Store.record('new-one').status, 'solved');
  check('XP takes the larger', Store.state.xp, 9999);
}

section('and merging the same file twice adds nothing the second time');
{
  await fresh();

  const file = {
    progress: {
      p: {
        id: 'p', status: 'solved',
        subs: [{ at: '2026-01-01T00:00:00.000Z', outcome: 'passed' },
          { at: '2026-01-02T00:00:00.000Z', outcome: 'failed' }],
      },
    },
  };
  Store.mergeState(file);
  const once = Store.submissions('p').length;
  Store.mergeState(file);
  const twice = Store.submissions('p').length;
  check('submissions arrive', once, 2);
  check('and are not duplicated', twice, once);
}

report('store');
