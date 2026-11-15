import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { admit } from "@/lib/desk";
import { castSitting, closePolls } from "@/lib/ballot";
import { electionInclude, stationContests } from "@/lib/elections";
import { defaultPolicy } from "@/lib/types";
import type { Result } from "@/lib/count";

describe("constituencies", () => {
  it("gives each Cliff its own lists, counts them apart, and adds the seats up by party", async () => {
    const org = await db.organisation.create({ data: { slug: "cliffs", name: "Cliffs", shortName: "C" } });
    const set = await db.districtSet.create({ data: { orgId: org.id, name: "Cliffs" } });
    const north = await db.district.create({ data: { setId: set.id, name: "Snowbelle", code: "SNOW", position: 0 } });
    const south = await db.district.create({ data: { setId: set.id, name: "Eternal Sand", code: "SAND", position: 1 } });
    const red = await db.party.create({ data: { orgId: org.id, name: "Red", abbr: "R", color: "#c22a2a" } });
    const blue = await db.party.create({ data: { orgId: org.id, name: "Blue", abbr: "B", color: "#2456a6" } });
    const policy = defaultPolicy("PUBLIC");
    policy.actions.DEVICE_REPEAT = "IGNORE";
    const e = await db.election.create({
      data: { orgId: org.id, slug: "gathering", title: "National Gathering", status: "OPEN", districtSetId: set.id, districtAssign: "SELF", fraud: JSON.stringify(policy) },
    });
    const c = await db.contest.create({ data: { electionId: e.id, title: "National Gathering", method: "PARTY_LIST", scope: "PER_DISTRICT", seats: 4, rule: JSON.stringify({ pr: "DHONDT" }) } });
    await db.contestDistrict.create({ data: { contestId: c.id, districtId: south.id, seats: 2 } });
    const lists: Record<string, string> = {};
    for (const d of [north, south])
      for (const p of [red, blue]) lists[`${d.code}-${p.abbr}`] = (await db.option.create({ data: { contestId: c.id, districtId: d.id, partyId: p.id, name: `${p.name} ${d.name}`, subtitle: p.abbr } })).id;

    const full = await db.election.findUniqueOrThrow({ where: { id: e.id }, include: electionInclude });
    const northPaper = stationContests(full.contests, north.id)[0];
    const southPaper = stationContests(full.contests, south.id)[0];
    expect(northPaper.options.map((o) => o.name)).toEqual(["Red Snowbelle", "Blue Snowbelle"]);
    expect(southPaper.options.map((o) => o.name)).toEqual(["Red Eternal Sand", "Blue Eternal Sand"]);
    expect(stationContests(full.contests, null)).toHaveLength(0);

    const votes: Array<[string, string]> = [
      ["SNOW", "R"], ["SNOW", "R"], ["SNOW", "R"], ["SNOW", "B"],
      ["SAND", "B"], ["SAND", "B"], ["SAND", "R"],
    ];
    for (const [i, [d, p]] of votes.entries()) {
      const r = await admit({ election: full, route: "EMAIL_CODE", keys: [`email:d${i}`], email: `d${i}@c.test`, districtId: d === "SNOW" ? north.id : south.id, mayCreate: true, evidence: { ip: "", userAgent: "t", deviceId: "", deviceFp: "", email: null } });
      if (!("pass" in r)) throw new Error(r.outcome);
      // A voter cannot mark the other Cliff's list.
      const other = lists[`${d === "SNOW" ? "SAND" : "SNOW"}-${p}`];
      await expect(castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [other] } }] })).rejects.toThrow();
      await castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [lists[`${d}-${p}`]] } }] });
    }
    await closePolls(e.id, { id: null, label: "test" });
    const result = JSON.parse((await db.election.findUniqueOrThrow({ where: { id: e.id } })).result!) as Result;
    const g = result.contests[0];
    // Snowbelle: 3 to 1 for four seats → Red 3, Blue 1. Eternal Sand: 1 to 2 for two seats → Blue's second
    // quotient (2/2) ties Red's first (1/1) and the list with more votes takes it → Blue 2, Red 0.
    expect(g.districts[north.id].seats).toEqual({ [lists["SNOW-R"]]: 3, [lists["SNOW-B"]]: 1 });
    expect(g.districts[south.id].seats).toEqual({ [lists["SAND-R"]]: 0, [lists["SAND-B"]]: 2 });
    expect(g.national.byParty).toEqual({ [red.id]: { votes: 4, seats: 3 }, [blue.id]: { votes: 3, seats: 3 } });
    expect(result.turnout.byDistrict).toEqual({ [north.id]: 4, [south.id]: 3 });
  });
});
