/* The vault, the source store, and the migration into it.

   Node has no IndexedDB, which is not a gap in this suite — it is the
   fallback path, and the fallback path is the one that runs in a
   private window, with site data blocked, and in some embedded
   webviews. So this exercises exactly what those readers get, and a
   separate browser suite drives the IndexedDB path for real.

   What matters here:

     · a value written and read back is the same value
     · a write that cannot reach anywhere durable is REPORTED rather
       than treated as saved
     · the migration copies the old truncated programs across and does
       not delete them before the new copy exists
     · a program is kept for exactly as long as its verdict, and
       nothing is pruned while its verdict is still listed

   Run: node tests/vault.test.mjs */

import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab, sandbox } = loadScripts(['js/vault.js', 'js/sources.js', 'js/store.js']);
const Vault = grab('Vault');
const Sources = grab('Sources');
const Store = grab('Store');

await Store.init();

/* ---------------- the vault ---------------- */

section('a value survives a round trip');
{
  const w = await Vault.set('t/one', { a: 1, b: ['x', 'y'] });
  ok(`it was written (${w.where})`, w.ok);
  check('and comes back the same', await Vault.get('t/one'), { a: 1, b: ['x', 'y'] });
  check('something never written is undefined', await Vault.get('t/nope'), undefined);
}

section('it says where it put things');
{
  /* No IndexedDB here, so localStorage is the honest answer and the
     page is entitled to say so. */
  check('the mode is the fallback', Vault.mode, 'localstorage');
  ok('which counts as degraded, and is reported as such', Vault.degraded);
  const p = await Vault.probe();
  ok(`a probe round-trips (${p.where})`, p.ok);
}

section('keys, dump and load');
{
  await Vault.set('t/two', 2);
  const keys = await Vault.keys();
  ok(`both keys are listed (${keys.filter(k => k.startsWith('t/')).join(', ')})`,
    keys.includes('t/one') && keys.includes('t/two'));

  const all = await Vault.dump();
  check('dump carries the values', all['t/two'], 2);

  await Vault.remove('t/two');
  check('and remove removes', await Vault.get('t/two'), undefined);

  const r = await Vault.load({ 't/three': [1, 2, 3] });
  check('load writes', r.failed, []);
  check('and it is there', await Vault.get('t/three'), [1, 2, 3]);
}

section('a write that cannot land anywhere durable says so');
{
  const real = sandbox.localStorage.setItem;
  const seen = [];
  const off = Vault.onFail(e => seen.push(e.what));
  sandbox.localStorage.setItem = () => {
    const e = new Error('QuotaExceededError');
    e.name = 'QuotaExceededError';
    throw e;
  };

  const w = await Vault.set('t/full', 'x'.repeat(100));
  sandbox.localStorage.setItem = real;
  off();

  check('it does not claim to have saved it', w.ok, false);
  check('it says where it actually is', w.where, 'memory');
  ok(`and the error is carried ("${String(w.error).slice(0, 40)}")`, !!w.error);
  ok('a listener was told', seen.includes('write'));
  /* It is still readable this session — losing it as well would help
     nobody — but nothing pretends it is durable. */
  check('the value is still usable until the tab closes',
    await Vault.get('t/full'), 'x'.repeat(100));
  check('and the mode says what happened', Vault.mode, 'memory');
}

/* ---------------- the source store ---------------- */

section('a program is kept whole, however long');
{
  const huge = 'z'.repeat(80_000);
  await Sources.put('p1', '2026-01-01T00:00:00.000Z', huge);
  const back = await Sources.get('p1', '2026-01-01T00:00:00.000Z');
  check('it comes back the same length', back.length, huge.length);
  check('and the same text', back === huge, true);
}

section('one record per problem, keyed by the submission');
{
  await Sources.put('p2', 'a', 'first');
  await Sources.put('p2', 'b', 'second');
  check('both are there', [await Sources.get('p2', 'a'), await Sources.get('p2', 'b')],
    ['first', 'second']);
  check('and another problem is separate', await Sources.get('p1', 'a'), null);
  await Sources.drop('p2', 'a');
  check('dropping one leaves the other', await Sources.get('p2', 'b'), 'second');
  check('and the dropped one is gone', await Sources.get('p2', 'a'), null);
}

section('a program is kept for exactly as long as its verdict');
{
  await Sources.put('p3', 'one', 'A');
  await Sources.put('p3', 'two', 'B');
  await Sources.put('p3', 'three', 'C');
  /* The store has rolled 'one' off the list. */
  const dropped = await Sources.prune('p3', ['two', 'three']);
  check('the forgotten one went', dropped, 1);
  check('and it is gone', await Sources.get('p3', 'one'), null);
  check('while the listed ones stayed',
    [await Sources.get('p3', 'two'), await Sources.get('p3', 'three')], ['B', 'C']);
}

/* ---------------- the migration ---------------- */

section('the old truncated programs are copied across, not moved');
{
  Sources.forget();
  await Vault.remove(Sources.MIGRATED);

  /* What an older version left behind: the program inline on the
     record, cut at six thousand characters. */
  const progress = {
    'old-1': {
      id: 'old-1',
      subs: [
        { at: '2025-05-01T10:00:00.000Z', lang: 'cpp', source: 'int main(){}', truncated: false },
        { at: '2025-05-02T10:00:00.000Z', lang: 'cpp', source: 'x'.repeat(6000), truncated: true },
      ],
    },
    'old-2': { id: 'old-2', subs: [{ at: '2025-05-03T10:00:00.000Z', source: 'print(1)' }] },
    'old-3': { id: 'old-3', subs: [{ at: '2025-05-04T10:00:00.000Z', source: null }] },
  };

  const r = await Sources.migrate(progress);
  check('three programs moved', r.moved, 3);
  check('nothing failed', r.failed, 0);
  check('the first is readable', await Sources.get('old-1', '2025-05-01T10:00:00.000Z'),
    'int main(){}');
  check('so is the truncated one',
    (await Sources.get('old-1', '2025-05-02T10:00:00.000Z')).length, 6000);
  check('and the other problem', await Sources.get('old-2', '2025-05-03T10:00:00.000Z'),
    'print(1)');
  check('a record with no program needed nothing',
    await Sources.get('old-3', '2025-05-04T10:00:00.000Z'), null);

  /* The old copy is LEFT WHERE IT IS. A migration that deletes the
     original before the copy is proven is how people lose things, and
     the record is only forty bytes larger for it. */
  check('the original is untouched', progress['old-1'].subs[0].source, 'int main(){}');

  const again = await Sources.migrate(progress);
  ok('and it does not run twice', again.already);
}

section('a migration that could not finish does not call itself finished');
{
  Sources.forget();
  await Vault.remove(Sources.MIGRATED);
  const real = sandbox.localStorage.setItem;
  sandbox.localStorage.setItem = () => { throw new Error('nope'); };
  const r = await Sources.migrate({
    'bad-1': { id: 'bad-1', subs: [{ at: 'x', source: 'something' }] },
  });
  sandbox.localStorage.setItem = real;
  ok(`it reported the failure (${r.failed})`, r.failed > 0);
  check('and did not mark itself done', await Vault.get(Sources.MIGRATED), undefined);
}

/* ---------------- export and import ---------------- */

section('programs travel in their own half of the export');
{
  Sources.forget();
  await Sources.put('e1', 'at-1', 'the program');
  const out = await Sources.dump();
  ok('the dump has it', out.e1 && out.e1['at-1'] === 'the program');

  await Vault.remove(Sources.KEY('e1'));
  Sources.forget();
  check('and it is gone once removed', await Sources.get('e1', 'at-1'), null);

  const back = await Sources.load(out);
  check('the import writes it', back.failed, []);
  Sources.forget();
  check('and it reads back', await Sources.get('e1', 'at-1'), 'the program');
}

report('vault');
