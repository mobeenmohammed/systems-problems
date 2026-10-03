/* ============================================================
   app.js — bootstrap, routing, keyboard shortcuts.

   Routes live in the hash, so GitHub Pages can serve a single
   static index.html and a deep link to a problem still works
   without any server rewriting. #/p/<id> is the one that has to
   survive being pasted somewhere.
   ============================================================ */

(() => {

  const VIEWS = ['home', 'problems', 'problem', 'concepts', 'profile', 'shop', 'settings', '404'];

  function show(name) {
    for (const v of VIEWS) {
      const node = document.getElementById(`view-${v}`);
      if (node) node.hidden = v !== name;
    }
    /* The problem view has no nav entry of its own; the Problems tab stays
       current while you are inside one, which is where "back" goes. */
    const navKey = name === 'problem' ? 'problems' : name;
    for (const a of document.querySelectorAll('#nav a')) {
      if (a.dataset.route === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  /* "#/problems?topic=os&diff=beginner" -> { path: ['problems'], query: {…} } */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const path = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const query = {};
    for (const [k, v] of new URLSearchParams(queryPart || '')) query[k] = v;
    return { path, query };
  }

  async function route() {
    const { path, query } = parseHash();
    const head = path[0] || '';

    switch (head) {
      case '':
        show('home');
        UI.renderHome();
        break;

      case 'problems':
        show('problems');
        UI.setFilter({
          topic: query.topic || '',
          difficulty: query.diff || query.difficulty || '',
          type: query.type || '',
          status: query.status || '',
          q: query.q || '',
        });
        break;

      case 'p':
        if (!path[1]) { show('404'); break; }
        show('problem');
        await ProblemView.open(path[1], document.getElementById('problemHost'));
        break;

      case 'topic':
        /* A convenience link; it is the catalog filtered, not a view of its own. */
        location.hash = `#/problems?topic=${encodeURIComponent(path[1] || '')}`;
        return;

      case 'concepts':
        show('concepts');
        UI.renderConcepts();
        break;

      case 'profile':
        show('profile');
        UI.renderProfile();
        break;

      case 'shop':
        show('shop');
        UI.renderShop();
        break;

      case 'settings':
        show('settings');
        UI.renderSettings();
        break;

      default:
        show('404');
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  /* ---------------- shortcuts ---------------- */

  function shortcuts(e) {
    /* Never steal a key from a field someone is typing in. */
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const go = hash => { location.hash = hash; };

    switch (e.key) {
      case '/':
        e.preventDefault();
        if (!location.hash.startsWith('#/problems')) go('#/problems');
        setTimeout(() => {
          const box = document.getElementById('fSearch');
          if (box) box.focus();
        }, 40);
        break;
      case 'g': go('#/'); break;
      case 'p': go('#/problems'); break;
      case 'r': go('#/concepts'); break;
      case 'u': go('#/profile'); break;
      case 's': go('#/shop'); break;
      default: break;
    }
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    await Store.init();
    UI.applyCosmetics();
    UI.refreshPurse();

    await Catalog.init();
    if (Catalog.loadError) {
      UI.toast(
        `The problem index could not be loaded (${Catalog.loadError}). ` +
        'Serve the folder over HTTP rather than opening index.html off disk.',
        'bad', 9000,
      );
    }

    UI.wire();

    /* A failed write means the rest of the session would vanish on reload, so
       it is said out loud rather than discovered later. */
    Store.on((event, detail) => {
      if (event === 'storage-error') {
        UI.toast('Could not save — your browser refused the write. Export your progress from Settings.', 'bad', 12000);
      }
    });

    window.addEventListener('hashchange', route);
    document.addEventListener('keydown', shortcuts);

    await route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* A handle for the tests and the console. */
  window.BareMetal = { Store, Catalog, ProblemTypes, ProblemView, UI, route };
})();
