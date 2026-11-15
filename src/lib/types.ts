// Every enumerated value in the data model, and the zod schemas for the JSON columns.
import { z } from "zod";

export const ORG_ROLES = ["OWNER", "OFFICER", "OBSERVER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ROLE_RANK: Record<OrgRole, number> = { OBSERVER: 1, OFFICER: 2, OWNER: 3 };

export const ELECTION_STATUS = ["DRAFT", "NOMINATIONS", "READY", "OPEN", "CLOSED", "COUNTED", "CERTIFIED", "CANCELLED"] as const;
export type ElectionStatus = (typeof ELECTION_STATUS)[number];
export const EDITABLE_STATUS: readonly ElectionStatus[] = ["DRAFT", "NOMINATIONS", "READY"];

export const ACCESS = ["PUBLIC", "INVITE"] as const;
export type Access = (typeof ACCESS)[number];

export const ROUTES = ["EMAIL_CODE", "LINK", "ACCOUNT", "DISCORD", "CODE"] as const;
export type Route = (typeof ROUTES)[number];

export const TRANSPARENCY = ["SECRET", "WHO_VOTED", "SHOW_OF_HANDS"] as const;
export type Transparency = (typeof TRANSPARENCY)[number];

export const RESULTS_MODE = ["SEALED", "LIVE"] as const;
export const DISTRICT_ASSIGN = ["NONE", "REGISTER", "SELF"] as const;
export type DistrictAssign = (typeof DISTRICT_ASSIGN)[number];
export const HELD_DEFAULT = ["WAIT", "ACCEPT", "REJECT"] as const;

export const METHODS = ["SINGLE", "MULTI", "YESNO", "RANKED", "SCORE", "PARTY_LIST"] as const;
export type Method = (typeof METHODS)[number];
export const SCOPES = ["NATIONAL", "PER_DISTRICT"] as const;
export type Scope = (typeof SCOPES)[number];

export const OPTION_KINDS = ["CHOICE", "YES", "NO"] as const;
export const OPTION_STATUS = ["APPROVED", "PENDING", "REJECTED", "WITHDRAWN"] as const;

export const ROLL_STATUS = ["INVITED", "CHECKED_IN", "VOTED", "HELD", "REJECTED", "BLOCKED"] as const;
export type RollStatus = (typeof ROLL_STATUS)[number];

export const BALLOT_STATUS = ["COUNTED", "HELD", "REJECTED", "SUPERSEDED"] as const;
export type BallotStatus = (typeof BALLOT_STATUS)[number];

// ── Contest rule ────────────────────────────────────────────────────────────

export const ContestRule = z.object({
  win: z.enum(["PLURALITY", "MAJORITY_RUNOFF"]).default("PLURALITY"),
  majorityPct: z.number().min(0).max(99).default(50),
  pr: z.enum(["DHONDT", "SAINTE_LAGUE", "HARE"]).default("DHONDT"),
  prThresholdPct: z.number().min(0).max(50).default(0),
  scoreMax: z.number().int().min(1).max(10).default(5),
  allowBlank: z.boolean().default(true),
  supportersRequired: z.number().int().min(0).max(1000).default(0),
});
export type ContestRule = z.infer<typeof ContestRule>;
export function parseRule(json: string | null | undefined): ContestRule {
  return ContestRule.parse(safeJson(json, {}));
}

// ── Fraud policy ────────────────────────────────────────────────────────────

export const SIGNALS = [
  "VPN",
  "TOR",
  "DATACENTER",
  "PROXY_API",
  "DEVICE_REPEAT",
  "DEVICE_SIMILAR",
  "IP_SHARED",
  "DISPOSABLE_EMAIL",
  "NO_MX",
  "TOO_FAST",
  "LOOKUP_FAILED",
] as const;
export type Signal = (typeof SIGNALS)[number];
export const ACTIONS = ["BLOCK", "HOLD", "IGNORE"] as const;
export type FraudAction = (typeof ACTIONS)[number];

export type FraudPolicy = { actions: Record<Signal, FraudAction>; ipSharedThreshold: number };

export function defaultPolicy(access: Access): FraudPolicy {
  const all = (a: FraudAction) => Object.fromEntries(SIGNALS.map((s) => [s, a])) as Record<Signal, FraudAction>;
  if (access === "INVITE") return { actions: { ...all("IGNORE"), DEVICE_REPEAT: "HOLD" }, ipSharedThreshold: 5 };
  return {
    actions: {
      VPN: "BLOCK",
      TOR: "BLOCK",
      PROXY_API: "BLOCK",
      DISPOSABLE_EMAIL: "BLOCK",
      NO_MX: "BLOCK",
      DEVICE_REPEAT: "BLOCK",
      DATACENTER: "HOLD",
      DEVICE_SIMILAR: "HOLD",
      IP_SHARED: "HOLD",
      TOO_FAST: "HOLD",
      LOOKUP_FAILED: "IGNORE",
    },
    ipSharedThreshold: 3,
  };
}

export function parsePolicy(json: string | null | undefined, access: Access): FraudPolicy {
  const base = defaultPolicy(access);
  const raw = safeJson(json, {}) as Partial<FraudPolicy>;
  const actions = { ...base.actions };
  for (const s of SIGNALS) {
    const v = raw.actions?.[s];
    if (v && (ACTIONS as readonly string[]).includes(v)) actions[s] = v;
  }
  const t = Number(raw.ipSharedThreshold);
  return { actions, ipSharedThreshold: Number.isFinite(t) && t >= 1 ? Math.floor(t) : base.ipSharedThreshold };
}

// ── Notices an election sends ───────────────────────────────────────────────

export const NOTICE_KEYS = ["announce", "invite", "opened", "closingSoon", "result", "envelope", "heldDigest"] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];
export type NoticeSwitches = Record<NoticeKey, boolean> & { closingSoonMinutes: number };
export function parseNotices(json: string | null | undefined): NoticeSwitches {
  const raw = safeJson(json, {}) as Partial<NoticeSwitches>;
  const out = Object.fromEntries(NOTICE_KEYS.map((k) => [k, raw[k] !== false])) as Record<NoticeKey, boolean>;
  const m = Number(raw.closingSoonMinutes);
  return { ...out, closingSoonMinutes: Number.isFinite(m) && m >= 0 ? m : 60 };
}

// ── Brand pack ──────────────────────────────────────────────────────────────

export const BRAND_COLORS = ["curtain", "curtainLight", "wood", "shelf", "brass", "ink", "wax", "box"] as const;
export type BrandColor = (typeof BRAND_COLORS)[number];
export type Brand = {
  crestUploadId: string | null;
  colors: Record<BrandColor, string>;
  tints: string[];
  words: Record<string, string>;
};
export const DEFAULT_BRAND: Brand = {
  crestUploadId: null,
  colors: {
    curtain: "#1b3826",
    curtainLight: "#2d5a3e",
    wood: "#6d4a2b",
    shelf: "#b48a57",
    brass: "#c9a14a",
    ink: "#23201c",
    wax: "#9b1f18",
    box: "#1f3b2b",
  },
  tints: ["#f6f1e4", "#f3e7b5", "#dbe6ee", "#e6dcef", "#dcecd8", "#f3d9d2"],
  words: {},
};
const HEX = /^#[0-9a-fA-F]{6}$/;
export function parseBrand(json: string | null | undefined): Brand {
  const raw = safeJson(json, {}) as Partial<Brand>;
  const colors = { ...DEFAULT_BRAND.colors };
  for (const k of BRAND_COLORS) if (typeof raw.colors?.[k] === "string" && HEX.test(raw.colors[k])) colors[k] = raw.colors[k];
  const tints = Array.isArray(raw.tints) ? raw.tints.filter((t) => typeof t === "string" && HEX.test(t)).slice(0, 12) : [];
  const words: Record<string, string> = {};
  if (raw.words && typeof raw.words === "object") for (const [k, v] of Object.entries(raw.words)) if (typeof v === "string") words[k] = v.slice(0, 200);
  return {
    crestUploadId: typeof raw.crestUploadId === "string" ? raw.crestUploadId : null,
    colors,
    tints: tints.length ? tints : DEFAULT_BRAND.tints,
    words,
  };
}

// ── Ballot marks ────────────────────────────────────────────────────────────

export type Mark = { x: string[] } | { r: string[] } | { s: Record<string, number> };

export function safeJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function parseRoutes(json: string | null | undefined): Route[] {
  const raw = safeJson<unknown[]>(json, []);
  return ROUTES.filter((r) => raw.includes(r));
}
