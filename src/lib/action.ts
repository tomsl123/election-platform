// Small helpers shared by every server action (copied from USFC Parliament).
import { redirect } from "next/navigation";
import { withNotice } from "./format";
import { Problem } from "./problem";
import { requestMeta, type Auth } from "./auth";

export type Actor = { id: string | null; label: string; ip?: string };

export function go(path: string, kind?: "ok" | "err", message?: string): never {
  redirect(kind && message ? withNotice(path, kind, message) : path);
}

export function str(fd: FormData, key: string, max = 5000): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function flag(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function int(fd: FormData, key: string, fallback: number, min = -Infinity, max = Infinity): number {
  const n = Number.parseInt(str(fd, key), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Turns a thrown error into a sentence for the person at the desk. */
export function explain(err: unknown): string {
  if (err instanceof Problem) return err.message;
  if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
  console.error("[polling-station] unexpected error:", err);
  return "Something went wrong on our side and nothing was changed. Try again.";
}

export async function actorFrom(auth: Auth): Promise<Actor & { id: string }> {
  const meta = await requestMeta();
  return { id: auth.user.id, label: auth.user.displayName, ip: meta.ip };
}

/** Only same-site paths are accepted as return addresses. */
export function safePath(path: string, fallback: string): string {
  return /^\/(?!\/)[\w\-./?=&%#]*$/.test(path) ? path : fallback;
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
