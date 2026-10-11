/* ============================================================
   learn/layout.js — where each concept sits on the canvas.

   Pure arithmetic: a tree in, coordinates out. No DOM, so it
   can be driven straight from tests/learn-layout.test.mjs
   without starting a browser, which is the only reason the
   crossing-reduction below is checkable at all.

   ---------------- the shape it produces ----------------

   Left to right, one column per prerequisite depth: everything
   in column 2 rests on something in column 1 or earlier. That
   is the whole claim the picture makes, and it is the one the
   tests check.

   Within a column the order is chosen to keep the edges from
   crossing more than they must — the usual barycentre sweep,
   two passes down and two back. It is a heuristic, not an
   optimum; a DAG layout that minimises crossings exactly is
   NP-hard and nobody needs it for twenty-two boxes.

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
  const COL_GAP = 104;
  const ROW_GAP = 22;
  const PAD = 40;

  const colX = col => PAD + col * (NODE_W + COL_GAP);
  const rowY = row => PAD + row * (NODE_H + ROW_GAP);

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

  function order(columns, edges) {
    const parentsOf = new Map();
    const childrenOf = new Map();
    for (const e of edges) {
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
      childrenOf.get(e.from).push(e.to);
      if (!parentsOf.has(e.to)) parentsOf.set(e.to, []);
      parentsOf.get(e.to).push(e.from);
    }

    const rowOf = new Map();
    const index = () => {
      rowOf.clear();
      for (const col of columns) col.forEach((n, i) => rowOf.set(n.id, i));
    };
    index();

    /* The mean row of whatever a node is attached to in the column
       being swept from. A node attached to nothing keeps its place,
       which is what Infinity would not do. */
    const barycentre = (id, neighbours) => {
      const rows = (neighbours.get(id) || [])
        .map(other => rowOf.get(other))
        .filter(r => r !== undefined);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : rowOf.get(id);
    };

    for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
      for (let c = 1; c < columns.length; c += 1) {
        columns[c].sort((a, b) => barycentre(a.id, parentsOf) - barycentre(b.id, parentsOf));
        index();
      }
      for (let c = columns.length - 2; c >= 0; c -= 1) {
        columns[c].sort((a, b) => barycentre(a.id, childrenOf) - barycentre(b.id, childrenOf));
        index();
      }
    }
  }

  /* A cubic with horizontal handles: the line leaves a box sideways and
     arrives sideways, so it reads as a connection rather than as a
     diagonal crossing the picture. */
  function edgePath(a, b) {
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const bend = Math.max(28, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  function layout(tree) {
    if (!tree || !(tree.roots || []).length) {
      return { nodes: [], edges: [], width: 0, height: 0, columns: 0 };
    }

    const { nodes, edges } = flatten(tree);

    const depth = n => Math.max(0, Number(n.depth) || 0);
    const deepest = nodes.reduce((m, n) => Math.max(m, depth(n)), 0);

    const columns = [];
    for (let c = 0; c <= deepest; c += 1) columns.push([]);
    /* Sorted by name first, so the starting order is stable and two runs
       over the same data give the same picture. */
    for (const n of [...nodes].sort((a, b) => a.name.localeCompare(b.name))) {
      columns[depth(n)].push(n);
    }

    order(columns, edges);

    const placed = new Map();
    columns.forEach((col, c) => col.forEach((n, r) => {
      const node = {
        id: n.id,
        name: n.name,
        topic: n.topic,
        col: c,
        row: r,
        x: colX(c),
        y: rowY(r),
        w: NODE_W,
        h: NODE_H,
        node: n,
      };
      placed.set(n.id, node);
    }));

    const tallest = columns.reduce((m, col) => Math.max(m, col.length), 0);

    return {
      nodes: [...placed.values()],
      edges: edges.map(e => ({
        ...e,
        path: edgePath(placed.get(e.from), placed.get(e.to)),
      })),
      width: colX(columns.length - 1) + NODE_W + PAD,
      height: rowY(tallest - 1) + NODE_H + PAD,
      columns: columns.length,
    };
  }

  /* How many edges cross, for the tests. Two edges cross when one goes
     down the columns and the other goes up between the same pair. */
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
        if (a1.col !== b1.col || a2.col !== b2.col) continue;
        if ((a1.row - b1.row) * (a2.row - b2.row) < 0) n += 1;
      }
    }
    return n;
  }

  return { layout, flatten, crossings, NODE_W, NODE_H, COL_GAP, ROW_GAP, PAD };
})();
