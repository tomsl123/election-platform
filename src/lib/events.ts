// What happens around an election's milestones: notices by e-mail and Discord, webhooks, the UCTV feed.
// Kept apart from elections.ts and ballot.ts so those stay about the election itself.
// A failing notice must never undo or block the milestone itself, so every step is guarded.
import { db } from "./db";
import { emitWebhook } from "./webhooks";
import type { Result } from "./count";

async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[polling-station] ${label}:`, err);
  }
}

export async function afterScheduled(electionId: string) {
  const { noticeScheduled } = await import("./notices");
  await safely("notice scheduled", () => noticeScheduled(electionId));
}

export async function afterOpen(electionId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await safely("webhook opened", () => emitWebhook(e.orgId, "election.opened", { id: e.id, slug: e.slug, title: e.title, closesAt: e.closesAt }));
  const { noticeOpened } = await import("./notices");
  await safely("notice opened", () => noticeOpened(e.id));
}

export async function afterClose(electionId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await safely("webhook closed", () => emitWebhook(e.orgId, "election.closed", { id: e.id, slug: e.slug, title: e.title }));
}

export async function afterHeld(electionId: string, envelopeId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await safely("webhook held", () => emitWebhook(e.orgId, "envelope.held", { election: e.id, envelope: envelopeId }));
}

export async function afterCount(electionId: string, result: Result) {
  const e = await db.election.findUnique({ where: { id: electionId }, include: { org: true } });
  if (!e) return;
  let runoff: string | null = null;
  await safely("runoff", async () => {
    const { createRunoff } = await import("./runoff");
    runoff = await createRunoff(e.id, result);
  });
  await safely("webhook counted", () => emitWebhook(e.orgId, "election.counted", { id: e.id, slug: e.slug, title: e.title, resultHash: e.resultHash, runoff }));
  const { noticeResult } = await import("./notices");
  await safely("notice counted", () => noticeResult(e.id, "counted"));
  await safely("uctv", async () => {
    const { orgUctv } = await import("./org");
    if (orgUctv(e.org).enabled && orgUctv(e.org).autoSend) {
      const { sendToUctv } = await import("./uctv");
      await sendToUctv(e.id);
    }
  });
}

export async function afterCertify(electionId: string) {
  const e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) return;
  await safely("webhook certified", () => emitWebhook(e.orgId, "election.certified", { id: e.id, slug: e.slug, title: e.title, resultHash: e.resultHash }));
  const { noticeResult } = await import("./notices");
  await safely("notice certified", () => noticeResult(e.id, "certified"));
}
