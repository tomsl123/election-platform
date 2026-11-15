// Wires every clock job into the scheduler and starts it. Imported once from instrumentation.ts.
import { startScheduler } from "./scheduler";

export function startClock() {
  startScheduler();
}
