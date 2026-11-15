// What a voter may write on each kind of paper. Pure functions shared by the booth (client)
// and the ballot box (server): the server re-validates every mark with validateMark().

export type StationOption = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  symbol: string;
  photoUrl: string | null;
  list: string[];
};

export type StationContest = {
  id: string;
  title: string;
  instruction: string;
  method: "SINGLE" | "MULTI" | "YESNO" | "RANKED" | "SCORE" | "PARTY_LIST";
  maxChoices: number;
  scoreMax: number;
  allowBlank: boolean;
  options: StationOption[];
};

export type ChoiceMark = { x: string[] };
export type RankMark = { r: string[] };
export type ScoreMark = { s: Record<string, number> };
export type AnyMark = ChoiceMark | RankMark | ScoreMark;

export function emptyMark(c: Pick<StationContest, "method">): AnyMark {
  if (c.method === "RANKED") return { r: [] };
  if (c.method === "SCORE") return { s: {} };
  return { x: [] };
}

export function maxFor(c: Pick<StationContest, "method" | "maxChoices">): number {
  return c.method === "MULTI" ? Math.max(1, c.maxChoices) : 1;
}

/** Crossing a box: single-choice papers move the cross, multi-choice papers refuse one too many. */
export function toggleChoice(c: Pick<StationContest, "method" | "maxChoices">, mark: ChoiceMark, id: string): { mark: ChoiceMark; result: "on" | "off" | "full"; off: string[] } {
  const cur = mark.x;
  if (cur.includes(id)) return { mark: { x: cur.filter((v) => v !== id) }, result: "off", off: [id] };
  const max = maxFor(c);
  if (max === 1) return { mark: { x: [id] }, result: "on", off: cur };
  if (cur.length >= max) return { mark, result: "full", off: [] };
  return { mark: { x: [...cur, id] }, result: "on", off: [] };
}

/** Numbering a box: it takes the next number; numbering it again rubs out it and every later one. */
export function toggleRank(mark: RankMark, id: string): { mark: RankMark; result: "on" | "off"; off: string[] } {
  const i = mark.r.indexOf(id);
  if (i >= 0) return { mark: { r: mark.r.slice(0, i) }, result: "off", off: mark.r.slice(i) };
  return { mark: { r: [...mark.r, id] }, result: "on", off: [] };
}

export function setScore(mark: ScoreMark, id: string, value: number | null): ScoreMark {
  const s = { ...mark.s };
  if (value === null) delete s[id];
  else s[id] = value;
  return { s };
}

/** May this paper be folded? */
export function isComplete(c: StationContest, mark: AnyMark): boolean {
  if ("x" in mark) return mark.x.length >= 1 && mark.x.length <= maxFor(c);
  if ("r" in mark) return mark.r.length >= 1;
  return Object.keys(mark.s).length >= 1;
}

export function isBlank(mark: AnyMark): boolean {
  if ("x" in mark) return mark.x.length === 0;
  if ("r" in mark) return mark.r.length === 0;
  return Object.keys(mark.s).length === 0;
}

/**
 * Checks a mark against the paper and returns its canonical form (sorted ids, integer scores),
 * or null when it is not a valid mark. Blank marks are valid only when the paper allows them.
 */
export function validateMark(
  c: { method: string; maxChoices: number; scoreMax: number; allowBlank: boolean },
  optionIds: string[],
  raw: unknown,
): AnyMark | null {
  if (!raw || typeof raw !== "object") return null;
  const known = new Set(optionIds);
  const m = raw as Record<string, unknown>;
  if (c.method === "RANKED") {
    if (!Array.isArray(m.r)) return null;
    const r = m.r.map(String);
    if (new Set(r).size !== r.length || r.some((id) => !known.has(id))) return null;
    if (r.length === 0 && !c.allowBlank) return null;
    return { r };
  }
  if (c.method === "SCORE") {
    if (!m.s || typeof m.s !== "object" || Array.isArray(m.s)) return null;
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(m.s as Record<string, unknown>)) {
      const n = Number(v);
      if (!known.has(id) || !Number.isInteger(n) || n < 0 || n > c.scoreMax) return null;
      out[id] = n;
    }
    if (Object.keys(out).length === 0 && !c.allowBlank) return null;
    const sorted: Record<string, number> = {};
    for (const k of Object.keys(out).sort()) sorted[k] = out[k];
    return { s: sorted };
  }
  if (!Array.isArray(m.x)) return null;
  const x = m.x.map(String);
  if (new Set(x).size !== x.length || x.some((id) => !known.has(id))) return null;
  if (x.length === 0 && !c.allowBlank) return null;
  if (x.length > maxFor({ method: c.method as StationContest["method"], maxChoices: c.maxChoices })) return null;
  return { x: [...x].sort() };
}
