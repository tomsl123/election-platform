import type { CSSProperties } from "react";
import { BRAND_COLORS, type Brand } from "./types";

/** The brand pack as CSS custom properties (--b-curtain, --b-wood, ...), set on a page's root element. */
export function brandStyle(brand: Brand): CSSProperties {
  const out: Record<string, string> = {};
  for (const k of BRAND_COLORS) out[`--b-${k}`] = brand.colors[k];
  out["--b-tint"] = brand.tints[0];
  return out as CSSProperties;
}
