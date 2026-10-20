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

Either panel folds away: the segmented control in the header offers
Description, Split and Code, `Alt+D` and `Alt+E` toggle their own panel
between "alone" and "both", and whichever panel survives takes the whole
window. Both hidden is not one of the states. The split fraction is
untouched by folding, so coming back to Split finds the statement at the
width it was dragged to. Run, Submit and Reset sit under both panels
rather than inside the code column, so hiding the code does not hide
them. Reset layout puts all of it back and leaves every draft alone.

## Projects are not tracks

A project used to be a track in `data/tracks.json` like any other, drawn
in Learn as the tree of concepts it rests on, and reachable from the
Content menu as `#/problems?project=1`. It was badly served by both.
Learn answers "what does this rest on" with a graph of concepts, which
for a three-milestone project is four boxes saying nothing; the
catalogue filter gave a flat list of milestones with no sign of which
came first or what the finished thing looks like.

The four project tracks now carry `kind: "project"` and the id their
problems use in their own `project` block:

```json
{ "id": "project-cache-sim", "kind": "project", "project": "cache-sim", ... }
```

`Catalog.learnTracks()` is what Learn draws — everything without that
kind. `Catalog.allProjects()` is what `#/projects` draws, and
`Catalog.project(id)` accepts the track id, the bare project id, or any
of its problems' ids, because three kinds of link arrive there. Nothing
moved underneath: the same track rows, the same problem ids, the same
drafts and submissions and records under those ids.

`#/projects` is one card per project, with its languages, its hardest
milestone's difficulty (the one that decides whether somebody can
finish), a progress bar, a numbered link per milestone, and a button
that names the milestone it opens rather than only saying "Continue".
The language, difficulty and progress filters live in the hash, so a
filtered view is a link somebody can send and a reload does not lose
it.

`#/projects/<id>` is the overview: what you end up with (the track's
`goal`, which was only ever a tooltip before), what it rests on, the
file structure, and the milestones in order. The file structure comes
from a `files` list the index now carries for multi-file problems —
paths and which of them the exercise supplies — so the overview does
not fetch three problem files to list nine paths, and the contents stay
in the problem files where they belong.

Prerequisites link into Learn through `Catalog.conceptHref()`, which
prefers a track whose own problems name the concept over one that
merely reaches it through a shared prerequisite, and falls back to the
reading index when no track teaches it. The arrow points one way on
purpose: a project links into Learn, and nothing adds a project to
anybody's course tree.

`#/learn/project-*` and `#/tracks/project-*` redirect to the overview,
so bookmarks, the dashboard's "next up" and every link written before
the split still land on the thing rather than on a 404.

`tests/content.test.mjs` checks what cannot be fixed at runtime: that
every milestone of a project track claims that project, that the
`step` numbers are 1..n in the track's order, that they agree on `of`,
that each has a label for the overview, and that no problem calls
itself a milestone of a project no track lists.

## Which file you are in

A strip under the tabs names the file the editor is showing: each
directory in the path is a button that reveals it in the explorer, the
filename is the last step, and a file the exercise supplied carries a
`given` tag. A single-file exercise gets the strip too, with the name
its compiler uses — `main.cpp`, `main.rs`, `main.py`, `design.sv` — so a
diagnostic that names a file is naming something the reader has seen.

`Alt+P` opens a file by name. It matches a substring of the path first
and a subsequence second, so `cch` finds `include/cache.hpp`. It is
offered only where there is more than one file.

## The editing tools

The vendored CodeMirror bundle carries `@codemirror/search`, so find and
replace is the library's own panel over the whole document rather than a
second one written over the top of it. The keys, all scoped to the
editor:

| | |
|---|---|
| `Ctrl+F` | find and replace in this file |
| `F3` / `Ctrl+G` | find again |
| `Ctrl+Alt+G` | go to line |
| `Ctrl+]` / `Ctrl+[` | indent, outdent |
| `Ctrl+/` | toggle line comment |
| `Alt+Z` | word wrap |

Two bindings the search package offers were dropped: `Ctrl+D` (select
next occurrence) and `Ctrl+Shift+L` (select all occurrences). Neither
was asked for, and `Ctrl+D` is how a browser bookmarks a page. `Ctrl+F`
*is* taken, and keeps being taken: a browser find searches the rendered
viewport, and CodeMirror has not drawn the lines below the fold, so
inside the editor the browser's one is the broken one.

Every key is also a row in the ⌨ menu beside the breadcrumbs, because a
shortcut nobody has been told about is a feature nobody has, and a
tablet has no Ctrl key. All of these are syntactic: they know where a
line starts and what the language's comment token is. There is no symbol
index, no go-to-definition and no IntelliSense, and the menu says so.

## Searching every file

The "Search files" tab, on any workspace with more than one file. Plain
text, grouped by filename, with case-sensitivity and whole-word
switches; clicking a result opens that file at that line and column.
Read-only files are searched and labelled, because the thing you
half-remember is quite likely in the interface the exercise gave you.

What it searches is whatever `js/wsfiles.js` says is on screen, and that
module is the point: Quick Open, the search and the ZIP download all ask
it the same question, so they cannot disagree about the answer. It is
built from sources that are visible by construction — `payload.files`
for a workspace, the design and the *sample* testbench for hardware, the
one document otherwise — rather than from everything filtered
afterwards. The grading harness and the reference design live under
`key` in the solution file and are not files in any workspace, so there
is no path from the search to them. `tests/browser/editing.test.mjs`
checks that by pulling a line that exists only in the grading harness,
typing it into the search, and expecting nothing.

There is no replace-across-files, deliberately. One typo applied to five
files, in editors with separate undo histories, is a bad afternoon;
`Ctrl+F` inside a file replaces within it.

## Comparing two versions

The Submissions tab compares any two saved submissions, or a submission
against what is in the editor now. `js/wsdiff.js` is a line diff — LCS
over lines, with the identical ends stripped first and long unchanged
runs folded into a gap — and for a workspace it runs per file, naming
the files that differ and reporting an added or deleted file as that
rather than as a file whose every line changed.

It compares and never writes. The draft, the editor and the stored
submissions are untouched by opening it, which is deliberate: a
comparison a reader is afraid to click is one they will not use.
Restoring is the separate **Load into the editor** button inside a
submission's own row, and it still asks first, because the draft it
would replace is the only copy of that draft.

A submission saved before programs were kept whole, or whose program
could not be written to storage, has nothing to compare. Those are
listed, labelled *no code kept*, and cannot be picked — rather than
appearing as an empty diff, which would read as "you changed nothing".

The draft side is what a submission of the draft *would* contain, not
everything on screen: the sample testbench and the reader's own
testbench are visible and are not part of a submission, so counting
them would report two deleted files on every comparison of a hardware
exercise.

## Downloading your code

**Download your code…** in the ⋯ menu writes a ZIP of the workspace,
at the relative paths the explorer shows, plus a `README.txt`.

`js/wszip.js` is about eighty lines: CRC-32, local headers, a central
directory, and STORE rather than deflate. A workspace here is a few
kilobytes of source, so the saving would be invisible, and a deflate
implementation is a thing that can be subtly wrong in a file somebody
only opens months later when they want their work back. The archive is
read back by `tests/browser/versions.test.mjs` with a reader that is
not the writer, and checked against a real `unzip` by hand.

The README names every file and its role, says how to build the thing
locally, and says where the browser differs — `-fno-exceptions` is on
in the browser and not in the g++ line; the browser runs under WASI
with no network and an empty filesystem; a local rustc differs in
backend and panic behaviour from the Cranelift build in the tab. Where
no local command has been checked for a language, it says so instead of
printing one that might not work. It is plain ASCII, because a `.txt`
lands on whatever machine the reader is on.

What goes in is `WsFiles.visible()` and nothing else, so the reference
solution, the grading harness and the hidden cases are not excluded by
a rule somebody could forget — there is no path from the ZIP writer to
them. The README says they are absent and where to find the ones the
reader is entitled to.

There is no ZIP *import*. A workspace is the set of files the problem
defines; accepting an arbitrary archive would make that untrue.

## Did it actually save?

`js/savestate.js`, which replaced three debounced timers that each
wrote "Saved" four hundred milliseconds after a keystroke without
looking at whether the write had worked. `Store.save()` has returned a
boolean and emitted `storage-error` the whole time; `Store.saveDraft()`
now returns it, and the row beside Submit reads it:

| | |
|---|---|
| `Saving…` | a write is in flight |
| `Saved on this device` | the write returned true |
| `Could not save` | it did not |

"On this device" is the whole truth about it: there is no account and
nothing is synchronised, so a different browser, a private window or
cleared site data is a different set of drafts. The tooltip says so.

On failure the editor keeps every character — nothing in that path
touches the document — and the row grows two buttons: **Try again**,
which re-runs the same write and reports what it says this time, and
**Download it**, which is the one route out that does not depend on the
storage that just refused. The sentence is said once per burst rather
than once per write: a draft is saved on every keystroke, so a full
quota used to put one toast on screen per character typed, over the
editor the reader was trying to rescue work from.

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
