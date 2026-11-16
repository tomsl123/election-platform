// Hex grid geometry, the same as UCTV Elections (packages/shared/src/index.ts): odd-r offset, pointy top.
// Maps drawn in UCTV's painter use these coordinates, so they must stay identical.

export const HEX_R = 10;
export const HEX_W = Math.sqrt(3) * HEX_R;
export const hexCenter = (q: number, r: number) => ({ x: HEX_W * (q + 0.5 * (r & 1)) + HEX_W / 2, y: HEX_R * 1.5 * r + HEX_R });
const EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
/** Neighbour in direction i (0 = east, then clockwise on screen). Edge i of a hex faces neighbour i. */
export const hexNeighbor = (q: number, r: number, i: number): [number, number] => {
  const d = (r & 1 ? ODD : EVEN)[i]!;
  return [q + d[0]!, r + d[1]!];
};
export const hexCorner = (x: number, y: number, k: number, radius = HEX_R) => {
  const a = (Math.PI / 180) * (60 * k - 30);
  return [x + radius * Math.cos(a), y + radius * Math.sin(a)] as const;
};
export const cellKey = (q: number, r: number) => `${q},${r}`;
export const parseKey = (k: string): [number, number] => {
  const i = k.indexOf(",");
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};
