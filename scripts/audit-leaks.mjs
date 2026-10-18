/* Does a statement give away its own answer?

   The first compiled C++ exercise printed the whole body of the function it
   was asking for, so there was nothing left to work out. That is easy to do by
   accident while writing scaffolding, and easy to check for: take the lines of
   the reference solution that carry the actual work, and see whether the
   statement already contains them.

   Lines that cannot give anything away are skipped — includes, braces, the
   signature of a function the problem explicitly supplies, boilerplate the
   template already has. What is left is the part the reader is supposed to
   produce.

   Run: node scripts/audit-leaks.mjs */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(ROOT, p), 'utf8');
const readJson = p => JSON.parse(read(p));

/* Noise: present in every program, or already given to the reader. */
const NOISE = [
  /^\s*#include/, /^\s*using\s+namespace/, /^\s*$/,
  /^\s*[{}();]+\s*$/, /^\s*\/\//, /^\s*\/\*/, /^\s*\*/,
  /^\s*return\s+0\s*;\s*$/, /^\s*int\s+main\s*\(/, /^\s*fn\s+main\s*\(/,
  /^\s*import\s/, /^\s*def\s+main\s*\(/, /^\s*main\s*\(\s*\)\s*$/,
  /^\s*else\s*$/, /^\s*try\s*\{?\s*$/,
];
const isNoise = l => NOISE.some(re => re.test(l)) || l.trim().length < 12;

const norm = s => String(s).replace(/\s+/g, ' ').trim();

const problems = [];
for (const topic of readdirSync(path.join(ROOT, 'problems'))) {
  for (const f of readdirSync(path.join(ROOT, 'problems', topic))) {
    problems.push(readJson(`problems/${topic}/${f}`));
  }
}

/* Lines a statement shows on purpose, each with a reason. Anything not in
   here is treated as an accident. */
const allow = readJson('scripts/leak-allow.json');
const declared = (id, lang) => new Set(((allow[id] || {})[lang] || []).map(norm));

let flagged = 0;
let checked = 0;
let allowed = 0;

for (const p of problems) {
  if (p.type !== 'code') continue;
  let sol;
  try { sol = readJson(`solutions/${p.id}.json`); } catch { continue; }
  const refs = (sol.key && sol.key.reference) || {};
  const templates = (p.payload && p.payload.templates) || {};

  /* A workspace's reference is a set of files rather than one string
     per language, and the thing that is "given" for each is the
     problem's own starter for that path. Without this branch the array
     is stringified and compared against the statement as
     "[object Object]" — a check that passes and means nothing. */
  const starters = Object.fromEntries(
    ((p.payload && p.payload.files) || []).map(f => [f.path, f.content]));
  const pairs = Array.isArray(refs.files)
    ? refs.files.map(f => [f.path, f.content, starters[f.path] || ''])
    : Object.entries(refs).map(([lang, ref]) => [lang, ref, templates[lang] || '']);

  for (const [lang, ref, givenSource] of pairs) {
    checked += 1;
    /* A line already in the starter is given, not leaked. */
    const given = new Set(String(givenSource).split('\n').map(norm));
    const statement = norm(p.statement);

    const ok = declared(p.id, lang);
    const shown = String(ref).split('\n')
      .filter(l => !isNoise(l))
      .map(norm)
      .filter(l => !given.has(l))
      .filter(l => statement.includes(l));

    allowed += shown.filter(l => ok.has(l)).length;
    const leaked = shown.filter(l => !ok.has(l));

    if (leaked.length) {
      flagged += 1;
      console.log(`\n${p.id} [${lang}] — ${leaked.length} solution line(s) appear in the statement:`);
      for (const l of leaked.slice(0, 6)) console.log(`    ${l}`);
      if (leaked.length > 6) console.log(`    … and ${leaked.length - 6} more`);
    }
  }
}

console.log(`\n${checked} reference solutions checked against their statements.`);
console.log(`${allowed} shown line(s) are declared deliberate in scripts/leak-allow.json.`);
console.log(flagged
  ? `${flagged} leak something undeclared. Either rework the problem, or add `
    + 'the line to scripts/leak-allow.json with a reason.'
  : 'Nothing undeclared is given away.');
process.exit(flagged ? 1 : 0);
