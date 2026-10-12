/* ============================================================
   learn/layout.js — where each concept sits on the canvas.

   Pure arithmetic: a tree in, coordinates out. No DOM, so it
   can be driven straight from tests/learn-layout.test.mjs
   without starting a browser, which is the only reason the
   crossing-reduction and the edge routing below are checkable
   at all.

   ---------------- the shape it produces ----------------

   Top down, one rank per prerequisite depth: everything in
   rank 2 rests on something in rank 1 or earlier. That is the
   whole claim the picture makes, and it is the one the tests
   check.

   It used to run left to right, which is the same claim turned
   on its side. A box is 208 wide and 60 tall, so left-to-right
   spent the short axis on the thing that grows — a rank of
   fifteen concepts was fifteen boxes tall and three columns
   wide — and the reader scrolled down a column to find what
   the next one rested on. Top down puts the growth along the
   axis the boxes are already wide on, and puts a parent
   directly above its children, which is what everybody means
   by a tree.

   Within a rank the order is chosen to keep the edges from
   crossing more than they must — the usual barycentre sweep,
   two passes down and two back. It is a heuristic, not an
   optimum; a DAG layout that minimises crossings exactly is
   NP-hard and nobody needs it for twenty-two boxes.

   Each rank is then centred against the widest one, so a
   parent sits over the middle of its children rather than
   flush left of them.

   ---------------- edges that go round, not through ----------

   A prerequisite two or more ranks up used to be drawn as one
   line straight down, which took it behind every box in the
   way. A line entering the top of a box and leaving the bottom
   is a line claiming a connection that is not there, and the
   reader has no way to tell it apart from one that is.

   So an edge spanning more than one rank is broken at every
   rank it crosses, and each break is a point in that rank's
   own order — a lane two pixels wide that the boxes are laid
   out around. The usual trick, and the reason the picture can
   be trusted: every line you can see goes from the bottom of
   one box to the top of another and touches nothing else.

   ---------------- what it is not ----------------

   It is not a tree layout, because the graph is not a tree:
   twelve of the hundred and fifteen concepts rest on more than
   one thing. Every prerequisite edge is drawn, including the
   ones that make it a DAG, so a node with two parents has two
   lines going into it rather than one line and a footnote.
   ============================================================ */

const LearnLayout = (() => {

  /* Box metrics. The canvas is drawn at these and then scaled as a
     whole, so zooming never reflows the text. */
  const NODE_W = 208;
  const NODE_H = 60;
  /* Between two boxes side by side in the same rank, and between one
     rank and the next. The vertical gap is the larger of the two
     because that is where the edges are, and an edge with no room to
     bend in reads as a line through a box rather than into it. */
  const X_GAP = 28;
  const Y_GAP = 76;
  const PAD = 40;
  /* A lane for an edge passing through a rank. Wide enough to be a
     place, narrow enough that a track with long edges in it does not
     become mostly empty. */
  const LANE_W = 2;
  const ROUND = 12;

  const rowY = rank => PAD + rank * (NODE_H + Y_GAP);

  /* Every node in the tree, once, with the edges that reach it.

     `children` in the tree is the single parent each node was hung
     under; `alsoNeeds` is every other prerequisite. The picture wants
     both, or it would be claiming a node rests on less than it does. */
  function flatten(tree) {
    const byId = new Map();
    const edges = [];

    (function walk(nodes, parent) {
      for (const n of nodes) {
        if (!byId.has(n.id)) byId.set(n.id, n);
        if (parent) edges.push({ from: parent.id, to: n.id });
        walk(n.children || [], n);
      }
    })(tree.roots || [], null);

    for (const n of byId.values()) {
      for (const also of n.alsoNeeds || []) {
        if (byId.has(also.id)) edges.push({ from: also.id, to: n.id, extra: true });
      }
    }

    /* A duplicate edge would be drawn twice at the same coordinates and
       look like one thicker line, which is a lie about the data. */
    const seen = new Set();
    const unique = edges.filter(e => {
      const key = `${e.from}>${e.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { nodes: [...byId.values()], edges: unique };
  }

  /* Two sweeps each way. More than that stops changing anything at
     these sizes, and fewer leaves obvious crossings in the maths
     tracks. */
  const SWEEPS = 2;

  function order(ranks, links) {
    const parentsOf = new Map();
    const childrenOf = new Map();
    for (const e of links) {
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
      childrenOf.get(e.from).push(e.to);
      if (!parentsOf.has(e.to)) parentsOf.set(e.to, []);
      parentsOf.get(e.to).push(e.from);
    }

    const placeOf = new Map();
    const index = () => {
      placeOf.clear();
      for (const rank of ranks) rank.forEach((n, i) => placeOf.set(n.id, i));
    };
    index();

    /* The mean position of whatever a node is attached to in the rank
       being swept from. A node attached to nothing keeps its place,
       which is what Infinity would not do. */
    const barycentre = (id, neighbours) => {
      const at = (neighbours.get(id) || [])
        .map(other => placeOf.get(other))
        .filter(r => r !== undefined);
      return at.length ? at.reduce((a, b) => a + b, 0) / at.length : placeOf.get(id);
    };

    for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
      for (let c = 1; c < ranks.length; c += 1) {
        ranks[c].sort((a, b) => barycentre(a.id, parentsOf) - barycentre(b.id, parentsOf));
        index();
      }
      for (let c = ranks.length - 2; c >= 0; c -= 1) {
        ranks[c].sort((a, b) => barycentre(a.id, childrenOf) - barycentre(b.id, childrenOf));
        index();
      }
    }
  }

  /* A polyline with its corners rounded off. The points alternate
     vertical and horizontal, so every corner is a right angle and the
     radius is just clamped to half the shorter of the two legs. */
  function roundedPath(points, r = ROUND) {
    const p = points.filter((q, i) => i === 0
      || q[0] !== points[i - 1][0] || q[1] !== points[i - 1][1]);
    if (p.length < 2) return '';

    const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const towards = (from, to, d) => {
      const l = len(from, to) || 1;
      return [from[0] + ((to[0] - from[0]) * d) / l, from[1] + ((to[1] - from[1]) * d) / l];
    };
    const n = v => Math.round(v * 10) / 10;

    let d = `M ${n(p[0][0])} ${n(p[0][1])}`;
    for (let i = 1; i < p.length - 1; i += 1) {
      const a = p[i - 1];
      const b = p[i];
      const c = p[i + 1];
      const rad = Math.min(r, len(a, b) / 2, len(b, c) / 2);
      const t1 = towards(b, a, rad);
      const t2 = towards(b, c, rad);
      d += ` L ${n(t1[0])} ${n(t1[1])} Q ${n(b[0])} ${n(b[1])} ${n(t2[0])} ${n(t2[1])}`;
    }
    const last = p[p.length - 1];
    return `${d} L ${n(last[0])} ${n(last[1])}`;
  }

  function layout(tree) {
    if (!tree || !(tree.roots || []).length) {
      return { nodes: [], edges: [], width: 0, height: 0, ranks: 0 };
    }

    const { nodes, edges } = flatten(tree);

    const depth = n => Math.max(0, Number(n.depth) || 0);
    const rankOf = new Map(nodes.map(n => [n.id, depth(n)]));
    const deepest = nodes.reduce((m, n) => Math.max(m, depth(n)), 0);

    const ranks = [];
    for (let c = 0; c <= deepest; c += 1) ranks.push([]);
    /* Sorted by name first, so the starting order is stable and two runs
       over the same data give the same picture. */
    for (const n of [...nodes].sort((a, b) => a.name.localeCompare(b.name))) {
      ranks[depth(n)].push({ id: n.id, node: n, w: NODE_W });
    }

    /* Break every long edge at the ranks it crosses. The breaks are
       entries in those ranks like any other, so the boxes are laid out
       around them rather than over them. */
    const links = [];
    const laneIds = new Map();
    for (const e of edges) {
      const a = rankOf.get(e.from);
      const b = rankOf.get(e.to);
      if (b - a <= 1) { links.push({ from: e.from, to: e.to }); continue; }
      const lanes = [];
      for (let r = a + 1; r < b; r += 1) {
        const id = `\u0000lane:${e.from}>${e.to}:${r}`;
        ranks[r].push({ id, lane: true, w: LANE_W });
        lanes.push({ id, rank: r });
      }
      laneIds.set(`${e.from}>${e.to}`, lanes);
      let prev = e.from;
      for (const l of lanes) { links.push({ from: prev, to: l.id }); prev = l.id; }
      links.push({ from: prev, to: e.to });
    }

    order(ranks, links);

    /* Widths vary now — a lane is two pixels and a box is 208 — so a
       rank is laid out with a running cursor rather than an index times
       a pitch, and the widest rank sets the canvas. */
    const rankWidth = rank => rank.reduce((w, e, i) => w + e.w + (i ? X_GAP : 0), 0);
    const widest = ranks.reduce((m, rank) => Math.max(m, rankWidth(rank)), 0);
    const width = widest + 2 * PAD;

    const at = new Map();
    ranks.forEach((rank, c) => {
      let x = PAD + Math.round((widest - rankWidth(rank)) / 2);
      for (const entry of rank) {
        at.set(entry.id, { x, y: rowY(c), w: entry.w, rank: c, entry });
        x += entry.w + X_GAP;
      }
    });
    ranks.forEach(rank => rank.forEach((entry, i) => { at.get(entry.id).order = i; }));

    const placed = new Map();
    for (const rank of ranks) {
      for (const entry of rank) {
        if (entry.lane) continue;
        const pos = at.get(entry.id);
        placed.set(entry.id, {
          id: entry.id,
          name: entry.node.name,
          topic: entry.node.topic,
          /* `rank` is how deep it is — which row, counting down from the
             roots — and `order` is where it sits along that row. */
          rank: pos.rank,
          order: pos.order,
          x: pos.x,
          y: pos.y,
          w: NODE_W,
          h: NODE_H,
          node: entry.node,
        });
      }
    }

    /* The waypoints of one edge: out of the bottom of the box, along
       the empty band halfway between each pair of ranks, through
       whatever lanes it was broken at, and into the top of the box it
       arrives at. */
    function route(e) {
      const a = placed.get(e.from);
      const b = placed.get(e.to);
      const x1 = a.x + NODE_W / 2;
      const y1 = a.y + NODE_H;
      const x2 = b.x + NODE_W / 2;
      const y2 = b.y;
      /* The empty strip immediately above rank r. Every horizontal run
         is in one of these, which is the whole reason a line never
         crosses a box. */
      const band = r => rowY(r) - Y_GAP / 2;

      const points = [[x1, y1]];
      let x = x1;
      for (const l of laneIds.get(`${e.from}>${e.to}`) || []) {
        const lx = at.get(l.id).x + LANE_W / 2;
        points.push([x, band(l.rank)]);
        points.push([lx, band(l.rank)]);
        x = lx;
      }
      points.push([x, band(b.rank)]);
      points.push([x2, band(b.rank)]);
      points.push([x2, y2]);
      return points;
    }

    return {
      nodes: [...placed.values()],
      edges: edges.map(e => {
        const points = route(e);
        return { ...e, points, path: roundedPath(points) };
      }),
      width,
      height: rowY(ranks.length - 1) + NODE_H + PAD,
      ranks: ranks.length,
    };
  }

  /* How many edges cross, for the tests. Two edges cross when one goes
     right across the ranks and the other goes left between the same
     pair. */
  function crossings(result) {
    const by = new Map(result.nodes.map(n => [n.id, n]));
    let n = 0;
    const es = result.edges.filter(e => by.has(e.from) && by.has(e.to));
    for (let i = 0; i < es.length; i += 1) {
      for (let j = i + 1; j < es.length; j += 1) {
        const a = es[i];
        const b = es[j];
        const a1 = by.get(a.from);
        const a2 = by.get(a.to);
        const b1 = by.get(b.from);
        const b2 = by.get(b.to);
        if (a1.rank !== b1.rank || a2.rank !== b2.rank) continue;
        if ((a1.order - b1.order) * (a2.order - b2.order) < 0) n += 1;
      }
    }
    return n;
  }

  return {
    layout, flatten, crossings, roundedPath,
    NODE_W, NODE_H, X_GAP, Y_GAP, PAD, LANE_W,
  };
})();
