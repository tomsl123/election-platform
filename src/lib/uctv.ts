// Sends a counted election to UCTV Elections (../uctv-elections) so election night runs on true numbers.
// UCTV's admin API: GET/PUT /api/v1/admin/elections/{id}[/scenario], POST …/generate-map, Bearer key with control scope.
// One race per single-winner, multi or list paper (per district for per-district papers); ranked, score
// and yes/no papers are not sent. UCTV spreads a race's votes over its counties itself, so only race totals are exact.
import { db } from "./db";
import { orgUctv } from "./org";
import { Problem } from "./problem";
import { parseRule } from "./types";
import type { Result } from "./count";

type UctvParty = { id: string; name: string; abbr: string; color: string; logo: string };
type UctvRace = { id: string; name: string; pollCloseSec: number; countDurationSec: number; callMode: string; candidates: Array<{ id: string; name: string; partyId: string; photo: string; rawVotes: number }>; counties: Array<{ id: string; name: string }> };
type UctvScenario = { parties: UctvParty[]; races: UctvRace[]; map: unknown; settings: Record<string, unknown> };

const SENT = new Set(["SINGLE", "MULTI", "PARTY_LIST"]);
const clip = (s: string, n: number) => s.slice(0, n);

/** Pure: turns a sealed result into UCTV races and parties, reusing the counties of races UCTV already has. */
export function toScenario(result: Result, parties: Array<{ id: string; name: string; abbr: string; color: string }>, rules: Record<string, { win: string }>, existing: UctvScenario | null): { scenario: UctvScenario; fresh: boolean } {
  const outParties = new Map<string, UctvParty>(parties.map((p) => [p.id, { id: p.id, name: clip(p.name, 80), abbr: clip(p.abbr, 8) || "?", color: p.color, logo: "" }]));
  const races: UctvRace[] = [];
  for (const c of result.contests) {
    if (!SENT.has(c.method)) continue;
    const parts = c.scope === "PER_DISTRICT" ? result.districts.filter((d) => c.districts[d.id]).map((d) => ({ key: `${c.id}-${d.id}`, name: `${c.title} · ${d.name}`, tally: c.districts[d.id], options: c.options.filter((o) => o.districtId === d.id), county: d.name })) : [{ key: c.id, name: c.title, tally: c.national, options: c.options, county: "National" }];
    for (const p of parts) {
      const candidates = p.options.map((o) => {
        let partyId = o.partyId && outParties.has(o.partyId) ? o.partyId : `opt-${o.id}`;
        if (!outParties.has(partyId)) outParties.set(partyId, { id: partyId, name: clip(o.name, 80), abbr: clip(o.name.replace(/[^A-Za-z]/g, "").toUpperCase(), 4) || "IND", color: o.color, logo: "" });
        if (!o.partyId) partyId = `opt-${o.id}`;
        return { id: clip(o.id, 64), name: clip(o.name, 80), partyId, photo: "", rawVotes: p.tally.totals[o.id] ?? 0 };
      });
      races.push({ id: clip(p.key, 64), name: clip(p.name, 60), pollCloseSec: 0, countDurationSec: 120, callMode: "standard", candidates, counties: [{ id: clip(`${p.key}-c`, 64), name: clip(p.county, 60) }] });
    }
  }
  if (!races.length) throw new Problem("No paper in this election can be shown on UCTV (only single, multi and list papers are sent).");
  // Keep UCTV's geography: race i reuses the counties (and so the map) of UCTV's race i when it has one.
  const fresh = !existing || existing.races.length === 0;
  if (existing) races.forEach((r, i) => existing.races[i]?.counties?.length && (r.counties = existing.races[i].counties));
  const anyMajority = Object.values(rules).some((r) => r.win === "MAJORITY_RUNOFF");
  const settings = { ...(existing?.settings ?? {}), voteMultiplier: 1, rule: anyMajority ? "two_round" : "plurality" };
  return { scenario: { parties: [...outParties.values()], races, map: existing?.map ?? { cols: 8, rows: 8, cells: {} }, settings }, fresh };
}

export async function sendToUctv(electionId: string): Promise<string> {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId }, include: { org: true, contests: true } });
  const cfg = orgUctv(e.org);
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) throw new Problem("UCTV is not set up for this organisation (Settings → UCTV).");
  if (!e.uctvElectionId) throw new Problem("Give the UCTV election id first (Polling day → UCTV).");
  if (!e.result) throw new Problem("Only a counted election can be sent.");
  const base = `${cfg.baseUrl.replace(/\/+$/, "")}/api/v1/admin/elections/${encodeURIComponent(e.uctvElectionId)}`;
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" };
  const got = await fetch(base, { headers, signal: AbortSignal.timeout(15_000) });
  if (!got.ok) throw new Problem(`UCTV did not find that election (${got.status}).`);
  const existing = ((await got.json()) as { scenario?: UctvScenario }).scenario ?? null;
  const parties = await db.party.findMany({ where: { orgId: e.orgId } });
  const rules = Object.fromEntries(e.contests.map((c) => [c.id, parseRule(c.rule)]));
  const { scenario, fresh } = toScenario(JSON.parse(e.result) as Result, parties, rules, existing);
  const put = await fetch(`${base}/scenario`, { method: "PUT", headers, body: JSON.stringify(scenario), signal: AbortSignal.timeout(20_000) });
  if (!put.ok) throw new Problem(`UCTV refused the results (${put.status}): ${(await put.text()).slice(0, 200)}`);
  if (fresh) await fetch(`${base}/generate-map`, { method: "POST", headers, signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
  return `Sent ${scenario.races.length} race${scenario.races.length === 1 ? "" : "s"} to UCTV.${fresh ? " UCTV drew a fresh map." : ""}`;
}
