// Demo elections. Called by seed.ts on an empty database.
import type { PrismaClient } from "@prisma/client";
import { defaultPolicy } from "../src/lib/types";

export async function seedElections(db: PrismaClient, orgId: string, ownerId: string) {
  const parties = Object.fromEntries((await db.party.findMany({ where: { orgId } })).map((p) => [p.abbr, p]));
  const week = new Date(Date.now() + 7 * 86400_000);

  // An open public election: the three papers of the design study.
  const fed = await db.election.create({
    data: {
      orgId,
      slug: "federal-polling-day",
      title: "Federal Polling Day",
      summary: "The Prime Minister, a referendum, and the host of JK Days.",
      status: "OPEN",
      access: "PUBLIC",
      routes: JSON.stringify(["EMAIL_CODE"]),
      fraud: JSON.stringify(defaultPolicy("PUBLIC")),
      openedAt: new Date(),
      closesAt: week,
      createdById: ownerId,
    },
  });
  const pm = await db.contest.create({ data: { electionId: fed.id, position: 0, title: "Prime Minister", method: "SINGLE", rule: JSON.stringify({ win: "MAJORITY_RUNOFF", majorityPct: 50, allowBlank: false }) } });
  for (const [i, [name, abbr]] of [
    ["Gen. Revolucionez", "UPSF"],
    ["Rev. Builderswartz", "CUP"],
    ["Prof. Simons", "CA"],
    ["Zeman Planovsky", "KKKK"],
  ].entries()) {
    const p = parties[abbr];
    await db.option.create({ data: { contestId: pm.id, position: i, name, subtitle: abbr, partyId: p?.id, color: p?.color ?? "#23201c", symbol: p?.symbol ?? "" } });
  }
  const ref = await db.contest.create({ data: { electionId: fed.id, position: 1, title: "Referendum", instruction: "Hold the Senate elections again?", method: "YESNO" } });
  await db.option.create({ data: { contestId: ref.id, position: 0, name: "Yes", kind: "YES", color: "#2f7d55", symbol: "yes" } });
  await db.option.create({ data: { contestId: ref.id, position: 1, name: "No", kind: "NO", color: "#b3261e", symbol: "no" } });
  const jk = await db.contest.create({ data: { electionId: fed.id, position: 2, title: "JK Days host", method: "MULTI", maxChoices: 2, seats: 1 } });
  for (const [i, [name, color, symbol]] of [
    ["Dead End Cliff", "#6c4fa3", "mountain"],
    ["Snowbelle Cliff", "#3c8fb5", "snow"],
    ["Eternal Sand Cliff", "#c9792b", "dune"],
    ["Endless Steppe Cliff", "#6f8f2f", "grass"],
  ].entries()) {
    await db.option.create({ data: { contestId: jk.id, position: i, name, color, symbol } });
  }

  // A constituency election: party lists in every Cliff, fifty seats each, shared by D'Hondt.
  const set = await db.districtSet.findFirst({ where: { orgId, name: "Cliffs" }, include: { districts: { orderBy: { position: "asc" } } } });
  if (set) {
    const ng = await db.election.create({
      data: {
        orgId,
        slug: "national-gathering",
        title: "National Gathering",
        summary: "Fifty representatives from every Cliff, by party list.",
        status: "OPEN",
        access: "PUBLIC",
        routes: JSON.stringify(["EMAIL_CODE"]),
        fraud: JSON.stringify(defaultPolicy("PUBLIC")),
        districtSetId: set.id,
        districtAssign: "SELF",
        resultsMode: "LIVE",
        openedAt: new Date(),
        closesAt: week,
        createdById: ownerId,
      },
    });
    const c = await db.contest.create({ data: { electionId: ng.id, position: 0, title: "National Gathering", method: "PARTY_LIST", scope: "PER_DISTRICT", seats: 50, rule: JSON.stringify({ pr: "DHONDT", prThresholdPct: 5, allowBlank: false }) } });
    const names = ["Simons", "Salzburg", "Predkozkyn", "Planovsky", "Rootman", "Norton", "Harper", "Revolton", "Cheap", "Naran", "Tudlenudle", "Gorgonzola"];
    for (const d of set.districts) {
      for (const [i, abbr] of ["UPSF", "CUP", "CA", "KKKK"].entries()) {
        const p = parties[abbr];
        const opt = await db.option.create({ data: { contestId: c.id, districtId: d.id, position: i, name: `${p?.name ?? abbr}`, subtitle: abbr, partyId: p?.id, color: p?.color ?? "#23201c", symbol: p?.symbol ?? "" } });
        for (let k = 0; k < 6; k++) await db.listCandidate.create({ data: { optionId: opt.id, position: k, name: `${names[(i * 3 + k + d.position) % names.length]} of ${d.code}` } });
      }
    }
  }
}
