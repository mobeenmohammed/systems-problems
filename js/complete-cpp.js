/* ============================================================
   complete-cpp.js — completion for C++, without a language server.

   What this is not: clangd. A real C++ completion needs a real
   compiler front end holding a real translation unit, and the one
   this site ships runs in a worker, takes a second, and answers
   "did it build" rather than "what can follow this dot".

   What this is: four sources that need no type checking.

     1. Keywords.
     2. The standard-library names these problems actually use,
        each labelled with the header it comes from — which is the
        half of the answer people usually want.
     3. Identifiers already in the buffer, so your own names
        complete.
     4. Members after `.` or `->`, for receivers whose type is
        declared in the buffer in a form a regex can read.

   The fourth is the only one that can be wrong, so it is the one
   that is careful. When the receiver's type is known the list is
   that type's members. When it is not, every member is offered
   with the type it belongs to shown beside it — `push_back
   std::vector` — rather than a merged list that silently implies
   they are all available. An honest guess, labelled as one, beats
   a confident wrong answer; and nothing here is ever a claim that
   the code will compile. Only the compiler says that.

   Loaded as a plain script, not folded into vendor/codemirror.js,
   so changing the word list does not mean rebuilding the editor.
   ============================================================ */

const CppComplete = (() => {

  const KEYWORDS = (
    'alignas alignof and and_eq asm auto bitand bitor bool break case catch '
    + 'char char8_t char16_t char32_t class co_await co_return co_yield compl '
    + 'concept const consteval constexpr constinit const_cast continue decltype '
    + 'default delete do double dynamic_cast else enum explicit export extern '
    + 'false float for friend goto if inline int long mutable namespace new '
    + 'noexcept not not_eq nullptr operator or or_eq private protected public '
    + 'register reinterpret_cast requires return short signed sizeof static '
    + 'static_assert static_cast struct switch template this thread_local throw '
    + 'true try typedef typeid typename union unsigned using virtual void '
    + 'volatile wchar_t while xor xor_eq'
  ).split(' ');

  /* The header is the useful half: "which of these do I include" is a
     more common question than "how is it spelled". */
  const STD = {
    'std::vector': 'vector',
    'std::string': 'string',
    'std::map': 'map',
    'std::unordered_map': 'unordered_map',
    'std::set': 'set',
    'std::unordered_set': 'unordered_set',
    'std::deque': 'deque',
    'std::array': 'array',
    'std::pair': 'utility',
    'std::tuple': 'tuple',
    'std::optional': 'optional',

    'std::cout': 'iostream',
    'std::cin': 'iostream',
    'std::cerr': 'iostream',
    'std::endl': 'iostream',
    'std::getline': 'string',
    'std::ostringstream': 'sstream',
    'std::istringstream': 'sstream',
    'std::setprecision': 'iomanip',
    'std::fixed': 'ios',

    'std::sort': 'algorithm',
    'std::stable_sort': 'algorithm',
    'std::find': 'algorithm',
    'std::find_if': 'algorithm',
    'std::lower_bound': 'algorithm',
    'std::upper_bound': 'algorithm',
    'std::binary_search': 'algorithm',
    'std::max': 'algorithm',
    'std::min': 'algorithm',
    'std::max_element': 'algorithm',
    'std::min_element': 'algorithm',
    'std::reverse': 'algorithm',
    'std::count': 'algorithm',
    'std::count_if': 'algorithm',
    'std::fill': 'algorithm',
    'std::copy': 'algorithm',
    'std::unique': 'algorithm',
    'std::all_of': 'algorithm',
    'std::any_of': 'algorithm',
    'std::none_of': 'algorithm',
    'std::for_each': 'algorithm',
    'std::swap': 'utility',
    'std::move': 'utility',
    'std::accumulate': 'numeric',
    'std::iota': 'numeric',

    'std::size_t': 'cstddef',
    'std::int32_t': 'cstdint',
    'std::int64_t': 'cstdint',
    'std::uint32_t': 'cstdint',
    'std::uint64_t': 'cstdint',
    'std::numeric_limits': 'limits',
    'std::abs': 'cstdlib',

    'std::unique_ptr': 'memory',
    'std::shared_ptr': 'memory',
    'std::make_unique': 'memory',
    'std::make_shared': 'memory',
  };

  const HEADERS = [
    'algorithm', 'array', 'bitset', 'cctype', 'cmath', 'cstddef', 'cstdint',
    'cstdio', 'cstdlib', 'cstring', 'deque', 'functional', 'iomanip', 'iostream',
    'iterator', 'limits', 'map', 'memory', 'numeric', 'optional', 'queue', 'set',
    'sstream', 'stack', 'string', 'string_view', 'tuple', 'type_traits',
    'unordered_map', 'unordered_set', 'utility', 'vector',
  ];

  /* Deliberately short. Every name here is one somebody writing these
     problems will actually reach for; a complete API listing would bury
     them. */
  const MEMBERS = {
    vector: ['size', 'empty', 'push_back', 'pop_back', 'emplace_back', 'back',
      'front', 'begin', 'end', 'rbegin', 'rend', 'clear', 'resize', 'reserve',
      'at', 'insert', 'erase', 'data'],
    string: ['size', 'length', 'empty', 'substr', 'find', 'rfind', 'c_str',
      'push_back', 'pop_back', 'append', 'at', 'begin', 'end', 'clear',
      'compare', 'starts_with', 'ends_with'],
    map: ['size', 'empty', 'find', 'count', 'contains', 'at', 'begin', 'end',
      'insert', 'emplace', 'erase', 'clear'],
    set: ['size', 'empty', 'find', 'count', 'contains', 'insert', 'erase',
      'begin', 'end', 'clear'],
    pair: ['first', 'second'],
    ostream: ['put', 'write', 'flush', 'precision'],
    istream: ['get', 'getline', 'eof', 'fail', 'good', 'clear', 'peek', 'unget'],
  };

  /* Several spellings share an interface closely enough for this purpose.
     A deque is not a vector, but `d.push_back` is right either way, and
     the ones that differ (`data`) are a compile error rather than a
     silent wrong answer. */
  const ALIAS = {
    vector: 'vector', deque: 'vector', array: 'vector',
    string: 'string',
    map: 'map', unordered_map: 'map', multimap: 'map',
    set: 'set', unordered_set: 'set', multiset: 'set',
    pair: 'pair',
    ostringstream: 'ostream', ostream: 'ostream', cout: 'ostream', cerr: 'ostream',
    istringstream: 'istream', istream: 'istream', cin: 'istream',
  };

  /* name -> member group, for anything declared plainly enough to read.

     `std::vector<int> v;`, `vector<std::string> names{};`,
     `const std::map<int,int>& counts` all parse. Anything cleverer —
     `auto`, a typedef, a template parameter — does not, and falls back
     to the labelled list rather than guessing. */
  const DECL = new RegExp(
    String.raw`\b(?:const\s+)?(?:std\s*::\s*)?`
    + String.raw`(vector|string|map|unordered_map|multimap|set|unordered_set|multiset`
    + String.raw`|deque|array|pair|ostringstream|istringstream)`
    + String.raw`\s*(?:<[^;{}()]*>)?\s*[&*]?\s*([A-Za-z_]\w*)`,
    'g');

  function declaredTypes(text) {
    const out = Object.create(null);
    /* The streams are always themselves. */
    out.cout = 'ostream'; out.cerr = 'ostream'; out.cin = 'istream';
    let m;
    DECL.lastIndex = 0;
    while ((m = DECL.exec(text))) {
      const group = ALIAS[m[1]];
      if (group && !KEYWORDS.includes(m[2])) out[m[2]] = group;
    }
    return out;
  }

  /* Every identifier already written down, so your own names complete.
     Three characters minimum: completing `i` helps nobody. */
  function identifiers(text, skip) {
    const seen = new Set();
    for (const m of text.matchAll(/[A-Za-z_]\w{2,}/g)) {
      if (m[0] !== skip && !KEYWORDS.includes(m[0])) seen.add(m[0]);
    }
    return [...seen];
  }

  const member = (name, type, known) => ({
    label: name,
    type: 'method',
    /* When the receiver's type is known this is noise, so it is left
       off; when it is not, it is the whole point. */
    detail: known ? undefined : `std::${type}`,
    boost: known ? 1 : 0,
  });

  /* A CodeMirror completion source. Duck-typed on purpose: it needs
     matchBefore, pos, explicit and state.doc, and nothing else, which is
     what lets it be tested without starting an editor. */
  function source(context) {
    const doc = context.state.doc.toString();

    /* ---- #include <...> ---- */
    const inc = context.matchBefore(/#\s*include\s*[<"][\w./]*/);
    if (inc) {
      const open = inc.text.lastIndexOf('<') >= 0 ? '<' : '"';
      const typed = inc.text.slice(inc.text.lastIndexOf(open) + 1);
      return {
        from: inc.to - typed.length,
        options: HEADERS.map(h => ({ label: h, type: 'namespace' })),
        validFor: /^[\w./]*$/,
      };
    }

    /* ---- after a dot or an arrow ---- */
    const dot = context.matchBefore(/([A-Za-z_]\w*)\s*(\.|->)\s*\w*/);
    if (dot) {
      const m = /^([A-Za-z_]\w*)\s*(?:\.|->)\s*(\w*)$/.exec(dot.text);
      if (m) {
        const types = declaredTypes(doc);
        const group = types[m[1]];
        const options = group
          ? MEMBERS[group].map(n => member(n, group, true))
          : Object.entries(MEMBERS).flatMap(([t, names]) =>
            names.map(n => member(n, t, false)));
        /* A name offered by two types is offered once. */
        const once = new Map();
        for (const o of options) if (!once.has(o.label)) once.set(o.label, o);
        return {
          from: context.pos - m[2].length,
          options: [...once.values()],
          validFor: /^\w*$/,
        };
      }
    }

    /* ---- everything else ---- */
    const word = context.matchBefore(/[\w:]+/);
    if (!word && !context.explicit) return null;
    const typed = word ? word.text : '';
    /* One character is not enough to be worth a popup unless it was
       asked for with Ctrl-Space. */
    if (!context.explicit && typed.length < 2) return null;

    const options = [
      ...KEYWORDS.map(k => ({ label: k, type: 'keyword' })),
      ...Object.entries(STD).map(([label, header]) => ({
        label, type: 'class', detail: `<${header}>`, boost: 1,
      })),
      ...identifiers(doc, typed).map(label => ({ label, type: 'variable' })),
    ];

    return {
      from: word ? word.from : context.pos,
      options,
      validFor: /^[\w:]*$/,
    };
  }

  return { source, KEYWORDS, STD, HEADERS, MEMBERS, ALIAS, declaredTypes, identifiers };
})();
