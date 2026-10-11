/* ============================================================
   complete-rust.js — completion for Rust, on the same terms as
   js/complete-cpp.js: keywords, the library names these problems
   actually reach for, and whatever is already in the buffer.

   Rust was the one language here getting nothing at all. The
   CodeMirror package ships a parser and no completions, the same
   as C++, and nobody had filled the gap.

   No member completion. C++ gets one because a declaration like
   `std::vector<int> v` says the type in a form a regex can read;
   Rust's are mostly `let v = ...` with the type inferred, and
   guessing members off an inferred type is exactly the confident
   wrong answer the C++ source goes out of its way to avoid. A
   method list would be wrong more often than right, so there
   isn't one.
   ============================================================ */

const RustComplete = (() => {

  const KEYWORDS = (
    'as async await break const continue crate dyn else enum extern false fn '
    + 'for if impl in let loop match mod move mut pub ref return self Self '
    + 'static struct super trait true type union unsafe use where while'
  ).split(' ');

  /* The prelude and the handful of paths these problems use. The note
     beside each is what it is *for*, which is the part worth being
     reminded of; `use` paths carry the path instead, because that is the
     thing you are about to type. */
  const STD = {
    // types you reach for
    Vec: 'a growable array',
    String: 'an owned, growable string',
    Option: 'Some(T) or None',
    Result: 'Ok(T) or Err(E)',
    Box: 'a value on the heap',
    HashMap: 'use std::collections::HashMap',
    HashSet: 'use std::collections::HashSet',
    BTreeMap: 'use std::collections::BTreeMap',
    VecDeque: 'use std::collections::VecDeque',

    // the integer and float types, spelled out because the width is the point
    i8: '', i16: '', i32: '', i64: '', i128: '', isize: '',
    u8: '', u16: '', u32: '', u64: '', u128: '', usize: '',
    f32: '', f64: '', bool: '', char: '', str: 'a string slice',

    // io, which every one of these problems does
    'std::io': 'read_to_string, stdin, stdout',
    'io::stdin': 'the standard input handle',
    'io::stdout': 'the standard output handle',
    read_to_string: 'io::Read — the whole of stdin at once',
    split_whitespace: 'the usual way to tokenise that input',
    parse: 'str -> a number, returning Result',
    unwrap: 'take the value, or panic',
    expect: 'take the value, or panic with your message',

    // macros, with the bang, because that is how they are written
    'println!': 'print a line to stdout',
    'print!': 'print without a newline',
    'eprintln!': 'print a line to stderr',
    'write!': 'print into anything that implements Write',
    'writeln!': 'the same, with a newline',
    'format!': 'build a String',
    'vec!': 'build a Vec',
    'assert!': '', 'assert_eq!': '', 'panic!': '', 'todo!': '',
  };

  /* Shared with the C++ source rather than written twice: "every word
     already in the file, minus the keywords" is the same idea in both
     languages, and two copies would drift. */
  function identifiers(text, skip) {
    const seen = new Set();
    for (const m of text.matchAll(/[A-Za-z_]\w{2,}/g)) {
      if (m[0] !== skip && !KEYWORDS.includes(m[0])) seen.add(m[0]);
    }
    return [...seen];
  }

  function source(context) {
    const doc = context.state.doc.toString();

    /* `use std::collections::…` — paths, not words. */
    const use = context.matchBefore(/use\s+[\w:]*/);
    if (use) {
      const typed = use.text.replace(/^use\s+/, '');
      return {
        from: use.to - typed.length,
        options: [
          'std::io::{self, Read, Write}',
          'std::io::Read',
          'std::io::Write',
          'std::io::BufRead',
          'std::collections::HashMap',
          'std::collections::HashSet',
          'std::collections::BTreeMap',
          'std::collections::VecDeque',
          'std::fmt',
          'std::cmp::{min, max}',
        ].map(label => ({ label, type: 'namespace' })),
        validFor: /^[\w:{},\s]*$/,
      };
    }

    const word = context.matchBefore(/[\w:!]+/);
    if (!word && !context.explicit) return null;
    const typed = word ? word.text : '';
    if (!context.explicit && typed.length < 2) return null;

    return {
      from: word ? word.from : context.pos,
      options: [
        ...KEYWORDS.map(label => ({ label, type: 'keyword' })),
        ...Object.entries(STD).map(([label, detail]) => ({
          label,
          type: label.endsWith('!') ? 'macro' : 'class',
          detail: detail || undefined,
          boost: 1,
        })),
        ...identifiers(doc, typed).map(label => ({ label, type: 'variable' })),
      ],
      validFor: /^[\w:!]*$/,
    };
  }

  return { source, KEYWORDS, STD, identifiers };
})();
