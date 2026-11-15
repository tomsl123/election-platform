// The returning officer's clock: opens and closes elections on time, sends reminders,
// refreshes the IP lists, retries mail, and tidies up. Modelled on USFC Parliament's scheduler.
import { db } from "./db";
import { processOutbox } from "./notify";

type Job = { name: string; run: (now: Date) => Promise<void> };

const g = globalThis as unknown as {
  __psTimer?: ReturnType<typeof setInterval>;
  __psTicking?: boolean;
  __psLastTick?: { at: Date; error: string | null };
  __psJobs?: Job[];
};

/** Other modules add their clock work here (kept as a registry to avoid import cycles). */
export function registerJob(job: Job) {
  g.__psJobs ??= [];
  if (!g.__psJobs.some((j) => j.name === job.name)) g.__psJobs.push(job);
}

export function schedulerStatus() {
  return g.__psLastTick ?? null;
}

export function startScheduler() {
  if (g.__psTimer) return;
  g.__psTimer = setInterval(() => void tick(), 15_000);
  g.__psTimer.unref?.();
  void tick();
}

export async function tick() {
  if (g.__psTicking) return;
  g.__psTicking = true;
  const errors: string[] = [];
  const now = new Date();
  try {
    for (const job of g.__psJobs ?? []) {
      try {
        await job.run(now);
      } catch (err) {
        errors.push(`${job.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      await processOutbox();
    } catch (err) {
      errors.push(`outbox: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
      await db.token.deleteMany({ where: { expiresAt: { lte: new Date(now.getTime() - 7 * 24 * 3600_000) } } });
      await db.rateBucket.deleteMany({ where: { resetAt: { lte: now } } });
      await db.boothPass.deleteMany({ where: { expiresAt: { lte: new Date(now.getTime() - 24 * 3600_000) } } });
    } catch (err) {
      errors.push(`cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    g.__psLastTick = { at: new Date(), error: errors.length ? errors.join(" | ") : null };
    g.__psTicking = false;
  }
}
