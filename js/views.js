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
    paintMe();
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

  const TICK = { solved: '✓', attempted: '◔', read: '◎', reviewed: '✎', unsolved: '' };
  const STATUS_LABEL = {
    unsolved: 'Not started',
    attempted: 'Attempted',
    solved: 'Solved',
    read: 'Read the answer',
    reviewed: 'Self-reviewed',
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

  /* ---------------- the profile menu ----------------

     Everything about you, behind one button, with the ring around it
     showing progress to the next rank. A real menu: Escape closes it, a
     click outside closes it, and the button says whether it is open. */

  function paintMe() {
    const st = Store.stats(Catalog.all());
    const s = Store.state;
    const avatar = Store.SHOP_BY_ID[s.equipped.avatar];

    const glyph = $('#meGlyph');
    if (glyph) glyph.textContent = (avatar && avatar.glyph) || '▚';

    const name = $('#meName');
    if (name) name.textContent = s.profile.name || 'Anonymous';

    const rank = $('#meRank');
    if (rank) {
      rank.textContent = st.rank.next
        ? `${st.rank.current.label} · ${st.rank.next.at - st.xp} to ${st.rank.next.label}`
        : st.rank.current.label;
    }

    /* pathLength="100" on the circle, so the dash array is just a
       percentage and nobody has to think about 2*pi*r. */
    const ring = $('#meRing');
    if (ring) {
      const pct = Math.max(0, Math.min(100, Math.round(st.rank.fraction * 100)));
      ring.setAttribute('stroke-dasharray', `${pct} 100`);
    }
  }

  function closeMe() {
    const btn = $('#meBtn');
    const menu = $('#meMenu');
    if (!btn || !menu) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function wireMe() {
    const btn = $('#meBtn');
    const menu = $('#meMenu');
    if (!btn || !menu) return;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) {
        paintMe();
        const first = menu.querySelector('[role="menuitem"]');
        if (first) first.focus();
      }
    });

    /* A link inside it is still a link; it just shuts the menu on the way. */
    menu.addEventListener('click', e => {
      if (e.target.closest('[role="menuitem"]')) closeMe();
    });

    document.addEventListener('click', e => {
      if (menu.hidden) return;
      if (!e.target.closest('#me')) closeMe();
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || menu.hidden) return;
      closeMe();
      btn.focus();
    });
  }

  /* ---------------- the Content menu ----------------

     Two links in the bar could only ever name two of the places this
     site goes, and "Problems" and "Learn" are not self-explanatory to
     somebody who has just arrived: one of them is a filterable
     catalogue, the other is a prerequisite graph. So the bar has one
     entry, and it opens on a panel that names everything with a line
     each saying what it is for.

     It holds learning destinations and nothing else. Profile, Shop and
     Settings were in a third column here as well as behind the avatar,
     which is a menu offering two routes to the same page and neither of
     them obviously the one to use. The avatar is where everything about
     *you* is, including exporting your data; this is where everything
     about the *subject* is.

     Built here rather than written into index.html because the count
     beside each entry is counted from the catalogue. A number somebody
     typed into the markup once is wrong the week after. */

  /* 16px line icons, one path set each. Drawn rather than fetched: an
     icon font would be a dependency and an emoji is a different picture
     on every platform. */
  const NAV_ICONS = {
    problems: '<path d="M2.5 4h11M2.5 8h11M2.5 12h7"/>',
    questions: '<circle cx="8" cy="8" r="6"/>'
      + '<path d="M6.3 6.3a1.75 1.75 0 1 1 1.75 1.95v1.1"/>'
      + '<circle cx="8.05" cy="11.7" r=".75" fill="currentColor" stroke="none"/>',
    code: '<path d="M5.8 4 2.3 8l3.5 4M10.2 4l3.5 4-3.5 4"/>',
    learn: '<rect x="5.5" y="1.6" width="5" height="3.4" rx="1"/>'
      + '<rect x="1" y="11" width="5" height="3.4" rx="1"/>'
      + '<rect x="10" y="11" width="5" height="3.4" rx="1"/>'
      + '<path d="M8 5v3.3M3.5 11V8.3h9V11"/>',
    reading: '<path d="M8 4.4a3 3 0 0 0-2.1-.9H2.4v8.6h3.5A3 3 0 0 1 8 13"/>'
      + '<path d="M8 4.4a3 3 0 0 1 2.1-.9h3.5v8.6h-3.5A3 3 0 0 0 8 13"/>'
      + '<path d="M8 4.4V13"/>',
    run: '<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6"/>'
      + '<path d="M4.6 6.6 7 8.6l-2.4 2M8.8 10.6h2.8"/>',
    profile: '<circle cx="8" cy="5.6" r="2.7"/>'
      + '<path d="M2.9 14c.6-2.8 2.6-4.2 5.1-4.2s4.5 1.4 5.1 4.2"/>',
    shop: '<path d="M3 5h10l-.8 8.6H3.8z"/><path d="M5.9 5V3.9a2.1 2.1 0 0 1 4.2 0V5"/>',
    settings: '<path d="M2.5 5h11M2.5 11h11"/><circle cx="6" cy="5" r="1.9"/>'
      + '<circle cx="10.5" cy="11" r="1.9"/>',
    week: '<rect x="2" y="3.2" width="12" height="10.8" rx="1.5"/>'
      + '<path d="M2 6.8h12M5.4 1.8v2.6M10.6 1.8v2.6"/>',
    assess: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.4 1.6"/>',
  };

  function navIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'navmenu-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = NAV_ICONS[name] || '';
    return svg;
  }

  /* What is in the site, in three columns. The counts are read at paint
     time; the menu is repainted whenever a solve could have changed one. */
  function contentSections() {
    const all = Catalog.all();
    const questions = all.filter(p => p.type !== 'code').length;
    const coding = all.length - questions;
    const tracks = Catalog.allTracks().length;
    const concepts = Catalog.allConcepts().length;
    const week = Catalog.thisWeek();
    const weekly = week && week.meta;

    return [
      {
        title: 'Practice',
        items: [
          {
            icon: 'problems', label: 'Problems', href: '#/problems',
            badge: 'Start here', count: all.length,
            blurb: 'The whole catalogue, filtered by topic, difficulty or what you have left.',
          },
          {
            icon: 'questions', label: 'Questions', href: '#/problems?kind=questions',
            count: questions,
            blurb: 'Multiple choice, predict the output, order the steps, and written mathematics.',
          },
          {
            icon: 'code', label: 'Coding exercises', href: '#/problems?kind=code',
            count: coding,
            blurb: 'Write a program and run it against the cases. Filter by the language '
              + 'you want to write in — most of these are C++ because C++ is the subject.',
          },
        ],
      },
      {
        title: 'Guided',
        items: [
          {
            icon: 'learn', label: 'Learn', href: '#/learn', count: tracks,
            blurb: 'Each track drawn as the tree of what it rests on, in prerequisite order.',
          },
          {
            icon: 'reading', label: 'Reading', href: '#/concepts', count: concepts,
            blurb: 'Every concept the problems use, with the book or paper that explains it.',
          },
          weekly
            ? {
              icon: 'week', label: 'This week', href: `#/p/${weekly.id}`,
              blurb: weekly.title,
            }
            : {
              icon: 'week', label: 'This week', href: '#/problems',
              blurb: 'One problem is chosen each week. None is set for this one.',
            },
        ],
      },
      {
        title: 'Assess',
        items: [
          {
            icon: 'assess', label: 'Online Assessments', href: '#/assess',
            blurb: 'Timed, from a separate bank you have not seen. Kept apart from '
              + 'practice: no XP, and a problem here is not one in the catalogue.',
          },
        ],
      },
    ];
  }

  function renderContentMenu() {
    const panel = $('#contentPanel');
    if (!panel) return;
    panel.replaceChildren(...contentSections().map(col => el('div', { class: 'navmenu-col' }, [
      el('p', { class: 'navmenu-col-head', text: col.title }),
      ...col.items.filter(Boolean).map(it => el('a', {
        class: 'navmenu-item', href: it.href, 'data-nav': it.href,
      }, [
        navIcon(it.icon),
        el('div', { class: 'navmenu-text' }, [
          el('span', { class: 'navmenu-title' }, [
            it.label,
            it.badge ? el('span', { class: 'navmenu-badge', text: it.badge }) : null,
            it.count != null
              ? el('span', { class: 'navmenu-count tiny faint', text: String(it.count) })
              : null,
          ]),
          el('span', { class: 'navmenu-blurb', text: it.blurb }),
        ]),
      ])),
    ])));
    markNav();
  }

  /* Which entry is the page you are on. Matched on the whole hash, because
     Questions and Coding exercises are the same view with a different
     filter and nothing shorter can tell them apart.

     Views with no entry of their own borrow the one they are reached
     from, so a single problem lights Problems and a track's flat list
     lights Learn — the alternative is a menu that goes blank exactly when
     you have gone somewhere and want to know where. */
  const NAV_ALIAS = [
    [/^#\/p\//, '#/problems'],
    [/^#\/tracks/, '#/learn'],
    [/^#\/learn/, '#/learn'],
    [/^#\/concepts/, '#/concepts'],
    [/^#\/assess/, '#/assess'],
  ];

  function markNav() {
    const here = location.hash || '#/';
    const alias = NAV_ALIAS.find(([re]) => re.test(here));
    const want = alias ? alias[1] : here;
    let any = false;
    for (const a of document.querySelectorAll('.navmenu-item')) {
      if (a.dataset.nav === want) { a.setAttribute('aria-current', 'page'); any = true; }
      else a.removeAttribute('aria-current');
    }
    const btn = $('#contentBtn');
    if (btn) btn.dataset.active = String(any || !(here === '#/' || here === ''));
  }

  /* Hover opens it and click pins it open. Without the pin, clicking the
     button after hovering onto it would shut the menu a reader had just
     opened by arriving — the pointer fires enter before click, so the
     click would land on an already-open panel and toggle it away. */
  let contentPinned = false;

  function closeContent(focus = false) {
    const btn = $('#contentBtn');
    const panel = $('#contentPanel');
    contentPinned = false;
    if (!btn || !panel) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focus) btn.focus();
  }

  function openContent() {
    const btn = $('#contentBtn');
    const panel = $('#contentPanel');
    if (!btn || !panel || !panel.hidden) return;
    renderContentMenu();
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }

  /* Hover alone would put the whole of the site behind a gesture a
     keyboard cannot make, so click and Enter open it too and Escape shuts
     it. The close on leaving is delayed, because the pointer has to cross
     a gap between the button and the panel to reach it. */
  function wireContent() {
    const wrap = $('#navContent');
    const btn = $('#contentBtn');
    const panel = $('#contentPanel');
    if (!wrap || !btn || !panel) return;

    let shutTimer = null;
    const hold = () => { clearTimeout(shutTimer); shutTimer = null; };
    const soon = () => {
      hold();
      shutTimer = setTimeout(() => { if (!contentPinned) closeContent(); }, 180);
    };

    wrap.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch') return;
      hold();
      openContent();
    });
    wrap.addEventListener('pointerleave', e => {
      if (e.pointerType === 'touch') return;
      soon();
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (contentPinned) { closeContent(); return; }
      openContent();
      contentPinned = true;
    });

    panel.addEventListener('click', e => {
      if (e.target.closest('.navmenu-item')) closeContent();
    });

    document.addEventListener('click', e => {
      if (panel.hidden) return;
      if (!e.target.closest('#navContent')) closeContent();
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || panel.hidden) return;
      closeContent(true);
    });

    /* Tabbing past the last entry leaves the menu; it should not stay
       open behind whatever the reader has moved on to. */
    wrap.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!panel.hidden && !wrap.contains(document.activeElement)) closeContent();
      }, 0);
    });
  }

  /* ---------------- the front page ----------------

     It was a dashboard, then it was four doors into the catalogue. Both
     of those answer a question you only have once you are already using
     the site. The page somebody actually lands on has to answer the
     first one — what is this, and what happens if I press the button —
     so almost all of it is now prose, and lives in index.html.

     Three things cannot be written down there, because they are counted:
     what the main button says, the strip of numbers, and the same button
     again at the foot. */

  function renderHome() {
    const up = Catalog.nextUp();
    /* "Continue" is a promise about a specific problem, so it is only
       offered when there is one that has actually been opened. Anything
       else — including the first problem of a track nobody has started —
       is a beginning, and says so. */
    const resuming = up && (up.reason === 'resume' || up.reason === 'next-in-track');

    const cta = (foot) => [
      el('a', { class: 'btn btn-primary btn-lg', href: resuming ? `#/p/${up.meta.id}` : '#/problems' },
        [resuming ? 'Carry on' : 'Start solving']),
      el('a', { class: 'btn btn-lg', href: '#/learn' }, ['Take a track']),
      resuming && !foot
        ? el('span', { class: 'hero-cta-note tiny faint' }, [
          'last: ',
          el('a', { href: `#/p/${up.meta.id}`, text: up.meta.title }),
        ])
        : null,
    ].filter(Boolean);

    const main = $('#homeCta');
    if (main) main.replaceChildren(...cta(false));
    const foot = $('#homeFootCta');
    if (foot) foot.replaceChildren(...cta(true));

    /* Counted, never written down: a sentence that spells out "nine
       topics" is wrong the next time a topic is added. */
    const n = Catalog.counts();
    const facts = $('#homeFacts');
    if (!facts) return;

    /* Five zeroes in a row is a page that looks fine and is not. If the
       index did not load, the strip says that instead of counting it. */
    if (!n.problems) {
      facts.replaceChildren(el('p', { class: 'home-empty' }, [
        'No problems are loaded yet. Run ',
        el('code', { text: 'npm run build:index' }),
        ', then serve the folder over HTTP rather than opening index.html off disk.',
      ]));
      return;
    }

    const fact = (value, label) => el('div', { class: 'fact' }, [
      el('span', { class: 'fact-n', text: value.toLocaleString() }),
      el('span', { class: 'fact-k', text: label }),
    ]);
    facts.replaceChildren(
      fact(n.problems, n.problems === 1 ? 'problem' : 'problems'),
      fact(n.topics, 'topics'),
      fact(n.concepts, 'concepts, in prerequisite order'),
      fact(n.readings, 'readings attached to them'),
      fact(n.languages, 'languages you can answer in'),
    );
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

    /* Two ways there is nothing to carry on with, and the difference
       matters: everything is finished, or nothing was ever loaded. Saying
       neither would leave the rail looking like it had failed. */
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

  /* ---------------- learn ----------------

     A track is a list of problems; what it teaches is the concepts those
     problems rest on, in prerequisite order. Catalog.trackTree works that
     out, and this draws it: the tree on the left, and whichever node you
     pick on the right, with its readings and its problems.

     The node panel is the point. "What do I read for this, and what can I
     then do with it" is one question, and it used to need two pages. */

  function renderLearn(trackId, conceptId) {
    const index = $('#learnIndex');
    const detail = $('#learnTrack');
    const tree = trackId ? Catalog.trackTree(trackId) : null;

    /* An unknown id falls back to the list rather than an empty frame: a
       stale bookmark should land somewhere useful. */
    index.hidden = !!tree;
    detail.hidden = !tree;

    /* The index is an ordinary page and the graph is a workspace, and
       they are the same route. So the flag goes on here and comes off
       here — as well as in the router, which takes it off for every
       route that is not Learn at all. Both, because one of them being
       missed is how the code workspace once followed the reader onto
       the dashboard and clipped it to the window. */
    if (!tree) {
      leaveGraph();
      renderLearnIndex();
      return;
    }
    document.body.dataset.graph = 'true';
    /* Anything that redraws the graph has answered whatever the search
       box was asking. Leaving the list open over the picture after the
       reader has arrived somewhere is a menu in the way of the thing it
       was for. */
    closeFind();

    $('#learnTitle').textContent = tree.track.title;
    $('#learnTitle').title = tree.track.goal || tree.track.blurb || '';
    $('#learnProblems').href = `#/tracks/${tree.track.id}`;

    /* Nothing is selected until something is clicked. The panel covers
       part of the canvas, and opening it over the picture before the
       reader has picked anything hides the thing they came to look at. */
    const flat = [];
    (function walk(ns) { for (const n of ns) { flat.push(n); walk(n.children); } })(tree.roots);
    const picked = conceptId ? flat.find(n => n.id === conceptId) || null : null;
    selectedId = picked ? picked.id : null;

    const centreBtn = $('#learnCentre');
    if (centreBtn) centreBtn.disabled = !selectedId;

    /* The track's own required work, which is what finishing it means —
       the same number as the bar on its card. Everything else the tree
       reaches is related practice and is counted separately, where it is
       shown. */
    const req = Catalog.trackRequired(tree.track.id) || { done: 0, total: 0 };
    $('#learnProgress').textContent = req.total
      ? `${req.done} of ${req.total} required solved`
      : 'Nothing required yet';
    $('#learnProgress').title = 'Questions and coding exercises in this track. '
      + 'Related practice and readings are not counted here.';

    drawTree(tree, picked);
    drawNode(tree, picked);

    /* The view: whatever this track was left at, or the starting one.
       Only on arrival — a redraw caused by ticking a reading must not
       throw away wherever the reader had panned to. */
    const first = lastTrack !== tree.track.id;
    if (first) {
      lastTrack = tree.track.id;
      applyPanelWidth(Store.pref(PANEL_PREF, 420));
      const saved = savedViews()[tree.track.id];
      if (saved && Number.isFinite(saved.z)) {
        view = { x: saved.x, y: saved.y, z: clampZoom(saved.z) };
        applyView();
      } else {
        resetView();
      }
    }

    /* Whether it was just opened or just selected, the node the panel is
       about has to be somewhere you can see it — and "visible" means
       outside the panel, which reveal() measures rather than assumes. */
    if (picked) {
      reveal(placed.nodes.find(n => n.id === picked.id));
      rememberView(tree.track.id, { at: picked.id });
    } else if (first) {
      rememberView(tree.track.id);
    }
  }

  /* Which track the canvas is currently showing, so a redraw of the same
     one does not reset the view, and which node is open. */
  let lastTrack = null;
  let selectedId = null;

  /* Put the page back the way every other view expects to find it. Safe
     to call twice and safe to call when no graph was ever open — the
     same contract as ProblemView.leave, and for the same reason. */
  function leaveGraph() {
    delete document.body.dataset.graph;
    lastTrack = null;
    selectedId = null;
    closeFind();
  }

  function renderLearnIndex() {
    const host = $('#learnTracks');
    const tracks = Catalog.allTracks();
    const blurb = $('#learnBlurb');
    if (blurb) {
      blurb.textContent = tracks.length
        ? `${tracks.length} tracks. Each one is a tree of what it rests on — `
          + 'pick a node to see what to read and what to try.'
        : 'Ordered sets of problems that build on each other.';
    }

    /* Grouped by subject rather than filtered to one: the point of taking
       the switch out of the top bar was that both halves are always here. */
    const groups = Store.SUBJECTS.map(sub => ({
      sub,
      rows: tracks.filter(t => (t.subjects || []).includes(sub.id)),
    })).filter(g => g.rows.length);

    /* Every other view says so when it has nothing; this one used to
       render an empty div and look broken rather than empty. */
    if (!groups.length) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'No tracks loaded' }),
        el('p', { class: 'muted' }, [Catalog.loadError
          ? `The catalogue did not load: ${Catalog.loadError}`
          : 'Nothing to work through yet.'],
        ),
      ]));
      return;
    }

    host.replaceChildren(...groups.map(g => el('div', { class: 'learn-group' }, [
      el('h2', { class: 'learn-group-head', text: g.sub.label }),
      el('div', { class: 'tracks' }, g.rows.map(t => {
        const prog = Catalog.trackProgress(t);
        const tree = Catalog.trackTree(t.id);
        const counts = Catalog.trackCounts(t.id);
        const pct = Math.round(prog.fraction * 100);
        return el('a', {
          class: 'track-card', href: `#/learn/${t.id}`, 'data-state': prog.state,
        }, [
          el('div', { class: 'track-top' }, [
            el('h3', { text: t.title }),
            stateChip(prog.state),
          ]),
          el('p', { class: 'track-blurb', text: firstSentence(t.blurb) }),
          el('div', { class: 'track-foot' }, [
            el('div', { class: 'bar', title: `${pct}%` }, [el('i', { style: `width:${pct}%` })]),
            el('div', { class: 'spread tiny' }, [
              el('span', { text: `${prog.done} of ${prog.total} solved` }),
              el('span', { class: 'faint', text: `${tree ? tree.size : 0} concepts` }),
            ]),
            /* Four labels, not three, and none of them says "Problems"
               twice. Questions and Coding exercises are the track's own
               required list, which is what the bar above is a fraction
               of. Related practice is everything else that rests on a
               concept this track teaches — worth offering, and not part
               of finishing it. Resources is kept away from all three:
               ticking a reading is a note to yourself, not a solve. */
            counts ? el('div', { class: 'track-counts' }, [
              ['Questions', counts.questions, 'Required: questions in this track'],
              ['Coding exercises', counts.coding, 'Required: coding exercises in this track'],
              ['Related practice', counts.related,
                'Rests on a concept this track teaches, but is not part of finishing it'],
              ['Resources', counts.resources,
                'Readings you have ticked. Not a solve, and not counted towards the track'],
            ]
              /* A 0 / 0 tile says there might be some. No mathematics
                 problem is a coding exercise, so that one is left off
                 those cards rather than shown empty. */
              .filter(([, c]) => c.total > 0)
              .map(([label, c, why]) => el('div', {
                class: 'track-count', 'data-kind': label.toLowerCase().split(' ')[0],
                title: why,
              }, [
                el('span', { class: 'track-count-label', text: label }),
                el('span', { class: 'track-count-value', text: `${c.done} / ${c.total}` }),
              ]))) : null,
          ]),
        ]);
      })),
    ])));
  }

  /* ---------------- the canvas ----------------

     Boxes where js/learn/layout.js put them, edges in an SVG behind
     them, and one transform on the wrapper for pan and zoom so nothing
     reflows when the scale changes.

     The graph owns the window below the header now, so the wheel means
     something here: it pans, and Ctrl (or a trackpad pinch, which the
     browser reports as Ctrl+wheel) zooms about the pointer. Plain wheel
     is deliberately NOT zoom — a two-finger scroll that silently rescales
     the picture is the single most complained-about behaviour in every
     canvas that does it. */

  /* 0.55 is where a 0.8rem label stops being readable on a 1080p screen.
     Nothing goes below it on its own: "Fit all" may, because you asked
     for all of it, but the view you are given when you open a track may
     not. A graph scaled to 0.35 so that every one of a hundred and
     fifteen boxes fits is a picture of grey rectangles. */
  const ZOOM = { min: 0.25, max: 2, step: 0.2, readable: 0.55 };

  let view = { x: 0, y: 0, z: 1 };
  let placed = null;

  /* Pan, zoom and which node was open, per track. Kept so that opening a
     problem from the panel and coming back puts you where you were
     rather than at the top of the graph again — which, on a track the
     size of "How memory really behaves", means finding your place by
     reading boxes. Persisted, so a reload is the same. */
  const VIEW_PREF = 'learnViews';
  let views = null;

  function savedViews() {
    if (!views) {
      const raw = Store.pref(VIEW_PREF, null);
      views = (raw && typeof raw === 'object') ? raw : {};
    }
    return views;
  }

  function rememberView(trackId, extra = {}) {
    if (!trackId) return;
    const all = savedViews();
    all[trackId] = {
      ...(all[trackId] || {}),
      x: Math.round(view.x), y: Math.round(view.y), z: Number(view.z.toFixed(3)),
      ...extra,
    };
    Store.setPref(VIEW_PREF, all);
  }

  function applyView() {
    const pan = $('#learnPan');
    if (pan) pan.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const at = $('#learnZoomAt');
    if (at) at.textContent = `${Math.round(view.z * 100)}%`;
  }

  /* The part of the canvas not under the details panel. Everything that
     puts something "in the middle" has to mean the middle of what you can
     see, or the selected box ends up behind the panel that was opened to
     describe it. */
  function visibleBox() {
    const canvas = $('#learnCanvas');
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    const panel = $('#learnPanel');
    const out = { left: 0, top: 0, width: box.width, height: box.height };
    if (panel && !panel.hidden) {
      const pr = panel.getBoundingClientRect();
      /* A drawer across the bottom on a phone, a column on the right
         otherwise. Measured rather than assumed, so the breakpoint is
         written down in one place — the stylesheet. */
      if (pr.width >= box.width - 1) out.height = Math.max(120, pr.top - box.top);
      else out.width = Math.max(160, pr.left - box.left);
    }
    return out;
  }

  const clampZoom = z => Math.max(ZOOM.min, Math.min(ZOOM.max, z));

  /* The view you get when you open a track, and what Reset zoom puts
     back. Readable scale, the first concepts at the top, centred across.
     Not a fit: the roots are what you need first, and they are at the
     top of a top-down graph. */
  function resetView() {
    const vb = visibleBox();
    if (!vb || !placed || !placed.width) return;
    const fit = Math.min(1, (vb.width - 48) / placed.width);
    view.z = clampZoom(Math.max(ZOOM.readable, fit));
    view.x = vb.left + Math.max(24, (vb.width - placed.width * view.z) / 2);
    view.y = vb.top + 24;
    applyView();
  }

  /* All of it on screen, however small — which is what the button says,
     so going below the readable floor here is the answer to the question
     rather than a decision made on the reader's behalf. */
  function fitAll() {
    const vb = visibleBox();
    if (!vb || !placed || !placed.width) return;
    const fit = Math.min(
      (vb.width - 48) / placed.width,
      (vb.height - 48) / placed.height,
    );
    view.z = clampZoom(Math.min(1, fit));
    view.x = vb.left + (vb.width - placed.width * view.z) / 2;
    view.y = vb.top + (vb.height - placed.height * view.z) / 2;
    applyView();
  }

  /* Put one box in the middle of what is visible, without changing the
     scale: the reader chose that scale. */
  function centreOn(id) {
    const vb = visibleBox();
    const pos = placed && placed.nodes.find(n => n.id === id);
    if (!vb || !pos) return;
    view.x = vb.left + vb.width / 2 - (pos.x + pos.w / 2) * view.z;
    view.y = vb.top + vb.height / 2 - (pos.y + pos.h / 2) * view.z;
    applyView();
  }

  /* Zoom about a point in canvas coordinates, so what is under the
     pointer stays under the pointer. */
  function zoomAt(next, cx, cy) {
    const z = clampZoom(next);
    if (z === view.z) return;
    view.x = cx - ((cx - view.x) / view.z) * z;
    view.y = cy - ((cy - view.y) / view.z) * z;
    view.z = z;
    applyView();
  }

  function zoomBy(delta) {
    const vb = visibleBox();
    if (!vb) return;
    zoomAt(view.z + delta, vb.left + vb.width / 2, vb.top + vb.height / 2);
  }

  /* Bring a box into view without moving anything already visible —
     what the arrow keys need, and what opening the panel needs when the
     box it is about has just gone underneath it. */
  function reveal(pos) {
    const vb = visibleBox();
    if (!vb || !pos) return;
    const pad = 24;
    const left = pos.x * view.z + view.x;
    const top = pos.y * view.z + view.y;
    const right = left + pos.w * view.z;
    const bottom = top + pos.h * view.z;

    if (left < vb.left + pad) view.x += vb.left + pad - left;
    else if (right > vb.left + vb.width - pad) view.x -= right - (vb.left + vb.width - pad);
    if (top < vb.top + pad) view.y += vb.top + pad - top;
    else if (bottom > vb.top + vb.height - pad) view.y -= bottom - (vb.top + vb.height - pad);
    applyView();
  }

  /* What is done at a node, with reading kept apart from solving.

     They used to be added together, so a concept whose three readings
     were ticked and whose two problems were untouched was 60% and shaded
     as progress. Reading a thing is not knowing it; the only part of
     this that was checked by anything is the solves. */
  function nodeProgress(n) {
    const read = Catalog.readProgress(n.id);
    const solved = n.problems.filter(pr => {
      const st = Store.record(pr.id).status;
      return st === 'solved' || st === 'reviewed';
    }).length;
    const total = n.problems.length;
    return {
      read, solved, total, done: solved,
      pct: total ? Math.round((solved / total) * 100) : 0,
      /* Three states, because "nothing to solve here" is not "solved".
         A concept with readings and no problems can be read and nothing
         more, and saying so is more honest than a full green bar. */
      state: total ? (solved >= total ? 'done' : solved ? 'part' : 'open')
        : (read.total && read.read >= read.total ? 'read' : 'open'),
    };
  }

  function drawTree(tree, picked) {
    const nodesHost = $('#learnNodes');
    const svg = $('#learnEdges');
    if (!nodesHost || !svg) return;

    placed = LearnLayout.layout(tree);

    svg.setAttribute('width', placed.width);
    svg.setAttribute('height', placed.height);
    svg.setAttribute('viewBox', `0 0 ${placed.width} ${placed.height}`);
    svg.replaceChildren(...placed.edges.map(e => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', e.path);
      path.dataset.from = e.from;
      path.dataset.to = e.to;
      if (e.extra) path.dataset.extra = 'true';
      return path;
    }));

    nodesHost.style.width = `${placed.width}px`;
    nodesHost.style.height = `${placed.height}px`;

    const chosen = (picked || {}).id;
    const own = new Set(tree.track.problems || []);
    nodesHost.replaceChildren(...placed.nodes.map(pos => {
      const n = pos.node;
      const p = nodeProgress(n);
      const required = n.problems.filter(pr => own.has(pr.id));
      return el('button', {
        type: 'button',
        class: 'lnode',
        role: 'treeitem',
        'aria-level': String(pos.rank + 1),
        'aria-selected': String(n.id === chosen),
        'data-concept': n.id,
        'data-state': p.state,
        /* The numbers in words: the bar is three pixels tall and a
           screen reader cannot see it at all. Readings are said
           separately from solves because they mean different things. */
        'aria-label': `${n.name}. ${p.solved} of ${n.problems.length} problems solved`
          + `${required.length === n.problems.length ? '' : `, ${required.length} of them in this track`}`
          + `. ${p.read.read} of ${p.read.total} readings ticked.`,
        tabindex: n.id === chosen ? '0' : '-1',
        style: `left:${pos.x}px; top:${pos.y}px; width:${pos.w}px; height:${pos.h}px`,
      }, [
        el('span', { class: 'lnode-name', text: n.name }),
        p.total ? el('div', { class: 'bar' }, [el('i', { style: `width:${p.pct}%` })]) : null,
      ]);
    }));

    litEdges(chosen);
  }

  /* ---------------- following a prerequisite path ----------------

     The edges touching the selected box, and then every edge on the way
     down to it from a root. One line lit tells you what this rests on;
     the whole chain lit tells you the order to learn it in, which is the
     question the picture exists to answer. The two are drawn
     differently, because "rests directly on" and "is somewhere beneath"
     are not the same claim. */
  function litEdges(id) {
    const svg = $('#learnEdges');
    if (!svg) return;

    const chain = new Set();
    if (id && placed) {
      /* Every ancestor, by walking edges backwards from the selection. */
      const seen = new Set([id]);
      const queue = [id];
      while (queue.length) {
        const here = queue.shift();
        for (const e of placed.edges) {
          if (e.to !== here) continue;
          chain.add(`${e.from}>${e.to}`);
          if (!seen.has(e.from)) { seen.add(e.from); queue.push(e.from); }
        }
      }
      for (const btn of document.querySelectorAll('.lnode')) {
        const on = btn.dataset.concept !== id && seen.has(btn.dataset.concept);
        if (on) btn.dataset.ancestor = 'true';
        else delete btn.dataset.ancestor;
      }
    } else {
      for (const btn of document.querySelectorAll('.lnode')) delete btn.dataset.ancestor;
    }

    for (const path of svg.querySelectorAll('path')) {
      const key = `${path.dataset.from}>${path.dataset.to}`;
      if (id && (path.dataset.from === id || path.dataset.to === id)) {
        path.dataset.lit = 'true';
        delete path.dataset.path;
      } else if (chain.has(key)) {
        path.dataset.path = 'true';
        delete path.dataset.lit;
      } else {
        delete path.dataset.lit;
        delete path.dataset.path;
      }
    }
  }

  /* ---------------- walking it with the keyboard ----------------

     The tree runs top down, so the keys do too: left and right move
     along a rank, and up and down cross between them. Up goes to a
     prerequisite rather than to whatever box happens to be above,
     because that is the more useful answer and it is the one the line
     under your feet actually goes to. */

  function neighbour(from, key) {
    if (!placed) return null;
    const here = placed.nodes.find(n => n.id === from);
    if (!here) return null;

    const sameRank = placed.nodes.filter(n => n.rank === here.rank)
      .sort((a, b) => a.order - b.order);
    const at = sameRank.indexOf(here);

    if (key === 'ArrowRight') return sameRank[at + 1] || null;
    if (key === 'ArrowLeft') return sameRank[at - 1] || null;
    if (key === 'Home') return placed.nodes.filter(n => n.rank === 0)[0] || null;
    if (key === 'End') {
      const last = Math.max(...placed.nodes.map(n => n.rank));
      return placed.nodes.filter(n => n.rank === last)[0] || null;
    }

    const step = key === 'ArrowUp' ? 'to' : key === 'ArrowDown' ? 'from' : null;
    if (!step) return null;
    const other = step === 'to' ? 'from' : 'to';
    /* Nearest along the rank, so following a line up and then back down
       lands where you started rather than at the far end of the row. */
    return placed.edges
      .filter(e => e[step] === here.id)
      .map(e => placed.nodes.find(n => n.id === e[other]))
      .filter(Boolean)
      .sort((a, b) => Math.abs(a.order - here.order) - Math.abs(b.order - here.order))[0] || null;
  }

  function focusNode(id) {
    const btn = document.querySelector(`.lnode[data-concept="${id}"]`);
    if (!btn) return;
    for (const other of document.querySelectorAll('.lnode')) other.tabIndex = -1;
    btn.tabIndex = 0;
    btn.focus({ preventScroll: true });
    reveal(placed.nodes.find(n => n.id === id));
  }

  /* ---------------- find a concept ----------------

     A hundred and fifteen boxes is more than anyone will read looking
     for one. Matches on the name and the one-line description, shows
     which rank it is at so the answer carries its own context, and
     centres the chosen one. */

  let findAt = -1;

  function findMatches(q) {
    if (!placed || !q.trim()) return [];
    const needle = q.trim().toLowerCase();
    return placed.nodes
      .filter(pos => pos.node)
      .map(pos => pos.node)
      .filter(n => `${n.name} ${n.id} ${n.oneLine || ''}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        /* A name that starts with what you typed first, then by name. */
        const an = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
        const bn = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
        return an - bn || a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }

  function paintFind(trackId, q) {
    const list = $('#learnFindList');
    const input = $('#learnFind');
    if (!list || !input) return;
    const hits = findMatches(q);
    findAt = hits.length ? 0 : -1;

    if (!q.trim()) {
      list.hidden = true;
      list.replaceChildren();
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    if (!hits.length) {
      list.replaceChildren(el('p', {
        class: 'graph-find-none',
        text: `Nothing in this track matches “${q.trim()}”.`,
      }));
    } else {
      list.replaceChildren(...hits.map((n, i) => el('button', {
        class: 'graph-find-opt', type: 'button', role: 'option',
        'aria-selected': String(i === findAt),
        'data-concept': n.id,
        onclick: () => goFind(trackId, n.id),
      }, [
        el('span', { text: n.name }),
        el('span', {
          class: 'graph-find-why',
          text: n.oneLine ? n.oneLine.slice(0, 70) : Store.TOPIC_BY_ID[n.topic]?.label || '',
        }),
      ])));
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeFind() {
    const list = $('#learnFindList');
    const input = $('#learnFind');
    findAt = -1;
    if (list) { list.hidden = true; list.replaceChildren(); }
    if (input) { input.value = ''; input.setAttribute('aria-expanded', 'false'); }
  }

  function goFind(trackId, id) {
    closeFind();
    location.hash = `#/learn/${trackId}/${id}`;
    /* The route redraws and selects it; centring is this function's job
       because arriving at a node by searching is the one case where you
       have no idea where it is. */
    setTimeout(() => { centreOn(id); focusNode(id); }, 0);
  }

  /* ---------------- the panel's width ---------------- */

  const PANEL_PREF = 'learnPanelW';
  const PANEL_MIN = 260;

  function applyPanelWidth(px) {
    const canvas = $('#learnCanvas');
    if (!canvas) return;
    const max = Math.max(PANEL_MIN, canvas.getBoundingClientRect().width - 280);
    const w = Math.round(Math.max(PANEL_MIN, Math.min(max, px)));
    canvas.style.setProperty('--lpanel-w', `${w}px`);
    return w;
  }

  function wireCanvas() {
    const canvas = $('#learnCanvas');
    const nodes = $('#learnNodes');
    if (!canvas || !nodes) return;

    $('#learnZoomIn').addEventListener('click', () => zoomBy(ZOOM.step));
    $('#learnZoomOut').addEventListener('click', () => zoomBy(-ZOOM.step));
    $('#learnFit').addEventListener('click', () => { fitAll(); rememberView(lastTrack); });
    $('#learnReset').addEventListener('click', () => { resetView(); rememberView(lastTrack); });
    $('#learnCentre').addEventListener('click', () => {
      if (selectedId) { centreOn(selectedId); focusNode(selectedId); rememberView(lastTrack); }
    });

    /* ---- find ---- */
    const find = $('#learnFind');
    if (find) {
      let t = null;
      find.addEventListener('input', e => {
        clearTimeout(t);
        const v = e.target.value;
        t = setTimeout(() => paintFind(lastTrack, v), 90);
      });
      find.addEventListener('keydown', e => {
        const opts = [...document.querySelectorAll('.graph-find-opt')];
        if (e.key === 'Escape') { paintFind(lastTrack, ''); find.value = ''; return; }
        if (!opts.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          findAt = (findAt + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
          opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === findAt)));
          opts[findAt].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && findAt >= 0) {
          e.preventDefault();
          goFind(lastTrack, opts[findAt].dataset.concept);
        }
      });
      document.addEventListener('click', e => {
        if (!e.target.closest('.graph-find')) paintFind(lastTrack, '');
      });
    }

    /* ---- pan, and a click that is not a drag ----

       The pointer may go down on a box: a graph where you cannot drag
       from a node is a graph where half the surface is not grab-able,
       and that half is the part with things on it. So every press starts
       a possible pan, and only four pixels of movement turns it into
       one. Under that it is a click, and the click opens the node —
       which is the other half of the same bug, a 2px wobble during a
       click leaving the reader on a canvas that moved and a panel that
       never opened. */
    const SLOP = 4;
    let drag = null;

    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.learn-zoom, .learn-panel, .graph-find')) return;
      drag = {
        id: e.pointerId, moved: false,
        fromX: e.clientX, fromY: e.clientY,
        x: e.clientX - view.x, y: e.clientY - view.y,
        node: e.target.closest('.lnode'),
      };
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.fromX) < SLOP
          && Math.abs(e.clientY - drag.fromY) < SLOP) return;
        drag.moved = true;
        canvas.dataset.dragging = 'true';
      }
      view.x = e.clientX - drag.x;
      view.y = e.clientY - drag.y;
      applyView();
    });

    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const was = drag;
      drag = null;
      delete canvas.dataset.dragging;
      if (was.moved) { rememberView(lastTrack); return; }
      /* A press with no movement. If it started on a box, that is a
         click on the box — handled here rather than with an onclick so
         that a drag which happens to finish over a box never opens it. */
      if (was.node && e.type === 'pointerup' && lastTrack) {
        location.hash = `#/learn/${lastTrack}/${was.node.dataset.concept}`;
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* ---- the wheel ----

       Ctrl+wheel zooms about the pointer; a trackpad pinch arrives as
       exactly that, so pinch-to-zoom works without any gesture code.
       Plain wheel pans. Neither reaches the page, because the page
       behind this does not scroll — the graph has the window. */
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const box = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0025);
        zoomAt(view.z * factor, e.clientX - box.left, e.clientY - box.top);
      } else {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
        applyView();
      }
      rememberView(lastTrack);
    }, { passive: false });

    nodes.addEventListener('keydown', e => {
      const btn = e.target.closest('.lnode');
      if (!btn) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (lastTrack) location.hash = `#/learn/${lastTrack}/${btn.dataset.concept}`;
        return;
      }
      const next = neighbour(btn.dataset.concept, e.key);
      if (!next) return;
      e.preventDefault();
      focusNode(next.id);
      rememberView(lastTrack);
    });

    /* ---- the panel's left edge ---- */
    const grip = $('#learnGrip');
    if (grip) {
      let sizing = null;
      grip.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        const panel = $('#learnPanel');
        sizing = { id: e.pointerId, from: e.clientX, w: panel.getBoundingClientRect().width };
        grip.setPointerCapture(e.pointerId);
        canvas.dataset.resizing = 'true';
      });
      grip.addEventListener('pointermove', e => {
        if (!sizing || e.pointerId !== sizing.id) return;
        applyPanelWidth(sizing.w - (e.clientX - sizing.from));
      });
      const endSize = e => {
        if (!sizing || e.pointerId !== sizing.id) return;
        sizing = null;
        delete canvas.dataset.resizing;
        const panel = $('#learnPanel');
        Store.setPref(PANEL_PREF, Math.round(panel.getBoundingClientRect().width));
        if (selectedId) reveal(placed && placed.nodes.find(n => n.id === selectedId));
      };
      grip.addEventListener('pointerup', endSize);
      grip.addEventListener('pointercancel', endSize);
      /* A drag handle a keyboard cannot move is a drag handle half the
         readers do not have. */
      grip.addEventListener('keydown', e => {
        const step = e.shiftKey ? 48 : 16;
        const panel = $('#learnPanel');
        const now = panel.getBoundingClientRect().width;
        if (e.key === 'ArrowLeft') Store.setPref(PANEL_PREF, applyPanelWidth(now + step));
        else if (e.key === 'ArrowRight') Store.setPref(PANEL_PREF, applyPanelWidth(now - step));
        else return;
        e.preventDefault();
      });
    }

    /* The window changing size changes what "the middle" is, and a panel
       wider than the canvas is a panel with no canvas. */
    window.addEventListener('resize', () => {
      if (!document.body.dataset.graph) return;
      applyPanelWidth(Store.pref(PANEL_PREF, 420));
    });
  }

  /* ---------------- the node panel ---------------- */

  /* How hard it felt, which is the reader's own figure from the problem
     page rather than a guess at it. */
  const FELT = ['Easy', 'Fine', 'Work', 'Hard', 'Brutal'];

  function drawNode(tree, n) {
    const host = $('#learnPanel');
    const body = $('#learnPanelBody');
    if (!host || !body) return;

    /* The canvas is told, so the zoom buttons and the hint can move out
       from under the panel. They sit in the bottom corners of the
       canvas, and the panel covers one of them. */
    const canvas = $('#learnCanvas');

    if (!n) {
      host.hidden = true;
      body.replaceChildren();
      if (canvas) delete canvas.dataset.panel;
      return;
    }
    host.hidden = false;
    if (canvas) canvas.dataset.panel = 'open';

    const topic = Store.TOPIC_BY_ID[n.topic];
    const p = nodeProgress(n);
    const own = new Set(tree.track.problems || []);

    /* Three lists, not two. "Questions" used to hold the coding
       exercises as well, and "resources" sat above them looking like a
       third kind of the same thing. They are different work: a reading
       is something you tick for yourself, a question is graded, and a
       coding exercise is compiled and run. */
    const required = n.problems.filter(pr => own.has(pr.id));
    const related = n.problems.filter(pr => !own.has(pr.id));
    const questions = required.filter(pr => pr.type !== 'code');
    const coding = required.filter(pr => pr.type === 'code');

    const unsolved = pr => {
      const st = Store.record(pr.id).status;
      return st !== 'solved' && st !== 'reviewed';
    };
    /* The next thing to actually do here: a required exercise that is
       not solved, preferring one already started. Offered only when
       there is one — a button that says "Practise" and goes nowhere
       useful is worse than no button. */
    const next = required.find(pr => Store.record(pr.id).status === 'attempted')
      || required.find(unsolved)
      || related.find(unsolved)
      || null;

    const parts = [
      el('div', { class: 'lpanel-head' }, [
        el('h2', { text: n.name }),
        el('button', {
          class: 'lpanel-close', type: 'button', 'aria-label': 'Close',
          onclick: () => { location.hash = `#/learn/${tree.track.id}`; },
        }, ['×']),
      ]),
      topic ? el('a', {
        class: 'chip-link tiny', href: `#/problems?topic=${n.topic}`, text: topic.label,
      }) : null,
      n.oneLine ? el('p', { class: 'muted small', html: MD.renderInline(n.oneLine) }) : null,
    ];

    if (next) {
      parts.push(el('div', { class: 'lpanel-next' }, [
        el('a', {
          class: 'btn btn-sm btn-primary', href: `#/p/${next.id}`,
        }, [Store.record(next.id).status === 'attempted' ? 'Carry on' : 'Practise this']),
        el('span', { class: 'tiny faint', text: next.title }),
      ]));
    } else if (required.length) {
      parts.push(el('p', { class: 'tiny', style: 'color:var(--ok)' },
        ['Everything this track asks of this concept is solved.']));
    }

    if (n.alsoNeeds.length) {
      parts.push(el('p', { class: 'tiny faint' }, [
        'Also rests on ',
        ...n.alsoNeeds.flatMap((a, i) => [
          i ? ', ' : '',
          el('a', { href: `#/learn/${tree.track.id}/${a.id}`, text: a.name }),
        ]),
        '.',
      ]));
    }

    /* ---- readings ---- */

    parts.push(el('div', { class: 'lpanel-sub' }, [
      el('span', { text: 'Resources' }),
      el('span', { text: `${p.read.read}/${p.read.total}` }),
    ]));
    /* Said once, where the ticks are. A tick is a note to yourself that
       you read the thing; nothing checked it and nothing counts it
       towards the track. */
    parts.push(el('p', { class: 'tiny faint lpanel-note' },
      ['Ticking one is a note to yourself. It is not counted towards the track.']));

    if (!n.readings.length) {
      parts.push(el('p', { class: 'tiny faint', text: 'Nothing listed for this one yet.' }));
    } else {
      parts.push(el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Tag' }), el('th', { text: 'Resource' }),
          el('th', { text: 'Section' }), el('th', { text: 'Read' }),
        ])]),
        el('tbody', {}, n.readings.map((rd, i) => el('tr', {}, [
          el('td', {}, [rd.kind ? el('span', { class: 'kind', text: rd.kind }) : null]),
          el('td', {}, [rd.url
            ? el('a', {
              href: MD.safeHref(rd.url), target: '_blank',
              rel: 'noopener noreferrer', text: rd.title,
            })
            : el('span', { text: rd.title })]),
          el('td', { class: 'tiny faint', text: rd.where || '' }),
          el('td', {}, [el('input', {
            type: 'checkbox', checked: Store.hasRead(n.id, i) || undefined,
            'aria-label': `Read: ${rd.title}`,
            onchange: e => {
              for (const a of Store.markReading(n.id, i, e.target.checked)) {
                toast(`Unlocked: ${a.label}`, 'good');
              }
              renderLearn(tree.track.id, n.id);
              refreshPurse();
            },
          })]),
        ]))),
      ]));
    }

    /* ---- the work, in three named lists ---- */

    const problemTable = rows => el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Name' }), el('th', { text: 'Difficulty' }),
        el('th', { text: 'Felt' }),
      ])]),
      el('tbody', {}, rows.map(pr => {
        const r = Store.record(pr.id);
        const diff = Store.DIFF_BY_ID[pr.difficulty];
        return el('tr', { 'data-status': r.status }, [
          el('td', {}, [el('a', { href: `#/p/${pr.id}`, text: pr.title })]),
          el('td', {}, [el('span', {
            class: `diff diff-${pr.difficulty}`, text: (diff || {}).label || '',
          })]),
          el('td', { class: 'tiny faint', text: r.perceived ? FELT[r.perceived - 1] : '—' }),
        ]);
      })),
    ]);

    const done = rows => rows.filter(pr => !unsolved(pr)).length;

    const section = (label, rows, why) => {
      if (!rows.length) return;
      parts.push(el('div', { class: 'lpanel-sub', title: why }, [
        el('span', { text: label }),
        el('span', { text: `${done(rows)}/${rows.length}` }),
      ]));
      parts.push(problemTable(rows));
    };

    section('Questions', questions,
      'Required: questions in this track that rest on this concept');
    section('Coding exercises', coding,
      'Required: coding exercises in this track that rest on this concept');
    section('Related practice', related,
      'Rests on this concept but belongs to another track. Worth doing, '
      + 'and not part of finishing this one.');

    if (!n.problems.length) {
      parts.push(el('p', { class: 'tiny faint', text: 'No problem rests on this one yet.' }));
    }

    body.replaceChildren(...parts.filter(Boolean));
    body.scrollTop = 0;
  }

  /* ---------------- tracks ---------------- */

  function renderTracks(trackId) {
    const host = $('#trackList');
    const tracks = Catalog.allTracks();

    const blurb = $('#tracksBlurb');
    if (blurb) {
      blurb.textContent = tracks.length
        ? `${tracks.length} ordered ${tracks.length === 1 ? 'set' : 'sets'} of `
          + 'problems that build on each other, so there is always an '
          + 'obvious next one.'
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

    /* Found relative to the grid rather than by a fixed id: the heatmap
       moved from the dashboard to Profile, and a renderer that knows the
       id of the one page it used to live on moves badly. */
    const wrap = mount.closest('.heat-wrap');
    const card = mount.closest('.card') || (wrap && wrap.parentElement);

    const months = wrap && wrap.querySelector('.heat-months');
    if (months) {
      months.style.gridTemplateColumns = `repeat(${HEAT_WEEKS}, var(--heat-cell))`;
      months.replaceChildren(...labels);
    }

    const caption = card && card.querySelector('.heat-caption');
    if (caption) {
      caption.textContent = solved
        ? `${solved} solved over ${HEAT_WEEKS} weeks, on ${activeDays} `
          + `${activeDays === 1 ? 'day' : 'different days'}.`
        : `Nothing solved in the last ${HEAT_WEEKS} weeks. A square is a day you solved something.`;
    }
  }

  /* ---------------- catalog ---------------- */

  let filter = {
    q: '', subject: '', kind: '', topic: '', difficulty: '', type: '',
    status: '', lane: '', lang: '',
  };

  /* ---------------- subject ----------------

     Subject used to be a switch in the top bar: a lens over the whole site
     that hid half the catalogue, half the tracks and half the reading map.
     It is a filter now, next to topic and difficulty, so the default view
     is everything and nothing has to be switched to be found. Progress,
     bookmarks and the weekly problem were always shared and still are. */

  function fillFilterOptions() {
    const subj = $('#fSubject');
    if (subj && subj.options.length === 1) {
      for (const sub of Store.SUBJECTS) {
        subj.append(el('option', { value: sub.id, text: sub.label, title: sub.blurb }));
      }
    }

    /* Topics are grouped under their subject rather than filtered by it.
       The whole list is short enough to read at once, and a group label
       says which half of the site a topic belongs to without anyone
       having to select a subject first to find out. */
    const topic = $('#fTopic');
    const want = filter.subject || '';
    if (topic.dataset.subject !== want) {
      topic.dataset.subject = want;
      topic.replaceChildren(el('option', { value: '', text: 'All topics' }));
      for (const sub of Store.SUBJECTS) {
        if (want && sub.id !== want) continue;
        const list = Store.topicsIn(sub.id);
        if (!list.length) continue;
        /* No group wrapper when only one subject is in play: a single
           heading above a list that is already all one thing is noise. */
        const into = want ? topic : el('optgroup', { label: sub.label });
        for (const t of list) into.append(el('option', { value: t.id, text: t.label }));
        if (!want) topic.append(into);
      }
      topic.value = filter.topic || '';
    }
    if ($('#fDiff').options.length === 1) {
      for (const d of Store.DIFFICULTIES) $('#fDiff').append(el('option', { value: d.id, text: d.label }));
      for (const t of Catalog.TYPES) $('#fType').append(el('option', { value: t.id, text: t.label }));
      for (const l of Store.LANES) $('#fLane').append(el('option', { value: l.id, text: l.label }));
    }
    /* Only the languages some problem actually declares, with how many
       declare it. An option that matches nothing is a dead end, and the
       count is what tells you that C++ is most of the coding exercises
       before you select it and find out. */
    const langSel = $('#fLang');
    if (langSel && langSel.options.length === 1) {
      const counts = new Map();
      for (const p of Catalog.all()) {
        for (const id of (p.langs || [])) counts.set(id, (counts.get(id) || 0) + 1);
      }
      for (const id of Catalog.LANGS) {
        const n = counts.get(id) || 0;
        if (!n) continue;
        langSel.append(el('option', {
          value: id,
          text: `${Catalog.LANG_LABEL[id] || id} (${n})`,
          title: `${n} ${n === 1 ? 'problem' : 'problems'} can be solved in `
            + `${Catalog.LANG_LABEL[id] || id}`,
        }));
      }
      /* Set it again now the options exist. setFilter runs from the route
         before this does, and assigning a value a <select> has no option
         for is silently dropped — so landing on #/problems?lang=python
         filtered the list correctly and left the control reading "Any
         language", which is the control disagreeing with the page. */
      langSel.value = filter.lang || '';
    }
  }

  function setFilter(patch, { silent = false } = {}) {
    filter = { ...filter, ...patch };
    /* Choosing a subject drops a topic from the other one, which would
       otherwise filter to nothing and look broken. */
    if (patch.subject !== undefined && filter.topic
        && (Store.TOPIC_BY_ID[filter.topic] || {}).subject !== filter.subject
        && filter.subject) {
      filter.topic = '';
    }
    $('#fSearch').value = filter.q;
    $('#fSubject').value = filter.subject;
    $('#fKind').value = filter.kind;
    $('#fTopic').value  = filter.topic;
    $('#fDiff').value   = filter.difficulty;
    $('#fType').value   = filter.type;
    $('#fStatus').value = filter.status;
    $('#fLane').value   = filter.lane;
    if ($('#fLang')) $('#fLang').value = filter.lang;
    if (!silent) renderCatalog();
  }

  /* ---------------- the rail beside the catalogue ----------------

     The weekly problem and anything due for revision. Both used to be on
     the dashboard, which was the only place they would ever be noticed —
     and the dashboard was the page you left fastest. They belong next to
     the list of problems, because they are problems. */

  function renderRail() {
    const host = $('#catalogRail');
    if (!host) return;

    const parts = [];

    /* Carrying on where you left off used to be the first thing on the
       landing page. That page is now an introduction, and this is where
       somebody looking for a problem looks, so it came here rather than
       being deleted along with the doors. */
    const carry = continueCard();
    if (carry) {
      parts.push(el('h2', { class: 'rail-head', text: 'Carry on' }));
      parts.push(carry);
    }

    const weekly = weeklyCard();
    if (weekly) {
      parts.push(el('h2', { class: 'rail-head', text: 'This week' }));
      parts.push(weekly);
    }

    const due = Store.dueForReview();
    if (due.length) {
      const metas = due.slice(0, 5).map(r => Catalog.meta(r.id)).filter(Boolean);
      if (metas.length) {
        parts.push(el('h2', { class: 'rail-head', text: 'Worth revisiting' }));
        parts.push(el('div', { class: 'rail-list' }, metas.map(m => el('a', {
          class: 'rail-row', href: `#/p/${m.id}`,
        }, [
          el('span', { class: 'rail-row-title', text: m.title }),
          el('span', { class: 'tiny faint', text: Store.DIFF_BY_ID[m.difficulty]?.label || '' }),
        ]))));
      }
    }

    host.replaceChildren(...parts);
    host.hidden = !parts.length;
  }

  function renderCatalog() {
    fillFilterOptions();
    renderRail();
    const searching = !!String(filter.q || '').trim();
    const rows = Catalog.sorted(Catalog.list(filter));
    const total = Catalog.all().length;

    /* Searching deliberately ignores the subject filter — looking for
       "bayes" with Systems selected should find it rather than returning
       nothing — so when it does, the count says so. */
    const label = filter.subject ? Store.SUBJECT_BY_ID[filter.subject].label : '';
    const inPool = p => (!filter.subject || p.subject === filter.subject)
      && (!filter.kind
        || (filter.kind === 'code' ? p.type === 'code' : p.type !== 'code'))
      && (!filter.lang || (p.langs || []).includes(filter.lang));
    const pool = (filter.subject || filter.kind || filter.lang)
      ? Catalog.all().filter(inPool).length
      : total;
    /* A noun, not an adjective: "72 question problems" is not English. */
    const noun = (filter.kind === 'code' || filter.lang) ? 'coding exercises'
      : filter.kind === 'questions' ? 'questions' : 'problems';
    $('#catalogCount').textContent = searching
      ? `${rows.length} of ${total} problems, searching every subject`
      : rows.length === pool
        ? `${pool}${label ? ` ${label}` : ''} ${noun}`
        : `${rows.length} of ${pool}${label ? ` ${label}` : ''} ${noun}`;

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
      const lang = filter.lang ? (Catalog.LANG_LABEL[filter.lang] || filter.lang) : '';
      list.replaceChildren(el('div', { class: 'empty' }, [
        el('h2', { text: 'Nothing matches that' }),
        el('p', {
          class: 'muted',
          text: lang
            ? `No problem with the other filters you have set can be solved in `
              + `${lang}. Whether a problem offers a language is a property of `
              + `the exercise, not of what is installed.`
            : 'Try clearing a filter, or widen the search.',
        }),
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: () => setFilter({
            q: '', topic: '', difficulty: '', type: '', status: '', lane: '', lang: '',
          }),
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
    $('#fSubject').addEventListener('change', e => setFilter({ subject: e.target.value }));
    $('#fKind').addEventListener('change',   e => setFilter({ kind: e.target.value }));
    $('#fTopic').addEventListener('change',  e => setFilter({ topic: e.target.value }));
    $('#fDiff').addEventListener('change',   e => setFilter({ difficulty: e.target.value }));
    $('#fType').addEventListener('change',   e => setFilter({ type: e.target.value }));
    $('#fStatus').addEventListener('change', e => setFilter({ status: e.target.value }));
    $('#fLane').addEventListener('change',   e => setFilter({ lane: e.target.value }));
    if ($('#fLang')) {
      $('#fLang').addEventListener('change', e => setFilter({ lang: e.target.value }));
    }
    $('#fClear').addEventListener('click', () => setFilter({
      q: '', subject: '', kind: '', topic: '', difficulty: '', type: '',
      status: '', lane: '', lang: '',
    }));
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

    $('#profRankName').textContent = st.rank.current.label;
    $('#profRankNext').textContent = st.rank.next
      ? `${st.rank.into} / ${st.rank.span} to ${st.rank.next.label}`
      : 'top rank';
    $('#profRankBar').style.width = `${Math.round(st.rank.fraction * 100)}%`;
    $('#profStreakLine').textContent = st.streak.current
      ? `${st.streak.current}-day streak · longest ${st.streak.longest}`
      : 'No streak yet — solve something today to start one.';

    renderHeat($('#profHeat'), st.days);

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
        el('span', { class: 'tp-brand', text: 'Invariant' }),
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
          el('span', { class: 'tp-btn', text: 'Run tests' }),
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

  /* The completion controls. Rebuilt rather than patched, because the
     per-language boxes are disabled as a group when the master is off and
     keeping two sources of truth for that is how one of them goes stale. */
  function paintCompletion() {
    const master = $('#setComplete');
    const host = $('#setCompleteLangs');
    if (!master || !host) return;

    const pref = Store.completionPref();
    master.checked = pref.on;

    host.replaceChildren(
      el('legend', { class: 'tiny faint', text: 'For which languages' }),
      ...Store.COMPLETION_LANGS.map(id => {
        const box = el('input', {
          type: 'checkbox', checked: pref.langs[id] || undefined,
          disabled: !pref.on || undefined,
          onchange: e => {
            Store.setCompletion({ langs: { [id]: e.target.checked } });
            paintCompletion();
          },
        });
        return el('label', { class: 'check' }, [box, el('span', { text: LANG_LABEL[id] || id })]);
      }),
    );
  }

  function renderSettings() {
    $('#setName').value = Store.state.profile.name || '';
    paintCompletion();
    $('#setJudge').value = Store.config.judgeUrl || '';
    const tok = $('#setJudgeToken');
    if (tok) tok.value = Store.config.judgeToken || '';

    /* What runs where, from the catalogue rather than from a sentence that
       goes stale when a language is added to a problem. */
    const summary = $('#execSummary');
    if (summary) {
      const local = new Set();
      const remote = new Set();
      for (const p of Catalog.all()) {
        if (p.type !== 'code') continue;
        for (const l of p.langs || []) (LOCAL_LANGS.has(l) ? local : remote).add(l);
      }
      const name = l => LANG_LABEL[l] || l;
      summary.textContent =
        `${[...local].map(name).join(' and ') || 'Nothing'} runs in this browser and needs nothing. `
        + `${[...remote].map(name).join(' and ') || 'Nothing else'} has to be compiled, which `
        + 'means either a hosted runner or one you start on this machine.';
    }

    const hosted = $('#setHosted');
    if (hosted) hosted.value = (Store.config.hosted || {}).url || '';

    paintJudgeState(Runners.judge);
    paintHostedState();
  }

  /* The hosted runner, painted from whatever the last probe said. It is a
     separate line from the local runner on purpose: "something can run C++"
     and "your own machine can run C++" are different facts, and conflating
     them is how a page ends up quietly talking to localhost. */
  function paintHostedState(probe) {
    const box = $('#hostedState');
    const text = $('#hostedStateText');
    if (!box || !text) return;

    const url = (Store.config.hosted || {}).url || '';
    if (!url) {
      box.dataset.state = 'unchecked';
      box.dataset.up = 'false';
      text.textContent = 'Not configured — compiled languages need a local runner.';
      return;
    }

    const h = probe || (typeof Hosted !== 'undefined' ? Hosted.state : null);
    if (!h || !h.checked) {
      box.dataset.state = 'unchecked';
      box.dataset.up = 'false';
      text.textContent = `Configured at ${url}. Not checked yet.`;
      return;
    }
    if (h.up) {
      box.dataset.state = 'ready';
      box.dataset.up = 'true';
      text.textContent = `Ready at ${url} — ${(h.languages || []).join(', ') || 'no languages reported'}`;
      return;
    }
    box.dataset.state = 'down';
    box.dataset.up = 'false';
    text.textContent = `Not answering at ${url}${h.error ? ` (${h.error})` : ''}.`;
  }

  const LOCAL_LANGS = new Set(['js', 'python']);
  const LANG_LABEL = { js: 'JavaScript', python: 'Python', cpp: 'C++', rust: 'Rust' };

  /* Four states, each with its own next step. Collapsing "not checked" into
     "not reachable" is the thing that makes a page feel like it is lying:
     nothing has been tried yet, so nothing has failed. */
  const JUDGE_STATE = {
    unchecked: {
      text: 'Not checked yet.',
      advice: 'Press Check connection. Nothing has been tried, so nothing has failed.',
      tone: 'muted',
    },
    checking: { text: 'Checking…', advice: '', tone: 'muted' },
    down: {
      text: 'Nothing is listening.',
      advice: 'Start it with the command below, then check again. C++ and Rust problems '
            + 'will say so rather than failing on submit; everything else works regardless.',
      tone: 'bad',
    },
    unauthed: {
      text: 'Running, but it refused this page.',
      advice: 'The runner is up and the token did not match. It writes a fresh one on every '
            + 'start, so the usual fix is to reload this page; if the site is not served from '
            + 'the repository folder, paste the token under Advanced setup.',
      tone: 'warn',
    },
    ready: { text: 'Ready.', advice: '', tone: 'good' },
  };

  function paintJudgeState(judge) {
    const box = $('#judgeState');
    const text = $('#judgeStateText');
    const advice = $('#judgeAdvice');
    if (!box || !text) return;

    const state = (judge && judge.checked) ? judge.state : 'unchecked';
    const spec = JUDGE_STATE[state] || JUDGE_STATE.unchecked;

    box.dataset.state = state;
    /* Kept in step for any stylesheet or test still keying off data-up. */
    box.dataset.up = String(state === 'ready');

    let line = spec.text;
    let note = spec.advice;

    if (state === 'ready') {
      const names = (judge.languages || []).map(l => `${LANG_LABEL[l.id] || l.id} ${l.version || ''}`.trim());
      line = `Ready at ${judge.url} — ${names.join(', ') || 'no languages reported'}`;
      if ((judge.missing || []).length) {
        note = `Not installed on the runner: ${judge.missing.join(', ')}. `
             + 'Problems offering only those will say so.';
      }
    } else if (state === 'down') {
      line = `Nothing is listening at ${judge.url}${judge.error ? ` (${judge.error})` : ''}.`;
      /* Measured against the published site: Chrome now gates a request from
         an https page to a loopback address behind a Local Network Access
         permission, and a denied one looks exactly like nothing listening.
         Worth saying, because the usual advice — "start the runner" — is
         useless when the runner is already running. */
      if (location.protocol === 'https:' && /127\.0\.0\.1|\[::1\]|localhost/.test(judge.url)) {
        note = 'If it *is* running, your browser may be blocking this page from '
             + 'reaching your own machine: recent Chrome asks permission before an '
             + 'https page may touch a local address. Allow it when prompted, or '
             + 'open the site from http://127.0.0.1:8000 instead. Hosted execution '
             + 'is not affected.';
      }
    } else if (state === 'unauthed') {
      line = `Running at ${judge.url}, but it refused this page${judge.error ? ` (${judge.error})` : ''}.`;
    }

    text.textContent = line;
    if (advice) {
      advice.textContent = note;
      advice.className = `small ${spec.tone === 'bad' ? 'danger-text' : spec.tone === 'warn' ? 'warn-text' : 'faint'}`;
      advice.hidden = !note;
    }
  }

  function wireSettings() {
    $('#setComplete').addEventListener('change', e => {
      Store.setCompletion({ on: e.target.checked });
      paintCompletion();
      toast(e.target.checked
        ? 'Completions on. Open a problem to see them.'
        : 'Completions off. Ctrl+Space still asks for one.', 'info');
    });

    $('#setName').addEventListener('input', e => {
      Store.state.profile.name = e.target.value.slice(0, 40);
      Store.save();
    });

    $('#setJudge').addEventListener('change', e => {
      Store.setJudgeUrl(e.target.value);
      toast('Judge address saved.', 'info');
    });

    $('#judgeCheck').addEventListener('click', checkJudge);

    const hostedInput = $('#setHosted');
    if (hostedInput) {
      hostedInput.addEventListener('change', e => {
        const url = Store.setHostedUrl(e.target.value);
        toast(url ? 'Hosted runner address saved.' : 'Hosted runner turned off.', 'info');
        paintHostedState();
      });
    }

    const hostedBtn = $('#hostedCheck');
    if (hostedBtn) {
      hostedBtn.addEventListener('click', async () => {
        if (!(Store.config.hosted || {}).url) { paintHostedState(); return; }
        const box = $('#hostedState');
        const text = $('#hostedStateText');
        if (box) box.dataset.state = 'checking';
        if (text) text.textContent = 'Checking…';
        hostedBtn.disabled = true;
        try {
          paintHostedState(await Hosted.check({ force: true }));
        } finally {
          hostedBtn.disabled = false;
        }
      });
    }

    const tokenInput = $('#setJudgeToken');
    if (tokenInput) {
      tokenInput.addEventListener('change', e => {
        Store.setJudgeToken(e.target.value.trim());
        toast(e.target.value.trim() ? 'Token saved.' : 'Token cleared.', 'info');
      });
    }

    const copy = $('#judgeCopy');
    if (copy) {
      copy.addEventListener('click', async () => {
        const cmd = ($('#judgeCmd') || {}).textContent || 'npm run runner';
        try {
          await navigator.clipboard.writeText(cmd);
          toast('Copied.', 'good');
        } catch {
          /* No clipboard permission, or an insecure context. Select it instead
             so there is still a way to get the text out. */
          const node = $('#judgeCmd');
          if (node && window.getSelection) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
          toast('Could not reach the clipboard — the command is selected instead.', 'info');
        }
      });
    }

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

  /* Asking the runner, through the same code path a submission uses, so what
     Settings reports and what the editor does cannot disagree. */
  async function checkJudge() {
    paintJudgeState({ checked: true, state: 'checking', url: Store.config.judgeUrl });
    const judge = await Runners.checkJudge({ force: true });
    paintJudgeState(judge);
    return judge.state === 'ready';
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
    wireMe();
    wireContent();
    renderContentMenu();
    wireCanvas();
    wireCatalog();
    wireConcepts();
    wireShop();
    wireSettings();
  }

  return {
    toast, refreshPurse, applyCosmetics, wire, endPreview,
    renderHome, renderCatalog, renderConcepts, renderProfile, renderShop, renderSettings,
    paintMe, closeMe, renderContentMenu, markNav, closeContent,
    renderTracks, renderLearn, renderResources, problemList, leaveGraph,
    setFilter, checkJudge, paintJudgeState,
  };
})();
