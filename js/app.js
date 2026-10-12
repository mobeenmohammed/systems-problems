/* ============================================================
   app.js — bootstrap, routing, keyboard shortcuts.

   Routes live in the hash, so GitHub Pages can serve a single
   static index.html and a deep link to a problem still works
   without any server rewriting. #/p/<id> is the one that has to
   survive being pasted somewhere.
   ============================================================ */

(() => {

  const VIEWS = ['home', 'problems', 'problem', 'learn', 'tracks', 'concepts', 'profile',
    'shop', 'settings', 'setup', '404'];

  function show(name) {
    /* Every route change comes through here, which makes it the one place
       that can guarantee the problem page has been shut down properly. It
       used to be nobody's job, and the workspace's full-bleed, clipped,
       unscrollable layout followed the reader onto the dashboard. */
    if (name !== 'problem') ProblemView.leave();

    for (const v of VIEWS) {
      const node = document.getElementById(`view-${v}`);
      if (node) node.hidden = v !== name;
    }
    /* The bar has one entry now, so which page you are on is said inside
       the menu rather than on it. A menu left hanging open over the page
       the reader has just navigated to is the other half of that. */
    UI.markNav();
    UI.closeContent();
  }

  /* "#/problems?topic=os&lang=python" -> { path: ['problems'], query: {…} } */
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

    /* A theme preview is deliberately unsaved, so leaving the shop puts the
       real theme back rather than stranding the reader in a look they never
       chose. */
    if (head !== 'shop') UI.endPreview();

    switch (head) {
      case '':
        show('home');
        UI.renderHome();
        break;

      case 'problems':
        show('problems');
        UI.setFilter({
          kind: query.kind || '',
          topic: query.topic || '',
          difficulty: query.diff || query.difficulty || '',
          type: query.type || '',
          status: query.status || '',
          lang: query.lang || '',
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

      /* Learn is the tracks-as-trees view: #/learn, #/learn/<track>, and
         #/learn/<track>/<concept> for a node. */
      case 'learn':
        show('learn');
        UI.renderLearn(path[1] || null, path[2] || null);
        break;

      /* Kept so older links and bookmarks still land somewhere: the flat
         list of a track's problems, reached from inside Learn. */
      case 'tracks':
        if (!path[1]) { location.hash = '#/learn'; return; }
        show('tracks');
        UI.renderTracks(path[1]);
        break;

      /* The whole concept index, by topic. It has no nav entry of its own
         any more; Learn links to it. */
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

      /* Reached from "Set up execution" beside Run, and from Settings. It is
         a page rather than a dialog because it is a procedure with terminal
         output in it, and because a link to it can be shared. */
      case 'setup':
        show('setup');
        await SetupGuide.render();
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
      /* Escape leaves the field — unless something in the field has
         already used it. The editor's completion popup closes on Escape,
         and dismissing a suggestion you did not want should not also
         throw you out of the editor. A second Escape still leaves. */
      if (e.key === 'Escape' && !e.defaultPrevented) t.blur();
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
      /* l for Learn; t still works, because it has been t for Tracks for
         as long as there have been tracks and the list is still in there. */
      case 'l': go('#/learn'); break;
      case 't': go('#/learn'); break;
      case 'u': go('#/profile'); break;
      case 's': go('#/shop'); break;
      /* Focus mode, from anywhere - it is a view preference rather than
         something belonging to one problem, and it persists. */
      case 'f':
        e.preventDefault();
        ProblemView.toggleFocus();
        break;
      case 'Escape':
        if (document.documentElement.hasAttribute('data-focus')) {
          e.preventDefault();
          ProblemView.toggleFocus(false);
        }
        break;
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
  window.SystemsLab = {
    Store, Catalog, ProblemTypes, ProblemView, UI, route,
    Runners, Hosted, BrowserCpp, RunHarness, Lint, Editor,
    MathsExpr, MathsRender,
  };
})();
