/* ============================================================
   vault.js — the place for things too big for localStorage.

   localStorage is one synchronous string per key with a quota
   of about five megabytes for the whole origin, and when it is
   full `setItem` throws. That is why submissions are capped at
   6,000 characters each and 20,000 per problem: not because
   nobody wants their program back, but because the alternative
   was a write failing and taking the XP with it.

   This is IndexedDB behind a key-value interface, for the
   things where that cap is the wrong answer — an assessment
   attempt holds a whole program per problem per language, and
   truncating one would mean handing back a program that does
   not compile.

   Four things it is careful about, because storage fails in
   ways that are easy to pretend do not happen:

     · it may not exist. Private windows, blocked site data and
       some embedded webviews have no IndexedDB. There is a
       localStorage fallback and then an in-memory one, and
       `mode` says which is in use so the page can say so.
     · it is asynchronous, so every read is a promise and the
       UI has to be written for that.
     · it can fail at any moment — quota, a corrupt database, a
       browser clearing site data. Failures are reported, not
       swallowed: `onFail` fires and the page shows it.
     · it is per-origin and per-device, like everything else
       here. Export is the only way anything leaves.
   ============================================================ */

const Vault = (() => {

  const DB = 'invariant';
  const VERSION = 1;
  const STORE = 'kv';

  /* How the data is actually being kept, which the page says out loud
     rather than letting somebody find out when it is gone. */
  let mode = 'unknown';   /* indexeddb | localstorage | memory */
  let lastError = null;
  const failed = new Set();

  const memory = new Map();
  const LS_PREFIX = 'invariant/vault/';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('this browser has no IndexedDB'));
        return;
      }
      let req;
      try { req = indexedDB.open(DB, VERSION); } catch (err) { reject(err); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB refused to open'));
      /* A blocked open means another tab holds an older version. It
         resolves itself when that tab closes; until then the fallback
         is correct rather than a hang. */
      req.onblocked = () => reject(new Error('another tab is holding an older database'));
    }).catch(err => {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  function tx(write) {
    return openDb().then(db => {
      const t = db.transaction(STORE, write ? 'readwrite' : 'readonly');
      return t.objectStore(STORE);
    });
  }

  const wrap = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('the request failed'));
  });

  /* ---------------- the fallbacks ---------------- */

  function lsGet(key) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch { return undefined; }
  }

  function lsSet(key, value) {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  }

  function lsKeys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length));
      }
    } catch { /* blocked */ }
    return out;
  }

  /* ---------------- failures are visible ---------------- */

  const listeners = new Set();
  const onFail = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  function note(err, what) {
    lastError = `${what}: ${(err && err.message) || err}`;
    failed.add(what);
    for (const fn of [...listeners]) {
      try { fn({ what, error: lastError, mode }); } catch { /* not our problem */ }
    }
  }

  /* ---------------- the interface ----------------

     Each operation tries IndexedDB, then localStorage, then memory, and
     records which one answered. A read that falls back is not an error;
     a *write* that falls all the way to memory is, because it will be
     gone when the tab closes, and the caller is told. */

  async function get(key) {
    try {
      const store = await tx(false);
      const v = await wrap(store.get(key));
      mode = 'indexeddb';
      if (v !== undefined) return v;
      /* Nothing there. It may be a value written before IndexedDB was
         available, so the fallback is still worth a look. */
    } catch (err) {
      if (mode === 'unknown') mode = 'localstorage';
      note(err, 'read');
    }
    const ls = lsGet(key);
    if (ls !== undefined) return ls;
    return memory.has(key) ? memory.get(key) : undefined;
  }

  async function set(key, value) {
    memory.set(key, value);
    try {
      const store = await tx(true);
      await wrap(store.put(value, key));
      mode = 'indexeddb';
      failed.delete('write');
      return { ok: true, where: 'indexeddb' };
    } catch (err) {
      try {
        lsSet(key, value);
        mode = 'localstorage';
        return { ok: true, where: 'localstorage', degraded: true };
      } catch (err2) {
        mode = 'memory';
        /* Both durable stores refused. The value is in memory and will
           not survive the tab, and saying so is the whole point of
           this branch — silently keeping it would be worse than not
           keeping it. */
        note(err2, 'write');
        return { ok: false, where: 'memory', error: lastError };
      }
    }
  }

  async function remove(key) {
    memory.delete(key);
    try { localStorage.removeItem(LS_PREFIX + key); } catch { /* blocked */ }
    try {
      const store = await tx(true);
      await wrap(store.delete(key));
      return true;
    } catch (err) {
      note(err, 'delete');
      return false;
    }
  }

  async function keys() {
    const out = new Set([...memory.keys(), ...lsKeys()]);
    try {
      const store = await tx(false);
      for (const k of await wrap(store.getAllKeys())) out.add(String(k));
      mode = 'indexeddb';
    } catch (err) {
      note(err, 'list');
    }
    return [...out].sort();
  }

  /* Everything, for export. A plain object so it can go straight into
     the same JSON file the rest of the state does. */
  async function dump() {
    const out = {};
    for (const k of await keys()) {
      const v = await get(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  /* And back. Returns what it could not write rather than throwing, so
     a partial import says which parts. */
  async function load(obj, { replace = false } = {}) {
    const bad = [];
    if (replace) {
      for (const k of await keys()) {
        if (!Object.prototype.hasOwnProperty.call(obj || {}, k)) await remove(k);
      }
    }
    for (const [k, v] of Object.entries(obj || {})) {
      const r = await set(k, v);
      if (!r.ok) bad.push(k);
    }
    return { written: Object.keys(obj || {}).length - bad.length, failed: bad };
  }

  /* Roughly how much is in here, for Settings. Measured as the JSON
     length, which is what both backends actually store. */
  async function size() {
    let bytes = 0;
    let count = 0;
    for (const k of await keys()) {
      const v = await get(k);
      if (v === undefined) continue;
      count += 1;
      try { bytes += JSON.stringify(v).length; } catch { /* unserialisable */ }
    }
    return { count, bytes };
  }

  /* Whether it works at all, asked once and answered honestly. Used by
     Settings to say where things are being kept. */
  async function probe() {
    const key = '\u0000probe';
    const r = await set(key, { at: Date.now() });
    await remove(key);
    return { mode, ok: r.ok, where: r.where, error: lastError };
  }

  return {
    get, set, remove, keys, dump, load, size, probe, onFail,
    get mode() { return mode; },
    get lastError() { return lastError; },
    get degraded() { return mode === 'localstorage' || mode === 'memory'; },
    /* Exposed for the tests, which drive this without a browser. */
    STORE, DB, VERSION, LS_PREFIX,
  };
})();
