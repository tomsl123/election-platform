import { beforeAll, describe, expect, it } from "vitest";
import type { Election, Organisation } from "@prisma/client";
import { db } from "@/lib/db";
import { admit } from "@/lib/desk";
import { castSitting, lookupReceipt } from "@/lib/ballot";
import { identityCandidates } from "@/lib/roll";
import { defaultPolicy } from "@/lib/types";

let org: Organisation;
let n = 0;

async function election(over: Partial<Election> = {}) {
  n++;
  const e = await db.election.create({
    data: {
      orgId: org.id,
      slug: `e${n}`,
      title: `Election ${n}`,
      status: "OPEN",
      access: "PUBLIC",
      routes: '["EMAIL_CODE"]',
      fraud: JSON.stringify(defaultPolicy("PUBLIC")),
      ...over,
      contests: { create: { title: "Prime Minister", method: "SINGLE", position: 0, options: { create: [{ name: "A", position: 0 }, { name: "B", position: 1 }] } } },
    },
    include: { contests: { include: { options: true } } },
  });
  return e;
}

const ev = (deviceId = "", ip = "") => ({ ip, userAgent: "test", deviceId, deviceFp: "", email: null });

async function visit(e: Election, email: string, deviceId = "") {
  return admit({ election: e, route: "EMAIL_CODE", keys: await identityCandidates(org.id, { email }), email, mayCreate: true, evidence: { ...ev(deviceId), email } });
}

beforeAll(async () => {
  org = await db.organisation.create({ data: { slug: "test-org", name: "Test", shortName: "T" } });
});

describe("casting", () => {
  it("admits, casts once, and keeps a receipt", async () => {
    const e = await election();
    const c = e.contests[0];
    const r = await visit(e, "voter@a.test");
    expect(r.outcome).toBe("ADMIT");
    if (!("pass" in r)) throw new Error();
    const cast = await castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [c.options[0].id] } }] });
    expect(cast.held).toBe(false);
    expect(await lookupReceipt(e.id, cast.receipt)).toEqual([{ contest: "Prime Minister", status: "COUNTED" }]);
    // The same pass cannot cast twice.
    await expect(castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [c.options[1].id] } }] })).rejects.toThrow();
    // Secret ballots carry no voter and no time.
    const b = await db.ballot.findFirstOrThrow({ where: { electionId: e.id } });
    expect(b.rollEntryId).toBeNull();
    expect(b.createdAt).toBeNull();
  });

  it("refuses the same inbox under an alias", async () => {
    const e = await election();
    const c = e.contests[0];
    const r = await visit(e, "Tudle.Nudle@gmail.com");
    if (!("pass" in r)) throw new Error();
    await castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [c.options[0].id] } }] });
    expect((await visit(e, "tudlenudle+again@googlemail.com")).outcome).toBe("ALREADY");
  });

  it("refuses a badly marked paper and a missing paper", async () => {
    const e = await election();
    const c = e.contests[0];
    const r = await visit(e, "bad@a.test");
    if (!("pass" in r)) throw new Error();
    await expect(castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: c.options.map((o) => o.id) } }] })).rejects.toThrow(/not marked correctly/);
    await expect(castSitting({ electionId: e.id, passRaw: r.pass, marks: [] })).rejects.toThrow(/Every paper/);
    expect(await db.ballot.count({ where: { electionId: e.id } })).toBe(0);
  });

  it("lets a re-vote replace the earlier ballot when allowed", async () => {
    const e = await election({ allowRevote: true });
    const c = e.contests[0];
    const r1 = await visit(e, "again@a.test");
    if (!("pass" in r1)) throw new Error();
    await castSitting({ electionId: e.id, passRaw: r1.pass, marks: [{ contestId: c.id, data: { x: [c.options[0].id] } }] });
    const r2 = await visit(e, "again@a.test");
    expect(r2.outcome).toBe("ADMIT");
    if (!("pass" in r2)) throw new Error();
    await castSitting({ electionId: e.id, passRaw: r2.pass, marks: [{ contestId: c.id, data: { x: [c.options[1].id] } }] });
    const counted = await db.ballot.findMany({ where: { electionId: e.id, status: "COUNTED" } });
    expect(counted).toHaveLength(1);
    expect(JSON.parse(counted[0].data)).toEqual({ x: [c.options[1].id] });
    expect(await db.ballot.count({ where: { electionId: e.id, status: "SUPERSEDED" } })).toBe(1);
  });

  it("holds a second identity on the same device in an envelope, or refuses it", async () => {
    const policy = defaultPolicy("PUBLIC");
    policy.actions.DEVICE_REPEAT = "HOLD";
    const e = await election({ fraud: JSON.stringify(policy) });
    const c = e.contests[0];
    const r1 = await visit(e, "first@a.test", "device-123456789012");
    if (!("pass" in r1)) throw new Error();
    await castSitting({ electionId: e.id, passRaw: r1.pass, marks: [{ contestId: c.id, data: { x: [c.options[0].id] } }] });
    const r2 = await visit(e, "second@a.test", "device-123456789012");
    expect(r2.outcome).toBe("HOLD");
    if (!("pass" in r2)) throw new Error();
    const cast = await castSitting({ electionId: e.id, passRaw: r2.pass, marks: [{ contestId: c.id, data: { x: [c.options[1].id] } }] });
    expect(cast.held).toBe(true);
    expect(await db.envelope.count({ where: { electionId: e.id, status: "HELD" } })).toBe(1);
    expect(await db.ballot.count({ where: { electionId: e.id, status: "HELD" } })).toBe(1);

    const strict = await election();
    const s1 = await visit(strict, "first@a.test", "device-abcdefabcdef");
    if (!("pass" in s1)) throw new Error();
    await castSitting({ electionId: strict.id, passRaw: s1.pass, marks: [{ contestId: strict.contests[0].id, data: { x: [strict.contests[0].options[0].id] } }] });
    expect((await visit(strict, "second@a.test", "device-abcdefabcdef")).outcome).toBe("BLOCK");
  });

  it("keeps outsiders off an invite-only roll", async () => {
    const e = await election({ access: "INVITE", routes: '["ACCOUNT"]' });
    const r = await admit({ election: e, route: "ACCOUNT", keys: await identityCandidates(org.id, { email: "stranger@a.test" }), email: "stranger@a.test", mayCreate: false, evidence: ev() });
    expect(r.outcome).toBe("NOT_ON_ROLL");
  });

  it("chains a show of hands at once and names the voter", async () => {
    const e = await election({ transparency: "SHOW_OF_HANDS" });
    const c = e.contests[0];
    const r = await visit(e, "hand@a.test");
    if (!("pass" in r)) throw new Error();
    const cast = await castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [c.options[0].id] } }] });
    expect(cast.pinned).toBe(true);
    const b = await db.ballot.findFirstOrThrow({ where: { electionId: e.id } });
    expect(b.rollEntryId).not.toBeNull();
    expect(b.seq).toBe(1);
    expect(b.hash).toBeTruthy();
  });

  it("does not admit to closed polls", async () => {
    const e = await election({ status: "CLOSED" });
    expect((await visit(e, "late@a.test")).outcome).toBe("CLOSED");
  });
});
