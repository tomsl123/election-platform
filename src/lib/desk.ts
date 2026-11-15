// The registration desk: the single door every way in passes through.
// It finds (or writes) the voter's line on the roll, weighs the signs of a repeat visit,
// and hands over a booth pass, a short-lived ticket to cast exactly one sitting.
import type { Election, RollEntry } from "@prisma/client";
import { db, withWriteLock } from "./db";
import { auditTx } from "./audit";
import { encrypt, randomToken, sha256 } from "./crypto";
import { emailKeyHash, maskEmail, normaliseEmail } from "./email";
import { deviceHashOf, evaluate, fpHashOf, gatherSignals, ipHashOf, type Evidence } from "./fraud";
import { bump } from "./live";
import { parsePolicy, type Access, type Route, type Signal } from "./types";
import { hmac } from "./crypto";

export const PASS_MINUTES = 30;
export const passCookie = (electionId: string) => `ps_pass_${electionId}`;

export type AdmitInput = {
  election: Election;
  route: Route;
  /** Keys this person may hold on the roll, best first. The first is used for a new line. */
  keys: string[];
  email?: string | null;
  displayName?: string;
  districtId?: string | null;
  registerEntryId?: string | null;
  userId?: string | null;
  tokenId?: string | null;
  accessCodeId?: string | null;
  /** Dynamic rolls (code cards, Discord roles) and public elections write a new line for a newcomer. */
  mayCreate: boolean;
  evidence: Evidence;
};

export type AdmitResult =
  | { outcome: "ADMIT" | "HOLD"; pass: string; line: RollEntry; reasons: Signal[] }
  | { outcome: "BLOCK"; reasons: Signal[] }
  | { outcome: "ALREADY" | "NOT_ON_ROLL" | "CLOSED" | "NOT_YET" };

export async function admit(input: AdmitInput): Promise<AdmitResult> {
  const e = input.election;
  const now = new Date();
  if (e.status !== "OPEN") return { outcome: ["DRAFT", "NOMINATIONS", "READY"].includes(e.status) ? "NOT_YET" : "CLOSED" };
  if (e.closesAt && e.closesAt <= now) return { outcome: "CLOSED" };

  // Evidence that needs the network is gathered before the lock; the lock only guards the roll.
  const existing = await findLine(e.id, input.keys, input.email);
  const policy = parsePolicy(e.fraud, e.access as Access);
  const { signals } = await gatherSignals(e, existing?.id ?? null, input.evidence, policy);
  const verdict = evaluate(signals, policy);

  return withWriteLock(() =>
    db.$transaction(async (tx) => {
      let line = await tx.rollEntry.findFirst({ where: { electionId: e.id, identityKey: { in: input.keys } } });
      if (!line && input.email) line = await tx.rollEntry.findFirst({ where: { electionId: e.id, emailKeyHash: emailKeyHash(input.email) } });
      if (!line && !input.mayCreate) return { outcome: "NOT_ON_ROLL" as const };

      if (line) {
        if (line.status === "HELD" || line.status === "REJECTED") return { outcome: "ALREADY" as const };
        if (line.status === "VOTED" && !e.allowRevote) return { outcome: "ALREADY" as const };
      }

      const meta = {
        ipHash: ipHashOf(input.evidence.ip),
        ipEnc: input.evidence.ip ? encrypt(input.evidence.ip) : "",
        deviceId: deviceHashOf(input.evidence.deviceId),
        deviceFp: fpHashOf(input.evidence.deviceFp),
        uaHash: input.evidence.userAgent ? sha256(input.evidence.userAgent) : "",
        signals: JSON.stringify(verdict.reasons.length ? verdict.reasons : signals),
      };
      const email = input.email ? normaliseEmail(input.email) : null;
      const named = input.displayName?.trim().slice(0, 80);

      if (!line) {
        line = await tx.rollEntry.create({
          data: {
            electionId: e.id,
            identityKey: input.keys[0],
            route: input.route,
            registerEntryId: input.registerEntryId ?? null,
            userId: input.userId ?? null,
            displayName: named ?? "",
            districtId: input.districtId ?? null,
            ...(email ? { emailEnc: encrypt(email), emailMasked: maskEmail(email), emailKeyHash: emailKeyHash(email) } : {}),
            status: "INVITED",
            ...meta,
          },
        });
      }

      if (verdict.action === "BLOCK") {
        // A line already voted on is never downgraded; a fresh line remembers the refusal.
        if (line.status !== "VOTED") await tx.rollEntry.update({ where: { id: line.id }, data: { status: "BLOCKED", ...meta } });
        await auditTx(tx, { orgId: e.orgId, actorLabel: "the desk", action: "desk.refused", entity: "Election", entityId: e.id, details: { line: line.id, route: input.route, reasons: verdict.reasons } });
        return { outcome: "BLOCK" as const, reasons: verdict.reasons };
      }

      const update: Record<string, unknown> = { ...meta, route: input.route };
      if (line.status !== "VOTED") update.status = "CHECKED_IN";
      if (named && !line.displayName) update.displayName = named;
      if (input.districtId && !line.districtId) update.districtId = input.districtId;
      if (input.userId && !line.userId) update.userId = input.userId;
      line = await tx.rollEntry.update({ where: { id: line.id }, data: update });

      // One pass at a time per line: a new check-in cancels an older, unused pass.
      await tx.boothPass.updateMany({ where: { electionId: e.id, rollEntryId: line.id, usedAt: null }, data: { usedAt: now } });
      const raw = randomToken(32);
      await tx.boothPass.create({
        data: {
          id: sha256(raw),
          electionId: e.id,
          rollEntryId: line.id,
          hold: verdict.action === "HOLD",
          reasons: JSON.stringify(verdict.reasons),
          tokenId: input.tokenId ?? null,
          expiresAt: new Date(now.getTime() + PASS_MINUTES * 60_000),
        },
      });
      if (input.accessCodeId) await tx.accessCode.update({ where: { id: input.accessCodeId }, data: { usedAt: now } });
      await auditTx(tx, { orgId: e.orgId, actorLabel: "the desk", action: verdict.action === "HOLD" ? "desk.held" : "desk.admitted", entity: "Election", entityId: e.id, details: { line: line.id, route: input.route, ...(verdict.reasons.length ? { reasons: verdict.reasons } : {}) } });
      return { outcome: verdict.action === "HOLD" ? ("HOLD" as const) : ("ADMIT" as const), pass: raw, line, reasons: verdict.reasons };
    }),
  ).finally(() => bump(e.id));
}

async function findLine(electionId: string, keys: string[], email?: string | null) {
  const byKey = keys.length ? await db.rollEntry.findFirst({ where: { electionId, identityKey: { in: keys } } }) : null;
  if (byKey || !email) return byKey;
  return db.rollEntry.findFirst({ where: { electionId, emailKeyHash: emailKeyHash(email) } });
}

/** The pass this browser holds for the election, if it is still good. */
export async function currentPass(electionId: string, raw: string | undefined) {
  if (!raw || raw.length > 100) return null;
  const pass = await db.boothPass.findUnique({ where: { id: sha256(raw) } });
  if (!pass || pass.electionId !== electionId || pass.usedAt || pass.expiresAt <= new Date()) return null;
  const line = await db.rollEntry.findUnique({ where: { id: pass.rollEntryId } });
  if (!line) return null;
  return { pass, line };
}

/** Ties a re-vote to its earlier ballots while the polls are open, without naming the voter. Wiped at the close. */
export const revoteTagFor = (electionId: string, lineId: string) => hmac("revote", `${electionId}:${lineId}`);
