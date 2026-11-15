// What an IP address says about a voter: Tor exit, commercial VPN, datacenter, or (with a lookup
// service) a residential proxy. Local lists live in data/iplists and are refreshed daily.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "./db";
import { hmac } from "./crypto";
import { buildSet, contains, setSize, type RangeSet } from "./cidr";
import { getSettings, saveSettings } from "./settings";

export type IpLookup = { vpn: boolean; proxy: boolean; tor: boolean; hosting: boolean; asn?: string; country?: string; failed?: boolean };

const LISTS = ["tor", "vpn", "datacenter"] as const;
type ListName = (typeof LISTS)[number];
const EMPTY: RangeSet = { v4: [], v6: [] };

const g = globalThis as unknown as { __psLists?: Record<ListName, RangeSet>; __psListsLoaded?: boolean };

function dir() {
  return resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.IPLIST_DIR || "./data/iplists");
}

async function loadLists() {
  if (g.__psListsLoaded) return;
  g.__psListsLoaded = true;
  g.__psLists ??= { tor: EMPTY, vpn: EMPTY, datacenter: EMPTY };
  for (const name of LISTS) {
    try {
      g.__psLists[name] = buildSet(await readFile(resolve(dir(), `${name}.txt`), "utf8"));
    } catch {
      /* no copy yet */
    }
  }
}

export function listStatus() {
  const l = g.__psLists ?? { tor: EMPTY, vpn: EMPTY, datacenter: EMPTY };
  return { tor: setSize(l.tor), vpn: setSize(l.vpn), datacenter: setSize(l.datacenter) };
}

/** Downloads every list; a list that fails keeps its last good copy. Runs daily from the clock. */
export async function refreshIpLists(force = false): Promise<{ ok: boolean; message: string }> {
  const s = await getSettings(true);
  if (!force && s.iplists.lastRefresh && Date.now() - new Date(s.iplists.lastRefresh).getTime() < 24 * 3600_000) {
    await loadLists();
    return { ok: true, message: "Lists are fresh." };
  }
  await loadLists();
  const urls: Record<ListName, string> = { tor: s.iplists.torUrl, vpn: s.iplists.vpnUrl, datacenter: s.iplists.datacenterUrl };
  const errors: string[] = [];
  await mkdir(dir(), { recursive: true });
  for (const name of LISTS) {
    const url = urls[name];
    if (!url) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const text = await res.text();
      const set = buildSet(text);
      if (setSize(set) === 0) throw new Error("no ranges in the file");
      await writeFile(resolve(dir(), `${name}.txt`), text);
      g.__psLists![name] = set;
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await saveSettings("iplists", { lastRefresh: new Date().toISOString(), lastError: errors.join("; ") });
  const st = listStatus();
  return { ok: errors.length === 0, message: errors.length ? `Some lists failed: ${errors.join("; ")}` : `Lists refreshed: Tor ${st.tor}, VPN ${st.vpn}, datacenter ${st.datacenter}.` };
}

/** Local verdict only (no network). */
export async function localVerdict(ip: string): Promise<{ tor: boolean; vpn: boolean; hosting: boolean }> {
  await loadLists();
  const l = g.__psLists!;
  return { tor: contains(l.tor, ip), vpn: contains(l.vpn, ip), hosting: contains(l.datacenter, ip) };
}

const isPrivate = (ip: string) => /^(127\.|10\.|192\.168\.|169\.254\.|::1$|fc|fd|fe80)/i.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** Local lists, then the optional lookup service (cached 24 h by address hash). */
export async function lookupIp(ip: string): Promise<IpLookup> {
  const local = await localVerdict(ip);
  const out: IpLookup = { ...local, proxy: false };
  if (!ip || isPrivate(ip)) return out;
  const s = await getSettings();
  if (s.iplists.provider === "none" || !s.iplists.apiKey) return out;
  const key = hmac("ip-verdict", ip);
  const cached = await db.ipVerdict.findUnique({ where: { ip: key } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < 24 * 3600_000) {
    try {
      const v = JSON.parse(cached.verdict) as IpLookup;
      return { ...v, tor: v.tor || out.tor, vpn: v.vpn || out.vpn, hosting: v.hosting || out.hosting };
    } catch {
      /* refetch */
    }
  }
  try {
    const remote = s.iplists.provider === "proxycheck" ? await proxycheck(ip, s.iplists.apiKey) : await ipqs(ip, s.iplists.apiKey);
    await db.ipVerdict.upsert({ where: { ip: key }, create: { ip: key, verdict: JSON.stringify(remote), source: s.iplists.provider, fetchedAt: new Date() }, update: { verdict: JSON.stringify(remote), source: s.iplists.provider, fetchedAt: new Date() } });
    return { ...remote, tor: remote.tor || out.tor, vpn: remote.vpn || out.vpn, hosting: remote.hosting || out.hosting };
  } catch {
    return { ...out, failed: true };
  }
}

// proxycheck.io v2: GET https://proxycheck.io/v2/{ip}?key=…&vpn=1&asn=1 → { status, "<ip>": { proxy: "yes"|"no", type, asn, isocode } }
async function proxycheck(ip: string, apiKey: string): Promise<IpLookup> {
  const res = await fetch(`https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(apiKey)}&vpn=1&asn=1`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`proxycheck answered ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if (body.status === "error" || body.status === "denied") throw new Error(String(body.message ?? body.status));
  const r = (body[ip] ?? {}) as { proxy?: string; type?: string; asn?: string; isocode?: string };
  const type = String(r.type ?? "").toLowerCase();
  return {
    proxy: r.proxy === "yes" && type !== "vpn",
    vpn: type === "vpn",
    tor: type === "tor",
    hosting: type === "hosting" || type === "business",
    asn: r.asn,
    country: r.isocode,
  };
}

// IPQualityScore: GET https://ipqualityscore.com/api/json/ip/{key}/{ip}?strictness=1 → { success, proxy, vpn, tor, host, ASN, country_code }
async function ipqs(ip: string, apiKey: string): Promise<IpLookup> {
  const res = await fetch(`https://ipqualityscore.com/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`IPQS answered ${res.status}`);
  const b = (await res.json()) as { success?: boolean; message?: string; proxy?: boolean; vpn?: boolean; tor?: boolean; active_vpn?: boolean; ASN?: number; country_code?: string; is_crawler?: boolean };
  if (!b.success) throw new Error(b.message ?? "IPQS refused");
  return { proxy: !!b.proxy && !b.vpn, vpn: !!(b.vpn || b.active_vpn), tor: !!b.tor, hosting: false, asn: b.ASN ? `AS${b.ASN}` : undefined, country: b.country_code };
}
