# Multi-file exercises

An exercise is multi-file when its `payload.files` is a non-empty list.
Everything without that field is a single-file exercise and none of this
applies to it.

**Today this works for C++ and only for C++**, in the in-browser toolchain and
on the optional native runner. The rest of this file is what each of the other
runners would need, written down so that the next person does not have to
re-derive it — and so that nothing here is advertised before it has been
tested.

## The schema

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

- `entry` is the file with `main()`. The build checks that it has one.
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

### SystemVerilog

`js/hdl/toolchain.js` already passes Icarus **two** files — the design and the
testbench — so the simulator end of this is done. What is missing is only the
authoring side:

1. `payload.files` is not read by the `hdl` type at all; it has its own
   `template` and `testbench` fields.
2. `include` paths and a file list would need deciding: Icarus takes several
   source files on the command line, and `` `include `` resolves against the
   working directory.
3. A design split across files changes what the Compiler output pane is
   reporting on, and the file-linked diagnostics would need the same treatment
   the C++ side got.

Of the three this is the smallest piece of work, because the runner can
already do it.

## What is deliberately not here

- Creating, renaming or deleting files. A workspace is the set of files the
  problem defines, and that is also what makes "reset the whole workspace" and
  "restore this submission" mean something precise.
- Installing packages, and editing the build. The flags are the exercise's,
  not the reader's.
- More than one language in one workspace.
