// Counting. Pure functions only: marks in, totals and decisions out. No database, no clock.

export type Totals = Record<string, number>;
export type Outcome = "ELECTED" | "RUNOFF" | "TIED" | "NONE";

export type Round = { counts: Totals; eliminated?: string[]; elected?: string[]; exhausted: number };

export type ContestTally = {
  valid: number;
  blank: number;
  totals: Totals;
  outcome: Outcome;
  winners: string[];
  finalists?: string[];
  tied?: string[];
  seats?: Totals;
  rounds?: Round[];
  quota?: number;
  sums?: Totals;
  means?: Record<string, number>;
};

const byVotes = (totals: Totals) => (a: string, b: string) => totals[b] - totals[a] || a.localeCompare(b);
const zero = (ids: string[]): Totals => Object.fromEntries(ids.map((id) => [id, 0]));

/** Crosses on single, multi, yes/no and list papers. */
export function countChoices(marks: Array<{ x: string[] }>, optionIds: string[]) {
  const totals = zero(optionIds);
  let blank = 0;
  for (const m of marks) {
    if (m.x.length === 0) blank++;
    for (const id of m.x) if (id in totals) totals[id]++;
  }
  return { totals, blank, valid: marks.length - blank };
}

/** One winner: most votes, or (majority rule) more than majorityPct of the votes cast, else the top two go to a second round. */
export function decideSingle(totals: Totals, rule: { win: "PLURALITY" | "MAJORITY_RUNOFF"; majorityPct: number }): Pick<ContestTally, "outcome" | "winners" | "finalists" | "tied"> {
  const ids = Object.keys(totals).sort(byVotes(totals));
  const cast = ids.reduce((s, id) => s + totals[id], 0);
  if (cast === 0) return { outcome: "NONE", winners: [] };
  const top = totals[ids[0]];
  if (rule.win === "MAJORITY_RUNOFF" && top * 100 <= cast * rule.majorityPct) {
    const second = totals[ids[1]] ?? 0;
    // Everyone level with the leader, or level for second place, goes through.
    const leaders = ids.filter((id) => totals[id] === top);
    const finalists = leaders.length >= 2 ? leaders : [...leaders, ...ids.filter((id) => totals[id] === second && totals[id] < top)];
    return { outcome: "RUNOFF", winners: [], finalists };
  }
  const level = ids.filter((id) => totals[id] === top);
  if (level.length > 1) return { outcome: "TIED", winners: [], tied: level };
  return { outcome: "ELECTED", winners: [ids[0]] };
}

/** Several winners: the `seats` options with most votes; a tie at the cut is reported. */
export function decideMulti(totals: Totals, seats: number): Pick<ContestTally, "outcome" | "winners" | "tied"> {
  const ids = Object.keys(totals).filter((id) => totals[id] > 0).sort(byVotes(totals));
  if (ids.length === 0) return { outcome: "NONE", winners: [] };
  if (ids.length <= seats) return { outcome: "ELECTED", winners: ids };
  const cut = totals[ids[seats - 1]];
  const above = ids.filter((id) => totals[id] > cut);
  const atCut = ids.filter((id) => totals[id] === cut);
  if (above.length + atCut.length > seats) return { outcome: "TIED", winners: above, tied: atCut };
  return { outcome: "ELECTED", winners: ids.slice(0, seats) };
}

/** Seats among party lists: D'Hondt, Sainte-Laguë, or Hare quota with largest remainders. */
export function allocateSeats(totals: Totals, seats: number, method: "DHONDT" | "SAINTE_LAGUE" | "HARE", thresholdPct = 0): { seats: Totals; tie: boolean } {
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  const lists = Object.keys(totals).filter((id) => totals[id] > 0 && totals[id] * 100 >= all * thresholdPct);
  const out = zero(Object.keys(totals));
  if (lists.length === 0 || seats < 1) return { seats: out, tie: false };
  if (method === "HARE") {
    const sum = lists.reduce((s, id) => s + totals[id], 0);
    const quota = sum / seats;
    let given = 0;
    const rem: Array<[string, number]> = [];
    for (const id of lists) {
      const whole = Math.floor(totals[id] / quota);
      out[id] = whole;
      given += whole;
      rem.push([id, totals[id] / quota - whole]);
    }
    rem.sort((a, b) => b[1] - a[1] || totals[b[0]] - totals[a[0]]);
    const left = seats - given;
    const tie = left > 0 && left < rem.length && Math.abs(rem[left - 1][1] - rem[left][1]) < 1e-12 && totals[rem[left - 1][0]] === totals[rem[left][0]];
    for (let i = 0; i < left && i < rem.length; i++) out[rem[i][0]]++;
    return { seats: out, tie };
  }
  const divisor = (n: number) => (method === "DHONDT" ? n + 1 : 2 * n + 1);
  const quotients: Array<{ id: string; q: number }> = [];
  for (const id of lists) for (let n = 0; n < seats; n++) quotients.push({ id, q: totals[id] / divisor(n) });
  quotients.sort((a, b) => b.q - a.q || totals[b.id] - totals[a.id]);
  for (let i = 0; i < seats; i++) out[quotients[i].id]++;
  const last = quotients[seats - 1];
  const next = quotients[seats];
  const tie = !!next && Math.abs(last.q - next.q) < 1e-9 && totals[last.id] === totals[next.id] && last.id !== next.id;
  return { seats: out, tie };
}

/** Instant runoff: drop the lowest until someone holds more than half of the papers still in play. */
export function irv(rankings: string[][], optionIds: string[]): Pick<ContestTally, "outcome" | "winners" | "rounds" | "tied"> {
  const firstRound = zero(optionIds);
  for (const r of rankings) if (r[0] in firstRound) firstRound[r[0]]++;
  const live = new Set(optionIds);
  const rounds: Round[] = [];
  let tieSeen = false;
  for (let guard = 0; guard < optionIds.length + 1; guard++) {
    const counts = zero([...live]);
    let exhausted = 0;
    for (const r of rankings) {
      const pick = r.find((id) => live.has(id));
      if (pick) counts[pick]++;
      else exhausted++;
    }
    const inPlay = rankings.length - exhausted;
    const order = [...live].sort(byVotes(counts));
    if (inPlay === 0) return { outcome: "NONE", winners: [], rounds: [...rounds, { counts, exhausted }] };
    if (counts[order[0]] * 2 > inPlay || live.size === 1) {
      rounds.push({ counts, exhausted, elected: [order[0]] });
      return { outcome: "ELECTED", winners: [order[0]], rounds, ...(tieSeen ? { tied: [] } : {}) };
    }
    if (live.size === 2 && counts[order[0]] === counts[order[1]]) {
      rounds.push({ counts, exhausted });
      return { outcome: "TIED", winners: [], rounds, tied: order };
    }
    // Lowest goes out; a tie for lowest is broken by the first round, and noted.
    const low = Math.min(...order.map((id) => counts[id]));
    const lowest = order.filter((id) => counts[id] === low);
    let out = lowest[lowest.length - 1];
    if (lowest.length > 1) {
      tieSeen = true;
      out = lowest.sort((a, b) => firstRound[a] - firstRound[b] || b.localeCompare(a))[0];
    }
    live.delete(out);
    rounds.push({ counts, exhausted, eliminated: [out] });
  }
  return { outcome: "NONE", winners: [], rounds };
}

const UNIT = 1_000_000_000; // ballot weights in billionths, so transfers stay exact enough and deterministic

/** Single transferable vote: Droop quota, weighted inclusive Gregory transfers. */
export function stv(rankings: string[][], optionIds: string[], seats: number): Pick<ContestTally, "outcome" | "winners" | "rounds" | "quota" | "tied"> {
  const valid = rankings.filter((r) => r.length > 0).length;
  const quota = Math.floor(valid / (seats + 1)) + 1;
  const ballots = rankings.filter((r) => r.length > 0).map((r) => ({ prefs: r, w: UNIT }));
  const hopeful = new Set(optionIds);
  const elected: string[] = [];
  const rounds: Round[] = [];
  let tied: string[] | undefined;
  const current = (b: { prefs: string[] }) => b.prefs.find((id) => hopeful.has(id));
  for (let guard = 0; guard < optionIds.length * 3 + 5 && elected.length < seats; guard++) {
    const counts = zero([...hopeful]);
    let exhausted = 0;
    for (const b of ballots) {
      const c = current(b);
      if (c) counts[c] += b.w;
      else exhausted += b.w;
    }
    const show = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round((v / UNIT) * 1000) / 1000]));
    const order = [...hopeful].sort(byVotes(counts));
    if (hopeful.size + elected.length <= seats) {
      rounds.push({ counts: show, exhausted: exhausted / UNIT, elected: order });
      elected.push(...order);
      break;
    }
    const reached = order.filter((id) => counts[id] >= quota * UNIT);
    if (reached.length) {
      // The largest surplus is transferred first, one candidate per round.
      const id = reached[0];
      const total = counts[id];
      const surplus = total - quota * UNIT;
      hopeful.delete(id);
      elected.push(id);
      for (const b of ballots) if (b.prefs.find((x) => x === id || hopeful.has(x)) === id) b.w = Math.floor((b.w * surplus) / total);
      rounds.push({ counts: show, exhausted: exhausted / UNIT, elected: [id] });
      continue;
    }
    const low = Math.min(...order.map((id) => counts[id]));
    const lowest = order.filter((id) => counts[id] === low);
    if (lowest.length > 1) tied = lowest;
    const out = lowest[lowest.length - 1];
    hopeful.delete(out);
    rounds.push({ counts: show, exhausted: exhausted / UNIT, eliminated: [out] });
  }
  return { outcome: elected.length ? (tied ? "TIED" : "ELECTED") : "NONE", winners: elected, rounds, quota, ...(tied ? { tied } : {}) };
}

/** Score papers: the highest sum wins; a tie on the sum goes to the higher mean. */
export function scoreTotals(marks: Array<{ s: Record<string, number> }>, optionIds: string[]): Pick<ContestTally, "sums" | "means" | "outcome" | "winners" | "tied"> & { counts: Totals } {
  const sums = zero(optionIds);
  const counts = zero(optionIds);
  for (const m of marks) for (const [id, v] of Object.entries(m.s)) if (id in sums) {
    sums[id] += v;
    counts[id]++;
  }
  const means = Object.fromEntries(optionIds.map((id) => [id, counts[id] ? Math.round((sums[id] / counts[id]) * 100) / 100 : 0]));
  const ids = [...optionIds].sort((a, b) => sums[b] - sums[a] || means[b] - means[a]);
  if (!ids.length || sums[ids[0]] === 0) return { sums, means, counts, outcome: "NONE", winners: [] };
  const level = ids.filter((id) => sums[id] === sums[ids[0]] && means[id] === means[ids[0]]);
  if (level.length > 1) return { sums, means, counts, outcome: "TIED", winners: [], tied: level };
  return { sums, means, counts, outcome: "ELECTED", winners: [ids[0]] };
}

export type ContestSpec = {
  method: string;
  seats: number;
  rule: { win: "PLURALITY" | "MAJORITY_RUNOFF"; majorityPct: number; pr: "DHONDT" | "SAINTE_LAGUE" | "HARE"; prThresholdPct: number; scoreMax: number };
};

/** Counts one paper's ballots by its method. Marks are already validated and canonical. */
export function tallyContest(spec: ContestSpec, optionIds: string[], marks: Array<Record<string, unknown>>): ContestTally {
  if (spec.method === "RANKED") {
    const rankings = marks.map((m) => (m.r as string[]) ?? []);
    const blank = rankings.filter((r) => r.length === 0).length;
    const first = zero(optionIds);
    for (const r of rankings) if (r[0] in first) first[r[0]]++;
    const result = spec.seats > 1 ? stv(rankings, optionIds, spec.seats) : irv(rankings.filter((r) => r.length), optionIds);
    return { valid: rankings.length - blank, blank, totals: first, ...result };
  }
  if (spec.method === "SCORE") {
    const scored = marks.map((m) => ({ s: (m.s as Record<string, number>) ?? {} }));
    const blank = scored.filter((m) => Object.keys(m.s).length === 0).length;
    const r = scoreTotals(scored, optionIds);
    return { valid: scored.length - blank, blank, totals: r.sums!, sums: r.sums, means: r.means, outcome: r.outcome, winners: r.winners, ...(r.tied ? { tied: r.tied } : {}) };
  }
  const { totals, blank, valid } = countChoices(marks.map((m) => ({ x: (m.x as string[]) ?? [] })), optionIds);
  if (spec.method === "PARTY_LIST") {
    const { seats, tie } = allocateSeats(totals, spec.seats, spec.rule.pr, spec.rule.prThresholdPct);
    const winners = Object.keys(seats).filter((id) => seats[id] > 0).sort((a, b) => seats[b] - seats[a]);
    return { valid, blank, totals, seats, outcome: valid ? (tie ? "TIED" : "ELECTED") : "NONE", winners };
  }
  if (spec.method === "MULTI") return { valid, blank, totals, ...decideMulti(totals, spec.seats) };
  if (spec.method === "YESNO") return { valid, blank, totals, ...decideSingle(totals, { win: "PLURALITY", majorityPct: 50 }) };
  return { valid, blank, totals, ...decideSingle(totals, spec.rule) };
}

/** Adds up per-district list seats (and totals) into a national picture. */
export function rollUp(parts: ContestTally[]): ContestTally {
  const totals: Totals = {};
  const seats: Totals = {};
  let valid = 0;
  let blank = 0;
  for (const p of parts) {
    valid += p.valid;
    blank += p.blank;
    for (const [k, v] of Object.entries(p.totals)) totals[k] = (totals[k] ?? 0) + v;
    for (const [k, v] of Object.entries(p.seats ?? {})) seats[k] = (seats[k] ?? 0) + v;
  }
  const winners = parts.flatMap((p) => p.winners);
  return { valid, blank, totals, ...(Object.keys(seats).length ? { seats } : {}), outcome: winners.length ? "ELECTED" : "NONE", winners: [...new Set(winners)] };
}
