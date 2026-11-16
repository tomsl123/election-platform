// The life of an election: drafted, set up, scheduled, opened, closed, cancelled.
// Ballot papers (contests) and their options are edited only before the polls open.
import type { Contest, Election, ListCandidate, Option, Organisation, Prisma } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { Problem } from "./problem";
import { bump } from "./live";
import { freezeDistricts, thawDistricts } from "./districts";
import { slugify, type Actor } from "./action";
import type { StationContest } from "./marks";
import {
  EDITABLE_STATUS,
  defaultPolicy,
  parseRoutes,
  parseRule,
  type Access,
  type ElectionStatus,
  type Method,
} from "./types";

export class ElectionError extends Problem {}

export const electionInclude = {
  contests: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" }, include: { listCandidates: { orderBy: { position: "asc" } } } }, districts: true },
  },
} satisfies Prisma.ElectionInclude;
export type FullElection = Prisma.ElectionGetPayload<{ include: typeof electionInclude }>;

export async function getElection(orgId: string, id: string): Promise<FullElection | null> {
  return db.election.findFirst({ where: { id, orgId }, include: electionInclude });
}

export function isEditable(e: Pick<Election, "status">): boolean {
  return (EDITABLE_STATUS as readonly string[]).includes(e.status);
}

export function assertEditable(e: Pick<Election, "status">) {
  if (!isEditable(e)) throw new ElectionError("The polls have opened: the papers and the rules can no longer change.");
}

async function freeSlug(orgId: string, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || "election";
  for (let i = 0; i < 100; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await db.election.findFirst({ where: { orgId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
    if (!taken) return slug;
  }
  throw new ElectionError("Choose another address for this election.");
}

export async function createElection(org: Organisation, actor: Actor, input: { title: string; access: Access }) {
  const title = input.title.trim();
  if (title.length < 2) throw new ElectionError("Give the election a title.");
  const slug = await freeSlug(org.id, title);
  const e = await db.election.create({
    data: {
      orgId: org.id,
      slug,
      title,
      access: input.access,
      routes: JSON.stringify(input.access === "PUBLIC" ? ["EMAIL_CODE"] : ["LINK", "ACCOUNT"]),
      fraud: JSON.stringify(defaultPolicy(input.access)),
      createdById: actor.id,
    },
  });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "election.created", entity: "Election", entityId: e.id, ip: actor.ip, details: { title, access: input.access } });
  return e;
}

export type SetupInput = Partial<
  Pick<
    Election,
    | "title"
    | "summary"
    | "access"
    | "transparency"
    | "handsLive"
    | "resultsMode"
    | "turnoutLive"
    | "allowRevote"
    | "districtSetId"
    | "districtAssign"
    | "heldDefault"
    | "fraud"
    | "notices"
    | "routes"
    | "discordRoleIds"
    | "discordMinAgeDays"
    | "opensAt"
    | "closesAt"
    | "nominationsOpenAt"
    | "nominationsCloseAt"
    | "runoffAfterHours"
    | "runoffLastsHours"
  >
> & { slug?: string };

export async function saveSetup(org: Organisation, id: string, actor: Actor, input: SetupInput) {
  const e = await db.election.findFirstOrThrow({ where: { id, orgId: org.id } });
  assertEditable(e);
  const data: Prisma.ElectionUpdateInput = { ...input };
  if (input.slug !== undefined) data.slug = await freeSlug(org.id, input.slug || input.title || e.title, e.id);
  if (input.access === "INVITE" && input.routes) {
    data.routes = JSON.stringify(parseRoutes(input.routes).filter((r) => r !== "EMAIL_CODE"));
  }
  if (input.opensAt && input.closesAt && input.closesAt <= input.opensAt) throw new ElectionError("The polls must close after they open.");
  if (input.closesAt && input.closesAt <= new Date()) throw new ElectionError("The closing time has already passed.");
  if (input.districtSetId) {
    const set = await db.districtSet.findFirst({ where: { id: input.districtSetId, orgId: org.id } });
    if (!set) throw new ElectionError("That district set does not belong to this organisation.");
  }
  // Changing the district set invalidates per-district options.
  if (input.districtSetId !== undefined && input.districtSetId !== e.districtSetId) {
    await db.option.updateMany({ where: { contest: { electionId: e.id }, districtId: { not: null } }, data: { districtId: null } });
    await db.contestDistrict.deleteMany({ where: { contest: { electionId: e.id } } });
  }
  await db.election.update({ where: { id: e.id }, data });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "election.setup", entity: "Election", entityId: e.id, ip: actor.ip });
}

// ── Ballot papers ───────────────────────────────────────────────────────────

const YES_NO = [
  { name: "Yes", kind: "YES", color: "#2f7d55", symbol: "yes" },
  { name: "No", kind: "NO", color: "#b3261e", symbol: "no" },
];

async function editableByContest(contestId: string, orgId: string) {
  const c = await db.contest.findFirst({ where: { id: contestId, election: { orgId } }, include: { election: true } });
  if (!c) throw new ElectionError("That paper does not exist.");
  assertEditable(c.election);
  return c;
}

export type ContestInput = { title: string; instruction: string; method: Method; maxChoices: number; seats: number; scope: "NATIONAL" | "PER_DISTRICT"; rule: string };

export async function addContest(org: Organisation, electionId: string, actor: Actor, input: ContestInput) {
  const e = await db.election.findFirstOrThrow({ where: { id: electionId, orgId: org.id } });
  assertEditable(e);
  if (input.scope === "PER_DISTRICT" && !e.districtSetId) throw new ElectionError("Choose a district set in the setup before adding a paper per district.");
  const position = await db.contest.count({ where: { electionId } });
  const c = await db.contest.create({ data: { ...normaliseContest(input), electionId, position } });
  if (input.method === "YESNO") {
    for (const [i, o] of YES_NO.entries()) await db.option.create({ data: { ...o, contestId: c.id, position: i } });
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "contest.added", entity: "Contest", entityId: c.id, ip: actor.ip, details: { title: c.title, method: c.method } });
  return c;
}

function normaliseContest(input: ContestInput) {
  const title = input.title.trim();
  if (title.length < 1) throw new ElectionError("Give the paper a title.");
  const rule = parseRule(input.rule);
  return {
    title,
    instruction: input.instruction.trim().slice(0, 200),
    method: input.method,
    maxChoices: input.method === "MULTI" ? Math.max(2, Math.min(50, input.maxChoices)) : 1,
    seats: Math.max(1, Math.min(1000, input.seats)),
    scope: input.scope,
    rule: JSON.stringify(rule),
  };
}

export async function updateContest(org: Organisation, contestId: string, actor: Actor, input: ContestInput) {
  const c = await editableByContest(contestId, org.id);
  if (input.scope === "PER_DISTRICT" && !c.election.districtSetId) throw new ElectionError("Choose a district set in the setup first.");
  if (input.method !== c.method && (input.method === "YESNO" || c.method === "YESNO")) throw new ElectionError("A referendum paper cannot be turned into another kind; add a new paper instead.");
  await db.contest.update({ where: { id: c.id }, data: normaliseContest(input) });
  if (input.scope === "NATIONAL") await db.option.updateMany({ where: { contestId: c.id }, data: { districtId: null } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "contest.changed", entity: "Contest", entityId: c.id, ip: actor.ip });
}

export async function removeContest(org: Organisation, contestId: string, actor: Actor) {
  const c = await editableByContest(contestId, org.id);
  await db.contest.delete({ where: { id: c.id } });
  const rest = await db.contest.findMany({ where: { electionId: c.electionId }, orderBy: { position: "asc" } });
  for (const [i, r] of rest.entries()) await db.contest.update({ where: { id: r.id }, data: { position: i } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "contest.removed", entity: "Contest", entityId: c.id, ip: actor.ip, details: { title: c.title } });
}

export async function moveContest(org: Organisation, contestId: string, dir: -1 | 1) {
  const c = await editableByContest(contestId, org.id);
  const all = await db.contest.findMany({ where: { electionId: c.electionId }, orderBy: { position: "asc" } });
  const i = all.findIndex((x) => x.id === c.id);
  const j = i + dir;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  for (const [k, r] of all.entries()) await db.contest.update({ where: { id: r.id }, data: { position: k } });
}

export async function setDistrictSeats(org: Organisation, contestId: string, seats: Record<string, number>) {
  const c = await editableByContest(contestId, org.id);
  for (const [districtId, n] of Object.entries(seats)) {
    if (!Number.isFinite(n) || n < 1) {
      await db.contestDistrict.deleteMany({ where: { contestId: c.id, districtId } });
      continue;
    }
    await db.contestDistrict.upsert({ where: { contestId_districtId: { contestId: c.id, districtId } }, create: { contestId: c.id, districtId, seats: Math.floor(n) }, update: { seats: Math.floor(n) } });
  }
}

export type OptionInput = {
  name: string;
  subtitle: string;
  partyId: string | null;
  color: string;
  symbol: string;
  statement: string;
  districtId: string | null;
  photoId?: string | null;
  list: string[];
};

async function optionData(orgId: string, input: OptionInput) {
  const name = input.name.trim();
  if (!name) throw new ElectionError("Give the option a name.");
  let { subtitle, color, symbol } = input;
  if (input.partyId) {
    const party = await db.party.findFirst({ where: { id: input.partyId, orgId } });
    if (!party) throw new ElectionError("That party does not belong to this organisation.");
    subtitle ||= party.abbr;
    if (!/^#[0-9a-f]{6}$/i.test(color) || color === "#23201c") color = party.color;
    symbol ||= party.symbol;
  }
  return {
    name: name.slice(0, 120),
    subtitle: subtitle.trim().slice(0, 80),
    partyId: input.partyId || null,
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#23201c",
    symbol: symbol.slice(0, 20),
    statement: input.statement.trim().slice(0, 2000),
    districtId: input.districtId || null,
    ...(input.photoId !== undefined ? { photoId: input.photoId } : {}),
  };
}

async function writeList(optionId: string, list: string[]) {
  await db.listCandidate.deleteMany({ where: { optionId } });
  const names = list.map((n) => n.trim()).filter(Boolean).slice(0, 500);
  for (const [i, name] of names.entries()) await db.listCandidate.create({ data: { optionId, position: i, name: name.slice(0, 120) } });
}

export async function addOption(org: Organisation, contestId: string, actor: Actor, input: OptionInput) {
  const c = await editableByContest(contestId, org.id);
  if (c.method === "YESNO") throw new ElectionError("A referendum paper has exactly Yes and No.");
  const position = await db.option.count({ where: { contestId } });
  const o = await db.option.create({ data: { ...(await optionData(org.id, input)), contestId, position } });
  if (c.method === "PARTY_LIST") await writeList(o.id, input.list);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "option.added", entity: "Option", entityId: o.id, ip: actor.ip, details: { name: o.name } });
  return o;
}

export async function updateOption(org: Organisation, optionId: string, actor: Actor, input: OptionInput) {
  const o = await db.option.findFirst({ where: { id: optionId, contest: { election: { orgId: org.id } } }, include: { contest: { include: { election: true } } } });
  if (!o) throw new ElectionError("That option does not exist.");
  assertEditable(o.contest.election);
  const data = await optionData(org.id, input);
  if (o.contest.method === "YESNO") {
    // Yes and No keep their meaning; only the wording and look may change.
    await db.option.update({ where: { id: o.id }, data: { name: data.name, subtitle: data.subtitle, color: data.color, symbol: data.symbol } });
  } else await db.option.update({ where: { id: o.id }, data });
  if (o.contest.method === "PARTY_LIST") await writeList(o.id, input.list);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "option.changed", entity: "Option", entityId: o.id, ip: actor.ip });
}

export async function setOptionStatus(org: Organisation, optionId: string, actor: Actor, status: "APPROVED" | "REJECTED" | "PENDING" | "WITHDRAWN") {
  const o = await db.option.findFirst({ where: { id: optionId, contest: { election: { orgId: org.id } } }, include: { contest: { include: { election: true } } } });
  if (!o) throw new ElectionError("That option does not exist.");
  assertEditable(o.contest.election);
  await db.option.update({ where: { id: o.id }, data: { status } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: `option.${status.toLowerCase()}`, entity: "Option", entityId: o.id, ip: actor.ip, details: { name: o.name } });
  return o;
}

export async function removeOption(org: Organisation, optionId: string, actor: Actor) {
  const o = await db.option.findFirst({ where: { id: optionId, contest: { election: { orgId: org.id } } }, include: { contest: { include: { election: true } } } });
  if (!o) throw new ElectionError("That option does not exist.");
  assertEditable(o.contest.election);
  if (o.contest.method === "YESNO") throw new ElectionError("A referendum paper has exactly Yes and No.");
  await db.option.delete({ where: { id: o.id } });
  const rest = await db.option.findMany({ where: { contestId: o.contestId }, orderBy: { position: "asc" } });
  for (const [i, r] of rest.entries()) await db.option.update({ where: { id: r.id }, data: { position: i } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "option.removed", entity: "Option", entityId: o.id, ip: actor.ip, details: { name: o.name } });
}

export async function moveOption(org: Organisation, optionId: string, dir: -1 | 1) {
  const o = await db.option.findFirst({ where: { id: optionId, contest: { election: { orgId: org.id } } }, include: { contest: { include: { election: true } } } });
  if (!o) return;
  assertEditable(o.contest.election);
  const all = await db.option.findMany({ where: { contestId: o.contestId }, orderBy: { position: "asc" } });
  const i = all.findIndex((x) => x.id === o.id);
  const j = i + dir;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  for (const [k, r] of all.entries()) await db.option.update({ where: { id: r.id }, data: { position: k } });
}

// ── What a voter sees ───────────────────────────────────────────────────────

type ContestWithOptions = Contest & { options: Array<Option & { listCandidates: ListCandidate[] }> };

/** Party id → logo upload id, for the parties of one organisation that have a logo. */
export async function partyLogos(orgId: string): Promise<Record<string, string>> {
  const rows = await db.party.findMany({ where: { orgId, logoId: { not: null } }, select: { id: true, logoId: true } });
  return Object.fromEntries(rows.map((p) => [p.id, p.logoId!]));
}

/** The papers for one voter: approved options only, and the options of their own district on per-district papers. */
export function stationContests(contests: ContestWithOptions[], districtId: string | null, logos: Record<string, string> = {}): StationContest[] {
  return contests
    .map((c) => {
      const rule = parseRule(c.rule);
      const options = c.options.filter((o) => o.status === "APPROVED" && (c.scope === "NATIONAL" || o.districtId === districtId));
      return {
        id: c.id,
        title: c.title,
        instruction: c.instruction,
        method: c.method as StationContest["method"],
        maxChoices: c.maxChoices,
        scoreMax: rule.scoreMax,
        allowBlank: rule.allowBlank,
        options: options.map((o) => ({
          id: o.id,
          name: o.name,
          subtitle: o.subtitle,
          color: o.color,
          symbol: o.symbol,
          photoUrl: o.photoId ? `/api/files/${o.photoId}` : null,
          logoUrl: o.partyId && logos[o.partyId] ? `/api/files/${logos[o.partyId]}` : null,
          list: o.listCandidates.map((l) => l.name),
        })),
      };
    })
    .filter((c) => c.options.length > 0);
}

// ── Opening and closing ─────────────────────────────────────────────────────

/** Everything that stands between this election and its opening. Empty means it may open. */
export async function openProblems(e: FullElection): Promise<string[]> {
  const out: string[] = [];
  if (e.contests.length === 0) out.push("Add at least one ballot paper.");
  const routes = parseRoutes(e.routes);
  if (routes.length === 0) out.push("Allow at least one way in (entry routes in the setup).");
  if (e.closesAt && e.closesAt <= new Date()) out.push("The closing time has already passed.");
  for (const c of e.contests) {
    const approved = c.options.filter((o) => o.status === "APPROVED");
    if (c.scope === "PER_DISTRICT") {
      const districts = e.districtSetId ? await db.district.findMany({ where: { setId: e.districtSetId } }) : [];
      for (const d of districts) {
        const n = approved.filter((o) => o.districtId === d.id).length;
        if (n > 0 && n < 2 && c.method !== "YESNO") out.push(`"${c.title}" has only one option in ${d.name}.`);
      }
      if (!approved.some((o) => o.districtId)) out.push(`"${c.title}" has no options in any district.`);
    } else if (approved.length < 2) out.push(`"${c.title}" needs at least two options.`);
    if (c.method === "MULTI" && c.maxChoices >= approved.length && approved.length > 0 && c.scope === "NATIONAL") out.push(`"${c.title}" lets voters mark every option; lower "mark up to".`);
    if (c.method === "PARTY_LIST" && c.seats < 1) out.push(`"${c.title}" needs seats to fill.`);
  }
  if (e.access === "INVITE") {
    const dynamic = routes.some((r) => r === "DISCORD" || r === "CODE");
    const roll = await db.rollEntry.count({ where: { electionId: e.id } });
    const codes = await db.accessCode.count({ where: { electionId: e.id } });
    if (!dynamic && roll === 0) out.push("The roll is empty: add voters before opening.");
    if (routes.includes("CODE") && codes === 0) out.push("Code cards are allowed but none have been made.");
    if (routes.includes("DISCORD") && JSON.parse(e.discordRoleIds || "[]").length === 0) out.push("Discord entry needs at least one role.");
  }
  if (e.districtAssign !== "NONE" && !e.districtSetId) out.push("Choose the district set voters belong to.");
  return out;
}

async function setStatus(e: Election, status: ElectionStatus, actor: Actor, action: string, extra: Prisma.ElectionUpdateInput = {}) {
  await db.election.update({ where: { id: e.id }, data: { status, ...extra } });
  // The district set is frozen for the election once it leaves draft, and thawed if it goes back.
  if (e.status === "DRAFT" && status !== "DRAFT" && status !== "CANCELLED") await freezeDistricts(e.id);
  else if (status === "DRAFT") await thawDistricts(e.id);
  await audit({ orgId: e.orgId, actorId: actor.id, actorLabel: actor.label, action, entity: "Election", entityId: e.id, ip: actor.ip });
  bump(e.id);
}

/** Marks a draft as ready: it opens by itself at its opening time. */
export async function scheduleElection(org: Organisation, id: string, actor: Actor) {
  const e = await db.election.findFirstOrThrow({ where: { id, orgId: org.id }, include: electionInclude });
  assertEditable(e);
  const problems = await openProblems(e);
  if (problems.length) throw new ElectionError(problems[0]);
  if (!e.opensAt) throw new ElectionError("Set an opening time, or open the polls by hand.");
  await setStatus(e, "READY", actor, "election.scheduled");
  const { afterScheduled } = await import("./events");
  await afterScheduled(e.id);
}

export async function unscheduleElection(org: Organisation, id: string, actor: Actor) {
  const e = await db.election.findFirstOrThrow({ where: { id, orgId: org.id } });
  if (e.status !== "READY") return;
  await setStatus(e, "DRAFT", actor, "election.unscheduled");
}

export async function openElection(electionId: string, actor: Actor) {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId }, include: electionInclude });
  if (!isEditable(e)) throw new ElectionError("These polls have already opened.");
  const problems = await openProblems(e);
  if (problems.length) throw new ElectionError(problems[0]);
  const eligible = await db.rollEntry.count({ where: { electionId: e.id } });
  await setStatus(e, "OPEN", actor, "election.opened", { openedAt: new Date(), eligibleCount: eligible, rollPublishedAt: e.rollPublishedAt ?? (e.access === "INVITE" ? new Date() : null) });
  const { afterOpen } = await import("./events");
  await afterOpen(e.id);
}

export async function cancelElection(org: Organisation, id: string, actor: Actor) {
  const e = await db.election.findFirstOrThrow({ where: { id, orgId: org.id } });
  if (["COUNTED", "CERTIFIED", "CANCELLED"].includes(e.status)) throw new ElectionError("This election can no longer be cancelled.");
  await setStatus(e, "CANCELLED", actor, "election.cancelled", { closedAt: e.status === "OPEN" ? new Date() : e.closedAt });
}

/** Copies an election (papers, options, lists) as a new draft: useful for recurring votes. */
export async function duplicateElection(org: Organisation, id: string, actor: Actor) {
  const e = await getElection(org.id, id);
  if (!e) throw new ElectionError("That election does not exist.");
  const copy = await db.election.create({
    data: {
      orgId: org.id,
      slug: await freeSlug(org.id, `${e.title} copy`),
      title: `${e.title} (copy)`,
      summary: e.summary,
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
      createdById: actor.id,
    },
  });
  await copyPapers(e, copy.id, () => true);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "election.duplicated", entity: "Election", entityId: copy.id, ip: actor.ip, details: { from: e.id } });
  return copy;
}

export async function copyPapers(from: FullElection, toId: string, keep: (c: FullElection["contests"][number], o: FullElection["contests"][number]["options"][number]) => boolean, only?: Set<string>) {
  for (const c of from.contests) {
    if (only && !only.has(c.id)) continue;
    const nc = await db.contest.create({ data: { electionId: toId, position: c.position, title: c.title, instruction: c.instruction, method: c.method, maxChoices: c.maxChoices, seats: c.seats, scope: c.scope, rule: c.rule } });
    for (const d of c.districts) await db.contestDistrict.create({ data: { contestId: nc.id, districtId: d.districtId, seats: d.seats } });
    let pos = 0;
    for (const o of c.options) {
      if (o.status !== "APPROVED" || !keep(c, o)) continue;
      const no = await db.option.create({
        data: { contestId: nc.id, districtId: o.districtId, name: o.name, subtitle: o.subtitle, partyId: o.partyId, color: o.color, symbol: o.symbol, photoId: o.photoId, statement: o.statement, kind: o.kind, position: pos++ },
      });
      for (const l of o.listCandidates) await db.listCandidate.create({ data: { optionId: no.id, position: l.position, name: l.name } });
    }
  }
}
