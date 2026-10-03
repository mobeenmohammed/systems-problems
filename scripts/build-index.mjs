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

export const TOPICS = [
  'arch', 'os', 'linux', 'compilers', 'hpc', 'dist', 'fpga', 'algo', 'sysdesign',
];
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
export const TYPES = [
  'mcq', 'multi', 'numeric', 'short', 'order', 'match', 'predict', 'locate', 'code',
];
export const LANGS = ['js', 'python', 'cpp', 'rust'];
export const PROFILES = ['standard', 'sanitize', 'strict', 'parallel'];

/* The fields the catalog needs to list, search and filter. Everything else
   stays in the problem file. */
const INDEX_FIELDS = ['id', 'title', 'topic', 'difficulty', 'type', 'tags', 'estimate'];

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

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
    if (!TYPES.includes(p.type)) err(where, `unknown type "${p.type}"`);
    if (!p.statement) err(where, 'has no statement');
    if (p.tags && !Array.isArray(p.tags)) err(where, 'tags is not an array');
    if (p.hints && !Array.isArray(p.hints)) err(where, 'hints is not an array');

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
      for (const l of pay.langs || []) if (!LANGS.includes(l)) err(where, `unknown lang "${l}"`);
      if (pay.profile && !PROFILES.includes(pay.profile)) err(where, `unknown profile "${pay.profile}"`);
      if (!Array.isArray(pay.cases) || !pay.cases.length) err(where, 'code needs at least one visible case');
      for (const [i, c] of (pay.cases || []).entries()) {
        if (typeof c.stdin !== 'string') err(where, `case ${i} has no stdin string`);
        if (typeof c.expect !== 'string') err(where, `case ${i} has no expect string`);
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
    case 'code': {
      if (!Array.isArray(k.cases) || !k.cases.length) err(where, 'code key needs hidden cases');
      for (const [i, c] of (k.cases || []).entries()) {
        if (typeof c.stdin !== 'string') err(where, `hidden case ${i} has no stdin string`);
        if (typeof c.expect !== 'string') err(where, `hidden case ${i} has no expect string`);
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
      /* So the catalog can show a prerequisite count without fetching. */
      row.prereqs = (p.prereqs || []).map(x => x.concept);
      if (p.type === 'code') row.langs = (p.payload || {}).langs || [];
      return row;
    })
    .sort((a, b) =>
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

  const index = buildIndex(loaded.problems);
  const json = JSON.stringify(index, null, 2) + '\n';
  const out = path.join(ROOT, 'data/index.json');

  if (check) {
    const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (existing !== json) {
      console.error('data/index.json is out of date. Run: npm run build:index');
      process.exit(1);
    }
    console.log(`data/index.json is current (${index.length} problems).`);
    return;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  console.log(`wrote data/index.json — ${index.length} problems, ${Object.keys(loaded.concepts).length} concepts`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
