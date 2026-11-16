"use client";
// The registration desk on the shelf: the open register, and one small form card.
// Public voters ring the bell for a code; invitees show their link, card or account.
// When the clerk finds the line, it is written in and crossed, and the papers are handed over.
import { useEffect, useRef, useState } from "react";
import { Crest } from "@/components/Crest";
import { HexMap } from "@/components/HexMap";
import type { HexMap as HexMapData } from "@/lib/district-file";
import { useT } from "@/i18n/client";
import type { Route } from "@/lib/types";
import { deviceEvidence, type DeviceEvidence } from "./device";
import { sfx } from "./sound";
import { wait } from "./gestures";
import type { Admission, SignSpec } from "./PollingStation";

export type DeskResult = { ok: true; admission: Admission } | { ok: false; error?: string; sign?: SignSpec };

export type DeskProps = {
  electionId: string;
  crestId: string | null;
  routes: Route[];
  needName: boolean;
  districts: { setName: string; list: Array<{ id: string; name: string; code: string }>; map?: { map: HexMapData; districtOf: Record<string, string> } | null } | null;
  account: { name: string } | null;
  loginHref: string;
  sso: { href: string; label: string } | null;
  discordHref: string | null;
  prefill: { code?: string; link?: string };
  admit: (a: Admission) => void;
  showSign: (s: SignSpec) => void;
  actions: {
    presentEmail: (electionId: string, input: { email: string; name?: string; districtId?: string }, device: DeviceEvidence) => Promise<{ ok: true; sentTo: string } | { ok: false; error: string; sign?: SignSpec }>;
    confirmCode: (electionId: string, code: string, device: DeviceEvidence) => Promise<DeskResult>;
    enterWithCode: (electionId: string, code: string, device: DeviceEvidence) => Promise<DeskResult>;
    enterWithAccount: (electionId: string, device: DeviceEvidence) => Promise<DeskResult>;
    enterWithLink: (electionId: string, token: string, device: DeviceEvidence) => Promise<DeskResult>;
  };
};

const ICONS: Record<string, React.ReactNode> = {
  EMAIL_CODE: <path d="M3 6h18v12H3zM3 6l9 7 9-7" />,
  CODE: <path d="M3 6h18v12H3zM7 10h4M7 14h7M16 10h1M16 14h1" />,
  ACCOUNT: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4.5-6 8-6s7 2 8 6" />,
  DISCORD: <path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2h-6l-5 4v-4H5a2 2 0 01-2-2V7a2 2 0 012-2zM9 11v.5M15 11v.5" />,
  LINK: <path d="M14 10a4 4 0 110-.1M14 10H22M19 10v3M21.5 10v2" />,
};

type Step = "form" | "code" | "admitted";

/** Neighbouring districts on the desk map in slightly different shades of the paper. */
const paperTone = (i: number) => `hsl(${38 + (i % 3) * 6} ${22 + (i % 2) * 8}% ${62 + ((i * 7) % 5) * 4}%)`;

export function Desk(p: DeskProps) {
  const t = useT();
  const order: Route[] = p.prefill.link ? ["LINK"] : p.prefill.code ? ["CODE"] : (["EMAIL_CODE", "ACCOUNT", "CODE", "DISCORD"] as Route[]).filter((r) => p.routes.includes(r));
  const [route, setRoute] = useState<Route>(order[0] ?? "EMAIL_CODE");
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [code, setCode] = useState("");
  const [card, setCard] = useState(p.prefill.code ?? "");
  const [written, setWritten] = useState("");
  const [ringing, setRinging] = useState(false);
  const firstRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null);

  useEffect(() => {
    void deviceEvidence();
  }, []);
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, [route, step]);

  async function done(r: DeskResult, who: string) {
    if (!r.ok) {
      setBusy(false);
      if (r.sign) {
        sfx.buzz();
        p.showSign(r.sign);
        return;
      }
      setError(r.error ?? t("err.generic"));
      sfx.buzz();
      return;
    }
    setWritten(r.admission.voterName || who || "✓");
    setStep("admitted");
    sfx.scratch();
    await wait(300);
    sfx.scratch();
    await wait(900);
    sfx.paper();
    p.admit(r.admission);
  }

  async function run(fn: (d: DeviceEvidence) => Promise<DeskResult>, who: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await done(await fn(await deviceEvidence()), who);
    } catch {
      setBusy(false);
      setError(t("err.generic"));
    }
  }

  async function ring(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setRinging(true);
    sfx.bell();
    setTimeout(() => setRinging(false), 900);
    try {
      const r = await p.actions.presentEmail(p.electionId, { email, name, districtId }, await deviceEvidence());
      setBusy(false);
      if (!r.ok) {
        if (r.sign) p.showSign(r.sign);
        setError(r.error);
        sfx.buzz();
        return;
      }
      setSentTo(r.sentTo);
      setStep("code");
      sfx.paper();
    } catch {
      setBusy(false);
      setError(t("err.generic"));
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (route === "EMAIL_CODE" && step === "code") void run((d) => p.actions.confirmCode(p.electionId, code, d), name);
    else if (route === "CODE") void run((d) => p.actions.enterWithCode(p.electionId, card, d), "");
    else if (route === "ACCOUNT") void run((d) => p.actions.enterWithAccount(p.electionId, d), p.account?.name ?? "");
    else if (route === "LINK") void run((d) => p.actions.enterWithLink(p.electionId, p.prefill.link!, d), "");
  };

  return (
    <div className="desk">
      <div className="register" aria-hidden="true">
        <div className="page">
          {["Builderswartz", "Predkozkyn", "Harper", "Salzburg"].map((n, i) => (
            <p key={n} className="done" style={{ ["--w" as string]: `${55 + ((i * 17) % 35)}%` }}>
              <span>{n}</span>
            </p>
          ))}
        </div>
        <div className="page">
          {["Cheap", "Naran"].map((n, i) => (
            <p key={n} className="done" style={{ ["--w" as string]: `${50 + i * 20}%` }}>
              <span>{n}</span>
            </p>
          ))}
          <p className={`mine ${step === "admitted" ? "done now" : ""}`} style={{ ["--w" as string]: "70%" }}>
            <span>{written}</span>
          </p>
          <p />
          <p />
        </div>
      </div>

      <form className="deskcard" onSubmit={route === "EMAIL_CODE" && step === "form" ? ring : submit} aria-busy={busy}>
        <header>
          <Crest uploadId={p.crestId} />
          <b>{t("desk.title")}</b>
        </header>
        {order.length > 1 && step === "form" ? (
          <div className="tags" role="tablist">
            {order.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={route === r}
                aria-label={t(`desk.route.${r}` as Parameters<typeof t>[0])}
                title={t(`desk.route.${r}` as Parameters<typeof t>[0])}
                className={route === r ? "on" : ""}
                onClick={() => {
                  sfx.click();
                  setRoute(r);
                  setError(null);
                }}
              >
                <svg viewBox="0 0 24 24">{ICONS[r]}</svg>
              </button>
            ))}
          </div>
        ) : null}

        {step === "admitted" ? (
          <div className="admitted" role="status">
            <svg viewBox="0 0 64 44" aria-hidden="true">
              <path d="M8 24l16 14L56 6" />
            </svg>
          </div>
        ) : route === "EMAIL_CODE" && step === "form" ? (
          <>
            <label className="line">
              <span>{t("desk.email")}</span>
              <input ref={(el) => void (firstRef.current = el)} type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {p.needName ? (
              <label className="line">
                <span>{t("desk.name")}</span>
                <input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                <small>{t("desk.name.public")}</small>
              </label>
            ) : null}
            {p.districts ? (
              <fieldset className="tiles">
                <legend>{t("desk.district", { set: p.districts.setName })}</legend>
                {p.districts.map ? (
                  <div className="desk-map">
                    {/* Tap a district on the map, or use the tiles below (the keyboard path). */}
                    <HexMap map={p.districts.map.map} districtOf={p.districts.map.districtOf} fill={(did) => (did === districtId ? "var(--map-on)" : paperTone(p.districts!.list.findIndex((d) => d.id === did)))} onPick={(did) => { setDistrictId(did); sfx.tick(); }} selected={districtId || null} decorative />
                  </div>
                ) : null}
                <div className="tile-grid">
                  {p.districts.list.map((d) => (
                    <label key={d.id} className={districtId === d.id ? "on" : ""}>
                      <input type="radio" name="district" value={d.id} checked={districtId === d.id} onChange={() => setDistrictId(d.id)} required />
                      <b>{d.code}</b>
                      <span>{d.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <button type="submit" className={`bell ${ringing ? "ring" : ""}`} disabled={busy}>
              <svg viewBox="0 0 40 40" aria-hidden="true">
                <path d="M20 6a2 2 0 012 2v1.2c5 1 8 5 8 10.3V26l3 3H7l3-3v-6.5c0-5.3 3-9.3 8-10.3V8a2 2 0 012-2z" />
                <path d="M16 31a4 4 0 008 0" />
              </svg>
              <span>{t("desk.send")}</span>
            </button>
          </>
        ) : route === "EMAIL_CODE" ? (
          <>
            <p className="note">{t("desk.code.sent", { email: sentTo })}</p>
            <label className="line">
              <span>{t("desk.code")}</span>
              <input
                ref={(el) => void (firstRef.current = el)}
                className="code6"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  if (v.length) sfx.tick();
                }}
              />
            </label>
            <button type="submit" className="go" disabled={busy || code.length !== 6}>
              {t("desk.check")}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setStep("form");
                setCode("");
                setError(null);
              }}
            >
              {t("desk.code.again")}
            </button>
          </>
        ) : route === "CODE" ? (
          <>
            <label className="line">
              <span>{t("desk.cardCode")}</span>
              <input ref={(el) => void (firstRef.current = el)} className="card" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12} required value={card} onChange={(e) => setCard(e.target.value.toUpperCase())} />
            </label>
            <button type="submit" className="go" disabled={busy || card.replace(/[^0-9A-Z]/gi, "").length < 8}>
              {t("desk.check")}
            </button>
          </>
        ) : route === "ACCOUNT" ? (
          p.account ? (
            <>
              <p className="note">{t("desk.withAccount", { name: p.account.name })}</p>
              <button ref={(el) => void (firstRef.current = el)} type="submit" className="go" disabled={busy}>
                {t("desk.useAccount")}
              </button>
            </>
          ) : (
            <>
              {p.sso ? (
                <a className="go" href={p.sso.href}>
                  {t("desk.parliament", { label: p.sso.label })}
                </a>
              ) : null}
              <a className={p.sso ? "go quiet" : "go"} href={p.loginHref}>
                {t("desk.signIn")}
              </a>
            </>
          )
        ) : route === "DISCORD" ? (
          p.discordHref ? (
            <a className="go discord" href={p.discordHref}>
              {t("desk.discord")}
            </a>
          ) : null
        ) : (
          <button ref={(el) => void (firstRef.current = el)} type="submit" className="go" disabled={busy}>
            {t("desk.enterLink")}
          </button>
        )}
        {error ? (
          <p className="err" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
