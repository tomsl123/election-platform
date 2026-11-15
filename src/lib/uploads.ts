// Image uploads (crests, candidate photos). Adapted from USFC Parliament's uploads.ts:
// images only, 2 MB, checked by their first bytes, stored under random names.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "./db";
import { Problem } from "./problem";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function uploadDir(): string {
  return resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.UPLOAD_DIR || "./data/uploads");
}

/** Decides the type from the file's own bytes; the browser's claim is ignored. SVG is refused (it can carry script). */
function sniff(b: Buffer): string | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function storeImage(orgId: string, file: File) {
  if (!file || file.size === 0) throw new Problem("That file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Problem("Images may be at most 2 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) throw new Problem("Only PNG, JPEG and WebP images are accepted.");
  const storedName = randomBytes(20).toString("hex");
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(resolve(uploadDir(), storedName), bytes, { flag: "wx" });
  return db.upload.create({
    data: { orgId, storedName, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
  });
}

export async function readStored(storedName: string): Promise<Buffer> {
  if (!/^[a-f0-9]{40}$/.test(storedName)) throw new Error("Bad storage key.");
  return readFile(resolve(uploadDir(), storedName));
}

export async function removeStored(storedName: string) {
  if (!/^[a-f0-9]{40}$/.test(storedName)) return;
  await unlink(resolve(uploadDir(), storedName)).catch(() => undefined);
}
