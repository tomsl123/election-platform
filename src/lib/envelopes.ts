// Provisional envelopes: sittings held at the desk or the box for an officer to decide.
// The officer sees who came and why they were held, never what they marked.
import type { Organisation } from "@prisma/client";
import { db, withWriteLock } from "./db";
import { auditTx } from "./audit";
import { decrypt } from "./crypto";
import { bump } from "./live";
import { Problem } from "./problem";
import { queueMail } from "./notify";
import { parseNotices, type Signal } from "./types";
import type { Actor } from "./action";

export async function decideEnvelope(org: Organisation, envelopeId: string, actor: Actor, accept: boolean, note = "") {
  const env = await db.envelope.findFirst({ where: { id: envelopeId, election: { orgId: org.id } }, include: { election: true } });
  if (!env) throw new Problem("That envelope does not exist.");
  if (env.status !== "HELD") throw new Problem("That envelope has already been decided.");
  if (!["OPEN", "CLOSED"].includes(env.election.status)) throw new Problem("The count is sealed; envelopes can no longer change.");
  await withWriteLock(() =>
    db.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.envelope.updateMany({ where: { id: env.id, status: "HELD" }, data: { status: accept ? "ACCEPTED" : "REJECTED", decidedById: actor.id, decidedAt: now, note: note.slice(0, 300) } });
      if (claimed.count !== 1) throw new Problem("That envelope has just been decided.");
      // Once decided, the ballots are cut loose from the envelope, and so from the voter.
      await tx.ballot.updateMany({ where: { envelopeId: env.id, status: "HELD" }, data: { status: accept ? "COUNTED" : "REJECTED", envelopeId: null } });
      await tx.rollEntry.update({ where: { id: env.rollEntryId }, data: { status: accept ? "VOTED" : "REJECTED" } });
      await auditTx(tx, { orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: accept ? "envelope.accepted" : "envelope.rejected", entity: "Election", entityId: env.electionId, ip: actor.ip, details: { envelope: env.id, reasons: JSON.parse(env.reasons), ...(note ? { note } : {}) } });
    }),
  );
  bump(env.electionId);
  if (parseNotices(env.election.notices).envelope) {
    const line = await db.rollEntry.findUnique({ where: { id: env.rollEntryId } });
    const to = decrypt(line?.emailEnc);
    if (to) {
      await queueMail(org, to, "ENVELOPE_DECIDED", `${org.shortName}: your held ballot for ${env.election.title}`, {
        heading: env.election.title,
        stamp: accept ? "Counted" : "Set aside",
        lines: accept
          ? ["The returning officer has looked at your held envelope.", "Your ballot is in the box and will be counted."]
          : ["The returning officer has looked at your held envelope.", "Your ballot was set aside and will not be counted.", ...(note ? [note] : [])],
      });
    }
  }
}

/** Decides every held envelope of an election that carries a given reason. */
export async function decideByReason(org: Organisation, electionId: string, reason: Signal | "ANY", actor: Actor, accept: boolean) {
  const held = await db.envelope.findMany({ where: { electionId, status: "HELD", election: { orgId: org.id } } });
  let n = 0;
  for (const env of held) {
    const reasons = JSON.parse(env.reasons) as string[];
    if (reason !== "ANY" && !reasons.includes(reason)) continue;
    await decideEnvelope(org, env.id, actor, accept);
    n++;
  }
  return n;
}

/** At the count, undecided envelopes follow the election's rule: wait, count them, or set them aside. */
export async function settleEnvelopesForCount(electionId: string, actor: Actor): Promise<{ waiting: number }> {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId }, include: { org: true } });
  const held = await db.envelope.count({ where: { electionId, status: "HELD" } });
  if (!held) return { waiting: 0 };
  if (e.heldDefault === "WAIT") return { waiting: held };
  await decideByReason(e.org, electionId, "ANY", actor, e.heldDefault === "ACCEPT");
  return { waiting: 0 };
}
