"use client";
// The fixed pieces of the station: curtain and door plate, step notice, motes, pile and tray,
// receipt stub, hanging signs and the corner pill.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Crest } from "@/components/Crest";
import { useT } from "@/i18n/client";
import { sfx } from "./sound";

export function Curtain({ crestId, plate, title, subtitle, onEnter, showPlate }: { crestId: string | null; plate: string; title: string; subtitle: string; onEnter?: () => void; showPlate: boolean }) {
  const t = useT();
  return (
    <>
      <div className="curtain l" />
      <div className="curtain r" />
      <div className="rail" />
      {showPlate ? (
        <>
          <button className="plate" onClick={onEnter} aria-label={t("station.enter")} autoFocus>
            <Crest uploadId={crestId} />
            <small>{plate}</small>
            <span aria-hidden="true">‹ ›</span>
          </button>
          <div className="title-card">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        </>
      ) : null}
    </>
  );
}

const STEP_PATHS: ReactNode[] = [
  <>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M8 8l8 8M16 8l-8 8" />
  </>,
  <>
    <path d="M5 3h14v18H5zM5 12h14" />
    <path d="M12 19.5v-5m-2.2 2.2L12 14.5l2.2 2.2" />
  </>,
  <>
    <path d="M3 11h18v10H3zM8 11V9h8v2" />
    <path d="M12 1.5v6m-2.2-2.2L12 7.5l2.2-2.2" />
  </>,
];

/** The brass notice above the shelf: mark, fold, into the box. */
export function StepNotice({ step }: { step: number }) {
  const t = useT();
  const labels = [t("station.step.mark"), t("station.step.fold"), t("station.step.cast")];
  return (
    <div className="notice" role="status" aria-label={labels[step]}>
      {STEP_PATHS.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <i /> : null}
          <svg viewBox="0 0 24 24" aria-hidden="true" className={i < step ? "done" : i === step ? "now" : ""}>
            {p}
          </svg>
        </Fragment>
      ))}
    </div>
  );
}

export function Motes() {
  const [motes, setMotes] = useState<Array<{ l: number; t: number; d: number; dl: number }>>([]);
  useEffect(() => {
    setMotes(Array.from({ length: 14 }, () => ({ l: 20 + Math.random() * 60, t: 30 + Math.random() * 65, d: 9 + Math.random() * 9, dl: -Math.random() * 18 })));
  }, []);
  return (
    <>
      {motes.map((m, i) => (
        <i key={i} className="mote" style={{ left: `${m.l}%`, top: `${m.t}%`, animationDuration: `${m.d}s`, animationDelay: `${m.dl}s` }} />
      ))}
    </>
  );
}

export function Pile({ tints }: { tints: string[] }) {
  return (
    <div className="pile" aria-hidden="true">
      {tints
        .slice()
        .reverse()
        .map((tint, i) => (
          <i key={tints.length - i} style={{ ["--tint" as string]: tint, transform: `translate(${i * 3}px,${-i * 3}px) rotate(${i * 2 - 3}deg)` }} />
        ))}
    </div>
  );
}

export function ReceiptStub({ crestId, code, held, pinned, dateLabel, verifyHref, boardHref, show }: { crestId: string | null; code: string; held: boolean; pinned: boolean; dateLabel: string; verifyHref: string; boardHref: string; show: boolean }) {
  const t = useT();
  useEffect(() => {
    if (!show) return;
    sfx.paper();
    const id = setTimeout(() => sfx.thud(), 1500);
    return () => clearTimeout(id);
  }, [show]);
  return (
    <div className={`receipt ${show ? "show" : ""} ${held ? "held" : ""}`} role="status" aria-live="polite">
      <Crest uploadId={crestId} />
      <svg className="ok" viewBox="0 0 64 44" aria-hidden="true">
        <path d="M8 24l16 14L56 6" />
      </svg>
      <code aria-label="Receipt code">{code}</code>
      <small>{t("station.receipt.keep")}</small>
      {held ? <p>{t("station.receipt.held")}</p> : pinned ? <p>{t("station.receipt.pinned")}</p> : null}
      <nav>
        <a href={verifyHref}>{t("station.receipt.verify")}</a>
        <a href={boardHref}>{t("station.back")}</a>
      </nav>
      <div className={`stamp ${held ? "brass" : ""}`} aria-hidden="true">
        {held ? t("station.receipt.heldStamp") : t("station.receipt.voted")}
        <small>{dateLabel}</small>
      </div>
    </div>
  );
}

const SIGN_ICONS: Record<string, ReactNode> = {
  closed: <path d="M7 11V8a5 5 0 0110 0v3M5 11h14v10H5zM12 15v2" />,
  notYet: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  already: <path d="M4 5h16v14H4zM4 9h16M7 13h10M7 16h6M3 15l18-6" />,
  blocked: <path d="M3 9c3 4 15 4 18 0M5 9v10M19 9v10M3 19h4M17 19h4" />,
  notOnRoll: <path d="M4 5h16v14H4zM8 9h8M8 12h8M8 15h5M15 15l4 4M19 15l-4 4" />,
  error: <path d="M12 3l9 16H3zM12 10v4M12 17v.5" />,
};

export function Sign({ kind, title, text, children, red }: { kind: keyof typeof SIGN_ICONS | string; title: string; text?: string; children?: ReactNode; red?: boolean }) {
  return (
    <div className="sign-wrap">
      <div className={`hanging ${red ? "red" : ""}`} role="alert">
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          {SIGN_ICONS[kind] ?? SIGN_ICONS.error}
        </svg>
        <h2>{title}</h2>
        {text ? <p>{text}</p> : null}
        {children ? <nav>{children}</nav> : null}
      </div>
    </div>
  );
}

export function Corner({ boardHref }: { boardHref: string }) {
  const t = useT();
  const [on, setOn] = useState(false);
  useEffect(() => setOn(sfx.on), []);
  return (
    <nav className="corner" aria-label="Station">
      <a href={boardHref} aria-label={t("station.back")} title={t("station.back")}>
        <svg viewBox="0 0 24 24">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </a>
      <button
        type="button"
        aria-label={t("station.sound")}
        aria-pressed={on}
        title={t("station.sound")}
        onClick={() => {
          sfx.setOn(!on);
          setOn(!on);
          if (!on) sfx.click();
        }}
      >
        <svg viewBox="0 0 24 24" className={on ? "" : "off"}>
          <path d="M4 9h4l5-4v14l-5-4H4zM16 9c1.5 1.5 1.5 4.5 0 6M19 6c3 3 3 9 0 12" />
        </svg>
      </button>
    </nav>
  );
}
