import { db } from "@/lib/db";
import { secureCookies } from "@/lib/auth";
import { createToken } from "@/lib/tokens";
import { authorizeUrl } from "@/lib/discord-oauth";
import { orgDiscord } from "@/lib/org";
import { parseRoutes } from "@/lib/types";

export const dynamic = "force-dynamic";

// The desk's Discord button: remember which election this is (state) and send the voter to Discord.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("e") ?? "";
  const e = await db.election.findUnique({ where: { id }, include: { org: true } });
  if (!e) return new Response("Not found", { status: 404 });
  const back = new URL(`/o/${e.org.slug}/e/${e.slug}`, req.url);
  const d = orgDiscord(e.org);
  if (e.status !== "OPEN" || !parseRoutes(e.routes).includes("DISCORD") || !d.clientId || !d.clientSecret || !d.guildId) {
    back.searchParams.set("sign", "discord");
    return Response.redirect(back, 303);
  }
  const { raw } = await createToken("OAUTH_STATE", { electionId: e.id, expiresAt: new Date(Date.now() + 10 * 60_000) });
  const res = new Response(null, { status: 303, headers: { location: await authorizeUrl(e.org, raw), "cache-control": "no-store" } });
  res.headers.append("set-cookie", `ps_oauth=${raw}; Path=/api/discord; Max-Age=600; HttpOnly; SameSite=Lax${secureCookies() ? "; Secure" : ""}`);
  return res;
}
