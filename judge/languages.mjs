/* ============================================================
   languages.mjs — how each language is compiled and run, and the
   flag profiles a problem can ask for.

   The flags are the reason this judge exists rather than Piston
   or Judge0. Both of those run a fixed compile command, which
   rules out -fsanitize=address, -Wall -Wextra and -fopenmp. On a
   site for learning C++, the compiler's own diagnostics and the
   sanitizer's report are a large part of what there is to learn,
   so they are a feature here and not an afterthought.
   ============================================================ */

/* ---------------- flag profiles ---------------- */

export const PROFILES = {
  cpp: {
    /* -Wall -Wextra on every profile, always. A warning you never see is a
       warning that taught you nothing, and the server returns compile stderr
       even when the build succeeded. */
    standard: ['-std=c++23', '-O2', '-Wall', '-Wextra'],

    /* -fno-sanitize-recover makes UBSan abort rather than print and carry on,
       so a problem marked requireClean actually fails instead of passing with
       a note buried in stderr. -O1 with frame pointers keeps the stack traces
       readable, which is the whole point of the report. */
    sanitize: ['-std=c++23', '-O1', '-g', '-Wall', '-Wextra',
               '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
               '-fno-omit-frame-pointer'],

    strict:   ['-std=c++23', '-O2', '-Wall', '-Wextra',
               '-Wpedantic', '-Wshadow', '-Wconversion'],

    parallel: ['-std=c++23', '-O2', '-Wall', '-Wextra', '-fopenmp', '-pthread'],
  },

  rust: {
    /* Rust's sanitizers need nightly, so the sanitize profile does what stable
       can: keep the overflow and debug assertions that release mode drops.
       Miri is the real equivalent for unsafe code — see judge/README.md. */
    standard: ['-O', '--edition', '2021', '-D', 'warnings'],
    sanitize: ['--edition', '2021', '-C', 'debug-assertions=on', '-C', 'overflow-checks=on'],
    strict:   ['-O', '--edition', '2021', '-D', 'warnings'],
    parallel: ['-O', '--edition', '2021'],
  },
};

/* ---------------- the languages ---------------- */

export const LANGS = {
  cpp: {
    label: 'C++',
    file: 'main.cpp',
    version: ['g++', ['-dumpfullversion', '-dumpversion']],
    compile: ({ src, bin, flags }) => ['g++', [...flags, src, '-o', bin]],
    run:     ({ bin }) => [bin, []],
  },

  rust: {
    label: 'Rust',
    file: 'main.rs',
    version: ['rustc', ['--version']],
    compile: ({ src, bin, flags }) => ['rustc', [...flags, src, '-o', bin]],
    run:     ({ bin }) => [bin, []],
  },

  python: {
    label: 'Python',
    file: 'main.py',
    version: ['python3', ['--version']],
    /* A syntax check stands in for compilation, so a typo is reported as a
       compile error rather than as every case failing identically. */
    compile: ({ src }) => ['python3', ['-m', 'py_compile', src]],
    run:     ({ src }) => ['python3', ['-I', src]],
  },

  js: {
    label: 'JavaScript',
    file: 'main.js',
    version: ['node', ['--version']],
    compile: ({ src }) => ['node', ['--check', src]],

    /* JavaScript submissions get readStdin/readLines/print/write, the same
       four helpers the in-tab Web Worker provides. Without this, "JavaScript"
       would mean one thing in the browser and another on the judge, and the
       same submission would pass in one place and throw in the other.

       It is loaded with -r rather than prepended to the source, so a stack
       trace still reports the line the author actually wrote. A preamble
       pasted on top would shift every line number by its own length. */
    aux: [{
      name: 'shim.cjs',
      content: [
        "const fs = require('fs');",
        "let cached = null;",
        "const stdin = () => {",
        "  if (cached === null) {",
        "    try { cached = fs.readFileSync(0, 'utf8'); } catch { cached = ''; }",
        "  }",
        "  return cached;",
        "};",
        "globalThis.readStdin = stdin;",
        "globalThis.readLines = () => stdin().replace(/\\r\\n?/g, '\\n').split('\\n');",
        "globalThis.print = (...a) => process.stdout.write(a.join(' ') + '\\n');",
        "globalThis.write = (s) => process.stdout.write(String(s));",
        '',
      ].join('\n'),
    }],

    run: ({ src, dir }) => ['node', ['-r', `${dir}/shim.cjs`, src]],
  },
};

export const flagsFor = (lang, profile) => {
  const table = PROFILES[lang];
  if (!table) return [];
  return table[profile] || table.standard || [];
};

/* A run is "unclean" when the sanitizer said something, which is a different
   claim from "the output was wrong" and is reported separately so a problem
   can require cleanliness as well as correctness. */
const SANITIZER = /AddressSanitizer|LeakSanitizer|ThreadSanitizer|UndefinedBehaviorSanitizer|runtime error:|SUMMARY: \w*Sanitizer/;

export const sawSanitizer = stderr => SANITIZER.test(String(stderr || ''));
