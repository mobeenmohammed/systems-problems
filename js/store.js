/* ============================================================
   store.js — progress, scoring, the shop, and persistence.

   localStorage holds the live copy. data/progress.json is an
   exported snapshot you can commit, which is how progress moves
   between machines; nothing is ever written to the repo by the
   page itself.

   The catalog of problems is NOT here — that is catalog.js. This
   file only ever knows a problem's id, topic and difficulty, so
   progress survives a problem being reworded.
   ============================================================ */

const Store = (() => {

  const LS_KEY     = 'bare-metal/state/v1';
  const LS_JUDGE   = 'bare-metal/judge-url';
  const CONFIG_URL = 'data/config.json';

  const TOPICS = [
    { id: 'arch',      label: 'Computer Architecture',    blurb: 'Caches, pipelines, alignment, and what the hardware actually does.' },
    { id: 'os',        label: 'Operating Systems',        blurb: 'Processes, virtual memory, scheduling, concurrency.' },
    { id: 'linux',     label: 'Linux & Tooling',          blurb: 'The shell, file descriptors, syscalls, and reading a failure.' },
    { id: 'compilers', label: 'Compilers & Interpreters', blurb: 'Lexing, parsing, IR, optimisation, and undefined behaviour.' },
    { id: 'hpc',       label: 'HPC & Parallelism',        blurb: 'Roofline, locality, reductions, and why threads disappoint.' },
    { id: 'dist',      label: 'Distributed Systems',      blurb: 'Partitions, clocks, consensus, and delivery guarantees.' },
    { id: 'fpga',      label: 'FPGAs & Hardware',         blurb: 'LUTs and flops, timing closure, and HDL semantics.' },
    { id: 'algo',      label: 'Algorithms',               blurb: 'The classics, with a bias towards memory behaviour.' },
    { id: 'sysdesign', label: 'System Design',            blurb: 'Latency budgets, capacity, caching, and backpressure.' },
  ];
  const TOPIC_BY_ID = Object.fromEntries(TOPICS.map(t => [t.id, t]));

  /* Base points per difficulty. An Advanced problem is worth six Beginner
     ones, which is roughly the honest ratio of how long they take. */
  const DIFFICULTIES = [
    { id: 'beginner',     label: 'Beginner',     base: 10, level: 'easy'   },
    { id: 'intermediate', label: 'Intermediate', base: 25, level: 'medium' },
    { id: 'advanced',     label: 'Advanced',     base: 60, level: 'hard'   },
  ];
  const DIFF_BY_ID = Object.fromEntries(DIFFICULTIES.map(d => [d.id, d]));

  const FIRST_TRY_BONUS = 0.5;   /* +50% for getting it without a wrong answer */
  const HINT_PENALTY    = 0.25;  /* each hint costs a quarter of the base */

  /* Ranks are cumulative XP, so spending coins in the shop can never cost you
     one. The names are the obvious joke and they make progress legible. */
  const RANKS = [
    { id: 'userland',   label: 'Userland',   at: 0    },
    { id: 'libc',       label: 'Libc',       at: 100  },
    { id: 'syscall',    label: 'Syscall',    at: 300  },
    { id: 'kernel',     label: 'Kernel',     at: 700  },
    { id: 'ring0',      label: 'Ring 0',     at: 1500 },
    { id: 'baremetal',  label: 'Bare Metal', at: 3000 },
    { id: 'silicon',    label: 'Silicon',    at: 6000 },
  ];

  /* Cosmetics only, so the shop can never become pay-to-win against yourself.
     A theme is a token block in css/themes.css keyed by its id. */
  const SHOP = [
    { id: 'theme-dark',      slot: 'theme',  label: 'Midnight',       price: 0,   note: 'The default.' },
    { id: 'theme-paper',     slot: 'theme',  label: 'Paper',          price: 0,   note: 'Light, for daylight.' },
    { id: 'theme-gruvbox',   slot: 'theme',  label: 'Gruvbox',        price: 200, note: 'Warm and retro.' },
    { id: 'theme-nord',      slot: 'theme',  label: 'Nord',           price: 200, note: 'Cold and quiet.' },
    { id: 'theme-tokyo',     slot: 'theme',  label: 'Tokyo Night',    price: 300, note: 'Neon on deep blue.' },
    { id: 'theme-solarized', slot: 'theme',  label: 'Solarized Dark', price: 300, note: 'The old standard.' },
    { id: 'theme-dracula',   slot: 'theme',  label: 'Dracula',        price: 300, note: 'Purple and loud.' },
    { id: 'theme-phosphor',  slot: 'theme',  label: 'Phosphor',       price: 600, note: 'Green CRT. Earned, not given.' },

    { id: 'accent-default',  slot: 'accent', label: 'Default accent', price: 0  },
    { id: 'accent-amber',    slot: 'accent', label: 'Amber',          price: 60 },
    { id: 'accent-mint',     slot: 'accent', label: 'Mint',           price: 60 },
    { id: 'accent-magenta',  slot: 'accent', label: 'Magenta',        price: 60 },
    { id: 'accent-cyan',     slot: 'accent', label: 'Cyan',           price: 60 },

    { id: 'avatar-chip',     slot: 'avatar', label: 'Chip',   price: 0,   glyph: '▚' },
    { id: 'avatar-stack',    slot: 'avatar', label: 'Stack',  price: 80,  glyph: '╤' },
    { id: 'avatar-core',     slot: 'avatar', label: 'Core',   price: 80,  glyph: '◉' },
    { id: 'avatar-clock',    slot: 'avatar', label: 'Clock',  price: 150, glyph: '⎍' },
    { id: 'avatar-lambda',   slot: 'avatar', label: 'Lambda', price: 150, glyph: 'λ' },
    { id: 'avatar-daemon',   slot: 'avatar', label: 'Daemon', price: 400, glyph: '☗' },

    { id: 'frame-none',      slot: 'frame',  label: 'No frame', price: 0   },
    { id: 'frame-trace',     slot: 'frame',  label: 'Trace',    price: 120 },
    { id: 'frame-etched',    slot: 'frame',  label: 'Etched',   price: 250 },
    { id: 'frame-glow',      slot: 'frame',  label: 'Glow',     price: 500 },
  ];
  const SHOP_BY_ID = Object.fromEntries(SHOP.map(i => [i.id, i]));
  const SLOTS = ['theme', 'accent', 'avatar', 'frame', 'title'];

  /* Titles are unlocked by the record rather than bought, so wearing one is a
     claim the log supports. */
  const ACHIEVEMENTS = [
    { id: 'first-blood',  label: 'First Blood',      note: 'Solve your first problem.',                  title: null },
    { id: 'topic-5',      label: 'Getting Somewhere', note: 'Solve five problems in one topic.',          title: null },
    { id: 'topic-all',    label: 'Broad Church',     note: 'Solve at least one problem in every topic.',  title: 'Generalist' },
    { id: 'bug-hunter',   label: 'Bug Hunter',       note: 'Locate five bugs.',                          title: 'Bug Hunter' },
    { id: 'no-hints-10',  label: 'Unassisted',       note: 'Solve ten problems first try, no hints.',     title: 'Unassisted' },
    { id: 'advanced-5',   label: 'Deep End',         note: 'Solve five Advanced problems.',               title: 'Deep End' },
    { id: 'sanitizer-10', label: 'Sanitizer-Clean',  note: 'Pass ten problems under the sanitizer.',      title: 'Sanitizer-Clean' },
    { id: 'streak-7',     label: 'Seven Days',       note: 'A seven-day streak.',                         title: null },
    { id: 'streak-30',    label: 'Thirty Days',      note: 'A thirty-day streak.',                        title: 'Relentless' },
    { id: 'well-read',    label: 'Read The Manual',  note: 'Tick twenty readings as read.',               title: 'Well-Read' },
  ];
  const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

  const STATUSES = ['unsolved', 'attempted', 'solved', 'read'];

  let state  = null;
  let config = { judgeUrl: 'http://127.0.0.1:2000', pyodideUrl: '' };
  const listeners = [];

  /* ---------------- dates ----------------
     Calendar dates are plain YYYY-MM-DD strings in the user's local day, but
     day arithmetic runs in UTC: reading a local-midnight Date back through
     toISOString() lands a day early anywhere ahead of UTC. */
  function todayISO() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  /* ---------------- state ---------------- */

  function blankState() {
    return {
      version:      1,
      profile:      { name: 'Anonymous', bio: '' },
      xp:           0,
      coins:        0,
      progress:     {},
      owned:        ['theme-dark', 'theme-paper', 'accent-default', 'avatar-chip', 'frame-none'],
      equipped:     { theme: 'theme-dark', accent: 'accent-default', avatar: 'avatar-chip', frame: 'frame-none', title: '' },
      streak:       { current: 0, longest: 0, lastDay: '' },
      achievements: [],
      readings:     {},
      updatedAt:    new Date().toISOString(),
    };
  }

  /* Every field is defaulted rather than trusted, so a snapshot exported by an
     older version of the site still loads. */
  function normalize(raw) {
    const base = blankState();
    if (!raw || typeof raw !== 'object') return base;
    const s = { ...base, ...raw };
    s.profile  = { ...base.profile,  ...(raw.profile  || {}) };
    s.equipped = { ...base.equipped, ...(raw.equipped || {}) };
    s.streak   = { ...base.streak,   ...(raw.streak   || {}) };
    s.xp       = Math.max(0, Number(raw.xp)    || 0);
    s.coins    = Math.max(0, Number(raw.coins) || 0);
    s.owned    = [...new Set([...base.owned, ...(Array.isArray(raw.owned) ? raw.owned : [])])]
                   .filter(id => SHOP_BY_ID[id]);
    s.achievements = (Array.isArray(raw.achievements) ? raw.achievements : [])
                   .filter(id => ACHIEVEMENT_BY_ID[id]);
    s.readings = (raw.readings && typeof raw.readings === 'object') ? raw.readings : {};
    s.progress = {};
    for (const [id, r] of Object.entries(raw.progress || {})) s.progress[id] = normalizeRecord(id, r);
    /* An equipped item you no longer own would be a theme you cannot find in
       the shop; fall back rather than render something unexplainable. */
    for (const slot of SLOTS) {
      if (slot === 'title') continue;
      if (!s.owned.includes(s.equipped[slot])) s.equipped[slot] = base.equipped[slot];
    }
    return s;
  }

  function normalizeRecord(id, r) {
    r = r || {};
    const perceived = Number(r.perceived);
    return {
      id,
      status:    STATUSES.includes(r.status) ? r.status : 'unsolved',
      attempts:  Math.max(0, Number(r.attempts)  || 0),
      hintsUsed: Math.max(0, Number(r.hintsUsed) || 0),
      revealed:  !!r.revealed,
      /* The best fraction of the problem ever reached, for partial-credit
         types — so "2 of 3 right" survives a later wrong answer. */
      bestScore: Math.min(1, Math.max(0, Number(r.bestScore) || 0)),
      xpEarned:  Math.max(0, Number(r.xpEarned) || 0),
      lang:      r.lang ? String(r.lang) : '',
      perceived: perceived >= 1 && perceived <= 5 ? Math.round(perceived) : null,
      notes:     typeof r.notes === 'string' ? r.notes : '',
      draft:     (r.draft && typeof r.draft === 'object') ? r.draft : {},
      flagged:   !!r.flagged,
      reviewOn:  r.reviewOn ? String(r.reviewOn).slice(0, 10) : '',
      firstSeenAt:   r.firstSeenAt   ? String(r.firstSeenAt) : '',
      solvedAt:      r.solvedAt      ? String(r.solvedAt).slice(0, 10) : '',
      lastAttemptAt: r.lastAttemptAt ? String(r.lastAttemptAt) : '',
      /* Whether a passing run was also clean under the sanitizer, which is a
         different claim from "the output matched". */
      sanitized:  !!r.sanitized,
      type:       r.type  ? String(r.type)  : '',
      topic:      r.topic ? String(r.topic) : '',
      difficulty: DIFF_BY_ID[r.difficulty] ? r.difficulty : '',
    };
  }

  function save() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (err) {
      /* A failed write means the rest of the session is lost silently on the
         next reload, which is worse than being told about it now. */
      emit('storage-error', err);
      return false;
    }
    return true;
  }

  function emit(event, detail) {
    for (const fn of listeners) { try { fn(event, detail); } catch (e) { console.error(e); } }
  }

  async function init() {
    try {
      const res = await fetch(CONFIG_URL);
      if (res.ok) config = { ...config, ...(await res.json()) };
    } catch { /* opening the page off disk is allowed; the defaults stand. */ }
    loadJudgeUrl();

    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { raw = null; }
    state = normalize(raw);
    rollStreak();
    return state;
  }

  /* A streak is broken by a missed day, and that has to be noticed on load
     rather than only when you next solve something — otherwise the profile
     goes on claiming a streak you have already lost. */
  function rollStreak() {
    const { lastDay } = state.streak;
    if (!lastDay) return;
    if (daysBetween(lastDay, todayISO()) > 1) state.streak.current = 0;
  }

  /* ---------------- reading the record ---------------- */

  const record   = id => state.progress[id] || normalizeRecord(id, null);
  const isSolved = id => record(id).status === 'solved';

  /* What this problem is worth to you *right now*, so the UI can show the
     figure falling as you take hints instead of surprising you afterwards. */
  function potentialXp(problem) {
    const base = (DIFF_BY_ID[problem.difficulty] || DIFFICULTIES[0]).base;
    const r = record(problem.id);
    if (r.revealed) return 0;
    const gross = base * (1 + (r.attempts === 0 ? FIRST_TRY_BONUS : 0));
    return Math.max(0, Math.round(gross - base * HINT_PENALTY * r.hintsUsed));
  }

  function touch(problem) {
    let r = state.progress[problem.id];
    if (!r) {
      r = state.progress[problem.id] =
        normalizeRecord(problem.id, { firstSeenAt: new Date().toISOString() });
    }
    r.topic      = problem.topic      || r.topic;
    r.difficulty = problem.difficulty || r.difficulty;
    r.type       = problem.type       || r.type;
    return r;
  }

  /* ---------------- acting on a problem ---------------- */

  function openHint(problem) {
    const r = touch(problem);
    /* Hints already paid for are not charged twice, which is what lets you
       re-read one without it costing more. */
    if (r.hintsUsed < (problem.hints || []).length) r.hintsUsed += 1;
    save(); emit('hint', r);
    return r.hintsUsed;
  }

  function reveal(problem) {
    const r = touch(problem);
    r.revealed = true;
    if (r.status !== 'solved') r.status = 'read';
    save(); emit('reveal', r);
    return r;
  }

  /* The one place points are created. Returns everything the UI needs to
     explain what just happened, because a number appearing with no account of
     where it came from is what makes a reward system feel arbitrary. */
  function submit(problem, result) {
    const r = touch(problem);
    const firstTry = r.attempts === 0;
    const base  = (DIFF_BY_ID[problem.difficulty] || DIFFICULTIES[0]).base;
    const score = Math.min(1, Math.max(0, Number(result.score) || 0));

    r.attempts += 1;
    r.lastAttemptAt = new Date().toISOString();
    r.bestScore = Math.max(r.bestScore, score);
    if (result.lang)      r.lang = result.lang;
    if (result.sanitized) r.sanitized = true;

    const out = {
      correct: !!result.correct, firstTry, xp: 0, coins: 0,
      streakBonus: 0, newAchievements: [], rankUp: null, alreadySolved: false,
    };

    if (!result.correct) {
      if (r.status === 'unsolved') r.status = 'attempted';
      save(); emit('submit', { record: r, result: out });
      return out;
    }

    /* Re-solving something is good practice but not a second payday. */
    if (r.status === 'solved') {
      out.alreadySolved = true;
      save(); emit('submit', { record: r, result: out });
      return out;
    }

    const wasRank = rankFor(state.xp);
    const gross = base * (1 + (firstTry ? FIRST_TRY_BONUS : 0));
    const xp = r.revealed ? 0 : Math.max(0, Math.round(gross - base * HINT_PENALTY * r.hintsUsed));

    /* Reading the answer and then entering it is honest practice, but it is
       not a solve — the record says "read", which is the same distinction the
       Learning Tree draws with independence. */
    r.status   = r.revealed ? 'read' : 'solved';
    r.solvedAt = todayISO();
    r.xpEarned = xp;

    out.xp    = xp;
    out.coins = xp;
    state.xp    += xp;
    state.coins += xp;

    /* The streak counts days on which you solved something, and the bonus
       lands once a day rather than once a problem. */
    if (xp > 0) {
      const today = todayISO();
      if (state.streak.lastDay !== today) {
        const gap = state.streak.lastDay ? daysBetween(state.streak.lastDay, today) : Infinity;
        state.streak.current = gap === 1 ? state.streak.current + 1 : 1;
        state.streak.lastDay = today;
        state.streak.longest = Math.max(state.streak.longest, state.streak.current);
        out.streakBonus = Math.min(5 + state.streak.current, 25);
        state.coins += out.streakBonus;
        out.coins   += out.streakBonus;
      }
    }

    out.newAchievements = recomputeAchievements();
    const nowRank = rankFor(state.xp);
    if (nowRank.id !== wasRank.id) out.rankUp = nowRank;

    save(); emit('submit', { record: r, result: out });
    return out;
  }

  /* ---------------- notes, flags, revisits ---------------- */

  function setNotes(problem, text)  { const r = touch(problem); r.notes = String(text); save(); }
  function setPerceived(problem, n) { const r = touch(problem); r.perceived = n >= 1 && n <= 5 ? Math.round(n) : null; save(); }
  function setFlag(problem, on)     { const r = touch(problem); r.flagged = !!on; save(); emit('flag', r); }
  function setReview(problem, days) {
    const r = touch(problem);
    r.reviewOn = days > 0 ? addDays(todayISO(), days) : '';
    save(); emit('review', r);
  }
  function saveDraft(problem, lang, source) {
    const r = touch(problem);
    r.draft[lang] = String(source);
    save();
  }
  const draft = (id, lang) => (record(id).draft || {})[lang] || '';

  /* Anything flagged by hand, or booked for a revisit that has come due. */
  function dueForReview() {
    const today = todayISO();
    return Object.values(state.progress)
      .filter(r => r.flagged || (r.reviewOn && r.reviewOn <= today))
      .map(r => ({ ...r, reason: r.flagged ? 'flagged' : 'due' }));
  }

  /* ---------------- readings ---------------- */

  function markReading(conceptId, idx, on = true) {
    const list = new Set(state.readings[conceptId] || []);
    on ? list.add(idx) : list.delete(idx);
    state.readings[conceptId] = [...list].sort((a, b) => a - b);
    if (!state.readings[conceptId].length) delete state.readings[conceptId];
    const unlocked = recomputeAchievements();
    save(); emit('reading', { conceptId, idx, on, unlocked });
    return unlocked;
  }
  const hasRead      = (conceptId, idx) => (state.readings[conceptId] || []).includes(idx);
  const readingCount = () => Object.values(state.readings).reduce((n, l) => n + l.length, 0);

  /* ---------------- rank ---------------- */

  function rankFor(xp) {
    let out = RANKS[0];
    for (const r of RANKS) if (xp >= r.at) out = r;
    return out;
  }
  function rankProgress(xp = state.xp) {
    const current = rankFor(xp);
    const next = RANKS[RANKS.indexOf(current) + 1] || null;
    const span = next ? next.at - current.at : 1;
    return {
      current, next,
      into: xp - current.at,
      span,
      fraction: next ? Math.min(1, (xp - current.at) / span) : 1,
    };
  }

  /* ---------------- the shop ---------------- */

  function buy(itemId) {
    const item = SHOP_BY_ID[itemId];
    if (!item) return { ok: false, reason: 'unknown' };
    if (state.owned.includes(itemId)) return { ok: false, reason: 'owned' };
    if (state.coins < item.price) return { ok: false, reason: 'poor', short: item.price - state.coins };
    state.coins -= item.price;
    state.owned.push(itemId);
    equip(item.slot, itemId);   /* buying it and not seeing it is a bug, not restraint */
    save(); emit('buy', item);
    return { ok: true, item };
  }

  function equip(slot, itemId) {
    if (!SLOTS.includes(slot)) return false;
    if (slot === 'title') {
      /* A title has to be earned; wearing one you have not unlocked would make
         the whole display meaningless. */
      if (itemId && !earnedTitles().includes(itemId)) return false;
      state.equipped.title = itemId || '';
    } else {
      if (!state.owned.includes(itemId)) return false;
      state.equipped[slot] = itemId;
    }
    save(); emit('equip', { slot, itemId });
    return true;
  }

  const isOwned = id => state.owned.includes(id);
  const earnedTitles = () => state.achievements
    .map(id => (ACHIEVEMENT_BY_ID[id] || {}).title)
    .filter(Boolean);

  /* ---------------- achievements ---------------- */

  /* Derived from the record every time rather than incremented, so an imported
     snapshot unlocks exactly what it has earned and nothing can drift. */
  function recomputeAchievements() {
    const solved = Object.values(state.progress).filter(r => r.status === 'solved');
    const byTopic = {};
    for (const r of solved) byTopic[r.topic] = (byTopic[r.topic] || 0) + 1;

    const have = {
      'first-blood':  solved.length >= 1,
      'topic-5':      Object.values(byTopic).some(n => n >= 5),
      'topic-all':    TOPICS.every(t => byTopic[t.id] >= 1),
      'bug-hunter':   solved.filter(r => r.type === 'locate').length >= 5,
      'no-hints-10':  solved.filter(r => r.attempts === 1 && r.hintsUsed === 0).length >= 10,
      'advanced-5':   solved.filter(r => r.difficulty === 'advanced').length >= 5,
      'sanitizer-10': solved.filter(r => r.sanitized).length >= 10,
      'streak-7':     state.streak.longest >= 7,
      'streak-30':    state.streak.longest >= 30,
      'well-read':    readingCount() >= 20,
    };

    const added = [];
    for (const a of ACHIEVEMENTS) {
      if (have[a.id] && !state.achievements.includes(a.id)) {
        state.achievements.push(a.id);
        added.push(a);
      }
    }
    return added;
  }

  /* ---------------- stats ---------------- */

  function stats(catalog = []) {
    const all = Object.values(state.progress);
    const solved = all.filter(r => r.status === 'solved');

    const perTopic = {};
    for (const t of TOPICS) perTopic[t.id] = { total: 0, solved: 0, attempted: 0 };
    for (const p of catalog) if (perTopic[p.topic]) perTopic[p.topic].total += 1;
    for (const r of all) {
      const bucket = perTopic[r.topic];
      if (!bucket) continue;
      if (r.status === 'solved') bucket.solved += 1;
      else if (r.status === 'attempted') bucket.attempted += 1;
    }

    const perDifficulty = {};
    for (const d of DIFFICULTIES) {
      perDifficulty[d.id] = {
        total:  catalog.filter(p => p.difficulty === d.id).length,
        solved: solved.filter(r => r.difficulty === d.id).length,
      };
    }

    /* A day counts if anything was solved on it. */
    const days = {};
    for (const r of solved) if (r.solvedAt) days[r.solvedAt] = (days[r.solvedAt] || 0) + 1;

    return {
      xp: state.xp, coins: state.coins,
      solved: solved.length,
      attempted: all.filter(r => r.status === 'attempted').length,
      read: all.filter(r => r.status === 'read').length,
      total: catalog.length,
      rank: rankProgress(),
      streak: { ...state.streak },
      perTopic, perDifficulty, days,
      achievements: state.achievements.map(id => ACHIEVEMENT_BY_ID[id]).filter(Boolean),
      readings: readingCount(),
    };
  }

  /* ---------------- export ---------------- */

  /* The shape work-tracker's Store.normalizeProblem already accepts, so these
     import straight through its Data > Import solved problems with nothing new
     on that side. Identity is source + problemId, so re-importing is a no-op
     rather than a duplicate. */
  function exportSolves(catalog = []) {
    const byId = Object.fromEntries(catalog.map(p => [p.id, p]));
    return Object.values(state.progress)
      .filter(r => r.status === 'solved' || r.status === 'read')
      .map(r => {
        const p = byId[r.id] || {};
        const diff = DIFF_BY_ID[r.difficulty || p.difficulty];
        return {
          source:    'systems',
          problemId: r.id,
          title:     p.title || r.id,
          url:       '',
          level:     diff ? diff.level : null,
          tags:      p.tags || [],
          perceived: r.perceived,
          independence: r.revealed ? 'solution' : (r.hintsUsed > 0 ? 'hint' : 'independent'),
          attempts:  r.attempts,
          solvedAt:  r.solvedAt || todayISO(),
          minutes:   0,
          notes:     r.notes,
          lesson:    '',
        };
      });
  }

  const exportState = () => JSON.parse(JSON.stringify(state));

  function importState(raw) {
    state = normalize(raw);
    rollStreak();
    recomputeAchievements();
    save(); emit('import', state);
    return state;
  }

  function reset() {
    state = blankState();
    save(); emit('reset', state);
    return state;
  }

  /* ---------------- the judge's address ----------------
     Kept out of state so it never travels in an exported snapshot: where your
     judge listens is a property of the machine, not of your progress. */
  function setJudgeUrl(url) {
    config.judgeUrl = String(url || '').trim().replace(/\/+$/, '');
    try { localStorage.setItem(LS_JUDGE, config.judgeUrl); } catch {}
    emit('judge-url', config.judgeUrl);
    return config.judgeUrl;
  }
  function loadJudgeUrl() {
    try {
      const u = localStorage.getItem(LS_JUDGE);
      if (u) config.judgeUrl = u;
    } catch {}
    return config.judgeUrl;
  }

  /* ---------------- public surface ---------------- */

  return {
    init, save,
    on: fn => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    get state()  { return state; },
    get config() { return config; },
    setJudgeUrl, loadJudgeUrl,

    TOPICS, TOPIC_BY_ID, DIFFICULTIES, DIFF_BY_ID, RANKS,
    SHOP, SHOP_BY_ID, SLOTS, ACHIEVEMENTS, ACHIEVEMENT_BY_ID,
    FIRST_TRY_BONUS, HINT_PENALTY,

    todayISO, addDays, daysBetween,
    record, isSolved, potentialXp, touch,
    openHint, reveal, submit,
    setNotes, setPerceived, setFlag, setReview, saveDraft, draft, dueForReview,
    markReading, hasRead, readingCount,
    rankFor, rankProgress,
    buy, equip, isOwned, earnedTitles,
    recomputeAchievements, stats,
    exportSolves, exportState, importState, reset,
  };
})();
