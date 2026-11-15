import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { electionInclude, isEditable, openProblems } from "@/lib/elections";
import { fmtDateTime } from "@/lib/format";
import { orgUctv } from "@/lib/org";
import { Sheet, StatusStamp } from "@/components/office/ui";
import { ConfirmSubmit, LiveRefresh, Submit } from "@/components/office/client";
import { runAction } from "../../actions";

export const metadata = { title: "Polling day" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org, role } = await requireOffice(slug);
  const e = await db.election.findFirst({ where: { id, orgId: org.id }, include: electionInclude });
  if (!e) notFound();
  const officer = atLeast(role, "OFFICER");
  const [problems, byStatus, envelopes, ballots] = await Promise.all([
    isEditable(e) ? openProblems(e) : Promise.resolve([]),
    db.rollEntry.groupBy({ by: ["status"], where: { electionId: e.id }, _count: true }),
    db.envelope.count({ where: { electionId: e.id, status: "HELD" } }),
    db.ballot.count({ where: { electionId: e.id, status: { in: ["COUNTED", "HELD"] } } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const roll = byStatus.reduce((n, b) => n + b._count, 0);
  const voted = count("VOTED") + count("HELD");
  const tz = org.timezone;
  const hidden = (
    <>
      <input type="hidden" name="org" value={org.slug} />
      <input type="hidden" name="id" value={e.id} />
    </>
  );
  const station = `/o/${org.slug}/e/${e.slug}`;
  return (
    <>
      <LiveRefresh electionId={e.id} />
      <div className="grid2">
        <Sheet title={<h2>The polls</h2>} aside={<StatusStamp status={e.status} big />}>
          <p>
            {e.openedAt ? `Opened ${fmtDateTime(e.openedAt, tz)}.` : e.opensAt ? `Opens ${fmtDateTime(e.opensAt, tz)}${e.status === "READY" ? "" : " once scheduled"}.` : "Opens by hand."}{" "}
            {e.closedAt ? `Closed ${fmtDateTime(e.closedAt, tz)}.` : e.closesAt ? `Closes ${fmtDateTime(e.closesAt, tz)}.` : "Closes by hand."}
          </p>
          <p className="small">
            Polling station: <Link href={station}>{station}</Link>
          </p>
          {problems.length ? (
            <>
              <p className="cap" style={{ marginTop: 12 }}>
                Before the polls can open
              </p>
              <ul className="problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          ) : null}
          {officer ? (
            <form action={runAction} className="row" style={{ marginTop: 16 }}>
              {hidden}
              {e.status === "DRAFT" ? (
                <Submit className="btn ghost" name="op" value="nominationsOpen">
                  Open nominations
                </Submit>
              ) : null}
              {e.status === "NOMINATIONS" ? (
                <Submit className="btn" name="op" value="nominationsClose">
                  Close nominations
                </Submit>
              ) : null}
              {isEditable(e) ? (
                <>
                  {e.status === "READY" ? (
                    <Submit className="btn ghost" name="op" value="unschedule">
                      Back to draft
                    </Submit>
                  ) : e.opensAt ? (
                    <Submit className="btn" name="op" value="schedule" disabled={problems.length > 0}>
                      Schedule
                    </Submit>
                  ) : null}
                  <ConfirmSubmit confirm="Open the polls now?" name="op" value="open" className="btn primary">
                    Open the polls now
                  </ConfirmSubmit>
                </>
              ) : null}
              {e.status === "OPEN" ? (
                <ConfirmSubmit confirm="Close and count now?" name="op" value="close" className="btn danger">
                  Close the polls
                </ConfirmSubmit>
              ) : null}
              {e.status === "CLOSED" ? (
                <Submit className="btn primary" name="op" value="count">
                  Count
                </Submit>
              ) : null}
              {e.status === "COUNTED" ? (
                <ConfirmSubmit confirm="Certify the result?" name="op" value="certify" className="btn primary">
                  Certify the result
                </ConfirmSubmit>
              ) : null}
              {["COUNTED", "CERTIFIED"].includes(e.status) && orgUctv(org).enabled && e.uctvElectionId !== undefined ? (
                <Submit className="btn" name="op" value="uctv">
                  Send to UCTV
                </Submit>
              ) : null}
              {!["COUNTED", "CERTIFIED", "CANCELLED"].includes(e.status) ? (
                <ConfirmSubmit confirm="Cancel the election?" name="op" value="cancel" className="btn sm ghost">
                  Cancel the election
                </ConfirmSubmit>
              ) : null}
            </form>
          ) : null}
        </Sheet>
        <Sheet title={<h2>Turnout</h2>}>
          <table className="ledger">
            <tbody>
              {e.access === "INVITE" ? (
                <tr>
                  <td>On the roll</td>
                  <td className="num">{roll}</td>
                </tr>
              ) : null}
              <tr>
                <td>Voted</td>
                <td className="num">
                  <b>{voted}</b>
                  {e.access === "INVITE" && roll ? <span className="muted small"> ({Math.round((voted / roll) * 100)}%)</span> : null}
                </td>
              </tr>
              <tr>
                <td>In the booth now</td>
                <td className="num">{count("CHECKED_IN")}</td>
              </tr>
              <tr>
                <td>Held in envelopes</td>
                <td className="num">
                  {envelopes ? <Link href="held">{envelopes}</Link> : 0}
                </td>
              </tr>
              <tr>
                <td>Refused at the door</td>
                <td className="num">{count("BLOCKED")}</td>
              </tr>
              <tr>
                <td>Ballots in the box</td>
                <td className="num">{ballots}</td>
              </tr>
            </tbody>
          </table>
        </Sheet>
      </div>
    </>
  );
}
