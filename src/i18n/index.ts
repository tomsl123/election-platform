import { en, type Dict, type DictKey } from "./en";

const LOCALES: Record<string, Dict> = { en };

/** The dictionary for an organisation: its locale, with its own wording laid over it. */
export function getDict(org?: { locale: string } | null, words: Record<string, string> = {}): Dict {
  const base = LOCALES[org?.locale ?? "en"] ?? en;
  const out = { ...base } as Dict;
  for (const [k, v] of Object.entries(words)) if (k in out && v) out[k as DictKey] = v;
  return out;
}

/** Looks a key up and fills {placeholders}. */
export function t(dict: Dict, key: DictKey, vars: Record<string, string | number> = {}): string {
  return (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export type { Dict, DictKey };
