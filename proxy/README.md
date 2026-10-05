# The hosted execution proxy

This is what lets someone open the published site on a laptop with nothing
installed, write C++ or Rust, and press Run.

It is a single request handler with two entry points:

| file | what it is |
| --- | --- |
| `handler.mjs` | all of the logic: `handle(request, env)`, standard `Request` in, standard `Response` out |
| `worker.mjs` | a Cloudflare Worker entry — `export default { fetch: handle }` with the Worker's `env` |
| `server.mjs` | a Node entry on port 8787, for local development and for the tests |

Nothing in it is Cloudflare-specific. Anything that can run a `fetch` handler
or a small Node process will do.

---

## Why there is a proxy at all

The browser never talks to an execution service directly. Three reasons, and
each one on its own would be enough:

1. **A credential cannot live in a static page.** This site is a folder of
   files on GitHub Pages. Any key it held would be readable by anyone who
   pressed View Source.
2. **Caller-supplied compiler flags are remote code execution with extra
   steps.** The page posts a *profile name* — `standard`, `sanitize`,
   `strict`, `parallel` — and the flag string is chosen here, from a table
   that is character-for-character identical to `judge/languages.mjs` so a
   problem means the same thing on both backends. `tests/proxy.test.mjs`
   compares the two.
3. **A limit the client can choose is not a limit.** Source size, case count,
   stdin size, CPU, wall clock, memory and the request rate are all applied
   here, to whatever arrives.

The reply is translated back into exactly the shape the local runner returns,
so nothing downstream of `js/runners/index.js` can tell which backend answered.

---

## What it enforces

From `LIMITS` in `handler.mjs`:

| | |
| --- | --- |
| source | 64 KB |
| cases | 20 per request (Judge0's own batch maximum) |
| stdin | 64 KB per case, 256 KB per request |
| CPU | 5s default, 10s ceiling |
| wall clock | 15s ceiling |
| memory | 256 MB, or 1 GB for a sanitized build |
| rate, runs | 30 burst, 20/minute, per IP |
| rate, submissions | 120 burst, 60/minute, per IP |

Plus an `Origin` allowlist, and an optional shared `CLIENT_TOKEN`. The token is
not a user credential and cannot be — it ships in a static page. It raises the
cost of casual abuse and nothing more; the rate limit is the real control.

Four languages (`cpp`, `rust`, `python`, `js`) and four profiles. Anything else
is a 400 before a byte reaches the upstream.

---

## Configuration

All of it is environment, all of it server-side.

| variable | meaning |
| --- | --- |
| `ALLOWED_ORIGINS` | comma-separated. Set this. Without it the endpoint is a free compiler for anyone who finds the URL. |
| `CLIENT_TOKEN` | optional. If set, requests must carry `X-Client-Token`. |
| `JUDGE0_URL` | the upstream. Defaults to `https://ce.judge0.com` — see the warning below. |
| `JUDGE0_RAPIDAPI_KEY` | for Judge0 via RapidAPI. Sent as `X-RapidAPI-Key`. |
| `JUDGE0_RAPIDAPI_HOST` | defaults to `judge0-ce.p.rapidapi.com`. |
| `JUDGE0_AUTH_TOKEN` | for a self-hosted Judge0 with authentication on. Sent as `X-Auth-Token`. |

### Locally

```sh
ALLOWED_ORIGINS="http://127.0.0.1:8000" npm run proxy
```

Then put `http://127.0.0.1:8787` into Settings → Code execution → Hosted
runner address. The toolbar will say **Hosted**.

### On Cloudflare Workers

```sh
npx wrangler deploy proxy/worker.mjs --name systems-lab-exec
npx wrangler secret put JUDGE0_RAPIDAPI_KEY
npx wrangler secret put CLIENT_TOKEN           # optional
```

`ALLOWED_ORIGINS` is not a secret; put it in `wrangler.toml` as a `[vars]`
entry, or `--var ALLOWED_ORIGINS:https://yourname.github.io`.

Then set the deployed URL as the default for everybody by editing the
`hosted` block in `data/config.json`:

```json
"hosted": {
  "enabled": true,
  "url": "https://systems-lab-exec.yourname.workers.dev",
  "clientToken": ""
}
```

A reader can still override it for their own browser in Settings.

---

## The remaining requirement, stated exactly

**Everything in this folder is written and tested. What is missing is an
account to deploy it to, and an execution service for it to call.** Two
decisions, and they are the user's to make because both cost money or a
machine:

### 1. Somewhere to run the proxy

A Cloudflare account. The Workers free tier (100,000 requests/day) is far
beyond what this site would ever use, so the realistic cost is zero — but it
needs an account, and `wrangler login` is interactive. Any other host that
runs a `fetch` handler or a small Node process works identically.

### 2. Something for it to call

| option | cost | verdict |
| --- | --- | --- |
| `ce.judge0.com` (the default) | free | **Works, and is not a production dependency.** It answers, it compiles C++23 and Rust correctly, and `npm run test:proxy` passes against it. It has no SLA, no documented rate limit, no authentication and no published support commitment. It is fine for trying this out. It is not something to point a public site at and walk away from. |
| Judge0 Cloud via RapidAPI | about €27–€107/month depending on the plan | Supported, metered, with a documented limit. Needs a RapidAPI account and a card. |
| Self-hosted Judge0 | a server, plus the time to run it | Judge0 needs privileged containers (it uses `isolate`, which needs cgroups), so most of the cheap container hosts will not take it. A small VM will. |

The code treats all three identically; only the environment differs.

Until one of those is in place, the published site will say so honestly. The
toolbar reads **No runner**, compiled languages are offered but marked
unavailable with the reason, and nothing silently falls back to a local
address. JavaScript problems continue to work in the browser, as they always
have.

---

## Testing it

```sh
node tests/proxy.test.mjs            # 49 checks, no network
npm run test:proxy                   # 58, including a real compile upstream

npm run serve                        # the site, on 8000
npm run proxy                        # this, on 8787
npm run runner:stop                  # the point: no local runner
node tests/browser/hosted.test.mjs   # the whole journey through Chromium
```

The last one is the one that matters. It drives a real browser with real
typing against a page configured the way the deployed site is — hosted
execution on, the local runner address pointed at a dead port — writes C++,
presses Run, presses Submit, and then checks `performance.getEntriesByType`
to prove no submission went to localhost.
