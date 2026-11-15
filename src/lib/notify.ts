// E-mail, Discord and webhook delivery through the Outbox table, so failures are retried.
// Adapted from USFC Parliament's notify.ts: mail and Discord settings belong to each organisation.
import type { Organisation } from "@prisma/client";
import { db } from "./db";
import { absoluteUrl, getSettings } from "./settings";
import { deliverMail, renderEmail, type EmailContent } from "./mailer";
import { DISCORD_COLORS, postDiscord, type DiscordMessage } from "./discord";
import { mailFor, orgDiscord } from "./org";
import { deliverWebhook } from "./webhooks";

/** Queues one e-mail. Returns false when no mail transport is switched on. */
export async function queueMail(org: Organisation | null, to: string, kind: string, subject: string, content: Omit<EmailContent, "footer"> & { footer?: string }) {
  const smtp = await mailFor(org);
  if (!smtp.enabled) return false;
  const settings = await getSettings();
  const footer = content.footer ?? `${org ? org.name + " · " : ""}${settings.site.name}. You receive this because of an election you take part in or run.`;
  const { text, html } = renderEmail({ ...content, footer });
  await db.outbox.create({ data: { orgId: org?.id ?? null, channel: "EMAIL", kind, recipient: to, subject, payload: JSON.stringify({ text, html }) } });
  kickOutbox();
  return true;
}

export type DiscordNotice = {
  kind: string;
  title: string;
  body: string;
  link: string;
  color?: keyof typeof DISCORD_COLORS;
  mentionRole?: boolean;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

/** Queues one Discord post for an organisation. Never pass one-time links here. */
export async function queueDiscord(org: Organisation, n: DiscordNotice) {
  const d = orgDiscord(org);
  if (!d.enabled || !d.webhookUrl) return false;
  const settings = await getSettings();
  const mentionRole = !!n.mentionRole && /^\d+$/.test(d.roleId);
  const message: DiscordMessage = {
    username: d.botName || org.shortName || undefined,
    content: mentionRole ? `<@&${d.roleId}>` : undefined,
    embeds: [
      {
        title: n.title.slice(0, 250),
        description: n.body.slice(0, 1800),
        url: absoluteUrl(settings, n.link),
        color: DISCORD_COLORS[n.color ?? "brass"],
        fields: n.fields?.slice(0, 10),
        footer: { text: org.name },
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: { parse: [], roles: mentionRole ? [d.roleId] : [], users: [] },
  };
  await db.outbox.create({ data: { orgId: org.id, channel: "DISCORD", kind: n.kind, recipient: "discord", subject: n.title, payload: JSON.stringify(message) } });
  kickOutbox();
  return true;
}

/** Starts delivery in the background; a failure here must never surface as an unhandled rejection. */
export function kickOutbox() {
  processOutbox().catch((err) => console.error("[polling-station] outbox:", err));
}

const BACKOFF_MINUTES = [1, 5, 15, 60];
const g = globalThis as unknown as { __psOutboxBusy?: boolean };

/** Waits until everything due has been tried. Used by scripts and tests before they exit. */
export async function flushOutbox() {
  for (let i = 0; i < 200; i++) {
    if (g.__psOutboxBusy) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    const due = await db.outbox.count({ where: { status: "PENDING", nextTryAt: { lte: new Date() } } });
    if (due === 0) return;
    await processOutbox();
  }
}

export async function processOutbox(): Promise<void> {
  if (g.__psOutboxBusy) return;
  g.__psOutboxBusy = true;
  try {
    const due = await db.outbox.findMany({ where: { status: "PENDING", nextTryAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 40 });
    const orgs = new Map<string, Organisation | null>();
    const orgOf = async (id: string | null) => {
      if (!id) return null;
      if (!orgs.has(id)) orgs.set(id, await db.organisation.findUnique({ where: { id } }));
      return orgs.get(id) ?? null;
    };
    for (const row of due) {
      try {
        const org = await orgOf(row.orgId);
        if (row.channel === "EMAIL") {
          const payload = JSON.parse(row.payload);
          await deliverMail(await mailFor(org), { to: row.recipient, subject: row.subject, text: payload.text, html: payload.html });
        } else if (row.channel === "DISCORD") {
          if (!org) throw new Error("The organisation no longer exists.");
          const d = orgDiscord(org);
          if (!d.enabled || !d.webhookUrl) throw new Error("Discord delivery is switched off for this organisation.");
          await postDiscord(d.webhookUrl, JSON.parse(row.payload));
        } else if (row.channel === "WEBHOOK") {
          await deliverWebhook(row.recipient, row.kind, row.payload);
        }
        // The body may hold a one-time link or code; it is not kept once delivered.
        await db.outbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), payload: "{}", lastError: "" } });
      } catch (err) {
        const attempts = row.attempts + 1;
        const giveUp = attempts > BACKOFF_MINUTES.length;
        await db.outbox.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: String(err instanceof Error ? err.message : err).slice(0, 400),
            status: giveUp ? "FAILED" : "PENDING",
            payload: giveUp ? "{}" : row.payload,
            nextTryAt: new Date(Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 60) * 60_000),
          },
        });
      }
    }
  } finally {
    g.__psOutboxBusy = false;
  }
}
