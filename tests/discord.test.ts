import { describe, expect, it } from "vitest";
import { holdsRole, oldEnough, snowflakeTime } from "@/lib/discord-oauth";
import { db } from "@/lib/db";
import { admit } from "@/lib/desk";
import { identityCandidates } from "@/lib/roll";
import { defaultPolicy } from "@/lib/types";

describe("Discord helpers", () => {
  it("reads a snowflake's time (Discord's documented example)", () => {
    expect(snowflakeTime("175928847299117063")?.toISOString()).toBe("2016-04-30T11:18:25.796Z");
    expect(snowflakeTime("not-a-snowflake")).toBeNull();
  });
  it("checks roles and account age", () => {
    expect(holdsRole(["1", "2"], ["2", "3"])).toBe(true);
    expect(holdsRole(["1"], ["2"])).toBe(false);
    expect(holdsRole(["1"], [])).toBe(false);
    const in2016 = new Date("2026-11-15T00:00:00Z").getTime();
    expect(oldEnough("175928847299117063", 365, in2016)).toBe(true);
    expect(oldEnough("175928847299117063", 365 * 20, in2016)).toBe(false);
    expect(oldEnough("whatever", 0)).toBe(true);
  });
});

describe("a Discord role as the roll", () => {
  it("admits a role holder once, and links a registered member to their register line", async () => {
    const org = await db.organisation.create({ data: { slug: "dc-org", name: "D", shortName: "D" } });
    const reg = await db.registerEntry.create({ data: { orgId: org.id, displayName: "Norton", discordUserId: "175928847299117063" } });
    const policy = defaultPolicy("INVITE");
    const e = await db.election.create({ data: { orgId: org.id, slug: "dc", title: "Club", status: "OPEN", access: "INVITE", routes: '["DISCORD"]', discordRoleIds: '["42"]', fraud: JSON.stringify(policy) } });
    const ev = { ip: "", userAgent: "t", deviceId: "", deviceFp: "", email: null };
    const keys = await identityCandidates(org.id, { discordId: "175928847299117063" });
    expect(keys).toEqual([`reg:${reg.id}`, "discord:175928847299117063"]);
    const r = await admit({ election: e, route: "DISCORD", keys, displayName: "Norton", mayCreate: true, evidence: ev });
    expect(r.outcome).toBe("ADMIT");
    if (!("pass" in r)) throw new Error();
    expect(r.line.identityKey).toBe(`reg:${reg.id}`);
    await db.rollEntry.update({ where: { id: r.line.id }, data: { status: "VOTED" } });
    expect((await admit({ election: e, route: "DISCORD", keys, mayCreate: true, evidence: ev })).outcome).toBe("ALREADY");
  });
});
