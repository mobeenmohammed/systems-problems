# Coverage checklist

What is here now, what is being added, and which part of which course each
new problem answers to. Written before the authoring started, so that
"twenty Metric Spaces problems" is a claim with a table behind it rather
than a number.

The two mathematics courses are the reader's own units, and the lecture
notes are authoring sources that stay on their machine:

- **Metric Spaces** — *Lecture Note.pdf*, S. Zadeh, 2025. 71 pages, seven
  chapters.
- **Probability 2** — *prob2-lecturenotes.pdf*, A. E. Holroyd, University
  of Bristol, 9 August 2025. 96 pages, seven chapters.

Neither PDF is in this repository and neither is published. Section and
page references point into them; no passage is copied; every exercise is
written from scratch.

## What was here before this round

136 problems.

| topic | n | types |
| --- | --- | --- |
| algo | 15 | code 12, match, locate, numeric |
| arch | 7 | numeric 3, code 2, multi, locate |
| compilers | 5 | locate, code, predict, order, short |
| cpp | 29 | code 15, predict 7, multi 4, locate 2, match |
| dist | 5 | order 2, mcq, numeric, locate |
| fpga | 15 | hdl 8, code 3, numeric 2, mcq, match |
| hpc | 5 | numeric 2, code, mcq, match |
| linux | 6 | short 2, multi, numeric, order, mcq |
| metric | 14 | mcq 3, structured 3, proof 2, exact 2, multi 2, counterexample, proofsteps |
| os | 11 | locate 2, numeric 2, order 2, mcq, predict, match, code |
| prob | 12 | exact 8, mcq 2, approx, multi |
| rust | 7 | code 7 |
| sysdesign | 5 | multi, match, order, numeric, code |

- 115 concepts, of which 12 are `metric` and 12 are `prob`. Those 24 are
  the *introductory* tracks (Metric spaces, from the axioms up;
  Probability, in the order it makes sense) and are **not** touched: the
  ids and therefore the reader's progress stay exactly as they are.
- 14 tracks, two of them projects.
- 5 multi-file milestones in 2 projects, all of them C++ or SystemVerilog.
- 3 debugging challenges.
- Coding languages in use: cpp 37, python 19, rust 8, sv 8, js 6.

## What this round adds — the plan

60 problems, in three batches of twenty.

This section is the checklist as it was written **before** the
authoring started, and it is kept as the record of the plan. Several
ids and a few types changed while the problems were being written —
two of the planned Metric Spaces problems turned out to duplicate
exercises already in the bank, and the sequence-detector project was
redesigned for the same reason. **The delivered tables at the end of
this file are generated from the problem files and are the
authoritative ones.**

### Batch A — Metric Spaces, 20

New concept ids are prefixed `ms-` and live in the new course tree; the
introductory `metric` concepts keep their own ids and their own track.

| # | id | ch | source | type | difficulty |
| --- | --- | --- | --- | --- | --- |
| A1 | `ms-reverse-triangle` | 1 | §1.1, Prop. 1.1.9, p. 9 | proofsteps | beginner |
| A2 | `ms-which-are-metrics-rn` | 1 | §1.2.1, Ex. 1.2.2, p. 10 | multi | beginner |
| A3 | `ms-hamming-and-sup` | 1 | §1.2.2–1.2.4, pp. 12–14 | exact | beginner |
| A4 | `ms-which-sequence-space` | 1 | §1.2.3, pp. 12–14 | match | intermediate |
| A5 | `ms-sup-metric-distance` | 1 | §1.2.6, Ex. 1.2.11, p. 16 | exact | intermediate |
| A6 | `ms-ball-in-sup-metric` | 2 | §2.1, Def. 2.1.1, pp. 19–21 | mcq | intermediate |
| A7 | `ms-convergence-which-space` | 2 | §2.2, Def. 2.2.1, p. 22 | multi | intermediate |
| A8 | `ms-uniform-or-pointwise` | 2 | §2.4, Ex. 2.4.1–2.4.8, pp. 25–28 | multi | intermediate |
| A9 | `ms-sup-distance-of-fn` | 2 | §2.4, Prop. 2.4.2, p. 26 | exact | advanced |
| A10 | `ms-uniformly-continuous-which` | 2 | §2.3, Def. 2.3.5, p. 24 | multi | intermediate |
| A11 | `ms-which-are-complete` | 3 | §3.1, Ex. 3.1.2, p. 33 | multi | intermediate |
| A12 | `ms-contraction-without-fixed-point` | 3 | §3.2 Ex. 3.2.4 + §3.5 Ex. 3.5.2, pp. 36, 39 | counterexample | advanced |
| A13 | `ms-banach-iterate` | 3 | §3.5, Thm. 3.5.1, p. 39 | exact | intermediate |
| A14 | `ms-closed-iff-complete` | 3 | §3.1, Prop. 3.1.7–3.1.8, pp. 33–34 | proofsteps | advanced |
| A15 | `ms-interior-and-closure` | 4 | §4.1, Def. 4.1.1, Prop. 3.1.13, pp. 35, 44 | structured | intermediate |
| A16 | `ms-infinite-intersection` | 4 | §4.1, Lem. 4.1.4, p. 45 | mcq | beginner |
| A17 | `ms-preimage-of-open` | 4 | §4.2, Thm. 4.2.1, p. 46 | proofsteps | intermediate |
| A18 | `ms-connected-which` | 5 | §5.2, Prop. 5.2.6, pp. 50–51 | multi | intermediate |
| A19 | `ms-totally-bounded-which` | 6 | §6.1, Def. 6.1.10, Rem. 6.1.12, p. 58 | multi | advanced |
| A20 | `ms-cover-with-no-finite-subcover` | 7 | §7.1, Ex. 7.1.3, Thm. 7.2.1, pp. 67, 69 | structured | advanced |

Chapters covered: 1 (×5), 2 (×5), 3 (×4), 4 (×3), 5 (×1), 6 (×1), 7 (×1).
The weight is deliberate: the brief asks for extra depth in foundational
topics, and chapters 1–3 are where the definitions the rest of the course
leans on are made.

### Batch B — Probability 2, 20

New concept ids are prefixed `p2-`.

| # | id | ch | source | type | difficulty |
| --- | --- | --- | --- | --- | --- |
| B1 | `p2-continuity-of-probability` | 1 | §1.3, Thm. 1.2–1.3, pp. 6–7 | mcq | intermediate |
| B2 | `p2-union-bound-bound` | 1 | §1.3, Thm. 1.7, p. 7 | exact | beginner |
| B3 | `p2-tail-sum-expectation` | 1 | §1.5, Thm. 1.8, p. 10 | exact | intermediate |
| B4 | `p2-strong-vs-weak-law` | 1 | §1.6, Thm. 1.9, p. 11 | multi | intermediate |
| B5 | `p2-ruin-probability` | 2 | §2.3, Ex. 2.4–2.5, pp. 15–16 | exact | intermediate |
| B6 | `p2-ruin-duration` | 2 | §2.4, Ex. 2.7, p. 17 | exact | intermediate |
| B7 | `p2-is-it-a-stopping-time` | 2 | §2.6, Ex. 2.10, p. 20 | multi | intermediate |
| B8 | `p2-wald-expected-sum` | 2 | §2.6, Thm. 2.11, p. 21 | exact | advanced |
| B9 | `p2-two-step-transition` | 3 | §3.2, Thm. 3.15, Ex. 3.16, p. 29 | exact | beginner |
| B10 | `p2-hitting-probability-firststep` | 3 | §3.3, Thm. 3.19, pp. 30–31 | exact | intermediate |
| B11 | `p2-classes-and-recurrence` | 3 | §3.7, Ex. 3.31–3.36, pp. 38–39 | match | intermediate |
| B12 | `p2-stationary-distribution` | 3 | §3.10–3.11, pp. 42–45 | exact | intermediate |
| B13 | `p2-detailed-balance` | 3 | §3.13, Thm. 3.64, Ex. 3.66, pp. 49–50 | exact | advanced |
| B14 | `p2-poisson-increments` | 4 | §4.2, Thm. 4.1–4.2, pp. 54–55 | approx | beginner |
| B15 | `p2-exponential-race` | 4 | §4.5, Thm. 4.10, p. 60 | exact | intermediate |
| B16 | `p2-thinning-and-superposition` | 4 | §4.4, Thm. 4.7–4.8, p. 59 | multi | intermediate |
| B17 | `p2-generator-stationary` | 5 | §5.5, Thm. 5.14, p. 72 | exact | advanced |
| B18 | `p2-mm1-queue-length` | 5 | §5.6, Ex. 5.23–5.24, pp. 74–75 | approx | intermediate |
| B19 | `p2-optional-stopping-walk` | 6 | §6.3, Ex. 6.15–6.16, p. 83 | exact | advanced |
| B20 | `p2-reflection-principle` | 7 | §7.3, Thm. 7.5–7.6, pp. 92–93 | approx | advanced |

Chapters covered: 1 (×4), 2 (×4), 3 (×5), 4 (×3), 5 (×2), 6 (×1), 7 (×1).

**Non-examinable material.** The Probability notes mark excluded material
with a vertical rule in the left margin, and only two of those blocks are
announced in a section title (§6.2 and §6.4). The rest are proofs and
remarks inside sections that are otherwise required. Every barred region
was located by reading the PDF's drawing operations rather than its text,
and the concepts covering them carry `optional: true`:

| page | what |
| --- | --- |
| 3 | the convention itself |
| 11 | further remarks on the strong law |
| 31–33 | minimality of hitting probabilities; proof of the strong Markov property |
| 37–38 | proof sketch of recurrence of the walk in d dimensions |
| 45–49 | proofs about stationary distributions, Theorem 3.60, the coupling proof of convergence |
| 55–56 | the derivation of the Poisson increment distribution |
| 68–71 | proofs of explosion, the Markov property and the forward/backward equations; the matrix exponential |
| 81–83, 85–86 | §6.2 in full, the proof of Theorem 6.11, §6.4 in full |
| 90, 94–96 | the remark on Gaussian processes, the remark on the maximum, the arcsine remarks |

No problem is set on a barred block. Three concepts exist for them so that
the tree is honest about what the notes contain, and they are marked
optional in the graph.

The Metric Spaces notes mark their excluded material in section titles and
theorem headings instead (§1.2.5, §1.2.7, §1.2.8, Thm. 4.2.3, Thm. 5.3.7,
Thm. 7.2.3–7.2.4, Def. 7.2.5, Lem. 7.2.6, Thm. 7.2.7, Def. 7.2.8,
Cor. 7.2.9). Those are optional concepts too.

### Batch C — coding, 20

Six of them are milestones of two new three-stage projects, both built on
the multi-file workspace.

| # | id | lang | kind | type | difficulty |
| --- | --- | --- | --- | --- | --- |
| C1 | `proj-cache-sim-1` | cpp | project, multi-file | code | intermediate |
| C2 | `proj-cache-sim-2` | cpp | project, multi-file | code | intermediate |
| C3 | `proj-cache-sim-3` | cpp | project, multi-file | code | advanced |
| C4 | `proj-seq-detect-1` | sv | project, multi-file | hdl | intermediate |
| C5 | `proj-seq-detect-2` | sv | project, multi-file | hdl | intermediate |
| C6 | `proj-seq-detect-3` | sv | project, multi-file | hdl | advanced |
| C7 | `cpp-span-window-max` | cpp | implementation | code | intermediate |
| C8 | `cpp-raii-scope-guard` | cpp | implementation | code | advanced |
| C9 | `debug-cpp-iterator-invalidation` | cpp | debugging | code | intermediate |
| C10 | `algo-run-length-codec` | cpp, python | implementation | code | beginner |
| C11 | `rust-slice-chunk-sums` | rust | implementation | code | beginner |
| C12 | `rust-option-parse-config` | rust | implementation | code | intermediate |
| C13 | `rust-borrow-two-halves` | rust | implementation | code | advanced |
| C14 | `debug-rust-off-by-one-window` | rust | debugging | code | intermediate |
| C15 | `py-metric-matrix-check` | python | maths link (Metric ch. 1) | code | intermediate |
| C16 | `py-markov-n-step` | python | maths link (Prob. ch. 3) | code | intermediate |
| C17 | `debug-py-reservoir-seeded` | python | debugging, seeded | code | intermediate |
| C18 | `fpga-gray-counter` | sv | implementation | hdl | intermediate |
| C19 | `fpga-arbiter-round-robin` | sv | systems simulation | hdl | advanced |
| C20 | `debug-fpga-parity-latch` | sv | debugging | hdl | intermediate |

Languages: cpp 6 (+3 project), rust 4, python 4, sv 3 (+3 project). Kinds:
implementation 9, debugging 4, systems simulation 1, maths link 2, project
milestones 6.

Two of these cross into the mathematics courses on purpose. `py-metric-matrix-check`
checks a **finite given** distance matrix against the three axioms, and
`py-markov-n-step` multiplies a **finite given** transition matrix. Both
print exactly what they computed about the input they were given; neither
statement claims a simulation proves a theorem.

Nothing in this batch repeats the ring-buffer logger or the synchronous
FIFO. The cache simulator is about address decomposition, associativity
and replacement; the sequence detector is about a Moore FSM composed with
counting logic.

## Question types

Across batches A and B: mcq ×3, multi ×8, exact ×12, approx ×3,
structured ×2, match ×2, proofsteps ×3, counterexample ×1, proof ×2,
order ×1 (B7 variant), locate — none (it is a code-reading type and the
mathematics statements have no listing to click), predict — none (same
reason).

Across batch C: code ×14, hdl ×6.

The types are chosen per problem, not spread evenly. A question with one
number for an answer is an `exact`; one that needs a tolerance is an
`approx` and says so; a classification is a `multi`; a reconstruction of
an argument is `proofsteps`; a claim to break is a `counterexample`. No
free-text proof is auto-graded: the two `proof` problems carry an explicit
self-review rubric and are marked as self-assessed.

## Grading limits stated up front

- `approx` problems state their tolerance in the statement and in the key.
- `proof` problems are self-reviewed against a rubric. Nothing scores them
  by keyword.
- `counterexample` problems check *stated structured values* — terms of a
  sequence, a limit, a radius — never prose.
- Probabilistic coding tasks use fixed inputs or a named seed; no test
  passes or fails on a statistical threshold.

## What was delivered

60 new problems: 20 Metric Spaces, 20 Probability 2,
20 coding exercises.

Types: approx 3, code 14, counterexample 1, exact 15, hdl 6, match 2, mcq 2, multi 9, order 1, proof 1, proofsteps 4, structured 2.
Difficulty: advanced 15, beginner 8, intermediate 37.
Coding languages: cpp 7, python 6, rust 4, sv 6
(a problem offered in two languages counts in both).
4 of the coding exercises are debugging
challenges and 6 are project milestones.

### Metric Spaces, by chapter

| ch | title | in the notes | problems |
| --- | --- | --- | --- |
| 1 | Metric definitions and examples | §§1.1–1.2, pp. 6–17 | 5 |
| 2 | Limits and continuity, including uniform convergence | §§2.1–2.6, pp. 18–31 | 5 |
| 3 | Completeness, completion and Banach’s fixed-point theorem | §§3.1–3.6, pp. 32–42 | 4 |
| 4 | Open and closed sets | §§4.1–4.3, pp. 43–47 | 3 |
| 5 | Connectedness and path connectedness | §§5.1–5.3, pp. 48–54 | 1 |
| 6 | Sequential compactness, total boundedness and Arzelà–Ascoli | §§6.1–6.3, pp. 55–65 | 1 |
| 7 | Compactness, and how it relates to sequential compactness | §§7.1–7.2, pp. 66–71 | 1 |

| id | ch | source | type | difficulty |
| --- | --- | --- | --- | --- |
| ms-hamming-triangle-slack | 1 | §1.2.2, Definition 1.2.4, p. 12 | exact | beginner |
| ms-reverse-triangle | 1 | §1.1, Definition 1.1.2, p. 7 | proofsteps | beginner |
| ms-sup-metric-distance | 1 | §1.2.6, Example 1.2.11 and Example 1.2.12, p. 16 | exact | intermediate |
| ms-which-are-norms | 1 | §1.2.4, Definition 1.2.8 and Example 1.2.9, p. 14 | multi | beginner |
| ms-which-sequence-space | 1 | §1.2.3, Lemma 1.2.5 to Example 1.2.7, pp. 12–14 | match | intermediate |
| ms-ball-in-sup-metric | 2 | §2.1, Definition 2.1.1 and Examples 2.1.2–2.1.5, p. 19 | mcq | intermediate |
| ms-convergence-which-space | 2 | §2.2, Definition 2.2.1 and Proposition 2.2.4, p. 22 | multi | intermediate |
| ms-sup-distance-of-fn | 2 | §2.4, Example 2.4.1 to Example 2.4.8, pp. 25–28 | exact | advanced |
| ms-uniform-limit-continuous | 2 | §2.4, Example 2.4.1 to Example 2.4.8, pp. 25–28 | proof | advanced |
| ms-uniform-or-pointwise | 2 | §2.4, Example 2.4.1 to Example 2.4.8, pp. 25–28 | multi | intermediate |
| ms-banach-fixed-point-value | 3 | §3.5, Theorem 3.5.1 and Examples 3.5.2–3.5.5, pp. 39–41 | exact | intermediate |
| ms-closed-subset-complete | 3 | §3.1, Propositions 3.1.7–3.1.8 and Corollary 3.1.9, pp. 33–34 | proofsteps | advanced |
| ms-contraction-without-fixed-point | 3 | §3.5, Theorem 3.5.1 and Examples 3.5.2–3.5.5, pp. 39–41 | counterexample | advanced |
| ms-which-are-complete | 3 | §3.1, Definition 3.1.1 and Example 3.1.2, p. 33 | multi | intermediate |
| ms-infinite-intersection | 4 | §4.1, Lemmas 4.1.4–4.1.6 and Theorem 4.1.5, p. 45 | mcq | beginner |
| ms-interior-of-a-set | 4 | §4.1, Definition 4.1.1 to Lemma 4.1.3, p. 44 | structured | intermediate |
| ms-preimage-of-open | 4 | §4.2, Theorems 4.2.1–4.2.2, p. 46 | proofsteps | intermediate |
| ms-connected-which | 5 | §5.2, Definition 5.2.1 to Proposition 5.2.5, p. 50 | multi | intermediate |
| ms-totally-bounded-which | 6 | §6.1, Definition 6.1.10 to Proposition 6.1.16, pp. 58–60 | multi | advanced |
| ms-finite-subcover | 7 | §7.1, Definitions 7.1.1–7.1.2 and Example 7.1.3, p. 67 | structured | advanced |

### Probability 2, by chapter

| ch | title | in the notes | problems |
| --- | --- | --- | --- |
| 1 | Foundations: axioms, continuity, expectation and the strong law | §§1.1–1.6, pp. 3–11 | 4 |
| 2 | Random walks, gambler’s ruin, stopping times and Wald’s identity | §§2.1–2.6, pp. 12–22 | 4 |
| 3 | Markov chains | §§3.1–3.13, pp. 23–52 | 5 |
| 4 | Poisson processes | §§4.1–4.6, pp. 53–63 | 3 |
| 5 | Continuous-time Markov chains and queues | §§5.1–5.6, pp. 64–77 | 2 |
| 6 | Martingales | §§6.1–6.4, pp. 78–86 | 1 |
| 7 | Brownian motion | §§7.1–7.3, pp. 87–96 | 1 |

| id | ch | source | type | difficulty |
| --- | --- | --- | --- | --- |
| p2-infinitely-many-heads | 1 | §1.3, Theorems 1.2–1.3 and Examples 1.4–1.6, pp. 6–7 | proofsteps | intermediate |
| p2-strong-vs-weak-law | 1 | §1.6, Theorem 1.9 and Example 1.10, p. 11 | multi | intermediate |
| p2-tail-sum-expectation | 1 | §1.5, Theorem 1.8, pp. 8–10 | exact | intermediate |
| p2-union-bound-run-of-heads | 1 | §1.3, Theorem 1.7, p. 7 | exact | beginner |
| p2-is-it-a-stopping-time | 2 | §2.6, Example 2.10, p. 20 | multi | intermediate |
| p2-ruin-duration | 2 | §2.4, Examples 2.6–2.7, pp. 17–18 | exact | intermediate |
| p2-ruin-probability | 2 | §2.3, Examples 2.3–2.5, pp. 14–16 | exact | intermediate |
| p2-wald-expected-duration | 2 | §2.6, Theorem 2.11 and Examples 2.12–2.13, pp. 21–22 | exact | advanced |
| p2-classes-and-recurrence | 3 | §3.7, Theorems 3.30–3.36 and Examples 3.31–3.35, pp. 38–39 | match | intermediate |
| p2-pattern-waiting-times | 3 | §3.3, Theorems 3.17–3.20 and Example 3.21, pp. 30–31 | order | intermediate |
| p2-random-walk-on-a-graph | 3 | §3.13, Theorems 3.63–3.65 and Examples 3.66–3.69, pp. 49–52 | exact | advanced |
| p2-stationary-distribution | 3 | §§3.10–3.11, Theorems 3.50–3.53, pp. 42–45 | exact | intermediate |
| p2-two-step-transition | 3 | §3.2, Theorems 3.10–3.15 and Example 3.16, pp. 27–29 | exact | beginner |
| p2-exponential-race | 4 | §4.5, Theorems 4.10–4.13, pp. 60–61 | exact | intermediate |
| p2-poisson-increments | 4 | §§4.1–4.2, Definitions 1 and 2, Theorems 4.1–4.2, pp. 53–56 | approx | beginner |
| p2-thinning-and-superposition | 4 | §4.4, Theorems 4.7–4.9, p. 59 | multi | intermediate |
| p2-generator-stationary | 5 | §5.5, Theorems 5.13–5.18 and Example 5.15, pp. 72–74 | exact | advanced |
| p2-mm1-queue-length | 5 | §5.6, Theorems 5.19–5.27 and Examples 5.23–5.26, pp. 74–77 | approx | intermediate |
| p2-optional-stopping-duration | 6 | §6.3, Examples 6.14–6.17, pp. 83–84 | exact | advanced |
| p2-reflection-principle | 7 | §7.3, Theorems 7.5–7.8, pp. 91–94 | approx | advanced |

### Coding

| id | topic | language | type | difficulty |
| --- | --- | --- | --- | --- |
| proj-cache-sim-1 | arch | cpp | code | intermediate |
| proj-cache-sim-2 | arch | cpp | code | intermediate |
| proj-cache-sim-3 | arch | cpp | code | advanced |
| proj-seq-detect-1 | fpga | sv | hdl | intermediate |
| proj-seq-detect-2 | fpga | sv | hdl | intermediate |
| proj-seq-detect-3 | fpga | sv | hdl | advanced |
| algo-merge-intervals | algo | cpp,python | code | intermediate |
| algo-sliding-window-max | algo | cpp,python | code | intermediate |
| arch-sim-branch-predictor | arch | cpp,python | code | intermediate |
| debug-cpp-erase-in-loop | cpp | cpp | code | intermediate |
| debug-hdl-inferred-latch | fpga | sv | hdl | intermediate |
| debug-py-reservoir-draws | algo | python | code | intermediate |
| debug-rust-longest-run | rust | rust | code | intermediate |
| hdl-gray-counter | fpga | sv | hdl | intermediate |
| hdl-round-robin-arbiter | fpga | sv | hdl | advanced |
| metric-code-axiom-checker | metric | python | code | intermediate |
| prob-code-markov-steps | prob | python | code | intermediate |
| rust-iterator-chains | rust | rust | code | beginner |
| rust-struct-histogram | rust | rust | code | intermediate |
| rust-two-mutable-halves | rust | rust | code | advanced |

### The concept trees

| course | chapters | concepts | of them optional |
| --- | --- | --- | --- |
| Metric Spaces | 7 | 53 | 6 |
| Probability 2 | 7 | 49 | 7 |

Every concept carries the section and page of the notes it is a reading
of, and `needs` records the real prerequisite rather than the order the
notes happen to use. The build refuses a prerequisite that points
forwards through a course, and refuses required material that rests on
a concept the notes exclude.

## The beginner C++ band

Added after the round above, to fill the gap it left: the catalogue
had twenty beginner C++ exercises and most of them assumed a loop and
a function already. These twenty-four start from reading two numbers
and finish at a program that uses a predicate, a vector of strings and
three reference parameters at once.

Each one is single-file, C++ only, and uses nothing it has not been
shown — no templates, no manual memory, no algorithm header, and no
standard-library container beyond `std::string` and `std::vector`.

- **Band 1** — Variables, arithmetic, input and output, conversions
- **Band 2** — Conditions and Boolean expressions
- **Band 3** — Loops, counting and accumulation
- **Band 4** — Functions and simple decomposition
- **Band 5** — Strings and basic vector operations
- **Band 6** — References, and combinations of what came before

| band | id | title | minutes | cases (visible + hidden) |
| --- | --- | --- | --- | --- |
| 1 | `cpp-arith-report` | Five answers from two numbers | 12 | 2 + 8 |
| 1 | `cpp-seconds-to-clock` | Seconds, the way a clock reads them | 14 | 2 + 8 |
| 1 | `cpp-mean-and-cast` | Two kinds of average | 15 | 2 + 8 |
| 1 | `cpp-letter-position` | A letter is a number | 12 | 2 + 6 |
| 2 | `cpp-leap-year` | Three rules, and the order they go in | 14 | 2 + 9 |
| 2 | `cpp-triangle-kind` | Is it even a triangle? | 16 | 2 + 10 |
| 2 | `cpp-bool-is-a-value` | A condition is a value | 14 | 2 + 8 |
| 2 | `cpp-short-circuit-guard` | Why the order of && matters | 15 | 2 + 9 |
| 3 | `cpp-digit-reverse` | A number, back to front | 15 | 2 + 8 |
| 3 | `cpp-times-table` | A table, two loops deep | 16 | 2 + 6 |
| 3 | `cpp-running-extremes` | Three answers in one pass | 16 | 2 + 9 |
| 3 | `cpp-collatz-steps` | How long until it reaches one | 16 | 2 + 8 |
| 4 | `cpp-function-digit-sum` | Write it once, call it many times | 16 | 2 + 8 |
| 4 | `cpp-function-default-power` | An argument you usually do not have to give | 15 | 2 + 8 |
| 4 | `cpp-function-gcd-lcm` | One function, written in terms of another | 18 | 2 + 8 |
| 4 | `cpp-function-perfect-numbers` | Two helpers, stacked | 18 | 2 + 8 |
| 5 | `cpp-string-build-reverse` | Build it backwards | 15 | 2 + 7 |
| 5 | `cpp-string-longest-word` | The longest word there was | 15 | 2 + 8 |
| 5 | `cpp-vector-read-and-report` | A list you keep | 15 | 2 + 8 |
| 5 | `cpp-vector-above-mean` | Two passes over the same numbers | 16 | 2 + 8 |
| 6 | `cpp-reference-swap` | Changing the caller’s variables | 14 | 2 + 6 |
| 6 | `cpp-reference-min-max` | Two answers out of one call | 17 | 2 + 8 |
| 6 | `cpp-reference-accumulate` | A total that survives the call | 17 | 2 + 8 |
| 6 | `cpp-combine-word-report` | Everything so far, on one line of text | 20 | 2 + 9 |

24 exercises, 239 test cases between them.

### How the expected output was checked

Every case was computed twice, by two implementations written
from the same statement and sharing no code:

1. a Python function, written from the problem statement;
2. the C++ reference, compiled with `g++ -std=c++20 -O2 -Wall
   -Wextra -Werror` and run on the same input.

Nothing was written to `problems/` or `solutions/` until the two
agreed on every case of every exercise. A reference that agrees
only with itself proves nothing, and "I ran it and copied the
output" is exactly that.

The two agreed on every case on the first run. That is partly the
point and partly luck: the places where the two languages genuinely
differ — C++ truncating integer division towards zero where Python
floors, and `%` taking the sign of the left operand rather than the
right — were written into the oracle deliberately, because those
differences are what three of the exercises are *about*. An oracle
written carelessly would have disagreed there and the statements
would have been the thing to fix.

What the process did catch, separately, was a reference that would
have overflowed at its own stated limits: `cpp-vector-above-mean`
allows ten thousand values of a million each, which sums to 10¹⁰
and does not fit in an `int`. No test case reached both limits at
once, so nothing would have failed. The total is a `long long`, the
statement says why, and the explanation now teaches it.

Every reference was then compiled again by the **browser**
toolchain — clang 20.1.2 targeting wasm32-wasi — and run against
its own visible and hidden cases, which is what `npm run
audit:cxx` does and what `data/cxx-support.json` records.

### Where they sit

All twenty-four are in the `cpp-first-programs` track, which
went from twelve problems to thirty-six and is now ordered in
the six bands above. The existing exercises were not moved to
the end: they sit in the band they belong to, so the step
between any two consecutive problems is one idea.

### Grading limits, and what stopped being one

These exercises are graded by exact output comparison over a fixed
set of cases. That is a complete check of what a program prints and
a very incomplete check of what an exercise asked for. "Write a
function `power(base, exponent = 2)` and call it with one argument"
is a requirement about the shape of the code, and a program with no
function in it at all prints the same characters.

Eight of the twenty-four said so and left it there. They now carry
a **probe**: a `main` the problem owns, compiled with the
submission, calling the functions the statement named and printing
what came back. `js/runners/probe.js` composes the two — the
submitted `main` is renamed with a macro and never runs, every
header it asked for hoisted above the rename so the macro cannot
reach library text — and the result is one translation unit that
every backend compiles like any other single file.

| exercise | what the direct calls see |
|---|---|
| `cpp-function-default-power` | `power(7)` with one argument: the default has to exist and has to be 2 |
| `cpp-reference-accumulate` | a total starting at 100, three calls into it, and ten thousand values of a million |
| `cpp-combine-word-report` | `isLetter` either side of both ranges; `summarise` with `letters` pre-set to something other than zero, read back after the call |
| `cpp-function-digit-sum` | `digitSum` exists; and the caller's variable survives being passed |
| `cpp-function-gcd-lcm` | both names exist; two lcms wider than an `int` |
| `cpp-function-perfect-numbers` | both names exist; `divisorSum` alone, so "divisors below n" means that |
| `cpp-reference-min-max` | `extremes` with both outputs pre-set to wrong values and read back |
| `cpp-reference-swap` | `swapInts` on the grader's own variables, and on two vector elements |

Each of those statements has a **What the grader checks** section.
That is not decoration: a grader that rejects a program for a
reason the exercise never mentioned is a trap, and
`tests/content.test.mjs` fails if a probed exercise has no such
section.

`tests/probe-rejects.json` holds fifteen programs that the grader
accepted before this existed — `addAll` setting its total instead
of adding, `summarise` printing the report itself, `swapInts`
without the ampersands and `main` swapping by hand, `power` with
two required parameters. The test compiles every one with a real
compiler and insists on both halves of the claim: that it still
passes every input case, and that it is now rejected. Fourteen go
to a probe — five of those do not compile against the harness, nine
answer a direct call wrongly — and the fifteenth is caught by the
input case that was missing. A grader nobody has tried to fool is a
grader whose strictness is a guess.

`cpp-vector-above-mean` was the other kind of gap — its statement
says the running total "has to be a `long long`" and the largest
case was two values, so an `int` passed. There is now a case of
2,200 values of a million, which is what the constraints always
allowed.

**What is still not checked, and is labelled as such in each
statement:**

- which calls a submission's own `main` makes. `power(base)` and
  `power(base, 2)` are indistinguishable from outside, and so are
  `addAll(evens, t); addAll(odds, t);` and `evenTotal + oddTotal`.
- whether `lcm` calls `gcd` or repeats Euclid's loop. Both are
  correct programs; one of them is the point.
- whether a loop is a `for` or a `while`, and every other matter of
  form that two correct programs can differ on.

### The other sixteen, audited

The remaining sixteen prescribe no named function, so there is
nothing a probe could call. Each one's stated requirement was traced
to the case that catches its absence:

| exercise | the requirement | the case that sees it |
|---|---|---|
| `cpp-short-circuit-guard` | the guard must short-circuit | `5 0` and `0 0` — an unguarded divide traps, and a trap is not a wrong answer |
| `cpp-string-build-reverse` | `getline`, not `cin >>` | `  spaced  ` and `hello world`, which a word-at-a-time read mangles |
| `cpp-collatz-steps` | a 64-bit running value | `704511`, whose trajectory peaks at 56,991,483,520 |
| `cpp-seconds-to-clock` | hours are not padded to three | `10000000`, which is 2777 hours |
| `cpp-triangle-kind` | equilateral tested before isosceles | `5 5 5` and `1 1 1` |
| `cpp-arith-report` | division truncates toward zero | `-7 2` and `-1000 3` |
| `cpp-letter-position` | the cast back to `char` | without it the output is a number |
| `cpp-mean-and-cast` | a real division, `fixed`, two decimals | `1 2 4` is 2.33 and not 2 |
| `cpp-digit-reverse` | 0 prints 0 | `0`, where `while (n > 0)` never runs |
| `cpp-running-extremes`, `cpp-vector-read-and-report` | the empty-input guard | the empty case and the whitespace-only one |
| `cpp-leap-year`, `cpp-times-table`, `cpp-string-longest-word`, `cpp-bool-is-a-value` | arithmetic, formatting and branch order | every case |

The one that failed this audit was `cpp-vector-above-mean`, above.

No probe is implemented by matching the source text, and none ever
will be: a regex over somebody's program rejects valid code for
looking unusual and accepts invalid code for looking ordinary. What
is checked here is behaviour and compilation, which is why a
missing function is a build failure with the compiler's own words
rather than a verdict somebody wrote.

Each solution also carries a **What this does not check** section
naming the inputs its constraints exclude and what the reference
would do with them.
