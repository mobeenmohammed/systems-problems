/* ============================================================
   assessment-view.js — the timed mode: the list, the page
   before the clock starts, the attempt itself, and the review
   afterwards.

   Four views, and the order matters because each one exists to
   stop a surprise in the next:

     #/assess                  what there is, and what you have sat
     #/assess/<id>             everything before the clock starts
     #/assess/<id>/go          the attempt
     #/assess/review/<attempt> what happened

   The pre-flight page is not ceremony. An assessment that tells
   you its duration after you have started it, or that reaches
   problem three and discovers there is no compiler, has wasted
   something you cannot get back. So the duration, the problem
   count, the languages, the scoring and the execution check all
   happen before the clock exists.
   ============================================================ */

const AssessmentView = (() => {

  const { el } = ProblemTypes;
  const $ = sel => document.querySelector(sel);

  /* ---------------- the clock ----------------

     One ticker for the whole mode. It reads the deadline and
     subtracts; it never decrements anything. A tab in the background
     has its timers throttled to about once a minute, so a counter
     would hand back time to anybody who switched away — this just
     reads the wrong-by-a-minute clock later and gets the right
     answer. */

  let ticker = null;
  let live = null;        /* { attempt, def } while one is on screen */
  let finishing = false;  /* the guard that makes finalising happen once */

  /* ---------------- fullscreen ----------------

     Asked for once, from the Start click, because that is the only
     moment a browser will grant it — the request has to come out of a
     user gesture, and the gesture is pressing Start.

     Everything after that is deliberately passive. If the browser
     refuses, nothing happens and the attempt is unaffected: the
     full-viewport layout is CSS on `body[data-attempt]` and owes
     nothing to the Fullscreen API. If the reader presses Escape, they
     leave fullscreen and stay in the attempt, and nothing asks again —
     re-requesting on `fullscreenchange` is a page fighting its reader,
     and it would not work anyway, since leaving fullscreen is not a
     gesture that grants entering it.

     The flag records only whether we were the ones who asked, so that
     finishing can put the browser back the way it was found. */
  let askedFullscreen = false;

  function goFullscreen() {
    const el0 = document.documentElement;
    if (!el0.requestFullscreen || document.fullscreenElement) return;
    try {
      const r = el0.requestFullscreen({ navigationUI: 'hide' });
      askedFullscreen = true;
      /* A rejected promise here is ordinary: a permissions policy, a
         browser that only allows it from a direct click on a button it
         recognises, or a reader who has turned it off. */
      if (r && r.catch) r.catch(() => { askedFullscreen = false; });
    } catch { askedFullscreen = false; }
  }

  function dropFullscreen() {
    if (!askedFullscreen) return;
    askedFullscreen = false;
    if (!document.fullscreenElement || !document.exitFullscreen) return;
    try {
      const r = document.exitFullscreen();
      if (r && r.catch) r.catch(() => {});
    } catch { /* nothing to undo */ }
  }

  function startTicking() {
    stopTicking();
    ticker = setInterval(tick, 1000);
    /* Coming back to a throttled tab: re-read and check immediately
       rather than waiting up to a second to notice the deadline went
       by, and rather than trusting an object that was loaded before
       the tab was put away. */
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    tick();
  }

  function stopTicking() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    document.removeEventListener('visibilitychange', recheck);
    window.removeEventListener('focus', recheck);
  }

  /* The per-second tick reads a copy held in memory, because asking
     IndexedDB every second for a number that only changes when the
     attempt starts would be absurd. But that copy can go stale in two
     ways that matter, and both are about a second tab:

       · another tab finished or abandoned this attempt, so it is no
         longer running and this page must stop pretending it is;
       · another tab started a different one.

     Neither is a conflict to resolve — there is at most one running
     attempt and the store is the single answer to which. So whenever
     this tab comes back to the front, it re-reads and adopts what it
     finds. That is also what makes the deadline honest after the tab
     has been shut for an hour. */
  async function recheck() {
    if (!live || document.visibilityState === 'hidden') return;
    Attempts._reset();
    const fresh = await Attempts.get(live.attempt.id);
    if (!fresh) { tick(); return; }
    if (fresh.state !== 'running') {
      /* Finalised elsewhere. Do not finalise it again — go and read it. */
      stopTicking();
      const id = fresh.id;
      live = null;
      location.hash = `#/assess/review/${id}`;
      return;
    }
    live.attempt = fresh;
    tick();
  }

  function clockText(ms) {
    if (ms == null) return 'Untimed';
    const over = ms <= 0;
    const t = Math.abs(ms);
    const h = Math.floor(t / 3_600_000);
    const m = Math.floor((t % 3_600_000) / 60_000);
    const sec = Math.floor((t % 60_000) / 1000);
    const body = h
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
    return over ? `-${body}` : body;
  }

  function tick() {
    if (!live) return;
    const node = $('#oaClock');
    const ms = Attempts.msLeft(live.attempt);
    if (node) {
      node.textContent = clockText(ms);
      node.dataset.state = ms == null ? 'none'
        : ms <= 0 ? 'over'
        : ms < 60_000 ? 'urgent'
        : ms < 5 * 60_000 ? 'soon'
        : 'ok';
    }
    if (ms != null && ms <= 0) expire();
  }

  /* The deadline has passed. Whatever is in the editor at this moment is
     what is graded — that is said on the pre-flight page, before
     starting, rather than discovered here. */
  async function expire() {
    if (finishing || !live) return;
    finishing = true;
    stopTicking();
    const { attempt, def } = live;
    await flushDraft();
    const done = await Attempts.finish(attempt.id, def, { reason: 'expired' });
    finishing = false;
    live = null;
    UI.toast('Time. The attempt was finalised with whatever was saved.', 'bad', 9000);
    location.hash = `#/assess/review/${done.id}`;
  }

  /* The editor saves on every keystroke, so the attempt is already
     current — but the very last character before the deadline is worth
     being sure about, and this costs nothing. */
  async function flushDraft() {
    const impl = ProblemTypes.get('code');
    if (!live || !impl || !impl.editor) return;
    const ed = impl.editor();
    if (!ed || !live.problemId) return;
    await Attempts.saveDraft(live.attempt.id, live.problemId,
      live.lang || '_', ed.value);
  }

  /* ---------------- the list ---------------- */

  async function renderList() {
    const host = $('#assessList');
    if (!host) return;
    await Assessments.load();
    const defs = Assessments.all();

    const blurb = $('#assessBlurb');
    if (blurb) {
      blurb.textContent = defs.length
        ? 'Timed, from a separate bank of problems that are not in the '
          + 'catalogue. Nothing here touches your XP or a problem’s solved '
          + 'status — a result under a clock is a different kind of evidence '
          + 'and is kept apart from one.'
        : 'Nothing is defined yet.';
    }

    if (!defs.length) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'No assessments loaded' }),
        el('p', { class: 'muted', text: Assessments.error
          ? `${Assessments.error}. Serve the folder over HTTP rather than opening the file directly.`
          : 'Add one to data/assessments.json.' }),
      ]));
      return;
    }

    const attempts = await Attempts.all();
    const running = await Attempts.running();

    const cards = defs.map(def => {
      const mine = attempts.filter(a => a.assessmentId === def.id);
      const best = mine.filter(a => a.score != null)
        .reduce((b, a) => (b == null || a.score > b.score ? a : b), null);
      const b = Assessments.brief(def);
      const isLive = running && running.assessmentId === def.id;

      return el('a', {
        class: 'oa-card', href: `#/assess/${def.id}`,
        'data-state': isLive ? 'running' : mine.length ? 'sat' : 'new',
      }, [
        el('div', { class: 'oa-card-top' }, [
          el('h3', { text: def.title }),
          isLive
            ? el('span', { class: 'pill', style: 'color:var(--warn)', text: 'In progress' })
            : el('span', { class: 'pill pill-plain', text: Store.DIFF_BY_ID[def.difficulty]?.label || def.difficulty }),
        ]),
        el('p', { class: 'oa-card-blurb', text: def.description }),
        el('div', { class: 'oa-facts tiny' }, [
          el('span', { text: def.durationMin ? `${def.durationMin} min` : 'Untimed' }),
          el('span', { text: `${b.count} ${b.count === 1 ? 'problem' : 'problems'}` }),
          b.code ? el('span', { text: b.langs.map(l => Catalog.LANG_LABEL[l] || l).join(', ') }) : null,
          el('span', { class: 'faint', text: `v${def.version}` }),
        ]),
        el('div', { class: 'oa-card-foot tiny' }, [
          el('span', {
            class: 'faint',
            text: mine.length
              ? `${mine.length} ${mine.length === 1 ? 'attempt' : 'attempts'}`
              : 'Not attempted',
          }),
          best != null && best.score != null
            ? el('span', { text: `Best ${Math.round(best.score * 100)}%` })
            : null,
        ]),
      ]);
    });

    const parts = [el('div', { class: 'oa-cards' }, cards)];

    if (attempts.length) {
      parts.push(el('h2', { class: 'oa-head', text: 'Attempt history' }));
      parts.push(el('div', { class: 'oa-history' }, attempts.map(a => el('a', {
        class: 'oa-row', href: a.state === 'running'
          ? `#/assess/${a.assessmentId}` : `#/assess/review/${a.id}`,
        'data-state': a.state,
      }, [
        el('span', { class: 'oa-row-title' }, [
          a.title,
          el('span', { class: 'tiny faint', text: ` · attempt ${a.ordinal}` }),
        ]),
        el('span', { class: 'tiny faint', text: new Date(a.startedAt).toLocaleString() }),
        el('span', {
          class: 'oa-row-state tiny',
          text: a.state === 'running' ? 'In progress'
            : a.state === 'expired' ? 'Ran out of time'
            : 'Finished',
        }),
        el('span', {
          class: 'oa-row-score',
          text: a.score == null ? '—' : `${Math.round(a.score * 100)}%`,
        }),
      ]))));
    }

    host.replaceChildren(...parts);
  }

  /* ---------------- before the clock ---------------- */

  async function renderBrief(id) {
    const host = $('#assessBrief');
    if (!host) return;
    await Assessments.load();
    const def = Assessments.byId(id);

    if (!def) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'No such assessment' }),
        el('a', { class: 'btn', href: '#/assess' }, ['All assessments']),
      ]));
      return;
    }

    const b = Assessments.brief(def);
    const mine = await Attempts.forAssessment(def.id);
    const running = await Attempts.running();
    const resumable = running && running.assessmentId === def.id ? running : null;
    const elsewhere = running && running.assessmentId !== def.id ? running : null;

    const scoring = def.scoring || {};
    const fb = def.feedback || {};

    const parts = [
      el('div', { class: 'crumbs' }, [el('a', { href: '#/assess', text: '← Assessments' })]),
      el('h1', { text: def.title }),
      el('p', { class: 'muted prose', text: def.description }),
    ];

    if (b.missing.length) {
      parts.push(el('div', { class: 'oa-note' }, [
        el('p', {}, [`This assessment names ${b.missing.length} problem(s) that are `
          + `not in the bank: ${b.missing.join(', ')}. It cannot be started until `
          + 'that is fixed.']),
      ]));
    }

    /* Everything you are owed before the clock exists. */
    parts.push(el('div', { class: 'oa-brief' }, [
      fact('Duration', def.durationMin ? `${def.durationMin} minutes` : 'Untimed',
        def.durationMin
          ? 'The clock starts when you press Start and runs in real time. '
            + 'Closing the tab does not pause it.'
          : 'There is no clock. Finish when you are done.'),
      fact('Problems', String(b.count),
        b.problems.map(p => (p.meta || {}).title || p.id).join(' · ')),
      fact('Languages', b.langs.length
        ? b.langs.map(l => Catalog.LANG_LABEL[l] || l).join(', ') : 'None — no code here',
        b.code ? `${b.code} of the ${b.count} are coding exercises.`
          : 'Nothing here has to be compiled.'),
      fact('Scoring', scoring.partialCredit === false
        ? 'All or nothing per problem' : 'Weighted, with partial credit',
        weightWords(b, scoring)),
      fact('Pass mark', scoring.passMark != null
        ? `${Math.round(scoring.passMark * 100)}%` : 'None',
        scoring.passMark != null
          ? 'Reported at the end. A problem that could not be run at all leaves '
            + 'the attempt ungraded rather than failed.'
          : 'You get a score, not a verdict.'),
      fact('While it runs', fb.duringAttempt === 'none'
        ? 'Nothing until you finish' : 'The sample cases only',
        `Hints are ${fb.hints ? 'available' : 'off'}; solutions are `
          + `${fb.solutions ? 'available' : 'off'}. Run checks the visible cases and `
          + 'does not submit. Submit records an answer and can be done again.'),
    ]));

    /* What this device can actually run, asked now rather than at
       problem three with eleven minutes left. */
    const execBox = el('div', { class: 'oa-exec', id: 'oaExec' }, [
      el('p', { class: 'small muted', text: 'Checking what can run…' }),
    ]);
    parts.push(el('h2', { class: 'oa-head', text: 'Before you start' }));
    parts.push(execBox);

    /* The honest limits. Said here, once, in plain words. */
    parts.push(el('div', { class: 'oa-honest' }, [
      el('h3', { text: 'What this is, and what it is not' }),
      el('ul', {}, [
        el('li', { text: 'This is a personal practice mode. The clock and the '
          + 'hidden cases are both in this browser, and anybody who wants to edit '
          + 'them can. Nothing here watches you, and nothing here is tamper-proof.' }),
        el('li', { text: 'The clock is this device’s clock, and it keeps running '
          + 'while the tab is closed. Reopening the page resumes the same attempt '
          + 'with the time that has actually passed.' }),
        el('li', { text: def.durationMin
          ? 'When the time runs out, whatever is saved at that moment is what is '
            + 'graded, and the attempt is finalised once. Your drafts are saved as '
            + 'you type, so that is the last thing you wrote.'
          : 'There is no deadline, so nothing is finalised for you.' }),
        el('li', { text: 'Nothing here touches your XP, your streak, or whether a '
          + 'problem counts as solved. A retake is a separate attempt and earns '
          + 'nothing twice.' }),
      ]),
    ]));

    /* The button, and which kind of start it is. */
    const actions = [];
    if (elsewhere) {
      actions.push(el('div', { class: 'oa-note' }, [
        el('p', {}, ['Another assessment is in progress — ',
          el('a', { href: `#/assess/${elsewhere.assessmentId}`, text: elsewhere.title }),
          '. Finish or abandon it before starting this one; two clocks at once '
          + 'is a state nobody can be in.']),
      ]));
    } else if (resumable) {
      actions.push(el('div', { class: 'oa-start' }, [
        el('a', {
          class: 'btn btn-primary btn-lg', href: `#/assess/${def.id}/go`,
        }, ['Resume attempt']),
        el('span', { class: 'small' }, [
          `Attempt ${resumable.ordinal}, started `
          + `${new Date(resumable.startedAt).toLocaleString()}. `,
          resumable.deadlineAt
            ? `${clockText(Attempts.msLeft(resumable))} left.`
            : 'Untimed.',
        ]),
      ]));
    } else {
      const retake = mine.length > 0;
      actions.push(el('div', { class: 'oa-start' }, [
        el('button', {
          class: 'btn btn-primary btn-lg', type: 'button', id: 'oaStart',
          disabled: b.missing.length ? true : undefined,
        }, [retake ? `Start attempt ${mine.length + 1}` : 'Start']),
        el('span', { class: 'small' }, [retake
          ? `You have sat this ${mine.length} ${mine.length === 1 ? 'time' : 'times'}. `
            + 'This is a new attempt — the old one is kept and nothing is overwritten.'
          : 'A fresh attempt. The clock starts when you press it.']),
      ]));
    }
    parts.push(...actions);

    if (mine.length) {
      parts.push(el('h2', { class: 'oa-head', text: 'Your attempts' }));
      parts.push(el('div', { class: 'oa-history' }, mine.map(a => el('a', {
        class: 'oa-row', href: a.state === 'running'
          ? `#/assess/${def.id}/go` : `#/assess/review/${a.id}`,
        'data-state': a.state,
      }, [
        el('span', { class: 'oa-row-title', text: `Attempt ${a.ordinal}` }),
        el('span', { class: 'tiny faint', text: new Date(a.startedAt).toLocaleString() }),
        el('span', { class: 'oa-row-state tiny', text: a.state === 'running'
          ? 'In progress' : a.state === 'expired' ? 'Ran out of time' : 'Finished' }),
        el('span', { class: 'oa-row-score', text: a.score == null
          ? '—' : `${Math.round(a.score * 100)}%` }),
      ]))));
    }

    host.replaceChildren(...parts.filter(Boolean));

    /* The execution check, after the page is up so it does not hold it. */
    paintExec(def, execBox);

    const startBtn = $('#oaStart');
    if (startBtn) startBtn.addEventListener('click', () => begin(def));
  }

  const fact = (label, value, note) => el('div', { class: 'oa-fact' }, [
    el('span', { class: 'oa-fact-label', text: label }),
    el('span', { class: 'oa-fact-value', text: value }),
    el('span', { class: 'oa-fact-note tiny faint', text: note }),
  ]);

  function weightWords(b, scoring) {
    const ws = (scoring.weights) || {};
    const bits = b.problems.map(p => `${(p.meta || {}).title || p.id} ×${
      Number(ws[p.id] != null ? ws[p.id] : 1)}`);
    return `${bits.join(', ')}. Your score is the weighted fraction of ${b.weights}.`;
  }

  async function paintExec(def, box) {
    const r = await Assessments.readiness(def);
    if (!box.isConnected) return;

    if (!r.rows.length) {
      box.replaceChildren(el('p', { class: 'small', text:
        'Nothing here has to be compiled, so there is nothing to set up.' }));
      return;
    }

    const rows = r.rows.map(row => el('div', { class: 'oa-exec-row', 'data-ready': String(row.ready) }, [
      el('span', { class: 'oa-exec-name', text: row.title }),
      el('span', { class: 'tiny', text: row.langs.map(l => `${
        Catalog.LANG_LABEL[l.id] || l.id}: ${l.ready ? (l.where + (l.version ? ` · ${l.version}` : '')) : 'no runner'}`).join('  ·  ') }),
    ]));

    /* Filtered: a null in the list is rendered as the text "null" by the
       helper, which is how one appeared under the warm-up row. */
    box.replaceChildren(...[
      el('p', { class: 'small', text: r.ready
        ? 'Every coding exercise here can run on this device.'
        : 'Something here has no runner. You can still start — a problem that '
          + 'cannot be run is recorded as ungraded rather than wrong, and the '
          + 'attempt gets no pass verdict.' }),
      ...rows,
      r.engines.length
        ? el('div', { class: 'oa-warm' }, [
          el('button', { class: 'btn btn-sm', type: 'button', id: 'oaWarm' },
            ['Download the toolchains now']),
          el('span', { class: 'tiny faint', id: 'oaWarmNote', text:
            'Otherwise the first Run inside the attempt pays for it, on your time.' }),
        ])
        : null,
      !r.ready
        ? el('p', { class: 'tiny' }, [el('a', { href: '#/setup', text: 'How to run C++ and Rust →' })])
        : null,
    ].filter(Boolean));

    const warm = $('#oaWarm');
    if (warm) {
      warm.addEventListener('click', async () => {
        const note = $('#oaWarmNote');
        warm.disabled = true;
        warm.textContent = 'Downloading…';
        await Assessments.warmUp(def, p => {
          if (note) note.textContent = `${p.engine}: ${p.percent ?? 0}%`;
        });
        warm.textContent = 'Ready';
        if (note) note.textContent = 'Downloaded and cached. The clock has not started.';
      });
    }
  }

  /* Start.

     Two things happen before the clock exists, and the order is the
     whole point of the pre-flight page: anything that can take time
     takes it now, on nobody's clock, rather than at question nine with
     eleven minutes left.

       · fullscreen is requested, from inside this click, because that
         is the only place a browser will consider it;
       · every toolchain the assessment needs is downloaded and cached.

     The download is the one that matters. A 44MB Rust toolchain or an
     11MB clang fetched during the attempt is minutes of the reader's
     time spent on their connection rather than on the question, and
     the pre-flight page already offers the button — but an offer that
     can be skipped is an offer most people skip, and then it is too
     late to have been warned. */
  async function begin(def) {
    goFullscreen();

    const btn = $('#oaStart');
    const say = text => { if (btn) btn.textContent = text; };
    if (btn) btn.disabled = true;

    try {
      const r = await Assessments.readiness(def);
      if (r.engines.length) {
        say('Downloading the toolchain…');
        const note = $('#oaWarmNote');
        await Assessments.warmUp(def, pr => {
          const pct = pr.percent == null ? '' : ` ${pr.percent}%`;
          say(`Downloading ${pr.engine}…${pct}`);
          if (note) note.textContent = `${pr.engine}: ${pr.percent ?? 0}% — the clock has not started.`;
        });
      }
    } catch (err) {
      /* A toolchain that will not download is not a reason to refuse to
         start: the attempt records an un-runnable problem as ungraded
         rather than wrong, which is said on this page before the button
         is pressed. */
      UI.toast(`A toolchain could not be downloaded (${(err && err.message) || err}). `
        + 'You can still start — anything that cannot run is recorded as ungraded.',
        'bad', 10_000);
    }
    say('Starting…');

    const r = await Attempts.start(def, {
      langs: Object.fromEntries(def.problems.map(id => [id, Assessments.langsFor(def, id)])),
    });
    if (!r.ok) {
      UI.toast('An attempt is already in progress.', 'bad');
      if (btn) { btn.disabled = false; say('Start'); }
      return;
    }
    if (r.stored && !r.stored.ok) {
      UI.toast('This attempt could not be saved to disk — it will be lost if the '
        + 'tab closes. See Settings for why.', 'bad', 12_000);
    }
    location.hash = `#/assess/${def.id}/go`;
  }

  /* ---------------- the attempt ---------------- */

  let at = 0;   /* which problem in the attempt is on screen */
  let navTimer = null;

  async function renderAttempt(id, index = null) {
    const host = $('#assessRun');
    if (!host) return;
    await Assessments.load();
    const def = Assessments.byId(id);
    const attempt = await Attempts.running();

    if (!def || !attempt || attempt.assessmentId !== id) {
      stopTicking();
      live = null;
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'No attempt is running' }),
        el('p', { class: 'muted', text: 'Start one from the assessment’s page.' }),
        el('a', { class: 'btn', href: `#/assess/${id}` }, ['Back']),
      ]));
      return;
    }

    /* The deadline may have gone by while the tab was shut. Checked on
       arrival, before anything is drawn, because resuming into a live
       attempt that is actually over would let somebody keep working. */
    if (Attempts.isExpired(attempt)) {
      live = { attempt, def };
      await expire();
      return;
    }

    if (index != null) at = Math.max(0, Math.min(def.problems.length - 1, index));
    const problemId = def.problems[at];
    live = { attempt, def, problemId, lang: null };

    /* The assessment's own header, and the only one on screen: the site's
       navigation, the avatar, the purse and the XP are all taken away by
       CSS while `body[data-attempt]` is set. Six things, because those
       are the six a reader under a clock actually needs — what this is,
       how long is left, where they are in it, whether their work is
       saved, how to finish, and how to get out. */
    host.replaceChildren(
      el('div', { class: 'oa-bar' }, [
        el('span', { class: 'oa-bar-title', text: def.title }),
        el('span', { class: 'oa-clock', id: 'oaClock', 'data-state': 'ok', text: '—' }),
        el('span', { class: 'oa-progress tiny', id: 'oaProgress' }),
        el('div', { class: 'oa-nav', id: 'oaNav' }),
        el('span', { class: 'oa-save tiny faint', id: 'oaSave', 'data-state': 'idle',
          text: 'Saved as you work' }),
        el('div', { class: 'oa-bar-acts' }, [
          el('button', {
            class: 'btn btn-sm btn-ghost', type: 'button', id: 'oaExit',
            title: 'Leave the assessment without finishing it',
          }, ['Exit']),
          el('button', { class: 'btn btn-sm', type: 'button', id: 'oaFinish' },
            ['Finish assessment']),
        ]),
      ]),
      el('div', { class: 'oa-host', id: 'oaHost' }),
    );

    paintNav(def, attempt);
    startTicking();

    const finish = $('#oaFinish');
    if (finish) finish.addEventListener('click', () => askFinish(def, attempt));
    const exit = $('#oaExit');
    if (exit) exit.addEventListener('click', () => askExit(def, attempt));

    await ProblemView.open(problemId, $('#oaHost'), {
      assess: {
        attempt,
        def,
        drafts: attempt.drafts || {},
        onAnswer: async () => {
          const fresh = await Attempts.get(attempt.id);
          if (fresh) paintNav(def, fresh);
        },
        /* Every keystroke, debounced. The drafts map the hook writes is
           the same object the attempt holds, so the navigator is
           reading the live state rather than a copy that has to be
           kept in step. */
        onDraft: () => {
          clearTimeout(navTimer);
          navTimer = setTimeout(() => {
            if (live && live.attempt === attempt) paintNav(def, attempt);
          }, 250);
        },
      },
    });
  }

  /* The navigator: three states per problem, and they are three
     different things. "Attempted" means something is written and not
     sent; a reader who cannot tell that from "submitted" cannot tell
     what is left to do. */
  function paintNav(def, attempt) {
    const prog = $('#oaProgress');
    if (prog) {
      const done = def.problems.filter(p => Attempts.statusOf(attempt, p) === 'submitted').length;
      const written = def.problems.filter(p => Attempts.statusOf(attempt, p) === 'attempted').length;
      prog.textContent = `${at + 1} of ${def.problems.length} · ${done} submitted`
        + (written ? `, ${written} written` : '');
    }

    const nav = $('#oaNav');
    if (!nav) return;
    nav.replaceChildren(...def.problems.map((pid, i) => {
      const meta = Catalog.meta(pid) || {};
      const state = Attempts.statusOf(attempt, pid);
      return el('button', {
        class: 'oa-dot', type: 'button',
        'data-state': state,
        'aria-current': i === at ? 'true' : undefined,
        title: `${i + 1}. ${meta.title || pid} — ${
          { unanswered: 'nothing written', attempted: 'written, not submitted',
            submitted: 'submitted' }[state]}`,
        'aria-label': `Problem ${i + 1}, ${meta.title || pid}, ${
          { unanswered: 'nothing written', attempted: 'written, not submitted',
            submitted: 'submitted' }[state]}`,
        onclick: () => { location.hash = `#/assess/${def.id}/go/${i + 1}`; },
      }, [String(i + 1)]);
    }));
  }

  /* Leaving without finishing, which is a different thing from finishing
     and has to say so. The clock does not stop — it cannot, because it is
     a deadline rather than a counter, and a deadline that paused when
     you navigated away would be a deadline anybody could stop. So the
     confirmation says that, in those words, rather than letting somebody
     discover it by coming back to a finished attempt. */
  async function askExit(def, attempt) {
    const fresh = await Attempts.get(attempt.id) || attempt;
    const ms = Attempts.msLeft(fresh);

    const lines = ['Leave this assessment?', ''];
    lines.push('Your answers are saved. The attempt stays open and you can come '
      + 'back to it from the assessment\u2019s page.');
    lines.push('');
    if (ms != null) {
      lines.push(`The clock does NOT stop. It is a deadline, not a counter, so the `
        + `${clockText(ms)} left will keep running down while you are away — `
        + 'including while the tab is closed.');
      lines.push('');
      lines.push('If the deadline passes while you are gone, whatever is saved at '
        + 'that moment is what gets graded.');
    } else {
      lines.push('This assessment is untimed, so there is no deadline to run out.');
    }

    if (!confirm(lines.join('\n'))) return;

    stopTicking();
    dropFullscreen();
    live = null;
    location.hash = `#/assess/${def.id}`;
  }

  /* Finishing early is explicit and confirmed, and the confirmation says
     what is actually unfinished rather than asking in the abstract. */
  async function askFinish(def, attempt) {
    const fresh = await Attempts.get(attempt.id) || attempt;
    const left = def.problems.filter(p => Attempts.statusOf(fresh, p) !== 'submitted');
    const ms = Attempts.msLeft(fresh);

    const lines = ['Finish this assessment?', ''];
    if (left.length) {
      lines.push(`${left.length} of ${def.problems.length} ${
        left.length === 1 ? 'problem has' : 'problems have'} not been submitted:`);
      for (const p of left) lines.push(`  • ${(Catalog.meta(p) || {}).title || p}`);
      lines.push('');
      lines.push('They will be scored as unanswered.');
    } else {
      lines.push('Everything has been submitted.');
    }
    if (ms != null && ms > 0) lines.push('', `There are ${clockText(ms)} left on the clock.`);
    lines.push('', 'This cannot be undone. A retake is a separate attempt.');

    if (!confirm(lines.join('\n'))) return;

    if (finishing) return;
    finishing = true;
    stopTicking();
    await flushDraft();
    const done = await Attempts.finish(attempt.id, def, { reason: 'finished' });
    finishing = false;
    live = null;
    location.hash = `#/assess/review/${done.id}`;
  }

  /* ---------------- afterwards ---------------- */

  async function renderReview(attemptId) {
    const host = $('#assessReview');
    if (!host) return;
    await Assessments.load();
    const a = await Attempts.get(attemptId);

    if (!a) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'No such attempt' }),
        el('a', { class: 'btn', href: '#/assess' }, ['All assessments']),
      ]));
      return;
    }

    const def = Assessments.byId(a.assessmentId);
    const r = a.results || { rows: [] };
    const pct = a.score == null ? null : Math.round(a.score * 100);

    /* The whole problem files, not the index entries. The review needs
       two things the index does not carry: a proof's rubric, and the
       option text, so that "you answered 2" can be printed as the
       sentence the reader actually chose. */
    const full = {};
    for (const [id, got] of await Promise.all(r.rows.map(async row =>
      [row.id, await Catalog.get(row.id).catch(() => null)]))) {
      full[id] = got;
    }

    const parts = [
      el('div', { class: 'crumbs' }, [
        el('a', { href: '#/assess', text: '← Assessments' }),
      ]),
      el('h1', { text: a.title }),
      el('p', { class: 'tiny faint', text: [
        /* A first sitting and a retake are different evidence, and the
           difference is worth a word rather than an ordinal the reader
           has to interpret. */
        a.ordinal > 1 ? `Retake — attempt ${a.ordinal}` : 'First attempt',
        `version ${a.version}`,
        `started ${new Date(a.startedAt).toLocaleString()}`,
        a.timed ? `${a.durationMin} minutes allowed` : 'untimed',
      ].join(' · ') }),
    ];

    parts.push(el('div', { class: 'oa-score', 'data-passed': String(r.passed) }, [
      el('div', { class: 'oa-score-big', text: pct == null ? '—' : `${pct}%` }),
      el('div', { class: 'oa-score-side' }, [
        el('p', { class: 'oa-verdict', text: r.passed === true ? 'Passed'
          : r.passed === false ? 'Below the pass mark'
          : r.ungraded ? 'No verdict — something never ran'
          : 'Scored' }),
        el('p', { class: 'tiny faint', text: `${r.earned} of ${r.possible} weighted`
          + `${r.passMark != null ? `, pass mark ${Math.round(r.passMark * 100)}%` : ''}` }),
        el('p', { class: 'tiny faint', text: `${a.endedBecause === 'expired'
          ? 'Ran out of time' : 'Finished'} after ${
          ProblemView.duration(r.elapsedMs || 0)}${a.durationMin
          ? ` of ${a.durationMin} minutes` : ''}` }),
      ]),
    ]));

    if (r.ungraded) {
      parts.push(el('div', { class: 'oa-note' }, [
        el('p', {}, ['Something in this attempt could not be run at all, so it is '
          + 'ungraded rather than wrong, and there is no pass verdict. That is a '
          + 'failure of the execution service, not of your answer — the rows '
          + 'below say which. ',
          el('a', { href: '#/setup', text: 'How to run C++ and Rust →' })]),
      ]));
    }

    parts.push(el('h2', { class: 'oa-head', text: 'Per problem' }));
    parts.push(el('div', { class: 'oa-results' }, r.rows.map(row => {
      const meta = Catalog.meta(row.id) || {};
      const ans = (a.answers || {})[row.id] || {};
      return el('div', { class: 'oa-result', 'data-outcome': row.outcome }, [
        el('div', { class: 'oa-result-top' }, [
          el('h3', { text: meta.title || row.id }),
          el('span', { class: 'oa-outcome', text: {
            right: 'Right', partial: 'Partly right', wrong: 'Wrong',
            unanswered: 'Not answered', errored: 'Could not be run',
            review: 'Not marked — yours to review',
          }[row.outcome] || row.outcome }),
        ]),
        el('div', { class: 'tiny faint' }, [
          `weight ×${row.weight}`,
          row.fraction != null ? ` · scored ${Math.round(row.fraction * 100)}%` : '',
          ans.passedCases != null ? ` · ${ans.passedCases}/${ans.totalCases} cases` : '',
          ans.lang ? ` · ${Catalog.LANG_LABEL[ans.lang] || ans.lang}` : '',
          ans.submits ? ` · ${ans.submits} submission${ans.submits === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join('')),
        row.outcome === 'errored'
          ? el('div', {}, [
            el('p', { class: 'small', style: 'color:var(--warn)', text: row.why }),
            /* A grading failure is recoverable, and the thing that makes
               it recoverable is that the answer was frozen: retrying
               runs the same submitted program again, and cannot be used
               to edit an answer after the deadline. */
            el('button', {
              class: 'btn btn-sm', type: 'button', 'data-regrade': row.id,
            }, ['Try grading it again']),
            el('span', { class: 'tiny faint', style: 'margin-left:.5rem',
              text: 'Runs the answer you submitted, exactly as you submitted it. '
                + 'It cannot be edited now.' }),
          ])
          : null,
        /* The program, whole. It was kept whole on purpose. */
        ans.source
          ? el('details', { class: 'oa-source' }, [
            el('summary', { class: 'small', text: 'What you submitted' }),
            el('pre', {}, [el('code', { text: ans.source })]),
          ])
          : null,
        /* And the answer, for everything that is not a program. It was
           stored; not showing it made the review of a nine-question
           paper a list of verdicts with no way to see what had been
           said. */
        (!ans.source && ans.response != null)
          ? el('details', { class: 'oa-source', open: row.outcome !== 'right' || undefined }, [
            el('summary', { class: 'small', text: 'What you answered' }),
            el('pre', {}, [el('code', { text: answerText(full[row.id], ans.response) })]),
          ])
          : null,
        /* A written proof: the rubric, and a mark that is explicitly the
           reader's own. Nothing here has read the proof. */
        row.outcome === 'review' ? proofBox(full[row.id], row, ans) : null,
        /* Where to go and read about it. The concepts the problem names
           are the honest answer to "what did I miss". */
        (meta.prereqs || []).length
          ? el('p', { class: 'tiny' }, [
            'Rests on ',
            ...(meta.prereqs || []).flatMap((c, i) => [
              i ? ', ' : '',
              el('a', { href: `#/concepts?q=${encodeURIComponent(c)}`,
                text: (Catalog.concept(c) || {}).name || c }),
            ]),
            '.',
          ])
          : null,
        /* Now it is over, the problem is readable like any other — and
           reading it there is scored as nothing, which is what makes
           linking to it safe. */
        el('div', { class: 'oa-result-acts' }, [
          el('a', { class: 'tiny', href: `#/p/${row.id}`,
            text: 'Open the problem and its solution →' }),
          el('button', {
            class: 'btn btn-sm btn-ghost', type: 'button', 'data-flag': row.id,
            'aria-pressed': String(!!Store.record(row.id).flagged),
          }, [Store.record(row.id).flagged ? '★ On your review list' : '☆ Add to review']),
        ]),
      ]);
    })));

    if (def) {
      parts.push(el('div', { class: 'oa-again' }, [
        el('a', { class: 'btn', href: `#/assess/${def.id}` }, ['Take it again']),
        el('span', { class: 'tiny faint', text: 'A retake is a separate attempt. '
          + 'Nothing here is counted towards XP, a streak or a problem’s solved '
          + 'status, so sitting it twice earns nothing twice.' }),
      ]));
    }

    host.replaceChildren(...parts.filter(Boolean));

    /* Adding a question to the review list. Deliberately only the flag:
       it puts the question on the review list with the reason "you
       bookmarked it", and changes nothing about a solved status, an XP
       total or a catalogue count — an assessment question has none of
       those and must not acquire any. */
    for (const btn of host.querySelectorAll('[data-flag]')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.flag;
        const meta = Catalog.meta(id);
        if (!meta) return;
        const on = !Store.record(id).flagged;
        Store.setFlag(meta, on);
        btn.setAttribute('aria-pressed', String(on));
        btn.textContent = on ? '★ On your review list' : '☆ Add to review';
        UI.toast(on
          ? 'Added to your review list. Nothing about your progress changed.'
          : 'Taken off your review list.', 'info');
      });
    }

    for (const btn of host.querySelectorAll('[data-regrade]')) {
      btn.addEventListener('click', () => regrade(a, btn.dataset.regrade, btn));
    }

    for (const btn of host.querySelectorAll('[data-selfmark]')) {
      btn.addEventListener('click', async () => {
        const [id, verdict] = btn.dataset.selfmark.split('|');
        await Attempts.selfMark(a.id, id, verdict || null);
        renderReview(a.id);
      });
    }
  }

  /* An answer that is not a program, written out so it can be read. The
     shapes are the ones the graders take, and each is printed as the
     thing it means rather than as JSON. */
  function answerText(problem, response) {
    const pay = (problem && problem.payload) || {};
    const opts = pay.options || [];
    const items = pay.items || [];
    const left = pay.left || [];
    const right = pay.right || [];
    /* One line of an option, short enough to read in a list. */
    const line = (xs, i) => (xs[i] == null ? `#${i}` : String(xs[i]).replace(/\s+/g, ' ').slice(0, 110));

    if (typeof response === 'string') return response;

    /* mcq — one index into the options. */
    if (typeof response === 'number' && opts.length) return `${response + 1}. ${line(opts, response)}`;
    if (typeof response === 'number') return String(response);

    if (Array.isArray(response)) {
      /* multi — indexes into the options. */
      if (opts.length) return response.map(i => `${Number(i) + 1}. ${line(opts, Number(i))}`).join('\n');
      /* order — the items, in the order given. */
      if (items.length) return response.map((i, at) => `${at + 1}. ${line(items, Number(i))}`).join('\n');
      /* match — the right index chosen for each left item. */
      if (left.length) {
        return response.map((j, i) => `${line(left, i)}  →  ${
          j == null ? '(unpaired)' : line(right, Number(j))}`).join('\n');
      }
      return response.join(', ');
    }

    /* A half-finished pairing, which is the sparse map partial() makes. */
    if (response && typeof response === 'object') {
      return Object.entries(response)
        .map(([k, v]) => `${line(left, Number(k))}  →  ${line(right, Number(v))}`).join('\n');
    }
    return String(response);
  }

  /* ---------------- a written proof, after the clock ----------------

     Nothing here has marked it and nothing here will. What this gives
     is the three things that make a self-review a real review: the
     rubric to read it against, the proof as it was written, and a mark
     that is recorded as the reader's own opinion and is never added to
     the automatic score. */
  function proofBox(problem, row, ans) {
    const rubric = (((problem || {}).payload) || {}).rubric || [];
    const mark = ans.selfMark ? ans.selfMark.verdict : null;

    const choice = (value, label) => el('button', {
      class: 'btn btn-sm', type: 'button',
      'data-selfmark': `${row.id}|${value}`,
      'aria-pressed': String(mark === value),
    }, [label]);

    return el('div', { class: 'oa-proof' }, [
      el('p', { class: 'small', text: 'Nothing in this site marks a written proof. '
        + 'Read yours against the rubric, one line at a time, and then record what '
        + 'you think. What you record is kept as your judgement and is not added to '
        + 'the score above.' }),
      rubric.length
        ? el('details', { open: true }, [
          el('summary', { class: 'small', text: 'The rubric' }),
          el('ul', { class: 'oa-rubric' }, rubric.map(line => el('li', { html: MD.renderInline(line) }))),
        ])
        : null,
      el('div', { class: 'row', style: 'gap:.4rem;flex-wrap:wrap' }, [
        el('span', { class: 'tiny faint', text: 'Your own mark:' }),
        choice('sound', 'Sound'),
        choice('gap', 'A gap in it'),
        choice('wrong', 'Not a proof'),
        mark ? el('button', { class: 'btn btn-sm btn-ghost', type: 'button',
          'data-selfmark': `${row.id}|` }, ['Clear']) : null,
      ]),
      el('p', { class: 'tiny faint', id: `selfmark-${row.id}`,
        text: mark ? `Recorded as "${mark}". The automatic score above does not include it.` : '' }),
    ]);
  }

  /* Re-running a submission that could not be graded. The answer is
     frozen: this re-grades what was submitted and cannot change it. */
  async function regrade(attempt, problemId, btn) {
    btn.disabled = true;
    btn.textContent = 'Grading…';
    const ok = await Assessments.regrade(attempt.id, problemId);
    if (ok && ok.graded) {
      UI.toast('Graded. The score has been recomputed.', 'good');
      renderReview(attempt.id);
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Try grading it again';
    UI.toast(`Still could not be run: ${(ok && ok.why) || 'no runner'}. Your answer is `
      + 'untouched and the problem stays ungraded.', 'bad', 9000);
  }

  /* Leaving the mode entirely: the ticker must not outlive the page it
     was drawn on, and the next problem opened must not inherit the
     attempt's drafts. */
  function leave() {
    stopTicking();
    /* The browser goes back the way it was found. Only if we were the
       ones who put it in fullscreen — a reader who was already there
       for their own reasons keeps it. */
    dropFullscreen();
    live = null;
    clearTimeout(navTimer);
    /* And empty it. The view is hidden either way, but a hidden
       attempt page still holds a clock element, a navigator and a
       Finish button, and leaving those in the document is how a dead
       mode comes back: something finds them by id and believes an
       attempt is running. */
    const host = $('#assessRun');
    if (host) host.replaceChildren();
  }

  return {
    renderList, renderBrief, renderAttempt, renderReview, leave,
    clockText,
  };
})();
