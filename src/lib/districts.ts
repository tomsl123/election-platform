// District sets over time: the frozen snapshot an election runs on, the lock that keeps a set still while an
// election uses it, and applying an imported district file.
import type { Organisation } from "@prisma/client";
import { audit } from "./audit";
import { canonical, sha256 } from "./crypto";
import { Problem } from "./problem";
import { planDistrictImport, readCounties, readMap, type County, type DistrictFile, type DistrictPlan, type HexMap, type Parsed } from "./district-file";
import type { Actor } from "./action";
import { db, withWriteLock, type Tx } from "./db";

type AnyTx = Tx | typeof db;

export type SnapshotDistrict = { id: string; code: string; name: string; seats: number; position: number; ref: string; counties: County[] };
export type DistrictSnapshot = { setId: string; name: string; districts: SnapshotDistrict[]; map: HexMap | null; hash: string };
export type DistrictSource = { kind?: "file" | "uctv"; label?: string; hash?: string; at?: string };

/** Statuses in which an election holds its district set still. */
export const LOCKING = ["NOMINATIONS", "READY", "OPEN", "CLOSED"] as const;

export function readSnapshot(json: string | null | undefined): DistrictSnapshot | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as DistrictSnapshot;
    return Array.isArray(s?.districts) ? s : null;
  } catch {
    return null;
  }
}

export function readSource(json: string | null | undefined): DistrictSource {
  try {
    return JSON.parse(json || "{}") as DistrictSource;
  } catch {
    return {};
  }
}

async function snapshotOf(tx: AnyTx, setId: string): Promise<DistrictSnapshot | null> {
  const set = await tx.districtSet.findUnique({ where: { id: setId }, include: { districts: { orderBy: { position: "asc" } } } });
  if (!set) return null;
  const body = {
    setId: set.id,
    name: set.name,
    districts: set.districts.map((d) => ({ id: d.id, code: d.code, name: d.name, seats: d.seats, position: d.position, ref: d.ref, counties: readCounties(d.counties) })),
    map: readMap(set.map),
  };
  return { ...body, hash: sha256(canonical(body)) };
}

/** Writes the snapshot of the election's district set (or clears it when the election has none). */
export async function freezeDistricts(electionId: string, tx: AnyTx = db) {
  const e = await tx.election.findUniqueOrThrow({ where: { id: electionId }, select: { districtSetId: true } });
  const snap = e.districtSetId ? await snapshotOf(tx, e.districtSetId) : null;
  await tx.election.update({ where: { id: electionId }, data: { districts: snap ? JSON.stringify(snap) : null } });
}

export async function thawDistricts(electionId: string, tx: AnyTx = db) {
  await tx.election.update({ where: { id: electionId }, data: { districts: null } });
}

/** The districts an election is counted with: its snapshot, or the live set for elections from before snapshots. */
export async function districtsFor(tx: AnyTx, e: { districts: string | null; districtSetId: string | null }): Promise<Array<{ id: string; name: string; code: string }>> {
  const snap = readSnapshot(e.districts);
  if (snap) return snap.districts;
  return e.districtSetId ? tx.district.findMany({ where: { setId: e.districtSetId }, orderBy: { position: "asc" } }) : [];
}

/** An election's districts with counties and map: from its snapshot, or the live set's. */
export async function geographyFor(e: { districts: string | null; districtSetId: string | null }): Promise<{ map: HexMap | null; districts: SnapshotDistrict[] } | null> {
  let snap = readSnapshot(e.districts);
  if (!snap && e.districtSetId) snap = await snapshotOf(db, e.districtSetId);
  return snap ? { map: snap.map, districts: snap.districts } : null;
}

/** The map an election shows, when its districts have one. */
export async function mapFor(e: { districts: string | null; districtSetId: string | null }): Promise<{ map: HexMap; districts: SnapshotDistrict[] } | null> {
  const g = await geographyFor(e);
  return g?.map ? { map: g.map, districts: g.districts } : null;
}

/** Titles of the elections that hold this set still. Older running elections without a snapshot get one now. */
export async function lockedBy(setId: string): Promise<string[]> {
  const using = await db.election.findMany({ where: { districtSetId: setId, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { id: true, title: true, status: true, districts: true } });
  for (const e of using) if (!e.districts) await freezeDistricts(e.id);
  return using.filter((e) => (LOCKING as readonly string[]).includes(e.status)).map((e) => e.title);
}

export async function assertUnlocked(setId: string) {
  const by = await lockedBy(setId);
  if (by.length) throw new Problem(`${by.slice(0, 3).join(", ")}${by.length > 3 ? ` and ${by.length - 3} more` : ""} ${by.length === 1 ? "uses" : "use"} this set; it cannot change until ${by.length === 1 ? "that election is" : "they are"} counted or back in draft.`);
}

/** Districts that papers, voters or the register refer to: these are never removed by an import. */
async function usedDistricts(setId: string): Promise<Set<string>> {
  const ids = (await db.district.findMany({ where: { setId }, select: { id: true } })).map((d) => d.id);
  const [o, r, v, a] = await Promise.all([
    db.option.findMany({ where: { districtId: { in: ids } }, select: { districtId: true }, distinct: ["districtId"] }),
    db.registerDistrict.findMany({ where: { districtId: { in: ids } }, select: { districtId: true }, distinct: ["districtId"] }),
    db.rollEntry.findMany({ where: { districtId: { in: ids } }, select: { districtId: true }, distinct: ["districtId"] }),
    db.accessCode.findMany({ where: { districtId: { in: ids } }, select: { districtId: true }, distinct: ["districtId"] }),
  ]);
  return new Set([...o, ...r, ...v, ...a].map((x) => x.districtId!).filter(Boolean));
}

// ── Import: stage, preview, apply ───────────────────────────────────────────

export type StagedImport = { parsed: Parsed; label: string; kind: "file" | "uctv" };

export async function stageImport(org: Organisation, setId: string | null, staged: StagedImport, actor: Actor): Promise<string> {
  if (setId && !(await db.districtSet.findFirst({ where: { id: setId, orgId: org.id } }))) throw new Problem("That set does not exist.");
  await db.districtImport.deleteMany({ where: { orgId: org.id, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  const row = await db.districtImport.create({ data: { orgId: org.id, setId, payload: JSON.stringify(staged), createdBy: actor.label } });
  return row.id;
}

export async function loadImport(org: Organisation, id: string) {
  const row = await db.districtImport.findFirst({ where: { id, orgId: org.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (!row) return null;
  const staged = JSON.parse(row.payload) as StagedImport;
  const set = row.setId ? await db.districtSet.findUnique({ where: { id: row.setId }, include: { districts: { orderBy: { position: "asc" } } } }) : null;
  const used = set ? await usedDistricts(set.id) : new Set<string>();
  const current = (set?.districts ?? []).map((d) => ({ id: d.id, code: d.code, name: d.name, seats: d.seats, ref: d.ref, counties: readCounties(d.counties), used: used.has(d.id) }));
  const plan = planDistrictImport(current, readMap(set?.map), staged.parsed.file);
  const locked = set ? await lockedBy(set.id) : [];
  return { row, staged, set, plan, locked };
}

export async function applyImport(org: Organisation, id: string, removeMissing: boolean, actor: Actor & { id: string | null }): Promise<{ setId: string; message: string }> {
  const loaded = await loadImport(org, id);
  if (!loaded) throw new Problem("That import has expired; upload the file again.");
  const { row, staged, set, plan } = loaded;
  if (set) await assertUnlocked(set.id);
  const file: DistrictFile = staged.parsed.file;
  const setName = (file.name || staged.label || "Districts").slice(0, 80);
  const removed = removeMissing ? plan.missing.filter((m) => !m.used) : [];
  const setId = await withWriteLock(() => db.$transaction(async (tx) => {
    const target = set ?? (await tx.districtSet.create({ data: { orgId: org.id, name: setName } }));
    let position = set ? set.districts.length : 0;
    for (const c of plan.change) await tx.district.update({ where: { id: c.id }, data: { name: c.to.name, seats: c.to.seats, ref: c.to.ref, counties: JSON.stringify(c.to.counties) } });
    for (const a of plan.add) await tx.district.create({ data: { setId: target.id, code: a.code, name: a.name, seats: a.seats, ref: a.ref, counties: JSON.stringify(a.counties), position: position++ } });
    if (removed.length) await tx.district.deleteMany({ where: { id: { in: removed.map((r) => r.id) }, setId: target.id } });
    // Cells of removed districts' counties go with them.
    const gone = new Set(removed.flatMap((r) => set?.districts.find((d) => d.id === r.id)?.counties).flatMap((c) => (c ? readCounties(c).map((k) => k.id) : [])));
    const map = plan.map ? { ...plan.map, cells: Object.fromEntries(Object.entries(plan.map.cells).filter(([, v]) => !gone.has(v))) } : null;
    const source: DistrictSource = { kind: staged.kind, label: staged.label, hash: sha256(canonical(file)), at: new Date().toISOString() };
    await tx.districtSet.update({ where: { id: target.id }, data: { map: map && Object.keys(map.cells).length ? JSON.stringify(map) : "", source: JSON.stringify(source) } });
    await tx.districtImport.delete({ where: { id: row.id } });
    return target.id;
  }));
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "district.import", entity: "DistrictSet", entityId: setId, ip: actor.ip, details: { source: staged.label, added: plan.add.length, changed: plan.change.length, removed: removed.length, map: plan.mapChanged } });
  const parts = [`${plan.add.length} added`, `${plan.change.length} changed`];
  if (removed.length) parts.push(`${removed.length} removed`);
  if (plan.mapChanged) parts.push("map updated");
  return { setId, message: `Imported: ${parts.join(", ")}.` };
}

export type { DistrictPlan };
