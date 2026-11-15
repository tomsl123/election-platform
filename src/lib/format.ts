export function fmtDateTime(d: Date | null | undefined, timeZone: string): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(d);
}

export function fmtDate(d: Date | null | undefined, timeZone: string): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone }).format(d);
}

export function fmtTime(d: Date | null | undefined, timeZone: string): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function duration(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 48) return m ? `${plural(h, "hour")} ${m} min` : plural(h, "hour");
  return plural(Math.round(h / 24), "day");
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "";
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

/** Appends a notice to a path so the next page can show it once. */
export function withNotice(path: string, kind: "ok" | "err", message: string): string {
  const [base, hash = ""] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${kind}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}

// ── Site-time helpers: every time in the app is shown and entered in the site's time zone ──

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/** "2026-11-20T14:30" as wall-clock time in `timeZone`, converted to an instant. */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = wall - zoneOffsetMs(wall, timeZone);
  utc = wall - zoneOffsetMs(utc, timeZone); // second pass settles daylight-saving edges
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** An instant as a value for <input type="datetime-local">, in `timeZone`. */
export function toLocalInput(d: Date | null | undefined, timeZone: string): string {
  if (!d) return "";
  const shifted = new Date(d.getTime() + zoneOffsetMs(d.getTime(), timeZone));
  return shifted.toISOString().slice(0, 16);
}
