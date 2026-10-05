/* ============================================================
   setup.js — "how do I actually run C++ and Rust?"

   The honest answer has three parts and they are genuinely
   different, so the page says which is which rather than
   collapsing them into "execution":

     Browser   it runs on this device, inside this tab
     Hosted    it runs on a server somewhere; nothing to install
     Local     it runs on your own machine, on your own compilers

   Two rules govern everything here.

   The first is that nothing claims to work because the code
   thinks it should. Every state on this page is measured: the
   mode cards ask the runners, and "Run the check" compiles and
   runs a real program and compares its output. A reachable
   runner is not a working one — it can be up and missing rustc.

   The second is that a failure is useless without a next step.
   Every state a reader can land in has a sentence saying what
   happened and a sentence saying what to do, and none of them
   is ever "turn off a browser security feature".
   ============================================================ */

const SetupGuide = (() => {

  const { el } = ProblemTypes;
  const $ = sel => document.querySelector(sel);

  /* The smallest programs that prove a toolchain is really there: both read
     a number from stdin and print it doubled, so a wrong answer is as
     visible as a failure to build. */
  const PROBES = {
    cpp: {
      label: 'C++',
      source: '#include <iostream>\nint main() {\n    int n = 0;\n    std::cin >> n;\n'
        + '    std::cout << n * 2 << "\\n";\n    return 0;\n}\n',
    },
    rust: {
      label: 'Rust',
      source: 'use std::io::Read;\nfn main() {\n    let mut s = String::new();\n'
        + '    std::io::stdin().read_to_string(&mut s).unwrap();\n'
        + '    let n: i64 = s.trim().parse().unwrap();\n    println!("{}", n * 2);\n}\n',
    },
  };
  const PROBE_IN = '21\n';
  const PROBE_OUT = '42';

  /* ---------------- small pieces ---------------- */

  /* A command you are meant to run, with a button that copies it. The button
     reports what it did, because a copy that silently failed — which happens
     whenever the page is not focused — is worse than no button. */
  function command(text, note) {
    const btn = el('button', {
      class: 'btn btn-sm copy-btn', type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied';
          btn.dataset.state = 'done';
        } catch {
          btn.textContent = 'Press Ctrl+C';
          btn.dataset.state = 'manual';
          const pre = btn.closest('.cmd').querySelector('code');
          const range = document.createRange();
          range.selectNodeContents(pre);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        setTimeout(() => { btn.textContent = 'Copy'; delete btn.dataset.state; }, 2200);
      },
    }, ['Copy']);

    return el('div', { class: 'cmd' }, [
      el('pre', { class: 'code-block' }, [el('code', { text })]),
      btn,
      note ? el('p', { class: 'tiny faint cmd-note', text: note }) : null,
    ]);
  }

  /* What a command should print when it worked. Shown next to every command
     that produces output, so "did that work?" has an answer. */
  const expected = lines => el('details', { class: 'expect' }, [
    el('summary', { text: 'What you should see' }),
    el('pre', { class: 'code-block expect-out' }, [el('code', { text: lines })]),
  ]);

  const step = (n, title, ...body) => el('li', { class: 'setup-step' }, [
    el('h4', {}, [el('span', { class: 'step-n', text: String(n) }), title]),
    ...body,
  ]);

  /* ---------------- the three modes ---------------- */

  async function paintModes() {
    const host = $('#setupModes');
    if (!host) return;
    host.replaceChildren(el('p', { class: 'muted small', text: 'Checking…' }));

    const rows = await Runners.available(['js', 'cpp', 'rust', 'python']);
    const judge = Runners.judge;
    const hosted = typeof Hosted !== 'undefined' ? await Hosted.check() : { up: false };
    const byBackend = id => (rows.find(r => r.id === id) || {}).backend || null;

    const langsOn = backend => rows.filter(r => r.backend === backend)
      .map(r => (r.id === 'js' ? 'JavaScript' : r.id === 'cpp' ? 'C++'
        : r.id === 'rust' ? 'Rust' : 'Python'));

    const card = ({ name, what, state, detail, langs, actions }) => el('div', {
      class: 'setup-mode', 'data-state': state,
    }, [
      el('div', { class: 'setup-mode-head' }, [
        el('h3', { text: name }),
        el('span', { class: 'setup-badge', 'data-state': state, text: {
          ready: 'Working', partial: 'Partly working', off: 'Not configured',
          down: 'Not responding', unknown: 'Unknown',
        }[state] || state }),
      ]),
      el('p', { class: 'small prose', text: what }),
      el('p', { class: 'small', text: detail }),
      langs.length
        ? el('p', { class: 'tiny faint', text: `Runs here: ${langs.join(', ')}.` })
        : el('p', { class: 'tiny faint', text: 'Nothing runs here at the moment.' }),
      actions ? el('div', { class: 'row', style: 'margin-top:.5rem' }, actions) : null,
    ]);

    const browserLangs = langsOn('browser');
    const hostedLangs = langsOn('hosted');
    const localLangs = langsOn('local');

    /* Hosted says "Not configured" until an address has been set AND that
       address has answered. A proxy tested on a laptop is not a deployed
       service, and this page will not pretend otherwise. */
    const hostedConfigured = !!(Store.config.hosted || {}).url;
    const hostedState = !hostedConfigured ? 'off' : hosted.up ? 'ready' : 'down';

    host.replaceChildren(
      card({
        name: 'Browser',
        what: 'Execution happens on this device, inside this browser tab. '
          + 'Nothing is installed and nothing is sent anywhere.',
        state: browserLangs.length ? 'ready' : 'off',
        detail: browserLangs.length
          ? 'Always available. It cannot compile C++ or Rust — there is no compiler in a browser.'
          : 'Unavailable, which should not happen; reload the page.',
        langs: browserLangs,
      }),

      card({
        name: 'Hosted',
        what: 'Execution happens on a remote service. No compiler, no runner and '
          + 'no installation on your computer — it works on a borrowed laptop or a phone.',
        state: hostedState,
        detail: !hostedConfigured
          ? 'Not configured. No hosted address has been set for this site, so nothing is '
            + 'being sent anywhere. See "Hosted execution" below for what it would take.'
          : hosted.up
            ? `Answering at ${(Store.config.hosted || {}).url}.`
            : `Set to ${(Store.config.hosted || {}).url}, which is not answering`
              + `${hosted.error ? ` (${hosted.error})` : ''}.`,
        langs: hostedLangs,
        actions: [el('a', { class: 'btn btn-sm', href: '#/settings' }, ['Settings'])],
      }),

      card({
        name: 'Local',
        what: 'Execution uses a small runner and the real compilers on your own '
          + 'computer. It is the fastest, and the only one that can run the '
          + 'sanitizer checks some problems require.',
        state: judge.state === 'ready' ? (localLangs.length >= 2 ? 'ready' : 'partial')
          : judge.state === 'unauthed' ? 'down'
            : judge.checked ? 'off' : 'unknown',
        detail: judge.state === 'ready'
          ? `The runner is answering at ${judge.url}.`
            + ((judge.missing || []).length
              ? ` It is missing: ${judge.missing.join(', ')}.` : '')
          : judge.state === 'unauthed'
            ? `Something is listening at ${judge.url} but it refused this page.`
            : `Nothing is listening at ${judge.url}.`,
        langs: localLangs,
        actions: [el('a', { class: 'btn btn-sm', href: '#setup-local' }, ['How to set this up'])],
      }),
    );

    void byBackend;
    return { rows, judge, hosted };
  }

  /* ---------------- the check that actually compiles something ---------------- */

  async function verify() {
    const out = $('#setupVerifyOut');
    const btn = $('#setupVerify');
    if (!out) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    out.replaceChildren(el('p', { class: 'muted small', text: 'Compiling a small program…' }));

    const lines = [];
    try {
      for (const [id, probe] of Object.entries(PROBES)) {
        const where = await Runners.backendFor(id);
        if (!where) {
          lines.push({ lang: probe.label, state: 'none',
            text: 'Nothing available can compile this.' });
          continue;
        }

        const reply = await Runners.run(id, probe.source, [{ stdin: PROBE_IN }], {});
        const label = Runners.label(reply.backend || where);

        if (reply.judgeDown) {
          lines.push({ lang: probe.label, state: 'fail',
            text: `${label}: could not run — ${reply.judgeError || 'no answer'}` });
        } else if (!reply.compile.ok) {
          lines.push({ lang: probe.label, state: 'fail',
            text: `${label}: it did not compile.`,
            detail: (reply.compile.stderr || '').trim().split('\n').slice(0, 4).join('\n') });
        } else {
          const got = ((reply.cases[0] || {}).stdout || '').trim();
          lines.push(got === PROBE_OUT
            ? { lang: probe.label, state: 'ok',
              text: `${label}: compiled, ran, and printed ${got}. This works.` }
            : { lang: probe.label, state: 'fail',
              text: `${label}: it ran on ${label} but printed "${got}" instead of ${PROBE_OUT}.`,
              detail: 'That is a working toolchain producing a wrong answer, which is '
                + 'unusual — please report it.' });
        }
      }
    } catch (err) {
      lines.push({ lang: '—', state: 'fail', text: `The check itself failed: ${err.message}` });
    }

    out.replaceChildren(el('ul', { class: 'setup-results' }, lines.map(l => el('li', {
      class: 'setup-result', 'data-state': l.state,
    }, [
      el('span', { class: 'setup-result-mark', 'aria-hidden': 'true',
        text: l.state === 'ok' ? '✓' : l.state === 'none' ? '–' : '✕' }),
      el('div', {}, [
        el('strong', { text: l.lang }),
        el('p', { class: 'small', style: 'margin:.1rem 0 0', text: l.text }),
        l.detail ? el('pre', { class: 'code-block tiny', style: 'margin:.35rem 0 0' },
          [el('code', { text: l.detail })]) : null,
      ]),
    ]))));

    const worked = lines.filter(l => l.state === 'ok').map(l => l.lang);
    out.append(worked.length
      ? el('p', { class: 'small ok-text', style: 'margin:.6rem 0 0',
        text: `${worked.join(' and ')} ${worked.length === 1 ? 'is' : 'are'} genuinely working. `
          + 'You can go and solve a coding problem.' })
      : el('p', { class: 'small danger-text', style: 'margin:.6rem 0 0',
        text: 'Nothing compiled. The section below works through why, in order.' }));

    if (btn) { btn.disabled = false; btn.textContent = 'Run the check again'; }
    paintTrouble();
  }

  /* ---------------- the local walkthrough ---------------- */

  function paintLocal() {
    const host = $('#setupLocal');
    if (!host) return;

    host.replaceChildren(el('div', { class: 'card', id: 'setup-local' }, [
      el('h2', { text: 'Setting up local execution on Windows' }),
      el('p', { class: 'small prose' }, [
        'This is the Windows path, through WSL — Windows Subsystem for Linux. ',
        'The compilers are Linux ones, which is what the problems are written against, ',
        'and it is the only way the AddressSanitizer problems work.',
      ]),
      el('p', { class: 'small prose faint' }, [
        'Ten minutes, most of it waiting for downloads. You need Windows 10 or 11 and ',
        'an administrator account for the first step only.',
      ]),

      el('ol', { class: 'setup-steps' }, [
        step(1, 'Install WSL with Ubuntu',
          el('p', { class: 'small prose', text:
            'Open PowerShell as administrator — right-click the Start button, choose '
            + '"Terminal (Admin)" — and run:' }),
          command('wsl --install -d Ubuntu'),
          el('p', { class: 'small prose', text:
            'Restart when it asks. On first launch Ubuntu asks you to invent a username '
            + 'and password; they are local to WSL and nothing else uses them.' }),
          expected('Ubuntu is already installed.\n'
            + '  …or…\n'
            + 'Installing: Ubuntu\n'
            + 'Ubuntu has been installed.\n'
            + 'The requested operation is successful.'),
          el('p', { class: 'tiny faint prose', text:
            'Already have WSL? Check it is version 2 with  wsl -l -v  — version 1 cannot '
            + 'run the sanitizers.' })),

        step(2, 'Install the compilers',
          el('p', { class: 'small prose', text:
            'Open the Ubuntu terminal (search "Ubuntu" in the Start menu) and run:' }),
          command('sudo apt update && sudo apt install -y build-essential rustc python3 nodejs util-linux',
            'build-essential brings g++; util-linux brings prlimit, which the runner uses '
            + 'to cap what a submitted program can do.'),
          expected('Setting up g++ (4:13.2.0-7ubuntu1) ...\n'
            + 'Setting up rustc (1.75.0+dfsg0ubuntu1-0ubuntu7) ...\n'
            + 'Processing triggers for man-db (2.12.0-4build2) ...')),

        step(3, 'Get the project onto your machine',
          el('p', { class: 'small prose', text:
            'If you have not already cloned it, do that from the Ubuntu terminal so the '
            + 'files live somewhere both Windows and WSL can see:' }),
          command('cd /mnt/c/Users/$USER\ngit clone https://github.com/mobeenmohammed/systems-problems.git\ncd systems-problems\nnpm install',
            'Clone it under /mnt/c so Windows can see it too. If you already have the '
            + 'folder, just cd into it.'),
          el('p', { class: 'small prose', text:
            'If you already have the repository on Windows, cd to it instead — a path '
            + 'like C:\\Users\\you\\projects\\systems-problems becomes:' }),
          command('cd /mnt/c/Users/you/projects/systems-problems')),

        step(4, 'Check the toolchain before starting anything',
          el('p', { class: 'small prose', text:
            'This compiles nothing and starts nothing. It reports what is installed and '
            + 'names the command that installs whatever is not.' }),
          command('npm run runner:check'),
          expected('  ok    node     v18.19.1\n'
            + '  ok    g++      g++ (Ubuntu 13.3.0) 13.3.0\n'
            + '  ok    rustc    rustc 1.75.0\n'
            + '  ok    python   Python 3.12.3\n'
            + '  ok    prlimit  prlimit from util-linux 2.39.3\n'
            + '  ok    sanitizers available'),
          el('p', { class: 'small prose', text:
            'A line beginning "--" instead of "ok" is something missing, and the command '
            + 'that installs it is printed underneath. Fix those before going on.' })),

        step(5, 'Start the runner',
          el('p', { class: 'small prose', text:
            'From the same folder. Leave this terminal open — closing it stops the runner.' }),
          command('npm run runner'),
          expected('------------------------------------------------------------\n'
            + '  Systems Lab runner    http://127.0.0.1:2000\n'
            + '  prlimit guards        on\n'
            + '  token                 0-oexA5ti…\n'
            + '------------------------------------------------------------\n'
            + '  ok   cpp     13.3.0\n'
            + '  ok   rust    rustc 1.75.0\n'
            + '  loopback only. never expose this to a network.'),
          el('p', { class: 'small prose', text:
            'It listens on 127.0.0.1 only — nothing outside your machine can reach it — '
            + 'and it writes a fresh single-use token on every start, which this page '
            + 'reads automatically.' })),

        step(6, 'Open the site from your own machine',
          el('p', { class: 'small prose' }, [
            'This matters, and it is the step people miss. Serve the site locally rather ',
            'than using the published address:',
          ]),
          command('npm run serve', 'In a second Ubuntu terminal, from the same folder.'),
          el('p', { class: 'small prose' }, [
            'Then open ',
            el('code', { text: 'http://127.0.0.1:8000' }),
            '. Browsers now ask permission before a page served over https may talk to '
            + 'anything on your own machine, and a page you opened from the public site '
            + 'will usually be refused. Both at 127.0.0.1 and there is no such problem.',
          ])),

        step(7, 'Prove it actually works',
          el('p', { class: 'small prose', text:
            'Come back to this page on the local copy and press "Run the check" above. '
            + 'It compiles and runs a real C++ and Rust program and checks the answer. '
            + 'Until that reports a tick, it is not set up.' })),
      ]),

      el('h3', { text: 'Stopping and restarting it' }),
      el('div', { class: 'setup-cmds' }, [
        command('npm run runner:status', 'Is it up, and does the token this page has match it?'),
        command('npm run runner:stop', 'Stops it. Ctrl+C in its own terminal does the same.'),
        command('npm run runner', 'Starts it again, with a fresh token.'),
      ]),
      el('p', { class: 'small prose faint', text:
        'A second runner cannot clobber the first: it fails on the port and says so, '
        + 'rather than overwriting the live one\'s credentials.' }),
    ]));
  }

  /* ---------------- hosted ---------------- */

  function paintHosted() {
    const host = $('#setupHosted');
    if (!host) return;
    const url = (Store.config.hosted || {}).url || '';

    host.replaceChildren(el('div', { class: 'card' }, [
      el('h2', { text: 'Hosted execution' }),
      el('p', { class: 'small prose', text:
        'Hosted execution runs your program on a server instead of your computer, which '
        + 'means a borrowed laptop, a phone, or the published site all work with nothing '
        + 'installed. It is the right answer for everyone who is not the person who '
        + 'maintains this project.' }),

      el('div', { class: 'judge-state', 'data-state': url ? 'down' : 'unchecked' }, [
        el('span', { class: 'dot' }),
        el('span', { id: 'setupHostedState', text: url
          ? `Configured at ${url}.`
          : 'Not configured. Nothing is deployed, so nothing is available.' }),
      ]),

      el('h3', { text: 'What it would take' }),
      el('p', { class: 'small prose', text:
        'The code is written and tested — a proxy that holds the execution credential '
        + 'server-side, picks the compiler flags itself rather than trusting the browser, '
        + 'and rate-limits per address. It has been exercised end to end against a local '
        + 'copy of itself. That is not the same as a deployed service, and this page will '
        + 'not call it one.' }),
      el('p', { class: 'small prose', text: 'Two things are still outstanding, and both need a decision rather than more code:' }),
      el('ol', { class: 'setup-remaining' }, [
        el('li', {}, [
          el('strong', { text: 'Somewhere to run the proxy. ' }),
          'A Cloudflare account, or any host that runs a small fetch handler. '
          + 'The free tier covers this many times over, so the likely cost is nothing, '
          + 'but the account has to exist and signing in is interactive.',
        ]),
        el('li', {}, [
          el('strong', { text: 'An execution service for it to call. ' }),
          'Judge0, in one of three forms: the free public endpoint, which works but has no '
          + 'service commitment, no authentication and no documented limits; a paid Judge0 '
          + 'Cloud plan, which is roughly €27–107 a month; or a self-hosted one, which needs '
          + 'a virtual machine that permits privileged containers.',
        ]),
      ]),
      el('p', { class: 'small prose', text:
        'Until one of those exists, the toolbar says "No runner" for C++ and Rust rather '
        + 'than guessing, and nothing is sent anywhere.' }),
      el('p', { class: 'small prose faint' }, [
        'Already have one deployed? Paste its address into ',
        el('a', { href: '#/settings' }, ['Settings ▸ Code execution ▸ Hosted runner address']),
        ' and press "Run the check" above.',
      ]),
    ]));
  }

  /* ---------------- troubleshooting, for the state you are actually in ---------------- */

  async function paintTrouble() {
    const host = $('#setupTrouble');
    if (!host) return;

    const judge = Runners.judge;
    const https = location.protocol === 'https:';
    const loopback = /127\.0\.0\.1|\[::1\]|localhost/.test(Store.config.judgeUrl || '');
    const problems = [];

    if (https && loopback && judge.state === 'down') {
      problems.push({
        title: 'This page cannot reach your own machine',
        what: 'The site is loaded over https and the runner is on a local address. '
          + 'Browsers now ask permission before an https page may talk to anything on your '
          + 'own network, and a refused or unanswered prompt looks exactly like "nothing is '
          + 'listening". If your runner is up, this is almost certainly what is happening.',
        next: 'Open the site from http://127.0.0.1:8000 instead — run  npm run serve  in '
          + 'the project folder. If your browser offered a permission prompt for local '
          + 'network access, you can allow it there instead.',
        never: 'Do not turn off your browser\'s security settings to work around this. '
          + 'Serving the site locally solves it properly and takes one command.',
      });
    }

    if (judge.state === 'down' && !https) {
      problems.push({
        title: 'Nothing is listening where the runner should be',
        what: `Nothing answered at ${judge.url}. Either it was never started, it has `
          + 'stopped, or it is on a different port.',
        next: 'Run  npm run runner:status  in the project folder. It will say whether '
          + 'anything is up and whether the token this page holds still matches it.',
      });
    }

    if (judge.state === 'unauthed') {
      problems.push({
        title: 'The runner is up but will not accept this page',
        what: 'It answered, and then refused the token. The runner writes a fresh token '
          + 'every time it starts, so the usual cause is that it was restarted while this '
          + 'page stayed open and the page is still holding the old one.',
        next: 'Reload this page. If that does not fix it, the site is probably being served '
          + 'from somewhere that cannot read the token file — run  npm run runner:status  to '
          + 'see the token, then paste it into Settings ▸ Code execution ▸ Advanced setup.',
      });
    }

    if (judge.state === 'ready' && (judge.missing || []).length) {
      problems.push({
        title: `The runner is up but has no ${judge.missing.join(' or ')}`,
        what: `It is running and this page can talk to it, but ${judge.missing.join(' and ')} `
          + 'is not installed inside WSL, so problems in that language cannot be compiled.',
        next: 'In the Ubuntu terminal:  sudo apt install -y build-essential rustc  — then '
          + 'stop the runner with  npm run runner:stop  and start it again so it rechecks.',
      });
    }

    if (!problems.length) {
      host.replaceChildren(el('div', { class: 'card' }, [
        el('h2', { text: 'Nothing is obviously wrong' }),
        el('p', { class: 'small prose', text: judge.state === 'ready'
          ? 'The runner is up and this page can reach it. If a problem still will not run, '
            + 'press "Run the check" above — it compiles a real program and will say exactly '
            + 'where it stops.'
          : 'No specific fault has been detected. Press "Run the check" above to make the '
            + 'page try for real; whatever fails will be explained here.' }),
      ]));
      return;
    }

    host.replaceChildren(el('div', { class: 'card' }, [
      el('h2', { text: 'What is wrong, and what to do' }),
      ...problems.map(p => el('div', { class: 'setup-fault' }, [
        el('h3', { text: p.title }),
        el('p', { class: 'small prose', text: p.what }),
        el('p', { class: 'small prose' }, [el('strong', { text: 'Next: ' }), p.next]),
        p.never ? el('p', { class: 'tiny warn-text prose', text: p.never }) : null,
      ])),
    ]));
  }

  /* ---------------- entry ---------------- */

  async function render() {
    paintLocal();
    paintHosted();
    const out = $('#setupVerifyOut');
    if (out) out.replaceChildren();

    const verifyBtn = $('#setupVerify');
    if (verifyBtn && !verifyBtn.dataset.wired) {
      verifyBtn.dataset.wired = '1';
      verifyBtn.addEventListener('click', verify);
    }
    const again = $('#setupRecheck');
    if (again && !again.dataset.wired) {
      again.dataset.wired = '1';
      again.addEventListener('click', async () => {
        again.disabled = true;
        await Runners.checkJudge({ force: true });
        if (typeof Hosted !== 'undefined') await Hosted.check({ force: true });
        await paintModes();
        await paintTrouble();
        again.disabled = false;
      });
    }

    await Runners.checkJudge({ force: true });
    await paintModes();
    await paintTrouble();
  }

  return { render, verify };
})();
