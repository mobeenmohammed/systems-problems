/* ============================================================
   types/registry.js — the problem-type contract.

   Adding a type is one file that calls register(), plus a row in
   Catalog.TYPES. Nothing else in the app learns about it: the
   problem page asks the registry to render the answer widget,
   read it back, grade it, and then mark it up.

   A type module implements:

     render(problem, mount, ctx)
         Build the answer widget inside `mount`. `ctx` carries
         { locked } — true when the problem is already solved or
         the answer has been revealed, in which case the widget
         should still show, just not invite another go.

     collect(mount, problem)
         Read the widget back. Return null when nothing has been
         answered yet, so the page can say "answer it first"
         instead of grading an empty submission as wrong and
         burning the first-try bonus.

     grade(response, key, problem)
         Pure. Returns { correct, score, feedback }, where score
         is 0..1 for partial credit. Must not touch the DOM —
         this is what tests/grade.test.mjs drives directly.

     mark(mount, { response, key, problem, result })
         Paint the outcome onto the widget: which option was
         right, which line was the bug.

   Graders are pure and live apart from rendering on purpose: the
   grading rules are the part that has to be right, and they are
   much easier to trust when they can be tested without a DOM.
   ============================================================ */

const ProblemTypes = (() => {

  const types = {};

  function register(id, impl) {
    if (!impl || typeof impl.render !== 'function' || typeof impl.grade !== 'function') {
      throw new Error(`problem type "${id}" must implement render() and grade()`);
    }
    /* Two painting steps, not one.

       mark()   runs after EVERY submission, including wrong ones, and must
                not disclose anything the reader has not earned. It may show
                them their own answer and whether it was accepted; it may not
                show the right answer, mark the options they missed, or
                explain the distractors. It must leave the controls usable, so
                the next attempt is one click away.

       reveal() runs only when the answer is legitimately visible — a correct
                submission, or a deliberate Reveal — and may show everything.

       They were one function, and the result was that a wrong answer
       disabled the inputs and painted the correct option. */
    types[id] = {
      collect: () => null,
      mark:    () => {},
      reveal:  impl.reveal || (() => {}),
      ...impl,
      id,
    };
    return types[id];
  }

  const get = id => types[id] || null;
  const has = id => !!types[id];
  const ids = () => Object.keys(types);

  /* ---------------- helpers shared by the type modules ---------------- */

  /* Answers are compared after normalising whitespace and case, because
     "Page Fault" and "page fault" are the same answer and a trailing space is
     not a wrong answer. */
  const normText = s => String(s == null ? '' : s)
    .trim().toLowerCase().replace(/\s+/g, ' ');

  /* Program output is compared more carefully than prose: trailing whitespace
     on each line and a missing final newline are forgiven, because no problem
     here is about either, but internal blank lines are significant. */
  const normOutput = s => String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n+$/, '');

  const sameArray = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((v, i) => v === b[i]);

  const el = (tag, props = {}, kids = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of [].concat(kids)) {
      if (kid == null) continue;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return node;
  };

  return { register, get, has, ids, normText, normOutput, sameArray, el };
})();
