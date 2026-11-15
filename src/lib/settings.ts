// Platform-wide settings, stored as one row per key in the Setting table. Secrets are encrypted.
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";

export type SmtpConfig = {
  enabled: boolean;
  transport: "smtp" | "file"; // "file" writes messages to data/mailbox for development
  host: string;
  port: number;
  secure: boolean; // implicit TLS (465); otherwise STARTTLS is required
  user: string;
  pass: string; // encrypted at rest
  fromName: string;
  fromAddress: string;
};

export type Settings = {
  site: { name: string; baseUrl: string };
  smtp: SmtpConfig; // platform mail: account e-mail, and any organisation without its own
  security: { sessionHours: number; loginAttempts: number; inviteDays: number };
  iplists: {
    torUrl: string;
    vpnUrl: string;
    datacenterUrl: string;
    provider: "none" | "proxycheck" | "ipqs";
    apiKey: string; // encrypted at rest
    lastRefresh: string;
    lastError: string;
  };
  sso: { enabled: boolean; parliamentUrl: string; clientId: string; secret: string; label: string };
};

export const DEFAULT_SMTP: SmtpConfig = {
  enabled: false,
  transport: "smtp",
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  fromName: "Polling Station",
  fromAddress: "",
};

const DEFAULTS: Settings = {
  site: { name: "Polling Station", baseUrl: process.env.BASE_URL || "http://localhost:3220" },
  smtp: DEFAULT_SMTP,
  security: { sessionHours: 72, loginAttempts: 8, inviteDays: 7 },
  iplists: {
    torUrl: "https://check.torproject.org/torbulkexitlist",
    vpnUrl: "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt",
    datacenterUrl: "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt",
    provider: "none",
    apiKey: "",
    lastRefresh: "",
    lastError: "",
  },
  sso: { enabled: false, parliamentUrl: "", clientId: "polling-station", secret: "", label: "USFC Parliament" },
};

const SECRET_KEYS = new Set(["smtp.pass", "iplists.apiKey", "sso.secret"]);

const g = globalThis as unknown as { __psSettings?: { at: number; value: Settings } };

export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && g.__psSettings && Date.now() - g.__psSettings.at < 5000) return g.__psSettings.value;
  const rows = await db.setting.findMany();
  const out = structuredClone(DEFAULTS) as unknown as Record<string, Record<string, unknown>>;
  for (const row of rows) {
    const [group, key] = row.key.split(".");
    if (!out[group] || !(key in out[group])) continue;
    try {
      const raw = SECRET_KEYS.has(row.key) ? (decrypt(row.value) ?? '""') : row.value;
      out[group][key] = JSON.parse(raw);
    } catch {
      /* keep the default */
    }
  }
  const value = out as unknown as Settings;
  g.__psSettings = { at: Date.now(), value };
  return value;
}

export async function saveSettings<G extends keyof Settings>(group: G, values: Partial<Settings[G]>) {
  for (const [key, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const full = `${group}.${key}`;
    const json = JSON.stringify(v);
    const value = SECRET_KEYS.has(full) ? encrypt(json) : json;
    await db.setting.upsert({ where: { key: full }, create: { key: full, value }, update: { value } });
  }
  g.__psSettings = undefined;
}

export function absoluteUrl(settings: Settings, path: string): string {
  return settings.site.baseUrl.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
}
