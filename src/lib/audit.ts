// Append-only, hash-chained journal (copied from USFC Parliament, with the organisation added).
import { db, withWriteLock, type Tx } from "./db";
import { canonical, sha256 } from "./crypto";

export type AuditEntry = {
  orgId?: string | null;
  actorId?: string | null;
  actorLabel?: string;
  action: string;
  entity?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ip?: string;
};

const GENESIS = sha256("polling-station:journal:genesis");

type Row = { orgId: string | null; actorId: string | null; actorLabel: string; action: string; entity: string; entityId: string; details: string; ip: string };

function entryHash(prevHash: string, e: Row & { at: string }) {
  return sha256(
    canonical({
      prev: prevHash,
      at: e.at,
      orgId: e.orgId,
      actorId: e.actorId,
      actorLabel: e.actorLabel,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      details: e.details,
      ip: e.ip,
    }),
  );
}

/** Appends to the journal inside an existing transaction. The caller must hold the write lock. */
export async function auditTx(tx: Tx, e: AuditEntry) {
  const last = await tx.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS;
  const at = new Date();
  const row: Row = {
    orgId: e.orgId ?? null,
    actorId: e.actorId ?? null,
    actorLabel: e.actorLabel ?? "system",
    action: e.action,
    entity: e.entity ?? "",
    entityId: e.entityId ?? "",
    details: canonical(e.details ?? {}),
    ip: e.ip ?? "",
  };
  const hash = entryHash(prevHash, { ...row, at: at.toISOString() });
  await tx.auditLog.create({ data: { ...row, at, prevHash, hash } });
}

/** Appends one entry to the journal. */
export async function audit(e: AuditEntry) {
  await withWriteLock(() => db.$transaction((tx) => auditTx(tx, e)));
}

/** Walks the whole journal and reports the first broken link, if any. */
export async function verifyJournal(): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
  let prev = GENESIS;
  let entries = 0;
  let cursor = 0;
  for (;;) {
    const batch = await db.auditLog.findMany({ where: { seq: { gt: cursor } }, orderBy: { seq: "asc" }, take: 500 });
    if (batch.length === 0) break;
    for (const row of batch) {
      const expected = entryHash(prev, { ...row, at: row.at.toISOString() });
      if (row.prevHash !== prev || row.hash !== expected) return { ok: false, entries, brokenAt: row.seq };
      prev = row.hash;
      entries++;
      cursor = row.seq;
    }
  }
  return { ok: true, entries };
}
