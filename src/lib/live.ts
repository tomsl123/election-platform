import { EventEmitter } from "node:events";

// In-process bus that tells open browser tabs an election changed (turnout, status, results).
const g = globalThis as unknown as { __psBus?: EventEmitter };
const bus = (g.__psBus ??= new EventEmitter());
bus.setMaxListeners(0);

export function bump(electionId: string) {
  bus.emit(`election:${electionId}`);
}

export function subscribe(electionId: string, listener: () => void): () => void {
  const name = `election:${electionId}`;
  bus.on(name, listener);
  return () => bus.off(name, listener);
}
