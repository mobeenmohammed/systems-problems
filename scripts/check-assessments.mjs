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
     · a weight that is not a positive number, or a pass mark outside
       0..1
     · a duration that is not a positive number of minutes (null is
       fine and means untimed)
     · feedback settings that are not one of the values the mode
       understands */

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
  const catalogue = read('data/index.json');
  const byId = Object.fromEntries(bank.map(p => [p.id, p]));
  const inCatalogue = new Set(catalogue.map(p => p.id));

  const seen = new Set();
  const DURING = ['samples', 'none'];

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
      if (byId[pid]) continue;
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
