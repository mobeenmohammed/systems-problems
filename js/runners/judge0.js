/* ============================================================
   runners/judge0.js — a second backend, for running code from a
   device that cannot reach your own machine.

   The local WSL runner is better in every way that matters at
   home: one compile for N cases, sub-50ms round trips, and your
   code never leaves the machine. This exists for the other case
   — a phone, a borrowed laptop, a locked-down work machine —
   where there is no runner to reach.

   ---------------- what was measured, not assumed ----------------

   Probed against https://ce.judge0.com (Judge0 CE 1.14.0) rather
   than read off the docs, because the docs understate it badly:

     C++       GCC 14.1.0   (docs said 9.2.0)
     Rust      1.85.0       (docs said 1.40.0)
     Python    3.13.2
     -std=c++23              accepted; __cplusplus reports 202302
     std::println            works
     -Wall -Wextra           warnings returned in compile_output
                             even when the build SUCCEEDS
     -fsanitize=address      links AND fires, with memory_limit raised
     -fsanitize=undefined    links AND fires
     --edition 2021 (Rust)   accepted
     stdin                   delivered
     compile error           status 6, text in compile_output
     runtime error           status 11, signal in message
     timeout                 status 5
     batch                   works, but each submission is its own
                             compile of the same source

   ---------------- the costs ----------------

   The public endpoint needs **no account and no API key**, so
   there is no secret for a static page to leak. It is rate
   limited: six submissions in quick succession got the connection
   reset, and four seconds of spacing was enough.

   If you outgrow it, Judge0's RapidAPI plans need a RapidAPI
   account and are pay-per-use. A key for those must NOT go in
   this file — put it in a proxy and set judge0.proxyUrl. See the
   README.

   And the thing to be deliberate about: using this sends your
   submission to a third party. For these problems that is
   uninteresting; it is still true.
   ============================================================ */

const Judge0 = (() => {

  /* Measured on ce.judge0.com. Overridable in data/config.json, because a
     different instance numbers its languages differently. */
  const DEFAULT_LANG_IDS = { cpp: 105, rust: 108, python: 109, js: 102 };

  /* The same flags the local runner uses, so a problem means the same thing on
     both backends. Kept here rather than imported because judge/ is Node-side
     and this is browser-side. tests/judge0.test.mjs checks they agree. */
  const PROFILE_FLAGS = {
    cpp: {
      standard: '-std=c++23 -O2 -Wall -Wextra',
      sanitize:  '-std=c++23 -O1 -g -Wall -Wextra -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer',
      strict:    '-std=c++23 -O2 -Wall -Wextra -Wpedantic -Wshadow -Wconversion',
      parallel:  '-std=c++23 -O2 -Wall -Wextra -fopenmp -pthread',
    },
    rust: {
      standard: '-O --edition 2021 -D warnings',
      sanitize: '--edition 2021 -C debug-assertions=on -C overflow-checks=on',
      strict:   '-O --edition 2021 -D warnings',
      parallel: '-O --edition 2021',
    },
  };

  /* AddressSanitizer reserves an enormous virtual mapping, so the default
     memory limit kills it before main(). Raising it is what made the probe
     report stack-buffer-overflow instead of an allocation failure. */
  const MEMORY_KB = { standard: 128000, sanitize: 512000, strict: 128000, parallel: 256000 };

  const STATUS = {
    1: 'In Queue', 2: 'Processing', 3: 'Accepted',
    4: 'Wrong Answer', 5: 'Time Limit Exceeded', 6: 'Compilation Error',
    7: 'Runtime Error (SIGSEGV)', 8: 'Runtime Error (SIGXFSZ)',
    9: 'Runtime Error (SIGFPE)', 10: 'Runtime Error (SIGABRT)',
    11: 'Runtime Error (NZEC)', 12: 'Runtime Error (Other)',
    13: 'Internal Error', 14: 'Exec Format Error',
  };

  const cfg = () => (Store.config.judge0 || {});
  const base = () => String(cfg().proxyUrl || cfg().url || 'https://ce.judge0.com').replace(/\/+$/, '');
  const langId = lang => (cfg().languageIds || DEFAULT_LANG_IDS)[lang];

  const enabled = () => !!cfg().enabled;
  const supports = lang => enabled() && langId(lang) !== undefined;

  /* A proxy is the only place an API key belongs. If one is configured we send
     no key ourselves — the proxy adds it — which is the whole point. */
  function headers() {
    const h = { 'Content-Type': 'application/json' };
    const extra = cfg().headers;
    if (extra && typeof extra === 'object' && !cfg().proxyUrl) Object.assign(h, extra);
    return h;
  }

  /* ---------------- probing ---------------- */

  let state = { checked: false, up: false, languages: [], error: '', about: null };

  async function check({ force = false } = {}) {
    if (state.checked && !force) return state;
    state = { checked: true, up: false, languages: [], error: '', about: null };
    if (!enabled()) { state.error = 'not enabled'; return state; }
    try {
      const res = await fetch(`${base()}/languages`, {
        headers: headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const all = await res.json();
      const byId = new Map(all.map(l => [l.id, l.name]));
      state.languages = Object.entries(cfg().languageIds || DEFAULT_LANG_IDS)
        .filter(([, id]) => byId.has(id))
        .map(([lang, id]) => ({ id: lang, judge0Id: id, version: byId.get(id) }));
      state.up = true;
    } catch (err) {
      state.error = err && err.name === 'TimeoutError'
        ? 'no answer within 8 seconds'
        : String((err && err.message) || err);
    }
    return state;
  }

  /* ---------------- running ----------------

     One submission per case, which is how Judge0 works — there is no "compile
     once, run many". So a problem with eight hidden cases costs eight compiles
     and eight round trips. That is the main reason the local runner is
     preferred when it is reachable, and why the UI says which one ran. */

  async function run(lang, source, cases, { profile = 'standard', runMs } = {}) {
    const id = langId(lang);
    if (id === undefined) {
      return {
        lang,
        compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
        cases: [],
        judgeError: `Judge0 has no language id configured for "${lang}"`,
        backend: 'judge0',
      };
    }

    const flags = (PROFILE_FLAGS[lang] || {})[profile] || (PROFILE_FLAGS[lang] || {}).standard;
    const cpuSeconds = Math.max(1, Math.ceil((Number(runMs) || 5000) / 1000));

    const submissions = cases.map(c => ({
      language_id: id,
      source_code: source,
      stdin: typeof c.stdin === 'string' ? c.stdin : '',
      ...(flags ? { compiler_options: flags } : {}),
      ...(Array.isArray(c.args) && c.args.length ? { command_line_arguments: c.args.join(' ') } : {}),
      cpu_time_limit: cpuSeconds,
      wall_time_limit: Math.min(cpuSeconds + 5, 20),
      memory_limit: MEMORY_KB[profile] || MEMORY_KB.standard,
    }));

    let results;
    try {
      results = await submitBatch(submissions);
    } catch (err) {
      return {
        lang,
        compile: { ok: false, stdout: '', stderr: '', ms: 0, timedOut: false },
        cases: [],
        judgeDown: true,
        judgeError: String((err && err.message) || err),
        backend: 'judge0',
      };
    }

    /* A compilation error is the same source failing on every case, so it is
       reported once as a build failure with no cases — the same shape the
       local runner uses, so nothing downstream learns which backend ran. */
    const compileError = results.find(r => r.status_id === 6);
    if (compileError) {
      return {
        lang, profile, backend: 'judge0',
        compile: {
          ok: false,
          stdout: '',
          stderr: String(compileError.compile_output || 'compilation failed'),
          ms: 0,
          timedOut: false,
        },
        cases: [],
      };
    }

    /* Warnings arrive per submission; they are identical across cases because
       the source is, so the first non-empty one is the compile output. */
    const warning = results.map(r => String(r.compile_output || '')).find(t => t.trim());

    return {
      lang, profile, backend: 'judge0',
      compile: { ok: true, stdout: '', stderr: warning || '', ms: 0, timedOut: false },
      cases: results.map(toCase),
    };
  }

  function toCase(r) {
    const status = Number(r.status_id);
    const timedOut = status === 5;
    const stderr = String(r.stderr || '');
    /* Judge0 does not return an exit code field on CE, but it puts the shell's
       status in `message` for a non-zero exit, which is where the signal
       number hides too. */
    const fromMessage = /error status (\d+)/.exec(String(r.message || ''));
    const exit = status === 3 ? 0
      : timedOut ? -1
      : fromMessage ? Number(fromMessage[1])
      : (status >= 7 && status <= 12) ? 1
      : 0;

    return {
      stdout: String(r.stdout || ''),
      stderr: stderr || (status !== 3 && r.message ? String(r.message) : ''),
      exit,
      signal: status >= 7 && status <= 10 ? (STATUS[status] || '').replace(/.*\((SIG\w+)\).*/, '$1') : null,
      timedOut,
      ms: Math.round((Number(r.time) || 0) * 1000),
      sanitizer: /AddressSanitizer|UndefinedBehaviorSanitizer|LeakSanitizer|runtime error:/.test(stderr),
      judge0Status: STATUS[status] || `status ${status}`,
    };
  }

  /* Submit all cases at once, then poll until every one has left the queue.
     The batch endpoint returns tokens rather than results. */
  async function submitBatch(submissions) {
    const post = await fetch(`${base()}/submissions/batch?base64_encoded=false`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ submissions }),
      signal: AbortSignal.timeout(30000),
    });
    if (post.status === 429) throw new Error('Judge0 rate limit — wait a few seconds and try again');
    if (!post.ok) throw new Error(`Judge0 returned ${post.status} ${post.statusText}`);

    const tokens = (await post.json()).map(x => x.token).filter(Boolean);
    if (!tokens.length) throw new Error('Judge0 accepted the batch but returned no tokens');

    const fields = 'stdout,stderr,status_id,time,memory,message,compile_output';
    const deadline = Date.now() + 90_000;
    let delay = 450;

    for (;;) {
      const res = await fetch(
        `${base()}/submissions/batch?tokens=${tokens.join(',')}&base64_encoded=false&fields=${fields}`,
        { headers: headers(), signal: AbortSignal.timeout(20000) },
      );
      if (res.status === 429) throw new Error('Judge0 rate limit while polling — try again shortly');
      if (!res.ok) throw new Error(`Judge0 returned ${res.status} while polling`);
      const body = await res.json();
      const rows = body.submissions || [];
      /* 1 = queued, 2 = processing. Anything else is finished. */
      if (rows.length === tokens.length && rows.every(r => Number(r.status_id) > 2)) return rows;
      if (Date.now() > deadline) throw new Error('Judge0 did not finish within 90 seconds');
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.4, 2500);
    }
  }

  return {
    run, check, enabled, supports,
    get state() { return state; },
    DEFAULT_LANG_IDS, PROFILE_FLAGS, STATUS,
  };
})();
