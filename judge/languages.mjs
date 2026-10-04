/* ============================================================
   languages.mjs — how each language is compiled, run and
   syntax-checked, and the flag profiles a problem can ask for.

   The flags are the reason this judge exists rather than Piston
   or Judge0. Both of those run a fixed compile command, which
   rules out -fsanitize=address, -Wall -Wextra and -fopenmp. On a
   site for learning C++, the compiler's own diagnostics and the
   sanitizer's report are a large part of what there is to learn,
   so they are a feature here and not an afterthought.

   The same reasoning produced the `syntax` commands below: the
   editor lints with the real compiler rather than with a
   hand-written approximation of it, so the message you get while
   typing is the message you would get from a build.
   ============================================================ */

/* A char code rather than an escape, so that nothing editing this file can
   eat the backslash and turn it silently into a real newline. */
const NEWLINE = String.fromCharCode(10);

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

/* ---------------- diagnostic parsing ----------------

   Every compiler here is asked for the same single-line diagnostic format,
   `file:line:col: severity: message`, which is why one parser serves three of
   the four languages. GCC produces it natively; rustc produces it with
   --error-format=short. That choice is what keeps this code short rather than
   a per-compiler scraping exercise. */

/* Searched for rather than anchored at the start of the line, because the
   filename in front of it is an absolute path and on Windows that begins
   "C:\\" — a colon that defeats any attempt to match the path first. The
   ":line:col:" marker is unambiguous enough to find on its own, since no path
   component is a bare number followed by another bare number. */
const PLAIN = /:(\d+):(\d+):\s*(fatal error|error|warning|note)(?:\[[^\]]*\])?:\s*(.*)$/;

function parsePlain(stderr) {
  const out = [];
  for (const line of String(stderr || '').split(NEWLINE)) {
    const m = line.match(PLAIN);
    if (!m) continue;
    const severity = m[3].includes('error') ? 'error' : m[3] === 'warning' ? 'warning' : 'note';
    /* Notes are follow-ups to the diagnostic above them and are noise on their
       own in an editor margin. */
    if (severity === 'note') continue;
    out.push({ line: Number(m[1]), column: Number(m[2]), severity, message: m[4].trim() });
  }
  return out;
}

/* Python reports a syntax error across several lines: a File/line header, the
   offending source, a caret, and then the message. The message is the last
   line, and it is the only one worth showing. */
function parsePython(stderr) {
  const text = String(stderr || '');
  const where = text.match(/File "[^"]*", line (\d+)/);
  const what = text.match(/^(\w*(?:Error|Warning)): (.*)$/m);
  if (!where && !what) return [];
  return [{
    line: where ? Number(where[1]) : 1,
    column: 1,
    severity: 'error',
    message: what ? `${what[1]}: ${what[2]}` : 'syntax error',
  }];
}

/* node --check prints the file and line on its own line, then a caret, then
   the error class and message. */
function parseNode(stderr) {
  const text = String(stderr || '');
  const where = text.match(/^(?:file:\/\/)?\S*?:(\d+)$/m);
  const what = text.match(/^(\w*(?:Error|Warning)): (.*)$/m);
  if (!what) return [];
  return [{
    line: where ? Number(where[1]) : 1,
    column: 1,
    severity: 'error',
    message: `${what[1]}: ${what[2]}`,
  }];
}

/* ---------------- the languages ---------------- */

export const LANGS = {
  cpp: {
    label: 'C++',
    install: 'sudo apt install g++        (Ubuntu/WSL)',
    file: 'main.cpp',
    version: ['g++', ['-dumpfullversion', '-dumpversion']],
    compile: ({ src, bin, flags }) => ['g++', [...flags, src, '-o', bin]],
    run:     ({ bin }) => [bin, []],

    /* -fsyntax-only parses and type-checks without generating code, which is
       several times faster than a build and is all a linter needs. The two
       diagnostics flags strip the colour escapes and the caret art so the
       output is one line per problem. */
    syntax: ({ src, flags }) => ['g++', [
      '-fsyntax-only', '-fno-diagnostics-color', '-fno-diagnostics-show-caret',
      ...flags, src,
    ]],
    diagnostics: parsePlain,
  },

  rust: {
    label: 'Rust',
    install: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal   (no sudo needed)",
    file: 'main.rs',
    version: ['rustc', ['--version']],
    compile: ({ src, bin, flags }) => ['rustc', [...flags, src, '-o', bin]],
    run:     ({ bin }) => [bin, []],

    /* --emit=metadata type-checks without codegen; --error-format=short gives
       the same one-line shape GCC does, so parsePlain handles both. */
    syntax: ({ src, dir, flags }) => ['rustc', [
      '--emit=metadata', '--error-format=short', '--out-dir', dir,
      ...flags.filter(f => f !== '-O'), src,
    ]],
    diagnostics: parsePlain,
  },

  python: {
    label: 'Python',
    install: 'sudo apt install python3    (Ubuntu/WSL)',
    file: 'main.py',
    version: ['python3', ['--version']],
    /* A syntax check stands in for compilation, so a typo is reported as a
       compile error rather than as every case failing identically. */
    compile: ({ src }) => ['python3', ['-m', 'py_compile', src]],
    run:     ({ src }) => ['python3', ['-I', src]],

    syntax: ({ src }) => ['python3', ['-m', 'py_compile', src]],
    diagnostics: parsePython,
  },

  js: {
    label: 'JavaScript',
    install: 'sudo apt install nodejs     (Ubuntu/WSL)',
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

    syntax: ({ src }) => ['node', ['--check', src]],
    diagnostics: parseNode,
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

/* The sanitizer can also fail to start, and it says so in words that match the
   pattern above. The commonest cause is a resource limit: ASan reserves on the
   order of 20 TB of virtual address space for shadow memory, so any RLIMIT_AS
   kills it before main(). That is a fault in how the judge invoked it, not a
   defect in the submitted program, and reporting it as "your code is unclean"
   sends you hunting for a bug that is not there. */
const SANITIZER_BROKEN = /failed to allocate|Shadow memory range interleaves|unable to mmap|Make sure to compile with -g|ASan runtime does not come first/;

export const sanitizerBroken = stderr => SANITIZER_BROKEN.test(String(stderr || ''));

export const sawSanitizer = stderr => {
  const s = String(stderr || '');
  return SANITIZER.test(s) && !SANITIZER_BROKEN.test(s);
};

/* Exported for the tests, which drive the parsers on captured compiler output
   rather than needing the compilers themselves. */
export const PARSERS = { parsePlain, parsePython, parseNode };
