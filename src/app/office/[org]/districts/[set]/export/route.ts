import { db } from "@/lib/db";
import { requireOffice } from "@/lib/auth";
import { slugify } from "@/lib/action";
import { toDistrictCsv, toDistrictFile } from "@/lib/district-file";

export const dynamic = "force-dynamic";

// A district set as a file: JSON (with counties and map, for UCTV) or CSV (code,name,seats,county).
export async function GET(req: Request, { params }: { params: Promise<{ org: string; set: string }> }) {
  const { org: slug, set: setId } = await params;
  const { org } = await requireOffice(slug);
  const set = await db.districtSet.findFirst({ where: { id: setId, orgId: org.id }, include: { districts: { orderBy: { position: "asc" } } } });
  if (!set) return new Response("No such set.", { status: 404 });
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const name = `${slugify(set.name) || "districts"}.${csv ? "csv" : "json"}`;
  // A set without a map leaves `map` out (UCTV reads a missing map, not a null one).
  const file = toDistrictFile(set);
  const body = csv ? toDistrictCsv(set) : JSON.stringify(file.map ? file : { ...file, map: undefined }, null, 1);
  return new Response(body, {
    headers: { "content-type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
