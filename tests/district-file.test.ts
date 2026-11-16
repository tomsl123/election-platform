import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseDistrictFile, planDistrictImport, splitCsv, toDistrictCsv, toDistrictFile, type CurrentDistrict } from "@/lib/district-file";
import { applyImport, assertUnlocked, freezeDistricts, lockedBy, readSnapshot, stageImport } from "@/lib/districts";
import { openNominations, closeNominations } from "@/lib/nominations";
import { admit } from "@/lib/desk";
import { castSitting, closePolls, verifyElection } from "@/lib/ballot";
import { electionInclude } from "@/lib/elections";
import { defaultPolicy } from "@/lib/types";

const actor = { id: null, label: "test" };

describe("district files", () => {
  it("reads our own format", () => {
    const { file, kind } = parseDistrictFile(
      JSON.stringify({ format: "usfc-districts", version: 1, name: "Cliffs", districts: [{ code: "rel", name: "Reliberated", seats: 50, counties: [{ id: "rel-n", name: "North" }] }], map: { cols: 8, rows: 8, cells: { "1,1": "rel-n", "2,1": "nowhere" } } }),
    );
    expect(kind).toBe("districts");
    expect(file.districts[0]).toEqual({ code: "REL", name: "Reliberated", seats: 50, ref: "", counties: [{ id: "rel-n", name: "North" }] });
    expect(file.map?.cells).toEqual({ "1,1": "rel-n" });
  });

  it("reads a UCTV export: race ids become refs, codes from the id when it fits, else the name", () => {
    const scenario = {
      parties: [],
      races: [
        { id: "SNOW", name: "Snowbelle", counties: [{ id: "co_1", name: "Peak" }], candidates: [] },
        { id: "race_7x9k", name: "Crimson Heights", counties: [{ id: "co_2", name: "Ridge" }], candidates: [] },
      ],
      map: { cols: 10, rows: 10, cells: { "0,0": "co_1", "1,0": "co_2" } },
      settings: {},
    };
    const { file, kind } = parseDistrictFile(JSON.stringify({ app: "UCTV_ELECTIONS", version: 3, name: "Senate", scenario }));
    expect(kind).toBe("uctv");
    expect(file.name).toBe("Senate");
    expect(file.districts.map((d) => [d.code, d.ref])).toEqual([
      ["SNOW", "SNOW"],
      ["CRIMSO", "race_7x9k"],
    ]);
    expect(Object.keys(file.map!.cells)).toHaveLength(2);
  });

  it("reads UCTV's old single-file export without a map", () => {
    const { file, notes } = parseDistrictFile(JSON.stringify({ app: "UCTV_SENATE_ELECTION_SPECIAL", parties: [], constituencies: [{ id: "c_1", name: "Liberaldise", counties: [{ name: "Shore" }] }] }));
    expect(file.map).toBeNull();
    expect(file.districts[0]).toMatchObject({ code: "LIBERA", ref: "c_1", counties: [{ id: "", name: "Shore" }] });
    expect(notes[0]).toMatch(/no map/);
  });

  it("reads CSV with quotes, a row per county, and districts without counties", () => {
    expect(splitCsv('a;"b; c";"say ""hi"""\n1;2;3')).toEqual([
      ["a", "b; c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
    const { file } = parseDistrictFile("code,name,seats,county\nREL,Reliberated,50,North\nREL,Reliberated,,\"Harbour, Old\"\nsnw,Snowbelle,3,\n", "cliffs.csv");
    expect(file.districts).toEqual([
      { code: "REL", name: "Reliberated", seats: 50, ref: "", counties: [{ id: "", name: "North" }, { id: "", name: "Harbour, Old" }] },
      { code: "SNW", name: "Snowbelle", seats: 3, ref: "", counties: [] },
    ]);
  });

  it("refuses duplicate codes, bad seats and files it does not know", () => {
    expect(() => parseDistrictFile("A,One\nA,Other")).not.toThrow(); // same code twice in CSV = one district
    expect(() => parseDistrictFile(JSON.stringify({ format: "usfc-districts", version: 1, districts: [{ code: "A", name: "x" }, { code: "a", name: "y" }] }))).toThrow(/used twice/);
    expect(() => parseDistrictFile("A,One,zero")).toThrow(/Line 1: seats/);
    // An exported CSV repeats seats on every county line; changing only one of them is refused, not guessed.
    expect(() => parseDistrictFile("code,name,seats,county\nA,One,40,North\nA,One,50,South")).toThrow(/Line 3: A has 40 seats/);
    expect(() => parseDistrictFile('{"hello":1}')).toThrow(/not a district file/);
    expect(() => parseDistrictFile("")).toThrow(/empty/);
  });

  it("exports and reads back the same set", () => {
    const set = { name: "Cliffs", map: JSON.stringify({ cols: 8, rows: 8, cells: { "0,0": "r-n" } }), districts: [{ code: "REL", name: "Reli, berated", seats: 50, ref: "race_1", counties: JSON.stringify([{ id: "r-n", name: "North" }]) }, { code: "SNW", name: "Snowbelle", seats: 1, ref: "", counties: "[]" }] };
    const back = parseDistrictFile(JSON.stringify(toDistrictFile(set))).file;
    expect(back).toEqual(toDistrictFile(set));
    const csv = parseDistrictFile(toDistrictCsv(set)).file;
    expect(csv.districts.map((d) => [d.code, d.name, d.seats, d.counties.map((c) => c.name)])).toEqual([
      ["REL", "Reli, berated", 50, ["North"]],
      ["SNW", "Snowbelle", 1, []],
    ]);
  });

  it("plans an import: matches by ref, code, then name; keeps codes and county ids; reports missing districts", () => {
    const current: CurrentDistrict[] = [
      { id: "1", code: "REL", name: "Reliberated", seats: 50, ref: "", counties: [{ id: "co_9", name: "North" }], used: true },
      { id: "2", code: "SNW", name: "Snowbelle", seats: 50, ref: "race_s", counties: [], used: false },
      { id: "3", code: "DEAD", name: "Dead End", seats: 50, ref: "", counties: [], used: true },
      { id: "4", code: "NORM", name: "Normalcy", seats: 50, ref: "", counties: [], used: false },
    ];
    const { file } = parseDistrictFile("code,name,seats,county\nREL,Reliberated,,North\nREL,Reliberated,,Harbour\nXX,Snowbelle,40,\nNEW,Azure Blue,2,\n");
    file.districts[1]!.ref = "race_s";
    const plan = planDistrictImport(current, { cols: 4, rows: 4, cells: { "0,0": "co_9" } }, file);
    expect(plan.add.map((a) => a.code)).toEqual(["NEW"]);
    const rel = plan.change.find((c) => c.code === "REL")!;
    expect(rel.to.counties).toEqual([{ id: "co_9", name: "North" }, { id: "rel-harbour", name: "Harbour" }]);
    expect(rel.to.seats).toBe(50);
    const snw = plan.change.find((c) => c.id === "2")!;
    expect(snw.code).toBe("SNW");
    expect(snw.fields).toEqual(["seats"]);
    expect(plan.missing).toEqual([
      { id: "3", code: "DEAD", name: "Dead End", used: true },
      { id: "4", code: "NORM", name: "Normalcy", used: false },
    ]);
    expect(plan.map?.cells).toEqual({ "0,0": "co_9" });
    expect(plan.mapChanged).toBe(false);
  });
});

describe("district sets in the office", () => {
  it("imports into a new set, then applies a change and removes only unused districts", async () => {
    const org = await db.organisation.create({ data: { slug: "imp", name: "Imp", shortName: "I" } });
    const first = parseDistrictFile(JSON.stringify({ format: "usfc-districts", version: 1, name: "Senate", districts: [{ code: "A", name: "Alpha", counties: [{ id: "a1", name: "A one" }] }, { code: "B", name: "Beta" }, { code: "C", name: "Gamma" }], map: { cols: 4, rows: 4, cells: { "0,0": "a1" } } }));
    const id = await stageImport(org, null, { kind: "file", label: "senate.json", parsed: first }, actor);
    const { setId, message } = await applyImport(org, id, false, actor);
    expect(message).toMatch(/3 added/);
    const set = await db.districtSet.findUniqueOrThrow({ where: { id: setId }, include: { districts: { orderBy: { position: "asc" } } } });
    expect(set.name).toBe("Senate");
    expect(set.districts.map((d) => d.code)).toEqual(["A", "B", "C"]);
    expect(JSON.parse(set.map).cells).toEqual({ "0,0": "a1" });

    // B is on the register, so it stays even when asked to remove what the file leaves out.
    const entry = await db.registerEntry.create({ data: { orgId: org.id, displayName: "Voter" } });
    await db.registerDistrict.create({ data: { entryId: entry.id, setId, districtId: set.districts[1]!.id } });
    const second = parseDistrictFile("code,name,seats\nA,Alpha Prime,3\n");
    const id2 = await stageImport(org, setId, { kind: "file", label: "a.csv", parsed: second }, actor);
    const done = await applyImport(org, id2, true, actor);
    expect(done.message).toMatch(/1 changed, 1 removed, map updated/);
    const after = await db.district.findMany({ where: { setId }, orderBy: { position: "asc" } });
    expect(after.map((d) => [d.code, d.name, d.seats])).toEqual([
      ["A", "Alpha Prime", 3],
      ["B", "Beta", 1],
    ]);
    // The CSV gave Alpha no counties, so the map lost its only cell.
    expect((await db.districtSet.findUniqueOrThrow({ where: { id: setId } })).map).toBe("");
    await expect(applyImport(org, id2, true, actor)).rejects.toThrow(/expired/);
  });

  it("freezes the set while an election uses it and thaws it when the election goes back to draft", async () => {
    const org = await db.organisation.create({ data: { slug: "frz", name: "Frz", shortName: "F" } });
    const set = await db.districtSet.create({ data: { orgId: org.id, name: "Cliffs" } });
    await db.district.create({ data: { setId: set.id, name: "Snowbelle", code: "SNOW" } });
    const e = await db.election.create({ data: { orgId: org.id, slug: "n", title: "Nominated", districtSetId: set.id, nominationsCloseAt: new Date(Date.now() + 3600_000) } });
    await assertUnlocked(set.id);
    await openNominations(org, e.id, actor);
    const snap = readSnapshot((await db.election.findUniqueOrThrow({ where: { id: e.id } })).districts);
    expect(snap?.districts.map((d) => d.code)).toEqual(["SNOW"]);
    await expect(assertUnlocked(set.id)).rejects.toThrow(/Nominated uses this set/);
    const id = await stageImport(org, set.id, { kind: "file", label: "x.csv", parsed: parseDistrictFile("NEW,New") }, actor);
    await expect(applyImport(org, id, false, actor)).rejects.toThrow(/uses this set/);
    await closeNominations(e.id, actor); // no opening time: back to draft
    expect((await db.election.findUniqueOrThrow({ where: { id: e.id } })).districts).toBeNull();
    expect(await lockedBy(set.id)).toEqual([]);
  });

  it("counts and recounts with the frozen districts, even after the set changes", async () => {
    const org = await db.organisation.create({ data: { slug: "rec", name: "Rec", shortName: "R" } });
    const set = await db.districtSet.create({ data: { orgId: org.id, name: "Cliffs" } });
    const snow = await db.district.create({ data: { setId: set.id, name: "Snowbelle", code: "SNOW" } });
    const policy = defaultPolicy("PUBLIC");
    policy.actions.DEVICE_REPEAT = "IGNORE";
    const e = await db.election.create({ data: { orgId: org.id, slug: "r", title: "Recount", status: "OPEN", districtSetId: set.id, districtAssign: "SELF", fraud: JSON.stringify(policy) } });
    await freezeDistricts(e.id);
    const c = await db.contest.create({ data: { electionId: e.id, title: "Seat", method: "SINGLE", scope: "PER_DISTRICT" } });
    const a = await db.option.create({ data: { contestId: c.id, districtId: snow.id, name: "A" } });
    await db.option.create({ data: { contestId: c.id, districtId: snow.id, name: "B" } });
    const full = await db.election.findUniqueOrThrow({ where: { id: e.id }, include: electionInclude });
    const r = await admit({ election: full, route: "EMAIL_CODE", keys: ["email:rec1"], email: "rec1@c.test", districtId: snow.id, mayCreate: true, evidence: { ip: "", userAgent: "t", deviceId: "", deviceFp: "", email: null } });
    if (!("pass" in r)) throw new Error(r.outcome);
    await castSitting({ electionId: e.id, passRaw: r.pass, marks: [{ contestId: c.id, data: { x: [a.id] } }] });
    await expect(assertUnlocked(set.id)).rejects.toThrow();
    await closePolls(e.id, actor);
    // Counted: the set may change again, and the sealed count still checks out.
    await assertUnlocked(set.id);
    await db.district.create({ data: { setId: set.id, name: "Eternal Sand", code: "SAND", position: 1 } });
    await db.district.update({ where: { id: snow.id }, data: { name: "Snowbelle Peaks" } });
    const check = await verifyElection(e.id);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });
});
