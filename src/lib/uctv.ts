// Sends a counted election to UCTV Elections (../uctv-elections) so election night runs on true numbers.
// UCTV's admin API: GET/PUT /api/v1/admin/elections/{id}[/scenario], POST …/generate-map, Bearer key with control scope.
// One paper per UCTV election (single, multi or list). Races are keyed by the district's UCTV race id or code, so the
// districts land on their own hexes; our counties and map (drawn in UCTV and imported here) go with them.
// A national paper is one race whose counties are the districts, each with its exact votes. UCTV builds that do not
// know `votes`, `seats` or `seatsWon` drop them and spread the race totals themselves.
import type { Organisation } from "@prisma/client";
import { db } from "./db";
import { orgUctv } from "./org";
import { Problem } from "./problem";
import { parseRule } from "./types";
import type { Result } from "./count";
import { fromUctvScenario, type County, type HexMap, type Parsed } from "./district-file";
import { geographyFor } from "./districts";

type UctvParty = { id: string; name: string; abbr: string; color: string; logo: string };
type UctvCounty = { id: string; name: string; votes?: Record<string, number> };
type UctvCandidate = { id: string; name: string; partyId: string; photo: string; rawVotes: number; seatsWon?: number };
type UctvRace = { id: string; name: string; pollCloseSec: number; countDurationSec: number; callMode: string; seats?: number; candidates: UctvCandidate[]; counties: UctvCounty[] };
type UctvScenario = { parties: UctvParty[]; races: UctvRace[]; map: unknown; settings: Record<string, unknown> };
export type Geography = { districts: Array<{ id: string; code: string; name: string; ref: string; counties: County[] }>; map: HexMap | null };

const SENT = new Set(["SINGLE", "MULTI", "PARTY_LIST"]);
const clip = (s: string, n: number) => s.slice(0, n);

/** The papers that can be shown on UCTV. */
export function sendable<T extends { method: string }>(contests: T[]): T[] {
  return contests.filter((c) => SENT.has(c.method));
}

/** Pure: turns a sealed result into one UCTV race per district (or one national race), keyed so UCTV keeps each district's hexes. */
export function toScenario(
  result: Result,
  parties: Array<{ id: string; name: string; abbr: string; color: string }>,
  rules: Record<string, { win: string }>,
  existing: UctvScenario | null,
  opts: { contestId?: string | null; geo?: Geography | null } = {},
): { scenario: UctvScenario; fresh: boolean; contestTitle: string } {
  const papers = sendable(result.contests);
  const c = papers.find((x) => x.id === opts.contestId) ?? papers[0];
  if (!c) throw new Problem("No paper in this election can be shown on UCTV (only single, multi and list papers are sent).");
  const geo: Geography = opts.geo ?? { districts: result.districts.map((d) => ({ ...d, ref: "", counties: [] })), map: null };
  const geoOf = (id: string) => geo.districts.find((d) => d.id === id);
  const outParties = new Map<string, UctvParty>(parties.map((p) => [p.id, { id: p.id, name: clip(p.name, 80), abbr: clip(p.abbr, 8) || "?", color: p.color, logo: "" }]));

  const candidatesOf = (options: typeof c.options, tally: { totals: Record<string, number>; seats?: Record<string, number> }): UctvCandidate[] =>
    options.map((o) => {
      const partyId = o.partyId && outParties.has(o.partyId) ? o.partyId : `opt-${o.id}`;
      if (!outParties.has(partyId)) outParties.set(partyId, { id: partyId, name: clip(o.name, 80), abbr: clip(o.name.replace(/[^A-Za-z]/g, "").toUpperCase(), 4) || "IND", color: o.color, logo: "" });
      const out: UctvCandidate = { id: clip(o.id, 64), name: clip(o.name, 80), partyId, photo: "", rawVotes: tally.totals[o.id] ?? 0 };
      if (tally.seats) out.seatsWon = tally.seats[o.id] ?? 0;
      return out;
    });
  const race = (id: string, name: string, candidates: UctvCandidate[], counties: UctvCounty[], seats?: number): UctvRace => ({
    id: clip(id, 64),
    name: clip(name, 60),
    pollCloseSec: 0,
    countDurationSec: 120,
    callMode: "standard",
    ...(seats && seats > 1 ? { seats } : {}),
    candidates,
    counties,
  });

  const races: UctvRace[] = [];
  let ourMap: HexMap | null = null;
  if (c.scope === "PER_DISTRICT") {
    for (const d of result.districts) {
      const tally = c.districts[d.id];
      if (!tally) continue;
      const g = geoOf(d.id);
      const key = g?.ref || d.code;
      const counties = g?.counties.length ? g.counties.map((k) => ({ id: clip(k.id, 64), name: clip(k.name, 60) })) : [{ id: clip(`${key}-c`, 64), name: clip(d.name, 60) }];
      const seats = tally.seats ? Object.values(tally.seats).reduce((a, b) => a + b, 0) : undefined;
      races.push(race(key, d.name, candidatesOf(c.options.filter((o) => o.districtId === d.id), tally), counties, seats));
    }
    ourMap = geo.map;
  } else {
    const inDistricts = result.districts.filter((d) => c.districts[d.id]);
    const counties: UctvCounty[] = inDistricts.length
      ? inDistricts.map((d) => ({ id: clip(d.code, 64), name: clip(d.name, 60), votes: Object.fromEntries(c.options.map((o) => [clip(o.id, 64), c.districts[d.id]!.totals[o.id] ?? 0])) }))
      : [{ id: clip(`${c.id}-c`, 64), name: "National" }];
    races.push(race(c.id, c.title, candidatesOf(c.options, c.national), counties, c.method === "PARTY_LIST" ? c.seats : undefined));
    // On the national race the map's counties become their districts.
    if (geo.map && inDistricts.length) {
      const codeOfCounty: Record<string, string> = {};
      for (const d of geo.districts) for (const k of d.counties) codeOfCounty[k.id] = d.code;
      const wanted = new Set(inDistricts.map((d) => d.code));
      const cells: Record<string, string> = {};
      for (const [k, v] of Object.entries(geo.map.cells)) {
        const code = codeOfCounty[v];
        if (code && wanted.has(code)) cells[k] = code;
      }
      ourMap = Object.keys(cells).length ? { ...geo.map, cells } : null;
    }
  }
  if (!races.length) throw new Problem(`"${c.title}" has no counted district to send.`);

  // Our map when we have one; otherwise UCTV's, when its races are ours (same ids); otherwise UCTV draws one.
  let map: unknown = ourMap;
  let fresh = false;
  if (!ourMap) {
    const theirs = new Map((existing?.races ?? []).map((r) => [r.id, r]));
    if (existing && races.every((r) => theirs.get(r.id)?.counties?.length)) {
      // Counties with exact votes (a national paper's districts) stay ours; plain ones take UCTV's painted counties.
      for (const r of races) if (!r.counties.some((k) => k.votes)) r.counties = theirs.get(r.id)!.counties;
      map = existing.map;
    } else {
      map = { cols: 8, rows: 8, cells: {} };
      fresh = true;
    }
  }
  const settings = { ...(existing?.settings ?? {}), voteMultiplier: 1, rule: rules[c.id]?.win === "MAJORITY_RUNOFF" ? "two_round" : "plurality" };
  return { scenario: { parties: [...outParties.values()], races, map, settings }, fresh, contestTitle: c.title };
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
  const geo = await geographyFor(e);
  const { scenario, fresh, contestTitle } = toScenario(JSON.parse(e.result) as Result, parties, rules, existing, { contestId: e.uctvContestId, geo });
  const put = await fetch(`${base}/scenario`, { method: "PUT", headers, body: JSON.stringify(scenario), signal: AbortSignal.timeout(20_000) });
  if (!put.ok) throw new Problem(`UCTV refused the results (${put.status}): ${(await put.text()).slice(0, 200)}`);
  if (fresh) await fetch(`${base}/generate-map`, { method: "POST", headers, signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
  return `Sent "${contestTitle}" to UCTV as ${scenario.races.length} race${scenario.races.length === 1 ? "" : "s"}.${fresh ? " UCTV drew a fresh map." : ""}`;
}

/** Reads a UCTV election's races, counties and map as a district file (for the import preview). */
export async function pullFromUctv(org: Organisation, uctvElectionId: string): Promise<Parsed> {
  const cfg = orgUctv(org);
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) throw new Problem("UCTV is not set up for this organisation (Settings → UCTV).");
  const id = uctvElectionId.trim();
  if (!id) throw new Problem("Give the UCTV election id.");
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/api/v1/admin/elections/${encodeURIComponent(id)}`;
  let got: Response;
  try {
    got = await fetch(url, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Problem("UCTV did not answer.");
  }
  if (!got.ok) throw new Problem(`UCTV did not find that election (${got.status}).`);
  const body = (await got.json()) as { name?: string; scenario?: unknown };
  if (!body.scenario) throw new Problem("UCTV sent no races for that election.");
  return { kind: "uctv", notes: [], file: fromUctvScenario(body.scenario, body.name ?? "") };
}
