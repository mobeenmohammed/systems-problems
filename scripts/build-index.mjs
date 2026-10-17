/* ============================================================
   build-index.mjs — generate data/index.json from problems/,
   validating everything on the way through.

     node scripts/build-index.mjs           write the index
     node scripts/build-index.mjs --check   verify it is current

   The index carries metadata only. Statements, hints and payloads
   stay in the problem files and are fetched when a problem is
   opened, so the catalog costs one small request however many
   problems there are.

   --check is what CI runs: it regenerates in memory and fails if
   the committed index differs, which makes a stale index
   impossible to ship. The validation is exported so
   tests/content.test.mjs can drive it without writing anything.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* A subject is the coarsest division: the thing a reader is studying, as
   opposed to the topic within it. It is DERIVED from the topic rather than
   being a second field on every problem, because two fields that have to
   agree eventually disagree. */
export const SUBJECTS = ['systems', 'maths'];

export const TOPIC_SUBJECT = {
  cpp: 'systems', rust: 'systems', arch: 'systems', os: 'systems',
  linux: 'systems', compilers: 'systems', hpc: 'systems', dist: 'systems',
  fpga: 'systems', algo: 'systems', sysdesign: 'systems',
  metric: 'maths', prob: 'maths',
};

export const TOPICS = Object.keys(TOPIC_SUBJECT);

export const subjectOf = topic => TOPIC_SUBJECT[topic] || 'systems';
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

/* A lane is orthogonal to difficulty. Difficulty says how hard a problem is;
   a lane says what it is FOR. "core" is the curriculum — the problems a track
   walks you through. "optional" is enrichment you can skip without leaving a
   hole. Weekly is neither: it is a schedule in data/weekly.json that points at
   a problem in one of these lanes, so a problem is never "a weekly problem"
   instead of being Beginner. */
export const LANES = ['core', 'optional'];
export const TYPES = [
  'mcq', 'multi', 'numeric', 'short', 'order', 'match', 'predict', 'locate', 'code',
  /* Mathematics. `exact` and `approx` are deliberately two types rather than
     one with a flag: whether an answer is being checked exactly or to a
     stated tolerance is something the reader must be told, and a type is
     harder to forget than a field. */
  'exact', 'approx', 'structured', 'proofsteps', 'counterexample', 'proof',
  /* Hardware. A module to write, a testbench to run it against, and a
     waveform. Not `code` with a language of its own, because almost
     nothing about it is shared: two sources rather than one, a grading
     testbench rather than a list of stdin/expect pairs, and a result
     that is a set of named checks rather than a diff. */
  'hdl',
];
/* `sv` is a language the catalogue filters by — there are four
   exercises you write in it — but it is not a language a `code` problem
   may declare: it has its own type, its own toolchain and its own
   workspace. CODE_LANGS is what a code problem may ask for; LANGS is
   what the filter offers. */
export const CODE_LANGS = ['js', 'python', 'cpp', 'rust'];
export const LANGS = [...CODE_LANGS, 'sv'];
export const PROFILES = ['standard', 'sanitize', 'strict', 'parallel'];

/* Which pool a problem belongs to. "practice" is the catalogue — the
   thing #/problems lists and every count on the site is a count of.
   "assessment" is the separate bank the timed mode draws from: the same
   schema, the same validation, the same reference-solution checking, and
   a different file.

   Separate because an assessment problem you have already met in
   practice is not an assessment. Writing it as a field on the problem
   rather than as a directory convention means the whole of this
   script's validation applies to both without a second copy of it. */
export const POOLS = ['practice', 'assessment'];
export const poolOf = p => (p && p.pool) || 'practice';

/* The fields the catalog needs to list, search and filter. Everything else
   stays in the problem file. */
const INDEX_FIELDS = ['id', 'title', 'topic', 'subject', 'difficulty', 'lane', 'type', 'tags', 'estimate',
  /* A debugging challenge: the starter is a complete program that is
     wrong, and the exercise is to find out why. Not a type — it is an
     ordinary code or hdl problem in every other respect — so it rides
     as a flag the catalogue can filter and badge. */
  'debugging'];

/* The two characters a mis-escaped newline leaves behind. Built from a char
   code rather than written as an escape so that there is no backslash in this
   file to be eaten by whatever is editing it — which is how the bug this
   guards against got in. */
const LITERAL_NL = String.fromCharCode(92) + 'n';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/* The real expression engine, loaded the same way the browser loads it, so
   that an answer key is validated by the thing that will actually grade it
   rather than by a second implementation that can drift from it. */
const MATHS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'js/maths/expr.js'), 'utf8');
  // eslint-disable-next-line no-new-func -- our own file, read from disk at
  // build time; this is not user input and never reaches a browser.
  return new Function(`${src}; return MathsExpr;`)();
})();

/* ---------------- loading ---------------- */

export function loadAll() {
  const problems = [];
  const files = [];

  const dir = path.join(ROOT, 'problems');
  for (const topic of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const topicDir = path.join(dir, topic);
    if (!fs.statSync(topicDir).isDirectory()) continue;
    for (const name of fs.readdirSync(topicDir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(topicDir, name);
      files.push(path.relative(ROOT, file));
      problems.push({ ...readJson(file), __file: path.relative(ROOT, file), __topicDir: topic, __name: name });
    }
  }

  const conceptsPath = path.join(ROOT, 'data/concepts.json');
  const concepts = fs.existsSync(conceptsPath) ? readJson(conceptsPath) : {};

  const solutions = {};
  const solDir = path.join(ROOT, 'solutions');
  for (const name of fs.existsSync(solDir) ? fs.readdirSync(solDir) : []) {
    if (!name.endsWith('.json')) continue;
    solutions[name.replace(/\.json$/, '')] = readJson(path.join(solDir, name));
  }

  return { problems, concepts, solutions, files };
}

/* ---------------- validation ---------------- */

/* Returns a list of human-readable problems with the content. Nothing throws:
   the caller decides whether to print and exit or to count failures. */
export function validate({ problems, concepts, solutions }) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  /* --- the concept graph, first, because problems point into it --- */
  for (const [id, c] of Object.entries(concepts)) {
    const where = `concepts.json/${id}`;
    if (!c || typeof c !== 'object') { err(where, 'is not an object'); continue; }
    if (!c.name) err(where, 'has no name');
    if (!c.oneLine) err(where, 'has no oneLine — the Prerequisites tab shows it');
    if (c.topic && !TOPICS.includes(c.topic)) err(where, `unknown topic "${c.topic}"`);
    for (const need of c.needs || []) {
      if (!concepts[need]) err(where, `needs "${need}", which does not exist`);
    }
    if (!Array.isArray(c.readings) || !c.readings.length) {
      err(where, 'has no readings — a prerequisite with nowhere to read it is the one thing this site must not ship');
    }
    for (const [i, rd] of (c.readings || []).entries()) {
      if (!rd.title) err(where, `reading ${i} has no title`);
      if (!rd.where && !rd.url) err(where, `reading ${i} says neither where nor url`);
      if (rd.url && !/^https?:\/\//.test(rd.url)) err(where, `reading ${i} has a non-http url`);
    }
  }

  /* A cycle would make the Prerequisites chain meaningless, and though the
     page tolerates one it should never be committed. */
  for (const id of Object.keys(concepts)) {
    const seen = new Set();
    const stack = [];
    (function walk(at) {
      if (stack.includes(at)) {
        err(`concepts.json/${id}`, `prerequisite cycle: ${[...stack, at].join(' -> ')}`);
        return;
      }
      if (seen.has(at) || !concepts[at]) return;
      seen.add(at);
      stack.push(at);
      for (const n of concepts[at].needs || []) walk(n);
      stack.pop();
    })(id);
  }

  /* --- problems --- */
  const ids = new Set();
  for (const p of problems) {
    const where = p.__file || p.id || '(unknown file)';

    if (!p.id) { err(where, 'has no id'); continue; }
    if (ids.has(p.id)) err(where, `duplicate id "${p.id}"`);
    ids.add(p.id);

    if (p.__name && p.__name !== `${p.id}.json`) {
      err(where, `id "${p.id}" does not match the filename`);
    }
    if (p.__topicDir && p.topic !== p.__topicDir) {
      err(where, `topic "${p.topic}" does not match the directory "${p.__topicDir}"`);
    }
    if (!p.title) err(where, 'has no title');
    if (!TOPICS.includes(p.topic)) err(where, `unknown topic "${p.topic}"`);
    if (!DIFFICULTIES.includes(p.difficulty)) err(where, `unknown difficulty "${p.difficulty}"`);
    /* Absent means core, so existing problems need no edit — but a typo is
       caught rather than silently creating a third lane. */
    if (p.lane !== undefined && !LANES.includes(p.lane)) err(where, `unknown lane "${p.lane}"`);
    if (!TYPES.includes(p.type)) err(where, `unknown type "${p.type}"`);
    if (!p.statement) err(where, 'has no statement');
    if (p.tags && !Array.isArray(p.tags)) err(where, 'tags is not an array');
    if (p.hints && !Array.isArray(p.hints)) err(where, 'hints is not an array');
    if (p.debugging !== undefined && p.debugging !== true) {
      err(where, 'debugging is a flag: set it to true or leave it out');
    }
    /* A debugging challenge has to say so in the statement, or a reader
       meets a wrong program with no warning and concludes the site is
       broken rather than the exercise. */
    if (p.debugging && !/already written, and it is wrong/i.test(String(p.statement || ''))) {
      err(where, 'a debugging problem must say in its statement that the starter is wrong');
    }

    /* The prerequisites tab is the reason this site exists, so a problem
       without any is a content bug rather than a style choice. */
    if (!Array.isArray(p.prereqs) || !p.prereqs.length) {
      err(where, 'has no prereqs');
    }
    for (const pre of p.prereqs || []) {
      if (!pre.concept) err(where, 'a prereq has no concept id');
      else if (!concepts[pre.concept]) err(where, `prereq "${pre.concept}" is not in concepts.json`);
      if (!pre.why) err(where, `prereq "${pre.concept}" does not say why it is needed here`);
    }

    validatePayload(p, err, where);

    /* --- its solution --- */
    const sol = solutions[p.id];
    if (!sol) { err(where, 'has no solutions/ file'); continue; }
    const swhere = `solutions/${p.id}.json`;
    if (sol.id && sol.id !== p.id) err(swhere, `id "${sol.id}" does not match the problem`);
    if (!sol.explanation) err(swhere, 'has no explanation — the teaching is the point');
    if (!sol.key) err(swhere, 'has no key');
    else validateKey(p, sol, err, swhere);

    for (const m of sol.readMore || []) {
      if (m.concept && !concepts[m.concept]) err(swhere, `readMore points at unknown concept "${m.concept}"`);
    }
  }

  /* A solution with no problem is dead weight and usually a rename gone half
     done, which is worth catching early. */
  for (const id of Object.keys(solutions)) {
    if (!ids.has(id)) err(`solutions/${id}.json`, 'has no matching problem');
  }

  return errors;
}

/* Does this testbench print a check called `name`?

   Literally, usually — `$display("CHECK wraps %0d ...")`. But a
   testbench that walks a truth table prints its names with a format
   string:

     $display("CHECK row%0d_sel%0b_a%0b_b%0b %0b %0b AT %0d", ...)

   which produces `row3_sel0_a1_b1` and is not findable by searching
   for the literal. Unrolling the loop into eight copies to satisfy a
   checker would be letting the checker write the content.

   So a format specifier stands for one run of word characters, and the
   name has to match the whole shape. `row%0d_sel%0b` matches
   `row3_sel0` and does not match `rowsel` or `counted` — which keeps
   the check doing its job, which is to catch a name in the key that
   nothing prints. */
const printsCheck = (source, name) => {
  const text = String(source || '');
  if (new RegExp(`CHECK\\s+${name}\\b`).test(text)) return true;
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of text.matchAll(/CHECK\s+(\S+)/g)) {
    const spec = m[1];
    if (!spec.includes('%')) continue;
    /* A specifier stands for what %d, %b, %h and %s actually print:
       digits and letters. NOT a word-character class, which includes
       the underscore and so swallows the separators — `row%0d_sel%0b`
       would then match `row3_sel0_a1_b1_extra`, and a key could name
       a check nothing prints and still pass. */
    const shape = spec.split(/%[-0-9.]*[a-zA-Z]/).map(esc).join('[A-Za-z0-9]+');
    if (new RegExp(`^${shape}$`).test(name)) return true;
  }
  return false;
};

function validatePayload(p, err, where) {
  const pay = p.payload || {};

  switch (p.type) {
    case 'mcq':
    case 'multi':
      if (!Array.isArray(pay.options) || pay.options.length < 2) {
        err(where, `${p.type} needs at least two options`);
      }
      break;

    case 'order':
      if (!Array.isArray(pay.items) || pay.items.length < 3) {
        err(where, 'order needs at least three items');
      }
      break;

    case 'match':
      if (!Array.isArray(pay.left) || !Array.isArray(pay.right)) err(where, 'match needs left and right');
      break;

    case 'locate':
      if (!pay.code) err(where, 'locate needs code');
      break;

    case 'code':
      if (!Array.isArray(pay.langs) || !pay.langs.length) err(where, 'code needs langs');
      for (const l of pay.langs || []) {
        if (!CODE_LANGS.includes(l)) err(where, `unknown lang "${l}" for a code problem`);
      }
      if (pay.profile && !PROFILES.includes(pay.profile)) err(where, `unknown profile "${pay.profile}"`);
      if (!Array.isArray(pay.cases) || !pay.cases.length) err(where, 'code needs at least one visible case');
      /* A problem whose answer depends on type widths, byte order or
         alignment has to say what it assumes, or the "right" answer is a guess
         about the reader's machine. The trigger is deliberately narrow — words
         that only appear when the machine really is load-bearing — and an
         explicit payload.platform note also satisfies it. */
      const loadBearing = /sizeof|endian|alignment|word size|bit-width|two's complement/i
        .test(`${p.title} ${String(p.statement)} ${(p.tags || []).join(' ')}`);
      const statesIt = pay.platform
        || /assume|assumption|64-bit|little-endian|bytes per|platform/i.test(String(p.statement));
      if (loadBearing && !statesIt) {
        err(where, 'the answer depends on platform details but nothing states the assumptions '
          + '(say so in the statement, or set payload.platform)');
      }
      for (const [i, c] of (pay.cases || []).entries()) {
        if (typeof c.stdin !== 'string') err(where, `case ${i} has no stdin string`);
        if (typeof c.expect !== 'string') err(where, `case ${i} has no expect string`);
        if (typeof c.expect === 'string' && c.expect.includes(LITERAL_NL)) {
          err(where, `visible case ${i} expect contains a literal backslash-n`);
        }
      }
      break;

    case 'hdl':
      if (!pay.top) err(where, 'hdl needs payload.top — the module the testbench instantiates');
      if (!pay.template) err(where, 'hdl needs payload.template: the design starter');
      if (!pay.testbench) err(where, 'hdl needs payload.testbench: the sample testbench Run uses');
      if (!Array.isArray(pay.checks) || !pay.checks.length) {
        err(where, 'hdl needs payload.checks: the names the SAMPLE testbench prints');
      }
      if (pay.generation && !['2005', '2009', '2012'].includes(String(pay.generation))) {
        err(where, `unknown generation "${pay.generation}" (2005, 2009 or 2012)`);
      }
      /* The sample testbench has to instantiate the module the problem
         says it does, or the starter and the harness are about different
         designs and the first Run fails for a reason the reader cannot
         see. */
      if (pay.top && pay.testbench && !new RegExp(`\\b${pay.top}\\b`).test(pay.testbench)) {
        err(where, `payload.testbench never mentions "${pay.top}"`);
      }
      if (pay.top && pay.template && !new RegExp(`module\\s+${pay.top}\\b`).test(pay.template)) {
        err(where, `payload.template does not declare "module ${pay.top}"`);
      }
      /* Every check the sample testbench is said to print must actually
         be printed by it, or Run reports a check that never runs and
         the reader goes looking for a bug in their design. */
      for (const name of pay.checks || []) {
        if (!printsCheck(pay.testbench, name)) {
          err(where, `payload.checks names "${name}", which the sample testbench never prints`);
        }
      }
      /* It must terminate. A sample testbench with no $finish is an
         exercise whose Run always ends in the ten-second timeout. */
      if (pay.testbench && !/\$finish/.test(pay.testbench)) {
        err(where, 'the sample testbench has no $finish, so every Run would hit the time limit');
      }
      /* And it must dump, or there is no waveform to look at, which is
         half the point of a hardware exercise. */
      if (pay.testbench && !/\$dumpvars/.test(pay.testbench)) {
        err(where, 'the sample testbench has no $dumpvars, so there would be no waveform');
      }
      break;

    /* ---- mathematics ---- */

    case 'exact':
    case 'approx':
      /* Nothing required: the prompt can live entirely in the statement.
         The key is where the real checking is. */
      break;

    case 'structured':
      if (!['set', 'intervals'].includes(pay.kind)) {
        err(where, 'structured needs kind "set" or "intervals"');
      }
      break;

    case 'proofsteps': {
      if (!Array.isArray(pay.steps) || pay.steps.length < 3) {
        err(where, 'proofsteps needs at least three steps');
      }
      if (!Array.isArray(pay.choices) || pay.choices.length < 3) {
        err(where, 'proofsteps needs at least three justifications to choose from');
      }
      const blanks = (pay.steps || []).filter(st => st.blank).length;
      if (blanks < 2) err(where, 'proofsteps needs at least two blanks');
      /* More choices than blanks, or it is a matching exercise with no
         decisions left in it by the end. */
      if ((pay.choices || []).length <= blanks) {
        err(where, 'proofsteps needs more justifications than blanks, so the last one is not free');
      }
      break;
    }

    case 'counterexample':
      if (!pay.claim) err(where, 'counterexample needs the claim it is against');
      if (!Array.isArray(pay.fields) || !pay.fields.length) {
        err(where, 'counterexample needs fields to fill in');
      }
      for (const f of pay.fields || []) {
        if (!f.id) err(where, 'a counterexample field has no id');
        if (!f.label) err(where, `counterexample field "${f.id}" has no label`);
      }
      break;

    case 'proof':
      if (!Array.isArray(pay.rubric) || pay.rubric.length < 3) {
        err(where, 'a proof needs a rubric of at least three things to check');
      }
      break;

    default:
      break;
  }
}

function validateKey(p, sol, err, where) {
  const k = sol.key;

  switch (p.type) {
    case 'mcq': {
      const n = (p.payload.options || []).length;
      if (!Number.isInteger(k.answer)) err(where, 'mcq key needs an integer answer');
      else if (k.answer < 0 || k.answer >= n) err(where, `answer ${k.answer} is outside the ${n} options`);
      break;
    }
    case 'multi': {
      const n = (p.payload.options || []).length;
      if (!Array.isArray(k.answers) || !k.answers.length) err(where, 'multi key needs a non-empty answers array');
      for (const a of k.answers || []) {
        if (!Number.isInteger(a) || a < 0 || a >= n) err(where, `answer ${a} is outside the ${n} options`);
      }
      if (new Set(k.answers || []).size !== (k.answers || []).length) err(where, 'answers has a duplicate');
      break;
    }
    case 'numeric': {
      const vals = [k.value, ...(k.accept || [])];
      if (!vals.some(v => typeof v === 'number' || (typeof v === 'string' && v.trim()))) {
        err(where, 'numeric key needs a value');
      }
      if (k.rtol != null && !(k.rtol >= 0)) err(where, 'rtol must be a non-negative number');
      if (k.tol  != null && !(k.tol  >= 0)) err(where, 'tol must be a non-negative number');
      break;
    }
    /* ---- mathematics ----

       Every key is run through the real engine, in the real grader, at
       build time. A key the grader cannot read, or one that does not grade
       itself correct, is a problem nobody can solve — and would be reported
       to the reader as THEIR mistake. */

    case 'exact': {
      if (k.value === undefined) err(where, 'exact key needs a value');
      for (const v of [k.value, ...(k.alsoAccept || [])]) {
        const r = MATHS.read(String(v));
        if (!r.ok) err(where, `key value "${v}" cannot be read: ${r.message}`);
      }
      if (k.value !== undefined && !MATHS.sameValue(String(k.value), String(k.value))) {
        err(where, `key value "${k.value}" does not compare equal to itself`);
      }
      break;
    }

    case 'approx': {
      if (k.value === undefined) err(where, 'approx key needs a value');
      const r = MATHS.read(String(k.value));
      if (!r.ok) err(where, `key value "${k.value}" cannot be read: ${r.message}`);
      if (k.tol === undefined && k.dp === undefined) {
        err(where, 'an approximate answer must state its tolerance: set tol or dp');
      }
      if (k.tol !== undefined && !(Number(k.tol) > 0)) err(where, 'tol must be positive');
      if (k.dp !== undefined && !Number.isInteger(k.dp)) err(where, 'dp must be a whole number');
      /* The statement has to SAY it is approximate, or the reader does not
         know they are allowed to round. */
      if (!/approx|decimal place|to \d+ d\.?p|round|nearest|tolerance|≈/i.test(String(p.statement))) {
        err(where, 'an approx problem must say in the statement that the answer is approximate '
          + 'and to what precision');
      }
      break;
    }

    case 'structured': {
      const kind = (p.payload || {}).kind;
      const reader = kind === 'intervals' ? MATHS.readIntervals : MATHS.readSet;
      const same = kind === 'intervals' ? MATHS.sameIntervals : MATHS.sameSet;
      if (k.value === undefined) err(where, 'structured key needs a value');
      for (const v of [k.value, ...(k.alsoAccept || [])]) {
        const r = reader(String(v));
        if (!r.ok) err(where, `key value "${v}" cannot be read: ${r.message}`);
      }
      if (k.value !== undefined && !same(String(k.value), String(k.value))) {
        err(where, `key value "${k.value}" does not compare equal to itself`);
      }
      break;
    }

    case 'proofsteps': {
      const blanks = ((p.payload || {}).steps || []).filter(st => st.blank).length;
      const choices = ((p.payload || {}).choices || []).length;
      if (!Array.isArray(k.answers)) err(where, 'proofsteps key needs answers');
      else {
        if (k.answers.length !== blanks) {
          err(where, `key has ${k.answers.length} answers but there are ${blanks} blanks`);
        }
        for (const a of k.answers) {
          if (!Number.isInteger(a) || a < 0 || a >= choices) {
            err(where, `answer ${a} is not one of the ${choices} justifications`);
          }
        }
        if (new Set(k.answers).size !== k.answers.length) {
          err(where, 'the same justification is used for two different steps');
        }
      }
      break;
    }

    case 'counterexample': {
      if (!Array.isArray(k.checks) || !k.checks.length) {
        err(where, 'a counterexample key needs at least one check');
      }
      const known = ['valuesMatch', 'allDifferent', 'inRange'];
      const ids = new Set(((p.payload || {}).fields || []).map(f => f.id));
      for (const c of k.checks || []) {
        if (!known.includes(c.validator)) {
          err(where, `unknown validator "${c.validator}" (have: ${known.join(', ')})`);
        }
        for (const v of c.values || []) {
          if (!ids.has(v.field)) err(where, `check names field "${v.field}", which does not exist`);
          const r = MATHS.read(String(v.is));
          if (!r.ok) err(where, `check value "${v.is}" cannot be read: ${r.message}`);
        }
        for (const f of c.fields || []) {
          if (!ids.has(f)) err(where, `check names field "${f}", which does not exist`);
        }
        for (const r2 of c.ranges || []) {
          if (!ids.has(r2.field)) err(where, `range names field "${r2.field}", which does not exist`);
        }
      }
      /* A worked example the author has in mind, run through the real
         validators so a check that can never pass is caught here. */
      if (k.example) {
        for (const f of (p.payload || {}).fields || []) {
          if (k.example[f.id] === undefined) err(where, `the example does not fill in "${f.id}"`);
        }
      } else {
        err(where, 'a counterexample key needs an `example` — one that actually passes its own checks');
      }
      break;
    }

    case 'proof':
      /* The "key" is the model proof, and there is nothing automatic to
         check about it except that it is there. */
      if (!sol.explanation || String(sol.explanation).length < 200) {
        err(where, 'a proof problem needs a model proof in the explanation');
      }
      break;

    case 'short': {
      if (!Array.isArray(k.accept) && !k.pattern) err(where, 'short key needs accept or pattern');
      if (k.pattern) {
        try { new RegExp(k.pattern, k.flags || 'i'); }
        catch (e) { err(where, `pattern does not compile: ${e.message}`); }
      }
      break;
    }
    case 'order': {
      const n = (p.payload.items || []).length;
      const order = k.order || [];
      if (order.length !== n) err(where, `order has ${order.length} entries for ${n} items`);
      else if (new Set(order).size !== n || order.some(i => !Number.isInteger(i) || i < 0 || i >= n)) {
        err(where, 'order must be a permutation of every item index exactly once');
      }
      /* An "ordering" that is already the presented order means the problem
         shows you the answer. Almost certainly a mistake in authoring. */
      if (order.length === n && order.every((v, i) => v === i)) {
        err(where, 'order is the identity — the items are presented already in the right order');
      }
      break;
    }
    case 'match': {
      const left = (p.payload.left || []).length;
      const right = (p.payload.right || []).length;
      if (!Array.isArray(k.pairs) || k.pairs.length !== left) {
        err(where, `match key needs one pair per left item (${left})`);
      }
      for (const v of k.pairs || []) {
        if (!Number.isInteger(v) || v < 0 || v >= right) err(where, `pair ${v} is outside the right column`);
      }
      break;
    }
    case 'predict': {
      if (typeof k.output !== 'string') err(where, 'predict key needs an output string');
      /* A two-character backslash-n in an *expected output* is almost always an
         escaping mistake rather than a program that really prints a backslash
         — it means a newline was written as text. This was a real bug once,
         and the only thing that caught it was compiling the snippet. */
      else if (k.output.includes(LITERAL_NL)) {
        err(where, 'output contains a literal backslash-n; a line break must be a real newline');
      }
      /* A predict problem whose snippet is a complete program can have its key
         checked against a real compiler, which is the only way to be sure a
         predicted output is actually what the thing prints. */
      const verifyAs = (p.payload || {}).verifyAs;
      if (verifyAs && !LANGS.includes(verifyAs)) err(where, `unknown verifyAs "${verifyAs}"`);
      if (verifyAs && !(p.payload || {}).code) err(where, 'verifyAs needs payload.code to compile');
      const vplat = (p.payload || {}).verifyPlatform;
      if (vplat && !['linux', 'darwin', 'win32'].includes(vplat)) err(where, `unknown verifyPlatform "${vplat}"`);
      break;
    }
    case 'locate': {
      const lines = String(p.payload.code || '').split('\n').length;
      if (!Number.isInteger(k.line)) err(where, 'locate key needs a line number');
      else if (k.line < 1 || k.line > lines) err(where, `line ${k.line} is outside the ${lines}-line listing`);
      break;
    }
    case 'hdl': {
      if (!k.harness) err(where, 'hdl key needs a grading testbench in key.harness');
      if (!Array.isArray(k.checks) || !k.checks.length) {
        err(where, 'hdl key needs key.checks: the names the GRADING testbench prints');
      }
      if (!k.reference || !k.reference.sv) {
        err(where, 'hdl key needs a reference design in key.reference.sv, so the '
          + 'exercise can be proved solvable');
      }
      const harness = String(k.harness || '');
      for (const name of k.checks || []) {
        if (!printsCheck(harness, name)) {
          err(where, `key.checks names "${name}", which the grading testbench never prints`);
        }
      }
      /* The DONE line is what tells a finished run from a hung one, so a
         grading testbench without one can never report a pass. */
      if (!/DONE\s/.test(harness)) {
        err(where, 'the grading testbench never prints a DONE line, so no run of it '
          + 'could ever be counted as complete');
      }
      if (!/\$finish/.test(harness)) {
        err(where, 'the grading testbench has no $finish, so every submission would '
          + 'hit the time limit');
      }
      /* The count on the DONE line has to match the number of checks, or
         every run is reported as incomplete. */
      /* DONE has to match the number of checks the run actually prints,
         and a `$display` inside a loop prints more than once — so this
         can only be compared when every CHECK in the file is a literal.
         When one is a format string the count is checked for real at
         run time instead, by npm run audit:hdl, which runs the thing
         and reports an incomplete grading. */
      const done = /DONE\s+(\d+)/.exec(harness);
      const printed = (harness.match(/CHECK\s+\S+/g) || []);
      const generated = printed.some(x => x.includes('%'));
      if (done && !generated && Number(done[1]) !== printed.length) {
        err(where, `the grading testbench prints ${printed.length} checks and says DONE ${done[1]}`);
      }
      /* The grading testbench must instantiate the module the problem
         names, or it is grading something else. */
      if (p.payload && p.payload.top && !new RegExp(`\\b${p.payload.top}\\b`).test(harness)) {
        err(where, `the grading testbench never mentions "${p.payload.top}"`);
      }
      /* A grading testbench that is the sample one is not a grading
         testbench: Submit would try exactly what Run already showed. */
      if (p.payload && String(p.payload.testbench || '').trim() === harness.trim()) {
        err(where, 'the grading testbench is identical to the sample one, so Submit '
          + 'tries nothing Run did not');
      }
      if (p.payload && (p.payload.checks || []).length
        && (k.checks || []).length <= (p.payload.checks || []).length
        && (k.checks || []).every(c => (p.payload.checks || []).includes(c))) {
        err(where, 'the grading checks are a subset of the visible ones, so the hidden '
          + 'testbench adds nothing');
      }
      break;
    }
    case 'code': {
      if (!Array.isArray(k.cases) || !k.cases.length) err(where, 'code key needs hidden cases');
      for (const [i, c] of (k.cases || []).entries()) {
        if (typeof c.stdin !== 'string') err(where, `hidden case ${i} has no stdin string`);
        if (typeof c.expect !== 'string') err(where, `hidden case ${i} has no expect string`);
        /* Same trap as a predict key: a line break written as text. */
        if (typeof c.expect === 'string' && c.expect.includes(LITERAL_NL)) {
          err(where, `hidden case ${i} expect contains a literal backslash-n`);
        }
      }
      /* A reference solution per claimed language is what lets
         content.test.mjs prove the problem is actually solvable. */
      for (const lang of p.payload.langs || []) {
        if (!k.reference || !k.reference[lang]) {
          err(where, `no reference solution for "${lang}", which the problem claims to accept`);
        }
      }
      break;
    }
    default:
      break;
  }
}

/* ---------------- the index ---------------- */

export function buildIndex(problems) {
  const ORDER = { beginner: 0, intermediate: 1, advanced: 2 };
  return problems
    .map(p => {
      const row = {};
      for (const f of INDEX_FIELDS) if (p[f] !== undefined) row[f] = p[f];
      row.tags = p.tags || [];
      row.lane = p.lane || 'core';
      /* Derived, never read from the problem file. */
      row.subject = subjectOf(p.topic);
      /* So the catalog can show a prerequisite count without fetching. */
      row.prereqs = (p.prereqs || []).map(x => x.concept);
      if (p.type === 'code') row.langs = (p.payload || {}).langs || [];
      /* A hardware exercise is written in SystemVerilog and in nothing
         else, so the index says so rather than leaving the language
         filter unable to see it. */
      if (p.type === 'hdl') row.langs = ['sv'];
      return row;
    })
    .sort((a, b) =>
      /* Systems first, then mathematics: the order the site grew in, and
         the order the subject switch shows them in. */
      a.subject.localeCompare(b.subject) ||
      a.topic.localeCompare(b.topic) ||
      (ORDER[a.difficulty] ?? 9) - (ORDER[b.difficulty] ?? 9) ||
      a.id.localeCompare(b.id));
}

/* ---------------- cli ---------------- */

function main() {
  const check = process.argv.includes('--check');
  const loaded = loadAll();
  const errors = validate(loaded);

  if (errors.length) {
    console.error(`\n${errors.length} content ${errors.length === 1 ? 'problem' : 'problems'}:\n`);
    for (const e of errors) console.error(`  ${e}`);
    console.error('');
    process.exit(1);
  }

  /* Two files, because they are two pools and the catalogue must not be
     able to accidentally list the assessment bank. Anything that reads
     data/index.json gets the practice catalogue and nothing else. */
  const practice = loaded.problems.filter(p => poolOf(p) === 'practice');
  const assessment = loaded.problems.filter(p => poolOf(p) === 'assessment');

  const written = [
    ['data/index.json', buildIndex(practice), 'practice'],
    ['data/assessment-index.json', buildIndex(assessment), 'assessment'],
  ];

  for (const [rel, index, what] of written) {
    const json = `${JSON.stringify(index, null, 2)}\n`;
    const out = path.join(ROOT, rel);
    if (check) {
      const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
      if (existing !== json) {
        console.error(`${rel} is out of date. Run: npm run build:index`);
        process.exit(1);
      }
      console.log(`${rel} is current (${index.length} ${what} problems).`);
      continue;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    console.log(`wrote ${rel} — ${index.length} ${what} problems`);
  }
  if (!check) console.log(`${Object.keys(loaded.concepts).length} concepts`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
