# The judge

C++ and Rust submissions are compiled and run here. JavaScript runs in a Web
Worker in the browser and needs none of this.

```bash
docker compose -f judge/compose.yml up -d     # start it
docker compose -f judge/compose.yml logs      # which languages came up
docker compose -f judge/compose.yml down      # stop it
```

The first `up` builds the image, which takes a few minutes and lands at roughly
1.5 GB — it carries a full Rust toolchain, g++, python3 and node. After that it
starts in about a second.

Then open **Settings** on the site and press **Check**. It should say which
languages are available, with versions.

## Why this exists rather than Piston or Judge0

Both are good, both are open source, and both run a **fixed compile command**.
That rules out:

| Flag | What it is worth here |
| --- | --- |
| `-fsanitize=address,undefined` | A problem can fail a program that prints the right answer. For a C++ learner this is most of the value. |
| `-Wall -Wextra` | The compiler's own diagnostics, returned even on a successful build. |
| `-fopenmp -pthread` | Real parallel problems rather than simulated ones. |
| `-std=c++23` | The language you are actually learning, not whatever the image shipped with. |

On a site whose purpose is learning, the compiler's output *is* the lesson, so
the flags are the feature. That is the whole argument for ~200 lines of our own
instead of someone else's container.

## The API

Three endpoints. One compile and N cases per request, because a submission has
one source and several tests.

```
GET /health   ->  { ok: true, prlimit: true }
GET /langs    ->  { languages: [ { id, label, available, version } ] }

POST /run
{ "lang": "cpp",
  "source": "#include <iostream>\nint main(){...}",
  "profile": "sanitize",
  "cases": [ { "stdin": "5\n3 1 4 1 5\n" } ],
  "limits": { "compileMs": 10000, "runMs": 3000 } }

200
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

A build failure returns `cases: []` rather than a list of failures. Nothing ran,
so saying "0 of 5 passed" would be true and useless.

## Flag profiles

A problem names one in its payload.

| Profile | C++ | Rust |
| --- | --- | --- |
| `standard` | `-std=c++23 -O2 -Wall -Wextra` | `-O --edition 2021 -D warnings` |
| `sanitize` | `-std=c++23 -O1 -g -Wall -Wextra -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer` | `-C debug-assertions=on -C overflow-checks=on` |
| `strict` | adds `-Wpedantic -Wshadow -Wconversion` | `-D warnings` |
| `parallel` | adds `-fopenmp -pthread` | — |

`-fno-sanitize-recover=all` is what makes `requireClean` meaningful: without
it UBSan prints its complaint and carries on, and the program exits 0 with the
report buried in stderr.

### Rust and undefined behaviour

Rust's sanitizers need nightly, so the `sanitize` profile does what stable can:
keep the overflow and debug assertions that release mode drops. The real
equivalent for `unsafe` code is **Miri**, which would mean:

```dockerfile
RUN rustup toolchain install nightly --component miri
```

and a `miri` profile running `cargo +nightly miri run`. Deliberately not done
yet — it needs a Cargo project rather than a single file, which is a different
shape of submission.

## What keeps it safe

The honest answer: **it binds `127.0.0.1` and it only ever runs code you
wrote.** That is the whole security model, and it is proportionate. This is not
a hardened multi-tenant sandbox and it is not trying to be one.

What it does do:

- **Published to `127.0.0.1:2000` only.** Not reachable from another machine on
  your network, let alone the internet. Do not change this to `0.0.0.0`.
- **Non-root** inside the container, with `no-new-privileges`.
- **Read-only root filesystem**, with `/tmp` as a 1 GB tmpfs for scratch —
  compiling needs real space, since a sanitizer-linked debug binary is tens of
  megabytes.
- **`prlimit` per process**: 512 processes, 64 MB file size, 4 GB address
  space, 512 open files. This is what makes a fork bomb cost you one failed
  case rather than the machine.
- **Container caps**: `pids_limit: 1024`, `mem_limit: 4g`, `cpus: 2.0`.
- **Hard wall-clock kill** with `SIGKILL`, not `SIGTERM` — a tight loop with no
  handler ignores the polite signal.
- **Output capped** at 64 KB per stream per case, and truncation is reported.
- **Per-request temp directory**, removed afterwards even on failure, so a
  judge left running for a week does not quietly fill the disk.

Submissions are **not** network-isolated from each other at the process level.
Everything runs inside one container whose only published port is this API. If
you ever want stricter, `--network none` on the container breaks the API, so the
right move would be a second network namespace per run via `unshare -n`, which
needs extra capabilities. Not worth it for a single-user judge.

## Why the address and not the name

The site defaults to `http://127.0.0.1:2000`, and that specific spelling
matters. A page served over HTTPS from GitHub Pages normally cannot fetch
plain HTTP — mixed-content blocking. Loopback is the exception: the Mixed
Content spec treats loopback as *potentially trustworthy*, since there is no
network path to intercept.

But browsers apply that exemption to the **address** and not reliably to the
**name**: Chrome and Firefox whitelist `127.0.0.1` and `[::1]`, and Firefox has
historically not extended it to `localhost`. So `http://localhost:2000` can be
blocked from the deployed site while `http://127.0.0.1:2000` works.

CORS is handled on this side: the judge allows any loopback origin (so
`npm run serve` on any port works) and `https://*.github.io` (so the deployed
site works).

## Running it without Docker

It works directly on a host that has the toolchains, which is useful for
hacking on the judge itself:

```bash
node judge/server.mjs
```

It prints which languages it found. On Windows this works too — the server asks
for the platform's executable suffix, because `g++` appends `.exe` to a bare
`-o` name while `rustc` takes it literally, and Windows refuses to spawn an
extension-less file. What you will not get on a MinGW toolchain is the
sanitizer: MSYS2 ships no `libasan`, so `-fsanitize=address` fails at link
time. `tests/judge.test.mjs` probes for that and skips those cases with a
notice; CI runs them for real.

None of the container's limits apply when you run it this way. Fine for
development, worse than Docker for actually using it.

## Putting it on the internet

Don't, as it stands. The same image deploys to a free Fly.io or Render tier if
you want C++ from a machine with no Docker, and then `judgeUrl` in Settings
becomes an `https://` address and nothing else changes. But at that point it is
multi-tenant and the security model above no longer holds: it would need real
per-submission isolation, authentication, and rate limiting first.

## Tests

```bash
node tests/judge.test.mjs
```

Runs against whatever toolchains the machine has, skipping the rest with a
notice. It checks the four failure modes the UI reports differently — a compile
error, a wrong answer, a timeout and a crash — plus that warnings come back on
a *successful* build, that the sanitizer fires on an out-of-bounds read and
stays quiet on a clean program, and that oversized input and output are
refused and truncated rather than accepted.
