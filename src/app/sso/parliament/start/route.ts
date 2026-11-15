import { secureCookies } from "@/lib/auth";
import { safePath } from "@/lib/action";
import { absoluteUrl, getSettings } from "@/lib/settings";
import { createToken } from "@/lib/tokens";
import { SSO_STATE_COOKIE } from "@/lib/sso";

export const dynamic = "force-dynamic";

// "Continue with USFC Parliament": remember where to go back to (state) and send the browser to Parliament.
export async function GET(req: Request) {
  const s = await getSettings();
  const next = safePath(new URL(req.url).searchParams.get("next") ?? "/", "/");
  if (!s.sso.enabled || !s.sso.parliamentUrl || !s.sso.secret) {
    return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}&err=${encodeURIComponent("Shared sign-in is switched off.")}`, req.url), 303);
  }
  const { raw } = await createToken("OAUTH_STATE", { payload: JSON.stringify({ next, sso: "parliament" }), expiresAt: new Date(Date.now() + 10 * 60_000) });
  const to = new URL("/sso/authorize", s.sso.parliamentUrl.replace(/\/+$/, "") + "/");
  to.searchParams.set("client", s.sso.clientId);
  to.searchParams.set("redirect", absoluteUrl(s, "/api/sso/parliament/callback"));
  to.searchParams.set("state", raw);
  const res = new Response(null, { status: 303, headers: { location: to.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  res.headers.append("set-cookie", `${SSO_STATE_COOKIE}=${raw}; Path=/api/sso; Max-Age=600; HttpOnly; SameSite=Lax${secureCookies() ? "; Secure" : ""}`);
  return res;
}
