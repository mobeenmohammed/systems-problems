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

  /* The site has been renamed twice: Bare Metal, then Systems Lab, now
     Invariant. The storage prefix follows the name, and every old prefix
     stays readable, newest first — see adopt() below. Nothing is ever
     deleted, which costs a few kilobytes and makes a rename reversible. */
  const NS = 'invariant';
  const OLD_NS = ['systems-lab', 'bare-metal'];

  const LS_KEY     = `${NS}/state/v1`;
  const LS_JUDGE   = `${NS}/judge-url`;
  /* Where hosted execution lives, kept beside the runner address for the
     same reason: it is a property of how this browser reaches a service,
     not of the reader's progress, so it never travels in an export. */
  const LS_HOSTED  = `${NS}/hosted-url`;
  const LS_JUDGE_TOKEN = `${NS}/judge-token`;
  /* Interface preferences — a panel split, focus mode — live under their own
     key rather than in the progress state. They are per-device and
     uninteresting, and keeping them out means a malformed pref can never
     corrupt a solve record or travel in an export. */
  const LS_PREFS = `${NS}/ui/v1`;

  /* Read a key under the current name, falling back through the old ones.
     Returns the raw string and which namespace it came from, so init() can
     say so and the settings keys can be copied across on first read.

     Suffix, not full key, because every key shares the prefix: 'state/v1'
     finds 'invariant/state/v1', then 'systems-lab/state/v1', and so on. */
  function readNS(suffix) {
    for (const ns of [NS, ...OLD_NS]) {
      let raw = null;
      try { raw = localStorage.getItem(`${ns}/${suffix}`); } catch { return { raw: null, from: null }; }
      if (raw !== null) return { raw, from: ns };
    }
    return { raw: null, from: null };
  }

  /* Settings are small and independent, so they are copied forward the
     first time they are read under the old name rather than waiting for
     something to write them. A failure here is not worth reporting: the
     value was still found, and the copy will be retried next load. */
  function adopt(suffix) {
    const { raw, from } = readNS(suffix);
    if (raw !== null && from && from !== NS) {
      try { localStorage.setItem(`${NS}/${suffix}`, raw); } catch { /* full or blocked */ }
    }
    return raw;
  }
  const CONFIG_URL = 'data/config.json';

  /* The coarsest division, and the one the top bar switches between. A
     subject is a property of the topic, so a problem cannot be filed under
     one and tagged with the other. */
  const SUBJECTS = [
    { id: 'systems', label: 'Systems', short: 'Systems',
      blurb: 'Low-level systems: C++, Rust, architecture, operating systems and the rest.' },
    { id: 'maths', label: 'Mathematics', short: 'Maths',
      blurb: 'Metric spaces and probability, with proofs and worked calculations.' },
  ];
  const SUBJECT_BY_ID = Object.fromEntries(SUBJECTS.map(s2 => [s2.id, s2]));

  const TOPICS = [
    { id: 'cpp',       label: 'C++',                      blurb: 'The language itself: initialisation, types, scope, linkage, and what the standard does and does not promise.' },
    { id: 'rust',      label: 'Rust',                     blurb: 'Ownership, borrowing, slices, and errors that have to be handled rather than ignored.' },
    { id: 'arch',      label: 'Computer Architecture',    blurb: 'Caches, pipelines, alignment, and what the hardware actually does.' },
    { id: 'os',        label: 'Operating Systems',        blurb: 'Processes, virtual memory, scheduling, concurrency.' },
    { id: 'linux',     label: 'Linux & Tooling',          blurb: 'The shell, file descriptors, syscalls, and reading a failure.' },
    { id: 'compilers', label: 'Compilers & Interpreters', blurb: 'Lexing, parsing, IR, optimisation, and undefined behaviour.' },
    { id: 'hpc',       label: 'HPC & Parallelism',        blurb: 'Roofline, locality, reductions, and why threads disappoint.' },
    { id: 'dist',      label: 'Distributed Systems',      blurb: 'Partitions, clocks, consensus, and delivery guarantees.' },
    { id: 'fpga',      label: 'FPGAs & Hardware',         blurb: 'LUTs and flops, timing closure, and HDL semantics.' },
    { id: 'algo',      label: 'Algorithms',               blurb: 'The classics, with a bias towards memory behaviour.' },
    { id: 'sysdesign', label: 'System Design',            blurb: 'Latency budgets, capacity, caching, and backpressure.' },

    { id: 'metric',    label: 'Metric Spaces',            subject: 'maths', blurb: 'Distance as an axiom rather than a formula: balls, open sets, convergence, completeness, continuity.' },
    { id: 'prob',      label: 'Probability',              subject: 'maths', blurb: 'Sample spaces, conditioning, independence, random variables and their expectations.' },
  ];
  /* Everything without an explicit subject is systems, which is where the
     site started and what the other eleven topics are. */
  for (const t of TOPICS) if (!t.subject) t.subject = 'systems';
  const TOPIC_BY_ID = Object.fromEntries(TOPICS.map(t => [t.id, t]));
  const topicsIn = subject => TOPICS.filter(t => t.subject === subject);

  /* Base points per difficulty. An Advanced problem is worth six Beginner
     ones, which is roughly the honest ratio of how long they take. */
  const DIFFICULTIES = [
    { id: 'beginner',     label: 'Beginner',     base: 10, level: 'easy'   },
    { id: 'intermediate', label: 'Intermediate', base: 25, level: 'medium' },
    { id: 'advanced',     label: 'Advanced',     base: 60, level: 'hard'   },
  ];
  const DIFF_BY_ID = Object.fromEntries(DIFFICULTIES.map(d => [d.id, d]));

  /* Orthogonal to difficulty: what a problem is for, not how hard it is. */
  const LANES = [
    { id: 'core',     label: 'Core',     note: 'Part of the curriculum. Tracks walk you through these.' },
    { id: 'optional', label: 'Optional', note: 'Worth doing, safe to skip. Nothing depends on it.' },
  ];
  const LANE_BY_ID = Object.fromEntries(LANES.map(l => [l.id, l]));

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

  /* "reviewed" is its own status and not a flavour of "solved", because a
     written proof the reader has compared against a rubric is real work and
     is NOT a machine saying the proof is right. Nothing upgrades it. */
  const STATUSES = ['unsolved', 'attempted', 'solved', 'read', 'reviewed'];

  let state  = null;
  let migratedFrom = null;
  let config = {
    judgeUrl: 'http://127.0.0.1:2000', judgeToken: '', pyodideUrl: '',
    hosted: { enabled: false, url: '', clientToken: '' },
  };
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
      selfReviewed: !!r.selfReviewed,
      rubric:    Array.isArray(r.rubric) ? r.rubric.slice() : [],
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
      /* A different note from `notes`, and deliberately so. `notes` is
         "what did this teach you", written whenever. `missed` is one
         line written immediately after getting it wrong, while you
         still know why — which is the only moment anybody ever
         actually knows. It is what the review queue shows. */
      missed:    typeof r.missed === 'string' ? r.missed : '',
      missedAt:  r.missedAt ? String(r.missedAt) : '',
      draft:     (r.draft && typeof r.draft === 'object') ? r.draft : {},
      /* Sliced on the way in as well as on the way out, so a snapshot
         written by a version with a larger cap cannot reinstate it. */
      subs:      (Array.isArray(r.subs) ? r.subs : []).slice(-SUBS_MAX).map(normalizeSubmission),
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

  /* ---------------- what you actually sent ----------------

     The record keeps `attempts` as a count, which answers "how many times"
     and nothing else. A submissions list answers the question that actually
     comes up a week later: what did I send, in which language, and what did
     it do? So each graded program is kept beside its verdict.

     Everything here is capped, because this is localStorage. A few kilobytes
     per submission across forty problems is how you fill the quota, and a
     full quota does not lose this feature - it loses the whole state file,
     including the XP. The caps are the price of that not happening. */
  const SUBS_MAX    = 10;     /* submissions kept per problem */
  const SUB_OUTCOMES = ['passed', 'failed', 'build-failed'];

  /* The program itself is NOT here any more. It lives in IndexedDB,
     through js/sources.js, keyed by this record's `at`.

     It used to be cut at 6,000 characters and the oldest ones dropped
     at 20,000 per problem, to protect the five-megabyte origin quota —
     a quota failure does not lose the submissions, it loses this whole
     file including the XP. But the only reason to keep a program is
     "load this one back", and a program cut in half cannot be loaded
     back. So the verdict stays here, forty bytes of it, and the
     program goes where there is room for it.

     The policy, in one sentence: the last ten verdicts per problem are
     kept, and a program is kept for exactly as long as its verdict is.
     Nothing is ever dropped to save space while its verdict is still
     on the list. */

  function normalizeSubmission(x) {
    x = x || {};
    const total = Math.max(0, Math.round(Number(x.total) || 0));
    return {
      at:   x.at ? String(x.at) : new Date().toISOString(),
      lang: x.lang ? String(x.lang) : '',
      /* A build failure is not a wrong answer, so it is not stored as one:
         reading it back as "failed" would be a claim about the program's
         output that nobody ever obtained. */
      outcome: SUB_OUTCOMES.includes(x.outcome) ? x.outcome : 'failed',
      passed:  Math.min(total, Math.max(0, Math.round(Number(x.passed) || 0))),
      total,
      ms:      Math.max(0, Math.round(Number(x.ms) || 0)),
      /* Where the program is, rather than the program. `stored` says a
         copy exists to be fetched; `bytes` lets the list say how big it
         is without fetching it. An old record may still carry `source`
         inline — those are the pre-migration ones, and they are read
         from here until the migration has copied them across. */
      stored: x.stored === undefined ? (typeof x.source === 'string') : !!x.stored,
      bytes: Math.max(0, Math.round(Number(x.bytes) || (typeof x.source === 'string' ? x.source.length : 0))),
      /* Kept, never written. See the migration in js/sources.js: the
         old copy is left where it is rather than deleted before the
         new one is proven. */
      source: typeof x.source === 'string' ? x.source : null,
      truncated: !!x.truncated,
    };
  }

  function pushSubmission(r, entry) {
    const e = normalizeSubmission(entry);
    const source = typeof entry.source === 'string' ? entry.source : null;
    /* The verdict records that there is a program and how big it is;
       the program goes to the vault. No cap: that is the point. */
    e.source = null;
    e.truncated = false;
    e.stored = source != null;
    e.bytes = source ? source.length : 0;

    r.subs.push(e);
    const gone = [];
    while (r.subs.length > SUBS_MAX) gone.push(r.subs.shift());

    if (typeof Sources !== 'undefined') {
      if (source != null) {
        Sources.put(r.id, e.at, source).then(w => {
          if (!w || w.ok) return;
          /* It could not be written anywhere durable. Say so on the
             record rather than leaving a Load button that will not
             work. */
          e.stored = false;
          e.storeError = w.error || 'it could not be saved';
          save();
          emit('storage', { what: 'submission', id: r.id, error: e.storeError });
        });
      }
      /* A program is dropped only once its verdict has rolled off the
         list. Nothing is pruned while it is still shown. */
      if (gone.length) Sources.prune(r.id, r.subs.map(x => x.at));
    }
    return e;
  }

  /* Newest first, which is the order anybody reads them in. */
  const submissions = id => record(id).subs.slice().reverse();

  function save() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (err) {
      /* Out of room. Something has to give, and WHICH thing is a
         decision worth writing down:

           · not the drafts. A draft is work in progress and it is the
             only copy of it. Throwing away what somebody is in the
             middle of writing, to make room for the record of what they
             finished last week, is the wrong way round.
           · not the newest verdicts, which are what the Submissions
             tab is for.
           · the oldest verdicts beyond the newest few, which is a
             history and is prunable by nature.

         The programs are not in here at all any more, which is why
         this is now a rare path rather than the common one. */
      if (shedOldestVerdicts()) {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(state));
          emit('storage-trimmed', { kept: SUBS_KEEP_WHEN_FULL });
          return true;
        } catch { /* genuinely full; fall through and say so */ }
      }
      /* A failed write means the rest of the session is lost silently on the
         next reload, which is worse than being told about it now. */
      emit('storage-error', err);
      return false;
    }
    return true;
  }

  /* How many verdicts per problem survive a full quota. Three rather
     than one, because "the last three attempts" is still a history and
     one is not. */
  const SUBS_KEEP_WHEN_FULL = 3;

  function shedOldestVerdicts() {
    let shed = false;
    for (const r of Object.values(state.progress)) {
      const subs = r.subs || [];
      if (subs.length <= SUBS_KEEP_WHEN_FULL) continue;
      const dropped = subs.splice(0, subs.length - SUBS_KEEP_WHEN_FULL);
      shed = true;
      /* Their programs go with them — a program is kept for exactly as
         long as its verdict, and that rule holds here too. */
      if (typeof Sources !== 'undefined' && dropped.length) {
        Sources.prune(r.id, subs.map(x => x.at));
      }
    }
    /* Pre-migration records may still carry a program inline. Those are
       the largest thing left and the cheapest to lose, since the vault
       has a copy. */
    if (!shed) {
      for (const r of Object.values(state.progress)) {
        for (const x of r.subs || []) if (x.source != null) { x.source = null; shed = true; }
      }
    }
    return shed;
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

    /* Preferences are cached after the first read, so init has to drop that
       cache or "start again" quietly keeps the last run's panel sizes and
       editor settings. The page only ever inits once, so this costs
       nothing there; it is the tests, and anything that re-inits, that
       were being lied to. */
    prefs = null;

    /* Per-init: otherwise a second load in the same page claims a migration
       that happened once, long ago. */
    migratedFrom = null;

    /* Anyone who had solved anything under an old name would otherwise open
       the renamed site to an empty profile. readNS tries each prefix in
       turn, newest first, so a reader who has been here since Bare Metal
       keeps everything through both renames. A corrupt old key is skipped
       rather than migrated. */
    let raw = null;
    const found = readNS('state/v1');
    if (found.raw !== null) {
      try {
        raw = JSON.parse(found.raw);
        if (found.from !== NS) migratedFrom = found.from;
      } catch { raw = null; }
    }

    state = normalize(raw);
    if (migratedFrom) save();
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

    /* Only when the caller handed over a program. For a multiple-choice
       answer there is nothing to keep that the record does not already say,
       and a submissions list of ten identical rows reading "B" would be
       storage spent on nothing. */
    if (typeof result.source === 'string' && result.source.trim()) {
      pushSubmission(r, {
        lang: result.lang,
        source: result.source,
        ms: result.ms,
        passed: result.passed,
        total: result.total,
        outcome: result.built === false
          ? 'build-failed'
          : (result.correct ? 'passed' : 'failed'),
      });
    }

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

  function setMissed(problem, text) {
    const r = touch(problem);
    const was = r.missed;
    r.missed = String(text);
    /* Stamped only when it changes from nothing to something, so the
       queue can order by "when did I last get this wrong and say why"
       rather than by when the textarea last lost focus. */
    if (!was && r.missed.trim()) r.missedAt = new Date().toISOString();
    if (!r.missed.trim()) r.missedAt = '';
    save();
    return r.missed;
  }
  function setPerceived(problem, n) { const r = touch(problem); r.perceived = n >= 1 && n <= 5 ? Math.round(n) : null; save(); }
  function setFlag(problem, on)     { const r = touch(problem); r.flagged = !!on; save(); emit('flag', r); }
  /* The catalogue bookmarks from a row, where there is no "on" to pass -
     only the problem and the fact that it was clicked. */
  function toggleFlag(problem)      { const now = !record(problem.id).flagged; setFlag(problem, now); return now; }
  function setReview(problem, days) {
    const r = touch(problem);
    r.reviewOn = days > 0 ? addDays(todayISO(), days) : '';
    save(); emit('review', r);
  }
  /* A written proof, reviewed by the person who wrote it against the
     problem's rubric. It pays out like a solve — the site already trusts
     the reader to tick a reading they have read — and it is recorded under
     a status of its own, so "I checked my own proof" can never be read back
     as "a grader verified this". */
  function selfReview(problem, { rubric = [] } = {}) {
    const r = touch(problem);
    const already = r.status === 'solved' || r.status === 'reviewed';
    r.selfReviewed = true;
    r.rubric = rubric.slice();
    r.attempts = (r.attempts || 0) + 1;
    r.lastAt = todayISO();
    if (r.status !== 'solved') r.status = 'reviewed';

    let xp = 0;
    let coins = 0;
    if (!already && !r.revealed) {
      xp = potentialXp(problem);
      coins = Math.max(1, Math.round(xp / 5));
      state.xp += xp;
      state.coins += coins;
      r.xpEarned = xp;
      const today = todayISO();
      if (state.streak.lastDay !== today) {
        const gap = state.streak.lastDay ? daysBetween(state.streak.lastDay, today) : Infinity;
        state.streak.current = gap === 1 ? state.streak.current + 1 : 1;
        state.streak.lastDay = today;
        state.streak.longest = Math.max(state.streak.longest, state.streak.current);
      }
    }
    save();
    emit('self-review', r);
    return { xp, coins, alreadyDone: already };
  }

  /* Where drafts go. Normally into the problem's own record; during an
     assessment attempt, into that attempt instead.

     A hook rather than a branch in the editor, because the editor has
     no business knowing what mode the page is in — it saves on every
     keystroke and reads on every mount, and both have to be
     synchronous. The attempt supplies a synchronous view of itself and
     writes through to its own durable store behind that. Drafts kept
     here would also be the WRONG drafts: practice work on the same
     problem id is a different thing from what was written under a
     clock, and neither should overwrite the other. */
  let draftStore = null;

  function useDraftStore(hooks) {
    draftStore = hooks || null;
    return draftStore;
  }

  function saveDraft(problem, lang, source) {
    const id = problem && problem.id ? problem.id : problem;
    if (draftStore) { draftStore.set(id, lang, String(source)); return; }
    const r = touch(problem);
    r.draft[lang] = String(source);
    save();
  }

  const draft = (id, lang) => (draftStore
    ? (draftStore.get(id, lang) || '')
    : ((record(id).draft || {})[lang] || ''));

  /* Which language the reader last chose for this problem. It used to be
     written only on submit, so choosing Rust and then pressing Run put you
     back in C++: the page redraws after a run, and the redraw reads this. */
  function setLang(problem, lang) {
    /* Inside an attempt the choice belongs to the attempt, not to a
       practice record that is not being written. */
    if (draftStore && draftStore.setLang) {
      return draftStore.setLang(problem && problem.id ? problem.id : problem, lang);
    }
    const r = touch(problem);
    r.lang = String(lang || '');
    save();
    return r.lang;
  }

  /* Anything flagged by hand, or booked for a revisit that has come due. */
  function dueForReview() {
    const today = todayISO();
    return Object.values(state.progress)
      .filter(r => r.flagged || (r.reviewOn && r.reviewOn <= today))
      .map(r => ({ ...r, reason: r.flagged ? 'flagged' : 'due' }));
  }

  /* ---------------- the review queue ----------------

     Five reasons, and every row carries the one that put it there.
     That is the whole design: a queue that says "revise this" and not
     why is a queue nobody trusts, and the obvious fix — a single
     number per problem — is worse, because a mastery score is an
     opinion with no argument attached. These are facts about things
     you did.

     In priority order, because a problem can have several and the
     most actionable should be the one shown:

       due        you booked a revisit and the date has arrived
       missed     you wrote down what you got wrong
       wrong      attempted and not solved
       read       you revealed the answer rather than solving it
       flagged    you bookmarked it

     "Marked difficult" is folded into `missed` and `wrong` via the
     felt rating, which is carried on every row as `perceived` — your
     own figure, never mixed with the grader's. */

  const REVIEW_REASONS = [
    { id: 'due', label: 'Due for revisit',
      why: 'You booked this one for a revisit and the date has come.' },
    { id: 'missed', label: 'You wrote down what you missed',
      why: 'There is a note on this one from the last time you got it wrong.' },
    { id: 'wrong', label: 'Attempted, not solved',
      why: 'You have had a go at this and it is not right yet.' },
    { id: 'read', label: 'You read the answer',
      why: 'The solution was revealed rather than reached, so this one is '
        + 'worth doing again from scratch.' },
    { id: 'flagged', label: 'You bookmarked it',
      why: 'You starred this one to come back to.' },
  ];
  const REVIEW_BY_ID = Object.fromEntries(REVIEW_REASONS.map(r => [r.id, r]));

  function reviewQueue() {
    const today = todayISO();
    const out = [];
    for (const r of Object.values(state.progress)) {
      const due = !!(r.reviewOn && r.reviewOn <= today);
      const reasons = [];
      if (due) reasons.push('due');
      if (r.missed && r.missed.trim()) reasons.push('missed');
      if (r.status === 'attempted') reasons.push('wrong');
      if (r.status === 'read') reasons.push('read');
      if (r.flagged) reasons.push('flagged');
      if (!reasons.length) continue;
      out.push({
        id: r.id,
        reason: reasons[0],
        reasons,
        /* Your own rating, kept apart from anything a grader said.
           1..5 or null, and null means you never said. */
        perceived: r.perceived,
        missed: r.missed,
        missedAt: r.missedAt,
        status: r.status,
        attempts: r.attempts,
        reviewOn: r.reviewOn,
        lastAt: r.missedAt || r.lastAttemptAt || '',
      });
    }
    const rank = id => REVIEW_REASONS.findIndex(x => x.id === id);
    return out.sort((a, b) =>
      rank(a.reason) - rank(b.reason)
      || String(b.lastAt).localeCompare(String(a.lastAt))
      || a.id.localeCompare(b.id));
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
  /* Turning hosted execution on is one field: a URL. Blank turns it off,
     which is why there is no separate switch to get out of step with it. */
  function setHostedUrl(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    config.hosted = { ...(config.hosted || {}), url: clean, enabled: !!clean };
    try {
      if (clean) localStorage.setItem(LS_HOSTED, clean);
      else localStorage.removeItem(LS_HOSTED);
    } catch { /* storage blocked; it just will not persist */ }
    emit('hosted-url', clean);
    return clean;
  }

  function setJudgeUrl(url) {
    config.judgeUrl = String(url || '').trim().replace(/\/+$/, '');
    try { localStorage.setItem(LS_JUDGE, config.judgeUrl); } catch {}
    emit('judge-url', config.judgeUrl);
    return config.judgeUrl;
  }
  function loadJudgeUrl() {
    try {
      /* adopt(), not getItem(): a runner address set under the old name is
         still this browser's runner address, and losing it to a rename
         would send someone to Settings to retype something they had
         already configured. */
      const u = adopt('judge-url');
      if (u) config.judgeUrl = u;
      const t = adopt('judge-token');
      if (t) config.judgeToken = t;
      const h = adopt('hosted-url');
      if (h) config.hosted = { ...(config.hosted || {}), url: h, enabled: true };
    } catch {}
    return config.judgeUrl;
  }

  /* Only needed when the page is served from somewhere that cannot see the
     runner's token file. Kept out of state so it never travels in an export. */
  /* ---------------- interface preferences ----------------

     Separate from progress on purpose: see LS_PREFS above. Reads are tolerant
     of a missing or corrupt value, because a browser with storage blocked is
     a legitimate way to use the page and must not lose the whole view. */

  let prefs = null;

  function loadPrefs() {
    if (prefs) return prefs;
    prefs = {};
    try {
      const raw = adopt('ui/v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') prefs = parsed;
      }
    } catch { /* blocked or corrupt: the defaults are fine */ }
    return prefs;
  }

  function pref(key, fallback = null) {
    const all = loadPrefs();
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
  }

  /* ---------------- editor completion ----------------

     A master switch and a per-language override, both defaulting to on.
     Kept here rather than read straight out of prefs by the editor so
     that "is completion on for Rust" has exactly one answer, and so the
     default survives a prefs blob written by an older version. */

  const COMPLETION_LANGS = ['cpp', 'python', 'js', 'rust'];

  function completionPref() {
    const raw = pref('completion', null);
    const on = !raw || raw.on !== false;
    const langs = {};
    for (const id of COMPLETION_LANGS) {
      langs[id] = !(raw && raw.langs && raw.langs[id] === false);
    }
    return { on, langs };
  }

  function completionOn(lang) {
    const c = completionPref();
    /* An unknown language has no completion source anyway; saying true
       here keeps the caller from having to know that. */
    if (!Object.prototype.hasOwnProperty.call(c.langs, lang)) return c.on;
    return c.on && c.langs[lang];
  }

  function setCompletion(patch) {
    const now = completionPref();
    const next = {
      on: patch.on === undefined ? now.on : !!patch.on,
      langs: { ...now.langs, ...(patch.langs || {}) },
    };
    setPref('completion', next);
    return next;
  }

  function setPref(key, value) {
    const all = loadPrefs();
    if (value === null || value === undefined) delete all[key];
    else all[key] = value;
    try { localStorage.setItem(LS_PREFS, JSON.stringify(all)); } catch { /* ignore */ }
    return value;
  }

  function setJudgeToken(t) {
    config.judgeToken = String(t || '').trim();
    try {
      if (config.judgeToken) localStorage.setItem(LS_JUDGE_TOKEN, config.judgeToken);
      else localStorage.removeItem(LS_JUDGE_TOKEN);
    } catch {}
    emit('judge-token', config.judgeToken);
    return config.judgeToken;
  }

  /* ---------------- public surface ---------------- */

  return {
    init, save,
    on: fn => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    get state()  { return state; },
    get config() { return config; },
    get migratedFrom() { return migratedFrom; },
    setJudgeUrl, loadJudgeUrl, setJudgeToken, setHostedUrl, pref, setPref,

    SUBJECTS, SUBJECT_BY_ID, topicsIn,
    TOPICS, TOPIC_BY_ID, DIFFICULTIES, DIFF_BY_ID, LANES, LANE_BY_ID, RANKS,
    SHOP, SHOP_BY_ID, SLOTS, ACHIEVEMENTS, ACHIEVEMENT_BY_ID,
    FIRST_TRY_BONUS, HINT_PENALTY,

    todayISO, addDays, daysBetween,
    record, isSolved, potentialXp, touch,
    submissions, SUBS_MAX, SUBS_KEEP_WHEN_FULL,
    openHint, reveal, submit,
    setNotes, setMissed, setPerceived, setFlag, toggleFlag, setReview, saveDraft, setLang, draft, dueForReview, selfReview,
    reviewQueue, REVIEW_REASONS, REVIEW_BY_ID,
    useDraftStore,
    completionPref, completionOn, setCompletion, COMPLETION_LANGS,
    markReading, hasRead, readingCount,
    rankFor, rankProgress,
    buy, equip, isOwned, earnedTitles,
    recomputeAchievements, stats,
    exportSolves, exportState, importState, reset,
  };
})();
