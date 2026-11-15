import { db } from "@/lib/db";
import { requireOffice } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Empty, Sheet } from "@/components/office/ui";

export const metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

export default async function JournalPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ before?: string }> }) {
  const { org: slug } = await params;
  const { before } = await searchParams;
  const { org } = await requireOffice(slug);
  const cursor = Number(before) || undefined;
  const rows = await db.auditLog.findMany({ where: { orgId: org.id, ...(cursor ? { seq: { lt: cursor } } : {}) }, orderBy: { seq: "desc" }, take: 100 });
  return (
    <Sheet title="Journal" lede="Every act of the office, chained by hash. Ballot choices of secret votes never appear here.">
      {rows.length === 0 ? (
        <Empty>Nothing written yet.</Empty>
      ) : (
        <div className="ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th className="num">No.</th>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seq}>
                  <td className="num mono small">{r.seq}</td>
                  <td className="small">{fmtDateTime(r.at, org.timezone)}</td>
                  <td>{r.actorLabel}</td>
                  <td className="mono small">{r.action}</td>
                  <td className="small muted" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.details === "{}" ? "" : r.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 100 ? (
        <p style={{ marginTop: 12 }}>
          <a href={`?before=${rows[rows.length - 1].seq}`}>Older entries</a>
        </p>
      ) : null}
    </Sheet>
  );
}
