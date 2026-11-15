// Pure IP-range matching: parse addresses and CIDR ranges (IPv4 and IPv6) into numeric
// intervals, merge them, and answer "is this address inside?" by binary search.

export type Range = { lo: bigint; hi: bigint };
export type RangeSet = { v4: Range[]; v6: Range[] };

export function parseIPv4(s: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  let n = 0n;
  for (let i = 1; i <= 4; i++) {
    const p = Number(m[i]);
    if (p > 255) return null;
    n = (n << 8n) | BigInt(p);
  }
  return n;
}

export function parseIPv6(input: string): bigint | null {
  let s = input.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hextets.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = parseIPv4(v4[1]);
    if (n === null) return null;
    s = s.slice(0, -v4[1].length) + ((n >> 16n) & 0xffffn).toString(16) + ":" + (n & 0xffffn).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = 0n;
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    n = (n << 16n) | BigInt(parseInt(p, 16));
  }
  return n;
}

/** IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are treated as the IPv4 address. */
export function parseIP(s: string): { v: 4 | 6; n: bigint } | null {
  const four = parseIPv4(s);
  if (four !== null) return { v: 4, n: four };
  const six = parseIPv6(s);
  if (six === null) return null;
  if (six >> 32n === 0xffffn) return { v: 4, n: six & 0xffffffffn };
  return { v: 6, n: six };
}

/** "1.2.3.0/24", "2001:db8::/32" or a single address. */
export function parseRange(line: string): { v: 4 | 6; r: Range } | null {
  const s = line.split("#")[0].trim();
  if (!s) return null;
  const [addr, bitsRaw] = s.split("/");
  const ip = parseIP(addr);
  if (!ip) return null;
  const width = ip.v === 4 ? 32 : 128;
  const bits = bitsRaw === undefined ? width : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const host = (1n << BigInt(width - bits)) - 1n;
  const lo = ip.n & ~host & ((1n << BigInt(width)) - 1n);
  return { v: ip.v, r: { lo, hi: lo | host } };
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => (a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : 0));
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.lo <= last.hi + 1n) {
      if (r.hi > last.hi) last.hi = r.hi;
    } else out.push({ ...r });
  }
  return out;
}

export function buildSet(text: string): RangeSet {
  const v4: Range[] = [];
  const v6: Range[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = parseRange(line);
    if (!p) continue;
    (p.v === 4 ? v4 : v6).push(p.r);
  }
  return { v4: merge(v4), v6: merge(v6) };
}

export function setSize(s: RangeSet): number {
  return s.v4.length + s.v6.length;
}

export function contains(set: RangeSet, ip: string): boolean {
  const p = parseIP(ip);
  if (!p) return false;
  const list = p.v === 4 ? set.v4 : set.v6;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = list[mid];
    if (p.n < r.lo) hi = mid - 1;
    else if (p.n > r.hi) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The part of an address that identifies a connection: the whole IPv4 address, or the /64 of an IPv6 one. */
export function ipKey(ip: string): string {
  const p = parseIP(ip);
  if (!p) return ip.trim().toLowerCase();
  if (p.v === 4) return `4:${p.n.toString(16)}`;
  return `6:${(p.n >> 64n).toString(16)}`;
}
