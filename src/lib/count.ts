// Builds the result of an election from its counted ballots. Deterministic: the same ballots
// always give the same JSON, so a recount can compare byte for byte.
import type { District } from "@prisma/client";
import { parseRule } from "./types";
import { rollUp, tallyContest, type ContestTally, type Totals } from "./tally";
import type { FullElection } from "./elections";

export type ResultOption = { id: string; name: string; subtitle: string; color: string; symbol: string; partyId: string | null; districtId: string | null; list: string[] };
export type ResultContest = {
  id: string;
  title: string;
  method: string;
  scope: string;
  seats: number;
  options: ResultOption[];
  /** The whole paper (or the roll-up of its districts). */
  national: ContestTally & { byParty?: Record<string, { votes: number; seats: number }>; seated?: Record<string, string[]> };
  /** Per district: the paper's own count there (per-district papers), or the breakdown of a national paper. */
  districts: Record<string, ContestTally & { seated?: Record<string, string[]> }>;
};
export type Result = {
  electionId: string;
  ballots: number;
  turnout: { voted: number; eligible: number; byDistrict: Record<string, number> };
  districts: Array<{ id: string; name: string; code: string }>;
  contests: ResultContest[];
};

type CountedBallot = { contestId: string; districtId: string | null; data: string };

function seated(options: ResultOption[], seats: Totals | undefined): Record<string, string[]> | undefined {
  if (!seats) return undefined;
  const out: Record<string, string[]> = {};
  for (const o of options) if (seats[o.id]) out[o.id] = o.list.slice(0, seats[o.id]);
  return out;
}

export function buildResult(e: FullElection, ballots: CountedBallot[], districts: District[], turnout: Result["turnout"]): Result {
  const contests: ResultContest[] = e.contests.map((c) => {
    const rule = parseRule(c.rule);
    const options: ResultOption[] = c.options
      .filter((o) => o.status === "APPROVED")
      .map((o) => ({ id: o.id, name: o.name, subtitle: o.subtitle, color: o.color, symbol: o.symbol, partyId: o.partyId, districtId: o.districtId, list: o.listCandidates.map((l) => l.name) }));
    const mine = ballots.filter((b) => b.contestId === c.id);
    const marksOf = (list: CountedBallot[]) => list.map((b) => JSON.parse(b.data) as Record<string, unknown>);
    const spec = (seats: number) => ({ method: c.method, seats, rule });
    const perDistrict: ResultContest["districts"] = {};

    if (c.scope === "PER_DISTRICT") {
      for (const d of districts) {
        const opts = options.filter((o) => o.districtId === d.id);
        if (!opts.length) continue;
        const seats = c.districts.find((x) => x.districtId === d.id)?.seats ?? c.seats;
        const t = tallyContest(spec(seats), opts.map((o) => o.id), marksOf(mine.filter((b) => b.districtId === d.id)));
        perDistrict[d.id] = { ...t, ...(t.seats ? { seated: seated(opts, t.seats) } : {}) };
      }
      const national: ResultContest["national"] = rollUp(Object.values(perDistrict));
      // Lists of the same party in different districts are added up by party.
      const byParty: Record<string, { votes: number; seats: number }> = {};
      for (const o of options) {
        if (!o.partyId) continue;
        const p = (byParty[o.partyId] ??= { votes: 0, seats: 0 });
        p.votes += national.totals[o.id] ?? 0;
        p.seats += national.seats?.[o.id] ?? 0;
      }
      if (Object.keys(byParty).length) national.byParty = byParty;
      return { id: c.id, title: c.title, method: c.method, scope: c.scope, seats: c.seats, options, national, districts: perDistrict };
    }

    const ids = options.map((o) => o.id);
    const t = tallyContest(spec(c.seats), ids, marksOf(mine));
    const national: ResultContest["national"] = { ...t, ...(t.seats ? { seated: seated(options, t.seats) } : {}) };
    // A national paper is also broken down by district, for the map; nothing is decided there.
    for (const d of districts) {
      const part = mine.filter((b) => b.districtId === d.id);
      if (part.length) perDistrict[d.id] = tallyContest(spec(c.seats), ids, marksOf(part));
    }
    return { id: c.id, title: c.title, method: c.method, scope: c.scope, seats: c.seats, options, national, districts: perDistrict };
  });
  return {
    electionId: e.id,
    ballots: ballots.length,
    turnout,
    districts: districts.map((d) => ({ id: d.id, name: d.name, code: d.code })),
    contests,
  };
}
