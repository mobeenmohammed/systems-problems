/* The content: every problem file, every solution file, and the concept graph
   they point into.

   This is the suite that matters most. Hand-written JSON and a shared concept
   graph will not stay consistent on good intentions, and a broken problem is
   not a crash — it is a problem that silently cannot be solved, or one whose
   prerequisites point at a concept that no longer exists.

   The second half is the part worth having: it feeds each answer key back
   through the real grader and insists the grader calls it correct. That
   catches the authoring mistake no schema check can — a key that is valid in
   shape but wrong, like an `order` permutation written in the wrong direction.

   Run: node tests/content.test.mjs */

import { loadAll, validate, buildIndex, LANGS } from '../scripts/build-index.mjs';
import { loadScripts, read, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts([
  'vendor/katex/katex.min.js',
  'js/maths/expr.js',
  'js/maths/render.js',
  'js/md.js',
  'js/store.js',
  'js/types/registry.js',
  'js/types/mcq.js',
  'js/types/numeric.js',
  'js/types/order.js',
  'js/types/match.js',
  'js/types/predict.js',
  'js/types/locate.js',
  'js/types/maths.js',
  /* The code type reads the language labels off the catalogue, which is
     the one place they are written down. */
  'js/catalog.js',
  /* For TEMPLATE: the starters a problem gets when it supplies none. */
  'js/types/code.js',
]);
const Types = grab('ProblemTypes');
const MathsExpr = grab('MathsExpr');
/* The same macros the page gives KaTeX, so a statement using \R is checked
   the way it will be rendered rather than failing here and working there. */
const MathsRender = grab('MathsRender');
const MACROS = MathsRender.MACROS || {};

const loaded = loadAll();
const { problems, concepts, solutions } = loaded;

/* ---------------- the schema ---------------- */

section('structure');
ok('there are problems at all', problems.length > 0);
ok('there are concepts at all', Object.keys(concepts).length > 0);

const errors = validate(loaded);
if (errors.length) {
  for (const e of errors) console.log(`  FAIL  ${e}`);
}
check('no content errors', errors.length, 0);

/* Catalog.allTracks() silently drops ids it cannot resolve, so that a track may
   name a problem that has not been written yet. The cost of that kindness is
   that a typo disappears instead of failing, which is what this checks. */
section('tracks name problems that exist');
{
  const fs = await import('node:fs');
  const read = name => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
  const tracks = read('tracks.json');
  const known = new Set(problems.map(p => p.id));
  const seenIds = new Set();

  ok('there are tracks at all', Array.isArray(tracks) && tracks.length > 0);
  for (const t of tracks) {
    ok(`${t.id}: has a title, a blurb and a goal`,
      !!(t.title && t.blurb && t.goal));
    ok(`${t.id}: id is unique`, !seenIds.has(t.id));
    seenIds.add(t.id);
    ok(`${t.id}: lists problems`, Array.isArray(t.problems) && t.problems.length > 0);
    const absent = (t.problems || []).filter(id => !known.has(id));
    ok(`${t.id}: every problem exists${absent.length ? ` (missing ${absent.join(', ')})` : ''}`,
      absent.length === 0);
    const dupes = (t.problems || []).filter((id, i, a) => a.indexOf(id) !== i);
    ok(`${t.id}: no problem is listed twice${dupes.length ? ` (${dupes.join(', ')})` : ''}`,
      dupes.length === 0);
  }

  /* A project track is drawn by #/projects rather than by Learn, and
     its overview page reads the milestone order off the track while
     every badge and the carry-forward read `project.step` off the
     problems. Those two agreeing is not optional: a track whose
     second entry calls itself step 3 would show a milestone list in
     one order and a progress count in another.

     There is no runtime check for this because there is nothing
     sensible to do about it at runtime. It is a content error, so it
     fails here. */
  const projectTracks = tracks.filter(t => t.kind === 'project');
  ok(`there are project tracks (${projectTracks.length})`, projectTracks.length > 0);
  const byIdMap = new Map(problems.map(p => [p.id, p]));
  for (const t of projectTracks) {
    ok(`${t.id}: names the project id its problems use`, typeof t.project === 'string' && !!t.project);
    const mine = (t.problems || []).map(id => byIdMap.get(id)).filter(Boolean);
    const wrong = mine.filter(p => ((p.project || {}).id) !== t.project);
    ok(`${t.id}: every milestone claims that project`
      + `${wrong.length ? ` (${wrong.map(p => p.id).join(', ')})` : ''}`,
    wrong.length === 0);
    const steps = mine.map(p => (p.project || {}).step);
    ok(`${t.id}: the steps are 1..${mine.length} in the track's order (${steps.join(', ')})`,
      steps.every((n, i) => n === i + 1));
    const ofs = [...new Set(mine.map(p => (p.project || {}).of))];
    ok(`${t.id}: every milestone agrees there are ${mine.length} of them (${ofs.join(', ')})`,
      ofs.length === 1 && ofs[0] === mine.length);
    const labels = mine.map(p => (p.project || {}).label).filter(Boolean);
    ok(`${t.id}: every milestone has a label for the overview`, labels.length === mine.length);
  }
  /* And nothing outside a project track may claim to be a milestone:
     a project problem reachable only through Learn would be a
     milestone with no project around it. */
  const claimed = new Set(projectTracks.flatMap(t => t.problems || []));
  const orphans = problems.filter(p => p.project && !claimed.has(p.id));
  ok(`every milestone belongs to a project track`
    + `${orphans.length ? ` (${orphans.map(p => p.id).join(', ')})` : ''}`,
  orphans.length === 0);

  /* A weekly entry pointing at nothing would leave the dashboard's main action
     dead, which is worse than having no weekly problem at all. */
  const weekly = read('weekly.json');
  const weeks = Array.isArray(weekly) ? weekly : (weekly.weeks || []);
  for (const w of weeks) {
    ok(`weekly ${w.from}: names a problem that exists`, known.has(w.problem));
  }
}

/* The README counts problems, topics, concepts and readings. Those numbers
   were hand-written once and were wrong within a day, so they are generated
   and checked here the same way data/index.json is. */
section('the README is current');
{
  const fs = await import('node:fs');
  const { generated } = await import('../scripts/build-readme.mjs');
  const onDisk = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  ok('README.md matches the catalogue (run node scripts/build-readme.mjs)',
    onDisk === generated);
}

/* ---------------- the assessments ---------------- */

section('data/assessments.json names problems that exist, in the right pool');
{
  const { checkAssessments } = await import('../scripts/check-assessments.mjs');
  const errs = checkAssessments();
  if (errs.length) for (const e of errs) console.log(`        ${e}`);
  check('no problems with the assessment definitions', errs.length, 0);
}

section('the index is current');
{
  const fsmod = await import('node:fs');
  const { poolOf } = await import('../scripts/build-index.mjs');
  /* Two indexes, because there are two pools. The catalogue must not be
     able to list the assessment bank even by accident, which is what
     the second check here is for. */
  for (const [rel, pool] of [
    ['../data/index.json', 'practice'],
    ['../data/assessment-index.json', 'assessment'],
  ]) {
    const fresh = `${JSON.stringify(buildIndex(problems.filter(p => poolOf(p) === pool)), null, 2)}\n`;
    let committed = '';
    try { committed = fsmod.readFileSync(new URL(rel, import.meta.url), 'utf8'); } catch {}
    ok(`${rel.replace('../', '')} matches the problem files (run npm run build:index)`,
      committed === fresh);
  }

  const catalogue = JSON.parse(fsmod.readFileSync(
    new URL('../data/index.json', import.meta.url), 'utf8'));
  const bank = JSON.parse(fsmod.readFileSync(
    new URL('../data/assessment-index.json', import.meta.url), 'utf8'));
  const inBank = new Set(bank.map(p => p.id));
  check('no assessment problem is in the catalogue',
    catalogue.filter(p => inBank.has(p.id)).map(p => p.id), []);
  ok(`the bank has something in it (${bank.length})`, bank.length > 0);
  /* The counts on every page come from the catalogue, so this is the
     assertion that "assessment problems do not affect normal totals". */
  check('and the catalogue is only the practice pool',
    catalogue.length, problems.filter(p => poolOf(p) === 'practice').length);
}

/* ---------------- every key grades as correct ---------------- */

/* The ideal answer, derived from the key itself. If the grader does not call
   this correct, the key and the grader disagree and the problem is either
   unsolvable or wrongly marked. */
function idealAnswer(problem, key) {
  switch (problem.type) {
    case 'mcq':     return key.answer;
    case 'multi':   return key.answers;
    case 'numeric': return key.value;
    case 'short':   return (key.accept || [])[0];
    case 'order':   return key.order;
    case 'match':   return key.pairs;
    case 'predict': return key.output;
    case 'locate':  return key.line;
    /* Mathematics. The key is the answer as a reader would type it, which is
       exactly what makes this check worth having: it runs the real parser
       and the real equality procedure over every authored key. */
    case 'exact':
    case 'approx':
    case 'structured':   return key.value;
    case 'proofsteps':   return key.answers;
    case 'counterexample': return key.example;
    case 'proof':        return undefined;   /* nothing automatic to check */
    default:        return undefined;   /* code is covered by the judge suite */
  }
}

section('every answer key is graded correct by its own grader');
for (const p of problems) {
  const sol = solutions[p.id];
  if (!sol || !sol.key) continue;
  const impl = Types.get(p.type);
  if (!impl) {
    /* A type with no module yet is a gap to be aware of, not a failure. */
    console.log(`  --    ${p.id}: type "${p.type}" has no grader in this build`);
    continue;
  }
  const answer = idealAnswer(p, sol.key);
  if (answer === undefined) continue;

  const res = impl.grade(answer, sol.key, p);
  ok(`${p.id}: the key answers its own problem`, res.correct === true);
  ok(`${p.id}: and scores a full 1`, res.score === 1);
}

/* ---------------- a wrong answer must not be graded correct ---------------- */

/* The mirror of the check above: a key that calls everything correct would
   pass the first test and be useless. */
/* ---------------- mathematics, where the grader is the risk ---------------- */

/* The expression engine decides whether somebody's answer is right, so a key
   that it reads differently from how the author meant it would report the
   author's mistake as the reader's. Every authored key is parsed here, and
   every alternative form the author promised to accept is checked against
   the one that is canonical. */

/* Every maths span in every statement, hint, option, caption and solution,
   rendered by the real KaTeX with errors turned ON. A lost backslash — and
   writing these files has eaten several — turns \sqrt into "sqrt" or, worse,
   turns igl into a backspace character, and both render as something that
   looks almost right. This catches both, and it is the only check that reads
   the TeX rather than the JSON around it. */

section('every piece of TeX actually parses');
{
  const katex = grab('katex');
  ok('KaTeX is loaded for this check', !!(katex && katex.renderToString));

  /* Pull the maths spans out of any string. Deliberately the renderer's own
     function rather than a second copy of the regexes: if the two ever
     disagreed, this check would be verifying TeX the page never renders. */
  const spans = text => MathsRender.protect(text).spans.map(s => s.tex);

  /* Every string anywhere in an object, however deeply nested. */
  const strings = (v, out = []) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) strings(x, out);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
    return out;
  };

  let checked = 0;
  const broken = [];
  const controls = [];

  for (const p of problems) {
    const sol = solutions[p.id];
    for (const [where, obj] of [[`problems/${p.id}`, p], [`solutions/${p.id}`, sol]]) {
      if (!obj) continue;
      for (const text of strings(obj)) {
        /* A collapsed  or  leaves a real control character behind. */
        for (const ch of text) {
          const n = ch.charCodeAt(0);
          if (n < 32 && n !== 10 && n !== 13 && n !== 9) {
            controls.push(`${where}: control character U+${n.toString(16).padStart(4, '0')}`);
          }
        }
        for (const tex of spans(text)) {
          checked += 1;
          try {
            katex.renderToString(tex, { throwOnError: true, strict: false, macros: MACROS });
          } catch (err) {
            broken.push(`${where}: "${tex.slice(0, 60)}" — ${String(err.message).slice(0, 80)}`);
          }
        }
      }
    }
  }

  ok(`there is TeX to check (${checked} expressions)`, checked > 150);
  if (broken.length) for (const b of broken.slice(0, 8)) console.log(`  --    ${b}`);
  check('every expression parses', broken.length, 0);
  if (controls.length) for (const c of controls.slice(0, 5)) console.log(`  --    ${c}`);
  check('and no string carries a stray control character', controls.length, 0);
}

section('every mathematical key is readable, and means what it says');
for (const p of problems) {
  if (!['exact', 'approx', 'structured'].includes(p.type)) continue;
  const sol = solutions[p.id];
  if (!sol || !sol.key) continue;

  const E = MathsExpr;
  const kind = (p.payload || {}).kind;
  const reader = p.type !== 'structured' ? E.read
    : kind === 'intervals' ? E.readIntervals : E.readSet;
  const same = p.type !== 'structured' ? E.sameValue
    : kind === 'intervals' ? E.sameIntervals : E.sameSet;

  const main = reader(String(sol.key.value));
  ok(`${p.id}: the key parses`, main.ok);
  if (!main.ok) continue;

  for (const alt of sol.key.alsoAccept || []) {
    const r = reader(String(alt));
    ok(`${p.id}: the alternative "${alt}" parses`, r.ok);
    if (p.type === 'approx') continue;
    ok(`${p.id}: and "${alt}" really is the same answer`,
      same(String(alt), String(sol.key.value)));
  }

  /* Every value an authored misconception rule triggers on has to be
     readable too, or the rule can never fire and the reader silently gets
     the generic nudge instead of the sentence written for them. */
  for (const m of ((sol.feedback || {}).whenValue) || []) {
    const text = m.is !== undefined ? m.is : m.isExpr;
    const r = E.read(String(text));
    ok(`${p.id}: the misconception trigger "${text}" parses`, r.ok);
    /* And it must not be the right answer, or a correct answer would be
       met with an explanation of a mistake. */
    if (r.ok && p.type !== 'approx') {
      ok(`${p.id}: and "${text}" is not the correct answer`,
        !E.sameValue(String(text), String(sol.key.value)));
    }
  }
}

section('an approximate answer states its tolerance and is reachable');
for (const p of problems) {
  if (p.type !== 'approx') continue;
  const k = solutions[p.id].key;
  const tol = k.tol !== undefined ? Number(k.tol) : 0.5 * (10 ** -Number(k.dp ?? 2));
  ok(`${p.id}: the tolerance is positive`, tol > 0);
  /* The statement must say so, or the reader does not know they may round.
     build-index enforces this too; it is here because it is content. */
  ok(`${p.id}: the statement says the answer is approximate`,
    /approx|decimal place|round|nearest|tolerance|±/i.test(String(p.statement)));
}

section('a deliberately wrong answer is not graded correct');
for (const p of problems) {
  const sol = solutions[p.id];
  const impl = sol && sol.key ? Types.get(p.type) : null;
  if (!impl) continue;

  let wrong;
  switch (p.type) {
    case 'mcq': {
      const n = (p.payload.options || []).length;
      wrong = (sol.key.answer + 1) % n;
      break;
    }
    case 'multi': {
      const n = (p.payload.options || []).length;
      const right = new Set(sol.key.answers);
      const other = [...Array(n).keys()].find(i => !right.has(i));
      wrong = other === undefined ? [] : [other];
      break;
    }
    case 'numeric':
      /* Out by a factor of three — well outside any sane tolerance, and not
         one of the "named mistake" factors. */
      wrong = (Number(sol.key.value) || 1) * 3 + 1;
      break;
    case 'short':
      wrong = 'definitely-not-the-answer';
      break;
    case 'order': {
      const o = [...sol.key.order];
      [o[0], o[1]] = [o[1], o[0]];
      wrong = o;
      break;
    }
    case 'locate':
      wrong = sol.key.line === 1 ? 2 : 1;
      break;

    /* A number that is not the answer, and far enough out to clear any
       stated tolerance. */
    case 'exact':
    case 'approx': {
      const tol = sol.key.tol !== undefined ? Number(sol.key.tol) : 0.01;
      wrong = String(`(${sol.key.value}) + ${Math.max(1, tol * 1000)}`);
      break;
    }
    case 'structured':
      /* A set or interval that is not the answer, and is readable. */
      wrong = (p.payload || {}).kind === 'intervals' ? '(123,124)' : '{123}';
      break;
    case 'proofsteps': {
      const a = [...sol.key.answers];
      [a[0], a[1]] = [a[1], a[0]];
      wrong = a;
      break;
    }
    case 'counterexample': {
      /* Every field filled in, readable, and not the worked example. */
      wrong = {};
      for (const f of (p.payload || {}).fields || []) wrong[f.id] = '987654';
      break;
    }
    default:
      continue;
  }

  const res = impl.grade(wrong, sol.key, p);
  ok(`${p.id}: a wrong answer is marked wrong`, res.correct === false);
}

/* ---------------- things a schema cannot check ---------------- */

section('statements and explanations read like content');
for (const p of problems) {
  ok(`${p.id}: statement is more than a stub`, String(p.statement).length > 80);
  const sol = solutions[p.id];
  if (!sol) continue;
  /* The explanation is the whole reason the site exists, so a one-line
     "because it is" is a content bug. */
  ok(`${p.id}: explanation teaches rather than asserts`, String(sol.explanation).length > 400);
}

/* The corruption to catch is a stray line continuation in the authoring
   script, which joins two lines and eats the character that caused it. One
   ASCII diagram shipped that way before this check existed.

   Prose paragraphs are legitimately long — markdown does not need wrapping —
   so the check looks only INSIDE fenced code blocks, where every line is a
   line of code or a row of a diagram and so is short by nature. A 200-char
   line in a code fence is not a style choice. */
section('no code-fence line looks like two lines joined together');
const FENCE_LIMIT = 200;
const NEWLINE = String.fromCharCode(10);

function fencedLines(text) {
  const out = [];
  let inside = false;
  for (const line of String(text || '').split(NEWLINE)) {
    if (line.trimStart().startsWith('```')) { inside = !inside; continue; }
    if (inside) out.push(line);
  }
  return out;
}

for (const p of problems) {
  const sol = solutions[p.id] || {};
  const fields = [
    ['statement', p.statement],
    ['explanation', sol.explanation],
    ['payload.code', (p.payload || {}).code],
  ];
  for (const [what, text] of fields) {
    if (!text) continue;
    /* payload.code is not fenced — it IS the code — so check it whole. */
    const lines = what === 'payload.code' ? String(text).split(NEWLINE) : fencedLines(text);
    const longest = lines.reduce((a, l) => Math.max(a, l.length), 0);
    if (!ok(`${p.id}: ${what} code lines are a sane length (longest ${longest})`, longest <= FENCE_LIMIT)) {
      console.log(`        ${lines.find(l => l.length > FENCE_LIMIT).slice(0, 160)}...`);
    }
  }
}

section('hints are a ramp, not a giveaway');
for (const p of problems) {
  for (const [i, h] of (p.hints || []).entries()) {
    ok(`${p.id}: hint ${i + 1} is a real sentence`, String(h).trim().length > 15);
  }
}

section('mcq problems name why the wrong options are wrong');
for (const p of problems) {
  if (p.type !== 'mcq' && p.type !== 'multi') continue;
  const sol = solutions[p.id];
  if (!sol) continue;
  const n = (p.payload.options || []).length;
  const explained = Object.keys(sol.distractors || {}).length;
  /* Getting it wrong and being told only "no" teaches nothing; the reason the
     attractive wrong answer is wrong is the actual lesson. */
  ok(`${p.id}: every option has a note (${explained}/${n})`, explained === n);
}

/* ---------------- wrong-answer feedback does not give the game away ----------------

   `distractors` are shown only once the answer is legitimately visible and may
   say anything. `feedback` is shown after a WRONG attempt, which makes it the
   one piece of authored text that has to be checked for leakage: a note
   attached to the correct option, or to the buggy line, would hand over the
   answer to anyone who guessed once. */

/* ---------------- the in-browser C++ toolchain ---------------- */

section('every C++ problem is classified for the browser compiler');
{
  const support = JSON.parse(read('data/cxx-support.json'));
  const cpp = problems.filter(p => p.type === 'code'
    && ((p.payload || {}).langs || []).includes('cpp')).map(p => p.id);

  const classified = new Set([...support.browser, ...Object.keys(support.nativeOnly)]);
  const unclassified = cpp.filter(id => !classified.has(id)).sort();
  /* A problem that is in neither list has never been tried against the
     browser toolchain, and would silently fall through to "no runner". */
  check('none is left unclassified', unclassified, []);

  const stale = [...classified].filter(id => !cpp.includes(id)).sort();
  check('and none names a problem that no longer exists', stale, []);

  ok('the toolchain is recorded', !!(support.toolchain && support.toolchain.compiler));
  for (const [id, why] of Object.entries(support.nativeOnly)) {
    ok(`${id}: being native-only is explained, not just asserted`,
      String(why).trim().length > 60);
  }

  /* The one rule that must never be relaxed to make a problem fit. */
  for (const id of support.browser) {
    const p = problems.find(x => x.id === id);
    const pay = p.payload || {};
    ok(`${id}: is not a sanitizer problem`, !pay.requireClean && pay.profile !== 'sanitize');
  }
}

/* ---------------- the in-browser Python interpreter ---------------- */

section('every Python problem is classified for the browser interpreter');
{
  const support = JSON.parse(read('data/py-support.json'));
  const py = problems.filter(p => p.type === 'code'
    && ((p.payload || {}).langs || []).includes('python')).map(p => p.id);

  const classified = new Set([...support.browser, ...Object.keys(support.nativeOnly)]);
  const unclassified = py.filter(id => !classified.has(id)).sort();
  check('none is left unclassified', unclassified, []);

  const stale = [...classified].filter(id => !py.includes(id)).sort();
  check('and none names a problem that no longer exists', stale, []);

  ok('the interpreter it was certified against is recorded',
    /CPython/.test(JSON.stringify(support.runtime || {})));
  ok('including the platform it actually measured',
    /emscripten/.test(String((support.runtime || {}).measured || '')));

  for (const [id, why] of Object.entries(support.nativeOnly)) {
    ok(`${id}: needing a real Python is explained, not just asserted`,
      String(why).trim().length > 60);
  }

  /* Every certified problem has a Python reference, or the audit could
     not have run it. */
  for (const id of support.browser) {
    const sol = JSON.parse(read(`solutions/${id}.json`));
    ok(`${id}: has the Python reference the audit ran`,
      !!((sol.key || {}).reference || {}).python);
  }
}

section('feedback after a wrong answer discloses nothing');
for (const p of problems) {
  const sol = solutions[p.id];
  const fb = sol && sol.feedback;
  if (!fb) continue;

  if (p.type === 'mcq') {
    const right = String(Number(sol.key.answer));
    const notes = Object.keys(fb.options || {});
    ok(`${p.id}: no note on the correct option`, !notes.includes(right));
    ok(`${p.id}: and the wrong ones are covered (${notes.length}/${(p.payload.options || []).length - 1})`,
      notes.length === (p.payload.options || []).length - 1);
    for (const [i, note] of Object.entries(fb.options || {})) {
      const text = typeof note === 'string' ? note : note.why;
      ok(`${p.id}: option ${i}'s note is a real explanation`, String(text).trim().length > 40);
    }
  }

  if (p.type === 'multi') {
    /* Per-option notes are forbidden here whatever they say: with four
       options, telling someone which of their two ticks was wrong is telling
       them the answer. */
    ok(`${p.id}: no per-option notes on a select-all`, !fb.options);
    for (const m of fb.misconceptions || []) {
      ok(`${p.id}: a misconception names the ticks it matches`,
        Array.isArray(m.picked) && m.picked.length > 0);
      ok(`${p.id}: and says something`, String(m.say || '').trim().length > 40);
    }
    ok(`${p.id}: there is a fallback nudge`, String(fb.nudge || '').trim().length > 40);
  }

  if (p.type === 'locate') {
    const answers = [Number(sol.key.line), ...(sol.key.alsoAccept || []).map(Number)]
      .map(String);
    for (const line of Object.keys(fb.lines || {})) {
      ok(`${p.id}: line ${line} is not one of the accepted answers`, !answers.includes(line));
    }
    ok(`${p.id}: there is a fallback nudge`, String(fb.nudge || '').trim().length > 40);
  }
}

/* ---------------- code problems are actually solvable ---------------- */

/* ---------------- where your code goes ----------------

   A template is scaffolding, and scaffolding with no marked hole is a file
   you have to read twice before you can start: the reader cannot tell what
   was given from what is missing. Every template says where the work goes,
   in that language's comment syntax, and says what goes there rather than
   only "your code here" - a marker that could be moved to another problem
   unchanged is not telling anybody anything. */
section('every template says where your code goes, and what goes there');
{
  const impl = Types.get('code');
  const GENERIC = (impl && impl.TEMPLATE) || {};
  check('the generic starters are reachable from here', Object.keys(GENERIC).length, 4);

  const COMMENT = { cpp: '//', rust: '//', js: '//', python: '#' };
  const MARK = /your code here/i;

  /* Lines of a reference solution that a marker is allowed to contain. Each
     one is a loop header or a call site handed to a beginner on purpose -
     the exercise is the body, or the function being called - and each was in
     the template before the markers were. Anything else appearing here is an
     accident, and the leak audit cannot catch it: it treats every template
     line as given. */
  const GIVEN = {
    'cpp-function-prime-count': 'the loop header is given; writing isPrime is the exercise',
    'cpp-loop-multiples': 'the loop header is the syntax being taught; the body is the exercise',
    'cpp-reference-clamp': 'the call site is given; writing clampTo through a reference is the exercise',
    'cpp-sum-until-zero': 'the read-until-zero idiom is the syntax being taught',
  };

  const norm = x => String(x).replace(/\s+/g, ' ').trim();
  const NOISE = [
    /^\s*#include/, /^\s*using\s+namespace/, /^\s*\/\//, /^\s*#/,
    /^\s*int\s+main\s*\(/, /^\s*fn\s+main\s*\(/, /^\s*import\s/, /^\s*def\s+main\s*\(/,
  ];
  const isNoise = l => NOISE.some(re => re.test(l)) || l.trim().length < 20;

  let pairs = 0;
  let generic = 0;
  const unmarked = [];
  const wrongComment = [];
  const silent = [];
  const leaks = [];

  const debugStarters = [];
  const workspaces = [];

  /* A hardware exercise can be a workspace too, and the rule about
     saying where the work goes is the same one. Its single-file
     starters are `payload.template` rather than `payload.templates`
     and are checked elsewhere. */
  for (const p of problems.filter(x => x.type === 'hdl')) {
    if (Array.isArray((p.payload || {}).files) && p.payload.files.length) workspaces.push(p);
  }

  for (const p of problems.filter(x => x.type === 'code')) {
    const pay = p.payload || {};
    const own = pay.templates || {};

    /* A workspace has no `templates`: it starts from several files, and
       the rule applies to the ones the reader may edit. The given
       files are the exercise's own code and are exempt — a driver with
       "your code here" in it would be inviting an edit it forbids. */
    if (Array.isArray(pay.files) && pay.files.length) {
      workspaces.push(p);
      continue;
    }

    /* A debugging challenge has no hole to mark. Its starter is a
       complete program that is wrong, and "your code here" in the
       middle of it would be pointing at nothing — the whole file is
       the place to work. The rule for these is the opposite one, and
       it is checked below: no marker, and a statement that says the
       starter is broken so nobody meets it unwarned. */
    if (p.debugging) {
      for (const lang of pay.langs || []) {
        debugStarters.push({ id: p.id, lang, src: own[lang] });
      }
      continue;
    }
    const sol = solutions[p.id] || {};
    const refs = (sol.key && sol.key.reference) || {};

    for (const lang of pay.langs || []) {
      pairs += 1;
      const src = own[lang] != null ? own[lang] : GENERIC[lang];
      if (own[lang] == null) generic += 1;
      if (src == null) { unmarked.push(`${p.id} [${lang}]: no template at all`); continue; }

      const marks = src.split('\n').filter(l => MARK.test(l));
      if (!marks.length) { unmarked.push(`${p.id} [${lang}]`); continue; }

      for (const line of marks) {
        const at = line.search(MARK);
        const before = line.slice(0, at);
        /* The marker has to be a comment, in this language's syntax - a bare
           sentence in the middle of a C++ file does not compile, and a //
           in a Python file is a syntax error rather than a note. */
        if (!new RegExp(`${COMMENT[lang] === '#' ? '#' : '//'}\\s*$`).test(before)) {
          wrongComment.push(`${p.id} [${lang}]: ${norm(line).slice(0, 60)}`);
        }
        /* And it has to say what goes there. */
        const says = norm(line.slice(at + 'your code here'.length)).replace(/^[—:-]\s*/, '');
        if (says.length < 12) silent.push(`${p.id} [${lang}]: ${norm(line).slice(0, 60)}`);

        /* A marker that quotes a line of the answer is a marker that solves
           the problem for you. */
        if (GIVEN[p.id]) continue;
        for (const l of String(refs[lang] || '').split('\n').filter(x => !isNoise(x)).map(norm)) {
          if (norm(line).includes(l)) leaks.push(`${p.id} [${lang}]: "${l}"`);
        }
      }
    }
  }

  ok(`every problem and language has a template (${pairs} pairs, ${generic} generic)`,
    pairs > 50);
  check(`every one of them marks where your code goes${unmarked.length ? `: ${unmarked[0]}` : ''}`,
    unmarked.length, 0);

  /* The same rule, over the files of a workspace. At least one editable
     file has to say where the work goes; a milestone that carries an
     earlier one's finished file forward does not have to mark that
     one again. */
  for (const p of workspaces) {
    const pay = p.payload;
    const mine = pay.files.filter(f => !f.readOnly);
    ok(`${p.id}: has files the reader may edit`, mine.length > 0);
    ok(`${p.id}: and one of them says where the work goes`,
      mine.some(f => MARK.test(String(f.content || ''))));
    for (const f of mine.filter(x => MARK.test(String(x.content || '')))) {
      for (const line of String(f.content).split('\n').filter(l => MARK.test(l))) {
        const at = line.search(MARK);
        ok(`${p.id} [${f.path}]: the marker is a comment`,
          /(\/\/|\/\*|\*)\s*$/.test(line.slice(0, at)));
      }
    }
    /* And the given files are given: the reference must not have
       rewritten one, which build-index also checks. */
    const ref = ((solutions[p.id] || {}).key || {}).reference || {};
    const files = ref.files || [];
    ok(`${p.id}: the reference is a workspace of its own`, files.length === pay.files.length);
  }

  /* And the opposite rule, for the ones that are already written. */
  for (const d of debugStarters) {
    ok(`${d.id} [${d.lang}]: has a starter of its own`, typeof d.src === 'string' && d.src.length > 40);
    ok(`${d.id} [${d.lang}]: which is complete, with no hole to fill`,
      typeof d.src === 'string' && !/your code here/i.test(d.src));
    ok(`${d.id} [${d.lang}]: and says in the file that it is broken`,
      typeof d.src === 'string' && /BROKEN/.test(d.src));
  }
  check(`in that language's comment syntax${wrongComment.length ? `: ${wrongComment[0]}` : ''}`,
    wrongComment.length, 0);
  check(`and says what goes there${silent.length ? `: ${silent[0]}` : ''}`,
    silent.length, 0);
  check(`without quoting the answer${leaks.length ? `: ${leaks[0]}` : ''}`,
    leaks.length, 0);
  ok(`${Object.keys(GIVEN).length} problems hand over a line on purpose, each with a reason`,
    Object.values(GIVEN).every(why => why.length > 20));
}

/* The strongest check in the suite: each reference solution is compiled and
   run against the problem's own visible and hidden cases, in every language
   the problem claims to accept. A `code` problem whose reference does not pass
   is a problem nobody can solve, and no amount of schema checking would say so.

   Languages this machine lacks are skipped with a notice; CI's ubuntu-latest
   has g++, rustc and python3, so they are verified on every push. */
/* ---------------- one list of languages ---------------- */

/* The build validates every problem's `langs` against its own list; the
   catalogue's Language filter offers options from a second one. If they
   drift, the filter either offers a language no problem can declare or
   silently hides one that several do. */
section('the build and the catalogue agree on what a language is');
{
  const Catalog = grab('Catalog');
  check('the same set', [...Catalog.LANGS].sort(), [...LANGS].sort());
  check('and every one has a label',
    Catalog.LANGS.filter(id => !Catalog.LANG_LABEL[id]), []);

  /* A declared language with no template and no reference is a language the
     problem offers and cannot grade. */
  const unbacked = [];
  for (const p of problems.filter(p => p.type === 'code')) {
    const pay = p.payload || {};
    const sol = solutions[p.id] || {};
    const ref = (sol.key && sol.key.reference) || {};
    /* A workspace is backed by a worked set of files. There is
       deliberately no second copy of the entry point under
       `reference.cpp` — two copies of one file is one too many to keep
       in step. */
    if (Array.isArray(pay.files) && pay.files.length) {
      if (!Array.isArray(ref.files) || !ref.files.length) {
        unbacked.push(`${p.id} is a workspace with no reference files`);
      }
      continue;
    }
    for (const lang of pay.langs || []) {
      if (!ref[lang]) unbacked.push(`${p.id} offers ${lang} with no reference solution`);
    }
  }
  check('every offered language has a reference solution behind it', unbacked, []);
}

section('every code problem is solvable in every language it claims');
const codeProblems = problems.filter(p => p.type === 'code');

if (codeProblems.length) {
  const { run, languages, detectPrlimit } = await import('../judge/server.mjs');
  const { default: fsSync } = await import('node:fs');
  await detectPrlimit();
  const toolchains = await languages();
  const have = Object.fromEntries(toolchains.map(l => [l.id, l.available]));

  const RunHarness = loadScripts(['js/runners/harness.js']).grab('RunHarness');

  for (const p of codeProblems) {
    const sol = solutions[p.id];
    if (!sol || !sol.key || !sol.key.reference) continue;
    const pay = p.payload || {};
    const cases = [...(pay.cases || []), ...(sol.key.cases || [])];

    for (const lang of pay.langs || []) {
      if (!have[lang]) {
        console.log(`  --    ${p.id} [${lang}]: no toolchain here — verified in CI`);
        continue;
      }

      /* A workspace goes to the runner as every file plus the list of
         translation units; g++ compiles and links them in one go. The
         entry point's text is `source` as well, because that is what
         the size and emptiness checks are written against. */
      const workspace = Array.isArray(pay.files) && pay.files.length;
      const files = workspace
        ? sol.key.reference.files.map(f => ({ path: f.path, content: f.content }))
        : null;
      const source = workspace
        ? (files.find(f => f.path === pay.entry) || files[0]).content
        : sol.key.reference[lang];
      const reply = await run({
        lang, source, files,
        sources: workspace ? (pay.build || {}).sources || null : null,
        profile: pay.profile || 'standard',
        cases: cases.map(c => ({ stdin: c.stdin })),
        limits: pay.limits,
      });

      /* A profile this host cannot build (MinGW has no libasan) is a gap in
         the machine, not in the content. */
      if (!reply.compile.ok && /cannot find -l|unrecognized command|not supported/.test(reply.compile.stderr)) {
        console.log(`  --    ${p.id} [${lang}]: profile "${pay.profile}" unsupported here — verified in CI`);
        continue;
      }

      const verdict = RunHarness.judgeRun(reply, cases.map(c => c.expect),
        { requireClean: !!pay.requireClean });

      if (!ok(`${p.id} [${lang}]: the reference solution passes all ${cases.length} cases`, verdict.correct)) {
        console.log(`        ${verdict.feedback}`);
        if (!verdict.built) console.log(`        compile: ${reply.compile.stderr.slice(0, 500)}`);
        else {
          const bad = verdict.cases.find(c => !c.pass);
          if (bad) {
            console.log(`        stdin:    ${JSON.stringify((cases[verdict.cases.indexOf(bad)] || {}).stdin)}`);
            console.log(`        expected: ${JSON.stringify(bad.expect)}`);
            console.log(`        got:      ${JSON.stringify(bad.stdout)}`);
            if (bad.stderr) console.log(`        stderr:   ${bad.stderr.slice(0, 300)}`);
          }
        }
      }
    }
  }
} else {
  console.log('  --    no code problems yet');
}

/* ---------------- probes: the requirement the output cannot show ---------------- */

/* An exercise that says "write a function `power(base, exponent = 2)`" is
   graded by comparing printed characters, and printed characters cannot
   tell that apart from a program with no function in it at all. The
   exercises that ask for something unobservable carry a `key.probe`: a
   `main` the problem owns, compiled with the submission.

   Two claims per probe, and both are checked here against a real
   compiler, because a grader nobody has tried to fool is a grader whose
   strictness is a guess:

     · the reference solution passes its own probe
     · each program in tests/probe-rejects.json — every one of which the
       grader accepted before this existed — is now rejected, either
       because it does not compile against the probe or because it gives
       the wrong answer to a direct call

   The rejects file also carries mistakes caught by an ordinary input
   case that was missing, marked `fails: "cases"`. Those are checked the
   other way round: the case set has to reject them. */

section('probes accept the reference and reject what used to pass');

const rejectFile = JSON.parse(read('tests/probe-rejects.json'));
const probed = problems.filter(p => ((solutions[p.id] || {}).key || {}).probe);

{
  const { run, languages, detectPrlimit } = await import('../judge/server.mjs');
  await detectPrlimit();
  const toolchains = await languages();
  const have = Object.fromEntries(toolchains.map(l => [l.id, l.available]));
  const { grab: grabRun } = loadScripts(['js/runners/harness.js', 'js/runners/probe.js']);
  const RunHarness = grabRun('RunHarness');
  const RunProbe = grabRun('RunProbe');

  /* One program, one case set, one answer: did the grader call it correct? */
  async function verdictFor(id, source, cases, limits) {
    const reply = await run({
      lang: 'cpp', source, profile: 'standard',
      cases: cases.map(c => ({ stdin: c.stdin })), limits,
    });
    const v = RunHarness.judgeRun(reply, cases.map(c => c.expect));
    return { built: v.built, correct: v.correct, feedback: v.feedback, stderr: reply.compile.stderr };
  }

  const ids = [...new Set([...probed.map(p => p.id), ...Object.keys(rejectFile.rejects)])].sort();

  if (!have.cpp) {
    console.log(`  --    no C++ toolchain here — ${ids.length} probed exercises verified in CI`);
  } else {
    for (const id of ids) {
      const p = problems.find(x => x.id === id);
      const sol = solutions[id];
      const probe = (sol.key || {}).probe || null;
      const limits = (p.payload || {}).limits;
      const inputCases = [...(p.payload.cases || []), ...(sol.key.cases || [])];

      if (probe) {
        const v = await verdictFor(id, RunProbe.compose(probe.source, sol.key.reference.cpp),
          RunProbe.cases(probe), limits);
        if (!ok(`${id}: the reference solution passes its own probe`, v.correct)) {
          console.log(`        ${v.built ? v.feedback : v.stderr.slice(0, 400)}`);
        }
      }

      for (const r of rejectFile.rejects[id] || []) {
        const onCases = await verdictFor(id, r.cpp, inputCases, limits);

        if (r.fails === 'cases') {
          ok(`${id}: a case rejects it — ${r.why}`, !onCases.correct);
          continue;
        }

        /* The premise of the claim. If this stops being true the reject is
           no longer evidence of anything, and quietly dropping it would
           leave the probe looking better tested than it is. */
        if (!ok(`${id}: it still passes every input case — ${r.why}`, onCases.correct)) {
          console.log(`        ${onCases.built ? onCases.feedback : onCases.stderr.slice(0, 300)}`);
          continue;
        }

        const onProbe = await verdictFor(id, RunProbe.compose(probe.source, r.cpp),
          RunProbe.cases(probe), limits);
        ok(`${id}: the probe rejects it — ${r.why}`, !onProbe.correct);
      }
    }
  }
}

/* Every reject names an exercise that has a probe, or is marked as caught
   by a case. A reject for a probe that was removed would otherwise sit
   there passing for the wrong reason. */
section('the reject fixtures still match the exercises they are about');
for (const [id, list] of Object.entries(rejectFile.rejects)) {
  ok(`${id}: is a problem`, !!problems.find(p => p.id === id));
  for (const r of list) {
    ok(`${id}: "${r.why.slice(0, 50)}" says how it is caught`,
      r.fails === 'probe' || r.fails === 'cases');
    if (r.fails === 'probe') {
      ok(`${id}: has a probe to be rejected by`, !!((solutions[id] || {}).key || {}).probe);
    }
  }
}

/* The probe's own shape, and the one thing about it that is a rule rather
   than a preference: it must not be reachable from the problem file. A
   probe in payload would be a grading harness on screen. */
section('every probe is well formed and lives with the answer key');
for (const p of probed) {
  const probe = solutions[p.id].key.probe;
  ok(`${p.id}: the probe has a main`, /\bint\s+main\s*\(/.test(probe.source));
  ok(`${p.id}: the probe has at least one case`,
    Array.isArray(probe.cases) && probe.cases.length > 0);
  for (const c of probe.cases || []) {
    ok(`${p.id}: a probe case expects something`, !!String(c.expect || '').trim());
    ok(`${p.id}: a probe case says how it called the code`, !!String(c.calls || probe.calls || '').trim());
  }
  ok(`${p.id}: the probe is not in the problem file`, !(p.payload || {}).probe);
  ok(`${p.id}: single-file, which is what a renamed main makes sense for`,
    !Array.isArray((p.payload || {}).files) || !(p.payload || {}).files.length);
  /* The statement has to say the check exists. A grader that rejects a
     program for a reason the exercise never mentioned is a trap. */
  ok(`${p.id}: the statement says the grader calls the code directly`,
    /What the grader checks/.test(p.statement));
}

/* ---------------- predict keys checked against a real compiler ---------------- */

/* A predicted output is the one kind of key that can be verified absolutely:
   if the snippet is a complete program, compile it and see. Without this, a
   predict problem is only as right as whoever wrote it, and "what does this
   print" is exactly the question where being subtly wrong is worst. */
section('predict snippets marked verifyAs are checked by compiling them');
const verifiable = problems.filter(p => p.type === 'predict' && (p.payload || {}).verifyAs);

if (verifiable.length) {
  const { run, languages, detectPrlimit } = await import('../judge/server.mjs');
  await detectPrlimit();
  const toolchains = await languages();
  const have = Object.fromEntries(toolchains.map(l => [l.id, l.available]));
  const RunHarness = loadScripts(['js/runners/harness.js']).grab('RunHarness');

  for (const p of verifiable) {
    const lang = p.payload.verifyAs;
    const sol = solutions[p.id];
    if (!sol || !sol.key) continue;
    if (!have[lang]) {
      console.log(`  --    ${p.id}: no ${lang} toolchain here — verified in CI`);
      continue;
    }
    /* Some snippets are POSIX — fork, mmap, signals — and will not build on a
       MinGW toolchain however good it is. Gating on the platform says so
       plainly instead of looking like a broken problem. */
    const needPlat = p.payload.verifyPlatform;
    if (needPlat && process.platform !== needPlat) {
      console.log(`  --    ${p.id}: needs ${needPlat}, this is ${process.platform} — verified in CI`);
      continue;
    }

    const reply = await run({ lang, source: p.payload.code, cases: [{ stdin: '' }] });
    if (!reply.compile.ok) {
      ok(`${p.id}: the snippet compiles`, false);
      console.log(`        ${reply.compile.stderr.slice(0, 400)}`);
      continue;
    }
    const got = reply.cases[0].stdout;
    if (!ok(`${p.id}: the real output matches the key`, RunHarness.same(got, sol.key.output))) {
      console.log(`        key says: ${JSON.stringify(sol.key.output)}`);
      console.log(`        it prints: ${JSON.stringify(got)}`);
    }
  }
} else {
  console.log('  --    no predict problems marked verifyAs');
}

section('every concept is actually used');
const used = new Set();
for (const p of problems) {
  for (const pre of p.prereqs || []) {
    used.add(pre.concept);
    /* Its transitive needs count as used too. */
    const stack = [pre.concept];
    while (stack.length) {
      const at = stack.pop();
      for (const need of (concepts[at] || {}).needs || []) {
        if (!used.has(need)) { used.add(need); stack.push(need); }
      }
    }
  }
}
for (const id of Object.keys(concepts)) {
  /* Not a failure — a concept can legitimately be written ahead of the
     problem that will need it — but it should be visible. */
  if (!used.has(id)) console.log(`  --    concepts.json/${id}: not referenced by any problem yet`);
}
ok('at least one concept is in use', used.size > 0);

section('topic coverage');
const byTopic = {};
for (const p of problems) byTopic[p.topic] = (byTopic[p.topic] || 0) + 1;
console.log(`  --    ${Object.entries(byTopic).map(([t, n]) => `${t}:${n}`).join('  ')}`);
ok('every problem sits in a known topic', problems.every(p => p.topic));

report('content');
