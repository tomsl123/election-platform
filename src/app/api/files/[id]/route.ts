import { db } from "@/lib/db";
import { readStored } from "@/lib/uploads";

export const dynamic = "force-dynamic";

// Uploaded images are public (crests and candidate photos appear on public pages).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.upload.findUnique({ where: { id } });
  if (!row) return new Response("Not found", { status: 404 });
  try {
    const body = await readStored(row.storedName);
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": row.mime,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
