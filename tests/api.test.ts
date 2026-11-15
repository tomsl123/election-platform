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
    const existing = { parties: [], races: [{ id: "old", name: "Old", pollCloseSec: 0, countDurationSec: 120, callMode: "standard", candidates: [], counties: [{ id: "k1", name: "North" }] }], map: { cols: 4, rows: 4, cells: { "0,0": "k1" } }, settings: { voteMultiplier: 8750, rule: "two_round", nightStart: "21:00" } };
    const { scenario, fresh } = toScenario(result, [{ id: "ca", name: "Cliffs Assemble", abbr: "CA", color: "#d99a12" }], { pm: { win: "PLURALITY" } }, existing);
    expect(fresh).toBe(false);
    expect(scenario.races).toHaveLength(1);
    expect(scenario.races[0].counties).toEqual([{ id: "k1", name: "North" }]);
    expect(scenario.races[0].candidates.map((c) => [c.name, c.partyId, c.rawVotes])).toEqual([
      ["Simons", "ca", 2],
      ["Independent Joe", "opt-b", 1],
    ]);
    expect(scenario.settings).toMatchObject({ voteMultiplier: 1, rule: "plurality", nightStart: "21:00" });
    expect(scenario.parties.map((p) => p.id).sort()).toEqual(["ca", "opt-b"]);
  });
});
