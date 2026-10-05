/* ============================================================
   runners/hosted.js — execution on a server, through our proxy.

   The page does not talk to Judge0. It posts a problem-shaped
   request to proxy/ — language, profile name, source, cases —
   and that translates, clamps and forwards it. Three reasons,
   all of them load-bearing:

     · a key for a paid Judge0 plan cannot live in a static page,
       and this way there is nowhere for one to leak from;

     · a public endpoint that forwards caller-supplied compiler
       options is a remote code execution service with extra
       steps, so the flags are chosen server-side from a profile
       name;

     · the limits — source size, case count, cpu, memory, and a
       per-address rate limit — are only limits if the client
       cannot choose them.

   The reply comes back in exactly the shape the local runner
   returns, so nothing downstream can tell which backend ran.
   ============================================================ */

const Hosted = (() => {

  const cfg = () => (Store.config.hosted || {});
  const base = () => String(cfg().url || '').replace(/\/+$/, '');
  const enabled = () => !!cfg().enabled && !!base();

  let state = { checked: false, up: false, error: '', languages: [], limits: null, url: '' };

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    /* Not a user credential — it only raises the cost of casual abuse, and
       the proxy treats it as optional. Anything stronger cannot live in a
       static page at all. */
    if (cfg().clientToken) h['X-Client-Token'] = cfg().clientToken;
    return h;
  };

  /* One probe at a time, shared by everybody who asks while it is in flight.

     Without this the state is marked "checked" the instant a probe starts and
     only filled in when it returns, so a second caller arriving in that window
     is handed a half-built answer that says nothing is up. Two callers in the
     same tick is the normal case — the workspace asks what can run and how, at
     once — and the symptom was a disabled C++ tab beside a healthy proxy. */
  let pending = null;

  function check({ force = false } = {}) {
    if (pending) return pending;
    if (state.checked && !force) return Promise.resolve(state);
    pending = probe().finally(() => { pending = null; });
    return pending;
  }

  async function probe() {
    state = { checked: true, up: false, error: '', languages: [], limits: null, url: base() };

    if (!enabled()) {
      state.error = 'hosted execution is not configured';
      return state;
    }
    try {
      const res = await fetch(`${base()}/health`, {
        headers: headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      state.up = !!body.ok;
      state.languages = body.languages || [];
      state.limits = body.limits || null;
      state.upstreamConfigured = !!body.upstreamConfigured;
      if (!state.up) state.error = 'the proxy answered but reported itself unhealthy';
    } catch (err) {
      state.error = err && err.name === 'TimeoutError'
        ? 'no answer within 8 seconds'
        : String((err && err.message) || err);
    }
    return state;
  }

  const supports = lang => state.up && state.languages.includes(lang);

  async function run(lang, source, cases, { profile = 'standard', runMs } = {}) {
    const fail = (msg, extra = {}) => ({
      lang, backend: 'hosted',
      compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
      cases: [],
      judgeDown: true,
      judgeError: msg,
      ...extra,
    });

    if (!enabled()) return fail('hosted execution is not configured');

    try {
      const res = await fetch(`${base()}/run`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ lang, profile, source, runMs, cases: cases.map(c => ({ stdin: c.stdin })) }),
        /* Comfortably longer than the proxy's own deadline, so a slow
           compile is reported by the proxy rather than guessed at here. */
        signal: AbortSignal.timeout(90000),
      });

      /* A refusal is not a wrong answer, and each kind says something
         different about what to do next. */
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        return fail(body.error || 'the hosted runner is rate limiting you — wait a moment and try again',
          { rateLimited: true, retryAfter: body.retryAfter || null });
      }
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => ({}));
        return fail(body.error || 'this site is not allowed to use that hosted runner');
      }
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        return fail(body.error || 'the hosted runner rejected the request');
      }

      const body = await res.json().catch(() => null);
      if (!body) return fail(`the hosted runner returned ${res.status} with no body`);
      /* 502 carries the shape already, including judgeDown. */
      return body;
    } catch (err) {
      return fail(err && err.name === 'TimeoutError'
        ? 'the hosted runner did not answer in time'
        : String((err && err.message) || err));
    }
  }

  return {
    run, check, enabled, supports,
    get state() { return state; },
  };
})();
