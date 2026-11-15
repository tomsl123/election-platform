"use client";
// The three kinds of mark a voter makes on a paper: a cross, a number, a score.
import { useEffect, useRef, type MutableRefObject } from "react";
import { ink, type InkPad } from "./gestures";
import { sfx } from "./sound";

type Result = "on" | "off" | "full" | "ignored";

function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

function rub(canvas: HTMLCanvasElement, pad: InkPad) {
  canvas.classList.add("rub");
  setTimeout(() => {
    pad.clear();
    canvas.classList.remove("rub");
  }, 260);
}

/** A box to cross: draw the cross yourself, or tap and the pencil draws it. */
export function CrossBox({ marked, label, onMark, busy, kind = "x" }: { marked: boolean; label: string; onMark: (byHand: boolean) => Result; busy: MutableRefObject<boolean>; kind?: "x" | "tick" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<InkPad | null>(null);
  const markedRef = useLatest(marked);
  const onMarkRef = useLatest(onMark);

  async function handle(byHand: boolean) {
    const pad = padRef.current;
    if (!pad || busy.current) return;
    if (markedRef.current) {
      if (byHand) return; // drawing over a cross changes nothing
      onMarkRef.current(false);
      sfx.paper();
      return;
    }
    const r = onMarkRef.current(byHand);
    if (r !== "on") {
      pad.clear();
      return;
    }
    if (!byHand) {
      busy.current = true;
      pad.clear();
      await pad.auto(kind);
      busy.current = false;
    }
  }
  const handleRef = useLatest(handle);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pad = ink(canvas, { color: "#2c2c30", width: 3.4, alpha: 0.85, when: () => !busy.current, done: (drew) => void handleRef.current(drew > 26) });
    padRef.current = pad;
    const onResize = () => {
      if (pad.length === 0) pad.fit();
    };
    addEventListener("resize", onResize);
    return () => {
      pad.destroy();
      removeEventListener("resize", onResize);
    };
  }, [busy, handleRef]);

  // Changes made elsewhere: another box took the cross, or the keyboard set it.
  useEffect(() => {
    const pad = padRef.current;
    const canvas = canvasRef.current;
    if (!pad || !canvas) return;
    if (!marked && pad.length > 0) rub(canvas, pad);
    else if (marked && pad.length === 0 && !busy.current) {
      busy.current = true;
      void pad.auto(kind).then(() => (busy.current = false));
    }
  }, [marked, busy, kind]);

  return (
    <span
      className="box"
      role="checkbox"
      aria-checked={marked}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          void handle(false);
        }
      }}
    >
      <canvas ref={canvasRef} />
    </span>
  );
}

/** A box to number: each box tapped takes the next number; tapping a numbered box rubs it and every later one out. */
export function RankBox({ rank, label, onMark, busy }: { rank: number | null; label: string; onMark: () => Result; busy: MutableRefObject<boolean> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<InkPad | null>(null);
  const drawn = useRef<number | null>(null);
  const onMarkRef = useLatest(onMark);

  useEffect(() => {
    const canvas = canvasRef.current!;
    // Any stroke counts as a tap: the pencil writes the number neatly.
    const pad = ink(canvas, { when: () => !busy.current, done: () => {
      pad.clear();
      if (!busy.current) onMarkRef.current();
    } });
    padRef.current = pad;
    return () => pad.destroy();
  }, [busy, onMarkRef]);

  useEffect(() => {
    const pad = padRef.current;
    const canvas = canvasRef.current;
    if (!pad || !canvas) return;
    if (rank === null) {
      if (drawn.current !== null) rub(canvas, pad);
      drawn.current = null;
      return;
    }
    if (drawn.current === rank) return;
    drawn.current = rank;
    busy.current = true;
    pad.clear();
    void pad.digit(rank).then(() => (busy.current = false));
  }, [rank, busy]);

  return (
    <span
      className="box rank"
      role="button"
      aria-label={rank ? `${label}: ${rank}` : label}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !busy.current) {
          e.preventDefault();
          onMark();
        }
      }}
    >
      <canvas ref={canvasRef} />
    </span>
  );
}

/** A row of circles 0..max: filling one rubs out the previous one in the row. */
export function ScoreRow({ value, max, label, onChange }: { value: number | null; max: number; label: string; onChange: (v: number | null) => void }) {
  return (
    <span className="scores" role="radiogroup" aria-label={label}>
      {Array.from({ length: max + 1 }, (_, n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={String(n)}
          className={`score ${value === n ? "on" : ""}`}
          onClick={() => {
            sfx.scratch();
            onChange(value === n ? null : n);
          }}
        >
          {n}
        </button>
      ))}
    </span>
  );
}
