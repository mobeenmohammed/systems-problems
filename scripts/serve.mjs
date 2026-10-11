/* The development server.

   This was `python -m http.server 8000`, which is fine until something
   needs a correct Content-Type. Python's table serves `.mjs` as
   `text/plain`, and a browser refuses a module with that type — which is
   how the Python runner came to fail on localhost while being perfectly
   deployable. GitHub Pages serves `.mjs` as JavaScript; the difference
   was the dev server, not the site.

   So: a static file server whose only real job is the MIME table, kept
   deliberately small.

   Run: npm run serve            (port 8000)
        PORT=8010 npm run serve  */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';

/* Everything the site actually serves. A type that is missing here is a
   bug waiting to happen on one browser, so the fallback is deliberately
   boring rather than clever. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    res.writeHead(400).end('bad path');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';

  /* Nothing outside the repository, whatever the path says. */
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      /* The tests reload constantly and a stale bundle is a confusing
         afternoon. The Cache API the runners use is keyed by a versioned
         URL and is unaffected by this. */
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  serving ${ROOT}`);
  console.log(`  http://${HOST}:${PORT}\n`);
});
