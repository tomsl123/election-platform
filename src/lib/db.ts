import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __psDb?: PrismaClient; __psLock?: Promise<unknown> };

export const db: PrismaClient = g.__psDb ?? new PrismaClient();
if (!g.__psDb) g.__psDb = db;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Serialises every operation that appends to a hash chain (ballots, audit log).
 * The app is a single process on a single SQLite file, so an in-process queue is
 * enough; unique constraints on the chain links back it up.
 */
export async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__psLock ?? Promise.resolve();
  let release!: () => void;
  g.__psLock = new Promise<void>((r) => (release = r));
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
  }
}
