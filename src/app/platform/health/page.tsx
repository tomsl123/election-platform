import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { schedulerStatus } from "@/lib/scheduler";
import { listStatus } from "@/lib/ipintel";
import { fmtDateTime } from "@/lib/format";
import { Empty, Sheet, StatusStamp } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { refreshListsAction, retryOutboxAction, verifyJournalAction } from "../actions";

export const metadata = { title: "Health" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Prague";

export default async function HealthPage() {
  const tick = schedulerStatus();
  const settings = await getSettings(true);
  const lists = listStatus();
  const [pending, failed, recent] = await Promise.all([
    db.outbox.count({ where: { status: "PENDING" } }),
    db.outbox.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.auditLog.count(),
  ]);
  return (
    <>
      <div className="grid2">
        <Sheet title={<h2>The clock</h2>}>
          {tick ? (
            <p>
              Last tick {fmtDateTime(tick.at, TZ)}. {tick.error ? <span style={{ color: "var(--o-red)" }}>{tick.error}</span> : "No errors."}
            </p>
          ) : (
            <p className="muted">Not started yet.</p>
          )}
          <form action={verifyJournalAction} className="row">
            <span className="muted small">{recent} journal entries.</span>
            <Submit className="btn sm">Verify the journal</Submit>
          </form>
        </Sheet>
        <Sheet title={<h2>IP lists</h2>}>
          <p className="small">
            Tor {lists.tor} · VPN {lists.vpn} · datacenter {lists.datacenter} ranges loaded.
            {settings.iplists.lastRefresh ? ` Refreshed ${fmtDateTime(new Date(settings.iplists.lastRefresh), TZ)}.` : " Never refreshed."}
          </p>
          {settings.iplists.lastError ? <p className="small" style={{ color: "var(--o-red)" }}>{settings.iplists.lastError}</p> : null}
          <form action={refreshListsAction}>
            <Submit className="btn sm">Refresh now</Submit>
          </form>
        </Sheet>
      </div>
      <Sheet title={<h2>Outbox</h2>} lede={`${pending} waiting.`} aside={failed.length ? <form action={retryOutboxAction}><Submit className="btn sm">Retry failed</Submit></form> : null}>
        {failed.length === 0 ? (
          <Empty>No failed messages.</Empty>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Channel</th>
                  <th>Subject</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((f) => (
                  <tr key={f.id}>
                    <td className="small">{fmtDateTime(f.createdAt, TZ)}</td>
                    <td>
                      <StatusStamp status="REJECTED" label={f.channel} />
                    </td>
                    <td>{f.subject}</td>
                    <td className="small muted">{f.lastError}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>
    </>
  );
}
