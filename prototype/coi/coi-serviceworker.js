/* Cross-origin isolation on a host that cannot set a response header.

   WHY THIS EXISTS. An in-browser Rust toolchain with the LLVM backend
   (rubrc) needs threads, threads need SharedArrayBuffer, and
   SharedArrayBuffer needs the document to be *cross-origin isolated* —
   which a server grants by sending two headers on the HTML:

     Cross-Origin-Opener-Policy:   same-origin
     Cross-Origin-Embedder-Policy: require-corp

   rubrc's own deployment sends both. GitHub Pages sends neither and
   offers no way to configure them, which is the whole blocker.

   A service worker can stand in: it intercepts the page's own requests
   and re-issues the responses with the headers attached. The browser
   then treats the document as isolated, because as far as it is
   concerned the headers arrived. This is the technique published as
   gzuidhof/coi-serviceworker; this is an independent implementation of
   it, written out so that every line can be read, because a service
   worker is a thing that sits in front of a site forever.

   WHAT IT COSTS, and none of this is hypothetical:

     · one extra load. A service worker does not control the page that
       registered it, so the first visit registers and reloads. Anybody
       arriving at a URL sees the page twice.
     · `require-corp` means every subresource must opt in, with CORP or
       CORS. Same-origin resources are fine; a cross-origin script, font
       or image that does not opt in simply fails to load.
     · a service worker is a cache in front of the site, which is the
       single most common source of "I am looking at an old build".
     · it is dead in a private window with storage blocked, and on any
       browser where registration fails.

   SCOPE. A service worker's scope is the directory it is served from,
   so this one controls `prototype/coi/` and nothing else. It cannot
   affect the rest of the site, which is the point: this is a prototype
   that answers a question, not a change to how the site is served. */

if (typeof window === 'undefined') {
  /* ---------------- the worker ---------------- */

  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

  self.addEventListener('fetch', event => {
    const r = event.request;
    /* Only ordinary same-origin GETs. A range request must be left
       alone or media breaks, and a navigation preload is not ours. */
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

    event.respondWith(
      fetch(r)
        .then(res => {
          if (res.status === 0) return res;   /* an opaque response: nothing to rewrite */
          const headers = new Headers(res.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          /* Same-origin subresources have to opt in too, or
             `require-corp` rejects them. */
          headers.set('Cross-Origin-Resource-Policy', 'same-origin');
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          });
        })
        .catch(err => {
          console.error('[coi] passing through:', err);
          return fetch(r);
        }),
    );
  });
} else {
  /* ---------------- the registration ---------------- */

  (() => {
    const say = (state, detail) => {
      window.__coi = { state, detail };
      window.dispatchEvent(new CustomEvent('coi', { detail: { state, detail } }));
    };

    if (window.crossOriginIsolated) { say('isolated', 'already'); return; }
    if (!window.isSecureContext) { say('insecure', 'needs https or localhost'); return; }
    if (!('serviceWorker' in navigator)) { say('unsupported', 'no service worker'); return; }

    navigator.serviceWorker.register(window.document.currentScript.src)
      .then(reg => {
        if (reg.active && !navigator.serviceWorker.controller) {
          /* Registered on a previous visit but not controlling this
             load: one reload hands the page over. */
          say('reloading', 'the worker is active but not in control yet');
          window.location.reload();
          return;
        }
        reg.addEventListener('updatefound', () => say('updating', 'a new worker is installing'));
        if (navigator.serviceWorker.controller) { say('controlled', 'reload to apply'); return; }
        reg.addEventListener('activate', () => window.location.reload());
        say('registered', 'reloading to take control');
        /* First registration: reload once so the worker controls the
           document and the headers are in place. */
        setTimeout(() => window.location.reload(), 60);
      })
      .catch(err => say('failed', String(err && err.message) || String(err)));
  })();
}
