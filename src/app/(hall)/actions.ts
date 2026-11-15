"use server";
// Signing in and out, first-run setup, invitations and password resets.
// Adapted from USFC Parliament's (hall)/actions.ts.
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { abandonSignIn, attemptLogin, completeLoginCode, createSession, destroySession, getAuth, requestMeta } from "@/lib/auth";
import { hashPassword, passwordProblem, safeEqual } from "@/lib/crypto";
import { go, safePath, slugify, str } from "@/lib/action";
import { hit } from "@/lib/ratelimit";
import { absoluteUrl, getSettings } from "@/lib/settings";
import { mailFor } from "@/lib/org";
import { queueMail } from "@/lib/notify";
import { createToken, findToken } from "@/lib/tokens";
import type { InvitePayload } from "@/lib/staff";

export async function loginAction(fd: FormData) {
  const next = safePath(str(fd, "next"), "/");
  const result = await attemptLogin(str(fd, "email", 200), str(fd, "password", 300), next);
  if (result.ok === "code") go("/login/code");
  if (!result.ok) go(`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`, "err", result.error);
  go(next === "/" ? await homeFor() : next);
}

/** Where a person lands after signing in: their only office, the platform, or the landing page. */
async function homeFor(): Promise<string> {
  const auth = await getAuth();
  if (!auth) return "/";
  if (auth.user.memberships.length === 1) return `/office/${auth.user.memberships[0].org.slug}/elections`;
  if (auth.user.isPlatformAdmin) return "/platform";
  return "/";
}

export async function loginCodeAction(fd: FormData) {
  const result = await completeLoginCode(str(fd, "code", 12));
  if (!result.ok) go(result.restart ? "/login" : "/login/code", "err", result.error);
  go(result.next === "/" ? await homeFor() : safePath(result.next, "/"));
}

export async function abandonSignInAction() {
  await abandonSignIn();
  go("/login");
}

export async function logoutAction() {
  const auth = await getAuth();
  if (auth) await audit({ actorId: auth.user.id, actorLabel: auth.user.displayName, action: "auth.logout" });
  await destroySession();
  go("/login", "ok", "You are signed out.");
}

export async function setupAction(fd: FormData) {
  const meta = await requestMeta();
  if ((await db.user.count()) > 0) go("/login", "err", "Setup has already been completed.");
  const gate = await hit(`setup:${meta.ip}`, 6, 15 * 60);
  if (!gate.ok) go("/setup", "err", "Too many attempts. Wait a few minutes.");
  const expected = process.env.SETUP_TOKEN ?? "";
  if (expected.length < 12 || expected.startsWith("change-me") || !safeEqual(str(fd, "token", 200), expected)) {
    go("/setup", "err", "That setup token is not right. It is the SETUP_TOKEN value in the server's .env file.");
  }
  const email = str(fd, "email", 200).toLowerCase();
  const displayName = str(fd, "displayName", 80);
  const password = str(fd, "password", 300);
  const orgName = str(fd, "orgName", 120);
  const shortName = str(fd, "shortName", 16) || orgName.slice(0, 16);
  const slug = slugify(str(fd, "slug", 48) || shortName);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) go("/setup", "err", "Enter a valid e-mail address.");
  if (displayName.length < 2) go("/setup", "err", "Enter your name.");
  const weak = passwordProblem(password);
  if (weak) go("/setup", "err", weak);
  if (orgName.length < 2 || !slug) go("/setup", "err", "Name the first organisation.");

  const user = await db.user.create({ data: { email, displayName, passwordHash: await hashPassword(password), isPlatformAdmin: true } });
  const org = await db.organisation.create({ data: { name: orgName, shortName, slug, members: { create: { userId: user.id, role: "OWNER" } } } });
  await audit({ actorId: user.id, actorLabel: displayName, action: "system.setup", entity: "Organisation", entityId: org.id, orgId: org.id, ip: meta.ip });
  await createSession(user.id);
  go(`/office/${org.slug}/elections`, "ok", "The polling station is open. You are its platform administrator.");
}

export async function acceptInviteAction(fd: FormData) {
  const token = str(fd, "token", 120);
  const back = `/invite/${token}`;
  const row = await findToken("INVITE", token);
  if (!row || !row.email) go("/login", "err", "That invitation has been used or has lapsed. Ask for a new one.");
  const payload = JSON.parse(row.payload) as InvitePayload;
  const displayName = str(fd, "displayName", 80) || payload.displayName;
  const password = str(fd, "password", 300);
  const weak = passwordProblem(password);
  if (weak) go(back, "err", weak);
  if (password !== str(fd, "confirm", 300)) go(back, "err", "The two passwords are not the same.");
  if (displayName.length < 2) go(back, "err", "Enter your name.");
  if (await db.user.findUnique({ where: { email: row.email } })) go("/login", "err", "An account with that address already exists. Sign in.");
  const claimed = await db.token.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) go("/login", "err", "That invitation has just been used.");
  const meta = await requestMeta();
  const user = await db.user.create({
    data: { email: row.email, displayName, passwordHash: await hashPassword(password), memberships: { create: { orgId: payload.orgId, role: payload.role } } },
  });
  await audit({ orgId: payload.orgId, actorId: user.id, actorLabel: displayName, action: "staff.joined", entity: "User", entityId: user.id, ip: meta.ip, details: { role: payload.role } });
  await createSession(user.id);
  const org = await db.organisation.findUnique({ where: { id: payload.orgId } });
  go(org ? `/office/${org.slug}/elections` : "/", "ok", "Welcome. Your account is ready.");
}

export async function forgotAction(fd: FormData) {
  const meta = await requestMeta();
  const gate = await hit(`forgot:${meta.ip}`, 5, 15 * 60);
  if (!gate.ok) go("/forgot", "err", "Too many requests. Wait a few minutes.");
  const email = str(fd, "email", 200).toLowerCase();
  const settings = await getSettings();
  const user = await db.user.findUnique({ where: { email } });
  const smtp = await mailFor(null);
  if (user && user.status === "ACTIVE" && smtp.enabled) {
    const { raw } = await createToken("RESET", { userId: user.id, expiresAt: new Date(Date.now() + 2 * 3600_000) });
    await queueMail(null, user.email, "RESET", `Reset your ${settings.site.name} password`, {
      heading: "Choose a new password",
      lines: ["Someone asked to reset the password for this account.", "The link works once and lapses in two hours. If it was not you, ignore this message; nothing changes."],
      cta: { label: "Choose a new password", url: absoluteUrl(settings, `/reset/${raw}`) },
    });
    await audit({ actorId: user.id, actorLabel: user.email, action: "auth.reset_requested", ip: meta.ip });
  }
  go("/login", "ok", smtp.enabled ? "If that address has an account, a reset link is on its way." : "E-mail is not set up on this server. Ask the platform administrator for help.");
}

export async function resetAction(fd: FormData) {
  const token = str(fd, "token", 120);
  const row = await findToken("RESET", token);
  if (!row || !row.userId) go("/login", "err", "That reset link has been used or has lapsed.");
  const password = str(fd, "password", 300);
  const weak = passwordProblem(password);
  if (weak) go(`/reset/${token}`, "err", weak);
  if (password !== str(fd, "confirm", 300)) go(`/reset/${token}`, "err", "The two passwords are not the same.");
  const meta = await requestMeta();
  await db.$transaction([
    db.token.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } }),
    db.session.deleteMany({ where: { userId: row.userId } }),
  ]);
  await audit({ actorId: row.userId, action: "auth.password_reset", ip: meta.ip });
  go("/login", "ok", "Your password is changed. Sign in with the new one.");
}
