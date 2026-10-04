import io

# ---------------------------------------------------------------- validator
p = 'scripts/build-index.mjs'
s = io.open(p, encoding='utf-8').read()

s = s.replace("""export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];""",
"""export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

/* A lane is orthogonal to difficulty. Difficulty says how hard a problem is;
   a lane says what it is FOR. "core" is the curriculum — the problems a track
   walks you through. "optional" is enrichment you can skip without leaving a
   hole. Weekly is neither: it is a schedule in data/weekly.json that points at
   a problem in one of these lanes, so a problem is never "a weekly problem"
   instead of being Beginner. */
export const LANES = ['core', 'optional'];""", 1)

s = s.replace("""    if (!DIFFICULTIES.includes(p.difficulty)) err(where, `unknown difficulty "${p.difficulty}"`);""",
"""    if (!DIFFICULTIES.includes(p.difficulty)) err(where, `unknown difficulty "${p.difficulty}"`);
    /* Absent means core, so existing problems need no edit — but a typo is
       caught rather than silently creating a third lane. */
    if (p.lane !== undefined && !LANES.includes(p.lane)) err(where, `unknown lane "${p.lane}"`);""", 1)

s = s.replace("""const INDEX_FIELDS = ['id', 'title', 'topic', 'difficulty', 'type', 'tags', 'estimate'];""",
"""const INDEX_FIELDS = ['id', 'title', 'topic', 'difficulty', 'lane', 'type', 'tags', 'estimate'];""", 1)

s = s.replace("""      row.tags = p.tags || [];""",
"""      row.tags = p.tags || [];
      row.lane = p.lane || 'core';""", 1)

# A code problem that offers Python should be checked for it, and a problem
# stating platform assumptions is better than one assuming silently.
s = s.replace("""      if (!Array.isArray(pay.cases) || !pay.cases.length) err(where, 'code needs at least one visible case');""",
"""      if (!Array.isArray(pay.cases) || !pay.cases.length) err(where, 'code needs at least one visible case');
      /* Anything whose answer depends on type widths, byte order or alignment
         has to say what it is assuming, or the "right" answer is a guess about
         the reader's machine. */
      const needsPlatform = /sizeof|endian|byte|alignment|width|bits|cache|address/i
        .test(`${p.title} ${(p.tags || []).join(' ')}`);
      if (needsPlatform && !/assume|assumption|64-bit|little-endian|bytes per|platform/i.test(String(p.statement))) {
        err(where, 'this problem depends on platform details but the statement states no assumptions');
      }""", 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('build-index.mjs: lanes + platform-assumption check')

# ---------------------------------------------------------------- store
p = 'js/store.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace("""  const DIFF_BY_ID = Object.fromEntries(DIFFICULTIES.map(d => [d.id, d]));""",
"""  const DIFF_BY_ID = Object.fromEntries(DIFFICULTIES.map(d => [d.id, d]));

  /* Orthogonal to difficulty: what a problem is for, not how hard it is. */
  const LANES = [
    { id: 'core',     label: 'Core',     note: 'Part of the curriculum. Tracks walk you through these.' },
    { id: 'optional', label: 'Optional', note: 'Worth doing, safe to skip. Nothing depends on it.' },
  ];
  const LANE_BY_ID = Object.fromEntries(LANES.map(l => [l.id, l]));""", 1)
s = s.replace("    TOPICS, TOPIC_BY_ID, DIFFICULTIES, DIFF_BY_ID, RANKS,",
              "    TOPICS, TOPIC_BY_ID, DIFFICULTIES, DIFF_BY_ID, LANES, LANE_BY_ID, RANKS,", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('store.js: LANES')

# ---------------------------------------------------------------- catalog filter
p = 'js/catalog.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace("""      if (filter.type       && p.type       !== filter.type)       return false;""",
"""      if (filter.type       && p.type       !== filter.type)       return false;
      if (filter.lane       && (p.lane || 'core') !== filter.lane)  return false;""", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('catalog.js: lane filter')
