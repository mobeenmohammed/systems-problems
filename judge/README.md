# The runner

C++, Rust and Python submissions are compiled and run here. JavaScript runs in
a Web Worker in the browser and needs none of this.

## Starting it

**Under WSL, no Docker** — this is the one to use:

```bash
npm run runner
```

That is `wsl.exe -d Ubuntu -- bash ./judge/run-wsl.sh`. `wsl.exe` inherits the
working directory, so there is no path to configure.

It checks the toolchains **before** starting and prints the exact command to
install anything missing, rather than starting and failing later on a
submission. Verified on **Ubuntu 24.04.4 under WSL2** with g++ 13.3.0,
rustc 1.99.0, Python 3.12.3, Node 18.19.1 and `prlimit` present.

Inside WSL directly:

```bash
./judge/run-wsl.sh
```

Under Docker instead, if you prefer the container's isolation:

```bash
docker compose -f judge/compose.yml up -d
```

Then open **Settings** in the site and press **Check**.

### What a healthy start looks like

```
------------------------------------------------------------
  Systems Lab runner — toolchain check
------------------------------------------------------------
  ok    node     v18.19.1
  ok    g++      g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
  ok    rustc    rustc 1.99.0 (b940084d7 2026-09-28)
  ok    python   Python 3.12.3
  ok    prlimit  prlimit from util-linux 2.39.3
------------------------------------------------------------
  ok    sanitizers available (-fsanitize=address,undefined links)
------------------------------------------------------------
  Systems Lab runner    http://127.0.0.1:2000
  WSL distro            Ubuntu
  prlimit guards        on
  token                 NHeFeWfuHnmVPswlmU-Xe5VMTfUU0nL1
  token file            .../data/judge-token.json
------------------------------------------------------------
  loopback only. never expose this to a network.
------------------------------------------------------------
```

A missing toolchain is named with its fix, and the runner still starts for the
languages that *are* there:

```
  --    rustc    NOT INSTALLED
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
```

`rustup` needs no `sudo` — it installs into `~/.cargo`, which the start script
adds to `PATH`. Everything else is an `apt install` and does need it.

## Authentication

The runner executes arbitrary code as you, so three things have to hold before
it will do anything:

| | |
| --- | --- |
| **Loopback only** | It binds `127.0.0.1`. A non-loopback `JUDGE_HOST` is **refused at startup**, not quietly honoured. |
| **A token** | Every request but `/health` needs `X-Judge-Token` (or `Authorization: Bearer`). Generated per start, printed, and written to `data/judge-token.json`, which the page reads. Compared in constant time. |
| **A known Origin** | A browser sets `Origin` on a cross-origin POST and a page cannot forge it, so this is what stops another site using your runner even if it had the token. Loopback on any port and `https://*.github.io` are allowed; `JUDGE_ORIGINS` adds more. |

`data/judge-token.json` is **git-ignored**. It is not the security boundary —
anything able to read it already runs as you — the Origin check is. It exists
so a browser tab can get the token without you copying it.

If the page is served from somewhere that cannot see that file, paste the token
into **Settings ▸ Code execution** instead.

`/health` is deliberately **unauthenticated**, because the page has to tell
three states apart and a 401 would collapse two of them:

| State | Means | What the page says |
| --- | --- | --- |
| `unchecked` | nothing asked yet | "not checked" |
| `down` | nothing listening | "start it", with the command |
| `unauthed` | listening, token missing or stale | "reload the page" |
| `ready` | listening and willing | which languages are available |

A restarted runner has a new token; the page notices a 401, reloads the token
file once, and retries before reporting anything.

## The API

```
GET  /health   -> { ok, platform, wsl, distro, prlimit, languages, missing }
GET  /langs    -> { languages: [ { id, label, available, version, install } ] }
POST /lint     -> { ok, diagnostics: [ { line, column, severity, message } ] }
POST /run      -> { compile, cases: [ … ] }
```

```jsonc
// POST /run
{ "lang": "cpp",
  "source": "#include <iostream>\nint main(){ … }",
  "profile": "sanitize",
  "cases": [ { "stdin": "5\n3 1 4 1 5\n" } ],
  "limits": { "compileMs": 10000, "runMs": 3000 } }
```

```jsonc
{ "compile": { "ok": true, "stdout": "", "stderr": "warning: …", "ms": 420 },
  "cases": [ { "stdout": "3\n3\n4\n4\n5\n", "stderr": "", "exit": 0,
               "signal": null, "timedOut": false, "ms": 12,
               "sanitizer": false } ] }
```

`compile.stderr` comes back **even when the build succeeded**. A warning you
never read is a warning that taught you nothing.

`sanitizer` is reported separately from `exit`, because "the output was right
but the program is not" is a different claim from "it crashed", and a problem
with `requireClean` turns the first into a failure.

A build failure returns `cases: []` rather than a list of failures. Nothing
ran, so saying "0 of 5 passed" would be true and useless.

A language that is not installed returns `{ error, missing, hint }` rather than
a compile failure, because the fix is to install something.

## Why ours rather than Piston or Judge0

Both are good and both run a **fixed compile command**, which rules out:

| Flag | What it is worth here |
| --- | --- |
| `-fsanitize=address,undefined` | A problem can fail a program that prints the right answer. For a C++ learner this is most of the value. |
| `-Wall -Wextra` | The compiler's own diagnostics, returned even on a successful build. |
| `-fopenmp -pthread` | Real parallel problems rather than simulated ones. |
| `-std=c++23` | The language you are learning, not whatever the image shipped with. |

Piston's free public API also closed in February 2026 — tokens are required
now — so self-hosting was the only route regardless. For running from a device
that cannot reach this machine, see **Judge0** in the main README.

## Flag profiles

| Profile | C++ | Rust |
| --- | --- | --- |
| `standard` | `-std=c++23 -O2 -Wall -Wextra` | `-O --edition 2021 -D warnings` |
| `sanitize` | `-std=c++23 -O1 -g -Wall -Wextra -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer` | `-C debug-assertions=on -C overflow-checks=on` |
| `strict` | adds `-Wpedantic -Wshadow -Wconversion` | `-D warnings` |
| `parallel` | adds `-fopenmp -pthread` | — |

`-fno-sanitize-recover=all` is what makes `requireClean` meaningful: without
it UBSan prints its complaint and carries on, and the program exits 0 with the
report buried in stderr.

**The sanitizers work under WSL and not under MinGW.** MSYS2's g++ on Windows
ships no `libasan`, so `-fsanitize=address` fails at link time there. That is
the main practical reason to prefer the WSL runner over running `node
judge/server.mjs` directly on Windows.

### Rust and undefined behaviour

Rust's sanitizers need nightly, so the `sanitize` profile does what stable can:
keep the overflow and debug assertions that release mode drops. The real
equivalent for `unsafe` code is **Miri**:

```bash
rustup toolchain install nightly --component miri
```

Deliberately not wired in yet — it needs a Cargo project rather than a single
file, which is a different shape of submission.

## Resource limits

- **`prlimit` per process**: 512 processes, 64 MB file size, 512 open files,
  and a 4 GB address-space cap **on runs only**.
- The address-space cap is **not** applied to a sanitized build. ASan reserves
  on the order of 20 TB of *virtual* address space for shadow memory at
  startup, so any `RLIMIT_AS` kills every instrumented binary before `main()`
  with an allocation failure that even looks like a sanitizer report.
- It is **not** applied to the compiler either. rustc and g++ reserve large
  virtual arenas, and a trivial Rust program exceeded the 20-second compile
  limit under a 4 GB cap.
- **Hard wall-clock kill** with `SIGKILL`, not `SIGTERM` — a tight loop with no
  handler ignores the polite signal.
- **Output capped** at 64 KB per stream per case, and truncation is reported.
- **Per-request temp directory**, removed afterwards even on failure.

Under Docker there are container caps as well: `pids_limit: 1024`,
`mem_limit: 4g`, `cpus: 2.0`, a read-only root and a 1 GB `/tmp` tmpfs.

Submissions are **not** isolated from each other at the process level. For a
single-user runner on loopback that is proportionate; for anything else it is
not.

## Why the address and not the name

The site defaults to `http://127.0.0.1:2000`, and that spelling matters. A page
served over HTTPS normally cannot fetch plain HTTP — mixed-content blocking.
Loopback is the exception: the Mixed Content spec treats it as *potentially
trustworthy*, since there is no network path to intercept.

But browsers apply that to the **address**, not reliably to the **name**:
Chrome and Firefox whitelist `127.0.0.1` and `[::1]`, and Firefox has
historically not extended it to `localhost`. So `http://localhost:2000` can be
blocked from the deployed site while `http://127.0.0.1:2000` works.

## Running directly on Windows

It works, and is useful for hacking on the runner itself:

```bash
node judge/server.mjs
```

What you will not get on a MinGW toolchain is the sanitizer (no `libasan`), and
`prlimit` does not exist, so none of the per-process guards apply. The server
asks for the platform's executable suffix because `g++` appends `.exe` to a
bare `-o` name while `rustc` takes it literally, and Windows refuses to spawn
an extension-less file.

Prefer WSL.

## Tests

```bash
node tests/judge.test.mjs            # the runner's logic, against real toolchains
npm run test:runner                  # the whole browser-to-runner path
```

`tests/judge.test.mjs` runs against whatever toolchains the machine has and
skips the rest with a notice. It checks the four failure modes the UI reports
differently — a compile error, a wrong answer, a timeout and a crash — plus
that warnings come back on a *successful* build, that the sanitizer fires on an
out-of-bounds read and stays quiet on a clean program, and that oversized input
and output are refused and truncated.

`tests/browser/runner.test.mjs` boots the real page in jsdom with its `fetch`
split — repo files off disk, runner requests through to the network with the
`Origin` a browser would send — so it covers token loading, the
unauthorised-versus-down distinction, and compile, runtime and timeout
failures through the page's own code path. It skips with a notice when the
runner is not up, because that is not a test failure.
