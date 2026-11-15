// The ballot box: casting a sitting, receipts, closing, counting, sealing, verifying.
// Modelled on USFC Parliament's voting.ts (hash chain, shuffled urn, HMAC seal).
import type { Election, Prisma } from "@prisma/client";
import { db, withWriteLock, type Tx } from "./db";
import { audit, auditTx } from "./audit";
import { canonical, normaliseReceipt, randomId, randomReceipt, sha256 } from "./crypto";
import { bump } from "./live";
import { Problem } from "./problem";
import { validateMark, type AnyMark } from "./marks";
import { electionInclude, stationContests } from "./elections";
import { revoteTagFor } from "./desk";
import { parseRule } from "./types";
import type { Actor } from "./action";

export class BallotError extends Problem {}

export const genesis = (electionId: string) => sha256(`polling-station:${electionId}`);
export const receiptHashFor = (electionId: string, contestId: string, code: string) => sha256(`${electionId}:${contestId}:${normaliseReceipt(code)}`);

export type Link = { electionId: string; contestId: string; districtId: string | null; seq: number; data: string; voter: string | null; receiptHash: string };
export const ballotHash = (prev: string, b: Link) => sha256(canonical({ prev, ...b }));

/** Appends one ballot to the election's chain (the caller holds the write lock). */
async function chainAppend(tx: Tx, electionId: string, b: Omit<Link, "electionId" | "seq">) {
  const last = await tx.ballot.findFirst({ where: { electionId, seq: { not: null } }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? genesis(electionId);
  const link: Link = { electionId, seq, ...b };
  return { seq, prevHash, hash: ballotHash(prevHash, link) };
}

export type CastResult = { receipt: string; held: boolean; pinned: boolean };

/**
 * Casts one sitting: one mark per paper the voter is entitled to, all or nothing.
 * The pass is spent in the same transaction, so a pass casts exactly once.
 */
export async function castSitting(input: { electionId: string; passRaw: string; marks: Array<{ contestId: string; data: unknown }>; minSeconds?: number }): Promise<CastResult> {
  const done = await withWriteLock(() =>
    db.$transaction(async (tx) => {
      const now = new Date();
      const e = await tx.election.findUnique({ where: { id: input.electionId }, include: electionInclude });
      if (!e) throw new BallotError("That election does not exist.");
      if (e.status !== "OPEN" || (e.closesAt && e.closesAt <= now)) throw new BallotError("The polls have closed.");
      const pass = await tx.boothPass.findUnique({ where: { id: sha256(input.passRaw) } });
      if (!pass || pass.electionId !== e.id || pass.usedAt || pass.expiresAt <= now) throw new BallotError("Your visit timed out. Check in again.");
      const line = await tx.rollEntry.findUniqueOrThrow({ where: { id: pass.rollEntryId } });
      if (line.status === "HELD" || line.status === "REJECTED" || (line.status === "VOTED" && !e.allowRevote)) throw new BallotError("A ballot has already been cast for you.");

      // The papers this voter is entitled to, and exactly one valid mark for each.
      const entitled = stationContests(e.contests, line.districtId);
      const byId = new Map(input.marks.map((m) => [m.contestId, m.data]));
      if (input.marks.length !== entitled.length || entitled.some((c) => !byId.has(c.id))) throw new BallotError("Every paper must go into the box.");
      const marks: Array<{ contestId: string; data: AnyMark }> = [];
      for (const c of entitled) {
        const rule = parseRule(e.contests.find((x) => x.id === c.id)!.rule);
        const m = validateMark({ method: c.method, maxChoices: c.maxChoices, scoreMax: rule.scoreMax, allowBlank: rule.allowBlank }, c.options.map((o) => o.id), byId.get(c.id));
        if (!m) throw new BallotError(`The paper "${c.title}" is not marked correctly.`);
        marks.push({ contestId: c.id, data: m });
      }

      // Spend the pass first: a second request with the same pass fails here.
      const spent = await tx.boothPass.updateMany({ where: { id: pass.id, usedAt: null }, data: { usedAt: now } });
      if (spent.count !== 1) throw new BallotError("This visit has already been cast.");
      if (pass.tokenId) {
        const used = await tx.token.updateMany({ where: { id: pass.tokenId, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
        if (used.count !== 1) throw new BallotError("That one-time link has already been used.");
      }

      const reasons: string[] = JSON.parse(pass.reasons || "[]");
      const tooFast = (input.minSeconds ?? 0) > 0 && now.getTime() - pass.issuedAt.getTime() < (input.minSeconds ?? 0) * 1000;
      if (tooFast) reasons.push("TOO_FAST");
      const held = pass.hold || tooFast;
      const hands = e.transparency === "SHOW_OF_HANDS";
      const revote = line.status === "VOTED";

      if (revote) {
        // Only the last visit counts: earlier ballots of this voter are set aside.
        const where: Prisma.BallotWhereInput = hands ? { electionId: e.id, rollEntryId: line.id } : { electionId: e.id, revoteTag: revoteTagFor(e.id, line.id) };
        await tx.ballot.updateMany({ where: { ...where, status: { in: ["COUNTED", "HELD"] } }, data: { status: "SUPERSEDED" } });
      }

      const envelope = held ? await tx.envelope.create({ data: { electionId: e.id, rollEntryId: line.id, reasons: JSON.stringify(reasons) } }) : null;
      const receipt = randomReceipt();
      for (const m of marks) {
        const data = canonical(m.data);
        const receiptHash = receiptHashFor(e.id, m.contestId, receipt);
        const base = { id: randomId(), electionId: e.id, contestId: m.contestId, districtId: line.districtId, data, status: held ? "HELD" : "COUNTED", envelopeId: envelope?.id ?? null, receiptHash };
        if (hands) {
          // Show of hands: the ballot carries its voter and goes into the chain at once.
          const link = await chainAppend(tx, e.id, { contestId: m.contestId, districtId: line.districtId, data, voter: line.id, receiptHash });
          await tx.ballot.create({ data: { ...base, rollEntryId: line.id, createdAt: now, ...link } });
        } else {
          // Secret: no voter, no time, no place in the chain until the urn is shuffled at the close.
          await tx.ballot.create({ data: { ...base, revoteTag: e.allowRevote ? revoteTagFor(e.id, line.id) : null } });
        }
      }

      await tx.rollEntry.update({ where: { id: line.id }, data: { status: held ? "HELD" : "VOTED", votedAt: hands ? now : null } });
      await auditTx(tx, {
        orgId: e.orgId,
        actorLabel: hands ? line.displayName || "a voter" : "a voter",
        action: revote ? "ballot.recast" : held ? "ballot.held" : "ballot.cast",
        entity: "Election",
        entityId: e.id,
        // Choices are journalled only for a show of hands. A secret ballot leaves no trace of them here.
        details: { papers: marks.length, ...(held ? { reasons } : {}), ...(hands ? { voter: line.id, marks: marks.map((m) => ({ contest: m.contestId, mark: m.data })) } : {}) },
      });
      return { receipt, held, pinned: hands, orgId: e.orgId, envelopeId: envelope?.id ?? null };
    }),
  );
  bump(input.electionId);
  if (done.envelopeId) {
    const { afterHeld } = await import("./events");
    await afterHeld(input.electionId, done.envelopeId);
  }
  return { receipt: done.receipt, held: done.held, pinned: done.pinned };
}

/** What became of a receipt: one answer per paper. */
export async function lookupReceipt(electionId: string, code: string) {
  const e = await db.election.findUnique({ where: { id: electionId }, include: { contests: { orderBy: { position: "asc" } } } });
  if (!e || normaliseReceipt(code).length !== 12) return null;
  const out: Array<{ contest: string; status: string | null }> = [];
  for (const c of e.contests) {
    const b = await db.ballot.findUnique({ where: { contestId_receiptHash: { contestId: c.id, receiptHash: receiptHashFor(e.id, c.id, code) } }, select: { status: true } });
    if (b) out.push({ contest: c.title, status: b.status });
  }
  return out.length ? out : [];
}

// ── Closing ─────────────────────────────────────────────────────────────────

export async function closePolls(electionId: string, actor: Actor): Promise<{ counted: boolean; message: string }> {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId } });
  if (e.status !== "OPEN") throw new Problem("These polls are not open.");
  await db.election.update({ where: { id: e.id }, data: { status: "CLOSED", closedAt: new Date() } });
  await db.boothPass.updateMany({ where: { electionId: e.id, usedAt: null }, data: { usedAt: new Date() } });
  await audit({ orgId: e.orgId, actorId: actor.id, actorLabel: actor.label, action: "election.closed", entity: "Election", entityId: e.id, ip: actor.ip });
  bump(e.id);
  const { afterClose } = await import("./events");
  await afterClose(e.id);
  return countElection(e.id, actor);
}

export async function countElection(_electionId: string, _actor: Actor): Promise<{ counted: boolean; message: string }> {
  return { counted: false, message: "The polls are closed. Counting arrives in Phase 6." };
}

export async function certifyElection(_electionId: string, _actor: Actor) {
  throw new Problem("Certification arrives in Phase 6.");
}

export type { Election };
