import { db } from "@/lib/db";
import { subscribe } from "@/lib/live";

export const dynamic = "force-dynamic";

// Server-sent events: one empty "changed" message whenever the election changes. Carries no data,
// so it needs no authorisation; pages refetch what they are allowed to see.
export async function GET(req: Request, { params }: { params: Promise<{ election: string }> }) {
  const { election } = await params;
  const e = await db.election.findUnique({ where: { id: election }, select: { id: true } });
  if (!e) return new Response("Not found", { status: 404 });
  const enc = new TextEncoder();
  let off = () => {};
  let beat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          /* closed */
        }
      };
      send("retry: 5000\n\n");
      off = subscribe(e.id, () => send("data: changed\n\n"));
      beat = setInterval(() => send(": ping\n\n"), 15_000);
      req.signal.addEventListener("abort", () => {
        off();
        if (beat) clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
    cancel() {
      off();
      if (beat) clearInterval(beat);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
