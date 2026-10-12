/* Validate data/assessments.json against the problem bank.

   Run this after adding an assessment. It is also run by
   tests/content.test.mjs and by CI, so a broken definition cannot
   ship — an assessment that names a problem which does not exist is
   not a bad page, it is a mode that cannot be started and says
   nothing useful about why.

     npm run check:assessments

   What it will not let past:

     · an id that is not stable kebab-case, or two with the same id
     · a version that is not a positive integer
     · a problem that is not in the bank — in particular, one from the
       PRACTICE catalogue. An assessment made of problems you have
       already met is not an assessment, and that is the single
       easiest mistake to make here
     · a language permitted for a problem that the problem does not
       offer
     · a problem whose TYPE the assessment mode cannot present. Every
       type in the list below has a renderer, an answer that can be
       collected, a draft that survives a reload and a grader; a type
       that is not in the list would render as a statement with no way
       to answer it, which is exactly the bug this check exists to stop
       shipping again
     · a weight that is not a positive number, or a pass mark outside
       0..1
     · a duration that is not a positive number of minutes (null is
       fine and means untimed)
     · feedback settings that are not one of the values the mode
       understands
     · a coding exercise with no neutral assessment starter, a starter
       that is still the teaching template, or a starter with the
       reference solution in it */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function checkAssessments() {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  let doc;
  try { doc = read('data/assessments.json'); } catch (e) {
    return [`data/assessments.json: ${e.message}`];
  }
  if (!Array.isArray(doc.assessments)) return ['data/assessments.json: no "assessments" array'];

  const bank = read('data/assessment-index.json');

  /* The whole problem files, which the index does not carry: the
     starters live in `payload` and this is the only check that reads
     them. */
  const files = {};
  for (const dir of fs.readdirSync(path.join(ROOT, 'problems'))) {
    const d = path.join(ROOT, 'problems', dir);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (j && j.id) files[j.id] = j;
      } catch { /* content.test.mjs is what reports an unparseable file */ }
    }
  }
  const catalogue = read('data/index.json');
  const byId = Object.fromEntries(bank.map(p => [p.id, p]));
  const inCatalogue = new Set(catalogue.map(p => p.id));

  const seen = new Set();
  const DURING = ['samples', 'none'];

  /* The types an attempt can actually present.

     This list is not "every type the site has". It is the types that,
     inside an assessment, have all four of: a widget with working
     controls, a collect() that reads it back, a draft that survives
     navigating away and reloading, and a grader — or, for `proof`, an
     explicit refusal to grade that the mode knows how to carry.

     The bug that put this check here: a definition could name any
     problem at all, and anything that was not `code` rendered its
     statement into a row that could not scroll, with its answer box cut
     off and its Submit button below the window. A type that cannot be
     answered must be refused at validation rather than displayed. */
  const TYPES = {
    mcq: 'single choice',
    multi: 'select all, partial credit',
    numeric: 'a number within a tolerance',
    short: 'a word or a flag',
    predict: 'say what it prints',
    order: 'put in order',
    match: 'pair the columns',
    locate: 'click the line with the bug',
    /* Maths. Structured answers are compared symbolically, not by
       sampling a few points. */
    exact: 'an exact expression',
    approx: 'a number to a tolerance',
    structured: 'a structured maths answer',
    proofsteps: 'why each step follows',
    counterexample: 'a counterexample, checked',
    /* Written out, and never marked by a machine: recorded as ungraded,
       held out of the automatic total, and read against the rubric by
       the reader after the clock stops. Allowed because the mode says
       so out loud, not because anything here verifies a proof. */
    proof: 'a written proof — self-reviewed, never auto-graded',
    code: 'compiled and run against tests',
  };

  for (const a of doc.assessments) {
    const where = `assessments/${a.id || '(no id)'}`;

    if (!a.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id)) {
      err(where, 'id must be stable kebab-case — attempts are stored against it');
    }
    if (seen.has(a.id)) err(where, 'duplicate id');
    seen.add(a.id);

    if (!Number.isInteger(a.version) || a.version < 1) {
      err(where, 'version must be a positive integer; an attempt records it so an '
        + 'edited assessment never re-scores an older one');
    }
    if (!a.title) err(where, 'has no title');
    if (!a.description || a.description.length < 40) {
      err(where, 'needs a description — it is all anybody has before starting');
    }
    if (a.durationMin != null && !(Number(a.durationMin) > 0)) {
      err(where, 'durationMin must be a positive number of minutes, or null for untimed');
    }
    if (!['beginner', 'intermediate', 'advanced'].includes(a.difficulty)) {
      err(where, `unknown difficulty "${a.difficulty}"`);
    }

    if (!Array.isArray(a.problems) || !a.problems.length) {
      err(where, 'has no problems');
      continue;
    }
    const dupes = a.problems.filter((p, i) => a.problems.indexOf(p) !== i);
    if (dupes.length) err(where, `lists the same problem twice: ${[...new Set(dupes)].join(', ')}`);

    for (const pid of a.problems) {
      if (byId[pid]) {
        const t = byId[pid].type;
        if (!TYPES[t]) {
          err(where, `"${pid}" is a "${t}" problem, which the assessment mode `
            + `cannot present. Supported: ${Object.keys(TYPES).join(', ')}`);
        }
        continue;
      }
      if (inCatalogue.has(pid)) {
        err(where, `"${pid}" is in the practice catalogue. An assessment problem must `
          + 'carry "pool": "assessment" so it is not one you have already met');
      } else {
        err(where, `"${pid}" is in neither index — run npm run build:index`);
      }
    }

    for (const [pid, langs] of Object.entries(a.langs || {})) {
      if (!a.problems.includes(pid)) {
        err(where, `langs names "${pid}", which this assessment does not include`);
        continue;
      }
      const offered = (byId[pid] || {}).langs || [];
      for (const l of langs) {
        if (!offered.includes(l)) {
          err(where, `permits ${l} on "${pid}", which offers ${
            offered.length ? offered.join(', ') : 'no languages'}`);
        }
      }
      if (langs.length && !langs.some(l => offered.includes(l))) {
        err(where, `permits nothing usable on "${pid}"`);
      }
    }

    const sc = a.scoring || {};
    for (const [pid, w] of Object.entries(sc.weights || {})) {
      if (!a.problems.includes(pid)) err(where, `weights names "${pid}", which is not in it`);
      if (!(Number(w) > 0)) err(where, `weight for "${pid}" must be a positive number`);
    }
    if (sc.passMark != null && !(Number(sc.passMark) >= 0 && Number(sc.passMark) <= 1)) {
      err(where, 'passMark must be a fraction between 0 and 1, or null');
    }

    const fb = a.feedback || {};
    if (fb.duringAttempt != null && !DURING.includes(fb.duringAttempt)) {
      err(where, `feedback.duringAttempt must be one of ${DURING.join(', ')}`);
    }
    if (fb.solutions === true) {
      err(where, 'feedback.solutions cannot be true — an assessment with a Solution '
        + 'tab is not an assessment');
    }
  }

  /* ---------------- assessment starter code ----------------

     A practice template is allowed to teach: it carries the signature
     and then says, in comments, what to do inside it. Under a clock
     that is the answer, so an assessment coding exercise carries a
     second starter with the interface and none of the method.

     Checked here rather than trusted, because the failure is silent:
     an assessment with a coaching template still works, still runs,
     still scores — and has handed over the algorithm. */
  const COACHING = [
    /your code here/i,
    /\bhint\b/i,
    /\bstep 1\b/i,
    /first,? (?:walk|loop|iterate|count|read all)/i,
  ];

  for (const p of bank) {
    if (p.type !== 'code') continue;
    const full = files[p.id];
    if (!full) { err(`bank/${p.id}`, 'no problem file found for it'); continue; }
    const pay = full.payload || {};
    const langs = pay.langs || [];
    const neutral = pay.assessmentTemplates || {};
    const teaching = pay.templates || {};

    /* The reference, for the disclosure check. A line of it that is NOT
       also in the teaching template is method rather than interface —
       so finding one in the starter is finding part of the answer. The
       shared lines (the includes, the signatures, the harness) are
       exactly the ones that are supposed to be in both. */
    let reference = {};
    try {
      reference = (read(`solutions/${p.id}.json`).key || {}).reference || {};
    } catch { /* checked elsewhere */ }

    for (const lang of langs) {
      const where = `bank/${p.id} [${lang}]`;
      const starter = neutral[lang];
      if (starter == null) {
        err(where, 'a coding exercise in the assessment pool needs '
          + 'payload.assessmentTemplates for every language it offers — the '
          + 'practice template teaches the method, which under a clock is the answer');
        continue;
      }
      if (teaching[lang] != null && starter === teaching[lang]) {
        err(where, 'the assessment starter is byte-identical to the teaching '
          + 'template, so it is not an assessment starter');
      }
      for (const re of COACHING) {
        if (re.test(starter)) {
          err(where, `the assessment starter still contains coaching (${re})`);
        }
      }
      const ref = reference[lang];
      if (typeof ref === 'string') {
        const shared = new Set(
          String(teaching[lang] || '').split('\n').map(l => l.trim()));
        const leaked = ref.split('\n')
          .map(l => l.trim())
          .filter(l => l.length >= 24 && !shared.has(l))
          .filter(l => starter.includes(l));
        if (leaked.length) {
          err(where, `the assessment starter contains ${leaked.length} line(s) of the `
            + `reference solution, e.g. ${JSON.stringify(leaked[0].slice(0, 60))}`);
        }
      }
    }
  }

  /* The other direction: a problem in the bank that no assessment uses
     is dead weight, and more to the point is a problem nobody can ever
     reach, since the catalogue cannot list it. */
  const used = new Set(doc.assessments.flatMap(a => a.problems || []));
  for (const p of bank) {
    if (!used.has(p.id)) {
      err(`bank/${p.id}`, 'is in the assessment pool but no assessment uses it, so '
        + 'nothing can reach it — the catalogue cannot list the pool');
    }
  }

  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const errors = checkAssessments();
  if (errors.length) {
    console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'} with the assessments:\n`);
    for (const e of errors) console.error(`  ${e}`);
    console.error('');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assessments.json'), 'utf8'));
  const n = doc.assessments.length;
  console.log(`data/assessments.json is valid (${n} assessment${n === 1 ? '' : 's'}).`);
}
