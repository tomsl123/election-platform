import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { noticeClosingSoon, noticeHeldDigest, noticeOpened, summary } from "@/lib/notices";
import type { Result } from "@/lib/count";

describe("notices", () => {
  it("tells invitees the polls are open and reminds those who have not voted, by e-mail only", async () => {
    // Mail is "on" but has no server, so nothing leaves; we read what was queued.
    const org = await db.organisation.create({ data: { slug: "notice-org", name: "N", shortName: "N", smtp: JSON.stringify({ enabled: true, transport: "smtp", host: "" }) } });
    const e = await db.election.create({ data: { orgId: org.id, slug: "n", title: "Notice vote", status: "OPEN", access: "INVITE", routes: '["LINK"]', closesAt: new Date(Date.now() + 3600_000) } });
    for (const [i, status] of ["INVITED", "INVITED", "VOTED"].entries()) {
      await db.rollEntry.create({ data: { electionId: e.id, identityKey: `reg:${i}`, route: "LINK", status, emailEnc: encrypt(`v${i}@n.test`) } });
    }
    await noticeOpened(e.id);
    await noticeClosingSoon(e.id);
    const mails = await db.outbox.findMany({ where: { orgId: org.id, channel: "EMAIL" } });
    expect(mails.filter((m) => m.kind === "OPENED")).toHaveLength(2);
    expect(mails.filter((m) => m.kind === "CLOSING")).toHaveLength(2);
    expect(mails.some((m) => m.recipient === "v2@n.test")).toBe(false);
    // Each voter's mail carries their own one-time link; Discord (switched off here) got nothing.
    expect(mails.every((m) => JSON.parse(m.payload === "{}" ? '{"text":"/v/"}' : m.payload).text.includes("/v/"))).toBe(true);
    expect(await db.outbox.count({ where: { orgId: org.id, channel: "DISCORD" } })).toBe(0);
  });

  it("sends officers a digest of held envelopes at most hourly", async () => {
    const org = await db.organisation.create({ data: { slug: "digest-org", name: "D", shortName: "D", smtp: JSON.stringify({ enabled: true, transport: "smtp", host: "" }) } });
    const u = await db.user.create({ data: { email: "officer@d.test", displayName: "Officer", memberships: { create: { orgId: org.id, role: "OFFICER" } } } });
    const e = await db.election.create({ data: { orgId: org.id, slug: "d", title: "Digest vote", status: "OPEN" } });
    const line = await db.rollEntry.create({ data: { electionId: e.id, identityKey: "email:x", route: "EMAIL_CODE", status: "HELD" } });
    await db.envelope.create({ data: { electionId: e.id, rollEntryId: line.id, reasons: '["IP_SHARED"]' } });
    const now = new Date();
    await noticeHeldDigest(now);
    await noticeHeldDigest(new Date(now.getTime() + 60_000));
    expect(await db.outbox.count({ where: { orgId: org.id, kind: "HELD_DIGEST", recipient: u.email } })).toBe(1);
  });

  it("names each paper's outcome in a summary", () => {
    const opt = (id: string, name: string, partyId: string | null = null, subtitle = "") => ({ id, name, subtitle, color: "#000", symbol: "", partyId, districtId: null, list: [] });
    const result: Result = {
      electionId: "e",
      ballots: 3,
      turnout: { voted: 3, eligible: 0, byDistrict: {} },
      districts: [],
      contests: [
        { id: "c1", title: "Prime Minister", method: "SINGLE", scope: "NATIONAL", seats: 1, options: [opt("a", "Simons"), opt("b", "Builderswartz")], national: { valid: 3, blank: 0, totals: { a: 2, b: 1 }, outcome: "ELECTED", winners: ["a"] }, districts: {} },
        { id: "c2", title: "Senate", method: "SINGLE", scope: "NATIONAL", seats: 1, options: [opt("a", "Norton"), opt("b", "Revolton")], national: { valid: 3, blank: 0, totals: {}, outcome: "RUNOFF", winners: [], finalists: ["a", "b"] }, districts: {} },
      ],
    };
    expect(summary(result)).toEqual(["Prime Minister: Simons", "Senate: second round between Norton and Revolton"]);
  });
});
