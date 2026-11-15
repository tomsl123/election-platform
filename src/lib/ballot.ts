// The ballot box (filled in Phases 4 and 6).
import { db } from "./db";
import { audit } from "./audit";
import { bump } from "./live";
import { Problem } from "./problem";
import type { Actor } from "./action";

export async function closePolls(electionId: string, actor: Actor): Promise<{ counted: boolean; message: string }> {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId } });
  if (e.status !== "OPEN") throw new Problem("These polls are not open.");
  await db.election.update({ where: { id: e.id }, data: { status: "CLOSED", closedAt: new Date() } });
  await audit({ orgId: e.orgId, actorId: actor.id, actorLabel: actor.label, action: "election.closed", entity: "Election", entityId: e.id, ip: actor.ip });
  bump(e.id);
  return { counted: false, message: "The polls are closed." };
}

export async function countElection(_electionId: string, _actor: Actor): Promise<{ counted: boolean; message: string }> {
  return { counted: false, message: "Counting arrives in Phase 6." };
}

export async function certifyElection(_electionId: string, _actor: Actor) {
  throw new Problem("Certification arrives in Phase 6.");
}
