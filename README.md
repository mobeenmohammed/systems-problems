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
**109 problems** across 13 topics, 37 of them compiled and run in C++, Rust, Python, JavaScript. **115 concepts** carry **316 readings** between them, every one naming a book and a chapter or a specific page, with 33 more for learning a topic from scratch. **11 tracks** order subsets of the problems so there is always an obvious next one, and the weekly schedule runs to 2027-04-05.

```
Topics        cpp · rust · arch · os · linux · compilers · hpc · dist · fpga · algo · sysdesign · metric · prob
Difficulty    Beginner · Intermediate · Advanced
Types         mcq · multi · numeric · short · order · match · predict · locate · code · approx · counterexample · exact · proof · proofsteps · structured
Total time    about 29 hours at the stated estimates
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
| **Metric Spaces** | 12 — 5 / 5 / 2 by difficulty | 0 | ~2 h |
| **Probability** | 12 — 4 / 8 / 0 by difficulty | 0 | ~2 h |
<!-- /generated:topics -->

## Two subjects

The top bar switches between **Systems** and **Mathematics**. It is a lens
rather than a separate account: progress, bookmarks, the weekly problem and
search are all shared, and searching deliberately crosses subjects — looking
for "bayes" from the Systems side finds it, and the catalogue says that is
what happened.

A problem's subject is **derived from its topic** rather than being a second
field on every file, because two fields that have to agree eventually
disagree.

### Mathematics

Twenty-four problems to start, in prerequisite order, across two topics.

**Metric spaces** — the axioms and what breaks them, the Euclidean, discrete
and maximum metrics, open balls and the ambient space, open and closed sets
(including the ones that are both and the ones that are neither), convergence
and the uniqueness of limits, Cauchy sequences and completeness, continuity,
and a first look at compactness.

**Probability** — sample spaces and counting, conditional probability and
Bayes, independence against mutual exclusivity, discrete distributions,
indicator variables, variance, joint distributions, and a first continuous
one.

Both are tracks, so there is an obvious next problem rather than twenty-four
to choose from.

Everything is typeset with **KaTeX** (`vendor/katex`, MIT, 605 KB with the
non-woff2 faces dropped) — statements, hints, options, feedback and solutions.
Every expression also emits a hidden MathML copy, which is what a screen
reader actually reads.

### Six answer formats for mathematics, and what each will and will not claim

| type | checked how |
| --- | --- |
| `exact` | an exact value. `3/8`, `0.375`, `6/16` and `C(4,2)/16` are one answer |
| `approx` | to a tolerance **stated in the question** — a separate type, so it cannot be forgotten |
| `structured` | a set or a union of intervals, compared as the thing it is |
| `proofsteps` | a proof with its justifications removed; put each one back |
| `counterexample` | built field by field, with the parts that can be checked, checked |
| `proof` | written out. **Saved, never marked.** |

#### How equality is decided

`js/maths/expr.js` is a tokeniser, a parser and an evaluator over an exact
value domain: numbers of the form $p + q\sqrt{d}$ with $p, q$ rational and
$d$ square-free. That field is closed under $+ - 	imes \div$, so comparing
two answers is a **decision procedure** and not a guess.

Three things it deliberately does not do:

- **No `eval`.** The grammar is written out, production by production. An
  answer box wired to `eval()` is a remote code execution hole in a learning
  site, and `tests/maths-expr.test.mjs` fires eleven injection attempts at it.
- **No sampling.** Agreeing at a few points is not equality. A grader that
  thinks it is will one day accept $x^2-1$ for $(x-1)^2$.
- **No pretending.** $\pi$, $e$, logs, trigonometry and $\sqrt2 + \sqrt3$ are
  outside the domain, and the box says so in those words rather than guessing.
  A problem needing any of them is authored as `approx` with a stated
  tolerance, which is an honest claim about what is being checked.

#### A syntax error is not a wrong answer

`{1,2` is a missing brace. `99/` is an unfinished expression. Neither is a
mathematical mistake, so neither produces a verdict, records an attempt or
costs a first-try bonus — the message appears beside the box and the text
stays. Every answer field also shows a **live reading** of what was typed
("read as 3/8 (0.375)"), because most wrong answers in a maths tool are the
tool reading something other than what the person meant.

#### Written proofs are never marked

There is no automatic certification of a written proof here, no AI marker,
and no keyword search pretending to be a reading. What there is: a box that
autosaves, a rubric for *this* statement, a model proof behind an explicit
reveal, and a status of its own — **Self-reviewed**, which is recorded
separately from Solved and is never upgraded into it.

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

Then **Settings ▸ Code execution ▸ Check connection**. JavaScript runs in the
tab and needs nothing; C++, Rust and Python have to be compiled or
interpreted somewhere, which means either this runner or the hosted one
described below. With neither of them up the site says so, names which backend
it tried, gives that one command, and everything else goes on working — the six
non-executing types cover a lot of C++ knowledge on their own.

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

### C++ in the browser, with nothing installed

The default for C++ is now a **real Clang compiled to WebAssembly**, running
in a worker in the tab. No account, no key, no server, no Docker, no WSL, and
nothing leaves the machine.

```
compiler   Clang/LLVM 20.1.2          ← browsercc, MIT, pinned at 0.1.1
target     wasm32-unknown-wasi
standard   C++20, -O2 -Wall -Wextra -fno-exceptions
library    libc++ and wasi-libc
runtime    @bjorn3/browser_wasi_shim  ← MIT OR Apache-2.0, pinned at 0.4.2
```

90 MB of it, in `vendor/cxx/`, fetched the first time somebody presses Run on
a C++ problem and cached by URL afterwards. The download shows its own byte
count and **Stop** is live for the whole of it. Measured on this machine: a
cold first run including the download is about 3 seconds, and a compile after
that is about one.

The compiler lives in one long-lived worker; **each test case runs in a
throwaway one**. That is not tidiness — a `while (true) {}` compiled to
WebAssembly yields to nothing, and terminating the thread is the only way to
stop it. Terminating a worker that also held the compiler would mean fetching
it again.

#### What is different from the native runner, and why it matters

Measured, not assumed, and re-measured by `tests/browser/cxx.test.mjs`:

| | browser | native runner |
| --- | --- | --- |
| `sizeof(long)`, `sizeof(void*)`, `sizeof(size_t)` | **4** | 8 |
| `sizeof(int)`, `sizeof(long long)` | 4, 8 | 4, 8 |
| exceptions | **none at all** | yes |
| sanitizers | **none** | ASan and UBSan |
| out-of-bounds read | returns rubbish | traps under ASan |
| threads, OpenMP, files, signals | none | yes |

The exception situation is absolute rather than partial: `-fno-exceptions`
rejects `try` and `throw` at compile time, and `-fexceptions` gets as far as
the linker and fails on `__cxa_throw`, because the sysroot's libc++ has no
unwinder.

The sanitizer one is the dangerous one. Wasm linear memory starts at address
zero and is readable, so reading past the end of a vector does not crash
here — it quietly returns a number. A problem whose entire lesson is "the
sanitizer catches what the output hides" would have that lesson deleted by
running it in the browser. **So the flags are never quietly relaxed to make
a problem fit.**

#### Which problems, and how that was decided

`npm run audit:cxx` compiles **every C++ problem's own reference solution**
with the browser toolchain and runs it against **that problem's own visible
and hidden cases**. A problem is certified only if its reference builds, runs
and gets every case right. The result is `data/cxx-support.json`, CI checks
it is current, and `tests/content.test.mjs` fails if a problem is in neither
list or if a sanitizer problem somehow got into the certified one.

<!-- not generated: this is a count of a generated file, and the sentence
     around it is the part worth reading -->
**30 of the 31 C++ problems run in the browser.** The one that does not is
`algo-running-max`, and the reason is the paragraph above: it is graded on
what AddressSanitizer says. The site says so on the problem itself — "CPP
needs the native toolchain for this problem" — rather than offering a
compiler that would mark it passed.

### The in-site guide

Everything below is also in the site itself, at **#/setup**, reachable from
Settings and from a **Set up execution** button that appears beside Run when
nothing can compile the language you are looking at. It explains the three
modes, shows which of them work *for you* from live probes rather than from
configuration, walks through Windows + WSL step by step with copy buttons and
the output each command should produce, and troubleshoots the state you are
actually in — including the one where your runner is running and the browser
will not let the page reach it.

Its "Run the check" button compiles and runs a real C++ and a real Rust
program and compares the output. Nothing on that page reports success before
that has happened.

### Running from the published site: hosted execution

The local runner is for this machine. For a phone, a borrowed laptop, or the
published site on anything at all, there is a second backend: a small proxy
you deploy, in [`proxy/`](proxy/README.md).

The browser never talks to an execution service directly. It posts a
problem-shaped request to the proxy — language, profile *name*, source, cases
— and the proxy chooses the compiler flags from a table identical to
`judge/languages.mjs`, applies every limit, and calls Judge0 with a credential
that never leaves the server. Three reasons, each sufficient on its own:

- a key cannot live in a static page;
- a public endpoint that forwards caller-supplied compiler options is a remote
  code execution service with extra steps;
- a limit the client picks is not a limit.

It caps source size, case count, stdin size, CPU, wall clock and memory,
rate-limits per IP, and checks `Origin`. `handler.mjs` is platform-neutral:
`worker.mjs` runs it on Cloudflare, `server.mjs` on Node.

**What is done and what is not.** The proxy is written and tested —
`tests/proxy.test.mjs` offline and against a live service, and
`tests/browser/hosted.test.mjs` drives the whole journey through Chromium with
the local runner stopped: write C++, Run, Submit, get marked. What is missing
is somewhere to deploy it (a Cloudflare account; the free tier is far beyond
what this needs) and a Judge0 to call. `https://ce.judge0.com` works and is
free, but has no SLA, no authentication and no documented limits — fine to try,
not something to point a public site at and walk away from; Judge0 Cloud via
RapidAPI is about €27–€107/month; self-hosting needs a VM that allows
privileged containers. [`proxy/README.md`](proxy/README.md) has the exact
commands and the full comparison.

**Until then, the site says so.** The toolbar reads **No runner**, compiled
languages are offered but marked unavailable with the reason, and nothing
falls back to a local address. Which backend ran is always named: **Hosted**,
**Local** or **Browser**.

### Measured, not read off the documentation

`ce.judge0.com` understates itself badly:

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
11, timeouts as 5.

Two things to be deliberate about: it is one compile per test case rather than
one compile for all of them, so it is slower; and your submission goes to a
third party. For these problems that is uninteresting, and it is still true.

## The editor

Code problems use **CodeMirror 6**, vendored as a single prebuilt bundle at
`vendor/codemirror.js` (`npm run build:editor` regenerates it from
`scripts/editor-entry.js`; the pinned versions are in
`vendor/codemirror.versions.json`). The site still has no build step at serve
time — the bundle is a file, like everything else.

It replaced a hand-written editor: a coloured `<pre>` behind a transparent
`<textarea>`, scroll-synced. That design has one failure mode and it produced
three distinct bugs, all reported and all reproduced before anything was
changed:

| reported as | what it actually was |
| --- | --- |
| "typing does not work on some problems" | the sticky action bar sat *over* the lower part of the editor and took the clicks: the caret never landed, so the keystrokes went nowhere |
| "the text or caret is one character behind" | the overlay repainted on a frame boundary while the textarea painted immediately — the two layers disagreed for one frame |
| "the horizontal scrollbar is halfway down" | the textarea had grown past its container (measured: 1840px inside a 492px box), so its own scrollbar was wherever the container happened to end |

They are the same architectural problem — two elements with independent
geometry and scroll state, kept in agreement by hand — and the list of things
the editor had to do correctly (caret placement, selection, undo/redo, IME,
paste, long lines, aligned gutters) is the list a maintained editor already
guarantees. So the overlay went.

CodeMirror owns one scroll container with the gutter inside it, which makes
the three bugs structurally impossible rather than fixed: line numbers cannot
drift from their lines, and the horizontal scrollbar is at the bottom of the
editor by construction. `js/editor.js` keeps the same small API the rest of
the site already used, plus `setFontSize`, `refresh` and `destroy`, and falls
back to a plain textarea if the bundle fails to load.

`editor.value` reads the document directly from CodeMirror's state, so "the
last character typed before pressing Run" is not a question that can have a
wrong answer — there is no second copy to be stale.

**Colouring is not checking, and the editor says so.** Under the editor it
reads *"Syntax colouring only. Press Run to compile it."* until a compiler has
actually looked, and only then does it report anything about the code.

There used to be a second thing there: a hand-written bracket scanner that ran
on every keystroke and announced **"No unbalanced brackets."** It is gone. It
was accurate and it was still the wrong idea — a verdict from something that is
not a compiler, sitting under the editor looking like a check had passed, on a
program that had never been built. CodeMirror still matches and closes brackets
as you type, which is the part that helps.

What remains is the **real compiler**, through the judge's `/lint` endpoint:
`g++ -fsyntax-only`, `rustc --emit=metadata`, `py_compile`, `node --check`.
Diagnostics arrive with line and column, and clicking one jumps the caret
there, so the message you get while typing is the message a build would give
you.

A draft is kept per problem *and* per language, and the font size is adjustable
from the header.

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
| **Metric spaces, from the axioms up** | 12 | Distance as four conditions rather than a formula, and then everything that follows from them: balls, open and closed sets, convergence, completeness, continuity and a first look at compactness. |
| **Probability, in the order it makes sense** | 12 | Sample spaces and counting first, because most errors are made before any arithmetic; then conditioning, independence, random variables, expectation and variance, and a first continuous distribution. |
<!-- /generated:tracks -->

### The workspace

A `code` problem opens as a workspace that uses the whole window: nothing but
the site header is above it, and the page itself never scrolls — every panel
scrolls on its own.

```
┌ back · 25/85 · title · difficulty · status ····· A− 14 A+ · ☆ · Focus · ⋯ ┐
├────────────────────────────┬──────────────────────────────────────────────┤
│ Description  Prereqs       │ C++  Rust  JS        Hosted  Run     Submit  │
│ Hints  Notes  Solution 🔒  ├──────────────────────────────────────────────┤
│                            │                                              │
│  the statement             │  the editor                                  │
│                            │                                              │
│                            ├──────────────────────────────────────────────┤
│                            │ Test cases  Results  Compiler output         │
│                            │                                              │
└────────────────────────────┴──────────────────────────────────────────────┘
```

Both dividers drag, and both take the arrow keys, `Home`, `End` and `Enter`
to reset. Positions are remembered, and **Reset layout** in the `⋯` menu puts
them back without touching a draft or a solve. Run and Submit are in the
editor's own toolbar rather than a bar that floats over the code — which is
what used to swallow the clicks.

The divider is 18px of hit area with a visible 10px bar and a grip in the
middle of it. It was 10px containing a 1px hairline, which is to say invisible:
"dragging the divider does nothing" was mostly people not finding it and
scrolling the pane behind it instead. A split remembered from a wide monitor is
clamped rather than honoured on a small one — neither panel is ever allowed
below 320px — and the stored preference is left alone, so the big screen gets
it back.

The toolbar also names the execution backend, always: **Hosted**, **Local** or
**Browser** before a run, and "Ran on Hosted" or "Could not run — Hosted"
after one. When nothing can compile the language in front of you, a **Set up
execution** button appears beside Run and goes to an in-site guide — see
below. Editing stays available the whole time.

XP, coins and review scheduling are **not** in the working area. The header
carries a status word and nothing else; the arithmetic is behind the `⋯` menu
and on the profile.

Compiler output is parsed into a list of places with a severity and a line you
can click to jump the caret there, with the compiler's own words kept
underneath — the caret diagrams and the template backtraces are sometimes
exactly what you need.

Non-code problems get a single comfortable reading column instead, with the
answer controls under the statement and the same retry feedback. Below 900px
both layouts stack rather than being squeezed into columns.

`F` toggles **focus mode**, which hides the header and gives the problem the
whole window. `Escape` leaves it. Panel sizes and focus mode are stored under
`systems-lab/ui/v1`, separate from progress, so a bad value there can never
cost a solve.

### Attempts, and what an attempt does not reveal

Four things are tracked separately, because conflating them is what makes a
wrong answer feel like a punishment:

| | |
| --- | --- |
| the latest attempt's result | shown, every time |
| whether the problem is complete | only a correct submission sets it |
| whether the solution has been disclosed | only a correct submission, or an explicit Reveal with a confirmation |
| whether a reward has been paid | once per problem, ever |

So a wrong answer leaves every control live, keeps your code, keeps the
solution shut, and says what was wrong without saying what was right. A failed
"select all" reports how many of *your* ticks are right and whether something
is still missing — never how many correct options there are, because with four
options that is most of the answer. Revealing a solution records **Solution
reviewed**, not Solved. A previously solved problem can be practised again and
pays nothing the second time.

Compilation errors, runtime errors, timeouts, an unreachable runner and a rate
limit are **execution failures**, not wrong answers: nothing is recorded, the
code is untouched, and the message says which it was.

### What a wrong answer actually tells you

"Incorrect." teaches nothing, so MCQ, select-all and find-the-bug problems
carry authored feedback in a `feedback` block in their **solution** file:

```jsonc
// solutions/hpc-loop-order-row-major.json
"feedback": {
  "options":    { "1": "Count the additions. Both nests cover the same…" },
  "reconsider": "Write down the address of a[i][j], then the address of…"
}
```

It lives beside the key rather than in the problem file for a reason that only
shows up when you try it the other way: if only the *wrong* options carried a
note, the option without one would be the answer.

One rule governs all of it — **a note may say why what you picked is
unsuitable, and may never say what is right** — and the shape of the note
follows from what each type would otherwise leak:

| | |
| --- | --- |
| `mcq` | a note per wrong option, plus one thing to go away and reconsider |
| `multi` | never per-option. With four options, telling someone which of their two ticks was wrong *is* the answer. Instead, one authored sentence about a misconception the whole selection matches (`misconceptions: [{ picked: [2], say: "…" }]`), or a conceptual `nudge` |
| `locate` | what the line you clicked actually does, for lines worth describing. A blank line or a closing brace gets the `nudge` rather than an invented diagnosis of your reasoning |

`tests/content.test.mjs` fails if a note is attached to the correct option, to
an accepted line, or per-option on a select-all.

**The verdict belongs to one attempt.** Change your answer and it is labelled
*Previous attempt* and dimmed, the wrong-answer marks come off the controls,
and your new selection is not sitting there pre-graded. Earlier attempts fold
away into a list rather than vanishing. Submitting nothing — or an untouched
code template, which is not the same thing and no longer claims to be — gets a
validation message beside the control and costs no attempt.

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
| `tests/proxy.test.mjs` | The hosted-execution proxy: that it sends character-for-character the same compiler flags as the local runner, refuses caller-supplied flags, clamps every limit and rate-limits per address; `PROXY_LIVE=1` also compiles against a real service |
| `tests/contrast.test.mjs` | Every text colour against every surface it is used on, for all 8 themes and all 40 theme-and-accent combinations the shop can produce, at WCAG AA |
| `tests/content.test.mjs` | Every problem and key: the schema, the concept graph, that tracks and weekly entries name problems that exist, that the README matches the catalogue, and that **each key is graded correct by its own grader** and each `code` reference solution actually passes |
| `tests/browser/app.test.mjs` | The whole journey in jsdom: browse, filter, bookmark, open, read prerequisites, take a hint, answer wrongly, answer rightly, preview a theme, spend the coins |
| `tests/browser/styles.test.mjs` | That every theme defines every token and can be previewed from it, every `var(--x)` resolves, and `[hidden]` still wins |
| `tests/browser/states.test.mjs` | The page with nothing solved, part solved, all solved and with the content missing — every view in each — plus keyboard reachability, focus rings and the narrow-screen rules |
| `tests/browser/runner.test.mjs` | The real browser-to-runner path with the runner up: a passing submission, a compile error, a runtime error, a timeout and a sanitizer trip |

Two more need a server and are not in `npm test`, because they drive a real
Chromium against a real site:

| Suite | What it covers |
| --- | --- |
| `tests/browser/journeys.test.mjs` (`npm run test:journeys`) | The reported failures as journeys, with real mouse and keyboard: typing, caret placement, Tab, paste, cut, undo, long lines, scrolling, resizing, zoom, per-language drafts across a reload, a wrong MCQ and a wrong multi-select that disclose nothing, reveal-with-confirmation, practising a solved problem, and the layout at 1440×900, 1920×1080 and 390×844 in both themes |
| `tests/browser/hosted.test.mjs` (`npm run test:hosted`) | The published-site journey with **no local runner**: write C++, Run, Submit, get marked — plus a compile error, a wrong submission then a fix, a timeout, a rate limit, an unreachable runner, and a check that no submission went to localhost |
| `tests/browser/local.test.mjs` (`npm run test:local`) | The same workspace against the **local runner**, which is the only backend that can produce them: a warning on a successful build, a clickable compiler diagnostic that moves the caret, a build failure, a timeout, and a sanitizer trip on a program whose output is right |
| `tests/browser/navigation.test.mjs` | Leaving a problem for every other page, thirty times over, plus focus mode, Back/Forward and a drag abandoned mid-navigation. Measures the **destination** page: is anything clipped out of reach, is the navigation there, can you still click and scroll |
| `tests/browser/resize.test.mjs` | Both dividers, dragged with a real pointer, asserting measured panel widths and heights before and after. Minimum widths, keyboard resizing, every way a drag can end, a split saved on a big screen opened on a small one, and Reset layout |
| `tests/browser/feedback.test.mjs` | A wrong answer on each of MCQ, select-all and find-the-bug: that the explanation is substantial, that it discloses nothing, and that the verdict is relabelled and the marks cleared the moment the answer changes |
| `tests/maths-expr.test.mjs` | The expression engine on its own: equal values comparing equal however they are written, unequal ones never comparing equal, syntax errors and unsupported expressions reported as *different kinds* of failure from a wrong answer, and eleven injection attempts refused |
| `tests/maths-render.test.mjs` | KaTeX renders, emits MathML, and markdown does not get at the TeX first — `$a_1 + a_2$` must not become `a<em>1 + a</em>2` |
| `tests/browser/maths.test.mjs` (`npm run test:maths`) | The subject switch, typesetting on the page, every one of the six answer formats, a syntax error costing no attempt, a wrong answer explaining the misconception, progressive hints, the figures, a written proof reaching **Self-reviewed** without ever being marked right, and the review being finishable from wherever revealing the model proof leaves you |
| `tests/browser/cxx.test.mjs` (`npm run test:cxx`) | C++ in the browser with the runner address pointed at a dead port: the download and its progress bar, a cold first run, submit-wrong-then-correct, a Clang compile error, an infinite loop cut short and a valid program straight afterwards, Stop, the cached second visit, a native-only problem refusing to pretend, and a check that nothing was sent anywhere |
| `tests/browser/usability.test.mjs` | Buttons after a failure, a run in flight when the problem or language changes, the toolbar at five widths, every answer control being clickable where it looks, horizontal overflow on twelve routes at eight widths with the view links staying reachable, keyboard reach to hints/notes/solution, and the blast radius of a reset |

`npm run test:ui` runs the last four together; they need `npm run serve`.
`BROWSER=msedge` runs any of them through the Edge installed on the machine
rather than Playwright's bundled Chromium.

A suite that passes tells you a number. `scripts/demo-journeys.mjs` tells you
what a person sees: it walks the whole browser-C++ journey and the whole
mathematics journey in one browser and prints a transcript — the download
progress line by line, Clang's own diagnostics, the wording of each verdict,
the misconception feedback, the rubric, the integer sizes the target actually
has. Point it at the deployed site, which is the only place the claim means
anything:

```
BASE=https://mobeenmohammed.github.io/systems-problems BROWSER=msedge \
  node scripts/demo-journeys.mjs
```

It asserts nothing, so it cannot pass; read it.

The first two want `npm run serve` and `npm run proxy` up and the local runner
**stopped** — that is what makes "hosted" mean something. The third wants
`npm run serve` and `npm run runner` up instead. `SHOTS=1` writes screenshots
to `_shots/`.

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
js/editor.js            CodeMirror: mounting, theming, lint gutter, drafts
js/types/registry.js    the problem-type contract
js/types/*.js           one file per problem type
js/problem.js           a problem: its tabs, submitting, the verdict
js/cxx/toolchain.js     Clang-in-WebAssembly: fetch, cache, compile, run
js/cxx/compile.worker.js  the long-lived compiler worker
js/cxx/run.worker.js    one throwaway worker per test case
js/runners/browsercpp.js  the browser C++ backend, with progress and Stop
vendor/cxx/             90 MB of Clang, wasm-ld and a WASI sysroot
js/setup.js             the "how do I run C++" guide, and its live probes
js/views.js             dashboard, catalog, reading map, profile, shop, settings
js/app.js               bootstrap, hash routing, shortcuts
js/runners/hosted.js    the hosted backend, through the proxy
vendor/codemirror.js    the prebuilt editor bundle (npm run build:editor)
proxy/handler.mjs       hosted execution: limits, flag table, rate limit
proxy/worker.mjs        the Cloudflare entry;  proxy/server.mjs the Node one
judge/                  the local C++/Rust/Python runner (WSL, or Docker)
judge/run-wsl.sh        the toolchain check and one-command start
problems/<topic>/*.json one file per problem, no answer in it
solutions/*.json        keys, explanations and hidden cases
scripts/build-index.mjs generate and validate the catalog
scripts/build-readme.mjs regenerate the counted sections of this file
scripts/audit-cxx.mjs   compile every C++ reference in the browser toolchain
scripts/demo-journeys.mjs  narrate both journeys against a deployed site
scripts/check-responsive.mjs  both themes, ten widths, four root font sizes
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
counted sections of this README — so neither can drift from the content. Two
more guards run there: `npm run audit:leaks`, which fails if a problem
statement gives away its own answer without saying so in
`scripts/leak-allow.json`, and a check that no `judge-token*.json` is in the
tree, because the deploy job publishes the whole checkout.

The runner is **not** deployed, and never should be — it runs arbitrary code
as you. It is a local service. The default address is `http://127.0.0.1:2000`
rather than `localhost` because browsers exempt loopback *addresses* from
mixed-content blocking and Firefox does not extend that to the name.

**That is no longer the whole story, and it was measured rather than assumed.**
Driving the published `https://` site against a runner on loopback, current
Chromium refuses with:

```
Permission was denied for this request to access the `loopback` address space.
```

Mixed content is not the gate any more — Local Network Access is. Chrome asks
the user before an `https` page may touch a local address, and an
unanswered prompt denies it, which looks from the page exactly like nothing
listening. So Settings says so when the page is `https` and the address is
loopback, instead of repeating "start the runner" at somebody whose runner is
already running.

The practical consequences:

- the runner is best used with the site served locally (`npm run serve`),
  where both are `http://127.0.0.1` and nothing is cross-space;
- **hosted execution is the answer for the published site**, and it has to be
  a real public `https` endpoint — a proxy on loopback hits the same gate.

### Managing the runner

```bash
npm run runner          # start it (WSL)
npm run runner:status   # is it up, and does the token file match it
npm run runner:stop     # stop it
```

A second start cannot clobber the first: the token is generated in memory,
written only once the port is actually bound, and the file carries the pid of
whoever wrote it so only that process removes it. Starting a second runner
while one is up now fails on the port with a message saying so, instead of
overwriting the live instance's credentials and then dying.
