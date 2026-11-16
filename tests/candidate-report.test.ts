import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { storeImage } from "@/lib/uploads";
import { parseAddresses } from "@/lib/email";
import { flushOutbox, queueCandidateReport } from "@/lib/notify";
import { stationContests, electionInclude, partyLogos } from "@/lib/elections";
import { imageSources, initials, inkOn, loadCandidateReport, loadReportImages, renderReportBody, renderReportCsv, renderReportDocument } from "@/lib/candidate-report";

// The smallest valid PNG: one transparent pixel.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function setup(slug: string, smtp: object) {
  const org = await db.organisation.create({ data: { slug, name: "United States of Free Cliffs", shortName: "USFC", smtp: JSON.stringify(smtp) } });
  const logo = await storeImage(org.id, new File([PNG], "logo.png", { type: "image/png" }));
  const photo = await storeImage(org.id, new File([PNG], "me.png", { type: "image/png" }));
  const blue = await db.party.create({ data: { orgId: org.id, name: "Blue Cliffs", abbr: "BLU", color: "#1d4e89", logoId: logo.id } });
  const red = await db.party.create({ data: { orgId: org.id, name: "Red <Shore>", abbr: "RED", color: "#a8261e", position: 1 } });
  const set = await db.districtSet.create({ data: { orgId: org.id, name: "Cliffs" } });
  const north = await db.district.create({ data: { setId: set.id, name: "North Cliff", code: "NC", seats: 1, position: 0 } });
  const south = await db.district.create({ data: { setId: set.id, name: "South Cliff", code: "SC", seats: 2, position: 1 } });
  const e = await db.election.create({ data: { orgId: org.id, slug: "general", title: "General election", districtSetId: set.id } });
  const local = await db.contest.create({ data: { electionId: e.id, title: "Cliff member", method: "SINGLE", scope: "PER_DISTRICT", position: 0 } });
  await db.contestDistrict.create({ data: { contestId: local.id, districtId: south.id, seats: 2 } });
  await db.option.createMany({
    data: [
      { contestId: local.id, districtId: north.id, name: "Ada Harper", partyId: blue.id, subtitle: "BLU", photoId: photo.id, statement: "Bridges, not walls.", position: 0 },
      { contestId: local.id, districtId: north.id, name: "Ben Ruiz", partyId: red.id, subtitle: "RED", position: 1 },
      { contestId: local.id, districtId: south.id, name: "Cy Moss", subtitle: "Independent", position: 2 },
      { contestId: local.id, districtId: south.id, name: "Pending Pat", status: "PENDING", position: 3 },
    ],
  });
  const lists = await db.contest.create({ data: { electionId: e.id, title: "National list", method: "PARTY_LIST", seats: 5, position: 1 } });
  const list = await db.option.create({ data: { contestId: lists.id, name: "Blue Cliffs", partyId: blue.id, position: 0 } });
  await db.listCandidate.createMany({ data: ["Dee", "=Evil()", "Fay"].map((name, position) => ({ optionId: list.id, name, position })) });
  await db.contest.create({ data: { electionId: e.id, title: "Hold the vote again?", method: "YESNO", position: 2 } });
  return { org, e, blue, logo, photo };
}

describe("candidates report", () => {
  it("draws initials and a readable ink", () => {
    expect(initials("Ada Lovelace Byron")).toBe("AB");
    expect(initials("cher")).toBe("C");
    expect(initials("  ")).toBe("?");
    expect(inkOn("#ffffff")).toBe("#23201c");
    expect(inkOn("#1d4e89")).toBe("#fffdf7");
  });

  it("reads addresses from a free-form field", () => {
    expect(parseAddresses("a@x.org, B@X.org;\n<c@y.org> a@x.org nope")).toEqual({ ok: ["a@x.org", "b@x.org", "c@y.org"], bad: ["nope"] });
  });

  it("gathers who runs where, drawn as page, file and CSV", async () => {
    const { org, e, logo, photo } = await setup("report-org", { enabled: false });
    const r = (await loadCandidateReport(org, e.id))!;
    // Pending candidates and referendums are left out; a list counts each name on it.
    expect(r.totals).toEqual({ candidates: 6, papers: 2, districts: 2, parties: 2 });
    expect(r.papers.map((p) => p.title)).toEqual(["Cliff member", "National list"]);
    expect(r.papers[0]!.groups.map((g) => [g.district?.code, g.seats, g.candidates.map((c) => c.name)])).toEqual([
      ["NC", 1, ["Ada Harper", "Ben Ruiz"]],
      ["SC", 2, ["Cy Moss"]],
    ]);
    expect(r.parties.map((t) => [t.party?.abbr ?? null, t.candidates])).toEqual([["BLU", 4], ["RED", 1], [null, 1]]);
    expect(r.districts.map((d) => [d.code, d.candidates])).toEqual([["NC", 2], ["SC", 1]]);

    const body = renderReportBody(r, imageSources.served);
    expect(body).toContain(`/api/files/${photo.id}`);
    expect(body).toContain(`/api/files/${logo.id}`);
    expect(body).toContain("Red &lt;Shore&gt;");
    expect(body).not.toContain("Red <Shore>");
    expect(body).not.toContain("Pending Pat");

    const doc = renderReportDocument(r, imageSources.embedded(await loadReportImages(r, org.id)));
    expect(doc).toContain("data:image/png;base64,");
    expect(doc).not.toContain("/api/files/");

    const csv = renderReportCsv(r).split("\r\n");
    expect(csv[0]).toBe("﻿paper,district_code,district,seats,candidate,party,party_abbr,list_position,statement");
    expect(csv).toContain("Cliff member,NC,North Cliff,1,Ada Harper,Blue Cliffs,BLU,,\"Bridges, not walls.\"");
    expect(csv).toContain("National list,,,5,'=Evil(),Blue Cliffs,BLU,2,");

    // The paper shows a party's logo beside its candidates.
    const full = await db.election.findUniqueOrThrow({ where: { id: e.id }, include: electionInclude });
    const north = stationContests(full.contests, r.papers[0]!.groups[0]!.district!.id, await partyLogos(org.id))[0]!;
    expect(north.options.map((o) => o.logoUrl)).toEqual([`/api/files/${logo.id}`, null]);

    expect(await loadCandidateReport({ ...org, id: "someone-else" }, e.id)).toBeNull();
  });

  it("e-mails the report with its photos inline and the document attached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ps-mailbox-"));
    process.env.MAILBOX_DIR = dir;
    try {
      const { org, e } = await setup("report-mail", { enabled: true, transport: "file" });
      expect(await queueCandidateReport(org, "press@usfc.test", e.id, "For Friday's paper.", "Officer Kim")).toBe(true);
      await flushOutbox();
      const row = await db.outbox.findFirstOrThrow({ where: { kind: "candidate-report", recipient: "press@usfc.test" } });
      expect(row.status).toBe("SENT");
      expect(row.payload).toBe("{}");
      const files = await readdir(dir);
      const message = await readFile(join(dir, files.find((f) => f.endsWith(".txt"))!), "utf8");
      expect(message).toContain("Subject: General election: who runs and where");
      expect(message).toContain("For Friday's paper.");
      expect(message).toContain("-- NC North Cliff (1 seat)");
      const attached = files.find((f) => f.endsWith("general-election-candidates.html"))!;
      expect(await readFile(join(dir, attached), "utf8")).toContain("data:image/png;base64,");
    } finally {
      delete process.env.MAILBOX_DIR;
    }
  });

  it("queues nothing while e-mail is switched off", async () => {
    const { org, e } = await setup("report-off", { enabled: false });
    expect(await queueCandidateReport(org, "press@usfc.test", e.id, "", "Officer")).toBe(false);
  });
});
