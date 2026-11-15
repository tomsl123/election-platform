// Second rounds: when a paper ends without the majority it needs, a new election is drawn up
// with only the finalists (per district for per-district papers), the same rules and the same roll.
import { db } from "./db";
import { audit } from "./audit";
import { electionInclude } from "./elections";
import type { Result } from "./count";

export async function createRunoff(electionId: string, result: Result): Promise<string | null> {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId }, include: electionInclude });
  // finalists per contest: national ones, or per district
  const needs = new Map<string, Set<string>>();
  for (const c of result.contests) {
    const finalists = new Set<string>();
    if (c.scope === "PER_DISTRICT") for (const d of Object.values(c.districts)) if (d.outcome === "RUNOFF") d.finalists?.forEach((f) => finalists.add(f));
    if (c.national.outcome === "RUNOFF") c.national.finalists?.forEach((f) => finalists.add(f));
    if (finalists.size) needs.set(c.id, finalists);
  }
  if (!needs.size) return null;
  if (await db.election.findFirst({ where: { parentId: e.id } })) return null;

  const round = e.round + 1;
  let slug = `${e.slug.replace(/-round-\d+$/, "")}-round-${round}`;
  if (await db.election.findFirst({ where: { orgId: e.orgId, slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  const opensAt = e.runoffAfterHours !== null ? new Date(Date.now() + e.runoffAfterHours * 3600_000) : null;
  const closesAt = opensAt && e.runoffLastsHours ? new Date(opensAt.getTime() + e.runoffLastsHours * 3600_000) : null;
  const child = await db.election.create({
    data: {
      orgId: e.orgId,
      slug,
      title: `${e.title.replace(/ \(round \d+\)$/, "")} (round ${round})`,
      summary: e.summary,
      status: opensAt && closesAt ? "READY" : "DRAFT",
      access: e.access,
      routes: e.routes,
      transparency: e.transparency,
      handsLive: e.handsLive,
      resultsMode: e.resultsMode,
      turnoutLive: e.turnoutLive,
      allowRevote: e.allowRevote,
      districtSetId: e.districtSetId,
      districtAssign: e.districtAssign,
      fraud: e.fraud,
      heldDefault: e.heldDefault,
      notices: e.notices,
      discordRoleIds: e.discordRoleIds,
      discordMinAgeDays: e.discordMinAgeDays,
      round,
      parentId: e.id,
      opensAt,
      closesAt,
      createdById: e.createdById,
    },
  });
  // Only the papers that need a second round, with only their finalists; a second round decides by plurality.
  for (const c of e.contests) {
    const finalists = needs.get(c.id);
    if (!finalists) continue;
    const nc = await db.contest.create({
      data: { electionId: child.id, position: c.position, title: c.title, instruction: c.instruction, method: c.method, maxChoices: c.maxChoices, seats: c.seats, scope: c.scope, rule: JSON.stringify({ ...JSON.parse(c.rule || "{}"), win: "PLURALITY" }) },
    });
    let pos = 0;
    for (const o of c.options) {
      if (!finalists.has(o.id)) continue;
      await db.option.create({ data: { contestId: nc.id, districtId: o.districtId, name: o.name, subtitle: o.subtitle, partyId: o.partyId, color: o.color, symbol: o.symbol, photoId: o.photoId, statement: o.statement, position: pos++ } });
    }
  }
  // An invite-only roll carries over, fresh: same people, nobody has voted yet.
  if (e.access === "INVITE") {
    const lines = await db.rollEntry.findMany({ where: { electionId: e.id, status: { not: "BLOCKED" } } });
    for (const l of lines) {
      if (l.identityKey.startsWith("code:")) continue;
      await db.rollEntry.create({ data: { electionId: child.id, identityKey: l.identityKey, route: l.route, registerEntryId: l.registerEntryId, userId: l.userId, emailEnc: l.emailEnc, emailMasked: l.emailMasked, emailKeyHash: l.emailKeyHash, displayName: l.displayName, districtId: l.districtId } });
    }
  }
  await audit({ orgId: e.orgId, actorLabel: "the count", action: "election.runoff", entity: "Election", entityId: child.id, details: { from: e.id, round } });
  return child.id;
}
