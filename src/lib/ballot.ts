// The ballot box: casting a sitting, receipts, closing, counting, sealing, verifying.
// Modelled on USFC Parliament's voting.ts (hash chain, shuffled urn, HMAC seal).
import type { Election, Prisma } from "@prisma/client";
import { db, withWriteLock, type Tx } from "./db";
import { districtsFor } from "./districts";
import { audit, auditTx } from "./audit";
import { canonical, hmac, normaliseReceipt, randomId, randomReceipt, sha256 } from "./crypto";
import { buildResult, type Result } from "./count";
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

export async function countElection(electionId: string, actor: Actor): Promise<{ counted: boolean; message: string }> {
  const pre = await db.election.findUniqueOrThrow({ where: { id: electionId } });
  if (pre.status !== "CLOSED") throw new Problem("Only closed polls can be counted.");
  const { settleEnvelopesForCount } = await import("./envelopes");
  const { waiting } = await settleEnvelopesForCount(electionId, actor);
  if (waiting) return { counted: false, message: `The polls are closed. ${waiting} held envelope${waiting === 1 ? "" : "s"} must be decided before the count.` };

  const sealed = await withWriteLock(() =>
    db.$transaction(
      async (tx) => {
        const e = await tx.election.findUniqueOrThrow({ where: { id: electionId }, include: electionInclude });
        if (e.status !== "CLOSED") throw new Problem("These polls have already been counted.");
        if (await tx.ballot.count({ where: { electionId, status: "HELD" } })) throw new Problem("Held ballots remain; decide them first.");
        const hands = e.transparency === "SHOW_OF_HANDS";
        // Re-votes are no longer possible: the tags that tied them to a voter are wiped.
        await tx.ballot.updateMany({ where: { electionId, revoteTag: { not: null } }, data: { revoteTag: null } });
        if (!hands) {
          // Shuffle the urn: re-insert the counted ballots in an order unrelated to when they were cast, then chain them.
          const urn = await tx.ballot.findMany({ where: { electionId, status: "COUNTED", seq: null } });
          urn.sort((a, b) => (a.receiptHash < b.receiptHash ? -1 : 1));
          await tx.ballot.deleteMany({ where: { id: { in: urn.map((b) => b.id) } } });
          let prev = (await tx.ballot.findFirst({ where: { electionId, seq: { not: null } }, orderBy: { seq: "desc" } }))?.hash ?? genesis(electionId);
          let seq = (await tx.ballot.count({ where: { electionId, seq: { not: null } } })) + 1;
          for (const b of urn) {
            const link: Link = { electionId, contestId: b.contestId, districtId: b.districtId, seq, data: b.data, voter: null, receiptHash: b.receiptHash };
            const hash = ballotHash(prev, link);
            await tx.ballot.create({ data: { id: randomId(), electionId, contestId: b.contestId, districtId: b.districtId, data: b.data, status: "COUNTED", receiptHash: b.receiptHash, seq, prevHash: prev, hash } });
            prev = hash;
            seq++;
          }
        }
        const counted = await tx.ballot.findMany({ where: { electionId, status: "COUNTED" }, select: { contestId: true, districtId: true, data: true } });
        const chainHead = (await tx.ballot.findFirst({ where: { electionId, seq: { not: null } }, orderBy: { seq: "desc" } }))?.hash ?? genesis(electionId);
        const result = buildResult(e, counted, await districtsFor(tx, e), await turnoutOf(tx, e));
        const json = canonical(result);
        const resultHash = sha256(`${json}|${chainHead}`);
        await tx.election.update({ where: { id: electionId }, data: { status: "COUNTED", countedAt: new Date(), result: json, resultHash, chainHead, seal: hmac("result-seal", resultHash) } });
        await auditTx(tx, { orgId: e.orgId, actorId: actor.id, actorLabel: actor.label, action: "election.counted", entity: "Election", entityId: e.id, ip: actor.ip, details: { resultHash, ballots: counted.length } });
        return result;
      },
      { timeout: 120_000 },
    ),
  );
  bump(electionId);
  const { afterCount } = await import("./events");
  await afterCount(electionId, sealed);
  return { counted: true, message: "Counted and sealed." };
}

async function turnoutOf(tx: Tx | typeof db, e: Election) {
  const voted = await tx.rollEntry.findMany({ where: { electionId: e.id, status: "VOTED" }, select: { districtId: true } });
  const byDistrict: Record<string, number> = {};
  for (const v of voted) if (v.districtId) byDistrict[v.districtId] = (byDistrict[v.districtId] ?? 0) + 1;
  const eligible = e.access === "INVITE" ? Math.max(e.eligibleCount, await tx.rollEntry.count({ where: { electionId: e.id } })) : 0;
  return { voted: voted.length, eligible, byDistrict };
}

/** A live tally of what is in the box now (for elections with live results). Not sealed. */
export async function liveResult(electionId: string): Promise<Result | null> {
  const e = await db.election.findUnique({ where: { id: electionId }, include: electionInclude });
  if (!e) return null;
  const counted = await db.ballot.findMany({ where: { electionId, status: "COUNTED" }, select: { contestId: true, districtId: true, data: true } });
  return buildResult(e, counted, await districtsFor(db, e), await turnoutOf(db, e));
}

/** Recomputes the chain and the count from the stored ballots, and checks the seal. */
export async function verifyElection(electionId: string): Promise<{ ok: boolean; ballots: number; problems: string[] }> {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId }, include: electionInclude });
  const problems: string[] = [];
  const chained = await db.ballot.findMany({ where: { electionId, seq: { not: null } }, orderBy: { seq: "asc" } });
  let prev = genesis(electionId);
  let expected = 1;
  for (const b of chained) {
    const link: Link = { electionId, contestId: b.contestId, districtId: b.districtId, seq: b.seq!, data: b.data, voter: b.rollEntryId, receiptHash: b.receiptHash };
    if (b.seq !== expected) problems.push(`Ballot ${expected} is missing from the chain.`);
    if (b.prevHash !== prev || b.hash !== ballotHash(prev, link)) {
      problems.push(`Ballot ${b.seq} does not match its hash; the chain is broken from here.`);
      break;
    }
    prev = b.hash!;
    expected = b.seq! + 1;
  }
  if (["COUNTED", "CERTIFIED"].includes(e.status)) {
    if (!e.result || !e.resultHash) problems.push("There is no sealed result.");
    else {
      if (sha256(`${e.result}|${e.chainHead}`) !== e.resultHash) problems.push("The stored result does not match its hash.");
      if (e.seal !== hmac("result-seal", e.resultHash)) problems.push("The seal on the result is not valid.");
      if (problems.length === 0 && e.chainHead !== prev) problems.push("The sealed result refers to a different ballot chain.");
      const counted = await db.ballot.findMany({ where: { electionId, status: "COUNTED" }, select: { contestId: true, districtId: true, data: true } });
      const unchained = await db.ballot.count({ where: { electionId, status: "COUNTED", seq: null } });
      if (unchained) problems.push(`${unchained} counted ballots are outside the chain.`);
      const stored = JSON.parse(e.result) as Result;
      const again = buildResult(e, counted, await districtsFor(db, e), stored.turnout);
      if (canonical(again.contests) !== canonical(stored.contests)) problems.push("Counting the ballots again gives a different result from the sealed one.");
    }
  }
  return { ok: problems.length === 0, ballots: chained.length, problems };
}

export async function certifyElection(electionId: string, actor: Actor) {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId } });
  if (e.status !== "COUNTED") throw new Problem("Only a counted result can be certified.");
  const v = await verifyElection(electionId);
  if (!v.ok) throw new Problem(`The recount found a problem: ${v.problems[0]}`);
  await db.election.update({ where: { id: e.id }, data: { status: "CERTIFIED", certifiedAt: new Date(), certifiedById: actor.id } });
  await audit({ orgId: e.orgId, actorId: actor.id, actorLabel: actor.label, action: "election.certified", entity: "Election", entityId: e.id, ip: actor.ip, details: { resultHash: e.resultHash } });
  bump(e.id);
  const { afterCertify } = await import("./events");
  await afterCertify(e.id);
}

export type { Election };
