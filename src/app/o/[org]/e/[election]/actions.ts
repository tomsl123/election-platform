"use server";
// What the polling station asks of the server: check in at the desk, and cast the sitting.
// These are public endpoints: every input is checked, every answer is a plain object.
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getAuth, requestMeta, secureCookies } from "@/lib/auth";
import { decrypt, encrypt, hmac, randomToken, safeEqual } from "@/lib/crypto";
import { emailKeyHash, hasMx, isDisposable, isEmail, maskEmail, normaliseEmail } from "@/lib/email";
import { admit, passCookie, PASS_MINUTES, type AdmitResult } from "@/lib/desk";
import { BallotError, castSitting } from "@/lib/ballot";
import { stationContests, electionInclude } from "@/lib/elections";
import { identityCandidates } from "@/lib/roll";
import { codeHash } from "@/lib/roll";
import { createToken, findToken, sixDigits } from "@/lib/tokens";
import { queueMail } from "@/lib/notify";
import { mailFor, orgBrand } from "@/lib/org";
import { hit } from "@/lib/ratelimit";
import { getDict, t } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { parsePolicy, parseRoutes, type Access, type Route } from "@/lib/types";
import { deviceHashOf } from "@/lib/fraud";
import type { Admission, CastMark, CastResult, SignSpec } from "@/components/station/PollingStation";

export type DeskResult = { ok: true; admission: Admission } | { ok: false; error?: string; sign?: SignSpec };
type Device = { deviceId: string; fp: string };

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const challengeCookie = (eid: string) => `ps_challenge_${eid}`;

async function load(electionId: string) {
  const e = await db.election.findUnique({ where: { id: clean(electionId, 40) }, include: { ...electionInclude, org: true } });
  if (!e) return null;
  const dict = getDict(e.org, orgBrand(e.org).words);
  return { e, org: e.org, dict, routes: parseRoutes(e.routes) };
}

async function evidence(device: Device | undefined, email?: string | null) {
  const meta = await requestMeta();
  return { ip: meta.ip, userAgent: meta.userAgent, deviceId: clean(device?.deviceId, 64), deviceFp: clean(device?.fp, 128), email: email ?? null };
}

function blockedHint(reasons: string[]): "station.blocked.hint" | "station.blocked.device" | "station.blocked.email" | "station.blocked.other" {
  if (reasons.some((r) => ["VPN", "TOR", "PROXY_API", "DATACENTER"].includes(r))) return "station.blocked.hint";
  if (reasons.some((r) => r.startsWith("DEVICE"))) return "station.blocked.device";
  if (reasons.some((r) => r === "DISPOSABLE_EMAIL" || r === "NO_MX")) return "station.blocked.email";
  return "station.blocked.other";
}

function signFor(r: AdmitResult, dict: ReturnType<typeof getDict>, when?: Date | null, tz?: string): SignSpec | null {
  switch (r.outcome) {
    case "ALREADY":
      return { kind: "already", title: t(dict, "station.already") };
    case "NOT_ON_ROLL":
      return { kind: "notOnRoll", title: t(dict, "station.notOnRoll") };
    case "BLOCK":
      return { kind: "blocked", title: t(dict, "station.blocked"), text: t(dict, blockedHint(r.reasons)), red: true };
    case "CLOSED":
      return { kind: "closed", title: t(dict, "station.closed") };
    case "NOT_YET":
      return { kind: "notYet", title: t(dict, "station.notYet", { when: when && tz ? fmtDateTime(when, tz) : "soon" }) };
    default:
      return null;
  }
}

/** Turns the desk's verdict into what the booth needs: the papers, the hall, and the pass in a cookie. */
async function finish(r: AdmitResult, ctx: NonNullable<Awaited<ReturnType<typeof load>>>): Promise<DeskResult> {
  const sign = signFor(r, ctx.dict, ctx.e.opensAt, ctx.org.timezone);
  if (sign || !("pass" in r)) return { ok: false, sign: sign ?? undefined };
  (await cookies()).set(passCookie(ctx.e.id), r.pass, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: PASS_MINUTES * 60 });
  return {
    ok: true,
    admission: {
      contests: stationContests(ctx.e.contests, r.line.districtId),
      hall: r.outcome === "HOLD" ? "envelope" : ctx.e.transparency === "SHOW_OF_HANDS" ? "board" : "box",
      voterName: r.line.displayName,
    },
  };
}

function routeOff(ctx: { routes: Route[] }, r: Route) {
  return !ctx.routes.includes(r);
}

// ── Public elections: an e-mail and a six-digit code ──

export async function presentEmail(electionId: string, input: { email: string; name?: string; districtId?: string }, device: Device): Promise<{ ok: true; sentTo: string } | { ok: false; error: string; sign?: SignSpec }> {
  const ctx = await load(electionId);
  if (!ctx) return { ok: false, error: "Not found." };
  const { e, org, dict } = ctx;
  if (e.status !== "OPEN") return { ok: false, error: t(dict, "station.closed") };
  if (e.access !== "PUBLIC" || routeOff(ctx, "EMAIL_CODE")) return { ok: false, error: t(dict, "err.generic") };
  const email = normaliseEmail(clean(input.email, 254));
  if (!isEmail(email)) return { ok: false, error: t(dict, "err.email") };
  const name = clean(input.name, 80);
  if (e.transparency !== "SECRET" && name.length < 2) return { ok: false, error: t(dict, "err.name") };
  let districtId: string | null = null;
  if (e.districtAssign === "SELF" && e.districtSetId) {
    const set = await db.districtSet.findUnique({ where: { id: e.districtSetId } });
    const d = await db.district.findFirst({ where: { id: clean(input.districtId, 40), setId: e.districtSetId } });
    if (!d) return { ok: false, error: t(dict, "err.district", { set: set?.name ?? "" }) };
    districtId = d.id;
  }
  const policy = parsePolicy(e.fraud, e.access as Access);
  if (policy.actions.DISPOSABLE_EMAIL === "BLOCK" && isDisposable(email)) return { ok: false, error: t(dict, "err.disposable") };
  if (policy.actions.NO_MX === "BLOCK" && !(await hasMx(email))) return { ok: false, error: t(dict, "err.noMx") };

  const meta = await requestMeta();
  const gates = [
    await hit(`code:e:${e.id}:${emailKeyHash(email)}`, 3, 600),
    await hit(`code:ip:${meta.ip}`, 10, 600),
    ...(device?.deviceId ? [await hit(`code:dev:${deviceHashOf(clean(device.deviceId, 64))}`, 5, 600)] : []),
  ];
  const shut = gates.find((g) => !g.ok);
  if (shut) return { ok: false, error: t(dict, "err.tooMany", { minutes: Math.max(1, Math.ceil(shut.retryAfter / 60)) }) };

  const smtp = await mailFor(org);
  if (!smtp.enabled) return { ok: false, error: "This polling station cannot send codes right now." };

  const code = sixDigits();
  // The code is checked against a keyed hash bound to this challenge; neither is stored in the clear.
  const raw = randomToken(24);
  await createToken("EMAIL_CODE", {
    raw,
    electionId: e.id,
    payload: JSON.stringify({ email: encrypt(email), name, districtId, check: hmac("email-code", `${raw}:${code}`) }),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  (await cookies()).set(challengeCookie(e.id), raw, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 600 });
  await queueMail(org, email, "EMAIL_CODE", `${code} · ${e.title}`, {
    heading: code,
    stamp: org.shortName,
    lines: [`Your code for ${e.title}.`, "Enter it at the desk to receive your ballot papers. It works for ten minutes.", "If you did not ask for it, ignore this message."],
  });
  return { ok: true, sentTo: maskEmail(email) };
}

export async function confirmCode(electionId: string, code: string, device: Device): Promise<DeskResult> {
  const ctx = await load(electionId);
  if (!ctx) return { ok: false, error: "Not found." };
  const { e, org, dict } = ctx;
  const jar = await cookies();
  const raw = jar.get(challengeCookie(e.id))?.value ?? "";
  const tok = await findToken("EMAIL_CODE", raw);
  if (!tok || tok.electionId !== e.id) return { ok: false, error: t(dict, "err.codeExpired") };
  if (tok.attempts >= 5) return { ok: false, error: t(dict, "err.tooMany", { minutes: 10 }) };
  const payload = JSON.parse(tok.payload) as { email: string; name: string; districtId: string | null; check: string };
  const digits = clean(code, 12).replace(/\D/g, "");
  if (!payload.check || !safeEqual(hmac("email-code", `${raw}:${digits}`), payload.check)) {
    await db.token.update({ where: { id: tok.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: t(dict, "err.code") };
  }
  const claimed = await db.token.updateMany({ where: { id: tok.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return { ok: false, error: t(dict, "err.codeExpired") };
  jar.delete(challengeCookie(e.id));
  const email = decrypt(payload.email) ?? "";
  const keys = await identityCandidates(org.id, { email });
  let districtId = payload.districtId;
  let registerEntryId: string | null = null;
  if (keys[0]?.startsWith("reg:")) {
    registerEntryId = keys[0].slice(4);
    if (!districtId && e.districtSetId && e.districtAssign === "REGISTER") {
      districtId = (await db.registerDistrict.findFirst({ where: { entryId: registerEntryId, setId: e.districtSetId } }))?.districtId ?? null;
    }
  }
  const r = await admit({ election: e, route: "EMAIL_CODE", keys, email, displayName: payload.name, districtId, registerEntryId, mayCreate: true, evidence: await evidence(device, email) });
  return finish(r, ctx);
}

// ── Code cards ──

export async function enterWithCode(electionId: string, code: string, device: Device): Promise<DeskResult> {
  const ctx = await load(electionId);
  if (!ctx) return { ok: false, error: "Not found." };
  const { e, dict } = ctx;
  if (routeOff(ctx, "CODE")) return { ok: false, error: t(dict, "err.generic") };
  const meta = await requestMeta();
  const gate = await hit(`card:ip:${meta.ip}`, 10, 600);
  if (!gate.ok) return { ok: false, error: t(dict, "err.tooMany", { minutes: Math.ceil(gate.retryAfter / 60) }) };
  const card = await db.accessCode.findUnique({ where: { codeHash: codeHash(clean(code, 20)) } });
  if (!card || card.electionId !== e.id) return { ok: false, error: t(dict, "err.card") };
  const r = await admit({
    election: e,
    route: "CODE",
    keys: [`code:${card.id}`],
    districtId: card.districtId,
    displayName: card.label ? `${card.label}` : "",
    accessCodeId: card.usedAt ? null : card.id,
    mayCreate: !card.usedAt,
    evidence: await evidence(device),
  });
  if (r.outcome === "NOT_ON_ROLL") return { ok: false, error: t(dict, "err.cardUsed") };
  return finish(r, ctx);
}

// ── Accounts ──

export async function enterWithAccount(electionId: string, device: Device): Promise<DeskResult> {
  const ctx = await load(electionId);
  if (!ctx) return { ok: false, error: "Not found." };
  const { e, org, dict } = ctx;
  if (routeOff(ctx, "ACCOUNT")) return { ok: false, error: t(dict, "err.generic") };
  const auth = await getAuth();
  if (!auth) return { ok: false, error: t(dict, "desk.signIn") };
  const keys = await identityCandidates(org.id, { email: auth.user.email });
  let districtId: string | null = null;
  const reg = keys.find((k) => k.startsWith("reg:"));
  if (reg && e.districtSetId) districtId = (await db.registerDistrict.findFirst({ where: { entryId: reg.slice(4), setId: e.districtSetId } }))?.districtId ?? null;
  const r = await admit({
    election: e,
    route: "ACCOUNT",
    keys,
    email: auth.user.email,
    displayName: auth.user.displayName,
    districtId,
    registerEntryId: reg ? reg.slice(4) : null,
    userId: auth.user.id,
    mayCreate: e.access === "PUBLIC",
    evidence: await evidence(device, null),
  });
  return finish(r, ctx);
}

// ── One-time links ──

export async function enterWithLink(electionId: string, token: string, device: Device): Promise<DeskResult> {
  const ctx = await load(electionId);
  if (!ctx) return { ok: false, error: "Not found." };
  const { e, dict } = ctx;
  if (routeOff(ctx, "LINK")) return { ok: false, error: t(dict, "err.generic") };
  const tok = await findToken("VOTE", clean(token, 100));
  if (!tok || tok.electionId !== e.id || !tok.rollEntryId) return { ok: false, error: t(dict, "err.link") };
  const line = await db.rollEntry.findUnique({ where: { id: tok.rollEntryId } });
  if (!line) return { ok: false, error: t(dict, "err.link") };
  const r = await admit({ election: e, route: "LINK", keys: [line.identityKey], tokenId: tok.id, mayCreate: false, evidence: await evidence(device) });
  return finish(r, ctx);
}

// ── Into the box ──

export async function castBallots(electionId: string, marks: CastMark[]): Promise<CastResult> {
  const ctx = await load(electionId);
  if (!ctx) return { ok: false, error: "Not found." };
  const { e, dict } = ctx;
  const jar = await cookies();
  const raw = jar.get(passCookie(e.id))?.value ?? "";
  if (!raw) return { ok: false, error: t(dict, "err.pass"), sign: { kind: "error", title: t(dict, "err.pass") } };
  if (!Array.isArray(marks) || marks.length > 100) return { ok: false, error: t(dict, "err.generic") };
  const policy = parsePolicy(e.fraud, e.access as Access);
  try {
    const r = await castSitting({ electionId: e.id, passRaw: raw, marks: marks.map((m) => ({ contestId: clean(m?.contestId, 40), data: m?.data })), minSeconds: policy.actions.TOO_FAST === "IGNORE" ? 0 : 4 });
    jar.delete(passCookie(e.id));
    return { ok: true, receipt: r.receipt, held: r.held, pinned: r.pinned };
  } catch (err) {
    if (err instanceof BallotError) {
      const timedOut = /timed out|already been cast|already been used/.test(err.message);
      if (timedOut) jar.delete(passCookie(e.id));
      return { ok: false, error: err.message, ...(timedOut || /closed|already/.test(err.message) ? { sign: { kind: /closed/.test(err.message) ? "closed" : "error", title: err.message } as SignSpec } : {}) };
    }
    console.error("[polling-station] cast failed:", err);
    return { ok: false, error: t(dict, "err.generic") };
  }
}
