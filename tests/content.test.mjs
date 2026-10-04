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

import { loadAll, validate, buildIndex } from '../scripts/build-index.mjs';
import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts([
  'js/md.js',
  'js/types/registry.js',
  'js/types/mcq.js',
  'js/types/numeric.js',
  'js/types/order.js',
  'js/types/match.js',
  'js/types/predict.js',
  'js/types/locate.js',
]);
const Types = grab('ProblemTypes');

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

section('the index is current');
const fresh = JSON.stringify(buildIndex(problems), null, 2) + '\n';
let committed = '';
try { committed = (await import('node:fs')).readFileSync(new URL('../data/index.json', import.meta.url), 'utf8'); } catch {}
ok('data/index.json matches the problem files (run npm run build:index)', committed === fresh);

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

/* ---------------- code problems are actually solvable ---------------- */

/* The strongest check in the suite: each reference solution is compiled and
   run against the problem's own visible and hidden cases, in every language
   the problem claims to accept. A `code` problem whose reference does not pass
   is a problem nobody can solve, and no amount of schema checking would say so.

   Languages this machine lacks are skipped with a notice; CI's ubuntu-latest
   has g++, rustc and python3, so they are verified on every push. */
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

      const source = sol.key.reference[lang];
      const reply = await run({
        lang, source,
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
