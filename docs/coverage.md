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

## What this round adds

60 problems, in three batches of twenty.

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
