/* Regenerate the parts of README.md that describe the content.

   The README listed 55 problems across ten topics by hand, and both numbers
   were wrong within a day of being written. Anything countable is generated
   from the catalogue instead, between markers, and tests/content.test.mjs
   fails if the committed file does not match — the same arrangement that keeps
   data/index.json honest.

   Everything outside the marked blocks is prose and is left alone.

   Run: node scripts/build-readme.mjs
        node scripts/build-readme.mjs --check     (exit 1 if stale) */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const NEWLINE = String.fromCharCode(10);

const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = rel => JSON.parse(read(rel));

const index = readJson('data/index.json');
const concepts = readJson('data/concepts.json');
const tracks = readJson('data/tracks.json');
const weekly = readJson('data/weekly.json');
const resources = readJson('data/resources.json');

/* Labels live in store.js, which is browser code. Reading them out of it keeps
   one list rather than a second copy here that can disagree. */
function topicLabels() {
  const src = read('js/store.js');
  const block = src.slice(src.indexOf('const TOPICS = ['), src.indexOf('const TOPIC_BY_ID'));
  const out = [];
  for (const m of block.matchAll(/\{\s*id:\s*'([\w-]+)',\s*label:\s*'([^']+)'/g)) {
    out.push({ id: m[1], label: m[2] });
  }
  return out;
}

const TOPICS = topicLabels();

/* ---------------- the numbers ---------------- */

let readings = 0;
for (const c of Object.values(concepts)) readings += (c.readings || []).length;
let learnFrom = 0;
for (const t of Object.values(resources.topics || {})) learnFrom += (t.resources || []).length;

const langs = new Set();
let codeProblems = 0;
let minutes = 0;
for (const p of index) {
  minutes += Number(p.estimate) || 0;
  if (p.type === 'code') {
    codeProblems += 1;
    for (const l of p.langs || []) langs.add(l);
  }
}

const usedTopics = TOPICS.filter(t => index.some(p => p.topic === t.id));
/* In the order the registry declares them, not the order the files happened
   to be walked in, so the line is stable across content changes. */
const TYPE_ORDER = ['mcq', 'multi', 'numeric', 'short', 'order', 'match', 'predict', 'locate', 'code'];
const present = new Set(index.map(p => p.type));
const types = TYPE_ORDER.filter(t => present.has(t))
  .concat([...present].filter(t => !TYPE_ORDER.includes(t)).sort());
const LANG_ORDER = ['cpp', 'rust', 'python', 'js'];
const LANG_LABEL = { cpp: 'C++', rust: 'Rust', python: 'Python', js: 'JavaScript' };

const counts = [
  `**${index.length} problems** across ${usedTopics.length} topics, `
  + `${codeProblems} of them compiled and run in `
  + `${LANG_ORDER.filter(l => langs.has(l)).map(l => LANG_LABEL[l]).join(', ')}. `
  + `**${Object.keys(concepts).length} concepts** carry **${readings} readings** between them, `
  + `every one naming a book and a chapter or a specific page, with `
  + `${learnFrom} more for learning a topic from scratch. `
  + `**${tracks.length} tracks** order subsets of the problems so there is always an obvious `
  + `next one, and the weekly schedule runs to ${(weekly.weeks[weekly.weeks.length - 1] || {}).from}.`,
  '',
  '```',
  `Topics        ${usedTopics.map(t => t.id).join(' · ')}`,
  'Difficulty    Beginner · Intermediate · Advanced',
  `Types         ${types.join(' · ')}`,
  `Total time    about ${Math.round(minutes / 60)} hours at the stated estimates`,
  '```',
].join(NEWLINE);

/* ---------------- one row per topic ---------------- */

const topicRows = [
  '| Topic | Problems | Code | Time |',
  '| --- | --- | --- | --- |',
  ...usedTopics.map(t => {
    const rows = index.filter(p => p.topic === t.id);
    const code = rows.filter(p => p.type === 'code').length;
    const mins = rows.reduce((a, p) => a + (Number(p.estimate) || 0), 0);
    const byDiff = ['beginner', 'intermediate', 'advanced']
      .map(d => `${rows.filter(p => p.difficulty === d).length}`)
      .join(' / ');
    return `| **${t.label}** | ${rows.length} — ${byDiff} by difficulty | ${code} | ~${Math.round(mins / 60)} h |`;
  }),
].join(NEWLINE);

/* ---------------- the tracks ---------------- */

const trackRows = [
  '| Track | Problems | What it is for |',
  '| --- | --- | --- |',
  ...tracks.map(t => {
    /* A track may name a problem not yet written; the site drops those, and so
       does this count, so the README cannot promise more than exists. */
    const live = (t.problems || []).filter(id => index.some(p => p.id === id));
    const blurb = String(t.blurb || '').replace(/\s+/g, ' ').trim();
    const first = blurb.split('. ')[0];
    return `| **${t.title}** | ${live.length} | ${first.endsWith('.') ? first : first + '.'} |`;
  }),
].join(NEWLINE);

/* ---------------- splice it in ---------------- */

const BLOCKS = { counts, topics: topicRows, tracks: trackRows };

let readme = read('README.md');
const missing = [];

for (const [name, body] of Object.entries(BLOCKS)) {
  const open = `<!-- generated:${name} -->`;
  const close = `<!-- /generated:${name} -->`;
  const from = readme.indexOf(open);
  const to = readme.indexOf(close);
  if (from < 0 || to < 0 || to < from) { missing.push(name); continue; }
  readme = readme.slice(0, from + open.length) + NEWLINE + body + NEWLINE + readme.slice(to);
}

if (missing.length) {
  console.error(`README.md has no markers for: ${missing.join(', ')}`);
  console.error('Add <!-- generated:NAME --> and <!-- /generated:NAME --> around each block.');
  process.exit(1);
}

export const generated = readme;

if (process.argv.includes('--check')) {
  if (read('README.md') !== readme) {
    console.error('README.md is out of date. Run: node scripts/build-readme.mjs');
    process.exit(1);
  }
  console.log('README.md is current.');
} else if (process.argv[1] && process.argv[1].endsWith('build-readme.mjs')) {
  writeFileSync(path.join(ROOT, 'README.md'), readme, 'utf8');
  console.log(`README.md updated — ${index.length} problems, ${usedTopics.length} topics, ${tracks.length} tracks`);
}
