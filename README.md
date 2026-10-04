# Systems Lab

A personal problems site for the knowledge a low-level systems developer is
expected to have: **C++** and **Rust**, computer architecture, operating
systems, Linux, compilers, HPC, distributed systems, FPGAs, algorithms and
system design.

Not only coding problems. Most of what matters in these subjects is not "write
a function" — it is *what does this print*, *where is the bug*, *what is the
miss rate*, *what does a partition actually cost you*. So there are nine kinds
of problem, and the coding ones compile and run real C++ and Rust.

The point is learning rather than scoring. **Every problem carries a
Prerequisites tab** naming the concepts it rests on, one sentence on why each
is needed *here*, and where to actually read it — book and chapter, not a vague
link. A problem you cannot do yet comes with the thing that fixes that.

Built as a static site with no dependencies and no build step, so GitHub Pages
serves it directly.

## What is in it

<!-- generated:counts -->
**85 problems** across 11 topics, 37 of them compiled and run in C++, Rust, Python, JavaScript. **91 concepts** carry **263 readings** between them, every one naming a book and a chapter or a specific page, with 33 more for learning a topic from scratch. **9 tracks** order subsets of the problems so there is always an obvious next one, and the weekly schedule runs to 2027-04-05.

```
Topics        cpp · rust · arch · os · linux · compilers · hpc · dist · fpga · algo · sysdesign
Difficulty    Beginner · Intermediate · Advanced
Types         mcq · multi · numeric · short · order · match · predict · locate · code
Total time    about 25 hours at the stated estimates
```
<!-- /generated:counts -->

Everything countable here is generated from the catalogue by
`node scripts/build-readme.mjs`, and `tests/content.test.mjs` fails if the
committed file has drifted. The first version of this section said "55 problems
across ten topics" by hand, and both numbers were wrong within a day.

<!-- generated:topics -->
| Topic | Problems | Code | Time |
| --- | --- | --- | --- |
| **C++** | 22 — 18 / 4 / 0 by difficulty | 13 | ~6 h |
| **Rust** | 6 — 3 / 2 / 1 by difficulty | 6 | ~3 h |
| **Computer Architecture** | 7 — 3 / 3 / 1 by difficulty | 2 | ~2 h |
| **Operating Systems** | 7 — 2 / 4 / 1 by difficulty | 2 | ~2 h |
| **Linux & Tooling** | 5 — 2 / 2 / 1 by difficulty | 0 | ~1 h |
| **Compilers & Interpreters** | 5 — 2 / 2 / 1 by difficulty | 1 | ~1 h |
| **HPC & Parallelism** | 5 — 2 / 2 / 1 by difficulty | 1 | ~1 h |
| **Distributed Systems** | 5 — 2 / 2 / 1 by difficulty | 0 | ~1 h |
| **FPGAs & Hardware** | 7 — 2 / 4 / 1 by difficulty | 3 | ~2 h |
| **Algorithms** | 11 — 5 / 5 / 1 by difficulty | 8 | ~4 h |
| **System Design** | 5 — 2 / 2 / 1 by difficulty | 1 | ~1 h |
<!-- /generated:topics -->

### The nine problem types

| Type | What it asks |
| --- | --- |
| `mcq` | One right answer, with the usual misconceptions as the wrong ones |
| `multi` | Several right answers, partial credit |
| `numeric` | A figure, within a tolerance |
| `short` | A word, a flag, a syscall name |
| `order` | Put the steps in sequence |
| `match` | Pair two columns |
| `predict` | Say exactly what this prints |
| `locate` | Click the offending line |
| `code` | Write a program; it is compiled and run against tests |

Adding a type is one file in `js/types/` and one row in `Catalog.TYPES`.

### C++

The largest topic, and the one aimed at a specific person: these problems
assume the language as far as *initialisation, fundamental types and sizes,
scope and shadowing, the preprocessor and header guards, functions, namespaces,
signed and unsigned integers, floating point, and unscoped enumerations* — and
**no further**. No loops, no `switch`, no arrays or vectors, no structs or
classes, no `auto`.

That is a real constraint and it rules out most of what a C++ exercise set
normally contains. What it leaves is the part that actually catches people:
`predict`-the-output problems about conversions and initialisation, `locate`
problems about shadowing and header guards, and one `code` problem that is
compiled by real `g++`.

The readings point at **learncpp.com chapter by chapter**, because that is the
course these problems are calibrated against.

### Prerequisites and reading

Concepts live once, in `data/concepts.json`, with a reading list each and a
`needs` list naming what *they* rest on. So prerequisites are transitive, and a
problem's Prerequisites tab shows the whole chain **in reading order,
foundations first** — you cannot start in the middle of one.

Readings are the canonical sources: OSTEP, CS:APP, TLPI and man7 for OS and
Linux; Crafting Interpreters and the Dragon Book for compilers; Harris & Harris
and HDLBits for FPGA; DDIA and MIT 6.824 for distributed; Hager & Wellein and
MIT 6.172 for HPC; CLRS for algorithms; cppreference and the Core Guidelines
for C++. Tick one off when you have read it; twenty unlocks something.

### Points, ranks and the shop

**XP** is cumulative and permanent and sets your rank. **Coins** are earned
alongside it and spent in the shop, so buying a theme can never cost you a
rank.

| | Beginner | Intermediate | Advanced |
| --- | --- | --- | --- |
| Base | 10 | 25 | 60 |

First attempt is **+50%**. Each hint costs **a quarter of the base**, and only
the first time you open it. Revealing the answer scores **zero** and records
the problem as *read* rather than *solved* — the same distinction the Learning
Tree draws with `independence`, and the reason the two are worth keeping apart.

Ranks: **Userland → Libc → Syscall → Kernel → Ring 0 → Systems Lab → Silicon**.

The shop sells cosmetics only — eight themes, accents, avatars, frames. Titles
are not for sale: they are granted by achievements, so wearing one is a claim
the record supports.

## Running it

```bash
npm install          # jsdom, for the tests only — the site itself has no dependencies
npm run serve        # python -m http.server 8000
```

Then open <http://localhost:8000>.

Serve it rather than opening `index.html` off disk: the problem files are
fetched, and browsers block `fetch` over `file://`. The page says so if that
happens rather than appearing empty.

### C++ and Rust: the runner

C++ and Rust compile and run on a small runner in this repo. **One command,
from this folder:**

```bash
npm run runner
```

That starts it under WSL Ubuntu — no Docker needed. It checks the toolchain
first and prints what is missing with the command that installs it, then
listens on `127.0.0.1:2000`:

```
  ok    node     v18.19.1
  ok    g++      g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
  ok    rustc    rustc 1.99.0 (b940084d7 2026-09-28)
  ok    python   Python 3.12.3
  ok    prlimit  prlimit from util-linux 2.39.3
  ok    sanitizers available (-fsanitize=address,undefined links)
```

WSL rather than Docker because the sanitizers link there and do not under
MinGW, and because `prlimit` is available for the resource caps. Docker still
works if you prefer it:

```bash
docker compose -f judge/compose.yml up -d
```

Then **Settings ▸ Code execution ▸ Check connection**. JavaScript and Python
run in the tab and need nothing; C++ and Rust need the runner. With it down the
site says so, gives that one command, and everything else goes on working — the
six non-executing types cover a lot of C++ knowledge on their own.

The runner compiles with real `g++` and `rustc`, returns the compiler's
warnings **even on a successful build**, and can require a program to be clean
under AddressSanitizer as well as correct. That last one is the reason it is
ours rather than Piston or Judge0, both of which run fixed compile commands.
See [judge/README.md](judge/README.md).

#### It is restricted to this machine, deliberately

The only code it ever runs is code you wrote, on your own computer, and it is
built on that assumption rather than as a hardened sandbox:

- **Loopback only.** It binds `127.0.0.1` and refuses to start on any other
  address.
- **A token per start.** It writes a fresh one into `data/judge-token.json`,
  which the page reads from the repository folder. Every endpoint except
  `/health` requires it. `/health` is open on purpose, so the page can tell
  "nothing is listening" from "listening and refusing me" — two states that
  need different advice.
- **Origin checked.** Requests from an origin that is not loopback or a
  `github.io` page are rejected.
- **Resource caps** through `prlimit`: process count, file size, open files,
  and an address-space cap on the program being run. Not on the compiler, and
  not on a sanitized run — AddressSanitizer reserves about 20 TB of virtual
  address space and dies under any cap worth setting.

`data/judge-token.json` is in `.gitignore`. It is not the security boundary —
anything able to read it already runs as you — the Origin check is.

**Never expose it to a network.** It runs arbitrary code by design.

### Running from another device: Judge0

If you want C++ from a phone, a borrowed laptop, or a machine where you cannot
start the runner, `data/config.json` has a `judge0` block. It is **off by
default** and nothing has been provisioned.

The public endpoint at `https://ce.judge0.com` was probed rather than read off
the documentation, which understates it badly:

| | documented | measured |
| --- | --- | --- |
| C++ | GCC 9.2.0 | **GCC 14.1.0** |
| Rust | 1.40.0 | **1.85.0** |
| Python | — | 3.13.2 |

Everything this site needs works there: `-std=c++23` (and `__cplusplus`
reports `202302`), `-Wall -Wextra` with warnings returned on a **successful**
build, `--edition 2021`, stdin, and `-fsanitize=address,undefined` — which
links *and fires*, once `memory_limit` is raised, for the reason above. Compile
errors arrive as status 6 with the text in `compile_output`, runtime errors as
11, timeouts as 5. `tests/judge0.test.mjs` checks the flags this adapter sends
are character-for-character the ones the local runner uses, so a problem cannot
mean two different things depending on which backend answered.

**Cost and accounts.** The public endpoint needs **no account and no API key**,
so there is no secret for a static page to leak. It is rate limited: six
submissions in quick succession got the connection reset, and four seconds of
spacing was enough. Judge0's RapidAPI plans need a RapidAPI account and are
pay-per-use; a key for those must **not** go in `data/config.json`, which is
served to the browser. Put it behind a proxy and set `judge0.proxyUrl` — the
adapter then sends no key itself.

Two things to be deliberate about: it is one compile per test case rather than
one compile for all of them, so it is slower; and your submission goes to a
third party. For these problems that is uninteresting, and it is still true.

## The editor

Code problems get syntax highlighting and real compiler diagnostics.

**Highlighting** is a coloured `<pre>` sitting exactly behind a transparent
`<textarea>`, scroll-synced. The textarea keeps the caret, selection, undo, IME
and mobile keyboards — which is the whole reason to do it this way rather than
reimplementing an editor over a `contenteditable` div. The catch is that any
metric set on one layer and not the other makes text sit beside its own colour,
so the metrics are declared once in a rule targeting both and
`tests/browser/styles.test.mjs` fails if a later rule sets one of them on a
single layer.

**Linting** has two tiers:

- A **bracket scanner** runs on every keystroke. It understands comments and
  string literals, so a brace in a comment is not reported, and it points at
  the line where an unclosed brace was *opened* rather than at end of file
  where the compiler points.
- The **real compiler**, through the judge's `/lint` endpoint: `g++
  -fsyntax-only`, `rustc --emit=metadata`, `py_compile`, `node --check`. Its
  diagnostics replace the local guess, with line and column, and clicking one
  jumps the caret there. So the message you get while typing is the message a
  build would give you.

The editor also closes brackets, steps over a closer you type where one already
sits, puts a lone closer on its own line, and keeps a separate draft per
language.

## Tracks, the weekly problem, and resources

With this many problems the hard part is choosing one, so the dashboard answers
that twice — **Continue learning** and **This week** — and three data files back
it up:

- **`data/tracks.json`** — ordered sets of problems that build on each other.
  Each card reports Not started, Attempted or Completed, and an untouched track
  is never described as under way. An id naming a problem that does not exist
  yet is dropped rather than rendered as a dead row, and
  `tests/content.test.mjs` fails on one so a typo cannot hide behind that.
- **`data/weekly.json`** — one problem per week, with a sentence on why that one
  now. The site shows the latest entry whose Monday has arrived, so the file can
  run ahead without giving anything away.
- **`data/resources.json`** — where to *learn* a topic, as opposed to the
  per-concept readings. "Where do I learn C++" and "where do I read about
  alignment" are different questions and get different answers.

<!-- generated:tracks -->
| Track | Problems | What it is for |
| --- | --- | --- |
| **C++ foundations** | 10 | The language as far as your notes go: initialisation, types and sizes, scope, linkage, namespaces and enums. |
| **Writing C++, a step at a time** | 12 | Twelve programs in prerequisite order: a condition, then a loop, then a function, then a container. |
| **Building what the library gives you** | 6 | The standard library's simplest tools, written out: a search, a count, a binary search, a stack, a ring buffer and a growable array. |
| **Simulating the machine** | 6 | Six small programs that each stand in for a piece of real hardware or a real kernel: byte order, cache lookup, page replacement, CPU scheduling, a state machine and a shift register. |
| **Rust foundations** | 6 | Ownership, borrowing, slices, Option, Result and the ? operator - in that order, because each one is the answer to a question the previous one raises. |
| **First steps** | 10 | Ten problems across the whole site, chosen so that each one needs only what the one before it taught. |
| **How memory really behaves** | 8 | Alignment, cache lines, locality, virtual memory and the page-fault path — the thread that runs from sizeof all the way to a 4.5x slowdown from a loop order. |
| **What the standard does not promise** | 7 | Signed overflow, integer promotions, out-of-bounds reads, and the optimiser deleting a check you wrote. |
| **Problems you write code for** | 7 | Every code problem on the site, easiest first. |
<!-- /generated:tracks -->

### The workspace

A `code` problem opens as two panels — the statement beside the editor — with a
divider you can drag, or move with the arrow keys, `Home`, `End` and `Enter` to
reset. The position is remembered. **Run samples** and **Submit** sit together
in a bar that sticks to the bottom of the editor column, so neither is ever
below the fold on a long statement.

Compiler output is parsed into a list of places with a severity and a line you
can click to jump the caret there, with the compiler's own words kept
underneath — the caret diagrams and the template backtraces are sometimes
exactly what you need. Hints and your notes appear as disclosures under the
statement as well as in their tabs, so reading a hint does not mean losing
sight of the code.

`F` toggles **focus mode**, which hides the header and the side rail and gives
the problem the whole window. `Escape` leaves it. Both the split and focus mode
are stored under `systems-lab/ui/v1`, separate from progress, so a bad value
there can never cost a solve.

## Writing a problem

One file per problem, so a diff is readable.

```
problems/<topic>/<id>.json     the problem — no answer in it
solutions/<id>.json            the answer key, the explanation, hidden cases
data/concepts.json             concepts, their readings, and what each needs
data/index.json                GENERATED — run npm run build:index
```

```jsonc
// problems/os/os-page-fault-walk.json
{
  "id": "os-page-fault-walk",
  "title": "What happens on a page fault",
  "topic": "os",
  "difficulty": "beginner",
  "type": "order",
  "tags": ["virtual-memory", "paging"],
  "estimate": 8,
  "prereqs": [
    { "concept": "page-faults", "why": "This is the fault path itself." }
  ],
  "statement": "markdown, with fenced code blocks",
  "hints": ["a nudge", "a bigger nudge"],
  "payload": { "items": ["…", "…", "…"] }
}
```

```jsonc
// solutions/os-page-fault-walk.json
{
  "key": { "order": [1, 3, 6, 4, 0, 5, 2] },
  "explanation": "the teaching, in markdown — this is the point of the site",
  "distractors": { "1": "why this wrong option is attractive and wrong" },
  "readMore": [{ "concept": "page-faults", "where": "OSTEP ch. 21–22" }]
}
```

Then:

```bash
npm run build:index
npm test
```

### Having the test check your key for you

Two kinds of key can be verified absolutely rather than trusted, and both are
worth using:

- A **`code`** problem's key carries a `reference` solution per language it
  claims. `tests/content.test.mjs` compiles and runs each one against the
  problem's own hidden cases, so a problem nobody can solve fails the build.
- A **`predict`** problem can set `payload.verifyAs: "cpp"` when its snippet is
  a complete program. The test then compiles it and compares the real output
  against the key. Add `payload.verifyPlatform: "linux"` for a POSIX snippet —
  one using `fork` will not build on a MinGW toolchain, so it is skipped
  locally with a notice and verified on Linux in CI.

Both have already caught a wrong key: a hand-written expected output with two
digits transposed, and a line break written as the two characters `
` instead
of a newline. Neither is findable by reading.

### Why the answer lives in a separate file

Because then it is not in the page you are reading. It is still fetchable if you
go looking — a site with no backend cannot do better than that — but it raises
seeing the answer from *accidental* to *deliberate*, which is all that is needed
when you are the only user. Hidden test cases for `code` problems live there
too, so passing the samples is not the same as solving it.

## Tests

```bash
npm test
```

| Suite | What it covers |
| --- | --- |
| `tests/store.test.mjs` | Scoring, hint penalties, streaks across day and timezone boundaries, the shop, achievements, the export shape |
| `tests/md.test.mjs` | The markdown renderer and the highlighter, with the escaping cases first |
| `tests/grade.test.mjs` | Every grader, driven directly — they are pure for exactly this reason |
| `tests/runner.test.mjs` | Output comparison, and that a timeout, a crash, a build failure and a wrong answer stay four different things |
| `tests/judge.test.mjs` | The runner against real toolchains, skipping what this machine lacks |
| `tests/judge0.test.mjs` | That the Judge0 adapter sends character-for-character the same compiler flags as the local runner; `JUDGE0=1` also probes the live service |
| `tests/contrast.test.mjs` | Every text colour against every surface it is used on, for all 8 themes and all 40 theme-and-accent combinations the shop can produce, at WCAG AA |
| `tests/content.test.mjs` | Every problem and key: the schema, the concept graph, that tracks and weekly entries name problems that exist, that the README matches the catalogue, and that **each key is graded correct by its own grader** and each `code` reference solution actually passes |
| `tests/browser/app.test.mjs` | The whole journey in jsdom: browse, filter, bookmark, open, read prerequisites, take a hint, answer wrongly, answer rightly, preview a theme, spend the coins |
| `tests/browser/styles.test.mjs` | That every theme defines every token and can be previewed from it, every `var(--x)` resolves, and `[hidden]` still wins |
| `tests/browser/states.test.mjs` | The page with nothing solved, part solved, all solved and with the content missing — every view in each — plus keyboard reachability, focus rings and the narrow-screen rules |
| `tests/browser/runner.test.mjs` | The real browser-to-runner path with the runner up: a passing submission, a compile error, a runtime error, a timeout, a sanitizer trip, and the workspace driven the way a person drives it |

`content.test.mjs` is the one that matters most. Hand-written JSON and a shared
concept graph will not stay consistent on good intentions, and a broken problem
is not a crash — it is a problem that silently cannot be solved.

Two of its checks are worth naming. It feeds **each answer key back through the
real grader** and insists the grader calls it correct, which catches a key that
is valid in shape but wrong — an `order` permutation written in the wrong
direction, say. And it then feeds a **deliberately wrong** answer through and
insists it is marked wrong, because a grader that accepts everything would pass
the first check and be useless.

## Layout

```
index.html              markup for every view
css/styles.css          design tokens, base, components
css/themes.css          one token block per purchasable theme
js/store.js             progress, scoring, the shop, persistence
js/md.js                markdown, escaped first
js/highlight.js         syntax colouring for displayed code
js/catalog.js           the index, the concept graph, lazy problem loading
js/runners/harness.js   output comparison and verdicts — pure, and tested alone
js/runners/index.js     where each language runs: a Worker here, or the judge
js/lint.js              brackets locally, the real compiler through the judge
js/editor.js            highlighting overlay, gutter, diagnostics
js/types/registry.js    the problem-type contract
js/types/*.js           one file per problem type
js/problem.js           a problem: its tabs, submitting, the verdict
js/views.js             dashboard, catalog, reading map, profile, shop, settings
js/app.js               bootstrap, hash routing, shortcuts
js/runners/judge0.js    the hosted fallback backend, off by default
judge/                  the local C++/Rust/Python runner (WSL, or Docker)
judge/run-wsl.sh        the toolchain check and one-command start
problems/<topic>/*.json one file per problem, no answer in it
solutions/*.json        keys, explanations and hidden cases
scripts/build-index.mjs generate and validate the catalog
scripts/build-readme.mjs regenerate the counted sections of this file
```

## Keyboard

| Key | Action |
| --- | --- |
| `/` | Search the problems |
| `g` | Dashboard |
| `p` | Problems |
| `r` | Reading |
| `t` | Tracks |
| `u` | Profile |
| `s` | Shop |
| `f` | Focus mode — hide everything but the problem |
| `Escape` | Leave focus mode, or leave the field you are typing in |
| `Ctrl+Enter` | Run the samples (in a code problem) |
| `Ctrl+Shift+Enter` | Submit |

In the workspace, the panel divider is in the tab order: arrow keys move it,
`Shift` moves it faster, `Home` and `End` go to the limits, and `Enter` resets
it. A separator only a mouse can move is one half the people using a page
cannot.

## How data is stored

There is no backend. Three separate `localStorage` keys, on purpose:

| Key | Holds | Why separate |
| --- | --- | --- |
| `systems-lab/state/v1` | progress, XP, coins, what you own | the thing worth keeping; **Settings ▸ Export** writes it out as `data/progress.json` |
| `systems-lab/judge-url` and `/judge-token` | where the runner listens, and its token | properties of the machine, not of your progress, so they never travel in an export |
| `systems-lab/ui/v1` | the panel split, focus mode | per-device view preferences; a bad value here can never cost a solve |

Progress from the old `bare-metal/state/v1` key is migrated on first load, so
nothing was lost when the site was renamed.

Solves also export in the shape
[`work-tracker`](../work-tracker)'s **Data ▸ Import solved problems** already
accepts, under the source `systems`, with difficulty mapped onto its
easy/medium/hard and hint usage onto its `independent`/`hint`/`solution`.
Identity is `source` + `problemId`, so re-importing is a no-op rather than a
duplicate. Add `systems` once as a custom source there so it shows a label
rather than the bare id.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`, which installs, runs the
whole suite — with the C++ and Rust reference solutions compiled for real on
`ubuntu-latest`, which already has the toolchains — checks that the committed
`data/index.json` matches the problem files, and only then publishes to Pages.

A failing suite stops the deploy, so the live site never moves ahead of a
broken commit. Pages is configured with **GitHub Actions** as its source, not
"deploy from a branch"; `.nojekyll` stops Pages running the content through
Jekyll.

CI also checks the two generated files are current — `data/index.json` and the
counted sections of this README — so neither can drift from the content.

The runner is **not** deployed. It is a local service, and the published site
reaches it on loopback: browsers exempt loopback *addresses* from
mixed-content blocking, which is why the default is `http://127.0.0.1:2000`
rather than `localhost`. From a device that cannot reach your machine, the
Judge0 backend is the answer — see above.
