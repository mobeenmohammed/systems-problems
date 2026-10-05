/* The proxy as a Cloudflare Worker.

   Nothing but an entry point: the logic is handler.mjs, which is also what
   proxy/server.mjs runs, so the thing tested locally is the thing deployed.

   Secrets are Worker secrets, never in wrangler.toml and never in the
   repository:

     wrangler secret put JUDGE0_RAPIDAPI_KEY     # or JUDGE0_AUTH_TOKEN
     wrangler secret put CLIENT_TOKEN            # optional

   See proxy/README.md for what deploying actually requires. */

import { handle, sweepBuckets } from './handler.mjs';

export default {
  async fetch(request, env, ctx) {
    /* Each isolate keeps its own buckets; sweeping keeps a long-lived one
       from growing a map entry per address it has ever seen. */
    if (ctx && ctx.waitUntil) ctx.waitUntil(Promise.resolve(sweepBuckets()));
    return handle(request, env);
  },
};
