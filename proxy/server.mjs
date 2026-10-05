/* The proxy as a Node server, for development and for testing the whole
   browser-to-hosted path without deploying anything.

   The handler is the same file the Worker runs, so what is tested here is
   what would be deployed — only the entry point differs.

   Run:  node proxy/server.mjs
   Env:  PORT, ALLOWED_ORIGINS, CLIENT_TOKEN,
         JUDGE0_URL | JUDGE0_RAPIDAPI_KEY (+ JUDGE0_RAPIDAPI_HOST) | JUDGE0_AUTH_TOKEN */

import { createServer } from 'node:http';
import { handle, sweepBuckets, LIMITS } from './handler.mjs';

const PORT = Number(process.env.PORT || 8787);
const env = {
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
  CLIENT_TOKEN: process.env.CLIENT_TOKEN || '',
  JUDGE0_URL: process.env.JUDGE0_URL || '',
  JUDGE0_RAPIDAPI_KEY: process.env.JUDGE0_RAPIDAPI_KEY || '',
  JUDGE0_RAPIDAPI_HOST: process.env.JUDGE0_RAPIDAPI_HOST || '',
  JUDGE0_AUTH_TOKEN: process.env.JUDGE0_AUTH_TOKEN || '',
};

/* Node's http server predates fetch, so the two are bridged here rather than
   the handler being written twice. */
function toRequest(req) {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Request(url, { method: req.method, headers });
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(new Request(url, {
      method: req.method, headers, body: Buffer.concat(chunks),
    })));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    const response = await handle(request, env);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String((err && err.message) || err) }));
  }
});

setInterval(() => sweepBuckets(), 5 * 60000).unref();

server.listen(PORT, '127.0.0.1', () => {
  const upstream = env.JUDGE0_URL || (env.JUDGE0_RAPIDAPI_KEY ? 'RapidAPI' : 'https://ce.judge0.com (default)');
  console.log('─'.repeat(60));
  console.log('  Systems Lab hosted-execution proxy');
  console.log(`  listening   http://127.0.0.1:${PORT}`);
  console.log(`  upstream    ${upstream}`);
  console.log(`  origins     ${env.ALLOWED_ORIGINS || '(any — development only)'}`);
  console.log(`  client tok  ${env.CLIENT_TOKEN ? 'required' : 'not required'}`);
  console.log(`  limits      ${LIMITS.maxCases} cases, ${LIMITS.cpuSeconds.max}s cpu, `
    + `${LIMITS.bucket.capacity} runs burst / ${LIMITS.bucket.refillPerMinute} per minute`);
  console.log('─'.repeat(60));
});
