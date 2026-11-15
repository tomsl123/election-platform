import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { requestMeta, secureCookies } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { findToken } from "@/lib/tokens";
import { admit, passCookie, PASS_MINUTES } from "@/lib/desk";
import { holdsRole, memberFromCode, oldEnough } from "@/lib/discord-oauth";
import { identityCandidates } from "@/lib/roll";

export const dynamic = "force-dynamic";

// Back from Discord: check the state, read the membership, and admit the voter at the desk.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const state = url.searchParams.get("state") ?? "";
  const cookie = jar.get("ps_oauth")?.value ?? "";
  jar.delete({ name: "ps_oauth", path: "/api/discord" });
  const tok = cookie && safeEqual(cookie, state) ? await findToken("OAUTH_STATE", state) : null;
  const e = tok?.electionId ? await db.election.findUnique({ where: { id: tok.electionId }, include: { org: true } }) : null;
  if (!tok || !e) return Response.redirect(new URL("/?err=" + encodeURIComponent("That Discord sign-in has lapsed. Try again from the polling station."), req.url), 303);
  await db.token.update({ where: { id: tok.id }, data: { usedAt: new Date() } });
  const back = new URL(`/o/${e.org.slug}/e/${e.slug}`, req.url);
  const signal = (s: string) => {
    back.searchParams.set("sign", s);
    return Response.redirect(back, 303);
  };
  const code = url.searchParams.get("code");
  if (!code) return signal("discord");

  let who: Awaited<ReturnType<typeof memberFromCode>>;
  try {
    who = await memberFromCode(e.org, code);
  } catch (err) {
    console.error("[polling-station] discord:", err);
    return signal("discord");
  }
  const roles = JSON.parse(e.discordRoleIds || "[]") as string[];
  if (!who.member || !holdsRole(who.member.roles, roles)) return signal("notOnRoll");
  if (!oldEnough(who.userId, e.discordMinAgeDays)) return signal("young");

  const meta = await requestMeta();
  const r = await admit({
    election: e,
    route: "DISCORD",
    keys: await identityCandidates(e.orgId, { discordId: who.userId }),
    displayName: who.member.nick || who.username,
    mayCreate: true,
    evidence: { ip: meta.ip, userAgent: meta.userAgent, deviceId: (jar.get("ps_device")?.value ?? "").slice(0, 64), deviceFp: "", email: null },
  });
  if (!("pass" in r)) return signal(r.outcome === "BLOCK" ? "blocked" : r.outcome === "ALREADY" ? "already" : r.outcome === "NOT_ON_ROLL" ? "notOnRoll" : "closed");
  jar.set(passCookie(e.id), r.pass, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: PASS_MINUTES * 60 });
  return Response.redirect(back, 303);
}
