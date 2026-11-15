// E-mail addresses as identities: normalising, folding aliases so one inbox is one voter,
// and spotting throwaway domains. The disposable list comes from the disposable-email-domains
// project (src/data/disposable-domains.txt) and is committed with the code.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveMx } from "node:dns/promises";
import { hmac } from "./crypto";

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

const DOTLESS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The inbox an address really reaches: "+tags" are dropped for every domain, and dots for Gmail
 * (googlemail.com is folded into gmail.com). Two addresses with the same key are one voter.
 */
export function emailKey(raw: string): string {
  const e = normaliseEmail(raw);
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (DOTLESS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/** What is stored in the database instead of the address itself. */
export function emailKeyHash(raw: string): string {
  return hmac("email", emailKey(raw));
}

export function maskEmail(raw: string): string {
  const e = normaliseEmail(raw);
  const at = e.lastIndexOf("@");
  if (at < 1) return "***";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const keep = local.length <= 2 ? local[0] : `${local[0]}${"*".repeat(Math.min(6, local.length - 2))}${local[local.length - 1]}`;
  return `${keep}@${domain}`;
}

let disposable: Set<string> | null = null;
function disposableSet(): Set<string> {
  if (disposable) return disposable;
  try {
    const text = readFileSync(resolve(/*turbopackIgnore: true*/ process.cwd(), "src/data/disposable-domains.txt"), "utf8");
    disposable = new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));
  } catch {
    disposable = new Set();
  }
  return disposable;
}

/** True when the domain, or any parent domain of it, is a known throwaway provider. */
export function isDisposable(raw: string): boolean {
  const domain = normaliseEmail(raw).split("@")[1] ?? "";
  const set = disposableSet();
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (set.has(parts.slice(i).join("."))) return true;
  return false;
}

/** Whether the domain can receive mail (MX records, or an address record as the fallback). Unknown → true. */
export async function hasMx(raw: string): Promise<boolean> {
  const domain = normaliseEmail(raw).split("@")[1] ?? "";
  if (!domain || domain.endsWith(".test") || domain === "localhost") return true;
  try {
    const mx = await Promise.race([resolveMx(domain), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
    return mx.length > 0;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Only a definite "no such domain / no data" counts against the voter.
    return !(code === "ENOTFOUND" || code === "ENODATA");
  }
}
