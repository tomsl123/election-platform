"use client";
// One ballot paper on the shelf: mark it, then fold it by its corner. Ported from a1-booth.html.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Crest } from "@/components/Crest";
import { Sym } from "@/components/Symbol";
import { useT } from "@/i18n/client";
import { isBlank, isComplete, maxFor, setScore, toggleChoice, toggleRank, type AnyMark, type StationContest } from "@/lib/marks";
import { cloneDrawn, drag, wait } from "./gestures";
import { CrossBox, RankBox, ScoreRow } from "./marks";
import { sfx } from "./sound";

export type PaperProps = {
  contest: StationContest;
  index: number;
  total: number;
  tint: string;
  crestId: string | null;
  heading: string;
  serial: string;
  dateLabel: string;
  mark: AnyMark;
  onMark: (m: AnyMark) => void;
  onFolded: () => void;
  trayRef: RefObject<HTMLElement | null>;
  onFoldStart?: () => void;
  /** Static preview (the office's ballot editor): no gestures, no animation. */
  preview?: boolean;
};

export function instructionKey(c: StationContest): { key: "station.mark.one" | "station.mark.upTo" | "station.mark.rank" | "station.mark.score" | "station.mark.list"; vars?: Record<string, number> } {
  if (c.method === "MULTI") return { key: "station.mark.upTo", vars: { n: maxFor(c) } };
  if (c.method === "RANKED") return { key: "station.mark.rank" };
  if (c.method === "SCORE") return { key: "station.mark.score", vars: { max: c.scoreMax } };
  if (c.method === "PARTY_LIST") return { key: "station.mark.list" };
  return { key: "station.mark.one" };
}

export function BallotPaper(p: PaperProps) {
  const t = useT();
  const { contest } = p;
  const busy = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const f3dRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const foldRef = useRef<HTMLButtonElement>(null);
  const [folding, setFolding] = useState(false);
  const markRef = useRef(p.mark);
  markRef.current = p.mark;
  const complete = isComplete(contest, p.mark);
  const ready = complete && !folding && !p.preview;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const shake = () => {
    const el = paperRef.current;
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
    sfx.buzz();
  };

  async function fold() {
    if (busy.current || folding) return;
    busy.current = true;
    setFolding(true);
    p.onFoldStart?.();
    await wait(240);
    sfx.paper();
    const paper = paperRef.current!;
    const flap = document.createElement("div");
    flap.className = "flap";
    const front = cloneDrawn(paper);
    front.querySelectorAll(".fold, .blank").forEach((n) => n.remove());
    front.removeAttribute("aria-label");
    const back = document.createElement("div");
    back.className = "back";
    flap.append(front, back);
    flap.setAttribute("aria-hidden", "true");
    f3dRef.current!.append(flap);
    paper.style.transition = "none";
    paper.style.clipPath = "inset(0 0 50% 0)";
    await wait(640);
    sfx.tick();
    const sheet = sheetRef.current!;
    const tray = p.trayRef.current;
    const a = sheet.getBoundingClientRect();
    const b = tray?.getBoundingClientRect();
    sheet.style.animation = "none";
    sheet.style.transformOrigin = "50% 25%";
    sheet.style.transition = "transform .5s cubic-bezier(.5,0,.3,1), opacity .15s .4s";
    if (b) sheet.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px,${b.top + b.height / 2 - (a.top + a.height * 0.25)}px) scale(${b.width / a.width}) rotate(6deg)`;
    sheet.style.opacity = "0";
    await wait(480);
    p.onFolded();
  }
  const foldRefFn = useRef(fold);
  foldRefFn.current = fold;

  useEffect(() => {
    if (p.preview) return;
    const el = foldRef.current;
    if (!el) return;
    return drag(el, {
      when: () => readyRef.current && !busy.current,
      end: (dx, dy, _e, moved) => {
        if (!moved || dy < -16 || dx < -16) void foldRefFn.current();
      },
    });
  }, [p.preview]);

  // Papers arrive with a short delay before they take marks, as in the study.
  useEffect(() => {
    if (p.preview) return;
    busy.current = true;
    const id = setTimeout(() => (busy.current = false), 600);
    return () => clearTimeout(id);
  }, [p.preview]);

  const choice = (optionId: string, byHand: boolean) => {
    const m = markRef.current;
    if (!("x" in m) || p.preview) return "ignored" as const;
    const r = toggleChoice(contest, m, optionId);
    if (r.result === "full") {
      shake();
      return "full" as const;
    }
    if (r.result === "off" && byHand) return "ignored" as const;
    p.onMark(r.mark);
    return r.result;
  };
  const rank = (optionId: string) => {
    const m = markRef.current;
    if (!("r" in m) || p.preview) return "ignored" as const;
    const r = toggleRank(m, optionId);
    if (r.result === "off") sfx.paper();
    p.onMark(r.mark);
    return r.result;
  };

  const ins = instructionKey(contest);
  const m = p.mark;
  const blank = isBlank(m);

  return (
    <div className="sheet" ref={sheetRef} style={{ ["--tint" as string]: p.tint, animation: p.preview ? "none" : undefined }}>
      <div className="f3d" ref={f3dRef}>
        <article className={`paper ${ready ? "ready" : ""} ${p.preview ? "" : "pen"}`} ref={paperRef} aria-label={contest.title}>
          <header>
            <Crest uploadId={p.crestId} />
            <div>
              <small>{p.heading}</small>
              <h2>{contest.title}</h2>
              <em>{contest.instruction || t(ins.key, ins.vars)}</em>
            </div>
            <b>
              {p.index + 1}
              <i>/{p.total}</i>
            </b>
          </header>
          <ul>
            {contest.options.map((o) => (
              <li key={o.id} style={{ ["--opt" as string]: o.color }}>
                <span className="sy" style={{ color: o.color }}>
                  {/* eslint-disable @next/next/no-img-element */}
                  {o.photoUrl ? (
                    <>
                      <img src={o.photoUrl} alt="" />
                      {o.logoUrl ? <img className="badge" src={o.logoUrl} alt="" /> : null}
                    </>
                  ) : o.logoUrl ? (
                    <img className="logo" src={o.logoUrl} alt="" />
                  ) : (
                    <Sym name={o.symbol} />
                  )}
                  {/* eslint-enable @next/next/no-img-element */}
                </span>
                <span className="nm">
                  {o.name}
                  {o.subtitle ? <small>{o.subtitle}</small> : null}
                  {o.list.length ? <span className="list">{o.list.slice(0, 3).join(" · ")}</span> : null}
                </span>
                {"x" in m ? (
                  <CrossBox marked={m.x.includes(o.id)} label={o.name} busy={busy} onMark={(byHand) => choice(o.id, byHand)} />
                ) : "r" in m ? (
                  <RankBox rank={m.r.includes(o.id) ? m.r.indexOf(o.id) + 1 : null} label={o.name} busy={busy} onMark={() => rank(o.id)} />
                ) : (
                  <ScoreRow value={m.s[o.id] ?? null} max={contest.scoreMax} label={o.name} onChange={(v) => !p.preview && p.onMark(setScore(m, o.id, v))} />
                )}
              </li>
            ))}
          </ul>
          <footer>
            <span>No. {p.serial}</span>
            {contest.allowBlank && blank && !p.preview && !folding ? (
              <button type="button" className="blank" onClick={() => void fold()}>
                {t("station.leaveBlank")}
              </button>
            ) : null}
            <span>{p.dateLabel}</span>
          </footer>
          <button
            ref={foldRef}
            type="button"
            className="fold"
            aria-label={t("station.foldIt")}
            tabIndex={ready ? 0 : -1}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && readyRef.current) {
                e.preventDefault();
                void fold();
              }
            }}
            onClick={(e) => e.preventDefault()}
          >
            <svg viewBox="0 0 24 24">
              <path d="M19 19L6 6M6 15V6h9" />
            </svg>
          </button>
        </article>
      </div>
    </div>
  );
}
