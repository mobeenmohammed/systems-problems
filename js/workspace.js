/* ============================================================
   workspace.js — what a multi-file exercise is.

   One module, no DOM, no window, so the page, the audit and the
   tests all agree on the same four questions:

     · which files does this problem start with
     · which of them is the entry point
     · which of them are translation units, and which are
       headers that are planted and not compiled
     · how is a whole workspace written down as one string, for
       the submission vault and for carrying work forward

   A problem is multi-file when it has `payload.files`. Anything
   without it is a single-file problem and nothing here applies
   to it — that is the whole compatibility story.

   ---------------- paths ----------------

   A path here is a relative path inside one compile, and it is
   validated rather than trusted. Not as a security boundary —
   see below — but because an unvalidated path reaches a
   filesystem in a Worker, a temp directory on the judge, and a
   `-o` argument, and "../../etc/x" meaning three different
   things in three places is how a bug becomes interesting.

   `readOnly` is an editing aid and is written down as one. It
   stops a reader changing the interface by accident; it stops
   nobody who opens the console. Nothing is graded on it.
   ============================================================ */

const Workspace = (() => {

  /* Deliberately small. These are exercises, not repositories: the
     explorer is a list you can see all of, and arbitrary file creation
     is a later iteration. */
  const MAX_FILES = 12;
  const MAX_BYTES = 256 * 1024;       /* the whole workspace, not per file */
  const MAX_PATH = 64;
  const MAX_DEPTH = 3;                /* a/b/c.cpp and no deeper */

  /* One segment: starts with a letter, digit or underscore, and then the
     characters a source tree actually uses. No spaces, no dots at the
     front, so "..", ".git" and " x" are all out by construction rather
     than by a special case each. */
  const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;

  /* What may be compiled, and what may only be included. The split is
     the point: a header planted in the filesystem and also handed to the
     compiler is a duplicate definition at link time. */
  const SOURCE_EXT = ['.cpp', '.cc', '.cxx', '.c'];
  const HEADER_EXT = ['.hpp', '.hh', '.h', '.hxx', '.ipp'];
  const KNOWN_EXT = [...SOURCE_EXT, ...HEADER_EXT, '.rs', '.py', '.sv', '.svh', '.v', '.txt', '.md'];

  const ext = path => {
    const at = String(path).lastIndexOf('.');
    return at < 0 ? '' : String(path).slice(at).toLowerCase();
  };

  const isSource = path => SOURCE_EXT.includes(ext(path));
  const isHeader = path => HEADER_EXT.includes(ext(path));

  /* Why a path is not usable, or null. A reason rather than a boolean,
     because this is checked at build time and the author is the one who
     has to act on it. */
  function pathProblem(path) {
    const p = String(path == null ? '' : path);
    if (!p) return 'a file has no path';
    if (p.length > MAX_PATH) return `"${p}" is longer than ${MAX_PATH} characters`;
    if (p !== p.trim()) return `"${p}" has whitespace around it`;
    if (p.includes('\\')) return `"${p}" uses a backslash; paths here are written with /`;
    if (p.startsWith('/')) return `"${p}" is absolute; paths here are relative to the workspace`;
    if (/^[A-Za-z]:/.test(p)) return `"${p}" looks like a drive letter`;
    const parts = p.split('/');
    if (parts.length > MAX_DEPTH) return `"${p}" is nested deeper than ${MAX_DEPTH} levels`;
    for (const seg of parts) {
      if (!SEGMENT.test(seg)) return `"${p}" has a segment this does not allow: "${seg}"`;
    }
    if (!KNOWN_EXT.includes(ext(p))) return `"${p}" does not end in a kind of file this understands`;
    return null;
  }

  const pathOk = path => pathProblem(path) === null;

  /* ---------------- reading a problem ---------------- */

  const isMulti = problem => Array.isArray(((problem || {}).payload || {}).files)
    && ((problem || {}).payload || {}).files.length > 0;

  /* The starter files, in the order the author wrote them, with the
     defaults filled in. `role: 'entry'` is derived rather than authored
     twice. */
  function starters(problem) {
    const pay = (problem || {}).payload || {};
    const files = Array.isArray(pay.files) ? pay.files : [];
    const entry = entryOf(problem);
    return files.map(f => ({
      path: String(f.path),
      content: typeof f.content === 'string' ? f.content : '',
      readOnly: !!f.readOnly,
      note: f.note ? String(f.note) : '',
      entry: String(f.path) === entry,
    }));
  }

  /* The entry point: what the author said, or the first thing that could
     hold a main. */
  function entryOf(problem) {
    const pay = (problem || {}).payload || {};
    const files = Array.isArray(pay.files) ? pay.files : [];
    if (pay.entry) return String(pay.entry);
    const first = files.find(f => isSource(f.path));
    return first ? String(first.path) : (files[0] ? String(files[0].path) : '');
  }

  /* Which files go to the compiler as translation units. Authored when
     the problem needs to say so — a file that exists to be included by
     another must not also be compiled — and otherwise every source file.

     Headers are never in this list. They are planted beside the sources
     and found by #include, which is what makes a local header work. */
  function buildSources(problem) {
    const pay = (problem || {}).payload || {};
    const build = pay.build || {};
    const all = starters(problem);
    if (Array.isArray(build.sources) && build.sources.length) {
      return build.sources.map(String).filter(p => all.some(f => f.path === p));
    }
    return all.filter(f => isSource(f.path)).map(f => f.path);
  }

  /* Everything that is planted in the compile's filesystem: the sources,
     the headers, and anything else the problem carries. */
  const allPaths = problem => starters(problem).map(f => f.path);

  /* ---------------- validating a whole set ---------------- */

  /* Used by the build at author time and by the runner at run time. The
     runner checks again rather than trusting the page, because by then
     the files have been through localStorage and a submission vault. */
  function faults(files, { entry = null, sources = null } = {}) {
    const found = [];
    const seen = new Set();
    let bytes = 0;

    if (!Array.isArray(files) || !files.length) return ['there are no files'];
    if (files.length > MAX_FILES) found.push(`more than ${MAX_FILES} files`);

    for (const f of files) {
      const why = pathProblem(f && f.path);
      if (why) { found.push(why); continue; }
      const key = String(f.path).toLowerCase();
      if (seen.has(key)) found.push(`"${f.path}" appears twice`);
      seen.add(key);
      if (typeof f.content !== 'string') found.push(`"${f.path}" has no content string`);
      else bytes += f.content.length;
    }

    if (bytes > MAX_BYTES) {
      found.push(`the workspace is ${Math.round(bytes / 1024)} KB, over the ${
        Math.round(MAX_BYTES / 1024)} KB limit`);
    }
    if (entry && !files.some(f => String(f.path) === String(entry))) {
      found.push(`the entry point "${entry}" is not one of the files`);
    }
    for (const s of sources || []) {
      if (!files.some(f => String(f.path) === String(s))) {
        found.push(`"${s}" is built but is not one of the files`);
      } else if (isHeader(s)) {
        found.push(`"${s}" is a header and cannot be a translation unit`);
      }
    }
    if (sources && !sources.length) found.push('nothing is built');
    return found;
  }

  /* ---------------- one workspace, as one string ----------------

     The submission vault stores a program as a string, and so does the
     draft store's answer slot. A multi-file submission is still one
     thing that was submitted once and got one verdict, so it is written
     down as one string rather than spread across records that could
     come back half-missing.

     The marker is there so `unpack` can answer "is this a workspace or
     is it somebody's C++ that happens to start with a brace" without
     guessing. */
  const MARKER = 'invariantWorkspace';

  function pack({ entry = '', files = [] } = {}) {
    return JSON.stringify({
      [MARKER]: 1,
      entry: String(entry || ''),
      files: files.map(f => ({ path: String(f.path), content: String(f.content == null ? '' : f.content) })),
    });
  }

  function unpack(text) {
    if (typeof text !== 'string' || text.length < 2 || text[0] !== '{') return null;
    if (!text.includes(`"${MARKER}"`)) return null;
    let doc;
    try { doc = JSON.parse(text); } catch { return null; }
    if (!doc || doc[MARKER] !== 1 || !Array.isArray(doc.files)) return null;
    return {
      entry: String(doc.entry || ''),
      files: doc.files
        .filter(f => f && typeof f.path === 'string')
        .map(f => ({ path: f.path, content: typeof f.content === 'string' ? f.content : '' })),
    };
  }

  const packed = text => unpack(text) !== null;

  /* ---------------- where a draft lives ----------------

     The draft store is keyed by (problem, language). A multi-file
     problem has one draft per file, so the file's path rides in the key
     after the language. Single-file problems keep the bare language,
     which is what makes every existing draft keep working. */
  const draftKey = (lang, path) => `${lang}:${path}`;

  /* Reserved slots on the same store, named like the existing `_mycases`
     so a slot can never collide with a language. */
  const ACTIVE_SLOT = '_file';

  return {
    MAX_FILES, MAX_BYTES, MAX_PATH, MAX_DEPTH,
    SOURCE_EXT, HEADER_EXT, KNOWN_EXT,
    ext, isSource, isHeader,
    pathProblem, pathOk,
    isMulti, starters, entryOf, buildSources, allPaths,
    faults,
    pack, unpack, packed, MARKER,
    draftKey, ACTIVE_SLOT,
  };
})();
