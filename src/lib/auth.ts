// Staff and voter accounts: sessions, sign-in with optional TOTP, and who may do what.
// Adapted from USFC Parliament's auth.ts (chamber offices replaced by organisation roles).
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Organisation, Prisma } from "@prisma/client";
import { db } from "./db";
import { decrypt, randomToken, sha256, verifyPassword, verifyTotp } from "./crypto";
import { getSettings } from "./settings";
import { clearHits, hit } from "./ratelimit";
import { audit } from "./audit";
import { ROLE_RANK, type OrgRole } from "./types";

export const SESSION_COOKIE = "ps_session";
export const SIGNIN_COOKIE = "ps_signin";
const SIGNIN_MINUTES = 5;

const userInclude = { memberships: { include: { org: true } } } satisfies Prisma.UserInclude;
export type AuthUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;
export type Auth = { user: AuthUser; sessionId: string };

export function secureCookies(): boolean {
  return process.env.TRUST_PROXY === "1" || (process.env.BASE_URL ?? "").startsWith("https://");
}

export async function requestMeta(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const forwarded = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let ip = (process.env.TRUST_PROXY === "1" ? forwarded[0] : forwarded[forwarded.length - 1]) ?? "";
  // Development only: lets the fraud checks be exercised with a chosen address.
  if (process.env.NODE_ENV !== "production") ip = h.get("x-ps-test-ip") || ip || "127.0.0.1";
  return { ip, userAgent: (h.get("user-agent") ?? "").slice(0, 200) };
}

export async function createSession(userId: string) {
  const settings = await getSettings();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + settings.security.sessionHours * 3600_000);
  const meta = await requestMeta();
  await db.session.create({ data: { id: sha256(token), userId, expiresAt, signedAt: new Date(), ip: meta.ip, userAgent: meta.userAgent } });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export const getAuth = cache(async (): Promise<Auth | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: sha256(token) }, include: { user: { include: userInclude } } });
  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  if (Date.now() - session.lastSeen.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeen: new Date() } }).catch(() => undefined);
  }
  return { user: session.user, sessionId: session.id };
});

export async function requireAuth(next = "/"): Promise<Auth> {
  const auth = await getAuth();
  if (!auth) redirect(`/login?next=${encodeURIComponent(next)}`);
  return auth;
}

export async function requirePlatformAdmin(): Promise<Auth> {
  const auth = await requireAuth("/platform");
  if (!auth.user.isPlatformAdmin) redirect("/?err=" + encodeURIComponent("That section is for the platform administrator."));
  return auth;
}

/** The role a user holds in an organisation. Platform admins act as owners everywhere. */
export function roleIn(user: AuthUser, orgId: string): OrgRole | null {
  if (user.isPlatformAdmin) return "OWNER";
  return (user.memberships.find((m) => m.orgId === orgId)?.role as OrgRole | undefined) ?? null;
}

export function atLeast(role: OrgRole | null, min: OrgRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

export type Office = { auth: Auth; org: Organisation; role: OrgRole };

/** Guards every page and action of the office. Observers may read; officers run elections; owners manage settings and staff. */
export async function requireOffice(orgSlug: string, min: OrgRole = "OBSERVER"): Promise<Office> {
  const auth = await requireAuth(`/office/${orgSlug}`);
  const org = await db.organisation.findUnique({ where: { slug: orgSlug } });
  if (!org) notFound();
  const role = roleIn(auth.user, org.id);
  if (!atLeast(role, min)) {
    if (role) redirect(`/office/${orgSlug}?err=` + encodeURIComponent("Your role does not allow that."));
    notFound();
  }
  return { auth, org, role: role! };
}

// ── Signing in ─────────────────────────────────────────────────────────────

export type LoginResult = { ok: true } | { ok: "code" } | { ok: false; error: string };

export async function attemptLogin(emailRaw: string, password: string, next: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const settings = await getSettings();
  const meta = await requestMeta();
  const gate = await hit(`login:${meta.ip}:${email}`, settings.security.loginAttempts, 15 * 60);
  if (!gate.ok) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(gate.retryAfter / 60)} minutes.` };
  const user = await db.user.findUnique({ where: { email } });
  const passwordOk = await verifyPassword(password, user?.passwordHash);
  if (!user || !passwordOk || user.status !== "ACTIVE") {
    await audit({ actorId: user?.id ?? null, actorLabel: email, action: "auth.login_failed", ip: meta.ip, details: { step: "password" } });
    return { ok: false, error: "The e-mail address or password is not right." };
  }
  await clearHits(`login:${meta.ip}:${email}`);
  if (user.totpEnabled) {
    const ticket = randomToken(32);
    await db.token.deleteMany({ where: { purpose: "SIGNIN", userId: user.id } });
    await db.token.create({
      data: { purpose: "SIGNIN", tokenHash: sha256(ticket), userId: user.id, payload: JSON.stringify({ next }), expiresAt: new Date(Date.now() + SIGNIN_MINUTES * 60_000) },
    });
    (await cookies()).set(SIGNIN_COOKIE, ticket, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/login", maxAge: SIGNIN_MINUTES * 60 });
    return { ok: "code" };
  }
  await finishLogin(user, meta.ip);
  return { ok: true };
}

export async function finishLogin(user: { id: string; displayName: string }, ip: string) {
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorId: user.id, actorLabel: user.displayName, action: "auth.login", ip });
}

export async function pendingSignIn() {
  const ticket = (await cookies()).get(SIGNIN_COOKIE)?.value ?? "";
  if (!/^[\w-]{20,100}$/.test(ticket)) return null;
  const row = await db.token.findUnique({ where: { tokenHash: sha256(ticket) }, include: { user: true } });
  if (!row || row.purpose !== "SIGNIN" || row.usedAt || row.expiresAt <= new Date() || !row.user || row.user.status !== "ACTIVE") return null;
  let next = "/";
  try {
    next = String(JSON.parse(row.payload).next || "/");
  } catch {
    /* default */
  }
  return { row, user: row.user, next };
}

export async function completeLoginCode(code: string): Promise<{ ok: true; next: string } | { ok: false; error: string; restart?: boolean }> {
  const pending = await pendingSignIn();
  const jar = await cookies();
  if (!pending) {
    jar.delete({ name: SIGNIN_COOKIE, path: "/login" });
    return { ok: false, restart: true, error: "That sign-in has lapsed. Enter your e-mail and password again." };
  }
  const { row, user } = pending;
  const settings = await getSettings();
  const meta = await requestMeta();
  const gate = await hit(`login2:${user.id}`, settings.security.loginAttempts, 15 * 60);
  if (!gate.ok) {
    await db.token.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    jar.delete({ name: SIGNIN_COOKIE, path: "/login" });
    return { ok: false, restart: true, error: `Too many wrong codes. Try again in ${Math.ceil(gate.retryAfter / 60)} minutes.` };
  }
  const secret = decrypt(user.totpSecretEnc);
  if (!secret || !verifyTotp(secret, code)) {
    await audit({ actorId: user.id, actorLabel: user.displayName, action: "auth.login_failed", ip: meta.ip, details: { step: "code" } });
    return { ok: false, error: "That code is not right." };
  }
  const claimed = await db.token.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  jar.delete({ name: SIGNIN_COOKIE, path: "/login" });
  if (claimed.count !== 1) return { ok: false, restart: true, error: "That sign-in has already been used. Start again." };
  await clearHits(`login2:${user.id}`);
  await finishLogin(user, meta.ip);
  return { ok: true, next: pending.next };
}

export async function abandonSignIn() {
  const pending = await pendingSignIn();
  if (pending) await db.token.update({ where: { id: pending.row.id }, data: { usedAt: new Date() } });
  (await cookies()).delete({ name: SIGNIN_COOKIE, path: "/login" });
}
