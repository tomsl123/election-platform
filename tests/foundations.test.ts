import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hmac, normaliseReceipt, randomReceipt } from "@/lib/crypto";
import { audit, verifyJournal } from "@/lib/audit";
import { db } from "@/lib/db";
import { getDict, t } from "@/i18n";
import { parseBrand, parsePolicy, parseRule, DEFAULT_BRAND } from "@/lib/types";

describe("crypto", () => {
  it("encrypts and decrypts at rest", () => {
    const sealed = encrypt("smtp-password");
    expect(sealed).not.toContain("smtp-password");
    expect(decrypt(sealed)).toBe("smtp-password");
  });
  it("refuses a tampered cipher text", () => {
    const sealed = encrypt("x");
    const broken = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
    expect(decrypt(broken)).toBeNull();
  });
  it("normalises receipts typed loosely", () => {
    const r = randomReceipt();
    expect(r).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normaliseReceipt(r.toLowerCase().replace(/-/g, " "))).toBe(r.replace(/-/g, ""));
  });
  it("keeps hmacs apart by purpose", () => {
    expect(hmac("email", "a")).not.toBe(hmac("ip", "a"));
  });
});

describe("journal", () => {
  it("chains entries and detects tampering", async () => {
    await audit({ action: "test.one", details: { a: 1 } });
    await audit({ action: "test.two", orgId: "org1" });
    expect((await verifyJournal()).ok).toBe(true);
    const last = await db.auditLog.findFirst({ orderBy: { seq: "desc" } });
    await db.auditLog.update({ where: { seq: last!.seq }, data: { details: '{"a":2}' } });
    const r = await verifyJournal();
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(last!.seq);
    await db.auditLog.deleteMany({});
  });
});

describe("dictionary and JSON settings", () => {
  it("fills placeholders and takes organisation wording", () => {
    const d = getDict({ locale: "en" }, { "station.plate": "Cliff Polling Station" });
    expect(t(d, "station.plate")).toBe("Cliff Polling Station");
    expect(t(d, "station.mark.upTo", { n: 2 })).toBe("Mark up to 2");
  });
  it("falls back to defaults on bad JSON", () => {
    expect(parseBrand("nonsense").colors).toEqual(DEFAULT_BRAND.colors);
    expect(parseBrand(JSON.stringify({ colors: { wood: "#000000", ink: "red" } })).colors.wood).toBe("#000000");
    expect(parseRule("{}").win).toBe("PLURALITY");
    expect(parsePolicy("{}", "PUBLIC").actions.VPN).toBe("BLOCK");
    expect(parsePolicy(JSON.stringify({ actions: { VPN: "IGNORE" } }), "PUBLIC").actions.VPN).toBe("IGNORE");
    expect(parsePolicy("{}", "INVITE").actions.VPN).toBe("IGNORE");
  });
});
