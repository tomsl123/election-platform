"use server";
import { requireOffice } from "@/lib/auth";
import { actorFrom, explain, go, oneOf, str } from "@/lib/action";
import { decideByReason, decideEnvelope } from "@/lib/envelopes";
import { SIGNALS } from "@/lib/types";

export async function envelopeAction(fd: FormData) {
  const slug = str(fd, "org");
  const id = str(fd, "id");
  const { org, auth } = await requireOffice(slug, "OFFICER");
  const actor = await actorFrom(auth);
  const back = `/office/${slug}/elections/${id}/held`;
  const op = str(fd, "op");
  let msg = "Decided.";
  try {
    if (op === "accept" || op === "reject") await decideEnvelope(org, str(fd, "envelope"), actor, op === "accept", str(fd, "note", 300));
    else if (op === "acceptAll" || op === "rejectAll") {
      const n = await decideByReason(org, id, oneOf(str(fd, "reason"), [...SIGNALS, "ANY"] as const, "ANY"), actor, op === "acceptAll");
      msg = `${n} envelopes ${op === "acceptAll" ? "counted" : "set aside"}.`;
    }
  } catch (err) {
    go(back, "err", explain(err));
  }
  go(back, "ok", msg);
}
