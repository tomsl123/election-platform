// Outgoing webhooks: signed JSON posts to addresses an organisation registered.
import { createHmac } from "node:crypto";
import { db } from "./db";
import { decrypt } from "./crypto";
import { kickOutbox } from "./notify";

export const WEBHOOK_EVENTS = ["election.opened", "election.closed", "election.counted", "election.certified", "envelope.held"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Queues an event for every active webhook of the organisation that subscribed to it. */
export async function emitWebhook(orgId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = await db.webhook.findMany({ where: { orgId, active: true } });
  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  let queued = 0;
  for (const h of hooks) {
    let events: string[] = [];
    try {
      events = JSON.parse(h.events);
    } catch {
      /* none */
    }
    if (events.length && !events.includes(event)) continue;
    await db.outbox.create({ data: { orgId, channel: "WEBHOOK", kind: event, recipient: h.id, subject: event, payload: body } });
    queued++;
  }
  if (queued) kickOutbox();
}

export function signBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Only public http(s) addresses; never loopback or private ranges in production. */
export function webhookUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "That is not a web address.";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Use an http or https address.";
  if (process.env.NODE_ENV === "production") {
    const h = u.hostname;
    if (u.protocol !== "https:") return "Use an https address.";
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return "Private addresses are not allowed.";
  }
  return null;
}

export async function deliverWebhook(webhookId: string, event: string, body: string) {
  const hook = await db.webhook.findUnique({ where: { id: webhookId } });
  if (!hook || !hook.active) throw new Error("The webhook was removed or switched off.");
  const problem = webhookUrlProblem(hook.url);
  if (problem) throw new Error(problem);
  const secret = decrypt(hook.secretEnc) ?? "";
  const res = await fetch(hook.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ps-event": event, "x-ps-signature": signBody(secret, body) },
    body,
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`The receiver answered ${res.status}.`);
}
