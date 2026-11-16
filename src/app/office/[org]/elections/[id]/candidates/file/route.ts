import { requireOffice } from "@/lib/auth";
import { imageSources, loadCandidateReport, loadReportImages, renderReportCsv, renderReportDocument, reportFileName } from "@/lib/candidate-report";

export const dynamic = "force-dynamic";

// The candidates report as a file: a standalone HTML document with its photos inside (?format=html, the default)
// or a CSV with one row per candidate (?format=csv).
export async function GET(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org } = await requireOffice(slug);
  const r = await loadCandidateReport(org, id);
  if (!r) return new Response("No such election.", { status: 404 });
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const body = csv ? renderReportCsv(r) : renderReportDocument(r, imageSources.embedded(await loadReportImages(r, org.id)));
  return new Response(body, {
    headers: {
      "content-type": csv ? "text/csv; charset=utf-8" : "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${reportFileName(r, csv ? "csv" : "html")}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
