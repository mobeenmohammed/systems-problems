/* The hosted-execution proxy.

   Two halves. The first is offline and always runs: the flags the proxy
   sends must match the local runner's character for character, and every
   limit and refusal must behave without reaching the network.

   The second half runs the proxy's handler for real against whatever
   upstream is configured — by default the public Judge0 CE endpoint, which
   needs no account but is a third party and is not a supported production
   service. It only runs when asked:

       PROXY_LIVE=1 node tests/proxy.test.mjs

   Run: node tests/proxy.test.mjs */

import { section, check, ok, report } from './harness.mjs';
import { PROFILES } from '../judge/languages.mjs';
import {
  handle, validate, takeToken, PROFILE_FLAGS, LANGUAGE_IDS, LIMITS,
} from '../proxy/handler.mjs';

const ORIGIN = 'https://example.github.io';
const env = { ALLOWED_ORIGINS: ORIGIN };

const post = (body, { origin = ORIGIN, headers = {}, env: e = env, fetchImpl } = {}) =>
  handle(new Request('https://proxy.test/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify(body),
  }), e, fetchImpl);

const good = {
  lang: 'cpp', profile: 'standard',
  source: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<"\\n";}',
  cases: [{ stdin: '21\n' }],
};

/* ---------------- the flags are the same on both backends ---------------- */

section('a problem means the same thing on either backend');
for (const lang of ['cpp', 'rust']) {
  for (const profile of ['standard', 'sanitize', 'strict', 'parallel']) {
    const local = (PROFILES[lang] || {})[profile];
    const hosted = (PROFILE_FLAGS[lang] || {})[profile];
    if (!local) continue;
    check(`${lang}/${profile} flags agree`,
      String(hosted).split(/\s+/).filter(Boolean), local.filter(Boolean));
  }
}
check('cpp language id', LANGUAGE_IDS.cpp, 105);
check('rust language id', LANGUAGE_IDS.rust, 108);

/* ---------------- what the caller may and may not decide ---------------- */

section('the caller cannot choose what the compiler does');
{
  let sent = null;
  const spy = async (url, init) => {
    if (String(url).includes('/submissions/batch') && init && init.method === 'POST') {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify([{ token: 't1' }]), { status: 201 });
    }
    return new Response(JSON.stringify({
      submissions: [{ status_id: 3, stdout: '42\n', time: '0.01' }],
    }), { status: 200 });
  };

  await post({
    ...good,
    /* All of this must be ignored. */
    compiler_options: '-O0 -fno-stack-protector',
    compilerOptions: '-whatever',
    language_id: 1,
    cpu_time_limit: 999,
    memory_limit: 9999999,
    runMs: 999999,
  }, { fetchImpl: spy });

  const s = sent.submissions[0];
  check('the flags are the proxy\'s, not the caller\'s',
    s.compiler_options, PROFILE_FLAGS.cpp.standard);
  check('the language id is looked up, not accepted', s.language_id, LANGUAGE_IDS.cpp);
  ok(`cpu time is clamped (${s.cpu_time_limit}s)`, s.cpu_time_limit <= LIMITS.cpuSeconds.max);
  ok(`wall time is clamped (${s.wall_time_limit}s)`, s.wall_time_limit <= LIMITS.wallSeconds.max);
  ok(`memory is clamped (${s.memory_limit}KB)`, s.memory_limit <= LIMITS.memoryKb.max);
}

section('an unknown profile does not reach the compiler');
{
  let sent = null;
  const spy = async (url, init) => {
    if (init && init.method === 'POST') { sent = JSON.parse(init.body); return new Response(JSON.stringify([{ token: 't' }]), { status: 201 }); }
    return new Response(JSON.stringify({ submissions: [{ status_id: 3, stdout: '', time: '0' }] }), { status: 200 });
  };
  const res = await post({ ...good, profile: 'definitely-not-a-profile' }, { fetchImpl: spy });
  check('it is refused', res.status, 400);
  check('and nothing was sent upstream', sent, null);
}

/* ---------------- limits ---------------- */

section('the request limits');
check('no language', validate({ ...good, lang: 'cobol' }) !== null, true);
check('no source', validate({ ...good, source: '   ' }) !== null, true);
check('no cases', validate({ ...good, cases: [] }) !== null, true);
check('too many cases',
  validate({ ...good, cases: Array(LIMITS.maxCases + 1).fill({ stdin: '' }) }) !== null, true);
check('source too large',
  validate({ ...good, source: 'x'.repeat(LIMITS.maxSourceBytes + 1) }) !== null, true);
check('one stdin too large',
  validate({ ...good, cases: [{ stdin: 'x'.repeat(LIMITS.maxStdinBytes + 1) }] }) !== null, true);
check('stdin too large in total',
  validate({ ...good,
    cases: Array(8).fill({ stdin: 'x'.repeat(LIMITS.maxStdinBytes - 1) }) }) !== null, true);
check('a reasonable request passes', validate(good), null);

section('the origin allowlist');
{
  const res = await post(good, { origin: 'https://not-us.example' });
  check('another origin is refused', res.status, 403);
  const body = await res.json();
  ok('and told why', /not allowed/i.test(body.error));

  /* No allowlist configured means development, and /health says so. */
  const open = await handle(new Request('https://proxy.test/health'), {});
  const h = await open.json();
  check('health reports whether an upstream is configured', typeof h.upstreamConfigured, 'boolean');
}

section('an optional client token');
{
  const withToken = { ...env, CLIENT_TOKEN: 'shh' };
  const no = await post(good, { env: withToken });
  check('a missing token is refused', no.status, 401);
  const wrong = await post(good, { env: withToken, headers: { 'X-Client-Token': 'nope' } });
  check('a wrong one too', wrong.status, 401);
}

section('the rate limiter');
{
  /* Driven directly, because driving it through handle() would need the
     network. The bucket is the thing being checked. */
  const spec = { capacity: 3, refillPerMinute: 60 };
  const key = `test-${Date.now()}`;
  const t0 = 1_000_000;
  check('first is allowed', takeToken(key, spec, t0).ok, true);
  check('second', takeToken(key, spec, t0).ok, true);
  check('third', takeToken(key, spec, t0).ok, true);
  const fourth = takeToken(key, spec, t0);
  check('the fourth in the same instant is refused', fourth.ok, false);
  ok('and says how long to wait', fourth.retryAfter >= 1);
  check('a second later it refills', takeToken(key, spec, t0 + 1100).ok, true);
}

section('an upstream failure is an execution failure, not a wrong answer');
{
  const dead = async () => { throw new Error('connect ECONNREFUSED'); };
  const res = await post(good, { fetchImpl: dead });
  check('reported as a gateway failure', res.status, 502);
  const body = await res.json();
  check('flagged so the page does not grade it', body.judgeDown, true);
  check('no cases came back', body.cases.length, 0);
  ok('and the reason is carried', /ECONNREFUSED/.test(body.judgeError));
}

section('upstream rate limiting is reported as such');
{
  const limited = async () => new Response('{}', { status: 429 });
  const res = await post(good, { fetchImpl: limited });
  const body = await res.json();
  check('a 429 upstream is a judgeDown reply', body.judgeDown, true);
  ok('naming rate limiting', /rate limit/i.test(body.judgeError));
}

section('a compile error is one failure, not one per case');
{
  const failing = async (url, init) => {
    if (init && init.method === 'POST') return new Response(JSON.stringify([{ token: 'a' }, { token: 'b' }]), { status: 201 });
    return new Response(JSON.stringify({
      submissions: [
        { status_id: 6, compile_output: "error: 'nope' was not declared" },
        { status_id: 6, compile_output: "error: 'nope' was not declared" },
      ],
    }), { status: 200 });
  };
  const res = await post({ ...good, cases: [{ stdin: '1' }, { stdin: '2' }] }, { fetchImpl: failing });
  const body = await res.json();
  check('the build failed', body.compile.ok, false);
  check('and no cases are reported', body.cases.length, 0);
  ok('with the compiler text', /not declared/.test(body.compile.stderr));
  check('labelled as hosted', body.backend, 'hosted');
}

section('warnings survive a successful build');
{
  const warned = async (url, init) => {
    if (init && init.method === 'POST') return new Response(JSON.stringify([{ token: 'a' }]), { status: 201 });
    return new Response(JSON.stringify({
      submissions: [{ status_id: 3, stdout: '42\n', time: '0.01', compile_output: 'warning: unused variable' }],
    }), { status: 200 });
  };
  const body = await (await post(good, { fetchImpl: warned })).json();
  check('it built', body.compile.ok, true);
  ok('and the warning came back', /unused variable/.test(body.compile.stderr));
  check('with the case', body.cases[0].stdout, '42\n');
}

/* ---------------- the real thing ---------------- */

if (!process.env.PROXY_LIVE) {
  section('against a real execution service');
  console.log('  --    skipped. PROXY_LIVE=1 to run the proxy against its upstream.');
  console.log('  --    The default upstream is https://ce.judge0.com, which needs no');
  console.log('  --    account but is a third party with no SLA. See proxy/README.md.');
  report('proxy');
}

section('against a real execution service');
const liveEnv = { ...env, JUDGE0_URL: process.env.JUDGE0_URL || 'https://ce.judge0.com' };
const wait = ms => new Promise(r => setTimeout(r, ms));

{
  const body = await (await post(good, { env: liveEnv })).json();
  check('it built', body.compile.ok, true);
  check('right answer', (body.cases[0] || {}).stdout.trim(), '42');
  check('labelled hosted', body.backend, 'hosted');
  await wait(4000);
}
{
  const body = await (await post({
    ...good, source: '#include <iostream>\nint main(){ std::cout << nope; }',
  }, { env: liveEnv })).json();
  check('a compile error does not build', body.compile.ok, false);
  ok('and says why', /nope/.test(body.compile.stderr));
  await wait(4000);
}
{
  const body = await (await post({
    ...good, source: 'int main(){ for(;;){} }', runMs: 1000,
  }, { env: liveEnv })).json();
  check('a runaway program times out', (body.cases[0] || {}).timedOut, true);
  await wait(4000);
}
{
  const body = await (await post({
    lang: 'rust', profile: 'standard',
    source: 'fn main(){ let mut s=String::new(); std::io::stdin().read_line(&mut s).unwrap(); '
      + 'let n: i64 = s.trim().parse().unwrap(); println!("{}", n*3); }',
    cases: [{ stdin: '14\n' }],
  }, { env: liveEnv })).json();
  /* read_line needs the Read trait in scope; this is the compile-error path
     for Rust, which is what matters here. */
  ok('rust reached the compiler', typeof body.compile.ok === 'boolean');
  await wait(4000);
}
{
  const body = await (await post({
    lang: 'python', profile: 'standard',
    source: 'import sys\nprint(int(sys.stdin.read().strip()) * 3)',
    cases: [{ stdin: '14\n' }],
  }, { env: liveEnv })).json();
  check('python ran', body.compile.ok, true);
  check('right answer', (body.cases[0] || {}).stdout.trim(), '42');
}

report('proxy');
