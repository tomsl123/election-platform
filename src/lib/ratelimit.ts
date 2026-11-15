import { db } from "./db";

/** Counts one attempt against `key`. Returns ok=false once `limit` is exceeded within the window. */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = new Date();
  const bucket = await db.rateBucket.findUnique({ where: { key } });
  if (!bucket || bucket.resetAt <= now) {
    await db.rateBucket.upsert({
      where: { key },
      create: { key, count: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) },
      update: { count: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) },
    });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000) };
  }
  await db.rateBucket.update({ where: { key }, data: { count: { increment: 1 } } });
  return { ok: true, retryAfter: 0 };
}

export async function clearHits(key: string) {
  await db.rateBucket.deleteMany({ where: { key } });
}
