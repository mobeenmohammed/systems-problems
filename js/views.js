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

  function problemRow(p, { index = null } = {}) {
    const r = Store.record(p.id);
    const type = Catalog.TYPE_BY_ID[p.type] || {};
    const due = r.reviewOn && r.reviewOn <= Store.todayISO();
    const mark = TICK[r.status] || '';

    return el('a', {
      class: 'prow', href: `#/p/${p.id}`, 'data-status': r.status,
    }, [
      el('span', {
        class: `tick status-${r.status}`,
        title: r.status,
        text: mark || (index != null ? String(index) : ''),
      }),
      el('span', {}, [
        el('div', { class: 'title' }, [
          p.title,
          r.flagged ? el('span', { class: 'faint', text: ' ★' }) : null,
          due ? el('span', { class: 'faint', text: ' ◷' }) : null,
        ]),
        el('div', { class: 'meta' }, [
          el('span', { text: (Store.TOPIC_BY_ID[p.topic] || {}).label || p.topic }),
          el('span', { class: 'tag', text: type.label || p.type }),
          ...(p.tags || []).slice(0, 2).map(t => el('span', { text: `#${t}` })),
        ]),
      ]),
      diffTag(p.difficulty),
      el('span', {
        class: 'worth',
        text: r.status === 'solved' ? `${r.xpEarned} XP` : `${Store.potentialXp(p)} XP`,
      }),
    ]);
  }

  function problemList(metas, { numbered = false } = {}) {
    const list = el('div', { class: 'plist' });
    list.append(el('div', { class: 'plist-head' }, [
      el('span', { text: numbered ? '#' : '' }),
      el('span', { text: 'Problem' }),
      el('span', { text: 'Difficulty' }),
      el('span', { style: 'text-align:right', text: 'XP' }),
    ]));
    metas.filter(Boolean).forEach((p, i) => {
      list.append(problemRow(p, { index: numbered ? i + 1 : null }));
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

  let filter = { q: '', topic: '', difficulty: '', type: '', status: '' };

  function fillFilterOptions() {
    const topic = $('#fTopic');
    if (topic.options.length === 1) {
      for (const t of Store.TOPICS) topic.append(el('option', { value: t.id, text: t.label }));
      for (const d of Store.DIFFICULTIES) $('#fDiff').append(el('option', { value: d.id, text: d.label }));
      for (const t of Catalog.TYPES) $('#fType').append(el('option', { value: t.id, text: t.label }));
    }
  }

  function setFilter(patch, { silent = false } = {}) {
    filter = { ...filter, ...patch };
    $('#fSearch').value = filter.q;
    $('#fTopic').value  = filter.topic;
    $('#fDiff').value   = filter.difficulty;
    $('#fType').value   = filter.type;
    $('#fStatus').value = filter.status;
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
      list.replaceChildren(el('div', { class: 'empty' }, ['Nothing matches that. Try clearing a filter.']));
      return;
    }

    list.replaceChildren(problemList(rows));
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
    $('#fClear').addEventListener('click', () =>
      setFilter({ q: '', topic: '', difficulty: '', type: '', status: '' }));
  }

  /* ---------------- reading map ---------------- */

  let conceptFilter = { q: '', topic: '' };

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

  function renderConcepts() {
    renderResources();
    const topicSel = $('#cTopic');
    if (topicSel.options.length === 1) {
      for (const t of Store.TOPICS) topicSel.append(el('option', { value: t.id, text: t.label }));
    }

    const q = conceptFilter.q.trim().toLowerCase();
    const rows = Catalog.allConcepts()
      .filter(c => !conceptFilter.topic || c.topic === conceptFilter.topic)
      .filter(c => !q || `${c.name} ${c.id} ${c.oneLine || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.topic || '').localeCompare(b.topic || '') || a.name.localeCompare(b.name));

    const host = $('#conceptList');

    if (!rows.length) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        Catalog.allConcepts().length ? 'Nothing matches that.' : 'No concepts loaded yet.',
      ]));
      return;
    }

    const byTopic = {};
    for (const c of rows) (byTopic[c.topic] = byTopic[c.topic] || []).push(c);

    host.replaceChildren(...Object.entries(byTopic).map(([topicId, list]) =>
      el('div', { style: 'margin-bottom:1.5rem' }, [
        el('h2', { text: (Store.TOPIC_BY_ID[topicId] || {}).label || topicId }),
        el('div', { class: 'card' }, list.map(c => {
          const prog = Catalog.readProgress(c.id);
          const node = el('div', { class: 'prereq' }, [
            el('div', { class: 'spread' }, [
              el('h4', { text: c.name }),
              prog.total ? el('span', { class: 'tiny faint mono', text: `${prog.read}/${prog.total}` }) : null,
            ]),
            c.oneLine ? el('p', { class: 'one-line', html: MD.renderInline(c.oneLine) }) : null,
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
  /* Shown on a theme's card so you can see what you are buying without
     wearing it first. */
  const THEME_SWATCH = {
    'theme-dark':      ['#0b0f14', '#4f9dff', '#34d399', '#e4ecf4'],
    'theme-paper':     ['#f6f7f4', '#0a66c2', '#0f7a4d', '#1c2024'],
    'theme-gruvbox':   ['#282828', '#fabd2f', '#b8bb26', '#ebdbb2'],
    'theme-nord':      ['#2e3440', '#88c0d0', '#a3be8c', '#eceff4'],
    'theme-tokyo':     ['#1a1b26', '#7aa2f7', '#9ece6a', '#c0caf5'],
    'theme-solarized': ['#002b36', '#268bd2', '#859900', '#eee8d5'],
    'theme-dracula':   ['#282a36', '#bd93f9', '#50fa7b', '#f8f8f2'],
    'theme-phosphor':  ['#040a05', '#33ff66', '#8cff9e', '#4fc967'],
  };

  function renderShop() {
    const s = Store.state;
    const host = $('#shopHost');
    const sections = [];

    for (const slot of ['theme', 'accent', 'avatar', 'frame']) {
      const items = Store.SHOP.filter(i => i.slot === slot);
      sections.push(el('div', { style: 'margin-bottom:1.8rem' }, [
        el('h2', { text: SLOT_LABELS[slot] }),
        el('div', { class: 'shop-grid' }, items.map(item => {
          const owned = Store.isOwned(item.id);
          const worn  = s.equipped[slot] === item.id;
          const swatch = THEME_SWATCH[item.id];

          return el('div', { class: `shop-item${owned ? ' owned' : ''}${worn ? ' worn' : ''}` }, [
            swatch ? el('div', { class: 'swatch' }, swatch.map(c =>
              el('i', { style: `background:${c}` }))) : null,
            el('div', { class: 'spread' }, [
              el('h4', {}, [item.glyph ? `${item.glyph}  ` : '', item.label]),
              owned ? null : el('span', { class: 'price', text: `${item.price} ◉` }),
            ]),
            item.note ? el('p', { class: 'note', text: item.note }) : el('p', { class: 'note' }),
            worn
              ? el('span', { class: 'pill', style: 'align-self:flex-start', text: 'Worn' })
              : owned
                ? el('button', {
                    class: 'btn btn-sm', type: 'button',
                    onclick: () => { Store.equip(slot, item.id); applyCosmetics(); renderShop(); },
                  }, ['Wear it'])
                : el('button', {
                    class: 'btn btn-sm btn-primary', type: 'button',
                    disabled: s.coins < item.price || undefined,
                    onclick: () => {
                      const res = Store.buy(item.id);
                      if (!res.ok) {
                        toast(res.reason === 'poor'
                          ? `Not enough coins — ${res.short} short.`
                          : 'Could not buy that.', 'bad');
                        return;
                      }
                      applyCosmetics(); refreshPurse(); renderShop();
                      toast(`Bought **${item.label}** and put it on.`, 'good');
                    },
                  }, [s.coins < item.price ? `${item.price - s.coins} more coins` : 'Buy']),
          ]);
        })),
      ]));
    }

    host.replaceChildren(...sections);
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
    wireSettings();
  }

  return {
    toast, refreshPurse, applyCosmetics, wire,
    renderHome, renderCatalog, renderConcepts, renderProfile, renderShop, renderSettings,
    renderTracks, renderResources, problemList,
    setFilter, checkJudge,
  };
})();
