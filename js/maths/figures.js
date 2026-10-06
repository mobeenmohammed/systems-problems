/* ============================================================
   maths/figures.js — the few pictures that earn their place.

   A figure is named in the problem file and drawn here, the same
   arrangement as the counterexample validators: a drawing
   instruction in a data file would be either markup passed
   through unescaped or a tiny language nobody asked for.

   Two rules, and the second is the important one.

   Every figure is inline SVG using the theme's own tokens, so
   it repaints with the theme rather than being a dark-mode
   picture on a light page.

   **A picture is not a proof, and every caption here says what
   the picture is.** "The unit balls, drawn to scale" is a
   description. "Therefore the metrics are equivalent" would be
   a claim, and a drawing cannot make one — the inequality in
   the solution does. Illustrations label what they show and
   stop there.
   ============================================================ */

const MathsFigures = (() => {

  const svg = (viewBox, body, { label }) =>
    `<svg class="mfig-svg" viewBox="${viewBox}" role="img" aria-label="${MD.escapeHtml(label)}">`
    + `${body}</svg>`;

  const FIGURES = {

    /* The unit balls of the three standard metrics on R^2, on one pair of
       axes. The point a reader should take: same centre, same radius, three
       different sets — and the containment d_inf >= d_2 >= d_1 is visible as
       one shape sitting inside another. */
    'unit-balls': {
      caption: 'The three unit balls $B((0,0), 1)$ on the same axes: '
        + 'the taxicab ball $d_1 \\le 1$ (diamond), the Euclidean ball $d_2 \\le 1$ (circle), '
        + 'and the maximum ball $d_\\infty \\le 1$ (square). '
        + 'Drawn to scale. The nesting you can see is the statement '
        + '$d_\\infty \\le d_2 \\le d_1$, which is proved in the solution rather than by the picture.',
      draw() {
        const S = 70;        /* pixels per unit */
        const C = 110;       /* centre */
        const ax = `
          <line x1="10" y1="${C}" x2="${2 * C - 10}" y2="${C}" class="mfig-axis"/>
          <line x1="${C}" y1="10" x2="${C}" y2="${2 * C - 10}" class="mfig-axis"/>
          <text x="${2 * C - 14}" y="${C - 8}" class="mfig-tick">x</text>
          <text x="${C + 8}" y="20" class="mfig-tick">y</text>
          <text x="${C + S - 4}" y="${C + 16}" class="mfig-tick">1</text>`;
        const square = `<rect x="${C - S}" y="${C - S}" width="${2 * S}" height="${2 * S}"
          class="mfig-shape mfig-inf"/>`;
        const circle = `<circle cx="${C}" cy="${C}" r="${S}" class="mfig-shape mfig-two"/>`;
        const diamond = `<polygon points="${C},${C - S} ${C + S},${C} ${C},${C + S} ${C - S},${C}"
          class="mfig-shape mfig-one"/>`;
        const key = `
          <g class="mfig-key">
            <rect x="${2 * C + 14}" y="30" width="12" height="12" class="mfig-shape mfig-inf"/>
            <text x="${2 * C + 32}" y="40" class="mfig-label">d∞ ≤ 1</text>
            <circle cx="${2 * C + 20}" cy="62" r="6" class="mfig-shape mfig-two"/>
            <text x="${2 * C + 32}" y="66" class="mfig-label">d₂ ≤ 1</text>
            <polygon points="${2 * C + 20},82 ${2 * C + 26},88 ${2 * C + 20},94 ${2 * C + 14},88"
              class="mfig-shape mfig-one"/>
            <text x="${2 * C + 32}" y="92" class="mfig-label">d₁ ≤ 1</text>
          </g>`;
        return svg(`0 0 ${2 * C + 100} ${2 * C}`, ax + square + circle + diamond + key, {
          label: 'Three unit balls on the same axes: a square for the maximum metric, '
            + 'a circle for the Euclidean metric inside it, and a diamond for the '
            + 'taxicab metric inside that.',
        });
      },
    },

    /* The screening test, as counts rather than as percentages. The whole
       base-rate point is visible as the width of the two branches. */
    'screening-tree': {
      caption: 'The same screening test as counts out of 20,000 people. '
        + 'The two positive boxes are what a positive result could mean. '
        + 'The figure shows the counts; the arithmetic is in the solution.',
      draw() {
        const W = 520;
        const H = 220;
        const node = (x, y, w, text, cls = '') =>
          `<g class="mfig-node ${cls}">`
          + `<rect x="${x}" y="${y}" width="${w}" height="34" rx="4"/>`
          + `<text x="${x + w / 2}" y="${y + 22}" class="mfig-label" text-anchor="middle">${text}</text>`
          + '</g>';
        const line = (x1, y1, x2, y2) =>
          `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="mfig-edge"/>`;

        return svg(`0 0 ${W} ${H}`, [
          node(180, 6, 160, '20,000 screened'),
          line(260, 40, 110, 76), line(260, 40, 410, 76),
          node(30, 76, 160, '100 have it'),
          node(330, 76, 160, '19,900 do not'),
          line(110, 110, 60, 150), line(110, 110, 160, 150),
          line(410, 110, 360, 150), line(410, 110, 460, 150),
          node(5, 150, 110, '99 positive', 'mfig-hit'),
          node(125, 150, 110, '1 negative'),
          node(300, 150, 120, '995 positive', 'mfig-miss'),
          node(430, 150, 85, '18,905 neg.'),
          `<text x="${W / 2}" y="206" class="mfig-label" text-anchor="middle">`
          + '1,094 positives in total — 99 of them real</text>',
        ].join(''), {
          label: 'A tree: 20,000 screened splits into 100 who have the condition and '
            + '19,900 who do not; the first splits into 99 positive and 1 negative, '
            + 'the second into 995 positive and 18,905 negative.',
        });
      },
    },

    /* Open, closed, both and neither, as four intervals on one line. */
    'interval-kinds': {
      caption: 'Four subsets of $\\R$ on the same line. A filled dot is an endpoint '
        + 'that belongs to the set; a hollow one is an endpoint that does not. '
        + 'Which of the four are open and which closed is the question, not the figure.',
      draw() {
        const W = 470;
        const rows = [
          ['(0, 1)', false, false],
          ['[0, 1]', true, true],
          ['[0, 1)', true, false],
          ['(0, 1]', false, true],
        ];
        const x0 = 150;
        const x1 = 380;
        const body = rows.map(([name, lo, hi], i) => {
          const y = 28 + i * 40;
          return `<text x="10" y="${y + 5}" class="mfig-label">${name}</text>`
            + `<line x1="${x0 - 50}" y1="${y}" x2="${x1 + 50}" y2="${y}" class="mfig-axis"/>`
            + `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="mfig-seg"/>`
            + `<circle cx="${x0}" cy="${y}" r="5" class="mfig-dot ${lo ? 'mfig-filled' : ''}"/>`
            + `<circle cx="${x1}" cy="${y}" r="5" class="mfig-dot ${hi ? 'mfig-filled' : ''}"/>`
            + `<text x="${x0 - 4}" y="${y + 20}" class="mfig-tick">0</text>`
            + `<text x="${x1 - 4}" y="${y + 20}" class="mfig-tick">1</text>`;
        }).join('');
        return svg(`0 0 ${W} 180`, body, {
          label: 'Four intervals from 0 to 1 drawn on separate number lines, with '
            + 'filled or hollow dots at each end showing whether the endpoint is included.',
        });
      },
    },
  };

  const has = name => Object.prototype.hasOwnProperty.call(FIGURES, name);

  /* Returns a <figure> element, or null for a name nobody drew. A missing
     figure is not worth breaking a statement over. */
  function node(name) {
    if (!has(name)) return null;
    const f = FIGURES[name];
    const wrap = document.createElement('figure');
    wrap.className = 'mfig';
    wrap.innerHTML = f.draw();
    const cap = document.createElement('figcaption');
    cap.innerHTML = MD.renderInline(f.caption);
    wrap.append(cap);
    return wrap;
  }

  return { has, node, names: () => Object.keys(FIGURES) };
})();
