"use client";
// Out of the booth: the folded papers go into the sealed box, into the returning officer's
// envelope (a held visit), or onto the notice board (show of hands). Drag them, or tap them.
import { useEffect, useRef, useState } from "react";
import { Crest } from "@/components/Crest";
import { Sym } from "@/components/Symbol";
import { useT } from "@/i18n/client";
import { centre, drag, over, wait } from "./gestures";
import { sfx } from "./sound";

export type HallVariant = "box" | "envelope" | "board";
export type HallSlip = { key: string; tint: string; title: string; marks: Array<{ symbol: string; color: string }> };

export function Hall({ variant, crestId, slips, voterName, sealed, onAllIn }: { variant: HallVariant; crestId: string | null; slips: HallSlip[]; voterName?: string; sealed: boolean; onAllIn: () => void }) {
  const t = useT();
  const targetRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const joltRef = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [falling, setFalling] = useState<HallSlip[]>([]);
  const [pinned, setPinned] = useState<HallSlip[]>([]);
  const [chute, setChute] = useState<{ left: number; top: number } | null>(null);
  const [hint, setHint] = useState(true);
  const castingRef = useRef(new Set<string>());
  const doneRef = useRef(false);

  useEffect(() => {
    const place = () => {
      const s = slotRef.current;
      if (!s) return;
      const c = centre(s);
      setChute({ left: c.x - 80, top: c.y - 160 });
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    if (!doneRef.current && gone.length === slips.length && slips.length > 0) {
      doneRef.current = true;
      onAllIn();
    }
  }, [gone, slips.length, onAllIn]);

  async function cast(slip: HallSlip, el: HTMLElement) {
    if (castingRef.current.has(slip.key)) return;
    castingRef.current.add(slip.key);
    setHint(false);
    const target = variant === "board" ? targetRef.current! : slotRef.current!;
    const c = centre(target);
    const r = el.getBoundingClientRect();
    el.classList.add("go");
    el.style.setProperty("--r", "0deg");
    const dx = parseFloat(el.style.getPropertyValue("--dx") || "0");
    const dy = parseFloat(el.style.getPropertyValue("--dy") || "0");
    el.style.setProperty("--dx", dx + c.x - (r.left + r.width / 2) + "px");
    el.style.setProperty("--dy", dy + (c.y - (variant === "board" ? 0 : 40)) - (r.top + r.height / 2) + "px");
    await wait(370);
    if (variant === "board") {
      setPinned((p) => [...p, slip]);
      setGone((g) => [...g, slip.key]);
      sfx.pop();
      return;
    }
    setFalling((f) => [...f, slip]);
    setGone((g) => [...g, slip.key]);
    sfx.paper();
    await wait(430);
    sfx.thud();
    const j = joltRef.current;
    if (j) {
      j.classList.remove("jolt");
      void j.offsetWidth;
      j.classList.add("jolt");
    }
    setFalling((f) => f.filter((s) => s.key !== slip.key));
  }

  return (
    <section className="hall" aria-label={t("station.step.cast")}>
      <div className="big">
        <Crest uploadId={crestId} />
      </div>

      {variant === "box" ? (
        <div className="urn" ref={joltRef}>
          <div className="top" ref={targetRef}>
            <div className="slot" ref={slotRef} />
          </div>
          <div className="front">
            <div className="tape" />
            <div className={`wax ${sealed ? "glint" : ""}`}>
              <Crest uploadId={crestId} />
            </div>
            <Crest uploadId={crestId} />
          </div>
        </div>
      ) : variant === "envelope" ? (
        <div className={`envelope ${sealed ? "shut" : ""}`} ref={joltRef}>
          <div className="eb" ref={targetRef} />
          <div className="slot" ref={slotRef} />
          <div className="eflap" />
          <div className="ef">
            <span>{t("station.receipt.held")}</span>
          </div>
        </div>
      ) : (
        <div className="board" ref={targetRef}>
          <div className="slot" ref={slotRef} />
          {pinned.map((s, i) => (
            <div key={s.key} className="pinned" style={{ ["--tint" as string]: s.tint, ["--r" as string]: `${(i % 3) * 3 - 3}deg` }}>
              <b>{s.title}</b>
              <span className="marks">
                {s.marks.map((m, k) => (
                  <span key={k} style={{ color: m.color }}>
                    <Sym name={m.symbol} />
                  </span>
                ))}
              </span>
              {voterName ? <span className="who">{voterName}</span> : null}
            </div>
          ))}
        </div>
      )}

      {chute && variant !== "board" ? (
        <div className="chute" style={{ left: chute.left, top: chute.top, width: 160, height: 160 }}>
          {falling.map((s) => (
            <i key={s.key} className="falling" style={{ ["--tint" as string]: s.tint, top: 160 - 77 }} />
          ))}
        </div>
      ) : null}

      {hint && slips.length > 0 ? (
        <svg className="hint" viewBox="0 0 26 40" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13 38V4M3 14L13 4l10 10" />
        </svg>
      ) : null}

      <div className="hand">
        {slips.map((s, i) =>
          gone.includes(s.key) ? null : (
            <HandSlip key={s.key} slip={s} index={i} count={slips.length} label={t("station.dropIt", { n: i + 1 })} targetRef={targetRef} onCast={cast} />
          ),
        )}
      </div>
    </section>
  );
}

function HandSlip({ slip, index, count, label, targetRef, onCast }: { slip: HallSlip; index: number; count: number; label: string; targetRef: React.RefObject<HTMLDivElement | null>; onCast: (s: HallSlip, el: HTMLElement) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const spread = Math.min(74, 260 / Math.max(1, count - 1));
  const x = (index - (count - 1) / 2) * spread;
  const rot = (index - (count - 1) / 2) * (count > 1 ? 26 / (count - 1) : 0);
  useEffect(() => {
    const el = ref.current!;
    return drag(el, {
      start: () => el.classList.remove("go"),
      move: (dx, dy) => {
        el.style.setProperty("--dx", dx + "px");
        el.style.setProperty("--dy", dy + "px");
      },
      end: (_dx, _dy, e, moved) => {
        const target = targetRef.current;
        if (!moved || (target && over(target, e.clientX, e.clientY, 30))) return onCast(slip, el);
        el.classList.add("go");
        el.style.setProperty("--dx", "0px");
        el.style.setProperty("--dy", "0px");
      },
    });
  }, [slip, targetRef, onCast]);
  return (
    <button
      ref={ref}
      type="button"
      className="hslip"
      aria-label={label}
      style={{ ["--tint" as string]: slip.tint, ["--x" as string]: `${x}px`, ["--r" as string]: `${rot}deg` }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onCast(slip, ref.current!);
        }
      }}
      onClick={(e) => e.preventDefault()}
    />
  );
}
