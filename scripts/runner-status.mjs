/* Is a local runner up, and is the token file the one it is using?

   Those are two questions, and the second one is the whole reason this
   exists: if a second runner was started while the first held the port, the
   page reads a token that belongs to nobody and reports "running, but it
   refused this page", which looks like a bug in the page.

   Run: npm run runner:status */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_FILE = path.join(ROOT, 'data', 'judge-token.json');

const line = (...a) => console.log(...a);
const rule = () => line('-'.repeat(60));

/* Two Windows papercuts, both of which printed a libuv crash after a
   perfectly good report:

     · AbortSignal.timeout leaves its timer running after the fetch settles,
       so the timer is owned here and cleared;
     · fetch leaves a keep-alive socket in the global pool, and calling
       process.exit() while one is open aborts libuv with UV_HANDLE_CLOSING.

   So nothing here calls process.exit: main() returns a code, and the process
   is left to end on its own once the socket is gone. */
async function ask(url, headers = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    return await fetch(url, { headers, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let file = null;
  try { file = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')); } catch { /* none */ }

  const port = (file && file.port) || Number(process.env.JUDGE_PORT || 2000);
  const base = `http://127.0.0.1:${port}`;

  rule();

  let health = null;
  try {
    const res = await ask(`${base}/health`);
    if (res.ok) health = await res.json();
  } catch { /* nothing listening */ }

  if (!health) {
    line(`  nothing is listening at ${base}`);
    if (file) {
      line(`  but ${path.relative(ROOT, TOKEN_FILE)} still names a runner`);
      line(`  started ${file.startedAt}${file.pid ? `, pid ${file.pid}` : ''}`);
      line('  that file is stale — the next start will replace it');
    }
    line('');
    line('  start one with:  npm run runner');
    rule();
    return 1;
  }

  line(`  a runner is listening at ${base}`);
  for (const l of health.languages || []) {
    line(`    ${l.available ? 'ok  ' : '--  '} ${String(l.id).padEnd(7)} ${l.version || 'NOT INSTALLED'}`);
  }

  if (!file) {
    line('');
    line('  no token file, so the page cannot authenticate to it');
    line('  restart it:  npm run runner:stop && npm run runner');
    rule();
    return 1;
  }

  /* The real question: does the file's token work on the thing that answered? */
  let authed = false;
  try {
    const res = await ask(`${base}/langs`, { 'X-Judge-Token': file.token });
    authed = res.ok;
  } catch { /* leave false */ }

  line('');
  if (authed) {
    line('  the token file matches the running instance');
    line(`  started ${file.startedAt}${file.pid ? `, pid ${file.pid}` : ''}`);
    rule();
    return 0;
  }

  line('  the token file does NOT match the running instance');
  line('  two runners were probably started; the second wrote the file and died.');
  line('  fix it with:  npm run runner:stop && npm run runner');
  rule();
  return 1;
}

process.exitCode = await main();
