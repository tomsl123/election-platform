// Signs that a visit may be a repeat voter, and what the election's policy says to do about them.
// evaluate() is pure; gatherSignals() collects the evidence (address lists, devices, e-mail domain).
import type { Election } from "@prisma/client";
import { db } from "./db";
import { hmac } from "./crypto";
import { ipKey } from "./cidr";
import { lookupIp, type IpLookup } from "./ipintel";
import { hasMx, isDisposable } from "./email";
import { SIGNALS, type FraudAction, type FraudPolicy, type Signal } from "./types";

export type Evidence = { ip: string; userAgent: string; deviceId: string; deviceFp: string; email?: string | null };
export type Verdict = { action: "ADMIT" | "HOLD" | "BLOCK"; reasons: Signal[] };

/** The strongest action any raised sign calls for. */
export function evaluate(signals: Signal[], policy: FraudPolicy): Verdict {
  const block = signals.filter((s) => policy.actions[s] === "BLOCK");
  if (block.length) return { action: "BLOCK", reasons: block };
  const hold = signals.filter((s) => policy.actions[s] === "HOLD");
  if (hold.length) return { action: "HOLD", reasons: hold };
  return { action: "ADMIT", reasons: [] };
}

export const ipHashOf = (ip: string) => (ip ? hmac("ip", ipKey(ip)) : "");
export const deviceHashOf = (id: string) => (id ? hmac("device", id) : "");
export const fpHashOf = (fp: string) => (fp ? hmac("fp", fp) : "");

const LIVE = ["CHECKED_IN", "VOTED", "HELD"];
const wants = (policy: FraudPolicy, ...s: Signal[]) => s.some((x) => policy.actions[x] !== "IGNORE");

/** Signs raised by an IP verdict alone (pure; tested). */
export function ipSignals(v: IpLookup): Signal[] {
  const out: Signal[] = [];
  if (v.tor) out.push("TOR");
  if (v.vpn) out.push("VPN");
  if (v.proxy) out.push("PROXY_API");
  if (v.hosting) out.push("DATACENTER");
  if (v.failed) out.push("LOOKUP_FAILED");
  return out;
}

/** Collects every sign the policy cares about for one visit. `lineId` is the voter's own line (excluded from comparisons). */
export async function gatherSignals(e: Pick<Election, "id">, lineId: string | null, ev: Evidence, policy: FraudPolicy): Promise<{ signals: Signal[]; ip?: IpLookup }> {
  const signals = new Set<Signal>();
  let ip: IpLookup | undefined;
  if (ev.ip && wants(policy, "VPN", "TOR", "DATACENTER", "PROXY_API", "LOOKUP_FAILED")) {
    ip = await lookupIp(ev.ip);
    for (const s of ipSignals(ip)) signals.add(s);
  }
  if (ev.email) {
    if (wants(policy, "DISPOSABLE_EMAIL") && isDisposable(ev.email)) signals.add("DISPOSABLE_EMAIL");
    if (wants(policy, "NO_MX") && !(await hasMx(ev.email))) signals.add("NO_MX");
  }
  const others = { electionId: e.id, status: { in: LIVE }, ...(lineId ? { NOT: { id: lineId } } : {}) };
  const dev = deviceHashOf(ev.deviceId);
  const fp = fpHashOf(ev.deviceFp);
  if (dev && wants(policy, "DEVICE_REPEAT") && (await db.rollEntry.count({ where: { ...others, deviceId: dev } })) > 0) signals.add("DEVICE_REPEAT");
  if (fp && wants(policy, "DEVICE_SIMILAR") && !signals.has("DEVICE_REPEAT") && (await db.rollEntry.count({ where: { ...others, deviceFp: fp, NOT: [{ deviceId: dev }, ...(lineId ? [{ id: lineId }] : [])] } })) > 0) signals.add("DEVICE_SIMILAR");
  const iph = ipHashOf(ev.ip);
  if (iph && wants(policy, "IP_SHARED") && (await db.rollEntry.count({ where: { ...others, ipHash: iph } })) >= policy.ipSharedThreshold) signals.add("IP_SHARED");
  return { signals: SIGNALS.filter((s) => signals.has(s)), ip };
}

export function actionLabel(a: FraudAction): string {
  return a === "BLOCK" ? "refuse" : a === "HOLD" ? "hold" : "ignore";
}
