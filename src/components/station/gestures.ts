// Framework-free gesture helpers used from effects: dragging, freehand ink, hit tests.
// Ported from design/previews/shared.js.
import { sfx } from "./sound";

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const reducedMotion = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export type DragOpts = {
  when?: (e: PointerEvent) => boolean;
  start?: (e: PointerEvent) => void;
  move?: (dx: number, dy: number, e: PointerEvent) => void;
  end?: (dx: number, dy: number, e: PointerEvent, moved: boolean) => void;
};

/** Pointer dragging with capture. Returns a function that removes the listener. */
export function drag(el: HTMLElement, o: DragOpts): () => void {
  el.style.touchAction = "none";
  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (o.when && !o.when(e)) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    o.start?.(e);
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (Math.hypot(dx, dy) > 7) moved = true;
      o.move?.(dx, dy, ev);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", mv);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      o.end?.(ev.clientX - x0, ev.clientY - y0, ev, moved);
    };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  el.addEventListener("pointerdown", down);
  return () => el.removeEventListener("pointerdown", down);
}

export function over(target: Element, x: number, y: number, pad = 0): boolean {
  const r = target.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

export function centre(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
}

export type InkPad = {
  fit(): void;
  clear(): void;
  readonly length: number;
  auto(kind?: "x" | "tick"): Promise<void>;
  digit(n: number): Promise<void>;
  destroy(): void;
};

/**
 * Freehand ink on a canvas. A tap (almost no movement) is reported as such, so every
 * mark can be drawn by hand or drawn for the voter with a tap.
 */
export function ink(canvas: HTMLCanvasElement, o: { color?: string; width?: number; alpha?: number; when?: () => boolean; done?: (drew: number, total: number) => void } = {}): InkPad {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Layout size, not the on-screen box: papers are often mid-animation when their pads are made.
  const fit = () => {
    canvas.width = Math.max(1, canvas.offsetWidth * dpr);
    canvas.height = Math.max(1, canvas.offsetHeight * dpr);
  };
  fit();
  const g = canvas.getContext("2d")!;
  let len = 0;
  let last: { x: number; y: number } | null = null;
  let at = 0;
  const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    g.strokeStyle = o.color || "#2c2c30";
    g.lineCap = "round";
    g.lineWidth = (o.width || 3.4) * dpr * rnd(0.8, 1.2);
    g.globalAlpha = o.alpha ?? 0.85;
    g.beginPath();
    g.moveTo(a.x * dpr, a.y * dpr);
    g.lineTo(b.x * dpr, b.y * dpr);
    g.stroke();
  };
  const pt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / dpr / r.width), y: (e.clientY - r.top) * (canvas.height / dpr / r.height) };
  };
  canvas.style.touchAction = "none";
  const down = (e: PointerEvent) => {
    if (o.when && !o.when()) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    last = pt(e);
    at = len;
  };
  const move = (e: PointerEvent) => {
    if (!last) return;
    const p = pt(e);
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < 1.5) return;
    seg(last, p);
    len += d;
    last = p;
    if (Math.random() < 0.3) sfx.scratch();
  };
  const up = () => {
    if (!last) return;
    last = null;
    o.done?.(len - at, len);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  async function strokes(list: Array<Array<{ x: number; y: number }>>) {
    const fast = reducedMotion();
    for (const path of list) {
      let p = path[0];
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1];
        const b = path[k];
        for (let i = 1; i <= 5; i++) {
          const t = i / 5;
          const q = { x: a.x + (b.x - a.x) * t + rnd(-0.8, 0.8), y: a.y + (b.y - a.y) * t + rnd(-0.8, 0.8) };
          seg(p, q);
          p = q;
          if (i % 3 === 0) sfx.scratch();
          if (!fast) await wait(14);
        }
      }
      await wait(fast ? 0 : 40);
    }
  }

  return {
    fit,
    clear() {
      g.clearRect(0, 0, canvas.width, canvas.height);
      len = 0;
    },
    get length() {
      return len;
    },
    async auto(kind = "x") {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const list =
        kind === "x"
          ? [
              [{ x: w * 0.2, y: h * 0.2 }, { x: w * 0.8, y: h * 0.82 }],
              [{ x: w * 0.82, y: h * 0.18 }, { x: w * 0.2, y: h * 0.8 }],
            ]
          : [[{ x: w * 0.14, y: h * 0.52 }, { x: w * 0.4, y: h * 0.8 }, { x: w * 0.88, y: h * 0.16 }]];
      await strokes(list);
      len += w * 2;
    },
    /** Writes a digit 1-9 (and 10+ as two strokes of digits) in pencil, for ranked papers. */
    async digit(n: number) {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const text = String(n);
      const cw = Math.min(w * 0.36, h * 0.36);
      const total = cw * text.length + cw * 0.2 * (text.length - 1);
      let x0 = (w - total) / 2;
      const top = h * 0.24;
      const bot = h * 0.76;
      const mid = (top + bot) / 2;
      for (const ch of text) {
        const L = x0;
        const R = x0 + cw;
        const C = (L + R) / 2;
        const shapes: Record<string, Array<Array<{ x: number; y: number }>>> = {
          "0": [[{ x: C, y: top }, { x: R, y: mid - 2 }, { x: R, y: mid + 2 }, { x: C, y: bot }, { x: L, y: mid + 2 }, { x: L, y: mid - 2 }, { x: C, y: top }]],
          "1": [[{ x: L + cw * 0.2, y: top + 6 }, { x: C + 2, y: top }, { x: C + 2, y: bot }]],
          "2": [[{ x: L, y: top + 6 }, { x: C, y: top }, { x: R, y: top + 8 }, { x: L, y: bot }, { x: R, y: bot }]],
          "3": [[{ x: L, y: top }, { x: R, y: top }, { x: C, y: mid }, { x: R, y: mid + 6 }, { x: C, y: bot }, { x: L, y: bot - 4 }]],
          "4": [[{ x: R - 4, y: bot }, { x: R - 4, y: top }, { x: L, y: mid + 6 }, { x: R + 2, y: mid + 6 }]],
          "5": [[{ x: R, y: top }, { x: L, y: top }, { x: L, y: mid }, { x: R, y: mid + 4 }, { x: C, y: bot }, { x: L, y: bot - 4 }]],
          "6": [[{ x: R, y: top }, { x: L, y: mid }, { x: L, y: bot }, { x: R, y: bot }, { x: R, y: mid }, { x: L, y: mid }]],
          "7": [[{ x: L, y: top }, { x: R, y: top }, { x: C - 2, y: bot }]],
          "8": [[{ x: C, y: mid }, { x: L, y: top + 4 }, { x: C, y: top }, { x: R, y: top + 4 }, { x: L, y: bot - 4 }, { x: C, y: bot }, { x: R, y: bot - 4 }, { x: C, y: mid }]],
          "9": [[{ x: R, y: mid }, { x: L, y: mid }, { x: L, y: top }, { x: R, y: top }, { x: R, y: bot }]],
        };
        await strokes(shapes[ch] ?? []);
        x0 = R + cw * 0.2;
      }
      len += w;
    },
    destroy() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}

/** Deep clone that also copies what has been drawn on canvases. */
export function cloneDrawn(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  const a = el.querySelectorAll("canvas");
  const b = c.querySelectorAll("canvas");
  a.forEach((cv, i) => {
    try {
      b[i].getContext("2d")!.drawImage(cv, 0, 0);
    } catch {
      /* tainted or empty */
    }
  });
  return c;
}
