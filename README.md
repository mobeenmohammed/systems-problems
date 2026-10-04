# Systems Lab

A personal problems site for the knowledge a low-level systems developer is
expected to have: **C++**, computer architecture, operating systems, Linux,
compilers, HPC, distributed systems, FPGAs, algorithms and system design.

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

**55 problems** across ten topics. **63 concepts** carry **184 readings** between
them, every one naming a book and a chapter or a specific page. **5 tracks**
order subsets of the problems so there is always an obvious next one, and one
problem is featured each week.

```
Topics        cpp · arch · os · linux · compilers · hpc · dist · fpga · algo · sysdesign
Difficulty    Beginner · Intermediate · Advanced
Types         mcq · multi · numeric · short · order · match · predict · locate · code
```

| Topic | Problems |
| --- | --- |
| **C++** | Four ways to initialise a variable `predict`, Nought point one plus nought point two `predict`, The variable that is not the variable you meant `locate`, Three minus five, unsigned `predict`, What the standard actually guarantees about sizes `multi`, Your first compiled C++ problem `code`, Compiler error, or linker error? `multi`, The header guard that guards the wrong thing `locate`, What an unscoped enumerator really is `predict`, Which function gets called? `predict` |
| **Computer Architecture** | How big is this struct? `numeric`, How often does a sequential walk miss? `numeric`, The ceiling on 64 cores `numeric`, Which instruction has to stall? `locate`, Two threads, one cache line `multi` |
| **Operating Systems** | What happens on a page fault `order`, printf, then fork `predict`, Two locks, two orders `locate`, Which scheduler behaves like that? `match`, Memory after a fork `numeric` |
| **Linux & Tooling** | Count the distinct clients `short`, Spell that permission in octal `numeric`, Read the strace and say what is wrong `mcq`, What the shell does, in order `order`, Killed at 2 GB on a 64 GB machine `multi` |
| **Compilers & Interpreters** | Source to running program `order`, Write the lexer `code`, Make signed overflow behave `short`, The arithmetic is not the arithmetic you wrote `predict`, The safety check that -O2 removes `locate` |
| **HPC & Parallelism** | Compute-bound or memory-bound? `numeric`, Which loop order, and why `mcq`, Running totals `code`, Which collective is that? `match`, The fewest lines a transpose can move `numeric` |
| **Distributed Systems** | Order the events by their Lamport clock `order`, What a partition actually costs you `mcq`, How a Raft leader gets elected `order`, The retry that charges twice `locate`, How many replicas must a read consult? `numeric` |
| **FPGAs & Hardware** | The shift register that is not a shift register `mcq`, What is each block for? `match`, A sequence detector, as a state machine `code`, The fastest this design can be clocked `numeric`, Throughput of a pipelined block `numeric` |
| **Algorithms** | Running maximum, without reading past the end `code`, What does that operation really cost? `match`, An LRU cache with no scanning `code`, The binary search that breaks on big arrays `locate`, How much memory for a sieve to a billion? `numeric` |
| **System Design** | How much storage a day? `numeric`, Put these in order of how long they take `order`, What at-least-once actually promises `multi`, Which caching policy is that? `match`, A token bucket rate limiter `code` |

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

### C++ and Rust

Those compile and run on a small judge in this repo, under Docker:

```bash
docker compose -f judge/compose.yml up -d
```

Then **Settings ▸ Check**. JavaScript runs in a Web Worker in the tab and needs
nothing; C++ and Rust need the judge. With Docker down the site says so and
gives the command, and everything else goes on working — the six non-executing
types cover a lot of C++ knowledge on their own.

The judge runs your submissions with real `g++` and `rustc`, returns the
compiler's warnings **even on a successful build**, and can require a program
to be clean under AddressSanitizer as well as correct. That last one is the
reason it is ours rather than Piston or Judge0, both of which run fixed compile
commands. See [judge/README.md](judge/README.md).

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

With fifty-odd problems the hard part is choosing one, so three things answer
that:

- **`data/tracks.json`** — ordered sets of problems that build on each other.
  Each shows progress and the next unsolved problem. An id that names a problem
  which does not exist yet is dropped rather than rendered as a dead row.
- **`data/weekly.json`** — one problem per week, with a sentence on why that one
  now. The site shows the latest entry whose Monday has arrived, so the file can
  run ahead without giving anything away.
- **`data/resources.json`** — where to *learn* a topic, as opposed to the
  per-concept readings. "Where do I learn C++" and "where do I read about
  alignment" are different questions and get different answers.

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
| `tests/judge.test.mjs` | The judge against real toolchains, skipping what this machine lacks |
| `tests/content.test.mjs` | Every problem and key: the schema, the concept graph, and that **each key is graded correct by its own grader** and each `code` reference solution actually passes |
| `tests/browser/app.test.mjs` | The whole journey in jsdom: browse, filter, open, read prerequisites, take a hint, answer wrongly, answer rightly, spend the coins |
| `tests/browser/styles.test.mjs` | That every theme defines every token, every `var(--x)` resolves, and `[hidden]` still wins |

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
judge/                  the local C++/Rust/Python judge (Docker)
problems/<topic>/*.json 55 problems
solutions/*.json        keys and explanations
scripts/build-index.mjs generate and validate the catalog
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
| `Ctrl+Enter` | Run the samples (in a code problem) |
| `Ctrl+Shift+Enter` | Submit |

## How data is stored

There is no backend. Progress lives in `localStorage`; **Settings ▸ Export**
writes a snapshot you can carry to another machine or commit as
`data/progress.json`. Where your judge listens is kept separately, because that
is a property of the machine and not of your progress — so it never travels in
an exported snapshot.

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

The judge is **not** deployed. It is a local service, and the published site
reaches it on loopback.
