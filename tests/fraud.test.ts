import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSet, contains, ipKey, parseIP } from "@/lib/cidr";
import { emailKey, isDisposable, maskEmail } from "@/lib/email";
import { evaluate, ipSignals } from "@/lib/fraud";
import { defaultPolicy } from "@/lib/types";

describe("e-mail folding", () => {
  it("treats aliases of one inbox as one voter", () => {
    expect(emailKey("Tudle.Nudle+booth@Gmail.com")).toBe("tudlenudle@gmail.com");
    expect(emailKey("tudlenudle@googlemail.com")).toBe("tudlenudle@gmail.com");
    expect(emailKey("first.last+x@example.org")).toBe("first.last@example.org");
    expect(emailKey("first.last@example.org")).not.toBe(emailKey("firstlast@example.org"));
  });
  it("spots throwaway domains, including subdomains", () => {
    expect(isDisposable("x@mailinator.com")).toBe(true);
    expect(isDisposable("x@foo.mailinator.com")).toBe(true);
    expect(isDisposable("x@usfc.test")).toBe(false);
  });
  it("masks addresses for the officer", () => {
    expect(maskEmail("harper@usfc.test")).toBe("h****r@usfc.test");
  });
});

describe("address ranges", () => {
  const set = buildSet("# vpn\n203.0.113.0/24\n198.51.100.7\n2001:db8:abcd::/48\n10.0.0.0/8\n");
  it("matches IPv4 ranges and single addresses", () => {
    expect(contains(set, "203.0.113.200")).toBe(true);
    expect(contains(set, "203.0.114.1")).toBe(false);
    expect(contains(set, "198.51.100.7")).toBe(true);
    expect(contains(set, "198.51.100.8")).toBe(false);
  });
  it("matches IPv6 ranges and IPv4-mapped addresses", () => {
    expect(contains(set, "2001:db8:abcd:12::1")).toBe(true);
    expect(contains(set, "2001:db8:abce::1")).toBe(false);
    expect(contains(set, "::ffff:203.0.113.9")).toBe(true);
  });
  it("merges overlapping ranges", () => {
    const s = buildSet("1.2.3.0/24\n1.2.3.128/25\n1.2.4.0/24");
    expect(s.v4).toHaveLength(1);
  });
  it("keys IPv6 by its /64", () => {
    expect(ipKey("2001:db8::1")).toBe(ipKey("2001:db8::ffff"));
    expect(ipKey("2001:db8:0:1::1")).not.toBe(ipKey("2001:db8::1"));
    expect(parseIP("not an ip")).toBeNull();
  });
});

describe("policy", () => {
  it("takes the strongest action of the raised signs", () => {
    const p = defaultPolicy("PUBLIC");
    expect(evaluate([], p).action).toBe("ADMIT");
    expect(evaluate(["IP_SHARED"], p)).toEqual({ action: "HOLD", reasons: ["IP_SHARED"] });
    expect(evaluate(["IP_SHARED", "VPN"], p)).toEqual({ action: "BLOCK", reasons: ["VPN"] });
    expect(evaluate(["LOOKUP_FAILED"], p).action).toBe("ADMIT");
    const invite = defaultPolicy("INVITE");
    expect(evaluate(["VPN"], invite).action).toBe("ADMIT");
    expect(evaluate(["DEVICE_REPEAT"], invite).action).toBe("HOLD");
  });
  it("reads an address verdict as signs", () => {
    expect(ipSignals({ vpn: true, proxy: false, tor: false, hosting: true })).toEqual(["VPN", "DATACENTER"]);
    expect(ipSignals({ vpn: false, proxy: false, tor: false, hosting: false, failed: true })).toEqual(["LOOKUP_FAILED"]);
  });
});

describe("listed addresses at the desk", () => {
  it("refuses a VPN address in a public election", async () => {
    const dir = resolve(process.cwd(), process.env.IPLIST_DIR!);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "vpn.txt"), "203.0.113.0/24\n");
    const { localVerdict } = await import("@/lib/ipintel");
    expect((await localVerdict("203.0.113.5")).vpn).toBe(true);
    const { db } = await import("@/lib/db");
    const { admit } = await import("@/lib/desk");
    const org = await db.organisation.create({ data: { slug: "vpn-org", name: "V", shortName: "V" } });
    const e = await db.election.create({ data: { orgId: org.id, slug: "v", title: "V", status: "OPEN", fraud: JSON.stringify(defaultPolicy("PUBLIC")) } });
    const r = await admit({ election: e, route: "EMAIL_CODE", keys: ["email:x"], email: "x@usfc.test", mayCreate: true, evidence: { ip: "203.0.113.5", userAgent: "t", deviceId: "", deviceFp: "", email: "x@usfc.test" } });
    expect(r).toEqual({ outcome: "BLOCK", reasons: ["VPN"] });
  });
});
