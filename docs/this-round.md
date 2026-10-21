# This round: grading that can be trusted, and one failure chased down

Four items. No new editor features and no new content batch — the
work was making the grader check what the exercises claim, and
finding out what actually happened the one time the deployed site
failed a test.

The previous round's eight-item checklist is below, kept because its
"what was not done" column is the part that is easy to lose.

---

## 1 and 2. Requirements the output cannot show

An exercise graded by comparing printed characters cannot tell
`power(base)` from `power(base, 2)`, cannot tell `addAll` adding
from `addAll` setting when the caller always starts at zero, and
cannot tell `summarise` writing through its references from
`summarise` printing the report itself. Three exercises said so in
their statements and left it there; five more had the same hole and
had not noticed.

All eight now carry a **probe**: a `main` the problem owns,
compiled with the submission, calling the functions the statement
named. `js/runners/probe.js` is the composition — the submitted
`main` renamed by macro and never called, every header it asked for
hoisted above the rename so the macro cannot touch library text,
`#line` so diagnostics inside somebody's own code still name their
own lines. One translation unit, so every backend compiles it like
any other single file and nothing in the runner layer had to change.

It runs on Submit, after the input cases pass, and its results join
the same list of rows under names of their own — "power with one
argument" — with "how it was called" where the stdin would be.

**Fifteen wrong programs, in `tests/probe-rejects.json`**, are the
evidence that it works. Each is one the old grader accepted, and
`tests/content.test.mjs` compiles every one with a real compiler and
checks both halves of the claim: that it still passes every input
case, and that it is now rejected. Fourteen go to a probe — five of
those do not compile against the harness, nine answer a direct call
wrongly — and the fifteenth is caught by the input case that was
missing.

`cpp-vector-above-mean` was a plainer gap: its statement says the
total "has to be a `long long`" and no case was bigger than two
values. There is now one of 2,200 values of a million.

**What is still not checked** is written into each statement under
**What the grader checks** — which calls a submission's own `main`
makes, and whether `lcm` calls `gcd` or repeats the loop. No probe
matches source text and none will: a regex over somebody's program
rejects valid code for looking unusual. `docs/coverage.md` has the
per-exercise table.

## 3. The journey a reader actually walks

`tests/browser/journeys.test.mjs` needs a hosted runner, which the
published site does not have and most machines are not running. It
used to exit 1 when it could not find one, putting a red line in a
sweep for a machine configured exactly like production. It now says
**NOT RUN — 0 passed, 0 failed** and exits 0, and names the suite
that does cover the default path.

That suite is **`tests/browser/journeys-cpp.test.mjs`**, 47 checks,
needing nothing but `npm run serve`: the homepage to an exercise by
the links that are on it, real keystrokes, Run on the clang in the
tab, a program that does not build (the compiler-output pane opens
by itself, the diagnostics are a list of places, and the Results
pane says it did not build rather than scoring it zero), a program
that does not stop and stopping it, a language change and back, a
reload, Submit, and finally the direct calls rejecting a program
whose printed output is right.

## 4. The one deployed failure

`browser/workspace` failed one assertion against the deployed site —
"there is still an editor", which looks for `.cm-editor` — and
passed on a re-run. Calling that a network flake was a guess.

**What the evidence says.** `render()` in `js/types/code.js` is
synchronous: it sets `state.problem` and builds the editor in one
tick. The two assertions either side of the failing one passed, so
`state.problem` was the new problem — a half-finished mount cannot
explain it. The suite's own "no uncaught errors" check also passed,
so nothing threw. The only path left is `Editor.create` taking its
textarea fallback, which happens when `window.CM` is falsy, which
happens when `vendor/codemirror.js` did not load. `.cm-editor` is
named in exactly one assertion in that file, which is why one check
failed and eighty-five did not.

**What was confirmed.** Blocking that one script reproduces the
signature exactly: `.cm-editor` absent, the type reporting
single-file, no page errors. So the mechanism is certain.

**What was not.** Ten runs against the deployed site did not
reproduce the occurrence. I cannot say that is what happened that
day, only that it is the one state consistent with what was
recorded. The original run kept no page-level artefact, which is
its own lesson.

**What changed because of it.**

- The fallback's status line said "Everything else works", which
  stopped being true when find, replace, Quick Open, go to line and
  comment toggling arrived — all of them are no-ops on that path.
  It now names what is missing, says that what you type is still
  saved on this device, and carries a **Reload the page** button,
  because one asset failing to arrive is what this almost always is.
- The draft question was checked rather than assumed: text typed
  into the fallback goes through the same `Store.saveDraft`, and it
  is still there after a reload that gets the real editor back.
  `browser/editing` has a section that blocks the script and proves
  all of it.
- The assertion that failed now carries the editor backend and
  `window.CM` in its own name, so a repeat says which of the two
  things went wrong instead of costing another day.

---

# The round before: eight items

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
