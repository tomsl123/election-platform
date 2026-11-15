import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { signTicket, spendNonce, userForTicket, verifyTicket, type TicketClaims } from "@/lib/sso";

const SECRET = "a-shared-secret-of-at-least-32-characters!";
const now = 1_800_000_000;
const claims = (over: Partial<TicketClaims> = {}): TicketClaims => ({ sub: "u1", email: "Member@Parliament.test", name: "Senator Member", aud: "polling-station", iat: now, exp: now + 60, nonce: "n-" + Math.random(), ...over });

describe("Parliament tickets", () => {
  it("accepts a fresh ticket signed with the shared secret", () => {
    const c = claims();
    const r = verifyTicket(signTicket(SECRET, c), SECRET, "polling-station", now + 5);
    expect(r).toEqual({ ok: true, claims: c });
  });

  it("refuses forged, misdirected, stale and malformed tickets", () => {
    const good = signTicket(SECRET, claims());
    expect(verifyTicket(good, "another-secret-another-secret-another", "polling-station", now)).toMatchObject({ ok: false, reason: "signature" });
    const [payload, sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims(), email: "president@usfc.test" })).toString("base64url");
    expect(verifyTicket(`${forged}.${sig}`, SECRET, "polling-station", now)).toMatchObject({ ok: false, reason: "signature" });
    expect(verifyTicket(signTicket(SECRET, claims({ aud: "someone-else" })), SECRET, "polling-station", now)).toMatchObject({ ok: false, reason: "audience" });
    expect(verifyTicket(good, SECRET, "polling-station", now + 60)).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyTicket(signTicket(SECRET, claims({ exp: now + 3600 })), SECRET, "polling-station", now)).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyTicket(signTicket(SECRET, claims({ iat: now + 600, exp: now + 660 })), SECRET, "polling-station", now)).toMatchObject({ ok: false, reason: "future" });
    expect(verifyTicket(payload, SECRET, "polling-station", now)).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyTicket(signTicket(SECRET, claims({ email: "not-an-address" })), SECRET, "polling-station", now)).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyTicket(good, "", "polling-station", now)).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("accepts each nonce once", async () => {
    const c = claims({ exp: Math.floor(Date.now() / 1000) + 60 });
    expect(await spendNonce(c)).toBe(true);
    expect(await spendNonce(c)).toBe(false);
    expect(await spendNonce({ ...c, nonce: c.nonce + "x" })).toBe(true);
  });

  it("finds the account by e-mail or opens one marked as Parliament's", async () => {
    const made = await userForTicket(claims({ email: "New.Member@Parliament.test", name: "New Member" }));
    expect(made).toMatchObject({ email: "new.member@parliament.test", displayName: "New Member", ssoSource: "parliament", passwordHash: null });
    const staff = await db.user.create({ data: { email: "clerk@parliament.test", displayName: "Clerk" } });
    expect((await userForTicket(claims({ email: "CLERK@parliament.test" }))).id).toBe(staff.id);
  });
});
