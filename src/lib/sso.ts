// Shared sign-in where USFC Parliament vouches for its members.
// Parliament signs a short-lived ticket: base64url(JSON claims) + "." + base64url(HMAC-SHA256(sharedSecret, payload)).
// There is no back channel: the ticket travels in the browser's redirect, so it is checked for signature,
// audience, age and replay (each nonce is accepted once).
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { safeEqual } from "./crypto";
import { createToken } from "./tokens";

export type TicketClaims = { sub: string; email: string; name: string; aud: string; iat: number; exp: number; nonce: string };

export const SSO_STATE_COOKIE = "ps_sso";

/** How far a ticket's clock may be ahead of ours, in seconds. */
const SKEW = 30;
/** The longest a ticket may live, whatever it says. */
const MAX_LIFE = 120;

export function signTicket(secret: string, claims: TicketClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export type TicketCheck = { ok: true; claims: TicketClaims } | { ok: false; reason: "malformed" | "signature" | "audience" | "expired" | "future" };

/** Pure: is this ticket signed with our secret, meant for us, and still fresh? */
export function verifyTicket(ticket: string, secret: string, clientId: string, nowSec = Math.floor(Date.now() / 1000)): TicketCheck {
  if (!secret || ticket.length > 4000) return { ok: false, reason: "malformed" };
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payload, sig] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return { ok: false, reason: "signature" };
  let c: Partial<TicketClaims>;
  try {
    c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!c || !str(c.sub, 100) || !str(c.email, 200) || !/^[^\s@]+@[^\s@]+$/.test(c.email!) || typeof c.name !== "string" || c.name.length > 120 || !str(c.nonce, 100)) return { ok: false, reason: "malformed" };
  if (typeof c.iat !== "number" || typeof c.exp !== "number") return { ok: false, reason: "malformed" };
  if (c.aud !== clientId) return { ok: false, reason: "audience" };
  if (c.iat > nowSec + SKEW) return { ok: false, reason: "future" };
  if (c.exp <= nowSec || c.exp - c.iat > MAX_LIFE) return { ok: false, reason: "expired" };
  return { ok: true, claims: c as TicketClaims };
}

/** Accepts each nonce once: its hash is kept as a token until the ticket would have expired anyway. */
export async function spendNonce(claims: TicketClaims): Promise<boolean> {
  try {
    await createToken("SSO_NONCE", { raw: `${claims.aud}:${claims.nonce}`, expiresAt: new Date((claims.exp + SKEW) * 1000) });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/** The account Parliament vouched for: the one with this e-mail address, or a new one. */
export async function userForTicket(claims: TicketClaims) {
  const email = claims.email.trim().toLowerCase();
  const found = await db.user.findUnique({ where: { email } });
  if (found) return found;
  return db.user.create({ data: { email, displayName: (claims.name || email.split("@")[0]).slice(0, 80), ssoSource: "parliament" } });
}
