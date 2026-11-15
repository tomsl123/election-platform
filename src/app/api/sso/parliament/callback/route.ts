import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { finishLogin, requestMeta, startCodeStep } from "@/lib/auth";
import { safePath } from "@/lib/action";
import { audit } from "@/lib/audit";
import { safeEqual } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { findToken } from "@/lib/tokens";
import { spendNonce, SSO_STATE_COOKIE, userForTicket, verifyTicket } from "@/lib/sso";

export const dynamic = "force-dynamic";

// Back from Parliament with a signed ticket: check the state, the ticket and its nonce, then sign the member in.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const state = url.searchParams.get("state") ?? "";
  const cookie = jar.get(SSO_STATE_COOKIE)?.value ?? "";
  jar.delete({ name: SSO_STATE_COOKIE, path: "/api/sso" });
  const meta = await requestMeta();
  const refuse = (why: string, details: Record<string, unknown> = {}) => {
    void audit({ action: "auth.sso_refused", actorLabel: "Parliament", ip: meta.ip, details: { why, ...details } });
    return Response.redirect(new URL("/login?err=" + encodeURIComponent(why), req.url), 303);
  };

  const tok = cookie && safeEqual(cookie, state) ? await findToken("OAUTH_STATE", state) : null;
  if (!tok) return refuse("That sign-in has lapsed. Start again.");
  const claimed = await db.token.updateMany({ where: { id: tok.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return refuse("That sign-in has already been used. Start again.");
  let next = "/";
  try {
    next = safePath(String(JSON.parse(tok.payload).next || "/"), "/");
  } catch {
    /* default */
  }

  const s = await getSettings(true);
  if (!s.sso.enabled || !s.sso.secret) return refuse("Shared sign-in is switched off.");
  const check = verifyTicket(url.searchParams.get("ticket") ?? "", s.sso.secret, s.sso.clientId);
  if (!check.ok) return refuse(check.reason === "expired" ? "That sign-in took too long. Start again." : `${s.sso.label} did not vouch for you.`, { reason: check.reason });
  if (!(await spendNonce(check.claims))) return refuse("That sign-in has already been used. Start again.", { reason: "replay" });

  const user = await userForTicket(check.claims);
  if (user.status !== "ACTIVE") return refuse("That account is suspended.");
  await audit({ actorId: user.id, actorLabel: user.displayName, action: "auth.sso", ip: meta.ip, details: { source: "parliament", sub: check.claims.sub, created: user.ssoSource === "parliament" && !user.lastLoginAt } });
  // Parliament vouches for who you are; an account with two-step sign-in still asks for its code.
  if (user.totpEnabled) {
    await startCodeStep(user.id, next);
    return Response.redirect(new URL("/login/code", req.url), 303);
  }
  await finishLogin(user, meta.ip);
  return Response.redirect(new URL(next, req.url), 303);
}
