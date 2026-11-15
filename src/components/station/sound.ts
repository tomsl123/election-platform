// Every sound in the booth is synthesised in the browser; there are no audio files.
// Ported from design/previews/shared.js. Silent until the voter's first gesture.

const KEY = "ps-sound";

function stored(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v !== "off";
    // Quiet by default for people who asked their system for less motion.
    return !matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

type ToneOpts = { at?: number; type?: OscillatorType; to?: number; vol?: number; attack?: number };
type NoiseOpts = { at?: number; vol?: number; f?: number; to?: number; q?: number; type?: BiquadFilterType };

class Sfx {
  on = typeof window === "undefined" ? false : stored();
  private ctx: AudioContext | null = null;

  setOn(v: boolean) {
    this.on = v;
    try {
      localStorage.setItem(KEY, v ? "on" : "off");
    } catch {
      /* private mode */
    }
  }

  private ac(): AudioContext | null {
    if (!this.on || typeof window === "undefined") return null;
    try {
      this.ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      return null;
    }
    return this.ctx;
  }

  tone(f: number, d = 0.12, o: ToneOpts = {}) {
    const c = this.ac();
    if (!c) return;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + d + 0.03);
  }

  noise(d = 0.1, o: NoiseOpts = {}) {
    const c = this.ac();
    if (!c) return;
    const t = c.currentTime + (o.at || 0);
    const n = Math.ceil(c.sampleRate * d);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    const fl = c.createBiquadFilter();
    const g = c.createGain();
    src.buffer = buf;
    fl.type = o.type || "bandpass";
    fl.frequency.setValueAtTime(o.f || 2000, t);
    if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + d);
    fl.Q.value = o.q || 1;
    g.gain.setValueAtTime(o.vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(fl).connect(g).connect(c.destination);
    src.start(t);
  }

  tick() { this.noise(0.03, { vol: 0.25, f: 3500, q: 2 }); }
  click() { this.tone(900, 0.04, { type: "square", vol: 0.05 }); this.noise(0.025, { vol: 0.2, f: 5000 }); }
  thud() { this.tone(110, 0.2, { to: 48, vol: 0.5 }); this.noise(0.08, { vol: 0.3, f: 320, type: "lowpass" }); }
  clunk() { this.tone(180, 0.1, { type: "square", to: 70, vol: 0.14 }); this.noise(0.06, { vol: 0.35, f: 900 }); this.tone(90, 0.22, { to: 45, vol: 0.35, at: 0.03 }); }
  paper() { this.noise(0.24, { vol: 0.12, f: 5200, q: 0.6, to: 2400 }); }
  scratch() { this.noise(0.08, { vol: 0.06, f: 3800, q: 3 }); }
  bell() { [880, 1320, 1778].forEach((f, i) => this.tone(f, 1.4, { vol: 0.14 / (i + 1) })); }
  ding() { this.tone(1568, 0.6, { vol: 0.18 }); this.tone(2349, 0.45, { vol: 0.07 }); }
  buzz() { this.tone(110, 0.2, { type: "sawtooth", vol: 0.1 }); }
  pop() { this.tone(420, 0.09, { to: 120, vol: 0.3 }); }
  tear() { this.noise(0.4, { vol: 0.28, f: 2600, q: 0.7, to: 1200 }); }
}

export const sfx = new Sfx();
