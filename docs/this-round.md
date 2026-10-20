# This round, item by item

The eight items of the brief, what was built for each, and what was
not. Written as a checklist because the brief asked for one, and kept
because the "what was not" column is the part that is easy to lose.

Three commits:

| | |
|---|---|
| `94f2222` | Either panel can have the window to itself |
| `e217853` | Find, replace, go to line, search every file, compare, download, and whether it saved |
| `e966ac0` | Projects get their own catalogue, and C++ gets a beginning |

Items 2 and 3 share a commit because they share generated files —
`data/index.json`, `data/tracks.json`, the README and
`docs/coverage.md` all carry both, and splitting them would have meant
a commit whose own checks do not pass.

---

## 1. Collapse either workspace panel

**Done.** Three states on one attribute — Description, Split, Code —
with a segmented control in the header, `Alt+D` and `Alt+E` toggling
their own panel between "alone" and "both", and an unknown value
falling back to Split. Neither shortcut can hide everything.
`splitFraction` is untouched by folding, so coming back to Split finds
the statement at the width it was dragged to. CodeMirror is
re-measured on every change. Run, Submit and Reset moved out of the
code column and under both panels, because hiding the code column is
a thing a reader can do now.

Verified at 320px, 900px and 1440px on a single-file exercise, a
multi-file project and an HDL design, in all three modes. The
catalogue and the Learn graph carry no `--split`, no `data-workspace`
and no `.ws-body`.

**Two defects found on the way, both older than this round.**
Switching language while a run was in flight left Run disabled saying
"Running…" until a reload. And a problem page scrolled sideways at
320px, because the explicit grid placements survived into the
one-column media query and pinned the editor into an auto-sized
implicit third column.

## 2. Organise Projects separately from Learn

**Done.** The four project tracks carry `kind: "project"`;
`Catalog.learnTracks()` is what Learn draws and `Catalog.allProjects()`
is what `#/projects` draws. One card per project with language,
difficulty, description, milestone progress and a Start/Continue that
names the milestone it opens; language, difficulty and progress
filters that live in the hash. An overview per project with its goal,
what it rests on, its file structure and its milestones in order.
Prerequisites link into Learn; nothing links the other way.
`#/learn/project-*` and `#/tracks/project-*` redirect to the overview.

Every problem id, milestone link, draft, submission and completion
record is unchanged, and `browser/projects` proves it by writing a
draft, recording a submission and marking a milestone solved, then
checking all three survive.

**Not done, on purpose.** Project milestones still appear in the
`#/problems` catalogue, under a filter now labelled "Project
milestones" rather than "Projects". They are problems; hiding them
from the problem list would be a different claim than the brief made.

## 3. Twenty-four beginner C++ exercises

**Done.** Six bands of four: arithmetic and conversions, conditions,
loops, functions, strings and vectors, references. All single-file,
C++ only, using nothing not yet shown. Integrated into
`cpp-first-programs`, which went from twelve problems to thirty-six,
with the twelve that were there placed in the band they belong to
rather than pushed to the end.

Expected output was computed twice, by a Python oracle and by the C++
reference, and nothing was written until the two agreed on every case.
Every reference then went through the browser's clang: `audit:cxx`
reports 67 of 68 C++ problems runnable in the browser, the one
exception being a pre-existing sanitizer problem.

See `docs/coverage.md` for the per-exercise table and the grading
limits.

## 4. Practical editor features

**Done.** `@codemirror/search` is in the vendored bundle (669 → 730
KB), so find and replace is the library's own panel over the whole
document. `Ctrl+F`, `F3`, `Ctrl+Alt+G`, `Ctrl+]`, `Ctrl+[`, `Ctrl+/`,
`Alt+Z`, plus Quick Open on `Alt+P` and a breadcrumb strip naming the
active file. Every one is also a row in a menu beside the
breadcrumbs, because a shortcut nobody has been told about is a
feature nobody has.

`Ctrl+D` and `Ctrl+Shift+L` are deliberately **not** bound — the
browser is using the first. `Ctrl+F` is bound and stays bound: a
browser find searches the rendered viewport, and CodeMirror has not
drawn the lines below the fold.

The menu says in as many words that these are text tools and that
there is no symbol index behind them.

## 5. Search across workspace files

**Done.** A "Search files" tab on any workspace with more than one,
plain text, grouped by filename, with case-sensitivity and whole-word
switches. Clicking a result opens that file at that line and column.
Read-only files are searched and labelled. No replace-across-files.

`js/wsfiles.js` is the single answer to "what is on screen", shared
with Quick Open and the ZIP so the three cannot disagree. It is built
from sources that are visible by construction rather than from
everything filtered afterwards. `browser/editing` proves the negative
by pulling a line that exists only in the grading harness, typing it
into the search, and expecting nothing.

## 6. Compare submissions

**Done.** Any two saved submissions, or a submission against the
current draft. Per-file for a workspace, with added and deleted files
reported as that rather than as a rewrite, long unchanged runs folded,
and the match marked by a sign as well as a colour. It never writes:
`browser/versions` checks the draft, the editor and the stored
submissions are byte-identical afterwards. Restoring is still the
separate button in the submission's own row and still asks first. A
submission with no stored program is listed, labelled, and cannot be
picked.

## 7. Download your project

**Done.** `js/wszip.js` writes a ZIP by hand — CRC-32, local headers,
a central directory, STORE rather than deflate — of exactly what
`WsFiles.visible()` says is on screen, at the paths the explorer
shows, plus a plain-ASCII README naming every file and its role.

Build instructions only where checked: a real `g++` line for C++ and
a real `iverilog` line for SystemVerilog, each with the differences
from the browser spelled out. A language whose local story has not
been verified gets a paragraph saying so instead of a command.

Verified against Python's `zipfile`, Windows `Expand-Archive`, and a
reader in the test that is not the writer.

**Not done, as the brief allows.** No ZIP import.

## 8. Clear save status

**Done.** `Store.saveDraft()` returns what storage said, and
`js/savestate.js` reads it: `Saving…`, `Saved on this device`, `Could
not save`. On failure the editor keeps every character and the row
grows **Try again** and **Download it**. Said once per burst rather
than once per keystroke.

This replaced three debounced timers that each wrote "Saved" four
hundred milliseconds after a keystroke without looking at whether the
write had worked.

---

## The two counts that were wrong on purpose

Both were test assertions with the number written into them, and both
now read the catalogue:

- `browser/maths` — "filtering to Mathematics leaves 24" now counts
  `data/index.json` by subject.
- `browser/landing` — "mathematics and coding is the empty case" was
  never going to be empty again, because two coding exercises are
  filed under mathematics topics on purpose. It now checks the two
  filters really intersect, with the number from `Catalog.all()`.

Nothing displayed on the site is a written-down total. The Content
menu counts `Catalog.all()`, `learnTracks()`, `allConcepts()` and
`allProjects()`; the landing page uses `Catalog.counts()`; the README
is generated and checked by `build-readme --check`; `data/index.json`
is generated and checked by `check:index`.

The numbers that remain written down in tests are claims about the
deliverable rather than totals — `browser/cppbasics` asserts there are
twenty-four exercises and a track of thirty-six, which is the contract
and should fail if it changes.
