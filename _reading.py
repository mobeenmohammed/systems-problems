import io

p = 'js/views.js'
s = io.open(p, encoding='utf-8').read()

start = s.index("  function renderConcepts() {")
end = s.index("  /* ---------------- profile ---------------- */")

new = '''  /* The reading map.

     Eleven topics and ninety concepts is too much for one scroll, so this view
     is navigation first: a topic strip with per-topic read counts, a status
     filter, and a running total. Each concept then shows its readings with
     ticks and - the part that makes reading feel like progress rather than
     homework - the exercises that practise it. */

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
            text: `${finished} of ${all.length} concepts finished. Ticking is your own record \\u2014 nothing checks it.`,
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
          + `${solved ? ` \\u00b7 ${solved} solved` : ''}:`,
      }),
      el('span', { class: 'practised-links' }, [
        ...shown.map(p => el('a', {
          href: `#/p/${p.id}`,
          class: `practised-link status-${Store.record(p.id).status}`,
          title: `${(Store.DIFF_BY_ID[p.difficulty] || {}).label || p.difficulty} \\u00b7 ${Store.record(p.id).status}`,
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
          el('a', { class: 'more', href: `#/problems?topic=${topicId}`, text: 'Problems in this topic \\u2192' }),
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
              `needs: ${(c.needs || []).map(n => (Catalog.concept(n) || {}).name || n).join(' \\u00b7 ')}`,
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

'''

s = s[:start] + new + s[end:]

s = s.replace("  let conceptFilter = { q: '', topic: '' };",
              "  let conceptFilter = { q: '', topic: '', read: '' };", 1)

old_wire = "    $('#cTopic').addEventListener('change', e => { conceptFilter.topic = e.target.value; renderConcepts(); });"
new_wire = """    $('#cTopic').addEventListener('change', e => { conceptFilter.topic = e.target.value; renderConcepts(); });
    $('#cRead').addEventListener('change',  e => { conceptFilter.read = e.target.value; renderConcepts(); });
    $('#cClear').addEventListener('click', () => {
      conceptFilter = { q: '', topic: '', read: '' };
      $('#cSearch').value = '';
      $('#cTopic').value = '';
      $('#cRead').value = '';
      renderConcepts();
    });"""
assert old_wire in s
s = s.replace(old_wire, new_wire, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('reading view rewritten')
