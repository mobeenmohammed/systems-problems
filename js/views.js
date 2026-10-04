/* ============================================================
   views.js — every view except a single problem: the dashboard,
   the catalog, the reading map, the profile, the shop and
   settings. Plus the few bits of chrome they share.
   ============================================================ */

const UI = (() => {

  const { el } = ProblemTypes;
  const $ = sel => document.querySelector(sel);

  /* ---------------- chrome ---------------- */

  function toast(message, kind = 'info', ms = 3200) {
    const node = el('div', { class: 'toast', 'data-kind': kind, html: MD.renderInline(message) });
    $('#toasts').append(node);
    setTimeout(() => {
      node.style.transition = 'opacity .25s, transform .25s';
      node.style.opacity = '0';
      node.style.transform = 'translateX(12px)';
      setTimeout(() => node.remove(), 260);
    }, ms);
  }

  function refreshPurse() {
    const s = Store.state;
    $('#purseXp').textContent = s.xp.toLocaleString();
    $('#purseCoins').textContent = s.coins.toLocaleString();
    const streak = $('#purseStreak');
    if (s.streak.current > 1) {
      streak.hidden = false;
      streak.textContent = `${s.streak.current}-day streak`;
    } else {
      streak.hidden = true;
    }
  }

  /* The theme, accent and frame live on <html> so CSS can key off them. The
     inline script in index.html does this before first paint; this is for
     when they change while the page is open. */
  function applyCosmetics() {
    const e = Store.state.equipped;
    const root = document.documentElement;
    root.setAttribute('data-theme', e.theme || 'theme-dark');
    root.setAttribute('data-accent', e.accent || 'accent-default');
    root.setAttribute('data-frame', e.frame || 'frame-none');
  }

  /* A progress ring. Reads better than a bar for a bare percentage, and it
     fits beside a title where a full-width bar does not. */
  function ring(fraction, label) {
    const r = 18;
    const circumference = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
    const offset = circumference * (1 - clamped);
    const wrap = el('div', { class: 'ring', title: `${Math.round(clamped * 100)}%` });
    wrap.innerHTML =
      '<svg viewBox="0 0 44 44" aria-hidden="true">' +
      `<circle class="ring-track" cx="22" cy="22" r="${r}"></circle>` +
      `<circle class="ring-fill" cx="22" cy="22" r="${r}" ` +
      `stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>` +
      '</svg>' +
      `<span class="ring-label">${MD.escapeHtml(String(label))}</span>`;
    return wrap;
  }

  /* Difficulty as a coloured dot plus the word, so it never depends on hue. */
  const diffTag = id => {
    const d = Store.DIFF_BY_ID[id] || { label: id };
    return el('span', { class: `diff diff-${id}`, text: d.label });
  };

  const statPill = (n, k) => el('div', { class: 'stat' }, [
    el('div', { class: 'n', text: String(n) }),
    el('div', { class: 'k', text: k }),
  ]);

  /* ---------------- the problem list ----------------

     One renderer for the catalog, a track and the revisit strip. Aligned
     columns scan far better than a stack of cards once there are more than a
     dozen rows, which is why this is a table in all but name. */

  const TICK = { solved: '✓', attempted: '◔', read: '◎', unsolved: '' };
  const STATUS_LABEL = {
    unsolved: 'Not started',
    attempted: 'Attempted',
    solved: 'Solved',
    read: 'Read the answer',
  };

  /* Which weekly problem is current, so the row can be badged. Looked up once
     per list rather than once per row. */
  function weeklyId() {
    const w = Catalog.thisWeek();
    return w ? w.problem : null;
  }

  /* The row is a div with a stretched link rather than an anchor, because the
     bookmark is a button and a button inside an anchor is not valid markup —
     and nesting them makes the toggle unreachable by keyboard. The link still
     covers the row for a mouse, and both controls are separately focusable. */
  function problemRow(p, { index = null, weekly = null, onChange = null } = {}) {
    const r = Store.record(p.id);
    const type = Catalog.TYPE_BY_ID[p.type] || {};
    const due = r.reviewOn && r.reviewOn <= Store.todayISO();
    const mark = TICK[r.status] || '';
    const isWeekly = weekly === p.id;
    const optional = (p.lane || 'core') !== 'core';

    const bookmark = el('button', {
      type: 'button',
      class: `bookmark${r.flagged ? ' on' : ''}`,
      'aria-pressed': String(!!r.flagged),
      'aria-label': r.flagged ? `Remove the bookmark on ${p.title}` : `Bookmark ${p.title}`,
      title: r.flagged ? 'Bookmarked — click to remove' : 'Bookmark this for later',
      onclick: e => {
        e.preventDefault();
        e.stopPropagation();
        /* The meta, not the id: the record is created on first touch and
           needs the topic and difficulty to score against later. */
        Store.toggleFlag(p);
        if (onChange) onChange();
      },
    }, [r.flagged ? '★' : '☆']);

    return el('div', {
      class: 'prow', 'data-status': r.status, 'data-lane': p.lane || 'core',
    }, [
      el('span', {
        class: `tick status-${r.status}`,
        'aria-hidden': 'true',
        text: mark || (index != null ? String(index) : ''),
      }),
      el('span', { class: 'prow-main' }, [
        el('div', { class: 'title' }, [
          el('a', { class: 'prow-link', href: `#/p/${p.id}`, text: p.title }),
          isWeekly ? el('span', { class: 'badge badge-weekly', text: 'Weekly' }) : null,
          optional ? el('span', { class: 'badge badge-optional', text: 'Optional' }) : null,
          due ? el('span', { class: 'badge badge-due', title: `Due for revisit on ${r.reviewOn}`, text: 'Revisit' }) : null,
        ]),
        el('div', { class: 'meta' }, [
          el('span', { text: (Store.TOPIC_BY_ID[p.topic] || {}).label || p.topic }),
          el('span', { class: 'tag', text: type.label || p.type }),
          ...(p.tags || []).slice(0, 2).map(t => el('span', { text: `#${t}` })),
        ]),
      ]),
      el('span', { class: `status-word status-${r.status}`, text: STATUS_LABEL[r.status] || r.status }),
      diffTag(p.difficulty),
      el('span', {
        class: 'est',
        title: p.estimate ? `About ${p.estimate} minutes` : '',
        text: p.estimate ? `~${p.estimate} min` : '—',
      }),
      el('span', {
        class: 'worth',
        text: r.status === 'solved' ? `${r.xpEarned} XP` : `${Store.potentialXp(p)} XP`,
      }),
      bookmark,
    ]);
  }

  function problemList(metas, { numbered = false, onChange = null } = {}) {
    const list = el('div', { class: 'plist' });
    const weekly = weeklyId();
    list.append(el('div', { class: 'plist-head' }, [
      el('span', { text: numbered ? '#' : '' }),
      el('span', { text: 'Problem' }),
      el('span', { text: 'Status' }),
      el('span', { text: 'Difficulty' }),
      el('span', { text: 'Time' }),
      el('span', { style: 'text-align:right', text: 'XP' }),
      el('span', { class: 'sr-only', text: 'Bookmark' }),
    ]));
    metas.filter(Boolean).forEach((p, i) => {
      list.append(problemRow(p, { index: numbered ? i + 1 : null, weekly, onChange }));
    });
    return list;
  }

  /* ---------------- dashboard ---------------- */

  function renderHome() {
    const st = Store.stats(Catalog.all());
    const n = Catalog.counts();

    $('#homeBlurb').textContent = n.problems
      ? `${n.problems} problems across ${n.topics} topics and ${n.difficulties} difficulties, `
        + `with ${n.readings} readings attached to them — so a thing you cannot do yet `
        + `comes with the chapter that fixes that.`
      : 'No problems are loaded yet.';

    $('#homeRank').textContent = st.rank.current.label;
    $('#homeRankNext').textContent = st.rank.next
      ? `${st.rank.into} / ${st.rank.span} to ${st.rank.next.label}`
      : 'top rank';
    $('#homeRankBar').style.width = `${Math.round(st.rank.fraction * 100)}%`;
    $('#homeStreakLine').textContent = st.streak.current
      ? `${st.streak.current}-day streak · longest ${st.streak.longest}`
      : 'No streak yet — solve something today to start one.';

    $('#homeStats').replaceChildren(
      statPill(`${st.solved}/${st.total}`, 'solved'),
      statPill(st.attempted, 'in progress'),
      statPill(st.xp.toLocaleString(), 'xp'),
      statPill(st.coins.toLocaleString(), 'coins'),
      statPill(st.readings, 'readings read'),
    );

    renderActions();
    renderTracksStrip();

    /* Anything flagged or due — the dashboard is the only place this would
       ever be noticed, so it goes above the topics. */
    const due = Store.dueForReview();
    const review = $('#homeReview');
    if (due.length) {
      const metas = due.slice(0, 6).map(r => Catalog.meta(r.id)).filter(Boolean);
      review.replaceChildren(
        el('div', { class: 'section-head' }, [el('h2', { text: 'Worth revisiting' })]),
        problemList(metas),
      );
    } else {
      review.replaceChildren();
    }

    const grid = $('#homeTopics');
    grid.replaceChildren(...Store.TOPICS.map(t => {
      const b = st.perTopic[t.id] || { total: 0, solved: 0 };
      const fraction = b.total ? b.solved / b.total : 0;
      return el('a', { class: 'topic-card', href: `#/problems?topic=${t.id}` }, [
        el('div', {}, [
          el('h3', { text: t.label }),
          el('p', { text: t.blurb }),
          el('div', { class: 'count', text: `${b.solved} of ${b.total} solved` }),
        ]),
        ring(fraction, `${b.solved}/${b.total}`),
      ]);
    }));

    renderHeat($('#homeHeat'), st.days);
  }

  /* ---------------- the dashboard's two main actions ----------------

     Of eighty-five problems the hard part is choosing one, so the page answers
     that twice and in the same shape: carry on where you were, or do the one
     chosen for this week. Everything below them is reference. */

  /* The meta line shared by both cards, and by the problem page header. */
  function metaRow(meta, extra = []) {
    const type = Catalog.TYPE_BY_ID[meta.type] || {};
    return el('div', { class: 'meta' }, [
      diffTag(meta.difficulty),
      el('span', { class: 'tag', text: (Store.TOPIC_BY_ID[meta.topic] || {}).label || meta.topic }),
      el('span', { class: 'tag', text: type.label || meta.type }),
      meta.estimate ? el('span', { class: 'tag', text: `~${meta.estimate} min` }) : null,
      (meta.lane && meta.lane !== 'core')
        ? el('span', { class: 'tag tag-lane', text: 'Optional' }) : null,
      ...extra,
    ]);
  }

  function actionCard({ eyebrow, title, href, body, meta, button, foot, tone = '' }) {
    return el('div', { class: `action${tone ? ' action-' + tone : ''}` }, [
      el('div', { class: 'action-body' }, [
        el('div', { class: 'eyebrow', text: eyebrow }),
        el('h2', {}, [href ? el('a', { href, text: title }) : title]),
        body || null,
        meta || null,
      ]),
      el('div', { class: 'action-side' }, [
        button || null,
        foot ? el('span', { class: 'tiny faint', text: foot }) : null,
      ]),
    ]);
  }

  const RESUME_WORDS = {
    resume:          ['Pick up where you left off', 'Resume'],
    'next-in-track': ['Next in this track', 'Continue'],
    'new-track':     ['Start a new track', 'Start'],
    loose:           ['Not in a track, but unsolved', 'Open'],
  };

  function continueCard() {
    const up = Catalog.nextUp();

    if (!up) {
      const total = Catalog.counts().problems;
      return actionCard({
        eyebrow: 'Continue learning',
        title: total ? 'Everything is solved' : 'Nothing loaded',
        body: el('p', {
          text: total
            ? 'Every problem in the catalogue is done. Flag a few for revisit, or wait for next week.'
            : 'Run npm run build:index, then serve the folder over HTTP.',
        }),
        button: total ? el('a', { class: 'btn', href: '#/problems' }, ['Browse anyway']) : null,
      });
    }

    const [eyebrow, verb] = RESUME_WORDS[up.reason] || RESUME_WORDS.loose;
    const r = Store.record(up.meta.id);

    return actionCard({
      tone: 'primary',
      eyebrow: `Continue learning · ${eyebrow}`,
      title: up.meta.title,
      href: `#/p/${up.meta.id}`,
      body: up.track
        ? el('p', {}, [
            el('a', { class: 'quiet', href: `#/tracks/${up.track.id}`, text: up.track.title }),
            ` · ${up.progress.done} of ${up.progress.total} solved`,
          ])
        : null,
      meta: metaRow(up.meta),
      button: el('a', { class: 'btn btn-primary', href: `#/p/${up.meta.id}` }, [verb]),
      foot: r.attempts
        ? `${r.attempts} attempt${r.attempts === 1 ? '' : 's'} so far`
        : `${Store.potentialXp(up.meta)} XP`,
    });
  }

  function weeklyCard() {
    const week = Catalog.thisWeek();
    if (!week) return null;

    const r = Store.record(week.problem);
    const done = r.status === 'solved';

    return actionCard({
      eyebrow: done ? 'This week · solved' : 'This week',
      title: week.meta.title,
      href: `#/p/${week.problem}`,
      body: (week.why || week.note)
        ? el('p', { html: MD.renderInline(week.why || week.note) })
        : null,
      meta: metaRow(week.meta),
      button: el('a', {
        class: done ? 'btn' : 'btn btn-primary',
        href: `#/p/${week.problem}`,
      }, [done ? 'Look again' : 'Start it']),
      foot: done ? `Solved ${r.solvedAt}` : `${Store.potentialXp(week.meta)} XP`,
    });
  }

  function renderActions() {
    $('#homeActions').replaceChildren(...[continueCard(), weeklyCard()].filter(Boolean));
  }

  /* ---------------- track cards ----------------

     One renderer for the dashboard strip and the tracks view, so the two
     cannot drift apart. Every card is the same height with its progress bar,
     count and button on the same lines, which is what makes a row of them
     scannable: the eye compares positions, not whatever each description
     happened to push downwards.

     Blurbs are clamped to two lines in CSS rather than cut here, so the full
     text is still there for a screen reader and the track page shows all of
     it. */

  /* A sentence's worth, for a card that has room for two lines. */
  function firstSentence(text, limit = 112) {
    const s = String(text || '').trim();
    if (s.length <= limit) return s;
    const stop = s.slice(0, limit).lastIndexOf('. ');
    if (stop > 40) return s.slice(0, stop + 1);
    const space = s.slice(0, limit).lastIndexOf(' ');
    return s.slice(0, space > 40 ? space : limit).trimEnd() + '…';
  }

  const stateChip = state => el('span', {
    class: `state state-${state}`,
    text: Catalog.TRACK_STATE_LABEL[state] || state,
  });

  function trackCard(t, p) {
    const pct = Math.round(p.fraction * 100);
    return el('a', { class: 'track-card', href: `#/tracks/${t.id}`, 'data-state': p.state }, [
      el('div', { class: 'track-top' }, [
        el('h3', { text: t.title }),
        stateChip(p.state),
      ]),
      el('p', { class: 'track-blurb', text: firstSentence(t.blurb) }),
      el('div', { class: 'track-foot' }, [
        el('div', { class: 'bar', title: `${pct}%` }, [el('i', { style: `width:${pct}%` })]),
        el('div', { class: 'spread tiny' }, [
          el('span', { text: `${p.done} of ${p.total} solved` }),
          el('span', { class: 'faint', text: `${p.total - p.done} left` }),
        ]),
      ]),
    ]);
  }

  /* A short strip of tracks on the dashboard; the full list is its own view. */
  function renderTracksStrip() {
    const host = $('#homeTracks');
    const tracks = Catalog.allTracks();
    if (!tracks.length) { host.replaceChildren(); return; }

    /* Started but unfinished first, then untouched, then complete — which is
       the order they are worth looking at. */
    const RANK = { attempted: 0, 'not-started': 1, completed: 2, empty: 3 };
    const ranked = tracks
      .map(t => ({ t, p: Catalog.trackProgress(t) }))
      .sort((a, b) => (RANK[a.p.state] ?? 9) - (RANK[b.p.state] ?? 9)
                   || b.p.fraction - a.p.fraction)
      .slice(0, 3);

    host.replaceChildren(
      el('div', { class: 'section-head' }, [
        el('h2', { text: 'Tracks' }),
        el('a', { class: 'more', href: '#/tracks', text: 'All tracks →' }),
      ]),
      el('div', { class: 'tracks' }, ranked.map(({ t, p }) => trackCard(t, p))),
      el('div', { style: 'height:var(--s2)' }),
    );
  }

  /* ---------------- tracks ---------------- */

  function renderTracks(trackId) {
    const host = $('#trackList');
    const tracks = Catalog.allTracks();

    const blurb = $('#tracksBlurb');
    if (blurb) {
      const n = Catalog.counts();
      blurb.textContent = n.problems
        ? `${n.tracks} ordered sets of problems that build on each other, so there is `
          + `always an obvious next one rather than ${n.problems} to choose between.`
        : 'Ordered sets of problems that build on each other.';
    }

    if (!tracks.length) {
      host.replaceChildren(el('div', { class: 'empty' }, ['No tracks are defined yet.']));
      return;
    }

    /* One track, opened */
    if (trackId) {
      const t = Catalog.track(trackId);
      if (!t) {
        host.replaceChildren(el('div', { class: 'empty' }, [
          el('h2', { text: 'No such track' }),
          el('a', { class: 'btn', href: '#/tracks' }, ['All tracks']),
        ]));
        return;
      }
      const p = Catalog.trackProgress(t);
      host.replaceChildren(
        el('div', { class: 'phead' }, [
          el('div', { class: 'crumbs' }, [
            el('a', { href: '#/tracks', text: '← All tracks' }),
          ]),
          el('h1', { text: t.title }),
          el('p', { class: 'muted', style: 'max-width:62ch', text: t.blurb }),
          t.goal ? el('p', { class: 'small faint', style: 'max-width:62ch', text: t.goal }) : null,
        ]),
        el('div', { class: 'card track-summary', 'data-state': p.state }, [
          el('div', { class: 'spread' }, [
            el('div', { class: 'row' }, [
              stateChip(p.state),
              el('span', { class: 'small', text: `${p.done} of ${p.total} solved` }),
            ]),
            p.resume
              ? el('a', { class: 'btn btn-sm btn-primary', href: `#/p/${p.resume.id}` },
                  [p.state === 'not-started' ? 'Start the first one' : 'Continue'])
              : el('span', { class: 'pill', style: 'color:var(--ok)', text: 'Complete' }),
          ]),
          el('div', { class: 'bar' }, [el('i', { style: `width:${Math.round(p.fraction * 100)}%` })]),
        ]),
        problemList(p.rows.map(r => r.meta), { numbered: true }),
      );
      return;
    }

    /* All tracks */
    host.replaceChildren(el('div', { class: 'tracks' },
      tracks.map(t => trackCard(t, Catalog.trackProgress(t)))));
  }

  /* A calendar of the last WEEKS weeks, in columns of seven. The grid starts
     on the Sunday of the oldest week so the rows keep meaning weekdays, and
     the month labels are placed by column so they line up with the squares
     rather than being spaced evenly and drifting. */
  const HEAT_WEEKS = 26;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function renderHeat(mount, days) {
    const todayISO = Store.todayISO();
    const end = new Date(todayISO + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (HEAT_WEEKS * 7 - 1));

    const cells = [];
    const labels = [];
    let solved = 0;
    let activeDays = 0;
    let lastMonth = -1;

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const n = days[iso] || 0;
      const future = iso > todayISO;
      if (!future) {
        solved += n;
        if (n) activeDays += 1;
      }

      /* One label per month, at the column holding that month's first Sunday,
         which is where a reader expects the name to sit. */
      if (d.getUTCDay() === 0) {
        const month = d.getUTCMonth();
        const column = Math.floor((d - start) / (7 * 86400000)) + 1;
        if (month !== lastMonth) {
          lastMonth = month;
          labels.push(el('span', { style: `grid-column:${column}`, text: MONTHS[month] }));
        }
      }

      cells.push(el('i', {
        'data-n': future ? undefined : String(Math.min(4, n)),
        'data-future': future ? 'true' : undefined,
        title: future ? '' : `${iso} — ${n === 1 ? '1 problem' : `${n} problems`}`,
      }));
    }

    mount.replaceChildren(...cells);

    const months = $('#homeHeatMonths');
    if (months) {
      months.style.gridTemplateColumns = `repeat(${HEAT_WEEKS}, var(--heat-cell))`;
      months.replaceChildren(...labels);
    }

    const caption = $('#homeHeatCaption');
    if (caption) {
      caption.textContent = solved
        ? `${solved} solved over ${HEAT_WEEKS} weeks, on ${activeDays} `
          + `${activeDays === 1 ? 'day' : 'different days'}.`
        : `Nothing solved in the last ${HEAT_WEEKS} weeks. A square is a day you solved something.`;
    }
  }

  /* ---------------- catalog ---------------- */

  let filter = { q: '', topic: '', difficulty: '', type: '', status: '', lane: '' };

  function fillFilterOptions() {
    const topic = $('#fTopic');
    if (topic.options.length === 1) {
      for (const t of Store.TOPICS) topic.append(el('option', { value: t.id, text: t.label }));
      for (const d of Store.DIFFICULTIES) $('#fDiff').append(el('option', { value: d.id, text: d.label }));
      for (const t of Catalog.TYPES) $('#fType').append(el('option', { value: t.id, text: t.label }));
      for (const l of Store.LANES) $('#fLane').append(el('option', { value: l.id, text: l.label }));
    }
  }

  function setFilter(patch, { silent = false } = {}) {
    filter = { ...filter, ...patch };
    $('#fSearch').value = filter.q;
    $('#fTopic').value  = filter.topic;
    $('#fDiff').value   = filter.difficulty;
    $('#fType').value   = filter.type;
    $('#fStatus').value = filter.status;
    $('#fLane').value   = filter.lane;
    if (!silent) renderCatalog();
  }

  function renderCatalog() {
    fillFilterOptions();
    const rows = Catalog.sorted(Catalog.list(filter));
    const total = Catalog.all().length;

    $('#catalogCount').textContent = rows.length === total
      ? `${total} problems`
      : `${rows.length} of ${total} problems`;

    const list = $('#catalogList');

    if (!total) {
      list.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'No problems loaded' }),
        el('p', { class: 'muted' }, [
          Catalog.loadError
            ? `data/index.json could not be read (${Catalog.loadError}). Run npm run build:index, and serve the folder over HTTP rather than opening the file directly.`
            : 'The index is empty. Run npm run build:index.',
        ]),
      ]));
      return;
    }

    if (!rows.length) {
      list.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'Nothing matches that' }),
        el('p', { class: 'muted', text: 'Try clearing a filter, or widen the search.' }),
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: () => setFilter({ q: '', topic: '', difficulty: '', type: '', status: '', lane: '' }),
        }, ['Clear all filters']),
      ]));
      return;
    }

    /* Bookmarking from a row re-renders the list, because the Bookmarked
       filter and the row's own star both have to follow it. */
    list.replaceChildren(problemList(rows, { onChange: renderCatalog }));
  }

  function wireCatalog() {
    let t = null;
    $('#fSearch').addEventListener('input', e => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => { filter.q = v; renderCatalog(); }, 120);
    });
    $('#fTopic').addEventListener('change',  e => setFilter({ topic: e.target.value }));
    $('#fDiff').addEventListener('change',   e => setFilter({ difficulty: e.target.value }));
    $('#fType').addEventListener('change',   e => setFilter({ type: e.target.value }));
    $('#fStatus').addEventListener('change', e => setFilter({ status: e.target.value }));
    $('#fLane').addEventListener('change',   e => setFilter({ lane: e.target.value }));
    $('#fClear').addEventListener('click', () =>
      setFilter({ q: '', topic: '', difficulty: '', type: '', status: '', lane: '' }));
  }

  /* ---------------- reading map ---------------- */

  let conceptFilter = { q: '', topic: '', read: '' };

  /* Where to learn a topic from scratch, as opposed to the per-concept
     readings below. "Where do I learn C++" and "where do I read about
     alignment" are different questions and deserve different answers. */
  function renderResources() {
    const host = $('#resourceList');
    if (!host) return;
    const topicId = conceptFilter.topic;
    const groups = topicId
      ? [Catalog.topicResources(topicId)].filter(Boolean).map(r => ({ id: topicId, ...r }))
      : Catalog.allResources();

    if (!groups.length) { host.replaceChildren(); return; }

    host.replaceChildren(...groups.map(g => el('div', { style: 'margin-bottom:var(--s5)' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { text: g.title || (Store.TOPIC_BY_ID[g.id] || {}).label || g.id }),
      ]),
      g.blurb ? el('p', { class: 'muted small', style: 'max-width:68ch;margin-top:0', text: g.blurb }) : null,
      el('div', { class: 'card stack' }, (g.resources || []).map(r => el('div', { class: 'prereq' }, [
        el('div', { class: 'spread' }, [
          el('h4', {}, [
            r.url
              ? el('a', { href: MD.safeHref(r.url), target: '_blank', rel: 'noopener noreferrer', text: r.title })
              : r.title,
          ]),
          r.kind ? el('span', { class: 'kind', text: r.kind }) : null,
        ]),
        r.where ? el('p', { class: 'why', style: 'margin-bottom:.25rem', text: r.where }) : null,
        r.note ? el('p', { class: 'one-line', style: 'margin-bottom:0', text: r.note }) : null,
      ]))),
    ])));
  }

  /* The reading map.

     Eleven topics and ninety concepts is too much for one scroll, so this view
     is navigation first: a topic strip with per-topic read counts, a status
     filter, and a running total. Each concept then shows its readings with
     ticks and — the part that makes reading feel like progress rather than
     homework — the exercises that practise it. */

  function renderReadingSummary() {
    const host = $('#readingSummary');
    if (!host) return;

    const all = Catalog.allConcepts();
    let read = 0;
    let total = 0;
    let finished = 0;
    for (const c of all) {
      const st = Catalog.readStatus(c.id);
      read += st.read;
      total += st.total;
      if (st.state === 'read') finished += 1;
    }
    const pct = total ? Math.round((read / total) * 100) : 0;

    host.replaceChildren(
      el('div', { class: 'spread' }, [
        el('div', {}, [
          el('div', { class: 'read-figure' }, [
            el('b', { text: String(read) }),
            el('span', { class: 'faint', text: ` of ${total} readings ticked` }),
          ]),
          el('p', {
            class: 'tiny faint', style: 'margin:.2rem 0 0',
            text: `${finished} of ${all.length} concepts finished. Ticking is your own record — nothing checks it.`,
          }),
        ]),
        el('div', { class: 'read-pct mono', text: `${pct}%` }),
      ]),
      el('div', { class: 'bar', style: 'margin-top:var(--s2)' }, [el('i', { style: `width:${pct}%` })]),
    );
  }

  /* The topic strip, which is both navigation and a progress report. Only
     topics that have concepts appear, so an empty topic is not advertised. */
  function renderConceptNav() {
    const host = $('#conceptNav');
    if (!host) return;

    const byTopic = {};
    for (const c of Catalog.allConcepts()) {
      const st = Catalog.readStatus(c.id);
      const b = byTopic[c.topic] = byTopic[c.topic] || { concepts: 0, read: 0, total: 0 };
      b.concepts += 1;
      b.read += st.read;
      b.total += st.total;
    }

    const chip = (id, label, b) => el('button', {
      type: 'button',
      class: `topic-chip${conceptFilter.topic === id ? ' on' : ''}`,
      'aria-pressed': String(conceptFilter.topic === id),
      onclick: () => {
        conceptFilter.topic = id;
        $('#cTopic').value = id;
        renderConcepts();
      },
    }, [
      el('span', { class: 'topic-chip-label', text: label }),
      b ? el('span', { class: 'topic-chip-count', text: `${b.read}/${b.total}` }) : null,
    ]);

    const everything = Object.values(byTopic)
      .reduce((a, b) => ({ read: a.read + b.read, total: a.total + b.total }), { read: 0, total: 0 });

    host.replaceChildren(
      chip('', 'All topics', everything),
      ...Store.TOPICS
        .filter(t => byTopic[t.id])
        .map(t => chip(t.id, t.label, byTopic[t.id])),
    );
  }

  /* The exercises that name this concept as a prerequisite. The point of the
     reading list is to unblock a problem, so the problem is the next step. */
  function practisedIn(conceptId) {
    const rows = Catalog.problemsForConcept(conceptId);
    if (!rows.length) return null;

    const solved = rows.filter(p => Store.record(p.id).status === 'solved').length;
    const shown = rows.slice(0, 4);

    return el('div', { class: 'practised' }, [
      el('span', {
        class: 'practised-label',
        text: `Practised in ${rows.length} ${rows.length === 1 ? 'problem' : 'problems'}`
          + `${solved ? ` · ${solved} solved` : ''}:`,
      }),
      el('span', { class: 'practised-links' }, [
        ...shown.map(p => el('a', {
          href: `#/p/${p.id}`,
          class: `practised-link status-${Store.record(p.id).status}`,
          title: `${(Store.DIFF_BY_ID[p.difficulty] || {}).label || p.difficulty} · ${Store.record(p.id).status}`,
          text: p.title,
        })),
        rows.length > shown.length
          ? el('a', {
              href: `#/problems?q=${encodeURIComponent(conceptId)}`,
              class: 'practised-more',
              text: `+${rows.length - shown.length} more`,
            })
          : null,
      ]),
    ]);
  }

  function renderConcepts() {
    renderResources();
    renderReadingSummary();
    renderConceptNav();

    const topicSel = $('#cTopic');
    if (topicSel.options.length === 1) {
      for (const t of Store.TOPICS) topicSel.append(el('option', { value: t.id, text: t.label }));
    }

    const q = conceptFilter.q.trim().toLowerCase();
    const rows = Catalog.allConcepts()
      .filter(c => !conceptFilter.topic || c.topic === conceptFilter.topic)
      .filter(c => !conceptFilter.read || Catalog.readStatus(c.id).state === conceptFilter.read)
      .filter(c => !q || `${c.name} ${c.id} ${c.oneLine || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.topic || '').localeCompare(b.topic || '') || a.name.localeCompare(b.name));

    const host = $('#conceptList');

    if (!rows.length) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('p', {
          class: 'muted',
          text: Catalog.allConcepts().length
            ? 'Nothing matches that.'
            : 'No concepts loaded yet. Run npm run build:index and serve the folder over HTTP.',
        }),
        Catalog.allConcepts().length
          ? el('button', {
              class: 'btn btn-sm', type: 'button',
              onclick: () => {
                conceptFilter = { q: '', topic: '', read: '' };
                $('#cSearch').value = '';
                $('#cTopic').value = '';
                $('#cRead').value = '';
                renderConcepts();
              },
            }, ['Clear the filters'])
          : null,
      ]));
      return;
    }

    const byTopic = {};
    for (const c of rows) (byTopic[c.topic] = byTopic[c.topic] || []).push(c);

    host.replaceChildren(...Object.entries(byTopic).map(([topicId, list]) =>
      el('section', { class: 'read-group', id: `topic-${topicId}` }, [
        el('div', { class: 'section-head' }, [
          el('h2', { text: (Store.TOPIC_BY_ID[topicId] || {}).label || topicId }),
          el('a', { class: 'more', href: `#/problems?topic=${topicId}`, text: 'Problems in this topic →' }),
        ]),
        el('div', { class: 'card' }, list.map(c => {
          const st = Catalog.readStatus(c.id);
          const node = el('div', { class: 'prereq', 'data-read': st.state }, [
            el('div', { class: 'spread' }, [
              el('h4', { text: c.name }),
              el('span', { class: 'row tiny' }, [
                st.total ? el('span', { class: 'faint mono', text: `${st.read}/${st.total}` }) : null,
                el('span', { class: `read-state read-${st.state}`, text: Catalog.READ_STATE_LABEL[st.state] }),
              ]),
            ]),
            c.oneLine ? el('p', { class: 'one-line prose', html: MD.renderInline(c.oneLine) }) : null,
            (c.needs || []).length ? el('p', { class: 'chain' }, [
              `needs: ${(c.needs || []).map(n => (Catalog.concept(n) || {}).name || n).join(' · ')}`,
            ]) : null,
          ]);

          const readings = el('div', { class: 'readings' });
          (c.readings || []).forEach((rd, i) => {
            const done = Store.hasRead(c.id, i);
            readings.append(el('label', { class: `reading${done ? ' done' : ''}` }, [
              el('input', {
                type: 'checkbox', checked: done || undefined,
                'aria-label': `Mark "${rd.title}" as read`,
                onchange: e => {
                  for (const a of Store.markReading(c.id, i, e.target.checked)) {
                    toast(`Unlocked: ${a.label}`, 'good');
                  }
                  renderConcepts(); refreshPurse();
                },
              }),
              rd.kind ? el('span', { class: 'kind', text: rd.kind }) : null,
              rd.url
                ? el('a', { class: 'title', href: MD.safeHref(rd.url), target: '_blank', rel: 'noopener noreferrer', text: rd.title })
                : el('span', { class: 'title', text: rd.title }),
              rd.where ? el('span', { class: 'where', text: rd.where }) : null,
            ]));
          });
          node.append(readings);

          const links = practisedIn(c.id);
          if (links) node.append(links);
          return node;
        })),
      ])));
  }

  function wireConcepts() {
    let t = null;
    $('#cSearch').addEventListener('input', e => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => { conceptFilter.q = v; renderConcepts(); }, 120);
    });
    $('#cTopic').addEventListener('change', e => { conceptFilter.topic = e.target.value; renderConcepts(); });
    $('#cRead').addEventListener('change',  e => { conceptFilter.read = e.target.value; renderConcepts(); });
    $('#cClear').addEventListener('click', () => {
      conceptFilter = { q: '', topic: '', read: '' };
      $('#cSearch').value = '';
      $('#cTopic').value = '';
      $('#cRead').value = '';
      renderConcepts();
    });
  }

  /* ---------------- profile ---------------- */

  function renderProfile() {
    const s = Store.state;
    const st = Store.stats(Catalog.all());
    const avatar = Store.SHOP_BY_ID[s.equipped.avatar];

    $('#profAvatar').textContent = (avatar && avatar.glyph) || '▚';
    $('#profName').textContent = s.profile.name || 'Anonymous';
    $('#profTitle').textContent = s.equipped.title || 'No title worn';
    $('#profRank').textContent = st.rank.current.label;
    $('#profXp').textContent = st.rank.next
      ? `${st.xp.toLocaleString()} XP · ${st.rank.next.at - st.xp} to ${st.rank.next.label}`
      : `${st.xp.toLocaleString()} XP`;

    $('#profStats').replaceChildren(
      statPill(st.solved, 'solved'),
      statPill(st.read, 'read the answer'),
      statPill(st.streak.longest, 'longest streak'),
      statPill(st.achievements.length, 'achievements'),
      statPill(st.readings, 'readings'),
    );

    $('#profTopics').replaceChildren(...Store.TOPICS.map(t => {
      const b = st.perTopic[t.id] || { total: 0, solved: 0 };
      const pct = b.total ? Math.round((b.solved / b.total) * 100) : 0;
      return el('div', {}, [
        el('div', { class: 'spread small' }, [
          el('span', { text: t.label }),
          el('span', { class: 'faint mono', text: `${b.solved}/${b.total}` }),
        ]),
        el('div', { class: 'bar', style: 'margin-top:.25rem' }, [el('i', { style: `width:${pct}%` })]),
      ]);
    }));

    const titles = Store.earnedTitles();
    $('#profTitles').replaceChildren(
      ...(titles.length
        ? [
            el('button', {
              class: 'chip', type: 'button', 'aria-pressed': String(!s.equipped.title),
              onclick: () => { Store.equip('title', ''); renderProfile(); },
            }, ['None']),
            ...titles.map(t => el('button', {
              class: 'chip', type: 'button', 'aria-pressed': String(s.equipped.title === t),
              onclick: () => { Store.equip('title', t); renderProfile(); },
            }, [t])),
          ]
        : [el('span', { class: 'small faint' }, ['None yet. Achievements grant them.'])]),
    );

    $('#profBadges').replaceChildren(...Store.ACHIEVEMENTS.map(a => {
      const had = s.achievements.includes(a.id);
      return el('div', { class: `badge-card${had ? '' : ' locked'}` }, [
        el('h4', {}, [had ? '✓ ' : '· ', a.label]),
        el('p', { text: a.note }),
        a.title ? el('p', { class: 'tiny faint', style: 'margin-top:.3rem' }, [`title: ${a.title}`]) : null,
      ]);
    }));
  }

  /* ---------------- shop ---------------- */

  const SLOT_LABELS = { theme: 'Themes', accent: 'Accents', avatar: 'Avatars', frame: 'Frames' };

  /* ---------------- theme previews ----------------

     A row of four colour chips tells you a theme is blue. It does not tell you
     whether the body text is readable on it, what a code comment looks like,
     or whether the accent is loud. So each theme card renders a miniature of
     the actual interface — topbar, card, difficulty chip, syntax-coloured
     code, buttons — in that theme's own tokens.

     The palette is not duplicated to do this: every block in themes.css also
     matches [data-theme-preview="<id>"], so the miniature is painted from the
     same values the page uses. A theme that changes gets a preview that
     changes with it. */

  function themeMiniature(themeId) {
    const code = el('pre', { class: 'tp-code' });
    code.innerHTML =
      '<span class="hl-keyword">while</span> (lo &lt; hi) {\n'
      + '  <span class="hl-type">size_t</span> mid = lo + (hi - lo) / <span class="hl-num">2</span>;\n'
      + '  <span class="hl-comment">// the half-open invariant</span>\n'
      + '}';

    return el('div', {
      class: 'tpreview', 'data-theme-preview': themeId, 'aria-hidden': 'true',
    }, [
      el('div', { class: 'tp-bar' }, [
        el('span', { class: 'tp-mark' }),
        el('span', { class: 'tp-brand', text: 'Systems Lab' }),
        el('span', { class: 'tp-xp', text: '1,240 xp' }),
      ]),
      el('div', { class: 'tp-body' }, [
        el('div', { class: 'tp-card' }, [
          el('div', { class: 'tp-title', text: 'Binary search, from its invariant' }),
          el('div', { class: 'tp-meta' }, [
            el('span', { class: 'tp-chip tp-diff', text: 'Intermediate' }),
            el('span', { class: 'tp-chip', text: 'Write code' }),
            el('span', { class: 'tp-faint', text: '~30 min' }),
          ]),
          el('div', { class: 'tp-track' }, [el('i', { style: 'width:62%' })]),
        ]),
        code,
        el('div', { class: 'tp-btns' }, [
          el('span', { class: 'tp-btn tp-primary', text: 'Submit' }),
          el('span', { class: 'tp-btn', text: 'Run samples' }),
        ]),
      ]),
    ]);
  }

  /* ---------------- previewing for real ----------------

     A miniature is honest about colour and still too small to judge reading a
     statement in. So Preview puts the theme on the whole page without buying
     or equipping it, and a bar offers to keep it or put things back. Nothing
     is written to the store until Keep is pressed, so navigating away or
     reloading reverts — which is the behaviour someone trying five themes in a
     row actually wants. */

  let previewing = null;   /* { themeId, wasTheme } while a preview is live */

  function endPreview({ keep = false } = {}) {
    if (!previewing) return;
    const { themeId, wasTheme } = previewing;
    previewing = null;

    const bar = $('#previewBar');
    if (bar) bar.hidden = true;

    if (keep) {
      /* Keeping is only possible for a theme already owned; the shop offers
         Buy rather than Keep otherwise. */
      Store.equip('theme', themeId);
      applyCosmetics();
      toast(`Wearing **${(Store.SHOP_BY_ID[themeId] || {}).label || themeId}**.`, 'good');
    } else {
      document.documentElement.setAttribute('data-theme', wasTheme);
    }
    if (!$('#view-shop').hidden) renderShop();
  }

  function startPreview(themeId) {
    const wasTheme = previewing ? previewing.wasTheme
      : (Store.state.equipped.theme || 'theme-dark');
    previewing = { themeId, wasTheme };
    document.documentElement.setAttribute('data-theme', themeId);

    const item = Store.SHOP_BY_ID[themeId] || {};
    const owned = Store.isOwned(themeId);
    const bar = $('#previewBar');
    const text = $('#previewText');
    const keep = $('#previewKeep');
    if (!bar) return;

    text.textContent = owned
      ? `Previewing ${item.label || themeId}. Nothing is saved until you keep it.`
      : `Previewing ${item.label || themeId} — you do not own it yet, so this is a look only.`;
    keep.hidden = !owned;
    keep.textContent = 'Keep it';
    bar.hidden = false;
    renderShop();
  }

  function renderShop() {
    const s = Store.state;
    const host = $('#shopHost');
    const sections = [];

    for (const slot of ['theme', 'accent', 'avatar', 'frame']) {
      const items = Store.SHOP.filter(i => i.slot === slot);
      sections.push(el('div', { style: 'margin-bottom:1.8rem' }, [
        el('h2', { text: SLOT_LABELS[slot] }),
        el('div', { class: `shop-grid${slot === 'theme' ? ' shop-grid-themes' : ''}` }, items.map(item => {
          const owned = Store.isOwned(item.id);
          const worn  = s.equipped[slot] === item.id;
          const isTheme = slot === 'theme';
          const previewed = previewing && previewing.themeId === item.id;

          /* Three states, and only one of them is a button: Applied is a fact
             about the page, not something to press. */
          const act = worn
            ? el('span', { class: 'pill pill-applied', 'data-act': 'applied', text: 'Applied' })
            : owned
              ? el('button', {
                  class: 'btn btn-sm btn-primary', type: 'button', 'data-act': 'apply',
                  onclick: () => {
                    previewing = null;
                    const bar = $('#previewBar');
                    if (bar) bar.hidden = true;
                    Store.equip(slot, item.id);
                    applyCosmetics();
                    renderShop();
                  },
                }, ['Apply'])
              : el('button', {
                  class: 'btn btn-sm btn-primary', type: 'button', 'data-act': 'buy',
                  disabled: s.coins < item.price || undefined,
                  onclick: () => {
                    const res = Store.buy(item.id);
                    if (!res.ok) {
                      toast(res.reason === 'poor'
                        ? `Not enough coins — ${res.short} short.`
                        : 'Could not buy that.', 'bad');
                      return;
                    }
                    previewing = null;
                    const bar = $('#previewBar');
                    if (bar) bar.hidden = true;
                    applyCosmetics(); refreshPurse(); renderShop();
                    toast(`Bought **${item.label}** and put it on.`, 'good');
                  },
                }, [s.coins < item.price ? `${item.price - s.coins} more coins` : `Buy · ${item.price} ◉`]);

          return el('div', {
            class: `shop-item${owned ? ' owned' : ''}${worn ? ' worn' : ''}${previewed ? ' previewing' : ''}`,
            'data-slot': slot, 'data-item': item.id,
          }, [
            isTheme ? themeMiniature(item.id) : null,
            el('div', { class: 'spread' }, [
              el('h4', {}, [item.glyph ? `${item.glyph}  ` : '', item.label]),
              owned || worn ? null : el('span', { class: 'price', text: `${item.price} ◉` }),
            ]),
            item.note ? el('p', { class: 'note', text: item.note }) : el('p', { class: 'note' }),
            el('div', { class: 'shop-actions' }, [
              /* Previewing the theme you are already wearing is a no-op, so
                 it is not offered. */
              isTheme && !worn
                ? el('button', {
                    class: `btn btn-sm btn-ghost${previewed ? ' on' : ''}`,
                    type: 'button', 'data-act': 'preview',
                    'aria-pressed': String(!!previewed),
                    onclick: () => (previewed ? endPreview() : startPreview(item.id)),
                  }, [previewed ? 'Stop preview' : 'Preview'])
                : null,
              act,
            ]),
          ]);
        })),
      ]));
    }

    host.replaceChildren(...sections);
  }

  function wireShop() {
    const keep = $('#previewKeep');
    const revert = $('#previewRevert');
    if (keep) keep.addEventListener('click', () => endPreview({ keep: true }));
    if (revert) revert.addEventListener('click', () => endPreview());
  }

  /* ---------------- settings ---------------- */

  function renderSettings() {
    $('#setName').value = Store.state.profile.name || '';
    $('#setJudge').value = Store.config.judgeUrl || '';
  }

  function wireSettings() {
    $('#setName').addEventListener('input', e => {
      Store.state.profile.name = e.target.value.slice(0, 40);
      Store.save();
    });

    $('#setJudge').addEventListener('change', e => {
      Store.setJudgeUrl(e.target.value);
      toast('Judge address saved.', 'info');
    });

    $('#judgeCheck').addEventListener('click', checkJudge);

    $('#setExport').addEventListener('click', () =>
      download('progress.json', JSON.stringify(Store.exportState(), null, 2)));

    $('#setExportSolves').addEventListener('click', () => {
      const solves = Store.exportSolves(Catalog.all());
      if (!solves.length) { toast('Nothing solved yet.', 'bad'); return; }
      download('systems-solves.json', JSON.stringify(solves, null, 2));
      toast(`${solves.length} solves exported. Import via **Data ▸ Import solved problems**.`, 'good');
    });

    $('#setImport').addEventListener('click', () => {
      const input = el('input', { type: 'file', accept: 'application/json,.json' });
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          Store.importState(JSON.parse(await file.text()));
          applyCosmetics(); refreshPurse(); renderSettings();
          toast('Progress imported.', 'good');
        } catch (err) {
          toast(`That file could not be read: ${err.message}`, 'bad');
        }
      });
      input.click();
    });

    $('#setReset').addEventListener('click', () => {
      if (!confirm('Reset everything?\n\nEvery solve, all XP and coins, and everything you own. This cannot be undone.')) return;
      Store.reset();
      applyCosmetics(); refreshPurse(); renderSettings();
      toast('Everything reset.', 'info');
    });
  }

  /* Whether the judge is up decides which languages a code problem can offer,
     so it is reported plainly rather than discovered on a failed submit. */
  async function checkJudge() {
    const box = $('#judgeState');
    const text = $('#judgeStateText');
    const url = Store.config.judgeUrl;
    box.dataset.up = 'false';
    text.textContent = 'Checking…';

    try {
      const res = await fetch(`${url}/langs`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const langs = await res.json();
      box.dataset.up = 'true';
      const names = (langs.languages || langs || []).map(l => l.id || l).join(', ');
      text.textContent = `Up at ${url} — ${names || 'no languages reported'}`;
      return true;
    } catch (err) {
      box.dataset.up = 'false';
      text.textContent = `Not reachable at ${url}. Start it with the command below, then check again.`;
      return false;
    }
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- wiring, called once ---------------- */

  function wire() {
    wireCatalog();
    wireConcepts();
    wireShop();
    wireSettings();
  }

  return {
    toast, refreshPurse, applyCosmetics, wire, endPreview,
    renderHome, renderCatalog, renderConcepts, renderProfile, renderShop, renderSettings,
    renderTracks, renderResources, problemList,
    setFilter, checkJudge,
  };
})();
