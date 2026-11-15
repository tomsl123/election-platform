// What the desk learns about the voter's browser: a random id it keeps (in storage and a cookie,
// each restoring the other) and a fingerprint of how it draws and what it reports.
// The server keeps only keyed hashes of both.

const KEY = "ps-device";
const COOKIE = "ps_device";

function readCookie(): string {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function deviceId(): string {
  let id = "";
  try {
    id = localStorage.getItem(KEY) ?? "";
  } catch {
    /* storage blocked */
  }
  if (!/^[\w-]{16,64}$/.test(id)) id = readCookie();
  if (!/^[\w-]{16,64}$/.test(id)) id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage blocked */
  }
  document.cookie = `${COOKIE}=${encodeURIComponent(id)}; Max-Age=${2 * 365 * 86400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return id;
}

function canvasPrint(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 60;
    const g = c.getContext("2d");
    if (!g) return "";
    g.textBaseline = "top";
    g.font = "16px 'Arial'";
    g.fillStyle = "#f60";
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = "#069";
    g.fillText("Free Cliffs ✓ 1.2.3", 2, 15);
    g.fillStyle = "rgba(102, 204, 0, 0.7)";
    g.fillText("Free Cliffs ✓ 1.2.3", 4, 17);
    return c.toDataURL();
  } catch {
    return "";
  }
}

function webglPrint(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${vendor}|${renderer}`;
  } catch {
    return "";
  }
}

async function sha256(s: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

export type DeviceEvidence = { deviceId: string; fp: string };

let cached: Promise<DeviceEvidence> | null = null;

export function deviceEvidence(): Promise<DeviceEvidence> {
  cached ??= (async () => {
    const n = navigator as Navigator & { deviceMemory?: number };
    const parts = [
      canvasPrint(),
      webglPrint(),
      `${screen.width}x${screen.height}x${screen.colorDepth}@${devicePixelRatio}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      (navigator.languages ?? [navigator.language]).join(","),
      navigator.platform,
      String(navigator.hardwareConcurrency ?? ""),
      String(n.deviceMemory ?? ""),
      String(navigator.maxTouchPoints ?? 0),
    ];
    return { deviceId: deviceId(), fp: await sha256(parts.join("§")) };
  })();
  return cached;
}
