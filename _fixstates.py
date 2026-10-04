import io

p = 'tests/browser/states.test.mjs'
s = io.open(p, encoding='utf-8').read()

old = """/* Anything that looks like a number that is not one. A view that divides by a
   zero total and prints NaN% is the classic empty-state bug. */
const NONSENSE = /\\bNaN\\b|\\bundefined\\b|\\bnull\\b|\\bInfinity\\b/;

async function sweep(label, ctx) {
  for (const hash of VIEWS) {
    await go(ctx.window, hash);
    const view = ctx.document.querySelector('.view:not([hidden])');
    ok(`${label} \\u00b7 ${hash}: a view is showing`, view !== null);
    if (!view) continue;
    ok(`${label} \\u00b7 ${hash}: it has content`, view.textContent.trim().length > 20);
    const bad = NONSENSE.exec(view.textContent);
    ok(`${label} \\u00b7 ${hash}: no NaN or undefined on screen${bad ? ` (found "${bad[0]}")` : ''}`, !bad);
  }
  check(`${label}: no console errors`, ctx.errors, []);
}"""

new = """/* A value that failed to compute, as it actually appears on screen.

   Searching the whole view for the word "undefined" does not work here: this
   site is substantially *about* undefined behaviour, and "#undefined-behaviour"
   is a tag on three problems and a concept name. What a rendering bug really
   looks like is a slot whose entire contents are the broken value — a count
   that came out NaN, a label that came out undefined — so that is what is
   looked for: the own text of an element, not the text of the page. */
const BROKEN_VALUE = /^(NaN|undefined|null|Infinity|-Infinity|\\[object Object\\]|NaN%)$/;

/* The text a node contributes itself, ignoring its children. */
const ownText = node => [...node.childNodes]
  .filter(n => n.nodeType === 3)
  .map(n => n.textContent)
  .join('')
  .trim();

function brokenValues(view) {
  const out = [];
  for (const node of view.querySelectorAll('*')) {
    const text = ownText(node);
    if (text && BROKEN_VALUE.test(text)) {
      out.push(`<${node.tagName.toLowerCase()}${node.className ? '.' + String(node.className).split(' ')[0] : ''}>${text}`);
    }
  }
  /* A percentage or a fraction that came out wrong is worth catching even
     inside a longer sentence, because those are computed. */
  if (/\\bNaN\\b/.test(view.textContent)) out.push('NaN somewhere in the text');
  if (/\\bInfinity\\b/.test(view.textContent)) out.push('Infinity somewhere in the text');
  if (/\\[object Object\\]/.test(view.textContent)) out.push('[object Object] in the text');
  if (/\\bundefined\\/\\d|\\d\\/undefined/.test(view.textContent)) out.push('undefined in a fraction');
  return out;
}

async function sweep(label, ctx) {
  for (const hash of VIEWS) {
    await go(ctx.window, hash);
    const view = ctx.document.querySelector('.view:not([hidden])');
    ok(`${label} \\u00b7 ${hash}: a view is showing`, view !== null);
    if (!view) continue;
    ok(`${label} \\u00b7 ${hash}: it has content`, view.textContent.trim().length > 20);
    const bad = brokenValues(view);
    ok(`${label} \\u00b7 ${hash}: nothing rendered as a broken value${bad.length ? ` (${bad.slice(0, 3).join(', ')})` : ''}`,
      bad.length === 0);
  }
  check(`${label}: no console errors`, ctx.errors, []);
}"""

assert old in s
s = s.replace(old, new, 1)

# A leftover placeholder assertion from drafting - make it mean something.
old2 = """ok('the reading summary starts at zero',
  /^0 of \\d+/.test(fresh.document.getElementById('readingSummary')
    ? '0 of 1' : '0 of 1'));"""
new2 = """ok('no problem claims to be worth nothing before it is attempted',
  [...fresh.document.querySelectorAll('#homeReview .worth')].every(n => !/^0 XP$/.test(n.textContent)));"""
assert old2 in s
s = s.replace(old2, new2, 1)

old3 = "ok('an opened track offers no next problem but says it is complete', true);\n"
assert old3 in s
s = s.replace(old3, '', 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('broken-value detection now looks at element own text')
