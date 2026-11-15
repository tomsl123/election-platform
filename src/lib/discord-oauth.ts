// Discord as a way in: the voter signs in with Discord, and is on the roll if they are a member
// of the organisation's server holding one of the election's roles. Tokens are used once, never stored.
// Endpoints as documented at docs.discord.com/developers (topics/oauth2, resources/user), checked Nov 2026.
import type { Organisation } from "@prisma/client";
import { orgDiscord } from "./org";
import { absoluteUrl, getSettings } from "./settings";

const DISCORD_EPOCH = 1420070400000n;
export const DISCORD_SCOPE = "identify guilds.members.read";

/** When a Discord account (or anything with a snowflake id) was created. */
export function snowflakeTime(id: string): Date | null {
  if (!/^\d{5,20}$/.test(id)) return null;
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

export function holdsRole(memberRoles: string[], wanted: string[]): boolean {
  return wanted.length > 0 && memberRoles.some((r) => wanted.includes(r));
}

export function oldEnough(userId: string, minDays: number, now = Date.now()): boolean {
  if (minDays <= 0) return true;
  const born = snowflakeTime(userId);
  return !!born && now - born.getTime() >= minDays * 86400_000;
}

export async function redirectUri() {
  return absoluteUrl(await getSettings(), "/api/discord/callback");
}

export async function authorizeUrl(org: Organisation, state: string) {
  const d = orgDiscord(org);
  const q = new URLSearchParams({ response_type: "code", client_id: d.clientId, scope: DISCORD_SCOPE, redirect_uri: await redirectUri(), state, prompt: "none" });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

export type DiscordMember = { userId: string; username: string; nick: string | null; roles: string[] } | null;

/** Exchanges the code, then reads who the voter is and their membership of the organisation's server. */
export async function memberFromCode(org: Organisation, code: string): Promise<{ userId: string; username: string; member: DiscordMember }> {
  const d = orgDiscord(org);
  if (!d.clientId || !d.clientSecret || !d.guildId) throw new Error("Discord sign-in is not set up for this organisation.");
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${d.clientId}:${d.clientSecret}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: await redirectUri() }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`Discord refused the sign-in (${tokenRes.status}).`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const auth = { authorization: `Bearer ${access_token}` };
  const meRes = await fetch("https://discord.com/api/v10/users/@me", { headers: auth, signal: AbortSignal.timeout(10_000) });
  if (!meRes.ok) throw new Error(`Discord did not say who you are (${meRes.status}).`);
  const me = (await meRes.json()) as { id: string; username: string; global_name?: string | null };
  const memRes = await fetch(`https://discord.com/api/v10/users/@me/guilds/${d.guildId}/member`, { headers: auth, signal: AbortSignal.timeout(10_000) });
  let member: DiscordMember = null;
  if (memRes.ok) {
    const m = (await memRes.json()) as { nick?: string | null; roles?: string[] };
    member = { userId: me.id, username: me.global_name || me.username, nick: m.nick ?? null, roles: m.roles ?? [] };
  } else if (memRes.status !== 404) throw new Error(`Discord did not show your membership (${memRes.status}).`);
  // Revoking is a courtesy; the token is never stored either way.
  void fetch("https://discord.com/api/oauth2/token/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${d.clientId}:${d.clientSecret}`).toString("base64") },
    body: new URLSearchParams({ token: access_token, token_type_hint: "access_token" }),
  }).catch(() => undefined);
  return { userId: me.id, username: me.global_name || me.username, member };
}
