// The district file both Polling Station and UCTV Elections read and write, its parsers and the import diff.
// Pure: no database. The shape of `map` is UCTV's HexMap, so maps drawn in UCTV's painter copy over as they are.
import { z } from "zod";
import { Problem } from "./problem";

export type County = { id: string; name: string };
export type HexMap = { cols: number; rows: number; cells: Record<string, string> };
/** `seats` null = not given (keep what the set has, 1 for a new district). County `id` "" = not given (resolved on import). */
export type FileDistrict = { code: string; name: string; seats: number | null; ref: string; counties: County[] };
export type DistrictFile = { format: "usfc-districts"; version: 1; name: string; districts: FileDistrict[]; map: HexMap | null };
export type Parsed = { file: DistrictFile; kind: "districts" | "uctv" | "uctv-legacy" | "csv"; notes: string[] };

export const MAX_DISTRICTS = 500;
const CODE = /^[A-Z0-9-]{1,12}$/;
const KEY = /^\d{1,3},\d{1,3}$/;

const HexMapSchema = z.object({
  cols: z.number().int().min(4).max(120),
  rows: z.number().int().min(4).max(120),
  cells: z.record(z.string(), z.string()),
});

const FileSchema = z.object({
  format: z.literal("usfc-districts"),
  version: z.literal(1),
  name: z.string().max(80).default(""),
  districts: z
    .array(
      z.object({
        code: z.string().min(1).max(12),
        name: z.string().min(1).max(80),
        seats: z.number().int().min(1).max(10000).nullish(),
        ref: z.string().max(64).nullish(),
        counties: z.array(z.object({ id: z.string().max(64).nullish(), name: z.string().min(1).max(60) })).nullish(),
      }),
    )
    .min(1)
    .max(MAX_DISTRICTS),
  map: HexMapSchema.nullish(),
});

const UctvScenario = z.object({
  races: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(80),
        seats: z.number().int().min(1).optional(),
        counties: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(60) })).default([]),
      }),
    )
    .min(1)
    .max(MAX_DISTRICTS),
  map: HexMapSchema.nullish(),
});

const Legacy = z.object({
  constituencies: z
    .array(z.object({ id: z.union([z.string(), z.number()]), name: z.string().min(1).max(80), counties: z.array(z.object({ name: z.string().min(1).max(60) })).nullish() }))
    .min(1)
    .max(MAX_DISTRICTS),
});

// ── Small helpers used across the app ───────────────────────────────────────

export function readCounties(json: string | null | undefined): County[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((c) => c && typeof c.id === "string" && typeof c.name === "string").map((c) => ({ id: c.id, name: c.name })) : [];
  } catch {
    return [];
  }
}

export function readMap(json: string | null | undefined): HexMap | null {
  if (!json) return null;
  try {
    const r = HexMapSchema.safeParse(JSON.parse(json));
    return r.success && Object.keys(r.data.cells).length ? r.data : null;
  } catch {
    return null;
  }
}

export function normaliseCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "area";

/** A short code from a name, unique among `taken`: "Crimson Heights" → "CRIMSO", then "CRIMSO-2". */
function codeFromName(name: string, taken: Set<string>): string {
  const base = normaliseCode(name.replace(/[^A-Za-z0-9]/g, "")).slice(0, 6) || "D";
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base.slice(0, 12 - String(i).length - 1)}-${i}`;
  taken.add(code);
  return code;
}

// ── Parsing ────────────────────────────────────────────────────────────────

/** Reads any supported district file: ours, UCTV's export or scenario, UCTV's legacy file, or CSV. */
export function parseDistrictFile(text: string, filename = ""): Parsed {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) throw new Problem("The file is empty.");
  if (trimmed.startsWith("{") || /\.json$/i.test(filename)) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Problem("The file is not valid JSON.");
    }
    return finish(fromJson(raw));
  }
  return finish({ file: parseCsv(trimmed), kind: "csv", notes: [] });
}

function fromJson(raw: unknown): Parsed {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.format === "usfc-districts") {
    const r = FileSchema.safeParse(raw);
    if (!r.success) throw new Problem(`The district file is not valid: ${zodMessage(r.error)}`);
    const f = r.data;
    return {
      kind: "districts",
      notes: [],
      file: {
        format: "usfc-districts",
        version: 1,
        name: f.name,
        map: f.map ?? null,
        districts: f.districts.map((d) => ({ code: d.code, name: d.name, seats: d.seats ?? null, ref: d.ref ?? "", counties: (d.counties ?? []).map((c) => ({ id: c.id ?? "", name: c.name })) })),
      },
    };
  }
  if (o.app === "UCTV_ELECTIONS" && o.scenario) return fromUctv(o.scenario, typeof o.name === "string" ? o.name : "");
  if (Array.isArray(o.races)) return fromUctv(raw, "");
  if (Array.isArray(o.constituencies)) {
    const r = Legacy.safeParse(raw);
    if (!r.success) throw new Problem(`The UCTV file is not valid: ${zodMessage(r.error)}`);
    const taken = new Set<string>();
    return {
      kind: "uctv-legacy",
      notes: ["The old UCTV file has no map; only districts and county names are read."],
      file: {
        format: "usfc-districts",
        version: 1,
        name: "",
        map: null,
        districts: r.data.constituencies.map((c) => ({ code: codeFromName(c.name, taken), name: c.name, seats: null, ref: String(c.id), counties: (c.counties ?? []).map((k) => ({ id: "", name: k.name })) })),
      },
    };
  }
  throw new Problem("This is not a district file, a UCTV export or a UCTV scenario.");
}

/** UCTV races become districts: `ref` keeps the race id; the code is the race id when it fits, otherwise taken from the name. */
export function fromUctvScenario(scenario: unknown, name = ""): DistrictFile {
  return fromUctv(scenario, name).file;
}

function fromUctv(scenario: unknown, name: string): Parsed {
  const r = UctvScenario.safeParse(scenario);
  if (!r.success) throw new Problem(`The UCTV election is not valid: ${zodMessage(r.error)}`);
  const taken = new Set<string>();
  const fits = r.data.races.map((race) => (CODE.test(race.id.toUpperCase()) ? race.id.toUpperCase() : null));
  for (const c of fits) if (c) taken.add(c);
  return {
    kind: "uctv",
    notes: [],
    file: {
      format: "usfc-districts",
      version: 1,
      name,
      map: r.data.map ?? null,
      districts: r.data.races.map((race, i) => ({ code: fits[i] ?? codeFromName(race.name, taken), name: race.name, seats: race.seats ?? null, ref: race.id, counties: race.counties.map((c) => ({ id: c.id, name: c.name })) })),
    },
  };
}

/** Quote-aware CSV split; the separator is whichever of , ; tab the first line uses most. */
export function splitCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** CSV `code,name,seats,county`: one row per county; a row without a county is a district without sub-areas. */
function parseCsv(text: string): DistrictFile {
  const rows = splitCsv(text);
  let cols = { code: 0, name: 1, seats: 2, county: 3 };
  const head = rows[0]?.map((c) => c.toLowerCase()) ?? [];
  if (head.includes("code")) {
    const at = (k: string) => head.indexOf(k);
    cols = { code: at("code"), name: at("name"), seats: at("seats"), county: at("county") };
    rows.shift();
  }
  const byCode = new Map<string, FileDistrict>();
  rows.forEach((r, i) => {
    const line = i + (head.includes("code") ? 2 : 1);
    const code = normaliseCode(r[cols.code] ?? "");
    const name = (cols.name >= 0 ? r[cols.name] : "")?.slice(0, 80) ?? "";
    const seatsRaw = cols.seats >= 0 ? (r[cols.seats] ?? "") : "";
    const county = (cols.county >= 0 ? r[cols.county] : "")?.slice(0, 60) ?? "";
    if (!code) throw new Problem(`Line ${line}: the district has no code.`);
    const seats = seatsRaw ? Number(seatsRaw) : null;
    if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 10000)) throw new Problem(`Line ${line}: seats must be a whole number from 1 to 10000.`);
    let d = byCode.get(code);
    if (!d) {
      if (!name) throw new Problem(`Line ${line}: the district ${code} has no name.`);
      d = { code, name, seats, ref: "", counties: [] };
      byCode.set(code, d);
    } else if (seats !== null) {
      if (d.seats !== null && d.seats !== seats) throw new Problem(`Line ${line}: ${code} has ${d.seats} seats on an earlier line; give every line of a district the same seats, or leave them empty.`);
      d.seats = seats;
    }
    if (county && !d.counties.some((c) => c.name.toLowerCase() === county.toLowerCase())) d.counties.push({ id: "", name: county });
  });
  if (!byCode.size) throw new Problem("The CSV has no districts.");
  return { format: "usfc-districts", version: 1, name: "", map: null, districts: [...byCode.values()] };
}

/** Checks codes and county ids, drops map cells that point nowhere. */
function finish(p: Parsed): Parsed {
  const { file } = p;
  if (file.districts.length > MAX_DISTRICTS) throw new Problem(`A set holds at most ${MAX_DISTRICTS} districts.`);
  const codes = new Set<string>();
  const counties = new Set<string>();
  for (const d of file.districts) {
    d.code = normaliseCode(d.code);
    if (!CODE.test(d.code)) throw new Problem(`"${d.name}": a code is 1 to 12 letters, digits or dashes.`);
    if (codes.has(d.code)) throw new Problem(`The code ${d.code} is used twice.`);
    codes.add(d.code);
    for (const c of d.counties) {
      if (!c.id) continue;
      if (counties.has(c.id)) throw new Problem(`The county id ${c.id} is used twice.`);
      counties.add(c.id);
    }
  }
  if (file.map) {
    let dropped = 0;
    const cells: Record<string, string> = {};
    for (const [k, v] of Object.entries(file.map.cells)) {
      const [q, r] = k.split(",").map(Number);
      if (KEY.test(k) && q! < file.map.cols && r! < file.map.rows && counties.has(v)) cells[k] = v;
      else dropped++;
    }
    file.map = Object.keys(cells).length ? { ...file.map, cells } : null;
    if (dropped) p.notes.push(`${dropped} map cell${dropped === 1 ? "" : "s"} pointed at no county and were left out.`);
  }
  return p;
}

function zodMessage(e: z.ZodError): string {
  const i = e.issues[0];
  return i ? `${i.path.join(".") || "file"}: ${i.message}` : "unknown problem";
}

// ── Export ─────────────────────────────────────────────────────────────────

export type SetForFile = { name: string; map: string; districts: Array<{ code: string; name: string; seats: number; ref: string; counties: string }> };

export function toDistrictFile(set: SetForFile): DistrictFile {
  return {
    format: "usfc-districts",
    version: 1,
    name: set.name,
    districts: set.districts.map((d) => ({ code: d.code, name: d.name, seats: d.seats, ref: d.ref, counties: readCounties(d.counties) })),
    map: readMap(set.map),
  };
}

const csvCell = (s: string) => (/[",;\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toDistrictCsv(set: SetForFile): string {
  const lines = ["code,name,seats,county"];
  for (const d of set.districts) {
    const counties = readCounties(d.counties);
    for (const c of counties.length ? counties : [null]) lines.push([d.code, d.name, String(d.seats), c?.name ?? ""].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// ── Import diff ────────────────────────────────────────────────────────────

export type CurrentDistrict = { id: string; code: string; name: string; seats: number; ref: string; counties: County[]; used: boolean };
export type PlannedDistrict = { code: string; name: string; seats: number; ref: string; counties: County[] };
export type DistrictPlan = {
  add: PlannedDistrict[];
  change: Array<{ id: string; code: string; was: CurrentDistrict; to: PlannedDistrict; fields: string[] }>;
  same: number;
  /** In the set but not in the file. Removed on apply only when asked and not used by any paper or voter. */
  missing: Array<{ id: string; code: string; name: string; used: boolean }>;
  map: HexMap | null;
  mapChanged: boolean;
};

/** What applying `file` to a set would do. Districts match by `ref`, then code, then name; an existing code never changes. */
export function planDistrictImport(current: CurrentDistrict[], currentMap: HexMap | null, file: DistrictFile): DistrictPlan {
  const left = new Map(current.map((d) => [d.id, d]));
  const codesTaken = new Set(current.map((d) => d.code));
  const plan: DistrictPlan = { add: [], change: [], same: 0, missing: [], map: null, mapChanged: false };
  const usedCountyIds = new Set<string>();
  const resolveCounties = (code: string, wanted: County[], was: County[]): County[] =>
    wanted.map((c) => {
      let id = c.id || was.find((w) => w.name.toLowerCase() === c.name.toLowerCase())?.id || "";
      if (!id || usedCountyIds.has(id)) {
        const base = `${code.toLowerCase()}-${slug(c.name)}`.slice(0, 60);
        id = base;
        for (let i = 2; usedCountyIds.has(id); i++) id = `${base}-${i}`;
      }
      usedCountyIds.add(id);
      return { id, name: c.name };
    });

  for (const f of file.districts) {
    const pick = (fn: (d: CurrentDistrict) => boolean) => [...left.values()].find(fn);
    const was = (f.ref ? pick((d) => d.ref === f.ref) : undefined) ?? pick((d) => d.code === f.code) ?? pick((d) => d.name.toLowerCase() === f.name.toLowerCase());
    if (!was) {
      let code = f.code;
      for (let i = 2; codesTaken.has(code); i++) code = `${f.code.slice(0, 12 - String(i).length - 1)}-${i}`;
      codesTaken.add(code);
      plan.add.push({ code, name: f.name, seats: f.seats ?? 1, ref: f.ref, counties: resolveCounties(code, f.counties, []) });
      continue;
    }
    left.delete(was.id);
    const to: PlannedDistrict = { code: was.code, name: f.name, seats: f.seats ?? was.seats, ref: f.ref || was.ref, counties: resolveCounties(was.code, f.counties, was.counties) };
    const fields: string[] = [];
    if (to.name !== was.name) fields.push("name");
    if (to.seats !== was.seats) fields.push("seats");
    if (to.ref !== was.ref) fields.push("ref");
    if (JSON.stringify(to.counties) !== JSON.stringify(was.counties)) fields.push("counties");
    if (fields.length) plan.change.push({ id: was.id, code: was.code, was, to, fields });
    else plan.same++;
  }
  plan.missing = [...left.values()].map((d) => ({ id: d.id, code: d.code, name: d.name, used: d.used }));

  // The file's map wins; otherwise keep ours, minus cells whose county is gone. County ids the file left
  // blank were resolved above, so a file map can only point at ids the file gave.
  const kept = new Set([...usedCountyIds, ...[...left.values()].flatMap((d) => d.counties.map((c) => c.id))]);
  const base = file.map ?? currentMap;
  if (base) {
    const cells = Object.fromEntries(Object.entries(base.cells).filter(([, v]) => kept.has(v)));
    plan.map = Object.keys(cells).length ? { ...base, cells } : null;
  }
  plan.mapChanged = JSON.stringify(plan.map) !== JSON.stringify(currentMap);
  return plan;
}
