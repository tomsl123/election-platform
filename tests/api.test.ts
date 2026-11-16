import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt, sha256 } from "@/lib/crypto";
import { emitWebhook } from "@/lib/webhooks";
import { flushOutbox } from "@/lib/notify";
import { toScenario } from "@/lib/uctv";
import { GET, POST } from "@/app/api/v1/orgs/[org]/elections/[[...rest]]/route";
import type { Result } from "@/lib/count";

const call = (method: "GET" | "POST", path: string[], key?: string) =>
  (method === "GET" ? GET : POST)(new Request(`http://localhost/api/v1/orgs/api-org/elections/${path.join("/")}`, { method, headers: key ? { authorization: `Bearer ${key}` } : {} }), {
    params: Promise.resolve({ org: "api-org", rest: path }),
  });

describe("public API", () => {
  it("shows public data, hides drafts and sealed results, and lets only a manage key close polls", async () => {
    const org = await db.organisation.create({ data: { slug: "api-org", name: "API", shortName: "A" } });
    await db.election.create({ data: { orgId: org.id, slug: "draft", title: "Draft" } });
    const open = await db.election.create({ data: { orgId: org.id, slug: "open", title: "Open", status: "OPEN", turnoutLive: false } });
    await db.contest.create({ data: { electionId: open.id, title: "Q", method: "YESNO", options: { create: [{ name: "Yes", kind: "YES" }, { name: "No", kind: "NO", position: 1 }] } } });
    await db.apiKey.create({ data: { orgId: org.id, name: "r", scope: "READ", keyHash: sha256("ps_read") } });
    await db.apiKey.create({ data: { orgId: org.id, name: "m", scope: "MANAGE", keyHash: sha256("ps_manage") } });

    const anon = await (await call("GET", [])).json();
    expect(anon.elections.map((e: { slug: string }) => e.slug)).toEqual(["open"]);
    const read = await (await call("GET", [], "ps_read")).json();
    expect(read.elections).toHaveLength(2);
    expect((await call("GET", [], "ps_wrong")).status).toBe(401);
    expect((await call("GET", ["draft"])).status).toBe(404);
    const one = await (await call("GET", ["open"])).json();
    expect(one.contests[0].options.map((o: { name: string }) => o.name)).toEqual(["Yes", "No"]);
    expect((await call("GET", ["open", "results"])).status).toBe(404);
    expect((await call("GET", ["open", "turnout"])).status).toBe(403);
    expect((await call("GET", ["open", "turnout"], "ps_read")).status).toBe(200);

    expect((await call("POST", ["open", "close"], "ps_read")).status).toBe(403);
    const closed = await call("POST", ["open", "close"], "ps_manage");
    expect(closed.status).toBe(200);
    expect((await closed.json()).counted).toBe(true);
    const results = await (await call("GET", ["open", "results"])).json();
    expect(results.kind).toBe("final");
    expect(results.sealed.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("webhooks", () => {
  it("delivers signed events and retries a failing receiver", async () => {
    const got: Array<{ body: string; sig: string; event: string }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        got.push({ body, sig: String(req.headers["x-ps-signature"]), event: String(req.headers["x-ps-event"]) });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const org = await db.organisation.create({ data: { slug: "hook-org", name: "H", shortName: "H" } });
    await db.webhook.create({ data: { orgId: org.id, url: `http://127.0.0.1:${port}/hook`, secretEnc: encrypt("s3cret"), events: '["election.counted"]' } });
    await db.webhook.create({ data: { orgId: org.id, url: "http://127.0.0.1:9/nobody", secretEnc: encrypt("x"), events: "[]" } });
    await emitWebhook(org.id, "election.counted", { id: "e1" });
    await emitWebhook(org.id, "election.opened", { id: "e1" });
    await flushOutbox();
    server.close();
    expect(got).toHaveLength(1);
    expect(got[0].event).toBe("election.counted");
    expect(got[0].sig).toBe("sha256=" + createHmac("sha256", "s3cret").update(got[0].body).digest("hex"));
    expect(JSON.parse(got[0].body)).toMatchObject({ event: "election.counted", data: { id: "e1" } });
    const failed = await db.outbox.findMany({ where: { orgId: org.id, channel: "WEBHOOK", status: "PENDING" } });
    expect(failed.length).toBe(2);
    expect(failed.every((f) => f.attempts === 1 && f.lastError)).toBe(true);
  });
});

describe("UCTV", () => {
  it("turns a result into races, keeping UCTV's counties", () => {
    const result: Result = {
      electionId: "e",
      ballots: 3,
      turnout: { voted: 3, eligible: 0, byDistrict: {} },
      districts: [],
      contests: [
        {
          id: "pm",
          title: "Prime Minister",
          method: "SINGLE",
          scope: "NATIONAL",
          seats: 1,
          options: [
            { id: "a", name: "Simons", subtitle: "CA", color: "#d99a12", symbol: "", partyId: "ca", districtId: null, list: [] },
            { id: "b", name: "Independent Joe", subtitle: "", color: "#555555", symbol: "", partyId: null, districtId: null, list: [] },
          ],
          national: { valid: 3, blank: 0, totals: { a: 2, b: 1 }, outcome: "ELECTED", winners: ["a"] },
          districts: {},
        },
        { id: "ref", title: "Referendum", method: "YESNO", scope: "NATIONAL", seats: 1, options: [], national: { valid: 0, blank: 0, totals: {}, outcome: "NONE", winners: [] }, districts: {} },
      ],
    };
    const existing = { parties: [], races: [{ id: "pm", name: "Old", pollCloseSec: 0, countDurationSec: 120, callMode: "standard", candidates: [], counties: [{ id: "k1", name: "North" }] }], map: { cols: 4, rows: 4, cells: { "0,0": "k1" } }, settings: { voteMultiplier: 8750, rule: "two_round", nightStart: "21:00" } };
    const { scenario, fresh } = toScenario(result, [{ id: "ca", name: "Cliffs Assemble", abbr: "CA", color: "#d99a12" }], { pm: { win: "PLURALITY" } }, existing);
    expect(fresh).toBe(false);
    expect(scenario.races).toHaveLength(1);
    expect(scenario.races[0].counties).toEqual([{ id: "k1", name: "North" }]);
    expect(scenario.races[0].candidates.map((c) => [c.name, c.partyId, c.rawVotes])).toEqual([
      ["Simons", "ca", 2],
      ["Independent Joe", "opt-b", 1],
    ]);
    // UCTV's multiplier stays: the show scales a small election up to a nation on air.
    expect(scenario.settings).toMatchObject({ voteMultiplier: 8750, rule: "plurality", nightStart: "21:00" });
    expect(scenario.parties.map((p) => p.id).sort()).toEqual(["ca", "opt-b"]);
    // A UCTV race with another id is not ours: UCTV is asked to draw a map instead of us borrowing its counties.
    const other = toScenario(result, [], { pm: { win: "PLURALITY" } }, { ...existing, races: [{ ...existing.races[0], id: "old" }] });
    expect(other.fresh).toBe(true);
    expect(other.scenario.races[0].counties).toEqual([{ id: "pm-c", name: "National" }]);
  });

  const cliffs = {
    districts: [
      { id: "d1", code: "SNOW", name: "Snowbelle", ref: "race_snow", counties: [{ id: "s-n", name: "North Snow" }, { id: "s-s", name: "South Snow" }] },
      { id: "d2", code: "SAND", name: "Eternal Sand", ref: "", counties: [{ id: "a-1", name: "Dunes" }] },
    ],
    map: { cols: 8, rows: 8, cells: { "0,0": "s-n", "1,0": "s-s", "2,0": "a-1", "3,0": "a-1" } },
  };
  const opt = (id: string, districtId: string | null, partyId: string) => ({ id, name: id.toUpperCase(), subtitle: "", color: "#123456", symbol: "", partyId, districtId, list: [] });
  const tally = (totals: Record<string, number>, seats?: Record<string, number>) => ({ valid: Object.values(totals).reduce((a, b) => a + b, 0), blank: 0, totals, outcome: "ELECTED" as const, winners: [], ...(seats ? { seats } : {}) });
  const cliffResult = (contest: Result["contests"][number]): Result => ({
    electionId: "e",
    ballots: 10,
    turnout: { voted: 10, eligible: 0, byDistrict: {} },
    districts: [
      { id: "d1", name: "Snowbelle", code: "SNOW" },
      { id: "d2", name: "Eternal Sand", code: "SAND" },
    ],
    contests: [contest],
  });

  it("keys per-district races by UCTV race id or code, and sends our counties, map and seats", () => {
    const result = cliffResult({
      id: "ng",
      title: "National Gathering",
      method: "PARTY_LIST",
      scope: "PER_DISTRICT",
      seats: 4,
      options: [opt("r1", "d1", "red"), opt("b1", "d1", "blue"), opt("r2", "d2", "red"), opt("b2", "d2", "blue")],
      national: tally({ r1: 3, b1: 1, r2: 1, b2: 2 }),
      districts: { d1: tally({ r1: 3, b1: 1 }, { r1: 3, b1: 1 }), d2: tally({ r2: 1, b2: 2 }, { r2: 0, b2: 2 }) },
    });
    const parties = [
      { id: "red", name: "Red", abbr: "R", color: "#c22a2a" },
      { id: "blue", name: "Blue", abbr: "B", color: "#2456a6" },
    ];
    // UCTV's races in a different order must not matter.
    const existing = { parties: [], races: [{ id: "SAND", name: "x", pollCloseSec: 0, countDurationSec: 1, callMode: "standard", candidates: [], counties: [{ id: "zzz", name: "Wrong" }] }], map: { cols: 4, rows: 4, cells: {} }, settings: {} };
    const { scenario, fresh } = toScenario(result, parties, {}, existing, { geo: cliffs });
    expect(fresh).toBe(false);
    expect(scenario.races.map((r) => r.id)).toEqual(["race_snow", "SAND"]);
    expect(scenario.races[0].counties.map((k) => k.id)).toEqual(["s-n", "s-s"]);
    expect(scenario.races[1].counties.map((k) => k.id)).toEqual(["a-1"]);
    expect(scenario.map).toEqual(cliffs.map);
    expect(scenario.races[0].seats).toBe(4);
    expect(scenario.races[1].candidates.map((k) => [k.id, k.rawVotes, k.seatsWon])).toEqual([
      ["r2", 1, 0],
      ["b2", 2, 2],
    ]);
  });

  it("sends a national paper as one race whose counties are the districts, with exact votes", () => {
    const result = cliffResult({
      id: "pm",
      title: "Prime Minister",
      method: "SINGLE",
      scope: "NATIONAL",
      seats: 1,
      options: [opt("a", null, "red"), opt("b", null, "blue")],
      national: tally({ a: 6, b: 4 }),
      districts: { d1: tally({ a: 5, b: 1 }), d2: tally({ a: 1, b: 3 }) },
    });
    const { scenario } = toScenario(result, [], { pm: { win: "MAJORITY_RUNOFF" } }, null, { geo: cliffs });
    expect(scenario.races).toHaveLength(1);
    expect(scenario.races[0].counties).toEqual([
      { id: "SNOW", name: "Snowbelle", votes: { a: 5, b: 1 } },
      { id: "SAND", name: "Eternal Sand", votes: { a: 1, b: 3 } },
    ]);
    expect(scenario.map).toEqual({ cols: 8, rows: 8, cells: { "0,0": "SNOW", "1,0": "SNOW", "2,0": "SAND", "3,0": "SAND" } });
    expect(scenario.settings.rule).toBe("two_round");
  });

  it("keeps what the UCTV show set up: race timing and call mode, photos, logos, multiplier", () => {
    const result = cliffResult({
      id: "pm",
      title: "Prime Minister",
      method: "SINGLE",
      scope: "PER_DISTRICT",
      seats: 1,
      options: [opt("a", "d1", "red"), opt("b", "d2", "blue")],
      national: tally({ a: 3, b: 2 }),
      districts: { d1: tally({ a: 3 }), d2: tally({ b: 2 }) },
    });
    const existing = {
      parties: [{ id: "red", name: "Old red", abbr: "OR", color: "#000000", logo: "/uploads/red.png" }],
      races: [{ id: "race_snow", name: "Snow", pollCloseSec: 90, countDurationSec: 45, callMode: "hold", candidates: [{ id: "a", name: "A", partyId: "red", photo: "/uploads/a.jpg", rawVotes: 0 }], counties: [{ id: "s-n", name: "North Snow" }] }],
      map: { cols: 8, rows: 8, cells: {} },
      settings: { voteMultiplier: 12000, rule: "two_round" },
    };
    const { scenario } = toScenario(result, [{ id: "red", name: "Red", abbr: "R", color: "#c22a2a" }, { id: "blue", name: "Blue", abbr: "B", color: "#2456a6" }], {}, existing, { geo: cliffs });
    const [snow, sand] = scenario.races;
    expect([snow.pollCloseSec, snow.countDurationSec, snow.callMode]).toEqual([90, 45, "hold"]);
    expect([sand.pollCloseSec, sand.countDurationSec, sand.callMode]).toEqual([0, 120, "standard"]); // new to UCTV: defaults
    expect(snow.candidates[0].photo).toBe("/uploads/a.jpg");
    expect(sand.candidates[0].photo).toBe("");
    // Our party names and colours win; UCTV's logo stays.
    expect(scenario.parties.find((p) => p.id === "red")).toEqual({ id: "red", name: "Red", abbr: "R", color: "#c22a2a", logo: "/uploads/red.png" });
    expect(scenario.parties.find((p) => p.id === "blue")?.logo).toBe("");
    expect(scenario.settings).toEqual({ voteMultiplier: 12000, rule: "plurality" });
    // A new UCTV election (nothing there yet) sends no multiplier, so UCTV's own default applies.
    expect(toScenario(result, [], {}, null, { geo: cliffs }).scenario.settings).toEqual({ rule: "plurality" });
  });

  it("only sends the chosen paper", () => {
    const base = cliffResult({ id: "pm", title: "Prime Minister", method: "SINGLE", scope: "NATIONAL", seats: 1, options: [opt("a", null, "red")], national: tally({ a: 1 }), districts: {} });
    base.contests.push({ ...base.contests[0], id: "vp", title: "Vice" });
    expect(toScenario(base, [], {}, null, { contestId: "vp" }).contestTitle).toBe("Vice");
    expect(toScenario(base, [], {}, null, { contestId: "gone" }).contestTitle).toBe("Prime Minister");
  });
});
