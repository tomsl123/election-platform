// Wires every clock job into the scheduler and starts it. Imported once from instrumentation.ts.
import { db } from "./db";
import { registerJob, startScheduler } from "./scheduler";

const CLOCK = { id: null, label: "the clock" };

export function startClock() {
  registerJob({
    name: "open and close",
    run: async (now) => {
      const { openElection } = await import("./elections");
      const { closePolls } = await import("./ballot");
      const toOpen = await db.election.findMany({ where: { status: "READY", opensAt: { lte: now } } });
      for (const e of toOpen) {
        try {
          await openElection(e.id, CLOCK);
        } catch (err) {
          // An election that cannot open goes back to draft rather than retrying forever.
          await db.election.update({ where: { id: e.id }, data: { status: "DRAFT" } });
          console.error(`[polling-station] could not open ${e.id}:`, err);
        }
      }
      const toClose = await db.election.findMany({ where: { status: "OPEN", closesAt: { lte: now } } });
      for (const e of toClose) await closePolls(e.id, CLOCK);
    },
  });
  registerJob({
    name: "reminders",
    run: async (now) => {
      const { noticeClosingSoon, noticeHeldDigest } = await import("./notices");
      const { parseNotices } = await import("./types");
      const open = await db.election.findMany({ where: { status: "OPEN", reminderSentAt: null, closesAt: { gt: now } } });
      for (const e of open) {
        const n = parseNotices(e.notices);
        if (!n.closingSoon || !n.closingSoonMinutes || e.closesAt!.getTime() - now.getTime() > n.closingSoonMinutes * 60_000) continue;
        await db.election.update({ where: { id: e.id }, data: { reminderSentAt: now } });
        // Too close to the opening for a reminder to be useful.
        if (e.openedAt && now.getTime() - e.openedAt.getTime() < 5 * 60_000) continue;
        await noticeClosingSoon(e.id);
      }
      await noticeHeldDigest(now);
    },
  });
  registerJob({
    name: "privacy",
    run: async (now) => {
      // Thirty days after certification, the evidence gathered at the desk is wiped from the roll.
      const cutoff = new Date(now.getTime() - 30 * 86400_000);
      const old = await db.election.findMany({ where: { status: { in: ["CERTIFIED", "CANCELLED"] }, OR: [{ certifiedAt: { lte: cutoff } }, { certifiedAt: null, closedAt: { lte: cutoff } }] }, select: { id: true } });
      if (old.length)
        await db.rollEntry.updateMany({ where: { electionId: { in: old.map((e) => e.id) }, OR: [{ ipEnc: { not: "" } }, { deviceId: { not: "" } }, { deviceFp: { not: "" } }] }, data: { ipEnc: "", ipHash: "", deviceId: "", deviceFp: "", uaHash: "" } });
    },
  });
  registerJob({
    name: "ip lists",
    run: async () => {
      const { refreshIpLists } = await import("./ipintel");
      await refreshIpLists(false);
    },
  });
  startScheduler();
}
