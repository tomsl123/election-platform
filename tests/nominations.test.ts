import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeNominations, confirmNomination, confirmSignature, fileNomination, requestSignature } from "@/lib/nominations";
import { electionInclude, setOptionStatus, stationContests } from "@/lib/elections";

/** The six-digit code is the subject's first word of the newest mail of a kind. */
async function codeFrom(kind: string, to: string) {
  const m = await db.outbox.findFirstOrThrow({ where: { kind, recipient: to }, orderBy: { createdAt: "desc" } });
  return m.subject.split(" ")[0];
}

describe("nominations", () => {
  it("files, verifies, collects signatures and is approved onto the paper", async () => {
    const org = await db.organisation.create({ data: { slug: "nom-org", name: "N", shortName: "N", smtp: JSON.stringify({ enabled: true, transport: "smtp", host: "" }) } });
    const e = await db.election.create({ data: { orgId: org.id, slug: "nom", title: "Senate", status: "NOMINATIONS" } });
    const c = await db.contest.create({ data: { electionId: e.id, title: "Senator", method: "SINGLE", rule: JSON.stringify({ supportersRequired: 2 }) } });
    const input = { contestId: c.id, districtId: null, name: "Harper", subtitle: "", partyId: null, symbol: "bolt", color: "#2f7d55", statement: "Against the Russian menace.", email: "Harper+run@usfc.test", photoId: null };

    const raw = await fileNomination(org, e.id, input);
    await expect(confirmNomination(org, raw, "000000")).rejects.toThrow(/not right/);
    const o = await confirmNomination(org, raw, await codeFrom("NOMINATION_CODE", "harper+run@usfc.test"));
    expect(o.status).toBe("PENDING");
    expect(o.nominatedByEmail).toBe("harper@usfc.test");
    await expect(fileNomination(org, e.id, input)).rejects.toThrow(/already on that paper/);

    for (const who of ["a@usfc.test", "b@usfc.test"]) {
      const r = await requestSignature(org, o.id, "Supporter", who);
      await confirmSignature(r, await codeFrom("SUPPORT_CODE", who));
    }
    await expect(requestSignature(org, o.id, "Again", "A+x@usfc.test")).rejects.toThrow(/already signed/);
    expect(await db.nominationSupport.count({ where: { optionId: o.id } })).toBe(2);

    // Pending options are not printed; approved ones are.
    let full = await db.election.findUniqueOrThrow({ where: { id: e.id }, include: electionInclude });
    expect(stationContests(full.contests, null)).toHaveLength(0);
    await setOptionStatus(org, o.id, { id: null, label: "officer" }, "APPROVED");
    full = await db.election.findUniqueOrThrow({ where: { id: e.id }, include: electionInclude });
    expect(stationContests(full.contests, null)[0].options.map((x) => x.name)).toEqual(["Harper"]);

    await closeNominations(e.id, { id: null, label: "clock" });
    expect((await db.election.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("DRAFT");
    await expect(requestSignature(org, o.id, "Late", "late@usfc.test")).rejects.toThrow(/not collecting/);
  });
});
