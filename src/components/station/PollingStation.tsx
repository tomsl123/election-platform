"use client";
// The polling station as one scene graph: door → desk → booth → hall → receipt.
// Everything a voter does is a gesture with a tap and a keyboard path beside it.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { emptyMark, isComplete, type AnyMark, type StationContest } from "@/lib/marks";
import { BallotPaper } from "./BallotPaper";
import { Hall, type HallSlip, type HallVariant } from "./Hall";
import { Pencil, type PencilApi } from "./Pencil";
import { Corner, Curtain, Motes, Pile, ReceiptStub, Sign, StepNotice } from "./Scenery";
import { wait } from "./gestures";
import { sfx } from "./sound";

export type CastMark = { contestId: string; data: AnyMark };
export type CastResult =
  | { ok: true; receipt: string; held: boolean; pinned: boolean }
  | { ok: false; error: string; sign?: SignSpec };

export type SignSpec = { kind: "closed" | "notYet" | "already" | "blocked" | "notOnRoll" | "error"; title: string; text?: string; red?: boolean };

/** What the desk learns when it admits the voter: the papers for their district, and whether the visit is held. */
export type Admission = { contests?: StationContest[]; hall?: HallVariant; voterName?: string };

export type StationProps = {
  style?: CSSProperties;
  crestId: string | null;
  plate: string;
  title: string;
  subtitle: string;
  heading: string;
  dateLabel: string;
  serialBase: number;
  contests: StationContest[];
  tints: string[];
  hall: HallVariant;
  voterName?: string;
  links: { board: string; verify: string };
  /** Shown instead of the door: polls closed, not yet open, already voted, ... */
  sign?: SignSpec | null;
  /** The registration desk. Calls admit() once the voter is checked in. Without it the booth opens straight away. */
  desk?: (admit: (a: Admission) => void, showSign: (s: SignSpec) => void) => ReactNode;
  /** Skip the door: the voter came back from a check-in that happened elsewhere. */
  startInside?: boolean;
  cast: (marks: CastMark[]) => Promise<CastResult>;
};

type Scene = "door" | "desk" | "booth" | "hall";

export function PollingStation(p: StationProps) {
  const t = useT();
  const [scene, setScene] = useState<Scene>("door");
  const [open, setOpen] = useState(false);
  const [contests, setContests] = useState(p.contests);
  const [hall, setHall] = useState<HallVariant>(p.hall);
  const [voterName, setVoterName] = useState(p.voterName);
  const [marks, setMarks] = useState<Record<string, AnyMark>>(() => Object.fromEntries(p.contests.map((c) => [c.id, emptyMark(c)])));
  const [idx, setIdx] = useState(0);
  const [folded, setFolded] = useState(0);
  const [boothAway, setBoothAway] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [receipt, setReceipt] = useState<{ code: string; held: boolean; pinned: boolean } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [sign, setSign] = useState<SignSpec | null>(p.sign ?? null);
  const [castError, setCastError] = useState<string | null>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const pencil = useRef<PencilApi | null>(null);
  const marksRef = useRef(marks);
  marksRef.current = marks;

  const tint = (i: number) => p.tints[i % p.tints.length];

  const enterBooth = useCallback(() => {
    setScene("booth");
    setIdx(0);
  }, []);

  const enter = async () => {
    sfx.paper();
    setOpen(true);
    await wait(650);
    if (p.desk) setScene("desk");
    else enterBooth();
  };

  useEffect(() => {
    if (p.startInside && !p.sign) {
      setOpen(true);
      if (p.desk) setScene("desk");
      else enterBooth();
    }
  }, [p.startInside, p.sign, p.desk, enterBooth]);

  const admit = useCallback(
    (a: Admission) => {
      if (a.contests) {
        setContests(a.contests);
        setMarks(Object.fromEntries(a.contests.map((c) => [c.id, emptyMark(c)])));
      }
      if (a.hall) setHall(a.hall);
      if (a.voterName !== undefined) setVoterName(a.voterName);
      enterBooth();
    },
    [enterBooth],
  );

  const onFolded = async () => {
    sfx.tick();
    setFolded((f) => f + 1);
    if (idx < contests.length - 1) {
      await wait(250);
      setIdx((i) => i + 1);
      return;
    }
    // Out of the booth: the curtain closes, the hall is set, the curtain opens.
    await wait(500);
    setOpen(false);
    sfx.paper();
    await wait(1150);
    setBoothAway(true);
    setScene("hall");
    await wait(100);
    setOpen(true);
    sfx.paper();
  };

  const doCast = useCallback(async () => {
    setCastError(null);
    const list = contests.map((c) => ({ contestId: c.id, data: marksRef.current[c.id] ?? emptyMark(c) }));
    let r: CastResult;
    try {
      r = await p.cast(list);
    } catch {
      r = { ok: false, error: t("err.generic") };
    }
    if (!r.ok) {
      if (r.sign) setSign(r.sign);
      else setCastError(r.error);
      sfx.buzz();
      return;
    }
    await wait(350);
    setSealed(true);
    sfx.ding();
    setReceipt({ code: r.receipt, held: r.held, pinned: r.pinned });
    await wait(500);
    setShowReceipt(true);
  }, [contests, p, t]);

  const slips: HallSlip[] = contests.map((c, i) => {
    const m = marks[c.id];
    const chosen = m && "x" in m ? m.x : m && "r" in m ? m.r.slice(0, 3) : m && "s" in m ? Object.keys(m.s) : [];
    return {
      key: c.id,
      tint: tint(i),
      title: c.title,
      marks: chosen.map((id) => c.options.find((o) => o.id === id)).filter(Boolean).map((o) => ({ symbol: o!.symbol || "star", color: o!.color })),
    };
  });

  const current = contests[idx];
  const step = scene === "hall" ? 2 : current && isComplete(current, marks[current.id] ?? emptyMark(current)) ? 1 : 0;
  const remaining = scene === "booth" || scene === "desk" ? contests.slice(scene === "booth" ? idx + 1 : 0).map((_, i) => tint(i + (scene === "booth" ? idx + 1 : 0))) : scene === "door" ? contests.map((_, i) => tint(i)) : [];

  return (
    <main className={`station ${open ? "open" : ""}`} style={p.style}>
      <section className={`booth ${boothAway ? "away" : ""}`} aria-hidden={scene === "hall"}>
        {scene === "booth" || scene === "door" ? <StepNotice step={step} /> : null}
        <Motes />
        <div className="shelf" ref={shelfRef}>
          {scene !== "hall" ? <Pile tints={remaining} /> : null}
          <div className="spot">
            {scene === "desk" && p.desk ? p.desk(admit, setSign) : null}
            {scene === "booth" && current ? (
              <BallotPaper
                key={current.id}
                contest={current}
                index={idx}
                total={contests.length}
                tint={tint(idx)}
                crestId={p.crestId}
                heading={p.heading}
                serial={String(p.serialBase + idx * 7)}
                dateLabel={p.dateLabel}
                mark={marks[current.id] ?? emptyMark(current)}
                onMark={(m) => setMarks((all) => ({ ...all, [current.id]: m }))}
                onFolded={() => void onFolded()}
                onFoldStart={() => pencil.current?.rest()}
                trayRef={trayRef}
              />
            ) : null}
          </div>
          <div className="tray" ref={trayRef} aria-hidden="true">
            {Array.from({ length: folded }, (_, i) => (
              <div key={i} className="slip" style={{ ["--tint" as string]: tint(i), ["--r" as string]: `${i * 5 - 4}deg`, top: -i * 5, left: i * 4 }} />
            ))}
          </div>
        </div>
      </section>

      {scene === "hall" ? <Hall variant={hall} crestId={p.crestId} slips={slips} voterName={voterName} sealed={sealed} onAllIn={() => void doCast()} /> : null}
      {receipt ? <ReceiptStub crestId={p.crestId} code={receipt.code} held={receipt.held} pinned={receipt.pinned} dateLabel={p.dateLabel} verifyHref={p.links.verify} boardHref={p.links.board} show={showReceipt} /> : null}

      <Pencil shelfRef={shelfRef} hidden={scene !== "booth"} api={pencil} />
      <Curtain crestId={p.crestId} plate={p.plate} title={p.title} subtitle={p.subtitle} onEnter={() => void enter()} showPlate={scene === "door" && !sign} />
      <Corner boardHref={p.links.board} />

      {sign ? (
        <Sign kind={sign.kind} title={sign.title} text={sign.text} red={sign.red}>
          <a href={p.links.board}>{t("station.back")}</a>
        </Sign>
      ) : null}
      {castError ? (
        <Sign kind="error" title={castError} red>
          <button type="button" onClick={() => void doCast()}>
            {t("station.retry")}
          </button>
        </Sign>
      ) : null}
    </main>
  );
}
