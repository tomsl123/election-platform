// The national hex map drawn in UCTV Elections, shown here read-only. Port of uctv-elections/apps/web/src/HexMap.tsx
// without painting. Works on the server (districts as links) and in client components (districts as tap targets).
import type { HexMap as HexMapData } from "@/lib/district-file";
import { cellKey, HEX_R, HEX_W, hexCenter, hexCorner, hexNeighbor, parseKey } from "@/lib/hex";

type Props = {
  map: HexMapData;
  /** county id → district id; cells of unknown counties are not drawn */
  districtOf: Record<string, string>;
  fill: (districtId: string, countyId: string) => string;
  /** a name per district, for the link's accessible name and the tooltip */
  nameOf?: (districtId: string) => string;
  /** makes every district a link (keyboard: Tab, Enter) */
  hrefFor?: (districtId: string) => string;
  /** makes every district a tap target (client components only) */
  onPick?: (districtId: string) => void;
  selected?: string | null;
  className?: string;
  /** decoration only: hidden from assistive technology (another control does the same job) */
  decorative?: boolean;
};

const pt = (x: number, y: number, k: number) => {
  const [a, b] = hexCorner(x, y, k);
  return `${a.toFixed(1)},${b.toFixed(1)}`;
};
const hexPath = (x: number, y: number) => `M${[0, 1, 2, 3, 4, 5].map((k) => pt(x, y, k)).join("L")}Z`;

function geometry(map: HexMapData, districtOf: Record<string, string>, selected: string | null) {
  const byDistrict: Record<string, Record<string, string>> = {};
  const seg = { county: "", seat: "", sel: "" };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [key, cid] of Object.entries(map.cells)) {
    const did = districtOf[cid];
    if (!did) continue;
    const [q, r] = parseKey(key);
    const { x, y } = hexCenter(q, r);
    const counties = (byDistrict[did] ??= {});
    counties[cid] = (counties[cid] ?? "") + hexPath(x, y);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    for (let i = 0; i < 6; i++) {
      const [nq, nr] = hexNeighbor(q, r, i);
      const ncid = map.cells[cellKey(nq, nr)];
      const nd = ncid ? districtOf[ncid] : undefined;
      const edge = `M${pt(x, y, i)}L${pt(x, y, (i + 1) % 6)}`;
      if (nd && nd !== did) {
        if (did < nd) seg.seat += edge;
      } else if (nd && ncid !== cid && cid < ncid!) seg.county += edge;
      if (selected && did === selected && nd !== did) seg.sel += edge;
    }
  }
  if (x0 === Infinity) {
    const a = hexCenter(0, 0), b = hexCenter(map.cols - 1, map.rows - 1);
    x0 = a.x; y0 = a.y; x1 = b.x + HEX_W / 2; y1 = b.y;
  }
  const pad = HEX_R * 1.6;
  return { byDistrict, seg, box: [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].map((v) => v.toFixed(1)).join(" ") };
}

export function HexMap({ map, districtOf, fill, nameOf, hrefFor, onPick, selected = null, className = "", decorative }: Props) {
  const geo = geometry(map, districtOf, selected);
  return (
    <svg className={`hexmap ${className}`} viewBox={geo.box} role={decorative ? undefined : "img"} aria-hidden={decorative || undefined} focusable="false">
      {Object.entries(geo.byDistrict).map(([did, counties]) => {
        const shapes = Object.entries(counties).map(([cid, d]) => <path key={cid} className="m-cell" d={d} fill={fill(did, cid)} />);
        const name = nameOf?.(did);
        if (hrefFor && !decorative)
          return (
            <a key={did} href={hrefFor(did)} aria-label={name} aria-current={selected === did ? "page" : undefined} className="m-district">
              {name ? <title>{name}</title> : null}
              {shapes}
            </a>
          );
        return (
          <g key={did} className={`m-district${onPick ? " m-pick" : ""}`} onClick={onPick ? () => onPick(did) : undefined}>
            {name ? <title>{name}</title> : null}
            {shapes}
          </g>
        );
      })}
      <path className="m-county" d={geo.seg.county} fill="none" />
      <path className="m-seat" d={geo.seg.seat} fill="none" strokeLinecap="round" />
      {geo.seg.sel ? <path className="m-sel" d={geo.seg.sel} fill="none" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** County id → district id for a list of districts with counties. */
export function countyIndex(districts: Array<{ id: string; counties: Array<{ id: string }> }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of districts) for (const c of d.counties) out[c.id] = d.id;
  return out;
}

/** A calm, distinct colour per district for maps that carry no results. */
export function districtHue(i: number, j = 0): string {
  return `hsl(${Math.round((i * 137.508) % 360)} 38% ${62 + (j % 3) * 6}%)`;
}
