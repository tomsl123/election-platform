// What happens around an election's milestones: notices by e-mail and Discord, webhooks, the UCTV feed.
// Kept apart from elections.ts and ballot.ts so those stay about the election itself.
import { db } from "./db";
import { emitWebhook } from "./webhooks";
import type { Result } from "./count";

export async function afterOpen(electionId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await emitWebhook(e.orgId, "election.opened", { id: e.id, slug: e.slug, title: e.title, closesAt: e.closesAt });
}

export async function afterClose(electionId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await emitWebhook(e.orgId, "election.closed", { id: e.id, slug: e.slug, title: e.title });
}

export async function afterHeld(electionId: string, envelopeId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await emitWebhook(e.orgId, "envelope.held", { election: e.id, envelope: envelopeId });
}

export async function afterCount(electionId: string, result: Result) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  const { createRunoff } = await import("./runoff");
  const runoff = await createRunoff(e.id, result);
  await emitWebhook(e.orgId, "election.counted", { id: e.id, slug: e.slug, title: e.title, resultHash: e.resultHash, runoff });
}

export async function afterCertify(electionId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await emitWebhook(e.orgId, "election.certified", { id: e.id, slug: e.slug, title: e.title, resultHash: e.resultHash });
}
