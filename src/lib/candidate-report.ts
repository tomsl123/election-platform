// The candidates report: who runs, for which paper, and where. One set of data drawn three ways:
// a document (the office page, the downloaded file, printing to PDF), an e-mail with the photos inline,
// and a CSV for spreadsheets. Only approved candidates appear; referendums have none and are left out.
import type { Organisation } from "@prisma/client";
import { db } from "./db";
import { geographyFor } from "./districts";
import type { HexMap } from "./district-file";
import { fmtDate } from "./format";
import { cellKey, HEX_R, HEX_W, hexCenter, hexCorner, hexNeighbor, parseKey } from "./hex";
import { orgBrand } from "./org";
import { readStored } from "./uploads";
import { slugify } from "./action";

export type ReportParty = { id: string; name: string; abbr: string; color: string; logoId: string | null };
export type ReportCandidate = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  statement: string;
  photoId: string | null;
  party: ReportParty | null;
  /** a party list's names, in order (party-list papers only) */
  list: string[];
};
export type ReportDistrict = { id: string; name: string; code: string; seats: number };
export type ReportGroup = { district: ReportDistrict | null; seats: number; candidates: ReportCandidate[] };
export type ReportPaper = { id: string; title: string; method: string; seats: number; perDistrict: boolean; groups: ReportGroup[] };
export type ReportTally = { party: ReportParty | null; candidates: number };
export type CandidateReport = {
  org: { name: string; shortName: string; crestId: string | null };
  election: { id: string; slug: string; title: string; summary: string; status: string };
  dates: { nominationsClose: string; opens: string; closes: string };
  papers: ReportPaper[];
  /** candidates per party, largest first; `party: null` is everyone standing without a party */
  parties: ReportTally[];
  /** candidates standing in each district, over all per-district papers */
  districts: Array<ReportDistrict & { candidates: number }>;
  map: { map: HexMap; districtOf: Record<string, string> } | null;
  totals: { candidates: number; papers: number; districts: number; parties: number };
  generated: string;
};

const METHOD: Record<string, string> = {
  SINGLE: "One choice",
  MULTI: "Several choices",
  RANKED: "Ranked",
  SCORE: "Score",
  PARTY_LIST: "Party lists",
};
export const methodLabel = (m: string) => METHOD[m] ?? m;

/** Gathers the report for one election of an organisation, or null when the election is not theirs. */
export async function loadCandidateReport(org: Organisation, electionId: string, now = new Date()): Promise<CandidateReport | null> {
  const e = await db.election.findFirst({
    where: { id: electionId, orgId: org.id },
    include: { contests: { orderBy: { position: "asc" }, include: { districts: true, options: { orderBy: { position: "asc" }, include: { listCandidates: { orderBy: { position: "asc" } } } } } } },
  });
  if (!e) return null;
  const partyRows = await db.party.findMany({ where: { orgId: org.id }, orderBy: { position: "asc" } });
  const parties = new Map<string, ReportParty>(partyRows.map((p) => [p.id, { id: p.id, name: p.name, abbr: p.abbr, color: p.color, logoId: p.logoId }]));
  const geo = await geographyFor(e);
  const districtList = geo?.districts ?? [];
  const districtById = new Map(districtList.map((d) => [d.id, d]));
  const tz = org.timezone;

  const papers: ReportPaper[] = [];
  const perParty = new Map<string, number>();
  const perDistrict = new Map<string, number>();
  let total = 0;
  for (const c of e.contests) {
    if (c.method === "YESNO") continue;
    const options = c.options.filter((o) => o.status === "APPROVED" && o.kind === "CHOICE");
    const toCandidate = (o: (typeof options)[number]): ReportCandidate => ({
      id: o.id,
      name: o.name,
      subtitle: o.subtitle,
      color: o.color,
      statement: o.statement,
      photoId: o.photoId,
      party: (o.partyId && parties.get(o.partyId)) || null,
      list: o.listCandidates.map((l) => l.name),
    });
    const count = (o: (typeof options)[number]) => {
      const n = c.method === "PARTY_LIST" ? Math.max(1, o.listCandidates.length) : 1;
      total += n;
      perParty.set(o.partyId && parties.has(o.partyId) ? o.partyId : "", (perParty.get(o.partyId && parties.has(o.partyId) ? o.partyId : "") ?? 0) + n);
      if (c.scope === "PER_DISTRICT" && o.districtId) perDistrict.set(o.districtId, (perDistrict.get(o.districtId) ?? 0) + n);
    };
    options.forEach(count);
    const groups: ReportGroup[] = [];
    if (c.scope === "PER_DISTRICT") {
      const seatsOf = new Map(c.districts.map((d) => [d.districtId, d.seats]));
      for (const d of districtList) {
        const here = options.filter((o) => o.districtId === d.id);
        if (here.length === 0) continue;
        groups.push({ district: { id: d.id, name: d.name, code: d.code, seats: d.seats }, seats: seatsOf.get(d.id) ?? d.seats, candidates: here.map(toCandidate) });
      }
      const lost = options.filter((o) => !o.districtId || !districtById.has(o.districtId));
      if (lost.length) groups.push({ district: null, seats: c.seats, candidates: lost.map(toCandidate) });
    } else if (options.length) groups.push({ district: null, seats: c.seats, candidates: options.map(toCandidate) });
    if (groups.length) papers.push({ id: c.id, title: c.title, method: c.method, seats: c.seats, perDistrict: c.scope === "PER_DISTRICT", groups });
  }

  const tallies: ReportTally[] = [...perParty.entries()]
    .map(([id, n]) => ({ party: id ? parties.get(id)! : null, candidates: n }))
    .sort((a, b) => (a.party ? 0 : 1) - (b.party ? 0 : 1) || b.candidates - a.candidates);
  const districts = districtList.filter((d) => perDistrict.has(d.id)).map((d) => ({ id: d.id, name: d.name, code: d.code, seats: d.seats, candidates: perDistrict.get(d.id)! }));
  let map: CandidateReport["map"] = null;
  if (geo?.map && districts.length) {
    const districtOf: Record<string, string> = {};
    for (const d of districtList) for (const county of d.counties) districtOf[county.id] = d.id;
    map = { map: geo.map, districtOf };
  }

  return {
    org: { name: org.name, shortName: org.shortName, crestId: orgBrand(org).crestUploadId ?? null },
    election: { id: e.id, slug: e.slug, title: e.title, summary: e.summary, status: e.status },
    dates: { nominationsClose: fmtDate(e.nominationsCloseAt, tz), opens: fmtDate(e.opensAt ?? e.openedAt, tz), closes: fmtDate(e.closesAt ?? e.closedAt, tz) },
    papers,
    parties: tallies,
    districts,
    map,
    totals: { candidates: total, papers: papers.length, districts: districts.length, parties: tallies.filter((t) => t.party).length },
    generated: fmtDate(now, tz),
  };
}

// ── Images ──────────────────────────────────────────────────────────────────

/** Every upload the report shows: the crest, party logos, candidate photos. */
export function reportUploads(r: CandidateReport): string[] {
  const ids = new Set<string>();
  if (r.org.crestId) ids.add(r.org.crestId);
  for (const p of r.papers)
    for (const g of p.groups)
      for (const c of g.candidates) {
        if (c.photoId) ids.add(c.photoId);
        if (c.party?.logoId) ids.add(c.party.logoId);
      }
  for (const t of r.parties) if (t.party?.logoId) ids.add(t.party.logoId);
  return [...ids];
}

export type ReportImage = { id: string; mime: string; bytes: Buffer };

/** Reads the report's images from storage; missing files are left out (the report falls back to initials). */
export async function loadReportImages(r: CandidateReport, orgId: string): Promise<Map<string, ReportImage>> {
  const rows = await db.upload.findMany({ where: { id: { in: reportUploads(r) }, orgId } });
  const out = new Map<string, ReportImage>();
  for (const row of rows) {
    try {
      out.set(row.id, { id: row.id, mime: row.mime, bytes: await readStored(row.storedName) });
    } catch {
      /* the file is gone; initials stand in */
    }
  }
  return out;
}

/** Image sources for each way of drawing the report. */
export const imageSources = {
  /** the office page: served by /api/files */
  served: (id: string) => `/api/files/${id}`,
  /** a file that stands on its own: images inside it */
  embedded: (images: Map<string, ReportImage>) => (id: string) => {
    const im = images.get(id);
    return im ? `data:${im.mime};base64,${im.bytes.toString("base64")}` : null;
  },
  /** an e-mail: inline attachments */
  inline: (images: Map<string, ReportImage>) => (id: string) => (images.has(id) ? `cid:${cidOf(id)}` : null),
};
export const cidOf = (id: string) => `u${id}@polling-station`;

type ImageSource = (id: string) => string | null;

// ── Drawing helpers ─────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const safeColor = (c: string | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#23201c");

/** Up to two initials, for candidates without a photo. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

/** Black or white text, whichever reads better on a background colour. */
export function inkOn(hex: string): string {
  const c = safeColor(hex);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.4 ? "#23201c" : "#fffdf7";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const INDEPENDENT = { name: "Independent", abbr: "IND", color: "#8a8174" };

const DEFAULT_CREST = `<svg class="crest" viewBox="0 0 100 116" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h84v52c0 26-20 40-42 50C28 100 8 86 8 60z"/><circle cx="50" cy="47" r="24" stroke-width="2.6" stroke-dasharray="3.4 2.4"/><ellipse cx="50" cy="50" rx="11" ry="8" fill="currentColor" stroke="none"/><path d="M40 46c-7-2-10-8-6-13 1 4 4 7 8 8M60 46c7-2 10-8 6-13-1 4-4 7-8 8"/><path stroke-width="2" d="M40 54l-7 4M41 57l-5 6M60 54l7 4M59 57l5 6"/><path stroke-width="2.6" d="M50 78v19M50 85l-8-6M50 85l8-6M50 92l-6-4M50 92l6-4"/></svg>`;

/** The districts on the hex map, shaded by how many candidates stand in each, with the count written on. */
function mapSvg(r: CandidateReport): string {
  if (!r.map) return "";
  const { map, districtOf } = r.map;
  const counts = new Map(r.districts.map((d) => [d.id, d.candidates]));
  const max = Math.max(1, ...counts.values());
  const pt = (x: number, y: number, k: number) => hexCorner(x, y, k).map((v) => v.toFixed(1)).join(",");
  const paths: Record<string, string> = {};
  const centre: Record<string, { x: number; y: number; n: number }> = {};
  let border = "";
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [key, cid] of Object.entries(map.cells)) {
    const did = districtOf[cid];
    if (!did) continue;
    const [q, rr] = parseKey(key);
    const { x, y } = hexCenter(q, rr);
    paths[did] = (paths[did] ?? "") + `M${[0, 1, 2, 3, 4, 5].map((k) => pt(x, y, k)).join("L")}Z`;
    const c = (centre[did] ??= { x: 0, y: 0, n: 0 });
    c.x += x; c.y += y; c.n++;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    for (let i = 0; i < 6; i++) {
      const [nq, nr] = hexNeighbor(q, rr, i);
      const nd = map.cells[cellKey(nq, nr)] ? districtOf[map.cells[cellKey(nq, nr)]!] : undefined;
      if (nd !== did && (!nd || did < nd)) border += `M${pt(x, y, i)}L${pt(x, y, (i + 1) % 6)}`;
    }
  }
  if (x0 === Infinity) return "";
  const pad = HEX_R * 1.6;
  const box = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad + HEX_W / 2, y1 - y0 + 2 * pad].map((v) => v.toFixed(1)).join(" ");
  const fill = (n: number) => (n ? `rgba(31,59,43,${(0.18 + 0.72 * (n / max)).toFixed(2)})` : "#ece4d1");
  const names = new Map(r.districts.map((d) => [d.id, d.name]));
  const codes = new Map(r.districts.map((d) => [d.id, d.code]));
  const shapes = Object.entries(paths)
    .map(([did, d]) => `<path d="${d}" fill="${fill(counts.get(did) ?? 0)}"><title>${esc(names.get(did) ?? "")}${counts.get(did) ? ` · ${plural(counts.get(did)!, "candidate")}` : ""}</title></path>`)
    .join("");
  const labels = Object.entries(centre)
    .filter(([did]) => counts.get(did))
    .map(([did, c]) => {
      const n = counts.get(did)!;
      const ink = 0.18 + 0.72 * (n / max) > 0.5 ? "#fffdf7" : "#23201c";
      const x = (c.x / c.n).toFixed(1);
      const y = c.y / c.n;
      // A district of one or two hexes has room for its count only.
      const code = c.n > 2 ? `<text x="${x}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="7" font-family="Arial Narrow,Arial,sans-serif" letter-spacing=".6" fill="${ink}">${esc(codes.get(did) ?? "")}</text>` : "";
      return `${code}<text x="${x}" y="${(y + (code ? 8 : 4)).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${ink}">${n}</text>`;
    })
    .join("");
  return `<svg class="cr-map" viewBox="${box}" role="img" aria-label="Candidates per district">${shapes}<path d="${border}" fill="none" stroke="#23201c" stroke-width="1.2" stroke-linecap="round"/>${labels}</svg>`;
}

// ── The document ────────────────────────────────────────────────────────────

/** Scoped under .cr, so the office page can show it beside its own styles. */
export const REPORT_CSS = `
.cr{--ink:#23201c;--paper:#f6f1e4;--muted:#6b6357;--brass:#c9a14a;--green:#1f3b2b;--line:#d8cdb6;
  color:var(--ink);background:var(--paper);font-family:Georgia,'Times New Roman',serif;line-height:1.45;
  max-width:1040px;margin:0 auto;padding:clamp(16px,4vw,44px);box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cr *{box-sizing:border-box}
.cr .k{font-family:'Arial Narrow',Arial,sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.cr-head{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center;border-bottom:3px double var(--ink);padding-bottom:18px}
.cr .cr-head .crest{width:64px;height:74px;color:var(--ink);object-fit:contain}
.cr-head h1{font-size:clamp(26px,5vw,40px);line-height:1.1;margin:4px 0 6px}
.cr-head p{margin:0;color:var(--muted)}
.cr-dates{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:8px;font-family:'Arial Narrow',Arial,sans-serif;font-size:13px}
.cr-dates b{font-weight:700}
.cr-stats{display:grid;grid-template-columns:repeat(var(--n,4),1fr);border-top:1px solid var(--ink);border-left:1px solid var(--ink);margin:22px 0}
.cr-stats div{padding:12px 14px;border-right:1px solid var(--ink);border-bottom:1px solid var(--ink)}
.cr-stats b{display:block;font-size:clamp(26px,5vw,38px);line-height:1}
.cr-over{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;margin-bottom:10px}
.cr-over.solo{grid-template-columns:1fr}
.cr-over h2,.cr-paper>h2{font-size:20px;margin:0 0 10px}
.cr-bar{display:flex;height:22px;border:1px solid var(--ink);overflow:hidden;border-radius:2px}
.cr-bar span{display:block;height:100%}
.cr-legend{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:6px}
.cr-legend li{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;font-size:15px}
.cr-legend b{font-family:'Arial Narrow',Arial,sans-serif}
.cr-mark{width:28px;height:28px;border-radius:4px;display:grid;place-items:center;font:700 10px/1 'Arial Narrow',Arial,sans-serif;overflow:hidden}
.cr-mark img{width:100%;height:100%;object-fit:contain;background:#fff}
.cr-map{width:100%;height:auto;max-height:420px;display:block}
.cr-maplegend{display:flex;gap:8px;align-items:center;margin-top:6px}
.cr-maplegend i{display:inline-block;width:60px;height:10px;background:linear-gradient(90deg,rgba(31,59,43,.18),rgba(31,59,43,.9));border:1px solid var(--ink)}
.cr-paper{margin-top:30px;border-top:2px solid var(--ink);padding-top:14px}
.cr-paper>header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:6px 16px;margin-bottom:6px}
.cr-paper>header h2{margin:0;font-size:24px}
.cr-group{margin-top:16px}
.cr-group h3{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;font-size:17px;margin:0 0 10px;padding-bottom:4px;border-bottom:1px dashed var(--line)}
.cr-code{font:700 12px/1 'Arial Narrow',Arial,sans-serif;letter-spacing:.12em;border:1.5px solid var(--ink);padding:3px 6px;border-radius:2px}
.cr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.cr-card{display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:start;background:#fffdf7;border:1px solid var(--line);border-left:6px solid var(--c);padding:12px;break-inside:avoid;page-break-inside:avoid}
.cr-photo{width:72px;height:72px;border-radius:50%;overflow:hidden;display:grid;place-items:center;font:700 24px/1 'Arial Narrow',Arial,sans-serif;box-shadow:0 0 0 3px var(--c)}
.cr-photo img{width:100%;height:100%;object-fit:cover}
.cr-photo.logo{border-radius:6px;box-shadow:none;background:#fff}
.cr-photo.logo img{object-fit:contain}
.cr-card h4{margin:2px 0 4px;font-size:17px;line-height:1.2}
.cr-party{display:inline-flex;align-items:center;gap:6px;font:700 12px/1.2 'Arial Narrow',Arial,sans-serif;letter-spacing:.05em}
.cr-party .cr-mark{width:18px;height:18px;font-size:7px;border-radius:3px}
.cr-card p{margin:6px 0 0;font-size:13.5px;color:var(--muted)}
.cr-card ol{margin:6px 0 0;padding-left:20px;font-size:14px;columns:2;column-gap:18px}
.cr-foot{margin-top:36px;padding-top:10px;border-top:1px solid var(--brass);display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px}
.cr-empty{padding:30px;text-align:center;color:var(--muted);border:1px dashed var(--line)}
@media (max-width:640px){.cr .cr-head .crest{width:44px;height:52px}.cr-stats{grid-template-columns:repeat(2,1fr)}.cr-stats div:last-child:nth-child(odd){grid-column:span 2}.cr-over{grid-template-columns:1fr}.cr-head{grid-template-columns:1fr}.cr-card ol{columns:1}}
@media print{@page{size:A4;margin:12mm}.cr{max-width:none;padding:0;background:#fff}.cr-card{background:#fff}.cr-paper{break-before:auto}.cr-group h3{break-after:avoid}}
`;

function markHtml(party: { name: string; abbr: string; color: string; logoId?: string | null } | null, img: ImageSource): string {
  const p = party ?? { ...INDEPENDENT, logoId: null };
  const src = p.logoId ? img(p.logoId) : null;
  if (src) return `<span class="cr-mark"><img src="${esc(src)}" alt=""></span>`;
  const c = safeColor(p.color);
  return `<span class="cr-mark" style="background:${c};color:${inkOn(c)}">${esc(p.abbr.slice(0, 4))}</span>`;
}

function candidateCard(c: ReportCandidate, isList: boolean, img: ImageSource): string {
  const color = safeColor(c.party?.color ?? c.color);
  const photo = c.photoId ? img(c.photoId) : null;
  const logo = c.party?.logoId ? img(c.party.logoId) : null;
  let face: string;
  if (photo) face = `<div class="cr-photo"><img src="${esc(photo)}" alt=""></div>`;
  else if (isList && logo) face = `<div class="cr-photo logo"><img src="${esc(logo)}" alt=""></div>`;
  else face = `<div class="cr-photo" style="background:${color};color:${inkOn(color)}">${esc(initials(c.name))}</div>`;
  // Without a party, the option's own subtitle stands (options are not always people: "Snowbelle Cliff").
  const party = c.party ? `<span class="cr-party">${markHtml(c.party, img)}${esc(c.party.name)}</span>` : !isList && c.subtitle ? `<div class="k">${esc(c.subtitle)}</div>` : "";
  const sub = c.subtitle && c.party && c.subtitle !== c.party.abbr && c.subtitle !== c.party.name ? `<div class="k">${esc(c.subtitle)}</div>` : "";
  const statement = c.statement ? `<p>${esc(c.statement.length > 320 ? c.statement.slice(0, 317).trimEnd() + "…" : c.statement)}</p>` : "";
  const list = isList && c.list.length ? `<ol>${c.list.map((n) => `<li>${esc(n)}</li>`).join("")}</ol>` : "";
  return `<article class="cr-card" style="--c:${color}">${face}<div><h4>${esc(c.name)}</h4>${party}${sub}${statement}${list}</div></article>`;
}

/** The report's body, for the office page (inside .cr) and for the standalone file. */
export function renderReportBody(r: CandidateReport, img: ImageSource): string {
  const crestSrc = r.org.crestId ? img(r.org.crestId) : null;
  const crest = crestSrc ? `<img class="crest" src="${esc(crestSrc)}" alt="">` : DEFAULT_CREST;
  const dates = [
    r.dates.nominationsClose ? `<span>Nominations close <b>${esc(r.dates.nominationsClose)}</b></span>` : "",
    r.dates.opens ? `<span>Polls open <b>${esc(r.dates.opens)}</b></span>` : "",
    r.dates.closes ? `<span>Polls close <b>${esc(r.dates.closes)}</b></span>` : "",
  ].join("");
  const head = `<header class="cr-head">${crest}<div><div class="k">${esc(r.org.name)} · Who runs and where</div><h1>${esc(r.election.title)}</h1>${r.election.summary ? `<p>${esc(r.election.summary)}</p>` : ""}${dates ? `<div class="cr-dates">${dates}</div>` : ""}</div></header>`;

  const figures: Array<[number, string]> = [
    [r.totals.candidates, r.totals.candidates === 1 ? "candidate" : "candidates"],
    [r.totals.papers, r.totals.papers === 1 ? "paper" : "papers"],
    ...(r.totals.districts ? [[r.totals.districts, r.totals.districts === 1 ? "district" : "districts"] as [number, string]] : []),
    [r.totals.parties, r.totals.parties === 1 ? "party" : "parties"],
  ];
  const stats = `<section class="cr-stats" style="--n:${figures.length}" aria-label="In numbers">${figures.map(([n, l]) => `<div><b>${n}</b><span class="k">${l}</span></div>`).join("")}</section>`;

  if (r.totals.candidates === 0) return `${head}${stats}<p class="cr-empty">No approved candidates yet.</p>${footer(r)}`;

  const bar = r.parties.map((t) => `<span style="width:${((t.candidates / r.totals.candidates) * 100).toFixed(2)}%;background:${safeColor(t.party?.color ?? INDEPENDENT.color)}" title="${esc(t.party?.name ?? INDEPENDENT.name)}"></span>`).join("");
  const legend = r.parties.map((t) => `<li>${markHtml(t.party, img)}<span>${esc(t.party?.name ?? "Without a party")}</span><b>${t.candidates}</b></li>`).join("");
  const partyBlock = `<div><h2>By party</h2><div class="cr-bar" aria-hidden="true">${bar}</div><ul class="cr-legend">${legend}</ul></div>`;
  const svg = mapSvg(r);
  const mapBlock = svg ? `<div><h2>Where</h2>${svg}<div class="cr-maplegend k">fewer <i></i> more candidates</div></div>` : "";
  const over = `<section class="cr-over${mapBlock ? "" : " solo"}">${partyBlock}${mapBlock}</section>`;

  const papers = r.papers
    .map((p) => {
      const isList = p.method === "PARTY_LIST";
      const meta = [methodLabel(p.method), p.perDistrict ? "in each district" : p.seats > 1 ? plural(p.seats, "seat") : ""].filter(Boolean).join(" · ");
      const groups = p.groups
        .map((g) => {
          const title = g.district
            ? `<h3><span class="cr-code">${esc(g.district.code)}</span>${esc(g.district.name)}<span class="k">${plural(g.candidates.length, isList ? "list" : "candidate")} · ${plural(g.seats, "seat")}</span></h3>`
            : p.perDistrict
              ? `<h3>No district</h3>`
              : "";
          return `<div class="cr-group">${title}<div class="cr-cards">${g.candidates.map((c) => candidateCard(c, isList, img)).join("")}</div></div>`;
        })
        .join("");
      return `<section class="cr-paper"><header><h2>${esc(p.title)}</h2><span class="k">${esc(meta)}</span></header>${groups}</section>`;
    })
    .join("");

  return `${head}${stats}${over}${papers}${footer(r)}`;
}

function footer(r: CandidateReport): string {
  return `<footer class="cr-foot k"><span>${esc(r.org.shortName || r.org.name)} · Polling station</span><span>Approved candidates as of ${esc(r.generated)}</span></footer>`;
}

/** A standalone HTML document: opens in any browser, prints to PDF, needs nothing from the network. */
export function renderReportDocument(r: CandidateReport, img: ImageSource): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.election.title)} · Candidates</title><style>html,body{margin:0;background:#f6f1e4}${REPORT_CSS}</style></head><body><main class="cr">${renderReportBody(r, img)}</main></body></html>`;
}

export function reportFileName(r: CandidateReport, ext: "html" | "csv"): string {
  return `${slugify(r.election.title) || "election"}-candidates.${ext}`;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never a formula in someone's spreadsheet
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per candidate (and per name on a party list). */
export function renderReportCsv(r: CandidateReport): string {
  const rows: Array<Array<string | number>> = [["paper", "district_code", "district", "seats", "candidate", "party", "party_abbr", "list_position", "statement"]];
  for (const p of r.papers)
    for (const g of p.groups)
      for (const c of g.candidates) {
        const base = [p.title, g.district?.code ?? "", g.district?.name ?? "", g.seats];
        const party = [c.party?.name ?? "", c.party?.abbr ?? ""];
        if (p.method === "PARTY_LIST" && c.list.length) c.list.forEach((n, i) => rows.push([...base, n, ...(c.party ? party : [c.name, c.subtitle]), i + 1, ""]));
        else rows.push([...base, c.name, ...party, "", c.statement]);
      }
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ── The e-mail ──────────────────────────────────────────────────────────────

/**
 * E-mail clients drop <style>, grids and SVG, so the e-mail is tables with inline styles,
 * photos as inline attachments (cid:), and the full document attached for printing.
 */
export function renderReportEmail(r: CandidateReport, img: ImageSource, opts: { note: string; link: string | null; sender: string; footer: string }): { text: string; html: string } {
  const serif = "Georgia,'Times New Roman',serif";
  const sans = "'Arial Narrow',Arial,sans-serif";
  const k = `font-family:${sans};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6357;`;

  const text: string[] = [`${r.election.title.toUpperCase()} · WHO RUNS AND WHERE`, ""];
  if (opts.note) text.push(opts.note, "");
  text.push([plural(r.totals.candidates, "candidate"), plural(r.totals.papers, "paper"), r.totals.districts ? plural(r.totals.districts, "district") : "", plural(r.totals.parties, "party", "parties")].filter(Boolean).join(" · "), "");
  for (const t of r.parties) text.push(`  ${t.party?.name ?? "Without a party"}: ${t.candidates}`);
  for (const p of r.papers) {
    text.push("", `== ${p.title} ==`);
    for (const g of p.groups) {
      if (g.district) text.push(`-- ${g.district.code} ${g.district.name} (${plural(g.seats, "seat")})`);
      for (const c of g.candidates) text.push(`  * ${c.name}${c.party ? ` (${c.party.abbr})` : c.subtitle ? ` (${c.subtitle})` : ""}${c.list.length ? `: ${c.list.join(", ")}` : ""}`);
    }
  }
  text.push("", "The full report, with photos, is attached; open it in a browser to print or save as PDF.");
  if (opts.link) text.push(`Notice board: ${opts.link}`);
  text.push("", "--", opts.footer);

  const stat = (n: number, l: string) => `<td class="stat" style="padding:10px 12px;border:1px solid #23201c;background:#f6f1e4;"><div style="font-family:${serif};font-size:28px;font-weight:bold;line-height:1;">${n}</div><div style="${k}">${l}</div></td>`;
  const bar = r.parties
    .map((t) => `<td width="${Math.max(1, Math.round((t.candidates / Math.max(1, r.totals.candidates)) * 100))}%" style="height:16px;background:${safeColor(t.party?.color ?? INDEPENDENT.color)};font-size:0;line-height:0;">&nbsp;</td>`)
    .join("");
  const chip = (party: ReportParty | null, size: number) => {
    const src = party?.logoId ? img(party.logoId) : null;
    if (src) return `<img src="${esc(src)}" width="${size}" height="${size}" alt="" style="display:inline-block;vertical-align:middle;border-radius:3px;background:#fff;">`;
    const c = safeColor(party?.color ?? INDEPENDENT.color);
    return `<span style="display:inline-block;vertical-align:middle;width:${size}px;height:${size}px;line-height:${size}px;text-align:center;border-radius:3px;background:${c};color:${inkOn(c)};font-family:${sans};font-size:${Math.round(size / 2.6)}px;font-weight:bold;">${esc((party?.abbr ?? "IND").slice(0, 4))}</span>`;
  };
  const legend = r.parties
    .map((t) => `<tr><td style="padding:3px 8px 3px 0;width:24px;">${chip(t.party, 22)}</td><td style="font-family:${serif};font-size:15px;padding:3px 0;">${esc(t.party?.name ?? "Without a party")}</td><td align="right" style="font-family:${sans};font-weight:bold;font-size:15px;">${t.candidates}</td></tr>`)
    .join("");

  const card = (c: ReportCandidate, isList: boolean) => {
    const color = safeColor(c.party?.color ?? c.color);
    const photo = c.photoId ? img(c.photoId) : isList && c.party?.logoId ? img(c.party.logoId) : null;
    const face = photo
      ? `<img src="${esc(photo)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:${c.photoId ? "50%" : "6px"};object-fit:cover;${c.photoId ? `border:3px solid ${color};` : ""}">`
      : `<div style="width:56px;height:56px;line-height:56px;border-radius:50%;background:${color};color:${inkOn(color)};text-align:center;font-family:${sans};font-size:20px;font-weight:bold;">${esc(initials(c.name))}</div>`;
    const party = c.party ? `${chip(c.party, 14)}&nbsp;<span style="font-family:${sans};font-size:12px;font-weight:bold;">${esc(c.party.name)}</span>` : c.subtitle ? `<span style="font-family:${sans};font-size:12px;color:#6b6357;">${esc(c.subtitle)}</span>` : "";
    const list = isList && c.list.length ? `<div style="font-family:${serif};font-size:13px;color:#6b6357;margin-top:4px;">${c.list.map((n, i) => `${i + 1}.&nbsp;${esc(n)}`).join(" · ")}</div>` : "";
    return `<td class="col" valign="top" width="50%" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffdf7;border:1px solid #d8cdb6;border-left:5px solid ${color};"><tr><td valign="top" width="68" style="padding:10px 0 10px 10px;">${face}</td><td valign="top" style="padding:10px;"><div style="font-family:${serif};font-size:16px;font-weight:bold;line-height:1.25;margin-bottom:3px;">${esc(c.name)}</div>${party}${list}</td></tr></table></td>`;
  };
  const papers = r.papers
    .map((p) => {
      const isList = p.method === "PARTY_LIST";
      const groups = p.groups
        .map((g) => {
          const title = g.district
            ? `<div style="font-family:${serif};font-size:16px;font-weight:bold;margin:14px 6px 4px;border-bottom:1px dashed #d8cdb6;padding-bottom:3px;"><span style="font-family:${sans};font-size:11px;letter-spacing:2px;border:1.5px solid #23201c;padding:1px 5px;margin-right:6px;">${esc(g.district.code)}</span>${esc(g.district.name)} <span style="${k}">· ${plural(g.seats, "seat")}</span></div>`
            : "";
          const rows: string[] = [];
          for (let i = 0; i < g.candidates.length; i += 2) rows.push(`<tr>${card(g.candidates[i]!, isList)}${g.candidates[i + 1] ? card(g.candidates[i + 1]!, isList) : `<td class="col" width="50%"></td>`}</tr>`);
          return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>`;
        })
        .join("");
      return `<tr><td style="padding:18px 24px 4px;border-top:2px solid #23201c;"><div style="font-family:${serif};font-size:21px;font-weight:bold;">${esc(p.title)}</div><div style="${k}">${esc(methodLabel(p.method))}${p.perDistrict ? " · in each district" : ""}</div>${groups}</td></tr>`;
    })
    .join("");
  const crestSrc = r.org.crestId ? img(r.org.crestId) : null;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media (max-width:560px){.col{display:block!important;width:100%!important;box-sizing:border-box}.stat{display:block!important;float:left;width:50%!important;box-sizing:border-box}}</style></head><body style="margin:0;padding:0;background:#4b311a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#6d4a2b;"><tr><td style="height:16px;background:#1b3826;border-bottom:4px solid #c9a14a;"></td></tr><tr><td align="center" style="padding:24px 8px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#f6f1e4;color:#23201c;">
<tr><td style="padding:24px 24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${crestSrc ? `<td valign="middle" style="padding-right:14px;"><img src="${esc(crestSrc)}" width="52" alt="" style="display:block;"></td>` : ""}<td valign="middle"><div style="${k}">${esc(r.org.name)} · Who runs and where</div><div style="font-family:${serif};font-size:26px;font-weight:bold;line-height:1.15;margin-top:4px;">${esc(r.election.title)}</div></td></tr></table>
<div style="border-bottom:3px double #23201c;margin-top:12px;"></div>
${opts.note ? `<p style="font-family:${serif};font-size:15px;line-height:1.5;margin:14px 0 0;white-space:pre-line;">${esc(opts.note)}</p><p style="${k}margin:4px 0 0;">${esc(opts.sender)}</p>` : ""}
</td></tr>
<tr><td style="padding:4px 24px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${stat(r.totals.candidates, "candidates")}${stat(r.totals.papers, "papers")}${r.totals.districts ? stat(r.totals.districts, "districts") : ""}${stat(r.totals.parties, "parties")}</tr></table></td></tr>
${r.totals.candidates ? `<tr><td style="padding:10px 24px 14px;"><div style="font-family:${serif};font-size:17px;font-weight:bold;margin-bottom:6px;">By party</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #23201c;"><tr>${bar}</tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${legend}</table></td></tr>` : ""}
${papers}
<tr><td style="padding:18px 24px;">${opts.link ? `<a href="${esc(opts.link)}" style="display:inline-block;font-family:${sans};font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:10px 18px;border-radius:3px;background:#1f3b2b;color:#e2c06f;">Notice board</a>` : ""}<p style="font-family:${serif};font-size:13px;color:#6b6357;margin:12px 0 0;">The full report is attached. Open it in a browser to print it or save it as a PDF.</p></td></tr>
<tr><td style="padding:12px 24px 20px;font-family:${sans};font-size:11px;line-height:1.5;color:#6b6357;border-top:1px solid #c9a14a;">${esc(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text: text.join("\n"), html };
}
