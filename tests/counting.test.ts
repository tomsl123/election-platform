import { beforeAll, describe, expect, it } from "vitest";
import type { Organisation } from "@prisma/client";
import { db } from "@/lib/db";
import { admit } from "@/lib/desk";
import { castSitting, certifyElection, closePolls, verifyElection } from "@/lib/ballot";
import { defaultPolicy } from "@/lib/types";
import type { Result } from "@/lib/count";

const actor = { id: null, label: "test" };
let org: Organisation;
let n = 0;

async function election(rule: object, extra: object = {}) {
  n++;
  return db.election.create({
    data: {
      orgId: org.id,
      slug: `c${n}`,
      title: `Count ${n}`,
      status: "OPEN",
      fraud: JSON.stringify({ ...defaultPolicy("PUBLIC"), actions: { ...defaultPolicy("PUBLIC").actions, DEVICE_REPEAT: "IGNORE" } }),
      ...extra,
      contests: { create: { title: "Prime Minister", method: "SINGLE", position: 0, rule: JSON.stringify(rule), options: { create: [{ name: "A", position: 0 }, { name: "B", position: 1 }, { name: "C", position: 2 }] } } },
    },
    include: { contests: { include: { options: true } } },
  });
}

async function vote(e: Awaited<ReturnType<typeof election>>, who: string, optionIndex: number, hold = false) {
  const c = e.contests[0];
  const fresh = await db.election.findUniqueOrThrow({ where: { id: e.id } });
  const r = await admit({ election: fresh, route: "EMAIL_CODE", keys: [`email:${who}`], email: `${who}@c.test`, mayCreate: true, evidence: { ip: "", userAgent: "t", deviceId: "", deviceFp: "", email: `${who}@c.test` } });
  if (!("pass" in r)) throw new Error(r.outcome);
  if (hold) await db.boothPass.updateMany({ where: { rollEntryId: r.line.id, usedAt: null }, data: { hold: true, reasons: '["IP_SHARED"]' } });
  return castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [c.options[optionIndex].id] } }] });
}

beforeAll(async () => {
  org = await db.organisation.create({ data: { slug: "count-org", name: "C", shortName: "C" } });
});

describe("the count", () => {
  it("shuffles, chains, seals, recounts and certifies", async () => {
    const e = await election({ win: "PLURALITY" });
    await vote(e, "v1", 0);
    await vote(e, "v2", 0);
    await vote(e, "v3", 1);
    const r = await closePolls(e.id, actor);
    expect(r.counted).toBe(true);
    const done = await db.election.findUniqueOrThrow({ where: { id: e.id } });
    expect(done.status).toBe("COUNTED");
    const result = JSON.parse(done.result!) as Result;
    const c = result.contests[0];
    expect(c.national.totals).toEqual({ [e.contests[0].options[0].id]: 2, [e.contests[0].options[1].id]: 1, [e.contests[0].options[2].id]: 0 });
    expect(c.national.winners).toEqual([e.contests[0].options[0].id]);
    expect(result.turnout.voted).toBe(3);
    const chained = await db.ballot.findMany({ where: { electionId: e.id }, orderBy: { seq: "asc" } });
    expect(chained.map((b) => b.seq)).toEqual([1, 2, 3]);
    expect(chained.every((b) => b.revoteTag === null && b.rollEntryId === null)).toBe(true);
    expect((await verifyElection(e.id)).ok).toBe(true);
    await certifyElection(e.id, actor);
    expect((await db.election.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("CERTIFIED");
  });

  it("notices a tampered ballot", async () => {
    const e = await election({ win: "PLURALITY" });
    await vote(e, "t1", 0);
    await vote(e, "t2", 1);
    await closePolls(e.id, actor);
    const b = await db.ballot.findFirstOrThrow({ where: { electionId: e.id, seq: 1 } });
    await db.ballot.update({ where: { id: b.id }, data: { data: JSON.stringify({ x: [e.contests[0].options[2].id] }) } });
    const v = await verifyElection(e.id);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/does not match its hash/);
    await expect(certifyElection(e.id, actor)).rejects.toThrow(/recount/);
  });

  it("waits for held envelopes before counting", async () => {
    const e = await election({ win: "PLURALITY" });
    await vote(e, "h1", 0);
    await vote(e, "h2", 1, true);
    const r = await closePolls(e.id, actor);
    expect(r.counted).toBe(false);
    expect(r.message).toMatch(/1 held envelope/);
    expect((await db.election.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("CLOSED");
  });

  it("counts held envelopes when the election says so", async () => {
    const e = await election({ win: "PLURALITY" }, { heldDefault: "ACCEPT" });
    await vote(e, "a1", 0);
    await vote(e, "a2", 1, true);
    const r = await closePolls(e.id, actor);
    expect(r.counted).toBe(true);
    const result = JSON.parse((await db.election.findUniqueOrThrow({ where: { id: e.id } })).result!) as Result;
    expect(result.ballots).toBe(2);
  });

  it("counts every kind of paper in one sitting", async () => {
    n++;
    const e = await db.election.create({
      data: {
        orgId: org.id,
        slug: `all${n}`,
        title: "All methods",
        status: "OPEN",
        fraud: JSON.stringify({ ...defaultPolicy("PUBLIC"), actions: { ...defaultPolicy("PUBLIC").actions, DEVICE_REPEAT: "IGNORE" } }),
        contests: {
          create: [
            { position: 0, title: "Host", method: "MULTI", maxChoices: 2, seats: 2, options: { create: [{ name: "X", position: 0 }, { name: "Y", position: 1 }, { name: "Z", position: 2 }] } },
            { position: 1, title: "Chair", method: "RANKED", seats: 1, options: { create: [{ name: "R1", position: 0 }, { name: "R2", position: 1 }, { name: "R3", position: 2 }] } },
            { position: 2, title: "Rate", method: "SCORE", rule: JSON.stringify({ scoreMax: 5 }), options: { create: [{ name: "S1", position: 0 }, { name: "S2", position: 1 }] } },
            { position: 3, title: "Gathering", method: "PARTY_LIST", seats: 5, rule: JSON.stringify({ pr: "DHONDT" }), options: { create: [{ name: "L1", position: 0, listCandidates: { create: [{ position: 0, name: "Ana" }, { position: 1, name: "Bo" }, { position: 2, name: "Cy" }] } }, { name: "L2", position: 1 }] } },
          ],
        },
      },
      include: { contests: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
    });
    const [host, chair, rate, gathering] = e.contests;
    const o = (c: typeof host, i: number) => c.options[i].id;
    const sittings = [
      [{ x: [o(host, 0), o(host, 1)] }, { r: [o(chair, 0), o(chair, 1)] }, { s: { [o(rate, 0)]: 5, [o(rate, 1)]: 2 } }, { x: [o(gathering, 0)] }],
      [{ x: [o(host, 1)] }, { r: [o(chair, 1)] }, { s: { [o(rate, 0)]: 1, [o(rate, 1)]: 3 } }, { x: [o(gathering, 0)] }],
      [{ x: [o(host, 1), o(host, 2)] }, { r: [o(chair, 2), o(chair, 1)] }, { s: { [o(rate, 1)]: 4 } }, { x: [o(gathering, 1)] }],
    ];
    for (const [i, marks] of sittings.entries()) {
      const fresh = await db.election.findUniqueOrThrow({ where: { id: e.id } });
      const r = await admit({ election: fresh, route: "EMAIL_CODE", keys: [`email:all${i}`], email: `all${i}@c.test`, mayCreate: true, evidence: { ip: "", userAgent: "t", deviceId: "", deviceFp: "", email: null } });
      if (!("pass" in r)) throw new Error(r.outcome);
      await castSitting({ electionId: e.id, passRaw: r.pass, marks: e.contests.map((c, k) => ({ contestId: c.id, data: marks[k] })) });
    }
    await closePolls(e.id, actor);
    const result = JSON.parse((await db.election.findUniqueOrThrow({ where: { id: e.id } })).result!) as Result;
    const [rHost, rChair, rRate, rGathering] = result.contests;
    // X 1, Y 3, Z 1 for two seats: Y is in, X and Z tie for the second seat.
    expect(rHost.national.outcome).toBe("TIED");
    expect(rHost.national.winners).toEqual([o(host, 1)]);
    expect([...(rHost.national.tied ?? [])].sort()).toEqual([o(host, 0), o(host, 2)].sort());
    expect(rHost.national.totals[o(host, 1)]).toBe(3);
    // R1 1, R2 1, R3 1 first preferences; ties for last are broken by first round, then R2 collects.
    expect(rChair.national.winners).toEqual([o(chair, 1)]);
    expect(rRate.national.sums).toEqual({ [o(rate, 0)]: 6, [o(rate, 1)]: 9 });
    expect(rRate.national.winners).toEqual([o(rate, 1)]);
    expect(rGathering.national.seats).toEqual({ [o(gathering, 0)]: 4, [o(gathering, 1)]: 1 });
    expect(rGathering.national.seated?.[o(gathering, 0)]).toEqual(["Ana", "Bo", "Cy"]);
    expect((await verifyElection(e.id)).ok).toBe(true);
  });

  it("draws up a second round when nobody has a majority", async () => {
    const e = await election({ win: "MAJORITY_RUNOFF", majorityPct: 50 }, { runoffAfterHours: 1, runoffLastsHours: 24 });
    await vote(e, "r1", 0);
    await vote(e, "r2", 0);
    await vote(e, "r3", 1);
    await vote(e, "r4", 2);
    await closePolls(e.id, actor);
    const child = await db.election.findFirstOrThrow({ where: { parentId: e.id }, include: { contests: { include: { options: true } } } });
    expect(child.round).toBe(2);
    expect(child.status).toBe("READY");
    // A has 2 of 4 (not more than half); B and C tie for second, so both go through with A.
    expect(child.contests[0].options.map((o) => o.name).sort()).toEqual(["A", "B", "C"]);
  });
});
