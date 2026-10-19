# Multi-file exercises

An exercise is multi-file when its `payload.files` is a non-empty list.
Everything without that field is a single-file exercise and none of this
applies to it.

**Today this works for C++ and for SystemVerilog.** C++ compiles in the
in-browser toolchain and on the optional native runner; SystemVerilog
elaborates in the in-browser Icarus. Rust and Python do not, and the rest of
this file is what each of them would need — written down so that the next
person does not have to re-derive it, and so that nothing here is advertised
before it has been tested.

## The schema

A `code` problem:

```jsonc
"payload": {
  "langs": ["cpp"],
  "files": [
    { "path": "ring_buffer.hpp", "content": "…" },
    { "path": "ring_buffer.cpp", "content": "…" },
    { "path": "main.cpp",        "content": "…", "readOnly": true }
  ],
  "entry": "main.cpp",
  "build": { "sources": ["main.cpp", "ring_buffer.cpp"] },
  "cases": [ { "stdin": "…", "expect": "…" } ]
}
```

An `hdl` problem, with the same three fields meaning the same three things:

```jsonc
"payload": {
  "top": "fifo",
  "generation": "2012",
  "files": [
    { "path": "fifo_mem.sv", "content": "…" },
    { "path": "fifo.sv",     "content": "…" }
  ],
  "entry": "fifo.sv",
  "build": { "sources": ["fifo_mem.sv", "fifo.sv"] },
  "testbench": "…",
  "checks": ["…"]
}
```

- `entry` is the file with `main()`. The build checks that it has one. A
  hardware exercise has no `main`, so there it is simply the file the reader
  works in last, and `payload.top` names the module the testbench
  instantiates — the build checks that one of the files declares it.
- `build.sources` are the translation units. A header must not be in the list:
  it is planted beside the sources and found by `#include`. Left out, every
  source file is a unit.
- `readOnly` is an editing aid. It stops a reader changing the interface by
  accident; it stops nobody who opens the console, and nothing is graded on
  it. The exercise is still graded on whatever the files say.
- Paths are validated by `js/workspace.js` — relative, no `..`, no backslash,
  three segments deep at most, twelve files and 256 KB in all. The page
  checks them, and so does every runner, because a runner that trusts its
  caller because the caller promised has no check at all.
- **Directories work.** `include/cache.hpp` and `src/cache.cpp` are planted
  at those paths, the explorer draws them as a tree, and a quoted
  `#include` resolves against the directory of the file doing the
  including — so `src/cache.cpp` says `"../include/cache.hpp"` and
  `main.cpp` says `"include/cache.hpp"`. The cache-simulator project is
  the worked example, and `npm run audit:cxx` compiles it in the browser
  toolchain on every run.

The answer key carries `key.reference.files`, a worked copy of the same paths.
There is deliberately no second copy of the entry point under
`key.reference.cpp`: two copies of one file is one too many to keep in step.

A project adds `project: { id, title, step, of, label, continues }` at the top
level of the problem. `continues` names the previous milestone, which is where
the reader's files are carried forward from.

## How C++ is actually built

`js/cxx/toolchain.js` asks Clang's driver once, with `-###`, what it would do
for one file and these flags. That gives a `cc1` argument list and a `wasm-ld`
argument list. Each translation unit is then compiled by substituting its name
and its object name into the `cc1` list — `main.cpp` appears twice in it, as
the input and as `-main-file-name`, and both are replaced — and `wasm-ld` is
handed every object where the driver named one.

Nothing is concatenated. That matters for four separate reasons, and each of
them is a thing a reader would otherwise meet as a lie:

- line numbers in diagnostics belong to the file the error is in,
- a `static` at file scope is private to its file,
- an include guard goes on doing its job,
- and a missing definition is a **link** error, which is the error that makes
  no sense until you have seen how separate compilation works.

Every compile gets fresh Clang and LLD instances and therefore a fresh
filesystem, so no file from a previous run — of this exercise or any other —
can be read by this one.

On the native runner (`judge/server.mjs`) the files are written into a
temporary directory that is removed afterwards, and `g++` is given every unit
in one invocation.

## What the other runners would need

### Rust

`js/rust/toolchain.js` drives `rustc` with a single input file and
`--edition 2021`. Several files is not several inputs to `rustc`: Rust's unit
of compilation is a crate, and the other files are *modules* of it, found
through `mod` declarations relative to the crate root.

So the work is:

1. Plant every file in the compiler's filesystem, keeping the directory
   layout, because `mod foo;` in `main.rs` looks for `foo.rs` or `foo/mod.rs`
   beside it. The current toolchain writes exactly one file.
2. Pass only the crate root to `rustc`. There is no `sources` list to build —
   `build.sources` would have one entry and the rest is `mod`.
3. Decide what a diagnostic's path looks like and make
   `fileNameOf` in `js/types/code.js` cope with it. rustc prints the path as
   given, so this is probably already right.
4. Anything needing a second *crate* — a `[dependencies]` entry, or a library
   and a binary — needs Cargo, which is not vendored and is a much larger
   piece of work than this one.

Until 1 and 2 are done and a reference solution has been run through them,
`payload.files` with `langs: ["rust"]` is refused by the build.

### Python

`js/py/run.worker.js` hands Pyodide one source string. Imports are the
interesting part: `import ring_buffer` searches `sys.path`, so the files have
to be written into Pyodide's virtual filesystem and that directory has to be
on the path.

1. Write every file under a directory, say `/work`, in the Pyodide FS.
2. Put `/work` at the front of `sys.path` and run the entry point from there.
3. Reset it between runs. Pyodide's interpreter is long-lived and
   `sys.modules` caches by name, so a module left over from the previous run
   would be imported instead of the new one — which is the same stale-file
   problem the C++ side solves by building a fresh filesystem every time, and
   it is the thing most likely to be got wrong.

There is no compile step, so there is no link error to teach and no
diagnostics plumbing to do: a bad import is a traceback at run time.

## How SystemVerilog is actually built

`js/hdl/toolchain.js` hands **every** source to `ivlpp` in one invocation, so
a macro defined in one file is visible in the next and `ivl` elaborates them
as one design. That was already true of the design and the testbench; a
workspace simply sends more files the same way.

What the type adds:

- `payload.files` are the design sources. The sample testbench
  (`payload.testbench`) and the grading one (`key.harness`) arrive beside them
  under the name `testbench.sv`, which is why the build refuses a design file
  claiming that name.
- `payload.top` is the simulation top — the module the testbench instantiates
  — and the build checks that one of the files declares it.
- Cross-file instantiation needs nothing at all: `fifo` in one file
  instantiating `fifo_mem` in another is one elaboration over the whole set.
  Leave the instantiated file empty and Icarus says `Unknown module type`,
  which is the hardware equivalent of a link error.
- Diagnostics already carried a file name. On a workspace the ones naming a
  file the reader has are buttons that open it at the line; the ones in the
  read-only testbench are not, because there is nowhere to open them.

The sample testbench tab, the reader's own testbench tab and the waveform
viewer are unchanged, and a testbench of your own is compiled against the
whole workspace rather than against one file of it.

## The explorer

`js/filepane.js` draws the files as a tree: directories are rows that
fold, files are rows that open, and the indentation is a custom
property rather than a class per level. The explorer collapses
entirely, and the bar on its right drags it between 120 and 420 pixels.
Its width and whether it is showing are preferences that outlive the
problem; which directories are folded is keyed by problem id, because a
fold is about the shape of that exercise.

The whole widget is reachable from the keyboard: one tab stop, then the
arrow keys walk the tree, Left folds or goes to the parent, Right
unfolds, and Enter opens a file. `Alt+B` toggles the explorer from
anywhere, including from inside the editor.

The problem statement beside it folds away too, with `Alt+D` or the
control at the end of its tab strip, and the freed width goes to the
editor. Reset layout puts all of it back and leaves every draft alone.

## What is deliberately not here

- Creating, renaming or deleting files. A workspace is the set of files the
  problem defines, and that is also what makes "reset the whole workspace" and
  "restore this submission" mean something precise.
- Installing packages, and editing the build. The flags are the exercise's,
  not the reader's.
- More than one language in one workspace.
- `` `include `` between workspace files. It would probably work — ivlpp
  resolves includes against the working directory and every file is written
  there — but nothing has tested it, so nothing claims it.
