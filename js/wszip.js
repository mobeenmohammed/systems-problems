/* ============================================================
   wszip.js — download the workspace you can see.

   A ZIP writer in about eighty lines, because the alternative
   was a dependency and this site does not have one. Entries are
   STOREd rather than deflated: a workspace here is a few
   kilobytes of source, the saving would be invisible, and a
   deflate implementation is a thing that can be subtly wrong in
   a file somebody only opens once, months later, when they want
   their work back. STORE cannot be subtly wrong.

   ---------------- what goes in ----------------

   Exactly what `WsFiles.visible()` says is on screen, at the
   relative paths the explorer shows, plus a README. Nothing
   else is reachable from here: the grading harness and the
   reference design live under `key` in the solution file and
   are not files in any workspace, so no rule has to remember to
   exclude them.

   The README says what the exercise is, what each file is for,
   and how to build it locally — but only where that has been
   checked. Where the browser and a local toolchain differ, it
   says so rather than letting somebody discover it from a
   compiler error.
   ============================================================ */

const WsZip = (() => {

  /* ---------------- CRC-32 ---------------- */

  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) {
      c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- the archive ----------------

     One pass to write every local header and its data, a second to
     write the central directory. Dates are written as the MS-DOS pair
     ZIP has always used, from local time, because that is what every
     reader expects to see beside the file. */

  const utf8 = new TextEncoder();

  function dosTime(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5)
      | ((Math.floor(d.getSeconds() / 2)) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9)
      | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
  }

  function build(entries, when = new Date()) {
    const { time, date } = dosTime(when);
    const parts = [];
    const central = [];
    let offset = 0;

    for (const e of entries) {
      const name = utf8.encode(e.path);
      const data = utf8.encode(e.content);
      const sum = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);          /* version needed */
      /* Bit 11: the names are UTF-8. Without it a path with anything
         outside ASCII in it is read as code page 437. */
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);           /* STORE */
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, sum, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);          /* no extra field */

      parts.push(new Uint8Array(local.buffer), name, data);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);            /* version made by */
      dir.setUint16(6, 20, true);            /* version needed */
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, 0, true);
      dir.setUint16(12, time, true);
      dir.setUint16(14, date, true);
      dir.setUint32(16, sum, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint16(30, 0, true);
      dir.setUint16(32, 0, true);            /* comment */
      dir.setUint16(34, 0, true);            /* disk */
      dir.setUint16(36, 0, true);            /* internal attrs */
      /* 0o644 in the high half, as a unix-made archive writes it, so
         the files come out readable rather than with no mode at all. */
      dir.setUint32(38, (0o100644 << 16) >>> 0, true);
      dir.setUint32(42, offset, true);

      central.push(new Uint8Array(dir.buffer), name);
      offset += 30 + name.length + data.length;
    }

    const dirBytes = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, dirBytes, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
      { type: 'application/zip' });
  }

  /* ---------------- what the README says ----------------

     Build instructions only where they have been checked. The C++ and
     SystemVerilog projects are built locally by the audit scripts on
     every change, so those commands are known to work; a language
     whose local story has not been verified gets no command and says
     as much, because a command that does not work is worse than no
     command. */

  const ROLE_SAID = {
    yours: 'yours to write',
    given: 'supplied by the exercise, read-only in the browser',
    'sample-tb': 'the sample testbench Run uses',
    mine: 'your own testbench; never graded',
  };

  function howToBuild(problem, files, lang) {
    const pay = problem.payload || {};
    const sources = (pay.build && Array.isArray(pay.build.sources))
      ? pay.build.sources
      : files.filter(f => !f.readOnly && /\.(cpp|cc|cxx|c)$/.test(f.path)).map(f => f.path);

    if (lang === 'cpp') {
      return [
        'Building it locally',
        '',
        'The browser compiles with clang 20.1.2 targeting wasm32-wasi, with:',
        '',
        '    -O2 -std=c++20 -fno-exceptions -Wall -Wextra',
        '',
        'Any C++20 compiler will do the same job. With g++ or clang++:',
        '',
        `    g++ -O2 -std=c++20 -Wall -Wextra ${sources.join(' ')} -o solution`,
        '    ./solution',
        '',
        'Two differences worth knowing about:',
        '',
        '  - `-fno-exceptions` is on in the browser and is not in the line',
        '    above. Code that throws will compile locally and fail there.',
        '  - the browser runs under WASI: no network, no clock you can rely',
        '    on, and a filesystem with nothing in it. Programs here read',
        '    stdin and write stdout, which works the same in both places.',
      ];
    }

    if (lang === 'sv' || lang === 'verilog') {
      const sv = files.filter(f => /\.(sv|v|svh)$/.test(f.path)).map(f => f.path);
      return [
        'Simulating it locally',
        '',
        'The browser runs Icarus Verilog 14.0 compiled to WebAssembly, in',
        'SystemVerilog-2012 mode. A local Icarus is the same simulator:',
        '',
        `    iverilog -g2012 -o sim ${sv.join(' ')}`,
        '    vvp sim',
        '',
        'The testbench in this archive is the SAMPLE one. Submit drives your',
        'design with a different testbench that tries cases this one does',
        'not, and that testbench is deliberately not included - passing here',
        'is not the same as passing there.',
      ];
    }

    if (lang === 'rust') {
      return [
        'Building it locally',
        '',
        'The browser compiles with a rustc 1.96.0-dev built for WebAssembly,',
        'using the Cranelift backend, edition 2024 and `-Cpanic=abort`.',
        'A stable rustc will differ in the backend and in panic behaviour.',
        '',
        '    rustc --edition 2024 -O main.rs -o solution',
        '    ./solution',
      ];
    }

    if (lang === 'python') {
      return [
        'Running it locally',
        '',
        'The browser runs CPython 3.14.2 through Pyodide. Any Python 3.11 or',
        'later should behave the same for these exercises, which use nothing',
        'outside the standard library:',
        '',
        '    python3 main.py',
      ];
    }

    return [
      'Building it locally',
      '',
      'No local build command is given here, because none has been checked',
      'for this language. The browser runs it; what a local toolchain would',
      'need has not been verified, and a command that does not work would be',
      'worse than this paragraph.',
    ];
  }

  function readme(problem, files, lang) {
    const title = problem.title || problem.id;
    const proj = problem.project || null;
    const when = new Date().toISOString().slice(0, 10);
    const L = [
      title,
      '='.repeat(title.length),
      '',
      `Downloaded from Invariant on ${when}.`,
      /* ASCII throughout: this is a .txt that lands on whatever
         machine the reader is on, and an em-dash in a file opened in
         an editor that guessed code page 1252 is a replacement
         character where a word should be. The code files keep
         whatever the reader typed; the README is ours and is plain. */
      proj ? `Part of ${proj.title} - milestone ${proj.step} of ${proj.of}.` : null,
      '',
      'The files',
      '',
    ].filter(v => v !== null);

    const width = Math.max(...files.map(f => f.path.length));
    for (const f of files) {
      const said = ROLE_SAID[f.role] || 'yours to write';
      L.push(`  ${f.path.padEnd(width)}  ${said}`);
      if (f.note) L.push(`  ${' '.repeat(width)}  ${f.note}`);
    }

    L.push('', ...howToBuild(problem, files, lang), '');
    L.push(
      'What is not in here',
      '',
      '  - the reference solution, and the explanation that goes with it.',
      '    Both are on the problem page once you have finished or revealed',
      '    it, which is where they belong.',
      '  - the hidden cases Submit runs, and the grading testbench on a',
      '    hardware exercise. Those are the whole of what Submit is for.',
      '',
      'Your progress, your drafts and your submissions stay in this browser,',
      'on this device. This archive is a copy of the code and nothing else.',
      '',
    );
    return L.join('\n');
  }

  /* ---------------- the download ---------------- */

  const slug = s => String(s || 'workspace').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'workspace';

  /* Returns what was written, so a caller can say how many files went
     into the archive rather than claiming it worked. */
  function download(problem, lang = null) {
    const files = WsFiles.visible(problem);
    if (!files.length) return null;

    const ed = (ProblemTypes.get(problem.type) || {}).editor;
    const live = ed && ed();
    const useLang = lang || (live && live.lang) || (problem.type === 'hdl' ? 'sv' : 'cpp');

    const name = slug(problem.id);
    const entries = [
      ...files.map(f => ({ path: `${name}/${f.path}`, content: f.content })),
      { path: `${name}/README.txt`, content: readme(problem, files, useLang) },
    ];

    const blob = build(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    /* Revoked on the next turn of the loop rather than immediately:
       Safari has historically started the download asynchronously and
       an immediate revoke left it with nothing to fetch. */
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    return { name: `${name}.zip`, files: entries.map(e => e.path), bytes: blob.size };
  }

  return { download, build, crc32, readme, slug };
})();
