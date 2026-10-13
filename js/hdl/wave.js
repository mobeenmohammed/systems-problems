/* ============================================================
   hdl/wave.js — the waveform viewer.

   A canvas for the traces, ordinary DOM for everything else.
   Canvas because a 100,000-sample trace is 100,000 line
   segments and a DOM node each would be unusable; DOM for the
   signal names, the cursor readout and the controls because
   those want to be selectable, focusable and styleable.

   What it shows, and each of these is a requirement rather than
   a flourish:

     · the clock and the signals you choose, named
     · the time axis in the unit the VCD declared — not
       converted, because a testbench written in 1ns/1ps and
       reported in picoseconds is confusing in exactly the way
       a timing exercise must not be
     · a cursor you can move, with every signal's value at it
     · buses in hex or binary or decimal, switchable, and never
       as a number when any bit is x or z, because then there
       is no number
     · pan, zoom, and fit-to-trace
     · x and z drawn as themselves rather than as a guess
     · the failing check's timestamp marked, when there is one

   It renders at device pixel ratio and redraws on resize, which
   is the difference between a waveform and a blurry picture of
   one.
   ============================================================ */

const Wave = (() => {

  const LANE_H = 26;
  const LANE_GAP = 4;
  const AXIS_H = 22;
  const PAD_L = 8;
  const PAD_R = 10;

  /* A viewer instance. One per mounted waveform; the problem page
     makes and destroys them as tabs change. */
  function create(mount, doc, opts = {}) {
    const state = {
      doc,
      selected: (opts.selected && opts.selected.length)
        ? opts.selected.slice()
        : VCD.defaultSelection(doc),
      base: 'hex',
      /* The window on time, in VCD ticks. */
      t0: 0,
      t1: Math.max(1, doc.end),
      cursor: null,
      marks: (opts.marks || []).slice(),   /* [{ t, label, kind }] */
      dpr: 1,
      /* How to SAY a time. A VCD counts in its precision — picoseconds,
         usually — while the testbench, its `$time` and therefore every
         check count in its time unit. Reporting picoseconds while the
         results report nanoseconds leaves the reader doing arithmetic
         to connect the two, so when the ratio is known the viewer
         speaks the testbench's unit. */
      scale: opts.scale || { ratio: 1, unit: null },
    };

    mount.replaceChildren();
    mount.classList.add('wave');

    /* ---- the toolbar ---- */
    const bar = el('div', { class: 'wave-bar' });
    const btn = (label, title, fn, id) => {
      const b = el('button', { class: 'btn btn-sm', type: 'button', title, id }, [label]);
      b.addEventListener('click', fn);
      return b;
    };

    bar.append(
      btn('Fit', 'Show the whole trace', () => { fit(); draw(); }, 'waveFit'),
      btn('−', 'Zoom out', () => { zoom(1 / 0.6); draw(); }, 'waveOut'),
      btn('+', 'Zoom in', () => { zoom(0.6); draw(); }, 'waveIn'),
      btn('◀', 'Pan left', () => { pan(-0.25); draw(); }, 'wavePanL'),
      btn('▶', 'Pan right', () => { pan(0.25); draw(); }, 'wavePanR'),
    );

    const baseSel = el('select', { class: 'wave-base', id: 'waveBase',
      'aria-label': 'How to show buses' });
    for (const [v, label] of [['hex', 'hex'], ['bin', 'binary'], ['dec', 'decimal']]) {
      baseSel.append(el('option', { value: v, text: label }));
    }
    baseSel.value = state.base;
    baseSel.addEventListener('change', () => { state.base = baseSel.value; draw(); });
    bar.append(el('label', { class: 'wave-baselab tiny faint' }, ['Buses ', baseSel]));

    const readout = el('span', { class: 'wave-at tiny mono', id: 'waveAt' });
    bar.append(readout);

    if (opts.onDownload) {
      bar.append(btn('Download VCD', 'Save the raw waveform file', opts.onDownload, 'waveVcd'));
    }
    mount.append(bar);

    /* ---- the signal picker ---- */
    const picker = el('details', { class: 'wave-pick' }, [
      el('summary', { class: 'tiny' }, [`Signals (${state.selected.length} of ${doc.signals.length})`]),
    ]);
    const pickBody = el('div', { class: 'wave-pick-body' });
    for (const v of doc.signals) {
      if (v.kind === 'parameter') continue;
      const cb = el('input', { type: 'checkbox', value: v.id });
      cb.checked = state.selected.includes(v.id);
      cb.addEventListener('change', () => {
        state.selected = doc.order.filter(id => (
          id === v.id ? cb.checked : state.selected.includes(id)));
        picker.querySelector('summary').textContent =
          `Signals (${state.selected.length} of ${doc.signals.length})`;
        layout();
        draw();
      });
      pickBody.append(el('label', { class: 'wave-pick-row tiny', title: v.path }, [
        cb, el('span', { class: 'mono', text: v.path }),
        el('span', { class: 'faint', text: v.width > 1 ? `[${v.width}]` : '' }),
      ]));
    }
    picker.append(pickBody);
    mount.append(picker);

    /* ---- the plot ---- */
    const names = el('div', { class: 'wave-names' });
    const canvas = el('canvas', { class: 'wave-canvas', tabindex: '0',
      role: 'img', 'aria-label': 'Waveform. Use the arrow keys to move the cursor.' });
    const plot = el('div', { class: 'wave-plot' }, [names, canvas]);
    mount.append(plot);

    const cursorInfo = el('div', { class: 'wave-cursor-info' });
    mount.append(cursorInfo);

    /* ---------------- geometry ---------------- */

    /* One instant, in words. In the testbench's own unit when it is
       known, so that "wrong at t=30" and the cursor agree. */
    function sayTime(t) {
      const { ratio, unit } = state.scale;
      if (ratio && ratio !== 1 && unit) {
        const v = t / ratio;
        return `${Number.isInteger(v) ? v : v.toFixed(2)} ${unit}`;
      }
      return VCD.timeText(t, doc.timescale);
    }

    const lanes = () => state.selected.map(id => doc.vars[id]).filter(Boolean);
    const plotW = () => Math.max(50, canvas.clientWidth - PAD_L - PAD_R);
    const xOf = t => PAD_L + ((t - state.t0) / Math.max(1, state.t1 - state.t0)) * plotW();
    const tOf = x => state.t0 + ((x - PAD_L) / plotW()) * (state.t1 - state.t0);

    function layout() {
      const rows = lanes();
      const h = AXIS_H + rows.length * (LANE_H + LANE_GAP) + 4;
      canvas.style.height = `${h}px`;
      names.replaceChildren(
        el('div', { class: 'wave-name-axis' }),
        ...rows.map(v => el('div', { class: 'wave-name', title: v.path }, [
          el('span', { class: 'mono', text: v.name }),
          v.width > 1 ? el('span', { class: 'faint tiny', text: ` ${v.width}b` }) : null,
        ])),
      );
      resize();
    }

    function resize() {
      state.dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * state.dpr));
      canvas.height = Math.max(1, Math.round(h * state.dpr));
    }

    function fit() {
      state.t0 = 0;
      state.t1 = Math.max(1, doc.end);
    }

    function zoom(factor, about = null) {
      const span = state.t1 - state.t0;
      const centre = about == null ? (state.t0 + span / 2) : about;
      const next = Math.max(1, Math.min(doc.end * 4 || 1e9, span * factor));
      state.t0 = Math.max(0, centre - (centre - state.t0) * (next / span));
      state.t1 = state.t0 + next;
    }

    function pan(fraction) {
      const span = state.t1 - state.t0;
      const d = span * fraction;
      state.t0 = Math.max(0, state.t0 + d);
      state.t1 = state.t0 + span;
    }

    /* ---------------- drawing ---------------- */

    const css = name => getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim() || '#888';

    function draw() {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { dpr } = state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const dim = css('--text-faint') || '#777';
      const line = css('--border') || '#333';
      const ink = css('--text') || '#ddd';
      const accent = css('--accent') || '#6cf';
      const bad = css('--danger') || '#f66';
      const warn = css('--warn') || '#fb0';

      /* ---- the time axis ---- */
      ctx.font = '10px var(--mono, monospace)';
      ctx.textBaseline = 'top';
      ctx.strokeStyle = line;
      ctx.fillStyle = dim;
      ctx.lineWidth = 1;

      const ticks = tickTimes(state.t0, state.t1, plotW());
      ctx.beginPath();
      for (const t of ticks) {
        const x = Math.round(xOf(t)) + 0.5;
        ctx.moveTo(x, AXIS_H - 5);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
      for (const t of ticks) {
        const label = sayTime(t);
        const x = xOf(t);
        ctx.fillText(label, Math.min(w - ctx.measureText(label).width - 2, Math.max(2, x + 2)), 2);
      }

      /* ---- the lanes ---- */
      const rows = lanes();
      rows.forEach((v, i) => {
        const top = AXIS_H + i * (LANE_H + LANE_GAP);
        drawLane(ctx, v, top, ink, dim, warn, bad);
      });

      /* ---- marks: a failing check's time, when there is one ---- */
      for (const m of state.marks) {
        if (m.t < state.t0 || m.t > state.t1) continue;
        const x = Math.round(xOf(m.t)) + 0.5;
        ctx.strokeStyle = m.kind === 'fail' ? bad : warn;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, AXIS_H - 6);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = m.kind === 'fail' ? bad : warn;
        ctx.fillText(m.label || '', x + 3, AXIS_H - 12);
      }

      /* ---- the cursor ---- */
      if (state.cursor != null && state.cursor >= state.t0 && state.cursor <= state.t1) {
        const x = Math.round(xOf(state.cursor)) + 0.5;
        ctx.strokeStyle = accent;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      paintReadout();
    }

    function drawLane(ctx, v, top, ink, dim, warn, bad) {
      const hi = top + 4;
      const lo = top + LANE_H - 2;
      const mid = (hi + lo) / 2;
      const w = canvas.clientWidth;

      /* Every change inside the window, plus the value carried in from
         before it. */
      const ch = v.changes;
      let i = 0;
      while (i < ch.length && ch[i][0] <= state.t0) i += 1;
      let value = i > 0 ? ch[i - 1][1] : null;
      let t = state.t0;

      ctx.lineWidth = 1.4;
      ctx.textBaseline = 'middle';

      const segment = (from, to, val) => {
        const x0 = xOf(from);
        const x1 = Math.min(w - 1, xOf(to));
        if (x1 <= x0) return;
        const bits = VCD.pad(val == null ? 'x' : val, v.width);

        if (v.width === 1) {
          const unknown = VCD.hasUnknown(bits);
          ctx.strokeStyle = unknown ? (bits[0] === 'z' ? warn : bad) : ink;
          const y = unknown ? mid : (bits === '1' ? hi : lo);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          if (unknown) {
            /* x and z are not a level. Drawn as a band so they cannot
               be mistaken for either. */
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = bits[0] === 'z' ? warn : bad;
            ctx.fillRect(x0, hi, x1 - x0, lo - hi);
            ctx.globalAlpha = 1;
          }
          return;
        }

        /* A bus: a hexagon with the value in it, and the value only
           when it fits. */
        const unknown = VCD.hasUnknown(bits);
        ctx.strokeStyle = unknown ? bad : ink;
        const k = Math.min(4, (x1 - x0) / 2);
        ctx.beginPath();
        ctx.moveTo(x0, mid);
        ctx.lineTo(x0 + k, hi);
        ctx.lineTo(x1 - k, hi);
        ctx.lineTo(x1, mid);
        ctx.lineTo(x1 - k, lo);
        ctx.lineTo(x0 + k, lo);
        ctx.closePath();
        ctx.stroke();
        if (unknown) {
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = bad;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const text = VCD.format(bits, v.width, state.base);
        const room = x1 - x0 - 8;
        if (room > 12) {
          ctx.fillStyle = dim;
          const shown = ctx.measureText(text).width <= room
            ? text
            : (ctx.measureText('…').width < room ? '…' : '');
          if (shown) ctx.fillText(shown, x0 + (x1 - x0 - ctx.measureText(shown).width) / 2, mid);
        }
      };

      for (; i < ch.length && ch[i][0] <= state.t1; i += 1) {
        segment(t, ch[i][0], value);
        t = ch[i][0];
        value = ch[i][1];
      }
      segment(t, state.t1, value);
    }

    function paintReadout() {
      const t = state.cursor;
      if (t == null) {
        readout.textContent = '';
        cursorInfo.replaceChildren(el('span', { class: 'tiny faint',
          text: 'Click the waveform to put a cursor on it; the arrow keys move it.' }));
        return;
      }
      readout.textContent = `t = ${sayTime(t)}`;
      cursorInfo.replaceChildren(...lanes().map(v => {
        const raw = VCD.valueAt(v, t);
        const shown = VCD.format(raw, v.width, state.base);
        return el('span', { class: 'wave-val tiny' }, [
          el('span', { class: 'mono faint', text: `${v.name} ` }),
          el('b', { class: 'mono', 'data-unknown': VCD.hasUnknown(shown) ? 'true' : undefined,
            text: shown === '' ? '—' : shown }),
        ]);
      }));
    }

    /* ---------------- interaction ---------------- */

    canvas.addEventListener('click', e => {
      const box = canvas.getBoundingClientRect();
      state.cursor = Math.max(0, Math.round(tOf(e.clientX - box.left)));
      canvas.focus();
      draw();
    });

    /* The wheel zooms about the pointer only with a modifier, and pans
       otherwise — the same bargain the Learn graph makes, and for the
       same reason: a two-finger scroll that silently rescales is the
       most complained-about behaviour a plot can have. */
    canvas.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const box = canvas.getBoundingClientRect();
        zoom(Math.exp(e.deltaY * 0.0015), tOf(e.clientX - box.left));
        draw();
        return;
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        pan(e.deltaX / plotW());
        draw();
      }
      /* A plain vertical wheel is left alone, so the page can scroll
         past the waveform. */
    }, { passive: false });

    /* Drag to pan. */
    let drag = null;
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !e.shiftKey) return;
      drag = { x: e.clientX, t0: state.t0, t1: state.t1 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      const span = drag.t1 - drag.t0;
      const d = ((drag.x - e.clientX) / plotW()) * span;
      state.t0 = Math.max(0, drag.t0 + d);
      state.t1 = state.t0 + span;
      draw();
    });
    const endDrag = () => { drag = null; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('keydown', e => {
      const span = state.t1 - state.t0;
      const step = Math.max(1, Math.round(span / 100));
      const keys = {
        ArrowLeft: () => { state.cursor = Math.max(0, (state.cursor ?? state.t0) - step); },
        ArrowRight: () => { state.cursor = Math.min(doc.end, (state.cursor ?? state.t0) + step); },
        Home: () => { state.cursor = 0; },
        End: () => { state.cursor = doc.end; },
        '+': () => zoom(0.6),
        '=': () => zoom(0.6),
        '-': () => zoom(1 / 0.6),
        f: () => fit(),
      };
      const fn = keys[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
      /* Keep the cursor in view: moving it off the edge and leaving the
         window behind is how a keyboard user loses it. */
      if (state.cursor != null) {
        if (state.cursor < state.t0) { const s = state.t1 - state.t0; state.t0 = state.cursor; state.t1 = state.t0 + s; }
        if (state.cursor > state.t1) { const s = state.t1 - state.t0; state.t1 = state.cursor; state.t0 = Math.max(0, state.t1 - s); }
      }
      draw();
    });

    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!canvas.isConnected) return;
        resize();
        draw();
      }, 60);
    };
    window.addEventListener('resize', onResize);

    layout();
    fit();
    /* The cursor starts where it was asked to, or on the first
       interesting instant when there is one — a failing check's time,
       if a mark says so. `opts.cursor` is a click on a check in the
       results, which is the more specific request and wins. */
    const failMark = state.marks.find(m => m.kind === 'fail');
    const startAt = opts.cursor != null ? opts.cursor : (failMark ? failMark.t : null);
    if (startAt != null) {
      state.cursor = startAt;
      if (doc.end > 0) {
        const span = Math.max(1, Math.round(doc.end / 4));
        state.t0 = Math.max(0, startAt - span / 2);
        state.t1 = state.t0 + span;
      }
    }
    draw();

    return {
      draw,
      destroy() {
        window.removeEventListener('resize', onResize);
        clearTimeout(resizeTimer);
      },
      /* For the tests: the state a human would read off the screen. */
      peek: () => ({
        t0: state.t0, t1: state.t1, cursor: state.cursor,
        base: state.base, selected: state.selected.slice(),
      }),
      setCursor(t) { state.cursor = t; draw(); },
      fitAll() { fit(); draw(); },
    };
  }

  /* Axis ticks: at most one every 70 pixels, on a 1/2/5 × 10^n step so
     the labels are round numbers. */
  function tickTimes(t0, t1, width) {
    const want = Math.max(2, Math.floor(width / 70));
    const raw = (t1 - t0) / want;
    const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
    const step = [1, 2, 5, 10].find(m => m * mag >= raw) * mag;
    const out = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
    return out;
  }

  /* The same tiny element helper the problem types use. Taken from the
     registry so there is one of it. */
  function el(tag, props = {}, kids = []) {
    return ProblemTypes.el(tag, props, kids);
  }

  return { create, tickTimes };
})();
