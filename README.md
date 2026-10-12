# Invariant

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
**113 problems** across 13 topics, 37 of them compiled and run in C++, Rust, Python, JavaScript. **115 concepts** carry **316 readings** between them, every one naming a book and a chapter or a specific page, with 33 more for learning a topic from scratch. **12 tracks** order subsets of the problems so there is always an obvious next one, and the weekly schedule runs to 2027-04-05.

```
Topics        cpp · rust · arch · os · linux · compilers · hpc · dist · fpga · algo · sysdesign · metric · prob
Difficulty    Beginner · Intermediate · Advanced
Types         mcq · multi · numeric · short · order · match · predict · locate · code · approx · counterexample · exact · hdl · proof · proofsteps · structured
Total time    about 30 hours at the stated estimates
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
| **FPGAs & Hardware** | 11 — 4 / 6 / 1 by difficulty | 3 | ~4 h |
| **Algorithms** | 11 — 5 / 5 / 1 by difficulty | 8 | ~4 h |
| **System Design** | 5 — 2 / 2 / 1 by difficulty | 1 | ~1 h |
| **Metric Spaces** | 12 — 5 / 5 / 2 by difficulty | 0 | ~2 h |
| **Probability** | 12 — 4 / 8 / 0 by difficulty | 0 | ~2 h |
<!-- /generated:topics -->

## Two subjects

**Systems** and **Mathematics** share one catalogue. Subject is a filter in
the Problems view, beside topic and difficulty, so the default is every
problem on the site rather than half of them — and the topic list is grouped
by subject, so you can reach Metric Spaces without selecting Mathematics
first. Searching deliberately ignores the filter: looking for "bayes" with
Systems selected finds it, and the count says that is what happened.

This replaced a switch in the top bar. A lens that hides half the catalogue,
half the tracks and half the reading map is a thing you have to remember the
state of, and the only part of it worth keeping was the filtering.

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

Ranks: **Userland → Libc → Syscall → Kernel → Ring 0 → Bare Metal → Silicon**.

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

**Colouring is not checking.** The line under the editor says nothing at
all until a compiler has actually looked, and then it says what the compiler
said. It used to read *"Syntax colouring only. Press Run to compile it."* from
the moment a problem opened — a standing notice about something that had not
happened, on every problem, taking a row under every editor. Nothing is lost
by its absence: the Results tab is empty too, and says so in one line.

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

## Python in the browser too

Python runs the same way C++ does: on this device, in a worker, with
nothing installed and nothing paid for. **Pyodide 314.0.7 — CPython 3.14.2
compiled to WebAssembly — 12.8 MB**, fetched the first time you press Run on
a Python problem and cached afterwards. A seventh of the C++ toolchain, and
about a second to start.

It needs no cross-origin isolation, which is what makes it possible on
GitHub Pages at all: the bundle contains **zero** references to
`SharedArrayBuffer`, and its one `Atomics.wait` is inside a `try/catch` that
degrades to `false`. That was checked before anything was built on it, the
same way browsercc was.

### What is different from `python3`

Measured, not assumed, and re-measured by `tests/browser/python.test.mjs`:

| | here | native CPython |
| --- | --- | --- |
| `sys.platform` | `emscripten` | `linux` |
| `sys.maxsize` | 32-bit | 64-bit |
| integers | arbitrary precision | arbitrary precision |
| filesystem | in memory, starts empty, thrown away | real |
| processes, sockets | import, do nothing | real |
| threads | exist; one runs at a time | real |
| packages | standard library only | whatever you installed |

The 32-bit `sys.maxsize` sounds worse than it is: Python's own integers are
arbitrary precision either way, so `2**70` is exactly right here. What
changes is `sys.maxsize` itself and anything using it as infinity.

### Isolation between cases

Each case runs in a **fresh globals dict**, so nothing one case defines is
visible to the next — there is a test that proves it. That is not the same
as a fresh process: `sys.modules` is shared, so a module imported by one
case is already imported for the next. A fresh interpreter per case would
cost a second each, and the honest answer is to say so rather than to claim
an isolation that is not there.

An infinite loop cannot be interrupted from inside, because wasm yields to
nothing. The worker is terminated and the next case starts a new
interpreter from cache, which is about a second.

### Which problems

`data/py-support.json`, generated by `npm run audit:py`, which runs **every
Python problem's own reference solution on the vendored Pyodide against that
problem's own cases**. Not a list anybody maintains. Currently **17 of 17**.
CI runs `npm run check:py`, so the file cannot drift from the problems.

### The dev server

`npm run serve` was `python -m http.server`, which serves `.mjs` as
`text/plain`; a browser refuses a module with that type. The Python runner
worked when deployed and failed on localhost, which is the wrong way round
for a bug to be found. It is `scripts/serve.mjs` now, whose only real job is
the MIME table.

## Rust in the browser too, with one limit worth stating

A real **rustc** runs in this tab. Not a transpiler, not a sandbox calling a
server: `vendor/rust/rustc.wasm` is rustc 1.96.0-dev compiled to WebAssembly
from @bjorn3's patched branches, with the **Cranelift** backend and a wasm
linker instead of LLVM and `lld`. It comes from
[AngelOnFira/weblings](https://github.com/AngelOnFira/weblings) (MIT), and
the Cranelift choice is why it is 88 MB rather than the several hundred an
LLVM build costs — which is why there is a Rust compiler here at all.

| | on disk | over the wire (gzip) |
| --- | --- | --- |
| `rustc.wasm` | 87.9 MB | 20.3 MB |
| `sysroot-wasip1.bundle` | 71.3 MB | 23.7 MB |
| | **159.2 MB** | **44.0 MB** |

Both are pinned by SHA-256 in `vendor/rust/manifest.json` and verified on
every re-pin and in CI. Nothing is fetched until you open a Rust problem.

### Why this one and not rubrc

[rubrc](https://github.com/oligamiq/rubrc) is the other in-browser Rust
toolchain and it is the more complete one — LLVM backend, Cargo,
rust-analyzer. It also needs threads, and therefore `SharedArrayBuffer`, and
therefore the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`
response headers.

**GitHub Pages cannot set a response header.** That is the blocker, and it
is a hard one. The smallest free adjustment that would resolve it is a
service worker that synthesises both headers (`coi-serviceworker`), which
costs a forced reload on the first visit and breaks every cross-origin
subresource — or moving the site to Cloudflare Pages or Netlify, which can
set headers on a free tier and would mean giving up the URL.

None of that was needed. This `rustc.wasm` is built with an internal memory
and is single-threaded: no headers, no isolation, no service worker. That
was confirmed before anything was vendored, by checking that weblings' own
demo is served from GitHub Pages with no COOP or COEP header on it —
`tests/browser/rust.test.mjs` asserts the same thing about this deployment,
so the day it stops being true is the day a test fails.

### Two capabilities, deliberately different sizes

**Check** — `--emit=metadata`, which stops after the borrow checker and
before code generation. It works on **every** Rust problem, takes about a
fifth of a second, and gives you rustc's own diagnostics: `E0382` for a
move, `E0502` for overlapping borrows, `E0621` for a lifetime, each with the
line and rustc's own rendering. This runs as you type, and it is the first
time anything on this site has checked Rust without a local toolchain. The
status row names which compiler looked, because there are two now and they
do not check the same amount.

**Run** — compile, link and execute. The output is an ordinary
`wasm32-wasip1` binary, so it is run by the *same* `js/cxx/run.worker.js`
that runs the C++ output: one throwaway worker per case, terminated on
timeout, stdin wired in, output bounded. A compiler and a sandbox are
different jobs and were already separated here.

A warm compile is about **0.1 s**, which is an order of magnitude faster
than the C++ one.

### The limit: `parse::<i64>()`

```
error: wasm emission failed: translating function `core::num::from_ascii_radix`:
       lowering `v135 = smulhi.i64 v133, v132`:
       unimplemented binary opcode smulhi on i64
```

The Cranelift → wasm lowering has no `smulhi` for i64, and parsing a 64-bit
integer out of a string needs one. It is not the optimisation level — tested
at `-O`, `0`, `1`, `2`, `3`, `s` and `z`, and on both editions.

It is **that specifically**, and saying "64-bit is broken" would be wrong in
a way that stops somebody looking for the real boundary. All of this works:
`i64` and `u64` arithmetic, division, `checked_mul`, printing an `i64`, a
`u64` or an `i128`, and parsing `i32`, `u32`, `usize` and `f64`.
`tests/rust-toolchain.test.mjs` pins the boundary from both sides.

Three of the six Rust exercises and `algo-running-max` read an `i64` from
input, so they cannot be *run* here. They were not rewritten to fit the
compiler — the exercise is the exercise. They say why, in those words, and
keep the native path. **Checking still works on all of them**, because the
gap is in code generation.

### Which problems

`data/rust-support.json`, generated by `npm run audit:rust`, which compiles
**every Rust problem's own reference solution with the browser rustc and
runs it against that problem's own cases**. Not a list anybody maintains.

It records **two** capabilities per problem, because they are two
different things and reporting one number for both would be wrong in
whichever direction it rounded:

| | what it means | how many |
| --- | --- | --- |
| `checks` | the front end: parser, types, traits, **borrow checker**. `--emit=metadata`, which stops before code generation, so no lowering gap can reach it. This is what the editor runs on every keystroke | **7 of 7** |
| `browser` | and then code generation, linking, execution, and every case right | **2 of 7** |

So on five of the seven Rust exercises you get rustc's own E0382, E0502
and E0621 as you type, with line numbers, and cannot press Run. The
toolbar says `Checked, not run` rather than `No runner`, because those
are not the same state and the difference is most of what the exercise
is for.

The one that gets this wrong is easy to write: `compile(src, CHECK_FLAGS).ok`
asks whether a wasm file appeared, and `--emit=metadata` never writes one,
so the first version of the `checks` column read 0 of 7. `Toolchain.check()`
has its own success condition — exit 0 and no error diagnostic — for that
reason.

CI runs `npm run check:rust` and `npm run check:vendor-rust`, so neither
the list nor the compiler can drift.

### Is there a newer one?

Checked rather than assumed: `npm run vendor:rust` re-downloads both
artefacts and compares digests. As of the last run they are
byte-identical to the pin, so there is no toolchain update to take. The
gap is upstream, in weblings' CLIF-to-wasm translation layer, and
`smulhi.i64` landing there is what would close it.

## SystemVerilog, simulated in the browser

The hardware exercises compile and simulate **in the tab**, with no
installation, no account and no FPGA. `vendor/verilog/` holds
[Icarus Verilog](https://steveicarus.github.io/iverilog/) 14.0 compiled
to WebAssembly, from
[senolgulgonul/verisim](https://github.com/senolgulgonul/verisim), which
is three programs rather than one because Icarus is three programs:

| | what it does | size |
| --- | --- | --- |
| `ivlpp` | the preprocessor: macros, includes, `line directives | 281 kB |
| `ivl` | the compiler: elaborates the design, emits a `.vvp` | 1.74 MB |
| `vvp` | the runtime: executes it, runs `$display`, writes the VCD | 977 kB |
| | | **2.9 MB** |

In a normal install those are three processes passing files on disk;
here they are three WebAssembly modules passing files in memory. All six
artefacts are pinned by SHA-256 in `vendor/verilog/manifest.json` and
checked in CI. Nothing is fetched until you open a hardware exercise, and
nothing needs `SharedArrayBuffer` or cross-origin isolation — which is
why it works on a static host that cannot set a response header.

### The licence, which is the part to read

**Icarus Verilog is GPL-2.0-or-later**, so these binaries are a
redistribution of a GPL work. Three obligations, all met in the tree
rather than asserted:

- the licence travels with them, in `vendor/verilog/COPYING`;
- the redistribution is identified exactly — upstream project, commit,
  and the Icarus release the binaries were built from, all in
  `manifest.json` — so "corresponding source" names a specific thing;
- they are unmodified. They are downloaded and checked against a digest,
  and nothing here patches them.

### What it actually supports

Not "SystemVerilog-2012", which is only the flag `ivl` is given.
`npm run audit:hdl` runs **one program per language feature, each with
its expected output written down in advance**, and
`data/hdl-support.json` records what happened:

| | |
| --- | --- |
| modules, named ports, parameters, bit vectors | yes |
| `logic`, `always_comb`, inferred sensitivity | yes |
| `always_ff`, posedge clock, non-blocking assignment | yes |
| synchronous and asynchronous reset | yes |
| `typedef enum` state machines, `unique case` | yes |
| `$display`, `$time`, `$finish`, `$dumpfile`, `$dumpvars` | yes |
| unknown (`x`) and high-impedance (`z`), and `===` | yes |
| `$isunknown` | **no** — not in this build |

A feature that compiles and then does the wrong thing would be worse
than one that is missing, so the probe is a pass/fail against a stated
expectation rather than a "did it run". Three findings worth keeping:

- `next = din ? S1 : S0;` on an enum is **rejected**: the conditional
  operator has an integral type and assigning it to an enum needs an
  explicit cast. Icarus is right and most tools are laxer. The exercises
  use `if`/`else`.
- an `always` block with no delay in it is a **compile error** —
  "A runtime infinite loop will occur" — rather than a hang.
- a system task this build lacks is a **run-time refusal**: vvp prints
  "not defined by any module" and will not start. That is a toolchain
  limit, not a wrong answer, and it is graded as ungraded with a retry
  rather than as wrong.

### How an exercise is graded

Not by whether it compiled, and not by what it printed.

A problem supplies a **sample testbench**: Run uses it, you can read it,
and the waveform comes from it. The solution file supplies a **grading
testbench**, which Submit uses and which drives cases the sample one does
not — a different parameter width, an overflow, a reset asserted at the
same instant as an enable. Its source is never on the page and **its
waveform is never shown**, because a picture of its cases is a picture of
the answer.

Both print structured lines:

```
CHECK <name> <expected> <actual> AT <time>
DONE <count>
```

and `js/hdl/grade.js` requires every check **named by the problem** to
have run and passed. Three consequences, each of them the point:

- a design that compiles and prints the word `PASS` and computes nothing
  produces no `CHECK` lines and scores zero. Printed text is never
  evidence.
- a design that hangs after two of eight checks is **incomplete**, not
  2/8. `DONE` never arrived, so there is no result to take a fraction of,
  and incomplete scores zero — partial credit for a hang would be paying
  for the hang.
- a run stopped by the time limit reports that it was stopped, and not a
  score of zero, because those read very differently to somebody whose
  design is fine and whose testbench is not.

`npm run check:hdl` compiles every reference design against **both**
testbenches and requires every check in both, so an exercise that its own
answer cannot pass is a failed build.

### Nothing here is a synthesiser

A design that passes every check has been shown to behave correctly under
that testbench, in an event-driven simulator. It has **not** been shown to
be synthesisable, to meet timing at any clock rate, to fit a device, or to
work on hardware. There is no synthesis step here and no place-and-route,
and the exercises, the result pane and `data/hdl-support.json` all say so
rather than leaving it implied.

### Not freezing the tab

`vvp.callMain()` is a synchronous call into WebAssembly. A testbench with
no `$finish`, or a `forever` loop with no delay in it, does not return —
so it runs in a worker, one per run, and Stop, the build timeout (30s)
and the simulation timeout (10s) are all the same action: terminate the
worker. Throwing it away afterwards is also what makes *a good run works
straight after a stopped one* true by construction rather than by
cleanup, which `tests/browser/hdl.test.mjs` checks in that order.

### The waveform

`js/hdl/vcd.js` parses the dump into a per-signal list of
`[time, value]` pairs and answers "what was this at time *t*" with a
binary search; `js/hdl/wave.js` draws it on a canvas at device pixel
ratio. Clock and chosen signals, the time axis in the unit the file
declares, a cursor you can click or walk with the arrow keys and every
signal's value at it, buses in hex, binary or decimal, fit, zoom and pan,
a VCD download, and `x` and `z` drawn as bands rather than as a level —
because they are not one, and a bus with an `x` in it has no numeric
value to show.

When a check fails at a known instant, that instant is marked on the axis
and the cursor starts there.

## Completion, without a language server

C++ has autocomplete. It is not clangd: real C++ completion needs a real
front end holding a real translation unit, and the compiler this site ships
runs in a worker, takes about a second, and answers *did it build* rather
than *what can follow this dot*.

`js/complete-cpp.js` is four sources that need no type checking:

- **keywords**;
- **the standard-library names these problems use**, each labelled with the
  header it comes from, because *which of these do I include* is the half of
  the answer people usually want — `std::accumulate  <numeric>`;
- **identifiers already in the buffer**, so your own names complete;
- **members after `.` or `->`**, for receivers whose type is declared in the
  buffer in a form a regex can read — `std::vector<int> v`, `const
  std::map<K,V>& m`, `vector<T> v` after `using namespace std`.

The fourth is the only one that can be wrong, so it is the careful one. With
a known receiver you get that type's members and nothing else — a
`std::vector` is not offered `substr`. With an unknown one (`auto`, a
typedef, your own class) you get every member *labelled with the type it
belongs to* rather than a merged list that implies they are all available.
An honest guess, marked as a guess, beats a confident wrong answer. Nothing
here is ever a claim that the code compiles; only the compiler says that.

Python and JavaScript get the completions their own CodeMirror language
packages provide, so `running_total` completes in Python and `std::` does
not.

**Rust** gets `js/complete-rust.js`, on the same terms: keywords, the library
names these problems reach for, `use std::…` paths offered as paths rather
than words, macros spelled with the bang, and whatever is already in the
buffer. What it does *not* have is member completion after a dot. C++ can
read `std::vector<int> v` and know the type; Rust's declarations are mostly
`let v = …` with it inferred, and guessing methods off an inference is the
confident wrong answer the C++ source goes out of its way to avoid. A bare
dot offers nothing, and a few letters after one fall back to the ordinary
word list.

### It is a preference

Settings has a master switch and a box per language, all on by default.
Switched off, the extension still loads with `activateOnTyping: false`, so
**Ctrl+Space still asks for a suggestion** — off means "stop interrupting
me", not "take the feature away". `Store.completionOn(lang)` is the single
place that answers the question, so a prefs blob written before the setting
existed reads as on rather than as everything off.

Adding this cost **23KB** on the editor bundle (685KB to 708KB), not the
third of the library the old comment in `scripts/editor-entry.js` estimated,
because `closeBrackets` had already pulled half the package in. The word
lists are a plain site script rather than part of the bundle, so changing
them does not mean rebuilding it.

One thing it broke, and the fix: Escape now has two jobs in an editor —
close the popup, and the site's own *leave the field you are typing in*.
Both used to fire, so dismissing a suggestion you did not want also threw
you out of the editor, and the next letter you typed was read as a
navigation shortcut. The global handler now skips the blur when something
has already handled the key, so the first Escape closes the popup and keeps
your cursor and a second one leaves. That is `js/app.js`, and
`tests/browser/complete.test.mjs` is what holds it there.

## Learn: a track is a tree

A track is a list of problems. What it *teaches* is the concepts those
problems rest on, in the order the prerequisites put them in — and that was
already in the data, spread across two pages that did not know about each
other: `data/tracks.json` listed the problems, every problem named the
concepts it needs, and every concept named what it needs in turn.

**Learn** joins them up. The index is a card per track with what it is made
of, in four separate figures — see *Which total is which*, below. A count of
zero is left off rather than shown as `0 / 0`, which would imply there might
be some.

Pick a track and you get that closure as a **canvas**, and the canvas gets
the window.

### The graph is a workspace

A hundred and fifteen boxes in a 1180px column with 3rem of padding either
side is a picture of a sixth of the screen. So opening a track puts
`body[data-graph="true"]` on the document and `.main` becomes the window
below the header: a compact toolbar, then the canvas, and nothing on the
page scrolls. The Learn **index** is not a graph — it stays an ordinary card
page at the ordinary width.

This is the same mechanism the code workspace uses and it has the same
failure mode, which was a real reported bug: the workspace flag went on and
nothing took it off, so one click from a problem to anywhere else left the
destination clipped to the window with no scrollbar — 422px of the
dashboard, 29,021px of the reading map, unreachable. So the graph flag is
taken off in **two** places: `renderLearn` clears it when it draws the
index, and the router clears it on every route that is not Learn at all.
`tests/browser/learn.test.mjs` walks out of the graph to five different
views and checks `.main` is a document again each time.

**Three controls, not one.** "Recenter" was being asked three different
questions, so there are three buttons:

- **Fit all** — scale until every box is on screen, however small. You asked
  for all of it, so this one may go below the readable floor.
- **Reset zoom** — the opening view: readable scale, roots at the top.
- **Centre selected** — bring the open concept to the middle of what you can
  *see*, which is the canvas minus the details panel. Disabled when nothing
  is selected, which is the honest state of a button with nothing to centre.

The opening view is deliberately **not** a fit. A fit of the biggest track
is 0.35 scale, at which every box is a grey rectangle with a smear in it,
and the thing you need first in a top-down graph is the roots — so the view
you are given is readable scale with the first concepts at the top, and
fitting everything is a button you press.

**The wheel** pans. `Ctrl`+wheel zooms about the pointer, which is also what
a trackpad pinch arrives as, so pinch-to-zoom works with no gesture code. A
plain two-finger scroll that silently rescales the picture is the most
complained-about behaviour in every canvas that does it.

**A click is not a drag.** Every press starts a possible pan, including a
press on a box — a graph you cannot drag from a box is a graph with half a
surface, and the half with things on it. Four pixels of movement turns it
into a pan; under that it is a click and the click opens the node. Both
halves are tested: a two-pixel wobble still opens the box, and a real drag
from a box pans and opens nothing.

**Find a concept** in the toolbar, because a hundred and fifteen boxes is
more than anyone will read looking for one. It matches the name and the
one-line description, arrow keys walk the results, and choosing one opens it
and brings it to the middle — which is what searching is for, since the
whole problem is that you do not know where it is.

**Where you were** is kept per track: pan, zoom and which node was open,
written to the UI prefs so that opening a problem from the panel and coming
back puts you where you were rather than at the top of the graph again. A
reload is the same.

### The details panel

Docked to the right of the canvas and **resizable by its left edge** — by
drag, and by the arrow keys when the grip is focused, because a drag handle
a keyboard cannot move is a control half the readers do not have. The width
is one custom property, `--lpanel-w`, which is also what the code works out
"is the selected box hidden underneath it" from. Below 760px it is a drawer
across the bottom instead: a 26rem column on a 390px phone is the whole
screen, and the graph it is describing disappears behind it.

**The selected box stays visible.** Everything that puts something "in the
middle" means the middle of what you can see, measured against the panel
rather than against the canvas — otherwise opening the panel to describe a
concept is what hides it.

Inside: the concept, a direct **Practise this** (or **Carry on**, if you
have started it) where there is a next exercise, and then the work in named
lists — **Resources**, **Questions**, **Coding exercises**, **Related
practice**. Those used to be two lists, and the second held the coding
exercises as well as the questions.

### Which total is which

A track's **required** work is the ordered list in `data/tracks.json`. That
is what "8 of 12 solved" means and what the progress bar is a fraction of.
The tree, though, is built from the concepts those problems rest on, and a
concept is shared — `loop-invariants` is named by problems in four tracks.
Everything else resting on a concept this track teaches is worth offering
and is **not** part of finishing the track.

Both used to be counted under a label reading *Problems*, in two places on
the same card, with different totals. Now:

| Label | What it counts | Counts towards the track |
| --- | --- | --- |
| Questions | Required, not code | yes |
| Coding exercises | Required, code | yes |
| Related practice | Reaches this track through a shared concept | no |
| Resources | Readings you have ticked | no |

Only the first two go green when a track is finished. And **ticking a
reading is not solving anything** — it is a note to yourself, nothing
checked it, and the panel says so where the ticks are. A node's bar is its
solves alone; a concept with readings and no problems can be `read`, which
is a quiet grey edge, not the green that a solve earns.

### The layout, and what it claims

One rank per prerequisite depth, **top down**. Everything in rank 2 rests on
something in rank 1 or earlier — that is the whole claim the picture makes,
and `tests/learn-layout.test.mjs` checks it on all eleven real tracks as
arithmetic, with no browser involved. Within a rank the order comes from the
usual barycentre sweep, two passes each way; it is a heuristic, not an
optimum, because minimising crossings exactly is NP-hard and nobody needs it
for twenty-two boxes. Each rank is then centred against the widest, so a
parent sits over the middle of its children rather than flush left of them.

It ran left to right first, which is the same claim turned on its side. A box
is 208 wide and 60 tall, so left-to-right spent the short axis on the thing
that grows: a rank of fifteen concepts was fifteen boxes tall and three
columns wide, and you read down a column to find what the next one rested on.
Top down puts the growth along the axis the boxes are already wide on, and
puts a parent above its children, which is what everybody means by a tree.

It is a DAG, not a tree: twelve of the 115 concepts have more than one
prerequisite. **Every** prerequisite edge is drawn, with the ones that are
not the node's spine dashed rather than deleted, so a node with two parents
has two lines going into it instead of one line and a footnote.

### Lines that go round, not through

An edge is a right-angled elbow: straight down out of the bottom of one box,
across the empty band halfway between the two ranks, straight down into the
top of the next, corners rounded. A single curve was tried first and is wrong
for this shape — there are 76 pixels between ranks and a parent can be eight
hundred to one side of its child, so every curve came out nearly flat and ran
along under the boxes instead of between them.

A prerequisite two or more ranks up used to be one line straight down, which
took it behind every box in the way. **A line entering the top of a box and
leaving the bottom is a line claiming a connection that is not there**, and
nothing on screen tells it apart from one that is. So an edge spanning more
than one rank is now broken at every rank it crosses, and each break is a
two-pixel lane that takes its own place in that rank's order — the boxes are
laid out around it. The test asserts the result directly, on every real
track: no leg of any edge overlaps the rectangle of any box that is not one
of its own two ends.

### It had to stay keyboard-navigable

There is no plainer list to fall back to — the canvas replaced it — so the
canvas itself carries the keyboard and the screen reader. The boxes are real
`<button>`s in a `role="tree"` with `aria-level` for the rank, a roving
tabindex so exactly one is tabbable, and arrow keys that walk it: left and
right along a rank, up to a prerequisite, down to something that rests on
this. Up and down follow an actual edge rather than going to whatever box
happens to be above — that is the more useful answer, and it is the one the
line under your feet goes to. Each box's `aria-label` says its progress in words, because the bar
under the name is three pixels tall and a screen reader cannot see it.

### Following one path

Selecting a box lights the edges that touch it, and then every edge on the
way down to it from a root, at a lighter weight — with the concepts along
that way outlined. One line lit tells you what this rests on; the whole
chain tells you the order to learn it in, which is the question the picture
exists to answer. They are drawn differently on purpose: *rests directly on*
and *is somewhere beneath* are not the same claim.

The old pages are still there and still reachable: `#/tracks/<id>` is the
flat list of one track's problems, linked from the top of every tree, and
`#/concepts` is the whole concept index by topic, linked from the Learn
index. Neither has a tab of its own any more, and both keep the Learn tab
lit while you are in them.

### The wheel

The reported bug: after selecting a node, the wheel did nothing to the
panel and moved the graph behind it instead. The panel is a child of the
canvas, so its wheel events bubbled to a handler that called
`preventDefault()` unconditionally — cancelling the scroll the browser
was about to perform, and panning the graph with the same gesture.
Measured: 400px of wheel over a panel with 928px of content in an 803px
box left `scrollTop` at 0 and moved the graph 400px. A concept's
resources and exercises were unreachable by wheel, which is the ordinary
way to read a long panel.

The rule now, by where the pointer is:

| pointer over | plain wheel | Shift | Ctrl / ⌘ |
| --- | --- | --- | --- |
| the panel, the toolbar, the zoom buttons | the browser scrolls it; nothing here runs at all | — | — |
| the graph | moves vertically; a trackpad's sideways movement moves horizontally | moves horizontally | zooms about the pointer |

Reaching the end of the panel does not start moving the graph either,
and that is `overscroll-behavior: contain` on the panel rather than
anything in JavaScript — only the browser knows which element it decided
to chain to.

Ctrl+wheel does take that gesture from the browser's page zoom *while
the pointer is over the graph*, which is the price of pinch-to-zoom
working inside a canvas. The keyboard zoom (Ctrl +, Ctrl −, Ctrl 0) is
untouched everywhere, the toolbar's zoom buttons do the same job without
a gesture, and the hint line under the graph names all of it.

`tests/browser/learn.test.mjs` drives real wheel events over both, and
asserts the position that changed and the one that did not — including
that the selection and the open panel survive every one of them.

## The front page, and where the dashboard went

`#/` used to be a dashboard: rank, five stat pills, a streak line, a topic
grid and half a year of activity, stacked *above* the two things anyone had
actually come to click. Then it was four doors into the catalogue. Both
answer a question you only have once you are already using the site —
"how am I doing", "what do I open" — and neither answers the first one
anybody actually has, which is *what is this*.

So `#/` is an introduction now. A headline, the four strands the problems
are drawn from, two buttons, four drawings of what is inside, three steps
saying what happens when you use it, three things it claims to do, and a
strip of numbers. Nothing on it is a control except the buttons, and
nothing on it is a problem.

Everything that was ever on it moved to where it is actually useful:

| was on the dashboard | is now on |
| --- | --- |
| Rank, the bar, the streak line | **Profile** |
| Five stat pills | **Profile** |
| The activity heatmap, with its legend | **Profile** |
| The topic grid | gone — Problems filters by subject and topic |
| **Continue learning** | the rail beside **Problems** |
| **This week** | the rail beside **Problems** |
| Anything due for revision | the rail beside **Problems** |
| The four doors | the **Content** menu in the bar |

Carrying on where you left off is a *problem*, so it belongs where you go
looking for one. The rail sits beside the catalogue above 1100px and drops
under it below.

Two things on the page are not written in `index.html`, because they are
counted rather than claimed: the strip of numbers, and the main button —
which says **Start solving** to somebody who has not been here and **Carry
on**, naming the problem, to somebody who has. With nothing loaded the
strip says so and names the fix, rather than reading as five zeroes.

The four drawings are illustrations of what is inside, not screenshots and
not proofs of anything: each says underneath what it stands for.

### Content: one entry in the bar

Two links could only ever name two of the places this site goes, and
neither *Problems* nor *Learn* explains itself to somebody who has just
arrived. So the bar has one entry, **Content**, and it opens on all of
them with a line each saying what it is for and a count beside the ones
that can be counted. The counts come from the catalogue at the moment the
panel opens.

It holds learning destinations and nothing else: Practice (Problems,
Questions, Coding exercises) and Guided (Learn, Reading, This week).
Profile, Shop and *Running code* used to be a third column here as well
as behind the avatar, which is one menu offering two routes to the same
page and neither of them obviously the one to use. The avatar is where
everything about **you** is; this is where everything about the
**subject** is. Execution help did not disappear with it — it is a line
in Settings and a link in the bar under the editor, which are the two
places you are standing when you need it.

It opens on hover and a click pins it open; the pin is the fix for the
pointer firing `pointerenter` before `click`, which otherwise shut a menu
the reader had just opened by arriving at it. Hover alone would put the
whole site behind a gesture a keyboard cannot make, so Enter opens it,
Tab walks it, Escape closes it and puts focus back on the button, and a
click outside closes it. Which page you are on is marked inside the panel
rather than on the button, because *Questions* and *Coding exercises* are
the same view with a different filter.

### Questions and Coding exercises

Two of the entries are the one catalogue, split: `kind=questions` is
everything that is not a coding exercise (72), `kind=code` is everything
that is (37), and together they are all 109. It is a filter like any other
— a **Kind** select sits beside Subject — and like Subject, a search
overrides it, because looking for something by name should find it whichever
way you came in.

### Language: can be solved in, not taught in

Most coding exercises here are C++ only, and that is deliberate: thirteen
of them are *about* C++ — a function signature, a `const std::string&`, a
`std::vector` — and writing them in Python would be a different exercise.
Seventeen are about an algorithm or a simulation, and those declare C++
and Python both, with a reference solution in each that the audit runs
before certifying the language.

What was missing was any way to use that. A **Language** select sits
beside Type, and it means *can be solved in this language*, which is a
property of the exercise and not of what is installed. Each option
carries how many problems declare it — `C++ (30)`, `Python (17)` — so
that C++ being most of them is visible before you choose it rather than
after. A question declares no language at all, so choosing one leaves
only coding exercises, and the count says *coding exercises* to match.
It is in the route too: `#/problems?lang=python`.

Choosing a language that nothing matches says why in those terms —
*whether a problem offers a language is a property of the exercise, not
of what is installed* — rather than offering "clear a filter" and leaving
you to work out which one and what it meant.

### You, in the top right

Everything about you is behind the avatar: XP, coins, streak, and the way
to Profile, Shop and Settings — and so, through Settings, export and
import of everything the site has stored about you. The ring around it is
progress to the next rank, which is the one number worth seeing from
every page. Nothing here is duplicated in the Content menu, and a test
asserts both halves of that: these three are in this menu, and none of
them is in that one.

It is a real menu rather than a hover trick — `aria-expanded` on the button,
`role="menu"` on the panel, focus moves in on open, Escape closes it and
puts focus back on the button, and a click anywhere outside closes it too.

## Tracks, the weekly problem, and resources

With this many problems the hard part is choosing one, so the site answers
that twice — **Continue learning** and **This week**, both in the rail
beside the catalogue — and three data files back it up:

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
| **Writing hardware, and watching it run** | 7 | Four designs you write in SystemVerilog and simulate in this tab — a multiplexer, a counter, an edge detector and a state machine that finds a pattern — with the waveform beside each one. |
<!-- /generated:tracks -->

### The workspace

A `code` problem opens as a workspace that uses the whole window: nothing but
the site header is above it, and the page itself never scrolls — every panel
scrolls on its own.

```
┌ back · 25/85 · title · difficulty · status ····· A− 14 A+ · ☆ · Focus · ⋯ ┐
├────────────────────────────┬──────────────────────────────────────────────┤
│ Description  Prereqs       │ Editor │ C++ ⌄ │ Results  Test cases         │
│ Hints  Notes  Solution 🔒  │        Submissions  Compiler output          │
│                            ├──────────────────────────────────────────────┤
│                            │                                              │
│  the statement             │  whichever one of them you are looking at    │
│                            │                                              │
│                            │                                              │
│                            ├──────────────────────────────────────────────┤
│                            │ Reset  Saved      Browser   Run tests  Submit│
└────────────────────────────┴──────────────────────────────────────────────┘
```

**One strip, and one pane at a time.** It used to be a horizontal split: the
editor above, a second tab strip below, and a divider between them. That gave
the editor about half a column, and it gave the sample cases a permanent seat
they had not earned — they are read once and then not again. So the editor is
a tab among the rest, and whichever one you are looking at has the whole
column. The editor went from fifteen visible lines to thirty-five on the same
screen.

The editor is never destroyed to show another tab. CodeMirror holds the undo
history, the cursor and the scroll position, and all three would go with it;
both panes stay mounted and the CSS shows one. Switching tabs — on either side
— repaints only the pane that changed, so this is now true of the statement and
the hints as well.

The language is a **dropdown in the strip** rather than a row of buttons: four
buttons said what the problem *could* be written in, where what you need is one
saying what it is being written in now.

Under each language in the menu is a line saying **where it would run** —
`Browser · clang 20.1.2`, `Local · 13.3.0`, or why it would not:
`no runner — see Running code`, `needs the native toolchain`. Nothing is
removed and nothing is disabled. A language the exercise accepts but this
device cannot run is still worth opening: the template is the clearest
statement of what the exercise wants in that language, and you may well be
about to start a runner. A disabled button with the reason in a `title` is
invisible to a reader who has not hovered and absent altogether on a
touchscreen, which is how *"nothing can run this"* came to look exactly like
*"this is not offered"*.

A problem that takes one language says **"C++ only"** in words beside the
name. That was a `title` on a disabled button too, so the thirteen C++
fundamentals exercises — which are C++ only because the exercise *is* C++ —
were indistinguishable on screen from an exercise whose other languages had
broken. That is the whole of the "why is there no Python here" question: on
the seventeen exercises that declare Python it is there and ready; on the
thirteen that do not, nothing said why not.

The menu hangs out of the bottom of the tab strip, and the strip used to
scroll sideways. A scroll container clips its children on **both** axes — CSS
computes `overflow-y` to `auto` the moment `overflow-x` is not `visible` — so
the menu was being cut off below the first option and looked like a short
menu rather than a clipped one. The strip wraps instead, which costs a second
row of tabs on a phone and clips nothing. `tests/browser/usability.test.mjs`
hit-tests every option rather than trusting the DOM, because the DOM looked
perfectly healthy throughout.

**Run tests**, **Submit** and **Reset** are in one bar across the foot of the
column, outside the scrolling pane, with the execution backend beside them.
Reset was *"Reset to template"* under the editor; it is one of the three things
you can do to a program and the other two were already down here.

Pressing Run opens **Results** before the run starts rather than after it
finishes, so a first in-browser compile — which is a 90 MB download — is
watched in the pane that will hold the answer.

One divider is left, between the statement and the editor. It drags, and takes
the arrow keys, `Home`, `End` and `Enter` to reset. Its position is remembered,
and **Reset layout** in the `⋯` menu puts it back without touching a draft or a
solve.

The divider is 18px of hit area with a visible 10px bar and a grip in the
middle of it. It was 10px containing a 1px hairline, which is to say invisible:
"dragging the divider does nothing" was mostly people not finding it and
scrolling the pane behind it instead. A split remembered from a wide monitor is
clamped rather than honoured on a small one — neither panel is ever allowed
below 320px — and the stored preference is left alone, so the big screen gets
it back.

The bar also names the execution backend, always: **Hosted**, **Local** or
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

### What a result says

A list of eight rows answers *which one failed*. The question you have the
moment a run finishes is *did it pass*, so that is the summary above them:
the fraction, the word for it, how long it took, and three counts. The first
failure's reason is at the top as well, because finding it by opening rows
one at a time is the thing the summary is for.

A build failure never reaches it — the compiler's output stands on its own,
and "0 of 7 passed" about a program that never ran would be a statement
about output nobody obtained. Passing with the sanitizer still complaining
is its own line: the output is right and the program is not.

Each case below is a row that opens, and the rows are **buttons**, so they
can be reached with the keyboard; they used to be `div`s with a click
handler, which the keyboard could not reach at all. A failing case opens
itself and a passing one stays shut. The row shows the input that produced
it, too — Run used to say `stdin (none)` on every row, which is not "we did
not keep it" but a claim about the case.

A submission is described as what it is: *7 cases: the samples and the
hidden ones*. The old wording was "7 hidden cases passed", which was never
true of a submission — it runs the visible ones as well.

### Where your code goes

Every template marks the hole, in that language's comment syntax, and says
what belongs in it:

```cpp
bool isPrime(int n)
{
    return false;   // your code here — true when n is prime; 1 and anything below it are not
}
```

A marker that could be moved to another problem unchanged tells nobody
anything, so `tests/content.test.mjs` holds all 61 problem-and-language
pairs to both halves of that rule: there is a marker, it is a comment in the
right language, and it says something beyond "your code here". It also
checks that no marker quotes a line of the reference solution — which the
leak audit cannot do for itself, because it treats every template line as
deliberately given. Four beginner C++ problems do hand over a loop header or
a call site on purpose; each is named with its reason.

### Submissions

The record used to keep `attempts` as a count, which answers "how many times"
and nothing else. **Submissions** is the list that answers the question that
actually comes up: what did I send, in which language, and what did it do?
One row per graded program, newest first, folded shut — the point is scanning
the verdicts, and ten open programs are a scrollbar rather than a list. Open
one and the program is there as it was sent, with a button that puts it back
in the editor. It switches language first if it needs to, and it asks before
replacing what is in there, because the editor holds the draft and the draft
is the only copy of it.

**Run is not in here.** Running the samples happens dozens of times and is
for the editor; Submit also runs the hidden cases, and that is the thing worth
a record. A submission that could not be run at all is not in here either,
for the same reason it does not count as an attempt: nothing was judged.

A build failure is stored as its own outcome rather than as a wrong answer,
and it claims no cases, because none ran. "0 of 7 passed" about a program the
compiler refused would be a statement about output nobody ever obtained.

This is localStorage, so everything is capped: **ten** submissions per
problem, **6,000** characters of any one program, and **20,000** characters of
stored source per problem in total. Past that the oldest give up their code
and keep their verdict — the row says so rather than showing an empty
program. If a write fails for want of room, the stored programs are dropped
and the write is retried: an XP award that silently fails to persist is a
worse outcome than a submission you cannot read back.

Non-code problems get a single comfortable reading column instead, with the
answer controls under the statement and the same retry feedback. Below 900px
both layouts stack rather than being squeezed into columns.

`F` toggles **focus mode**, which hides the header and gives the problem the
whole window. `Escape` leaves it. Panel sizes and focus mode are stored under
`invariant/ui/v1`, separate from progress, so a bad value there can never
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

## Review, and what I missed

A queue of everything you have left a reason to come back to, at
**`#/review`**, reached from **Content ▸ Assess**. Five reasons, and
every row carries the one that put it there:

| | |
| --- | --- |
| Due for revisit | you booked a date and it has come |
| You wrote down what you missed | there is a note from the last time you got it wrong |
| Attempted, not solved | you have had a go and it is not right yet |
| You read the answer | revealed rather than reached |
| You bookmarked it | you starred it |

The obvious alternative is one number per problem, and it is worse. A
mastery score is an opinion with no argument attached: it cannot be
checked, it cannot be argued with, and when it is wrong there is nothing
to look at. These are **facts about things you did**, each one with its
own undo.

"Done with it" clears exactly the things that put the row there — a
bookmark, a booked date, a note — and touches nothing else. It is a
statement about the list, not about the problem, and the solve record
is not changed.

### The note is asked at the only useful moment

Getting something wrong produces a one-line box: *what did you miss?*
Not the Notes tab — that is "what did this teach you", written whenever
— but one line written **while you still know why**, which is a window
that closes within about a minute.

It is explicitly not a mark. Nothing reads it, nothing scores it, and
the box says so. What it does is put the problem on the review list
with your own sentence on the row, so the list says something instead of
*revise this*. Beside it are links to the concepts the problem rests on,
which is the honest answer to *and where do I read about it*.

### Your rating is yours

"How hard did it feel" is 1–5 and travels to the Learning Tree as
`perceived`. On the review queue it is shown as `felt hard`, visually
apart from anything a grader said, and a problem you never rated says
**not rated** rather than being given a number.

It is never added to anything. A feeling and a check are different kinds
of claim and averaging them produces something that is neither.

## Where your data lives, and what gives when it runs out

A submission has two halves and they want different storage.

The **verdict** is forty bytes — when, which language, how many cases
passed, did it build. It is read on every paint of the Submissions tab
and has to be there synchronously, so it stays in `localStorage` with
the rest of the progress state.

The **program** is kilobytes. It used to be cut at 6,000 characters,
with the oldest dropped at 20,000 per problem. That cap was the right
answer to the wrong question: it was protecting the five-megabyte origin
quota, and a quota failure does not lose the submissions — it loses the
whole state file, XP included. But the only reason to keep a program is
*load this one back*, and **a program cut in half cannot be loaded
back**.

So programs live in IndexedDB now, through `js/vault.js` and
`js/sources.js`, one record per problem keyed by the submission's
timestamp, and they are **not truncated**. The verdict keeps `stored`
and `bytes` so the row can say what it has without a read, and the
program is fetched when the row is opened rather than when the list is
painted — ten reads to draw a list nobody expanded is ten too many.

`tests/browser/review.test.mjs` submits a 17,000-character program,
reloads, and checks every character comes back into the editor. It also
submits it twice more and checks the progress file grows by about a
hundred and fifty bytes.

### The migration

The programs already in `localStorage` are copied across on first boot,
in the background. **Nothing is deleted.** A migration that throws away
the original before the copy is proven is how people lose things, and
the record is forty bytes larger for keeping it. A migration that could
not finish does not mark itself finished, and says so.

### What gives when the quota is full

Something has to, and which thing is a decision worth writing down:

- **not the drafts.** A draft is work in progress and the only copy of
  it. Throwing away what somebody is in the middle of writing, to make
  room for the record of what they finished last week, is the wrong way
  round.
- **not the newest verdicts**, which are what the Submissions tab is
  for.
- **the oldest verdicts** beyond the newest three, which is a history
  and prunable by nature. Their programs go with them — a program is
  kept for exactly as long as its verdict, and nothing is dropped while
  its verdict is still listed.

It is said out loud when it happens, with the policy in the sentence.

### Storage that is not there

IndexedDB is missing in some private windows, with site data blocked,
and in some embedded webviews. The vault falls back to `localStorage`
and then to memory, and **says which it is using** — Settings ▸ Storage
names both stores, how much is in the larger one, and what it means if
either is degraded. A write that reached only memory is **reported**
rather than treated as saved: starting an assessment that cannot be
written to disk says so before the clock, not after the tab closes.

### Export carries all of it

One file — progress, drafts, the programs you submitted, and your
assessment attempts — because three files is three files to lose. A file
exported by an older version is still imported: the old shape is the
progress object itself, the new one has it under `progress` with the
rest beside it, and refusing the old one for want of a wrapper would be
refusing somebody their own data.

## Online Assessments

A separate mode, from a separate bank, reached from **Content ▸ Assess**.
Problems against a clock, on questions that are not in the catalogue and
that you therefore have not met.

### Every format, and the bug that said otherwise

A question in an assessment that was not a coding exercise *appeared
static*. It was, in the literal sense, and the cause had nothing to do
with the question types.

A coding exercise fills the attempt's row with the workspace grid, which
is fixed-height and scrolls inside its own panes. Everything else —
a multiple choice, a predicted output, an ordering — fills it with
`.pwrap.reading`, which is an ordinary block that expects the *page* to
scroll. Under `body[data-attempt]` the page does not scroll, by design,
so that the clock cannot be scrolled away from. Measured at 1440×900 on
question one: **1,064px of content in an 803px row, no scrollbar
anywhere, the answer box cut off mid-listing and Submit at y=1076** with
`elementFromPoint` returning null on it. The question rendered, and could
not be answered.

The scroll therefore belongs to the question, one level in.

The second half was persistence. The editor has saved every keystroke
since the day it was written; every *other* kind of answer lived nowhere
but in the DOM, so moving to question 2 and back rebuilt the widget from
the problem file and a reload threw it away. Now every type has a draft,
in one slot, through the same hook the editor uses — the practice store
in practice, the attempt under a clock. The navigator can finally show
**written, not sent**, which is the one state it exists to show.

`order` and `match` gained the `restore()` they never had, and `match`
gained `partial()`: three of five pairs is not an *answer* — grading it
would cost a first-try bonus for stopping to think — but it is twenty
minutes of work and has to survive going away and coming back.

A click saves at once; only typing is debounced. Everything was debounced
at first, and that lost the answer of anybody who ticked an option and
reloaded within 180ms. A pending write is also flushed on leaving the
question, on hiding the tab and on `pagehide`.

**Verified** against all eleven formats in `tests/browser/assessment.test.mjs`:
answer it, navigate away, come back, reload the whole page, read it back.

### The policy is enforced, not printed

`feedback.duringAttempt` was shown on the pre-flight page and then never
consulted. An assessment that says *nothing until you finish* and then
prints "Not that one." under the question has told the reader something
false about itself, which is worse than either policy would have been.

Submitting now reports that the answer was **recorded**, and the three
states a question can be in — not answered, answered, submitted — are
kept apart from the fourth thing, **graded**, which does not happen until
the attempt ends. `mark()` does not run under a clock at all: it is
deliberately allowed to say more than nothing, which is right in practice
and is a verdict the policy may not have promised.

A **written proof** is allowed, and is recorded as submitted and
*ungraded*. Nothing here marks a proof and a keyword search is not a
reading. The rubric and the model proof are both disclosure, so they
belong after the clock stops: the review afterwards shows the proof as
written, the rubric beside it, and a self-mark that is recorded as the
reader's own judgement and is never added to the automatic score.

### Immersive by default, with no button to press

An attempt used to run inside the ordinary page, with the Content menu,
the avatar, the XP and the coin purse above it, and a Focus button in the
problem offering to hide them. Three things wrong at once: the navigation
goes somewhere the reader must not go mid-attempt; the purse and the XP
are the one part of the site an attempt deliberately does not touch,
sitting in the corner implying otherwise; and the fix was a control they
had to find.

Now the attempt takes the window and the only header is its own, carrying
the six things a reader under a clock needs — what this is, how long is
left, where they are in it, whether their work is saved, how to finish,
and how to get out. **Exit** says in plain words that the clock does not
stop, because it is a deadline rather than a counter and a deadline that
paused when you navigated away would be one anybody could stop.

Fullscreen is requested from the Start click, which is the only moment a
browser will consider it, and is a **bonus**: the layout is CSS and owes
it nothing. If the browser refuses, nothing happens. If the reader presses
Escape they stay in the attempt, and nothing asks again — re-requesting on
`fullscreenchange` is a page fighting its reader, and would not work
anyway. Tested by making `requestFullscreen` reject.

Prerequisites went with the hints. A prerequisite is a reading
recommendation, which is the right thing in front of somebody learning and
the wrong thing in front of somebody being assessed, because it names the
topic the question is about. It is not deleted: the review links every
question to its concepts, which is the moment that reading is worth
anything.

And the toolchains are downloaded **before the clock starts**, not when
the first Run asks for them. Pressing Start on an assessment with a C++
question fetches clang first, reporting progress on the button. Four of
your forty minutes spent fetching eleven megabytes at question three is
four minutes nobody gets back.

### Starter code is authored, not stripped

The practice template for the run-length exercise says *"walk s, and for
each run of identical characters append the character and, only if the
run is longer than one, its length. Jump past the whole run, not past one
character."* That is the right thing to hand a learner. Under a clock it
is the algorithm, in the editor.

So an assessment coding exercise carries a second starter,
`payload.assessmentTemplates`, with everything that is part of the
interface — the includes, the signatures, the harness in `main` that
reads the input and prints the result — and nothing that is part of the
method, plus a `TODO`. Two authored files rather than one file with the
comments stripped by a regex, because a regex cannot tell coaching from
an interface contract, and a licence header is a comment too.

`npm run check:assessments` refuses a missing starter, one that is
byte-identical to the teaching template, one with coaching still in it,
and one containing a line of the **reference solution** that is not also
in the teaching template. All four were negative-tested by breaking them
deliberately.

### The bank cannot be read around

An assessment problem is reachable by id, which is how the attempt
renders it with no changes at all and how the review afterwards can link
to it. Two consequences had to be closed:

- **during** the attempt, `#/p/<that question>` is refused, with the way
  back. The route worked, and came with a Hints tab and a Solution tab,
  for a question being asked under a clock.
- **afterwards** it opens like any other problem — and is scored as
  nothing. No XP, no solved status, no row in a submission history, no
  position in a catalogue it is not in. Otherwise sitting the same
  assessment twice would pay twice, and the site's totals would stop
  adding up.

The one way the bank reaches the practice side is deliberate: **Add to
review** on the results page puts the question on the review list, with
the reason "you bookmarked it" and the row saying it came from an
assessment. Nothing else follows from it.

### The pool is the point

An assessment made of problems you have already practised is not an
assessment. So a problem carries `"pool": "assessment"` and
`scripts/build-index.mjs` writes it to **`data/assessment-index.json`**
rather than to `data/index.json`.

`js/assessments.js` then registers that second index into the catalogue's
**id lookup only**:

- `Catalog.get(id)` and `Catalog.meta(id)` work, so the ordinary problem
  page renders an assessment problem with no changes at all;
- `Catalog.all()` does not contain it, so the catalogue cannot list it, no
  filter can reach it, a search for it finds nothing, and every count on the
  site stays a count of the practice catalogue.

All of that is asserted — `tests/content.test.mjs` checks the two files
cannot overlap, and `tests/browser/assessment.test.mjs` searches the
catalogue for a bank problem by name and insists on nothing.

The bank is audited like everything else: `oa-run-length` is certified for
the browser C++ compiler and for Pyodide by `npm run audit:cxx` and
`npm run audit:py`, which read **both** indexes. An assessment coding
exercise needs a toolchain like any other.

### Adding one

Data, not code. Nothing in `js/` is edited.

1. Write the problems into `problems/<topic>/` with `"pool": "assessment"`,
   and their keys into `solutions/` — same schema, same validation, same
   reference-solution checking as a practice problem.
2. Add an entry to `data/assessments.json`.
3. `npm run build:index && npm run check:assessments`

The schema is written into the top of `data/assessments.json` itself, field
by field, so it is next to the thing it describes. The fields that are not
obvious:

- **`version`** — bump it when the problems, the weights or the duration
  change. Every attempt records the version it was sat under, so editing an
  assessment never re-scores an older attempt against rules nobody took it
  under.
- **`langs`** — per problem, a *subset* of what the problem offers. An
  assessment cannot invent a language, and `check:assessments` refuses one
  that the problem does not have.
- **`scoring.weights`** — per problem. The score is the weighted fraction,
  with partial credit unless `partialCredit: false`.
- **`feedback.solutions`** — must not be `true`. The validator refuses it:
  an assessment with a Solution tab is not an assessment.

`npm run check:assessments` also fails on a problem that is in the
**practice** catalogue — the single easiest mistake to make here — on a
duplicate id, a weight that is not positive, a pass mark outside 0–1, and
on a bank problem no assessment uses, which is a problem nothing can ever
reach.

### Before the clock exists

An assessment that tells you its duration after you have started, or that
reaches problem three and discovers there is no compiler, has wasted
something you cannot get back. So `#/assess/<id>` says all of it first:
duration, the problems by name, the languages, the weights per problem, the
pass mark, and what feedback you get while it runs. Then it **checks the
runners** and offers to download the toolchains — before the clock, on
nobody's time.

It also says what this is not, in four lines, because the alternative is
implying something false:

- a personal practice mode, not a proctored one. The deadline and the hidden
  cases are both in this browser and anybody who wants to edit them can;
- the clock is the device's clock and keeps running while the tab is shut;
- on expiry, whatever is saved at that moment is graded, once;
- nothing here touches XP, a streak or a problem's solved status.

### The clock is a deadline, not a counter

This is the part that is easy to get wrong and invisible when you do. A
counter that decrements once a second **stops in a background tab** —
browsers throttle timers there to about once a minute and sometimes stop
them — so a counter hands minutes back to anybody who switches away, and
loses the attempt entirely on a reload.

So `Attempts` writes down an absolute `deadlineAt` when the attempt starts
and every question about time is *what is the time now, and what was the
deadline*. Coming back to the tab re-reads the attempt from storage, which
also covers the two things a second tab can do: finish it, or start another
one. There is at most one running attempt and the store is the single answer
to which — so the tab that comes back adopts what it finds rather than
trying to resolve a conflict.

Expiry freezes what was **saved**, which is only honest because drafts are
saved as they are typed rather than on submit. `tests/browser/assessment.test.mjs`
types a marker, moves the stored deadline, and checks that marker is what
was frozen.

Finalising happens **once**. The guard is inside the same read-modify-write
as the scoring, because a deadline firing in one tab while Finish is pressed
in another is a real race rather than a theoretical one, and the test
finishes an attempt twice and checks the results do not move.

### During

The same workspace as practice, with three differences:

- **Hints, Notes and Solution are not there.**
- **Submit records into the attempt** and nowhere else — no XP, no coins, no
  streak, no change to the problem's solved status, no row in its practice
  submission history. The test checks all five after a correct submission.
- **Drafts go to the attempt**, per problem and per language, through a hook
  in `Store`. Practice work on the same problem id is a separate thing and
  neither overwrites the other.

**Run is not Submit.** Run checks the visible cases and records nothing;
Submit records an answer and can be done again.

The **navigator** has three states and they are three different things:
nothing written, written and not sent, submitted. The middle one is the
reason it exists, so it updates on a keystroke rather than only on a submit —
a navigator that says "nothing written" while something is written is worse
than no navigator.

**Finish assessment** is explicit and confirmed, and the confirmation names
the problems that have not been submitted rather than asking in the
abstract.

### Afterwards

A score, a verdict, and a row per problem: the outcome, the weight, the
fraction, how many cases passed, the language, how many times it was
submitted, and **the program you sent, whole**. Then links to the concepts
it rests on, and to the problem itself — which is readable with its solution
now that the attempt is over.

Three outcomes are kept apart because they mean different things:

| | |
| --- | --- |
| graded | the grader looked and said |
| unanswered | nothing was submitted |
| **errored** | execution failed — no runner, a backend that threw |

An `errored` problem is **not** counted as wrong and **not** counted in the
total, and an attempt containing one gets **no pass verdict at all**. A pass
computed over the problems that happened to work is not a pass, and calling
a missing compiler a wrong answer is the single most dishonest thing this
mode could do.

A retake is a separate attempt with its own id and ordinal. Both are kept,
both are listed, and neither earns anything.

### Where it is stored

Not in `localStorage`. An attempt holds a whole program per problem per
language, and the practice submission store caps a program at 6,000
characters to protect the five-megabyte origin quota — a cap that is right
there and wrong here, because a program cut in half is a program you cannot
put back in the editor.

`js/vault.js` is IndexedDB behind a key-value interface, with a
`localStorage` fallback and then an in-memory one. It says which it is
using, and a write that reached only memory is **reported** rather than
treated as saved: starting an attempt that cannot be written to disk says so
before the clock, not after the tab closes.

## The audit

`tests/browser/audit.test.mjs` walks the journey the site is for, in one
browser, in order:

> learn a concept → practise → understand the mistake → revisit the weak
> area → test yourself

Every other suite tests one leg of that in isolation. This one walks all
of it, because **the bugs that survive isolated tests are the ones in the
joins**: a mode flag that outlives its mode, a result that lands on the
next page, a draft that one feature saves and another overwrites.

It then re-checks, cheaply and across every route, the three failures
that have each happened here more than once.

### The mode flags, from everywhere to everywhere

Three modes take the window — the code workspace, the Learn graph, an
assessment attempt — and each sets a flag on `<body>`. Each time one has
been added it has eventually been left on:

- the code workspace left the dashboard clipped to the window with no
  scrollbar (422px of it reachable, 29,021px of the reading map not);
- the graph was given the same mechanism and the same fix in advance;
- the assessment attempt cleared its flag on any route not *starting
  with* `assess`, which matched the results page too, so the review
  arrived full-bleed and pinned to the left edge. Caught by looking at
  its own screenshot.

So the audit enters **every route from every other route** — 182 pairs —
and measures the *destination*: no flag survives, `.main` has a
`max-width` and is not `overflow: hidden`. Adding a fourth mode means
adding one line to that list.

### Anything you type is text

Four places take free text and show it again: the Notes tab, the "what I
missed" line, the profile name, and a submitted program. Each is checked
with `<img src=x onerror=…><b>bold</b>` — nothing runs, nothing is built
out of it, and the text is shown as the text it is.

The program is the interesting one, because displayed code **is**
highlighted, which means HTML is inserted rather than text set. It goes
escape-first, then highlight the escaped text, which is what the
highlighter is written against.

### A stale something writing to a page it does not belong to

- **A run left behind.** Opening another problem mid-compile used to
  leave the new problem's bar reading *Running…* for ever: the backend's
  progress callbacks and the download bar were unguarded. Found by the
  Rust suite; the fix is in code that runs for every language.
- **An assessment clock.** Two tabs on one attempt: the second finishes
  it, and the first — on coming back to the front — re-reads the store,
  goes to the result rather than carrying on, and records **one**
  attempt, not two. The dead clock is taken out of the document rather
  than merely hidden, because something finding it by id and believing
  an attempt is running is how a mode comes back from the dead.

### What else it checks

- **The last character typed is the one that is run.** Drafts save on a
  debounce and a run reads from CodeMirror rather than from the draft,
  which is the only reason this works — so the test types and clicks
  with no pause at all.
- **Wrong → edit → retry.** A wrong answer is marked wrong, reveals
  nothing, and is not recorded as solved; editing relabels the verdict
  *Previous attempt* and marks it stale rather than re-grading or
  silently disappearing.
- **An attempt has no catalogue chrome.** No position in a catalogue the
  problem is not in, no previous or next, no practice status, and no
  bookmark — bookmarking an assessment question would file it away to
  practise later, which is the one thing the bank must not become.
  Caught by looking at a screenshot that said `0/109`.

### What it found that was real

Everything above that is described as a fix. Plus one small one: typing a
new name in Settings saved it and never repainted the avatar menu, so the
old name sat in the top right until an XP award or a reload.

### What it did not find

Worth saying, because an audit that reports only hits is an audit nobody
can calibrate. No route leaks across the 182 pairs, no injection in any
of the four free-text fields, no uncaught errors anywhere in the journey,
no sideways scroll or clipped row on the new views at 390px, 768px or
1024px, and the last-character and wrong-then-retry paths were already
correct.

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

There are three tiers and they prove different things. Keeping them
apart matters because a pass in one is not a pass in another — the
standing rule here is that **localhost success does not prove deployed
compatibility**, and the only way to keep that rule is to be able to
say which tier a green tick came from.

| Tier | What it runs against | How |
| --- | --- | --- |
| **Sandboxed** | the site's modules in a `vm` or in jsdom, with `localStorage` and `fetch` stubbed | `npm test` — no browser, no server, runs in CI on every push |
| **Local** | a real Chromium against `npm run serve` on this machine | `npm run test:ui`, plus the language suites. NOT in CI: it needs a server, and some of it needs a runner CI deliberately does not have |
| **Deployed** | a real Chromium against `https://mobeenmohammed.github.io/systems-problems` | the same suites with `BASE=…`. This is the only tier that proves the published site works, and it is the one run before saying anything is finished |

Every suite below can run against any tier that makes sense for it; the
table says which it is written for. A suite that needs something — a
server, a local runner — says so rather than silently passing because
the thing it was testing never happened.

### Sandboxed: `npm test`

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

### Local and deployed: `npm run test:ui`

These are not in `npm test`, because they drive a real Chromium against a
real site. Run them against localhost while working and against the
deployed URL before believing anything:

```bash
npm run serve                     # in one terminal
npm run test:ui                   # in another
BASE=https://mobeenmohammed.github.io/systems-problems npm run test:ui
```

| Suite | What it covers |
| --- | --- |
| `tests/browser/results.test.mjs` (`npm run test:results`) | The Results pane, through real runs of a JavaScript problem: the summary's fraction, badge, three counts and first-failure banner; a run that passes everything saying so with no banner; the rows' status, reason and time; a failing case opening itself and a passing one staying shut; opening a row from the keyboard; the input being shown rather than claimed absent; a submission described as samples-and-hidden; and the summary holding its shape at four widths |
| `tests/browser/submissions.test.mjs` (`npm run test:subs`) | The Submissions tab, through real submissions of a JavaScript problem — so it needs the site served and nothing else: that Run adds no row and Submit does; that a near miss reads as 1 of 7 rather than as "wrong"; that a build failure is not stored as a wrong answer; newest first with the program in it; loading one back, including the confirmation and the language switch; surviving a reload; a row whose code was dropped saying so; and a 1,700-character line scrolling inside its own box at four widths |
| `tests/browser/journeys.test.mjs` (`npm run test:journeys`) | The reported failures as journeys, with real mouse and keyboard: typing, caret placement, Tab, paste, cut, undo, long lines, scrolling, resizing, zoom, per-language drafts across a reload, a wrong MCQ and a wrong multi-select that disclose nothing, reveal-with-confirmation, practising a solved problem, and the layout at 1440×900, 1920×1080 and 390×844 in both themes |
| `tests/browser/hosted.test.mjs` (`npm run test:hosted`) | The published-site journey with **no local runner**: write C++, Run, Submit, get marked — plus a compile error, a wrong submission then a fix, a timeout, a rate limit, an unreachable runner, and a check that no submission went to localhost |
| `tests/browser/local.test.mjs` (`npm run test:local`) | The same workspace against the **local runner**, which is the only backend that can produce them: a warning on a successful build, a clickable compiler diagnostic that moves the caret, a build failure, a timeout, and a sanitizer trip on a program whose output is right |
| `tests/browser/navigation.test.mjs` | Leaving a problem for every other page, thirty times over, plus focus mode, Back/Forward and a drag abandoned mid-navigation. Measures the **destination** page: is anything clipped out of reach, is the navigation there, can you still click and scroll |
| `tests/browser/resize.test.mjs` | The divider, dragged with a real pointer, asserting measured panel widths before and after. Minimum widths, keyboard resizing, every way a drag can end, a split saved on a big screen opened on a small one, Reset layout, the editor having the whole column rather than half of it, and what was typed — and the undo history — surviving a trip to another tab |
| `tests/browser/feedback.test.mjs` | A wrong answer on each of MCQ, select-all and find-the-bug: that the explanation is substantial, that it discloses nothing, and that the verdict is relabelled and the marks cleared the moment the answer changes |
| `tests/maths-expr.test.mjs` | The expression engine on its own: equal values comparing equal however they are written, unequal ones never comparing equal, syntax errors and unsupported expressions reported as *different kinds* of failure from a wrong answer, and eleven injection attempts refused |
| `tests/maths-render.test.mjs` | KaTeX renders, emits MathML, and markdown does not get at the TeX first — `$a_1 + a_2$` must not become `a<em>1 + a</em>2` |
| `tests/browser/maths.test.mjs` (`npm run test:maths`) | Subject as a filter over one catalogue, typesetting on the page, every one of the six answer formats, a syntax error costing no attempt, a wrong answer explaining the misconception, progressive hints, the figures, a written proof reaching **Self-reviewed** without ever being marked right, and the review being finishable from wherever revealing the model proof leaves you |
| `tests/browser/audit.test.mjs` (`npm run test:audit`) | The whole journey in one browser, in order — learn a concept, practise the exercise it sends you to, get it wrong and write down why, find it on the review list in those words, then sit the assessment and watch it change no XP — followed by the three failures that keep recurring: **182 route pairs** measured at the destination for a mode flag that outlived its mode, four free-text fields checked for injection, the last character typed reaching the run, and two tabs on one attempt finalising it once |
| `tests/vault.test.mjs` | The key-value store and the source store driven directly, on the **fallback** path — which is what a private window gets, so it is worth testing rather than skipping: a round trip, a write that cannot land anywhere durable being reported rather than claimed, a program kept whole at 80,000 characters, a program dropped only once its verdict is gone, and a migration that copies the old truncated programs across without deleting them and refuses to mark itself finished when part of it failed |
| `tests/browser/review.test.mjs` (`npm run test:review`) | The same storage on **real IndexedDB**: a 17,000-character program submitted, surviving a reload, and coming back into the editor whole — plus two more submissions of it growing the progress file by about a hundred and fifty bytes. Then the review queue: the one-line note asked after a wrong answer and appearing on the queue in those words, every reason naming itself, an unrated problem saying "not rated" rather than being given a number, "Done with it" touching nothing but the list, no assessment problem leaking onto it, export and import carrying the programs, and Settings naming both stores |
| `tests/browser/assessment.test.mjs` (`npm run test:assess`) | The timed mode end to end: that the bank is not in the catalogue and a search cannot find it, that everything is said before the clock exists, that Hints/Notes/Solution are gone during an attempt, that a correct submission moves no XP, no coins, no streak and no solved status, that the navigator tells written-from-submitted, that a **real reload** resumes the same attempt with the draft and a clock that carried on rather than restarting, that finishing is confirmed and names what is unfinished, that **expiry freezes what was saved** and finalises once, that the full-bleed attempt layout does not follow the reader into their results, and that a retake is a separate attempt earning nothing twice |
| `tests/rust-toolchain.test.mjs` | The browser rustc driven directly, no browser involved: that the vendored artifacts are the pinned builds, that it is a real rustc, that a program compiles and reads its stdin, that a panic carries its line, that the borrow checker produces E0382/E0502/E0308/E0621 with lines and rustc's own rendering, that the one unsupported thing is `parse::<i64>()` and not 64-bit arithmetic, and that **every entry in `data/rust-support.json` is true in both directions** — each certified problem really passes its own cases here, and each native-only one really does not build |
| `tests/browser/rust.test.mjs` (`npm run test:rust`) | Rust on a device with nothing installed, with the local runner pointed at a dead port: the pinned artifacts served, no COOP or COEP header needed, borrow-checker diagnostics appearing as you type on a problem that cannot even be run here, the download reporting megabytes with Stop live beside it, a certified problem running and being accepted, a compile error told apart from a wrong answer, a cancel mid-download followed by a run that works, an infinite loop stopped, a run left behind not landing on the next problem, and no request leaving the origin |
| `tests/complete.test.mjs` | The C++ word lists driven directly: headers on `#include`, the header beside every `std::` name, declarations a regex can read and the ones it cannot, a known receiver getting only its own members, an unknown one getting every member labelled with its type, and staying quiet on one character |
| `tests/browser/complete.test.mjs` | The same thing through real keystrokes, Rust included, plus the switch (off stops the popup but Ctrl+Space still works; one language can be off while another is on) and the keys it could have broken: Enter still Enter, Tab still indenting, Ctrl+Enter still running with a popup open, and the first Escape closing the popup without throwing you out of the editor |
| `tests/browser/landing.test.mjs` (`npm run test:landing`) | The front page introducing the site rather than listing it, its numbers matching the catalogue, the main button changing for somebody who has been here before, the Content menu opening by hover, click, Enter and Tab and closing on Escape with focus going back, its counts and its current-page mark, an entry landing on the catalogue already filtered, Kind and Subject narrowing together with search overriding both, the profile menu by mouse and keyboard, the rank ring moving, the rail at four widths, and every number that left the dashboard turning up on Profile |
| `tests/browser/python.test.mjs` (`npm run test:py`) | Python in the browser with the runner address pointed at a dead port: the download and its progress, the platform differences stated above measured rather than asserted, a traceback that is the reader's and not the harness's, truncation of a flood of output, an infinite loop cut short and a valid program straight afterwards, Stop, a fresh namespace per case, a recorded solve, and a check that nothing was sent anywhere |
| `tests/learn-layout.test.mjs` | The canvas layout as arithmetic, no browser: a chain runs top to bottom, siblings sit side by side without overlapping, a parent is centred over its children, every prerequisite is in an earlier rank, an edge leaves the foot of one box and arrives at the head of another by right angles, a long edge is broken at the ranks it crosses and passes behind no box, the DAG edges are drawn and never drawn twice, a node reached twice is one box, the barycentre sweep untangles what it can, and all eleven real tracks lay out legally and identically on a second run |
| `tests/browser/learn.test.mjs` (`npm run test:learn`) | The same claim read out of the DOM; the dashed extra edges and the lit ones; pan, zoom and Recenter; walking it with the arrow keys with one box tabbable at a time; the node panel's two tables and its columns; closing it without leaving the track; ticking a reading being the same tick as everywhere else; and that the old addresses still land somewhere |
| `tests/browser/cxx.test.mjs` (`npm run test:cxx`) | C++ in the browser with the runner address pointed at a dead port: the download and its progress bar, a cold first run, submit-wrong-then-correct, a Clang compile error, an infinite loop cut short and a valid program straight afterwards, Stop, the cached second visit, a native-only problem refusing to pretend, and a check that nothing was sent anywhere |
| `tests/browser/usability.test.mjs` | Buttons after a failure, a run in flight when the problem or language changes, the toolbar at five widths, every answer control being clickable where it looks, horizontal overflow on twelve routes at eight widths with the view links staying reachable, keyboard reach to hints/notes/solution, and the blast radius of a reset |

Everything under `tests/browser/` is one of two quite different things,
and the difference matters:

- **jsdom** — `app`, `styles`, `states`, `runner`. No server, no browser;
  they load the site's scripts into a sandbox. These are in `npm test`, and
  CI runs them.
- **Playwright** — `complete`, `navigation`, `resize`, `feedback`,
  `usability`, `maths`, `learn`, `cxx`, `python`, `journeys`, `hosted`,
  `local`. A real browser against a served site, so they need
  `npm run serve`. `npm run test:ui` runs the first seven; the rest want
  something else up as well and are listed below.

Putting a Playwright suite into `npm test` is how CI came to fail with "the
site is not being served" — the group names are the contract.
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
js/problem.js           a problem: its tabs, submitting, the verdict, submissions
js/cxx/toolchain.js     Clang-in-WebAssembly: fetch, cache, compile, run
js/cxx/compile.worker.js  the long-lived compiler worker
js/cxx/run.worker.js    one throwaway worker per test case
js/runners/browsercpp.js  the browser C++ backend, with progress and Stop
vendor/cxx/             90 MB of Clang, wasm-ld and a WASI sysroot
js/setup.js             the "how do I run C++" guide, and its live probes
js/views.js             front page, catalog, learn, reading map, profile, shop, settings
js/learn/layout.js      where each box goes on the Learn canvas
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
| `g` | The front page |
| `p` | Problems |
| `r` | The concept index |
| `l` | Learn (`t` still works) |
| `u` | Profile |
| `s` | Shop |
| `f` | Focus mode — hide everything but the problem |
| `Escape` | Leave focus mode, or leave the field you are typing in |
| `Ctrl+Enter` | Run the tests (in a code problem) |
| `Ctrl+Shift+Enter` | Submit |

In the workspace, the panel divider is in the tab order: arrow keys move it,
`Shift` moves it faster, `Home` and `End` go to the limits, and `Enter` resets
it. A separator only a mouse can move is one half the people using a page
cannot.

## How data is stored

There is no backend. Two stores, because the things being kept want
different ones.

**`localStorage`**, for what has to be read synchronously and is small:

| Key | Holds | Why separate |
| --- | --- | --- |
| `invariant/state/v1` | progress, XP, coins, what you own, your drafts, and the **verdicts** of the last ten submissions per problem | the thing worth keeping; the drafts are here because the editor reads them on mount and writes them on every keystroke, and both have to be synchronous |
| `invariant/judge-url` and `/judge-token` | where the runner listens, and its token | properties of the machine, not of your progress, so they never travel in an export |
| `invariant/ui/v1` | the panel split, focus mode, the per-track graph view | per-device view preferences; a bad value here can never cost a solve |

**IndexedDB**, through `js/vault.js`, for what is large and can be
asynchronous:

| Key | Holds |
| --- | --- |
| `sources/<problem>` | the **programs** you submitted, whole and untruncated, keyed by the submission's timestamp |
| `attempts/v1` | every assessment attempt: its deadline, its drafts, its answers and its result |

The split is the point and it is explained at length under *Where your
data lives*: a verdict is forty bytes and is read on every paint; a
program is kilobytes and was being cut in half to fit beside it.

Progress from the old `bare-metal/state/v1` key is migrated on first load,
so nothing was lost when the site was renamed. Programs stored inline
before the split are copied into IndexedDB on first load too, and the
originals are left where they are.

**Settings ▸ Export** writes one file with all of it — progress, drafts,
programs and attempts — and **Settings ▸ Storage** says which stores are
actually working, because a page that cannot save and does not say so is
a page quietly losing work.

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
