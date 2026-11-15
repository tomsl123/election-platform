// Per-organisation settings, kept as JSON columns on Organisation. Secrets are encrypted.
import { cache } from "react";
import type { Organisation } from "@prisma/client";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { DEFAULT_SMTP, getSettings, type SmtpConfig } from "./settings";
import { parseBrand, safeJson, type Brand } from "./types";

export type OrgDiscord = {
  enabled: boolean;
  webhookUrl: string; // encrypted at rest
  botName: string;
  roleId: string;
  clientId: string;
  clientSecret: string; // encrypted at rest
  guildId: string;
};
export type OrgUctv = { enabled: boolean; baseUrl: string; apiKey: string; autoSend: boolean };

const DISCORD_DEFAULTS: OrgDiscord = { enabled: false, webhookUrl: "", botName: "", roleId: "", clientId: "", clientSecret: "", guildId: "" };
const UCTV_DEFAULTS: OrgUctv = { enabled: false, baseUrl: "", apiKey: "", autoSend: false };

const SECRETS = { smtp: ["pass"], discord: ["webhookUrl", "clientSecret"], uctv: ["apiKey"] } as const;
type Group = keyof typeof SECRETS;

function read<T extends object>(json: string, defaults: T, secrets: readonly string[]): T {
  const raw = safeJson<Record<string, unknown>>(json, {});
  const out = { ...defaults } as Record<string, unknown>;
  for (const k of Object.keys(defaults)) {
    if (!(k in raw)) continue;
    out[k] = secrets.includes(k) ? (decrypt(String(raw[k] ?? "")) ?? "") : raw[k];
  }
  return out as T;
}

function write<T extends object>(values: T, secrets: readonly string[]): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) out[k] = secrets.includes(k) && v ? encrypt(String(v)) : v;
  return JSON.stringify(out);
}

export const orgSmtp = (o: Organisation): SmtpConfig => read(o.smtp, DEFAULT_SMTP, SECRETS.smtp);
export const orgDiscord = (o: Organisation): OrgDiscord => read(o.discord, DISCORD_DEFAULTS, SECRETS.discord);
export const orgUctv = (o: Organisation): OrgUctv => read(o.uctv, UCTV_DEFAULTS, SECRETS.uctv);
export const orgBrand = (o: Organisation): Brand => parseBrand(o.brand);

/** The mail settings an organisation actually sends with: its own, or the platform's. */
export async function mailFor(o: Organisation | null): Promise<SmtpConfig> {
  if (o) {
    const own = orgSmtp(o);
    if (own.enabled) return own;
  }
  return (await getSettings()).smtp;
}

/** Saves one settings group. Empty secret fields keep the stored value. */
export async function saveOrgGroup(orgId: string, group: Group, values: Record<string, unknown>) {
  const o = await db.organisation.findUniqueOrThrow({ where: { id: orgId } });
  const current = group === "smtp" ? orgSmtp(o) : group === "discord" ? orgDiscord(o) : orgUctv(o);
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    if ((SECRETS[group] as readonly string[]).includes(k) && v === "") continue;
    merged[k] = v;
  }
  await db.organisation.update({ where: { id: orgId }, data: { [group]: write(merged, SECRETS[group]) } });
}

export const getOrg = cache(async (slug: string) => db.organisation.findUnique({ where: { slug } }));
