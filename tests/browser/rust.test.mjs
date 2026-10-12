/* Rust in the browser: the whole journey, with nothing installed.

   The point of this backend is that somebody can open the published site
   on a borrowed laptop and have a real rustc check and compile their Rust.
   So this suite runs with the local runner's address pointed at a dead
   port and no hosted runner configured, which means a pass here cannot
   have come from anywhere else.

   Two capabilities, and they are deliberately different sizes:

     check   works on every Rust problem, because --emit=metadata stops
             before the code generation the Cranelift gap is in
     run     works on the problems data/rust-support.json certifies

   Needs the site served:   npm run serve
   And the local runner DOWN, which is the point.

   Run: node tests/browser/rust.test.mjs
        SHOTS=1 ... (also write screenshots)
        BASE=https://… (against the deployed site) */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { section, check, ok, report, toEditorTab } from '../harness.mjs';

const CHANNEL = process.env.BROWSER || null;
const launch = () => chromium.launch(CHANNEL ? { channel: CHANNEL } : {});

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const SHOTS = path.join(process.cwd(), '_shots');
if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.log(`\n  the site is not being served at ${BASE}`);
  console.log(`  start it with:  npm run serve   (${err.message})`);
  process.exit(1);
}

const support = JSON.parse(fs.readFileSync('data/rust-support.json', 'utf8'));
const RUNNABLE = support.browser[0];
/* A second one that also runs here, for the test that leaves a run
   behind and opens something else. It has to be a different problem
   from RUNNABLE, which is not something to leave to list order. */
const OTHER = support.browser.find(id => id !== RUNNABLE) || null;
const NATIVE_ONLY = Object.keys(support.nativeOnly)
  .find(id => id.startsWith('rust-'));

const reference = id =>
  JSON.parse(fs.readFileSync(`solutions/${id}.json`, 'utf8')).key.reference.rust;

const browser = await launch();
const errors = [];

/* A browser that believes it is on a device with nothing installed. */
async function freshPage({ slow = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    if (/ERR_CONNECTION_REFUSED|Failed to load resource|loopback/.test(m.text())) return;
    errors.push(m.text());
  });
  await p.addInitScript(() => {
    localStorage.setItem('invariant/judge-url', 'http://127.0.0.1:2999');
    localStorage.removeItem('invariant/hosted-url');
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  /* The toolchain delivered slowly, so the progress bar has something to
     report. On a fast local server the whole 44 MB arrives before a
     frame is painted and nothing is observable — which is not what a
     reader on a real connection sees.

     A flag rather than unroute(): taking the route off while a handler
     is already waiting on its timer leaves that handler holding a route
     Playwright has stopped tracking, and it throws when it resumes. */
  const slowly = { on: !!slow };
  if (slow) {
    await p.route('**/vendor/rust/*', async route => {
      if (slowly.on) await new Promise(r => setTimeout(r, 1200));
      await route.continue();
    });
  }
  return { ctx, p, slowly };
}

async function paste(p, text) {
  await toEditorTab(p);
  await p.locator('.cm-content').click();
  await p.keyboard.press('Control+A');
  await p.evaluate(t => navigator.clipboard.writeText(t), text);
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(250);
}

async function settled(p, sel = '#runBtn', ms = 180_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const done = await p.evaluate(s => {
      const b = document.querySelector(s);
      return !!b && !b.disabled;
    }, sel);
    if (done) return true;
    await p.waitForTimeout(250);
  }
  return false;
}

const cases = p => p.evaluate(() => {
  const all = [...document.querySelectorAll('.case')];
  return { total: all.length, passed: all.filter(c => c.dataset.pass === 'true').length };
});

/* ---------------- the pins ---------------- */

section('the toolchain is served, and it is the pinned one');
{
  const manifest = JSON.parse(fs.readFileSync('vendor/rust/manifest.json', 'utf8'));
  for (const [name, want] of Object.entries(manifest.files)) {
    const res = await fetch(`${BASE}/vendor/rust/${name}`);
    ok(`${name} is reachable (${res.status})`, res.ok);
    const bytes = new Uint8Array(await res.arrayBuffer());
    check(`${name} is the pinned build`, bytes.length, want.bytes);
  }
  /* The whole point of this toolchain over the alternative. If the
     deployment ever needs these headers, this is where it is noticed. */
  const page = await fetch(BASE);
  const coop = page.headers.get('cross-origin-opener-policy');
  const coep = page.headers.get('cross-origin-embedder-policy');
  ok(`no cross-origin isolation is needed or present (COOP ${coop}, COEP ${coep})`,
    !coop && !coep);
}

/* ---------------- the support list is honest ---------------- */

section('the support list was generated, not written');
{
  ok(`it names the compiler (${support.toolchain.version || support.toolchain.compiler})`,
    /rustc/.test(support.toolchain.version || support.toolchain.compiler));
  ok(`something runs here (${support.browser.length})`, support.browser.length > 0);
  ok(`and what does not says why (${Object.keys(support.nativeOnly).length})`,
    Object.values(support.nativeOnly).every(r => r.length > 40));
}

/* ---------------- check, on every Rust problem ---------------- */

section('a device with nothing installed gets real borrow-checker diagnostics');
{
  const { ctx, p } = await freshPage();
  /* Deliberately the problem that CANNOT be run here: the check path
     does not go through code generation, so it works anyway, and that
     is the whole claim. */
  await p.goto(`${BASE}/#/p/${NATIVE_ONLY}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  const blocked = await p.evaluate(async id => {
    const rows = await window.SystemsLab.Runners.available(['rust'], id);
    return {
      ready: rows[0].ready,
      chip: (document.getElementById('execState') || {}).textContent.trim(),
      judge: (document.getElementById('codeJudgeText') || {}).textContent,
    };
  }, NATIVE_ONLY);
  check(`${NATIVE_ONLY} cannot be run here`, blocked.ready, false);
  ok(`and says so rather than failing on the click ("${blocked.judge}")`,
    /native toolchain/.test(blocked.judge));

  await paste(p, `fn main() {
    let a = String::from("hello");
    let b = a;
    println!("{} {}", a, b);
}`);

  /* The editor lints on a debounce, and the first one pays the
     download. */
  let diag = null;
  for (let i = 0; i < 240; i += 1) {
    diag = await p.evaluate(() => ({
      rows: [...document.querySelectorAll('.ed-problem')].map(r => r.textContent),
      status: (document.querySelector('.ed-status') || {}).textContent || '',
    }));
    if (diag.rows.length) break;
    await p.waitForTimeout(500);
  }
  ok(`rustc found the move (${diag.rows.length} row(s))`, diag.rows.length > 0);
  ok(`and said what it was ("${(diag.rows[0] || '').slice(0, 70)}")`,
    /moved value/.test(diag.rows.join(' ')));
  ok(`the row says which compiler looked ("${diag.status}")`,
    /checked by rustc/.test(diag.status));
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'rust-check.png') });

  /* Fixing it clears them, which is the half that proves the first half
     was not a fixed string. */
  await paste(p, 'fn main() { println!("fine"); }');
  let cleared = false;
  for (let i = 0; i < 120; i += 1) {
    cleared = await p.evaluate(() =>
      document.querySelectorAll('.ed-problem').length === 0);
    if (cleared) break;
    await p.waitForTimeout(500);
  }
  ok('and correcting it clears them', cleared);

  await ctx.close();
}

/* ---------------- run, on a certified problem ---------------- */

section('a certified problem compiles and runs, with the download visible');
{
  const { ctx, p } = await freshPage({ slow: true });
  await p.goto(`${BASE}/#/p/${RUNNABLE}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  const before = await p.evaluate(async id => {
    const rows = await window.SystemsLab.Runners.available(['rust'], id);
    return { ready: rows[0].ready, backend: rows[0].backend, where: rows[0].where,
      version: rows[0].version };
  }, RUNNABLE);
  check('Rust is offered', before.ready, true);
  check('on the in-browser compiler', before.backend, 'browserrust');
  check('and a reader is told it runs here', before.where, 'Browser');
  ok(`with the toolchain named ("${before.version}")`, /rustc/.test(before.version || ''));

  await paste(p, reference(RUNNABLE));

  const t0 = Date.now();
  await p.locator('#runBtn').click();

  let sawProgress = false;
  let sawStop = false;
  for (let i = 0; i < 120 && !(sawProgress && sawStop); i += 1) {
    const look = await p.evaluate(() => ({
      text: (document.querySelector('#cxxDlText') || {}).textContent || '',
      stop: !!document.querySelector('#stopBtn') && !document.querySelector('#stopBtn').hidden,
    }));
    if (/MB/.test(look.text)) sawProgress = true;
    if (look.stop) sawStop = true;
    await p.waitForTimeout(200);
  }
  ok('the download reports itself in megabytes', sawProgress);
  ok('and Stop is live while it happens', sawStop);
  if (process.env.SHOTS && sawProgress) {
    await p.screenshot({ path: path.join(SHOTS, 'rust-downloading.png') });
  }

  ok('the run finishes', await settled(p));
  const first = Date.now() - t0;

  const r = await cases(p);
  const after = await p.evaluate(() => ({
    chip: (document.getElementById('execState') || {}).textContent.trim(),
    stop: document.querySelector('#stopBtn').hidden,
  }));
  ok(`the samples ran (${r.passed}/${r.total}) in ${(first / 1000).toFixed(1)}s including the download`,
    r.total > 0 && r.passed === r.total);
  check('and the bar says where', after.chip, 'Ran on Browser');
  check('Stop is put away again', after.stop, true);

  /* Submitting the reference is the end of the journey. */
  await p.locator('#submitBtn').click();
  ok('the submission finishes', await settled(p, '#submitBtn'));
  await p.waitForTimeout(500);
  const sub = await p.evaluate(id => ({
    verdict: (document.querySelector('.verdict h4') || {}).textContent,
    status: window.SystemsLab.Store.record(id).status,
  }), RUNNABLE);
  check('the reference solution is accepted', sub.verdict, 'Right');
  check('and recorded as solved', sub.status, 'solved');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'rust-solved.png') });

  /* Warm, on the same page: no download, and fast. */
  const t1 = Date.now();
  await p.locator('#runBtn').click();
  await settled(p);
  const warm = Date.now() - t1;
  ok(`a second run pays nothing for the toolchain (${(warm / 1000).toFixed(1)}s)`,
    warm < first);

  await ctx.close();
}

/* ---------------- a wrong answer, then a right one ---------------- */

section('a wrong answer, a compile error, and then a run that works');
{
  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/p/${RUNNABLE}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  /* Something that does not compile. The verdict must be a compile
     failure, not "0 cases passed" — those mean different things and a
     reader who is told the second will go looking for a logic error. */
  await paste(p, 'fn main() { let x: i32 = "no"; println!("{}", x); }');
  await p.locator('#runBtn').click();
  ok('it comes back', await settled(p));
  const broke = await p.evaluate(() => ({
    text: (document.getElementById('runOut') || {}).textContent || '',
    cases: document.querySelectorAll('.case').length,
  }));
  ok(`it says the build failed ("${broke.text.replace(/\s+/g, ' ').slice(0, 70)}")`,
    /did not|error|compile/i.test(broke.text));
  ok('with rustc\'s own message', /E0308|mismatched types/.test(broke.text));
  check('and no cases are claimed to have run', broke.cases, 0);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(SHOTS, 'rust-compile-error.png') });

  /* A program that compiles and gets it wrong is a different verdict. */
  await paste(p, 'fn main() { println!("nope"); }');
  await p.locator('#runBtn').click();
  ok('that comes back too', await settled(p));
  const wrong = await cases(p);
  ok(`now there are cases and they fail (${wrong.passed}/${wrong.total})`,
    wrong.total > 0 && wrong.passed === 0);

  /* And then the right one, after both. */
  await paste(p, reference(RUNNABLE));
  await p.locator('#runBtn').click();
  ok('and the right one still runs after both', await settled(p));
  const right = await cases(p);
  ok(`all its cases pass (${right.passed}/${right.total})`,
    right.total > 0 && right.passed === right.total);

  await ctx.close();
}

/* ---------------- cancelling ---------------- */

section('a compile can be stopped, and the next one still works');
{
  const { ctx, p, slowly } = await freshPage({ slow: true });
  await p.goto(`${BASE}/#/p/${RUNNABLE}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await paste(p, reference(RUNNABLE));

  await p.locator('#runBtn').click();
  /* Wait for Stop to be live, then press it — mid-download, which is the
     longest and most likely moment for somebody to give up. */
  let live = false;
  for (let i = 0; i < 60 && !live; i += 1) {
    live = await p.evaluate(() => {
      const b = document.getElementById('stopBtn');
      return !!b && !b.hidden;
    });
    if (!live) await p.waitForTimeout(150);
  }
  ok('Stop is offered during the download', live);
  await p.locator('#stopBtn').click();
  ok('and the page comes back', await settled(p, '#runBtn', 30_000));

  const stopped = await p.evaluate(() => ({
    out: (document.getElementById('runOut') || {}).textContent || '',
    source: window.SystemsLab.ProblemTypes.get('code').editor().value,
    runnable: !document.getElementById('runBtn').disabled,
  }));
  ok(`it says it stopped ("${stopped.out.replace(/\s+/g, ' ').slice(0, 60)}")`,
    /stopp?ed/i.test(stopped.out));
  ok('the draft is untouched', stopped.source.includes('fn main'));
  ok('and Run is usable again', stopped.runnable);

  /* The real test of a cancel: the next run works. Terminating the
     worker throws the compiler away, so this is the path that
     re-downloads and re-prepares it. */
  slowly.on = false;
  await p.locator('#runBtn').click();
  ok('a run after a cancel finishes', await settled(p));
  const r = await cases(p);
  ok(`and gets the right answer (${r.passed}/${r.total})`,
    r.total > 0 && r.passed === r.total);

  await ctx.close();
}

/* ---------------- a late reply must not land ---------------- */

section('changing problem mid-compile does not land the result elsewhere');
if (!OTHER) {
  console.log('  --    needs two problems certified for the browser; there is one');
} else {
  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/p/${RUNNABLE}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await paste(p, reference(RUNNABLE));
  await p.locator('#runBtn').click();
  await p.waitForTimeout(120);
  await p.goto(`${BASE}/#/p/${OTHER}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(5000);

  const m = await p.evaluate(id => ({
    hash: location.hash,
    here: id,
    chip: (document.getElementById('execState') || {}).textContent.trim(),
    cases: document.querySelectorAll('.case').length,
  }), OTHER);
  ok(`the page moved on (${m.hash})`, m.hash === `#/p/${OTHER}`);
  /* The run that was left behind finished somewhere in those five
     seconds. Its progress callbacks, its download bar and its result
     all belong to a page that is no longer here. */
  ok(`and is not showing the other problem's run ("${m.chip}")`,
    !/^Ran on/.test(m.chip) && !/Fetching|Compiling|Running/.test(m.chip));
  check('no cases from it either', m.cases, 0);

  await ctx.close();
}

/* ---------------- an infinite loop ---------------- */

section('a program that never finishes is stopped');
{
  const { ctx, p } = await freshPage();
  await p.goto(`${BASE}/#/p/${RUNNABLE}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await paste(p, `fn main() {
    let mut n: u32 = 0;
    loop { n = n.wrapping_add(1); if n == u32::MAX { println!("{}", n); } }
}`);
  await p.locator('#runBtn').click();
  ok('it comes back rather than hanging the page', await settled(p, '#runBtn', 120_000));
  const r = await p.evaluate(() => ({
    out: (document.getElementById('runOut') || {}).textContent || '',
    cases: [...document.querySelectorAll('.case')].length,
    alive: !!document.querySelector('.cm-content'),
  }));
  ok('the editor is still there', r.alive);
  ok(`and the result says it ran out of time ("${r.out.replace(/\s+/g, ' ').slice(0, 80)}")`,
    /time|timed out|too long/i.test(r.out));
  await ctx.close();
}

/* ---------------- nothing left the machine ---------------- */

section('nothing was sent anywhere');
{
  const { ctx, p } = await freshPage();
  const outbound = [];
  p.on('request', r => {
    const u = r.url();
    if (u.startsWith(BASE) || u.startsWith('blob:') || u.startsWith('data:')) return;
    outbound.push(`${r.method()} ${u}`);
  });
  await p.goto(`${BASE}/#/p/${RUNNABLE}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await paste(p, reference(RUNNABLE));
  await p.locator('#runBtn').click();
  await settled(p);
  check('no request left this origin', outbound.filter(u => !/127\.0\.0\.1:2999/.test(u)), []);
  await ctx.close();
}

section('no uncaught errors');
ok(errors.length ? `errors: ${errors.join(' | ').slice(0, 300)}` : 'none', errors.length === 0);

await browser.close();
report('browser/rust');
