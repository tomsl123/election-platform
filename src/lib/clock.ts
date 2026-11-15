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
    name: "ip lists",
    run: async () => {
      const { refreshIpLists } = await import("./ipintel");
      await refreshIpLists(false);
    },
  });
  startScheduler();
}
