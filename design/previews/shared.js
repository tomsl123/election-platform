/* Shared kit for the design studies: the demo election, synthesised sound,
   gesture helpers and the small navigation pill. No dependencies. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ── The demo sitting: three points on one visit ─────────────────────── */
  const election = {
    org: "United States of Free Cliffs",
    short: "USFC",
    name: "Federal Polling Day",
    date: "15 · XI · 2026",
    place: "Cliffside Acres",
    points: [
      {
        id: "pm", kind: "single", max: 1, no: 1, title: "Prime Minister", ask: "Mark one",
        options: [
          { id: "rev", name: "Revolucionez", full: "Gen. Revolucionez", party: "UPSF", color: "#c22a2a", sym: "star" },
          { id: "bld", name: "Builderswartz", full: "Rev. Builderswartz", party: "CUP", color: "#2456a6", sym: "tower" },
          { id: "sim", name: "Simons", full: "Prof. Simons", party: "CA", color: "#d99a12", sym: "sun" },
          { id: "pla", name: "Planovsky", full: "Zeman Planovsky", party: "KKKK", color: "#2f7d55", sym: "bolt" },
        ],
      },
      {
        id: "ref", kind: "yesno", max: 1, no: 2, title: "Referendum", ask: "Hold the Senate elections again?",
        options: [
          { id: "yes", name: "Yes", full: "Yes", party: "", color: "#2f7d55", sym: "yes" },
          { id: "no", name: "No", full: "No", party: "", color: "#b3261e", sym: "no" },
        ],
      },
      {
        id: "jk", kind: "multi", max: 2, no: 3, title: "JK Days host", ask: "Mark up to two",
        options: [
          { id: "dead", name: "Dead End", full: "Dead End Cliff", party: "", color: "#6c4fa3", sym: "mountain" },
          { id: "snow", name: "Snowbelle", full: "Snowbelle Cliff", party: "", color: "#3c8fb5", sym: "snow" },
          { id: "sand", name: "Eternal Sand", full: "Eternal Sand Cliff", party: "", color: "#c9792b", sym: "dune" },
          { id: "step", name: "Endless Steppe", full: "Endless Steppe Cliff", party: "", color: "#6f8f2f", sym: "grass" },
        ],
      },
    ],
  };

  /* ── Wordless marks for every option, so ballots need almost no text ──── */
  const S = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
  const SYM = {
    star: '<path d="M12 2.2l2.8 6.3 6.8.7-5.1 4.6 1.5 6.7L12 17l-6 3.5 1.5-6.7-5.1-4.6 6.8-.7z"/>',
    tower: '<path d="M6 21.5V10H5V4.5h2.6v2h2.1v-2h4.6v2h2.1v-2H19V10h-1v11.5h-4.3V17a1.7 1.7 0 00-3.4 0v4.5z"/>',
    sun: `<circle cx="12" cy="12" r="4.6"/><path ${S} d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4M4.8 4.8l2.4 2.4M16.8 16.8l2.4 2.4M4.8 19.2l2.4-2.4M16.8 7.2l2.4-2.4"/>`,
    bolt: '<path d="M13.8 1.8L4.6 13.6h5.6L9 22.2l10.4-12.6h-5.8z"/>',
    yes: `<path ${S} stroke-width="3.2" d="M4.5 12.8l5 5 10-11.2"/>`,
    no: `<path ${S} stroke-width="3.2" d="M6 6l12 12M18 6L6 18"/>`,
    mountain: '<path d="M1.8 20.5L9 6.5l3.8 6.4 2.6-3.6 6.8 11.2z"/>',
    snow: `<path ${S} d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8M9.6 4.2L12 6.4l2.4-2.2M9.6 19.8l2.4-2.2 2.4 2.2"/>`,
    dune: '<circle cx="17.6" cy="6.4" r="2.8"/><path d="M1.8 20.5c4.2-8 7.4-8 10.4-3.4 2.2-4.2 5.4-5.2 10 3.4z"/>',
    grass: `<path ${S} d="M5 21c0-6 1-9.5 3.2-12.5M12 21V5.5M19 21c0-6-1-9.5-3.2-12.5M8.6 21c0-3 .5-5 1.4-7M15.4 21c0-3-.5-5-1.4-7"/>`,
  };
  const sym = (name, cls = "") => `<svg class="sym ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SYM[name] || ""}</svg>`;

  /* The federal crest, simplified from the USFC arms: shield, serpent ring, crab, tree. */
  const crest = (cls = "") => `<svg class="crest ${cls}" viewBox="0 0 100 116" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 8h84v52c0 26-20 40-42 50C28 100 8 86 8 60z"/>
    <circle cx="50" cy="47" r="24" stroke-width="2.6" stroke-dasharray="3.4 2.4"/>
    <ellipse cx="50" cy="50" rx="11" ry="8" fill="currentColor" stroke="none"/>
    <path d="M40 46c-7-2-10-8-6-13 1 4 4 7 8 8M60 46c7-2 10-8 6-13-1 4-4 7-8 8"/>
    <path stroke-width="2" d="M40 54l-7 4M41 57l-5 6M60 54l7 4M59 57l5 6"/>
    <path stroke-width="2.6" d="M50 78v19M50 85l-8-6M50 85l8-6M50 92l-6-4M50 92l6-4"/>
  </svg>`;

  /* ── Sound: everything is synthesised, no audio files ─────────────────── */
  const sfx = {
    on: (() => { try { return localStorage.getItem("ep-sound") !== "off"; } catch { return true; } })(),
    ctx: null,
    ac() {
      if (!this.on) return null;
      try {
        this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch { return null; }
      return this.ctx;
    },
    tone(f, d = 0.12, o = {}) {
      const c = this.ac(); if (!c) return;
      const t = c.currentTime + (o.at || 0), osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g).connect(c.destination); osc.start(t); osc.stop(t + d + 0.03);
    },
    noise(d = 0.1, o = {}) {
      const c = this.ac(); if (!c) return;
      const t = c.currentTime + (o.at || 0), n = Math.ceil(c.sampleRate * d);
      const buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; fl.type = o.type || "bandpass";
      fl.frequency.setValueAtTime(o.f || 2000, t);
      if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + d);
      fl.Q.value = o.q || 1;
      g.gain.setValueAtTime(o.vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      src.connect(fl).connect(g).connect(c.destination); src.start(t);
    },
    tick() { this.noise(0.03, { vol: 0.25, f: 3500, q: 2 }); },
    click() { this.tone(900, 0.04, { type: "square", vol: 0.05 }); this.noise(0.025, { vol: 0.2, f: 5000 }); },
    thud() { this.tone(110, 0.2, { to: 48, vol: 0.5 }); this.noise(0.08, { vol: 0.3, f: 320, type: "lowpass" }); },
    clunk() { this.tone(180, 0.1, { type: "square", to: 70, vol: 0.14 }); this.noise(0.06, { vol: 0.35, f: 900 }); this.tone(90, 0.22, { to: 45, vol: 0.35, at: 0.03 }); },
    paper() { this.noise(0.24, { vol: 0.12, f: 5200, q: 0.6, to: 2400 }); },
    scratch() { this.noise(0.08, { vol: 0.06, f: 3800, q: 3 }); },
    bell() { [880, 1320, 1778].forEach((f, i) => this.tone(f, 1.4, { vol: 0.14 / (i + 1) })); },
    ding() { this.tone(1568, 0.6, { vol: 0.18 }); this.tone(2349, 0.45, { vol: 0.07 }); },
    whoosh() { this.noise(0.75, { vol: 0.3, f: 280, to: 3400, q: 1.2 }); },
    ratchet(n = 6, gap = 0.045) { for (let i = 0; i < n; i++) this.noise(0.02, { vol: 0.3, f: 2500, q: 4, at: i * gap }); },
    coin() { this.tone(1318, 0.07, { type: "square", vol: 0.07 }); this.tone(1760, 0.3, { type: "square", vol: 0.07, at: 0.07 }); },
    pop() { this.tone(420, 0.09, { to: 120, vol: 0.3 }); },
    buzz() { this.tone(110, 0.2, { type: "sawtooth", vol: 0.1 }); },
    hiss() { this.noise(0.5, { vol: 0.12, f: 6000, q: 0.5 }); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: "triangle", vol: 0.14, at: i * 0.12 })); },
  };

  /* ── Gestures ─────────────────────────────────────────────────────────── */
  function drag(el, o) {
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => {
      if (o.when && !o.when(e)) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      const x0 = e.clientX, y0 = e.clientY; let moved = false;
      o.start?.(e);
      const mv = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (Math.hypot(dx, dy) > 7) moved = true;
        o.move?.(dx, dy, ev);
      };
      const up = (ev) => {
        el.removeEventListener("pointermove", mv);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        o.end?.(ev.clientX - x0, ev.clientY - y0, ev, moved);
      };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
  }
  const over = (target, x, y, pad = 0) => {
    const r = target.getBoundingClientRect();
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  };
  const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };

  /* Freehand ink on a canvas. A tap (almost no movement) is reported as such,
     so every design can offer "draw it yourself, or tap and it is drawn". */
  function ink(canvas, o = {}) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    /* Layout size, not the on-screen box: sheets are often mid-animation when their pads are made. */
    const fit = () => { canvas.width = Math.max(1, canvas.offsetWidth * dpr); canvas.height = Math.max(1, canvas.offsetHeight * dpr); };
    fit();
    const g = canvas.getContext("2d");
    let len = 0, last = null, at = 0;
    const seg = (a, b) => {
      g.strokeStyle = o.color || "#223"; g.lineCap = "round";
      g.lineWidth = (o.width || 4) * dpr * rnd(0.8, 1.2); g.globalAlpha = o.alpha ?? 0.9;
      g.beginPath(); g.moveTo(a.x * dpr, a.y * dpr); g.lineTo(b.x * dpr, b.y * dpr); g.stroke();
    };
    const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / dpr / r.width), y: (e.clientY - r.top) * (canvas.height / dpr / r.height) }; };
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => {
      if (o.when && !o.when()) return;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      last = pt(e); at = len;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!last) return;
      const p = pt(e), d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < 1.5) return;
      seg(last, p); len += d; last = p;
      if (Math.random() < 0.3) sfx.scratch();
    });
    const up = () => { if (!last) return; last = null; o.done?.(len - at, len); };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return {
      fit,
      clear() { g.clearRect(0, 0, canvas.width, canvas.height); len = 0; },
      get length() { return len; },
      async auto(kind = "x") {
        const w = canvas.width / dpr, h = canvas.height / dpr;
        const strokes = kind === "x"
          ? [[{ x: w * 0.2, y: h * 0.2 }, { x: w * 0.8, y: h * 0.82 }], [{ x: w * 0.82, y: h * 0.18 }, { x: w * 0.2, y: h * 0.8 }]]
          : [[{ x: w * 0.14, y: h * 0.52 }, { x: w * 0.4, y: h * 0.8 }], [{ x: w * 0.4, y: h * 0.8 }, { x: w * 0.88, y: h * 0.16 }]];
        for (const [a, b] of strokes) {
          let p = a;
          for (let i = 1; i <= 9; i++) {
            const t = i / 9, q = { x: a.x + (b.x - a.x) * t + rnd(-1, 1), y: a.y + (b.y - a.y) * t + rnd(-1, 1) };
            seg(p, q); p = q;
            if (i % 3 === 0) sfx.scratch();
            if (!reduced) await wait(15);
          }
          await wait(50);
        }
        len += w * 2;
      },
    };
  }

  /* Deep clone that also copies what has been drawn on canvases. */
  function cloneDrawn(el) {
    const c = el.cloneNode(true), a = $$("canvas", el), b = $$("canvas", c);
    a.forEach((cv, i) => { try { b[i].getContext("2d").drawImage(cv, 0, 0); } catch {} });
    return c;
  }

  /* Selection rule shared by every design: single replaces, multi is capped. */
  function choose(sel, p, id) {
    const cur = (sel[p.id] ||= []), i = cur.indexOf(id);
    if (i >= 0) { cur.splice(i, 1); return { on: false, off: [id] }; }
    if (p.max > 1 && cur.length >= p.max) return { on: false, full: true, off: [] };
    const off = p.max === 1 ? cur.splice(0) : [];
    cur.push(id);
    return { on: true, off };
  }

  const code = () => {
    const a = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
    return [0, 1, 2].map(() => Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join("")).join("-");
  };

  /* ── The pill in the corner: back to the gallery, start again, sound ──── */
  function chrome(o) {
    const st = document.createElement("style");
    st.textContent = `.ep-bar{position:fixed;left:10px;top:10px;z-index:9999;display:flex;gap:2px;align-items:center;font:600 12px/1 system-ui,sans-serif;padding:4px;border-radius:999px;background:rgba(14,14,14,.7);color:#fff;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 2px 10px rgba(0,0,0,.3);opacity:.55;transition:opacity .2s}
.ep-bar:hover,.ep-bar:focus-within{opacity:1}
.ep-bar a,.ep-bar button{all:unset;cursor:pointer;width:26px;height:26px;display:grid;place-items:center;border-radius:50%;font-size:14px}
.ep-bar a:hover,.ep-bar button:hover{background:rgba(255,255,255,.18)}
.ep-bar a:focus-visible,.ep-bar button:focus-visible{outline:2px solid #fff}
.ep-bar b{padding:0 4px 0 6px;letter-spacing:.04em}.ep-bar span{padding-right:8px;font-weight:500;opacity:.8;white-space:nowrap}
.ep-bar .off{opacity:.35;text-decoration:line-through}
@media (max-width:520px){.ep-bar span{display:none}}`;
    document.head.append(st);
    const bar = document.createElement("nav");
    bar.className = "ep-bar"; bar.setAttribute("aria-label", "Design study");
    bar.innerHTML = `<a href="index.html" title="All designs" aria-label="All designs">&#9666;</a><b>${o.code}</b><span>${o.name}</span><button data-r title="Start again" aria-label="Start again">&#8635;</button><button data-s title="Sound" aria-label="Sound">&#9834;</button>`;
    document.body.append(bar);
    $("[data-r]", bar).onclick = () => location.reload();
    const s = $("[data-s]", bar);
    const paint = () => s.classList.toggle("off", !sfx.on);
    s.onclick = () => { sfx.on = !sfx.on; try { localStorage.setItem("ep-sound", sfx.on ? "on" : "off"); } catch {} paint(); if (sfx.on) sfx.click(); };
    paint();
  }

  window.EP = { $, $$, wait, reduced, rnd, election, sym, crest, sfx, drag, over, centre, ink, cloneDrawn, choose, code, chrome };
})();
