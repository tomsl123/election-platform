// Which result a viewer may see, and when: the sealed count, a live tally, or nothing yet.
import type { Election } from "@prisma/client";
import { liveResult } from "./ballot";
import type { Result } from "./count";

const g = globalThis as unknown as { __psLive?: Map<string, { at: number; result: Result | null }> };

export async function visibleResult(e: Election): Promise<{ kind: "sealed" | "live" | "final"; result: Result | null }> {
  if (["COUNTED", "CERTIFIED"].includes(e.status) && e.result) return { kind: "final", result: JSON.parse(e.result) as Result };
  if (e.status === "OPEN" && e.resultsMode === "LIVE") {
    g.__psLive ??= new Map();
    const hit = g.__psLive.get(e.id);
    if (hit && Date.now() - hit.at < 5000) return { kind: "live", result: hit.result };
    const result = await liveResult(e.id);
    g.__psLive.set(e.id, { at: Date.now(), result });
    return { kind: "live", result };
  }
  return { kind: "sealed", result: null };
}
