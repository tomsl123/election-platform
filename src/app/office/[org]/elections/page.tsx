import Link from "next/link";
import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Empty, Field, Sheet, StatusStamp } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { createElectionAction } from "./actions";

export const metadata = { title: "Elections" };
export const dynamic = "force-dynamic";

export default async function ElectionsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOffice(slug);
  const elections = await db.election.findMany({
    where: { orgId: org.id },
    orderBy: [{ createdAt: "desc" }],
    include: { _count: { select: { contests: true, roll: true } } },
  });
  return (
    <>
      <Sheet title="Elections" lede="Drafts, scheduled polls, open polls and the record of every count.">
        {elections.length === 0 ? (
          <Empty>No elections yet.</Empty>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Election</th>
                  <th>State</th>
                  <th>Opens</th>
                  <th>Closes</th>
                  <th className="num">Papers</th>
                  <th className="num">Roll</th>
                </tr>
              </thead>
              <tbody>
                {elections.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/office/${org.slug}/elections/${e.id}/setup`}>
                        <b>{e.title}</b>
                      </Link>
                      <div className="small muted">
                        {e.access === "INVITE" ? "invite only" : "public"} · {e.transparency.replace(/_/g, " ").toLowerCase()}
                        {e.round > 1 ? ` · round ${e.round}` : ""}
                      </div>
                    </td>
                    <td>
                      <StatusStamp status={e.status} />
                    </td>
                    <td className="small">{fmtDateTime(e.openedAt ?? e.opensAt, org.timezone) || "by hand"}</td>
                    <td className="small">{fmtDateTime(e.closedAt ?? e.closesAt, org.timezone) || "by hand"}</td>
                    <td className="num">{e._count.contests}</td>
                    <td className="num">{e._count.roll}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>
      {atLeast(role, "OFFICER") ? (
        <Sheet title={<h2>Draw up an election</h2>}>
          <form action={createElectionAction} className="fields">
            <input type="hidden" name="org" value={org.slug} />
            <Field label="Title">
              <input name="title" required placeholder="Federal Polling Day" />
            </Field>
            <Field label="Who may vote">
              <select name="access" defaultValue="PUBLIC">
                <option value="PUBLIC">The public (verified e-mail)</option>
                <option value="INVITE">Only those on the roll</option>
              </select>
            </Field>
            <div className="row end" style={{ alignSelf: "end" }}>
              <Submit>Draw up</Submit>
            </div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}
