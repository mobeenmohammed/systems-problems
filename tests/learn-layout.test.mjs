/* The Learn canvas layout: coordinates, not pixels on a screen.

   The picture makes one claim — everything in a column rests on
   something to its left — and that claim is checkable arithmetic, so it
   is checked here rather than by looking at a screenshot. The real
   tracks are fed through it too, because a layout that works on a
   hand-made fixture and falls over on metric-spaces is no use.

   Run: node tests/learn-layout.test.mjs */

import fs from 'node:fs';
import { loadScripts, section, check, ok, report } from './harness.mjs';

const { grab } = loadScripts(['js/learn/layout.js']);
const L = grab('LearnLayout');

/* A tree in the shape Catalog.trackTree returns. */
const node = (id, depth, children = [], alsoNeeds = []) => ({
  id, name: id, topic: 't', depth, children, alsoNeeds,
  readings: [], problems: [], inTrack: 0,
});

/* ---------------- the shape of the answer ---------------- */

section('an empty track lays out to nothing, rather than throwing');
{
  const r = L.layout({ roots: [] });
  check('no nodes', r.nodes.length, 0);
  check('no edges', r.edges.length, 0);
  check('and no size', r.width, 0);
  const r2 = L.layout(null);
  check('nor does a missing tree', r2.nodes.length, 0);
}

section('one node');
{
  const r = L.layout({ roots: [node('a', 0)] });
  check('is one box', r.nodes.length, 1);
  check('in one rank', r.ranks, 1);
  check('with no edges', r.edges.length, 0);
  ok('the canvas is big enough to hold it',
    r.width >= L.NODE_W && r.height >= L.NODE_H);
}

section('a chain runs top to bottom');
{
  const tree = { roots: [node('a', 0, [node('b', 1, [node('c', 2)])])] };
  const r = L.layout(tree);
  const at = id => r.nodes.find(n => n.id === id);
  check('three boxes', r.nodes.length, 3);
  check('three ranks', r.ranks, 3);
  ok('b is below a', at('b').y > at('a').y);
  ok('c is below b', at('c').y > at('b').y);
  ok('and a chain is one column wide',
    new Set(r.nodes.map(n => n.x)).size === 1);
  check('two edges', r.edges.length, 2);
  ok('each edge is a path', r.edges.every(e => /^M [\d.]+ [\d.]+ [LV]/.test(e.path)));
}

section('siblings sit side by side, they do not overlap');
{
  const tree = { roots: [node('a', 0, [node('b', 1), node('c', 1), node('d', 1)])] };
  const r = L.layout(tree);
  const kids = r.nodes.filter(n => n.id !== 'a').sort((x, y) => x.x - y.x);
  check('all in one rank', new Set(kids.map(k => k.y)).size, 1);
  ok('and none overlaps the next',
    kids.every((k, i) => i === 0 || k.x >= kids[i - 1].x + L.NODE_W));
}

section('a parent sits over the middle of its children');
{
  /* The whole reason for turning the picture: a box above the ones it
     feeds reads as a tree. Flush left, it reads as a list. */
  const tree = { roots: [node('a', 0, [node('b', 1), node('c', 1), node('d', 1)])] };
  const r = L.layout(tree);
  const at = id => r.nodes.find(n => n.id === id);
  const mid = n => n.x + n.w / 2;
  const kids = ['b', 'c', 'd'].map(at);
  const span = (Math.min(...kids.map(mid)) + Math.max(...kids.map(mid))) / 2;
  ok(`a is centred over them (${Math.round(mid(at('a')))} vs ${Math.round(span)})`,
    Math.abs(mid(at('a')) - span) <= 1);
}

section('an edge leaves the bottom of one box and arrives at the top of the next');
{
  /* Straight down, across, straight down. Checked as coordinates rather
     than as a path string, because the claim is about where the line
     is, not how it is spelled. */
  const tree = { roots: [node('a', 0, [node('b', 1), node('c', 1)])] };
  const r = L.layout(tree);
  const at = id => r.nodes.find(n => n.id === id);
  const mid = n => n.x + n.w / 2;

  const toB = r.edges.find(e => e.to === 'b');
  const first = toB.points[0];
  const last = toB.points[toB.points.length - 1];
  check('it starts at the foot of a', first[1], at('a').y + L.NODE_H);
  check('in the middle of it', first[0], mid(at('a')));
  check('and ends at the top of b', last[1], at('b').y);
  check('in the middle of it too', last[0], mid(at('b')));
  ok('every leg is vertical or horizontal',
    toB.points.every((p, i) => i === 0
      || p[0] === toB.points[i - 1][0] || p[1] === toB.points[i - 1][1]));
}

/* ---------------- lines that go round, not through ---------------- */

/* Every horizontal leg must be in the empty band between two ranks,
   and every vertical leg must miss every box it passes. A line behind
   a box is a line claiming a connection that is not there, and nothing
   on screen tells the two apart. */
function throughABox(r) {
  const bad = [];
  for (const e of r.edges) {
    for (let i = 1; i < e.points.length; i += 1) {
      const [ax, ay] = e.points[i - 1];
      const [bx, by] = e.points[i];
      for (const n of r.nodes) {
        /* Its own two ends are allowed to touch their own boxes. */
        if (n.id === e.from || n.id === e.to) continue;
        const x0 = n.x;
        const x1 = n.x + n.w;
        const y0 = n.y;
        const y1 = n.y + n.h;
        const hits = Math.min(ax, bx) < x1 && Math.max(ax, bx) > x0
          && Math.min(ay, by) < y1 && Math.max(ay, by) > y0;
        if (hits) bad.push(`${e.from}->${e.to} crosses ${n.id}`);
      }
    }
  }
  return bad;
}

section('a prerequisite two ranks up is routed round the boxes between');
{
  /* d rests on a (rank 0) as well as on c (rank 2), so the a->d edge
     has to cross rank 1 — where b is sitting. */
  const d = node('d', 3);
  d.alsoNeeds = [{ id: 'a', name: 'a' }];
  const tree = { roots: [node('a', 0, [node('b', 1, [node('c', 2, [d])])])] };
  const r = L.layout(tree);

  const long = r.edges.find(e => e.from === 'a' && e.to === 'd');
  ok('the long edge is there at all', !!long);
  ok(`it is broken at the ranks it crosses (${long.points.length} points)`,
    long.points.length > 4);
  check('it still ends on d', long.points[long.points.length - 1][1],
    r.nodes.find(n => n.id === 'd').y);
  check('and it passes behind nothing', throughABox(r), []);
}

/* ---------------- the claim the picture makes ---------------- */

section('every prerequisite is above what needs it');
{
  /* The one thing a reader is entitled to assume from the arrows. */
  const tree = {
    roots: [node('a', 0, [
      node('b', 1, [node('d', 2)]),
      node('c', 1),
    ])],
  };
  tree.roots[0].children[1].alsoNeeds = [];
  const r = L.layout(tree);
  const by = new Map(r.nodes.map(n => [n.id, n]));
  ok('no edge points upwards or sideways',
    r.edges.every(e => by.get(e.from).rank < by.get(e.to).rank));
}

section('the edges that make it a DAG are drawn, not dropped');
{
  /* d rests on both b and c; the tree hung it under b, so the c edge
     only exists in alsoNeeds. */
  const d = node('d', 2);
  d.alsoNeeds = [{ id: 'c', name: 'c' }];
  const tree = { roots: [node('a', 0, [node('b', 1, [d]), node('c', 1)])] };
  const r = L.layout(tree);
  check('four edges, not three', r.edges.length, 4);
  ok('one of them is the extra prerequisite',
    r.edges.some(e => e.from === 'c' && e.to === 'd' && e.extra));
}

section('the same edge is never drawn twice');
{
  /* alsoNeeds naming the node's own tree parent would otherwise draw
     one line on top of another and read as a thicker, different thing. */
  const b = node('b', 1);
  b.alsoNeeds = [{ id: 'a', name: 'a' }];
  const r = L.layout({ roots: [node('a', 0, [b])] });
  check('one edge', r.edges.length, 1);
}

section('a node reached by two paths is one box');
{
  const shared = node('d', 2);
  const tree = {
    roots: [node('a', 0, [node('b', 1, [shared]), node('c', 1, [shared])])],
  };
  const r = L.layout(tree);
  check('four boxes, not five', r.nodes.length, 4);
  check('and it is at one place', r.nodes.filter(n => n.id === 'd').length, 1);
}

/* ---------------- crossings ---------------- */

section('it untangles what it reasonably can');
{
  /* Deliberately crossed: the alphabetical starting order puts a above
     b, but a feeds the lower child and b the upper one. */
  const x = node('x', 1);
  const y = node('y', 1);
  const a = node('a', 0, [y]);
  const b = node('b', 0, [x]);
  const r = L.layout({ roots: [a, b] });
  check('no crossings left', L.crossings(r), 0);
}

/* ---------------- the real tracks ---------------- */

section('every real track lays out, and lays out legally');
{
  /* trackTree is in catalog.js and needs a catalogue; rather than drag
     that in, the same shape is rebuilt here from the data files. */
  const concepts = JSON.parse(fs.readFileSync('data/concepts.json', 'utf8'));
  const tracks = JSON.parse(fs.readFileSync('data/tracks.json', 'utf8'));
  const index = JSON.parse(fs.readFileSync('data/index.json', 'utf8'));
  const byId = Object.fromEntries(index.map(p => [p.id, p]));

  const chain = (id, seen = new Set()) => {
    if (seen.has(id) || !concepts[id]) return [];
    seen.add(id);
    const out = [];
    for (const need of concepts[id].needs || []) out.push(...chain(need, seen));
    out.push(id);
    return out;
  };

  let checked = 0;
  for (const t of tracks) {
    const inSet = new Set();
    for (const pid of t.problems) {
      for (const cid of (byId[pid] || {}).prereqs || []) {
        for (const c of chain(cid, new Set())) inSet.add(c);
      }
    }
    if (!inSet.size) continue;

    const needsOf = id => (concepts[id].needs || []).filter(x => inSet.has(x));
    const depths = {};
    const depth = id => {
      if (depths[id] !== undefined) return depths[id];
      depths[id] = 0;
      const ns = needsOf(id);
      depths[id] = ns.length ? 1 + Math.max(...ns.map(depth)) : 0;
      return depths[id];
    };
    [...inSet].forEach(depth);

    const kids = {};
    const roots = [];
    const extra = {};
    for (const id of inSet) {
      const ns = needsOf(id);
      if (!ns.length) { roots.push(id); continue; }
      const parent = ns.slice().sort((a, b) => depth(b) - depth(a))[0];
      extra[id] = ns.filter(x => x !== parent);
      (kids[parent] = kids[parent] || []).push(id);
    }
    const seen = new Set(roots);
    const build = id => ({
      id, name: concepts[id].name, topic: concepts[id].topic, depth: depths[id],
      alsoNeeds: (extra[id] || []).map(x => ({ id: x, name: concepts[x].name })),
      readings: [], problems: [], inTrack: 0,
      children: (kids[id] || []).filter(k => !seen.has(k) && seen.add(k)).map(build),
    });

    const r = L.layout({ roots: roots.map(id => (seen.add(id), build(id))) });
    const by = new Map(r.nodes.map(n => [n.id, n]));

    ok(`${t.id}: every concept it rests on is a box (${r.nodes.length})`,
      r.nodes.length === inSet.size);
    ok(`${t.id}: no edge points backwards`,
      r.edges.every(e => by.get(e.from).rank < by.get(e.to).rank));
    ok(`${t.id}: no two boxes sit on top of each other`,
      new Set(r.nodes.map(n => `${n.x},${n.y}`)).size === r.nodes.length);
    ok(`${t.id}: the canvas contains every box`,
      r.nodes.every(n => n.x + n.w <= r.width && n.y + n.h <= r.height));
    const crossed = throughABox(r);
    ok(`${t.id}: no line passes behind a box${crossed.length ? ` (${crossed[0]})` : ''}`,
      crossed.length === 0);
    checked += 1;
  }
  ok(`all ${checked} tracks checked`, checked === tracks.length);
}

section('the layout is stable: the same tree twice gives the same picture');
{
  const make = () => ({
    roots: [node('a', 0, [node('b', 1, [node('d', 2)]), node('c', 1)])],
  });
  const one = L.layout(make());
  const two = L.layout(make());
  check('identical coordinates',
    JSON.stringify(one.nodes.map(n => [n.id, n.x, n.y])),
    JSON.stringify(two.nodes.map(n => [n.id, n.x, n.y])));
}

report('learn-layout');
