import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { fmtDateTime } from "@/lib/format";
import { localVerdict } from "@/lib/ipintel";
import { SIGNALS } from "@/lib/types";
import { Empty, Sheet, Stamp, StatusStamp } from "@/components/office/ui";
import { LiveRefresh, Submit } from "@/components/office/client";
import { envelopeAction } from "./actions";

export const metadata = { title: "Held" };
export const dynamic = "force-dynamic";

const REASON: Record<string, string> = {
  VPN: "VPN",
  TOR: "Tor",
  DATACENTER: "datacenter",
  PROXY_API: "proxy",
  DEVICE_REPEAT: "same device",
  DEVICE_SIMILAR: "similar device",
  IP_SHARED: "shared address",
  DISPOSABLE_EMAIL: "throwaway e-mail",
  NO_MX: "dead domain",
  TOO_FAST: "too fast",
  LOOKUP_FAILED: "lookup failed",
};

export default async function HeldPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org, role } = await requireOffice(slug);
  const e = await db.election.findFirst({ where: { id, orgId: org.id } });
  if (!e) notFound();
  const officer = atLeast(role, "OFFICER") && ["OPEN", "CLOSED"].includes(e.status);
  const envelopes = await db.envelope.findMany({ where: { electionId: e.id }, orderBy: [{ status: "asc" }, { createdAt: "asc" }], take: 500 });
  const lines = await db.rollEntry.findMany({ where: { id: { in: envelopes.map((x) => x.rollEntryId) } } });
  const lineOf = new Map(lines.map((l) => [l.id, l]));
  const held = envelopes.filter((x) => x.status === "HELD");
  const decided = envelopes.filter((x) => x.status !== "HELD");
  const reasonsPresent = SIGNALS.filter((s) => held.some((x) => (JSON.parse(x.reasons) as string[]).includes(s)));

  const cards = await Promise.all(
    held.map(async (env) => {
      const line = lineOf.get(env.rollEntryId);
      const ip = decrypt(line?.ipEnc) ?? "";
      const verdict = ip ? await localVerdict(ip) : null;
      const sameIp = line?.ipHash ? await db.rollEntry.count({ where: { electionId: e.id, ipHash: line.ipHash, NOT: { id: line.id } } }) : 0;
      const sameDevice = line?.deviceId ? await db.rollEntry.count({ where: { electionId: e.id, deviceId: line.deviceId, NOT: { id: line.id } } }) : 0;
      return { env, line, ip, verdict, sameIp, sameDevice, reasons: JSON.parse(env.reasons) as string[] };
    }),
  );
  const hidden = (extra: Record<string, string>) => (
    <>
      <input type="hidden" name="org" value={org.slug} />
      <input type="hidden" name="id" value={e.id} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );

  return (
    <>
      {e.status === "OPEN" ? <LiveRefresh electionId={e.id} /> : null}
      <Sheet
        title={<h2>The tray of held envelopes</h2>}
        lede="Each envelope holds one visit's ballots, sealed. You see who came and why they were held; never what they marked. Count it, or set it aside."
        aside={<span className="pill">{held.length} waiting</span>}
      >
        {officer && reasonsPresent.length ? (
          <form action={envelopeAction} className="row" style={{ marginBottom: 16 }}>
            {hidden({})}
            <span className="cap">Every envelope held for</span>
            <select name="reason" aria-label="Reason">
              <option value="ANY">any reason</option>
              {reasonsPresent.map((r) => (
                <option key={r} value={r}>
                  {REASON[r]}
                </option>
              ))}
            </select>
            <Submit className="btn sm primary" name="op" value="acceptAll">
              Count them
            </Submit>
            <Submit className="btn sm danger" name="op" value="rejectAll">
              Set them aside
            </Submit>
          </form>
        ) : null}
        {cards.length === 0 ? <Empty>The tray is empty.</Empty> : null}
        <div className="tray-grid">
          {cards.map(({ env, line, ip, verdict, sameIp, sameDevice, reasons }) => (
            <article key={env.id} className="envelope-card">
              <div className="flap" aria-hidden="true" />
              <div className="row between">
                <b>{line?.displayName || <span className="muted">no name</span>}</b>
                <span className="small muted">{fmtDateTime(env.createdAt, org.timezone)}</span>
              </div>
              <div className="small mono">{line?.emailMasked || line?.route.toLowerCase()}</div>
              <div className="row" style={{ gap: 6 }}>
                {reasons.map((r) => (
                  <Stamp key={r} tone="red">
                    {REASON[r] ?? r}
                  </Stamp>
                ))}
              </div>
              <dl className="facts">
                <dt>Way in</dt>
                <dd>{line?.route.replace("_", " ").toLowerCase()}</dd>
                {ip ? (
                  <>
                    <dt>Address</dt>
                    <dd className="mono">
                      {ip} {verdict?.tor ? "· Tor" : ""} {verdict?.vpn ? "· VPN" : ""} {verdict?.hosting ? "· datacenter" : ""}
                    </dd>
                  </>
                ) : null}
                <dt>Others on it</dt>
                <dd>
                  {sameIp} on this address · {sameDevice} on this device
                </dd>
              </dl>
              {officer ? (
                <form action={envelopeAction} className="row between">
                  {hidden({ envelope: env.id })}
                  <input name="note" placeholder="Note (sent if set aside)" aria-label="Note" style={{ flex: 1, minWidth: 120, font: "inherit", fontSize: 13, border: 0, borderBottom: "1px solid rgba(0,0,0,.4)", background: "transparent" }} />
                  <Submit className="btn sm primary" name="op" value="accept">
                    Count
                  </Submit>
                  <Submit className="btn sm danger" name="op" value="reject">
                    Set aside
                  </Submit>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </Sheet>
      {decided.length ? (
        <Sheet title={<h2>Decided</h2>}>
          <table className="ledger">
            <tbody>
              {decided.map((env) => (
                <tr key={env.id}>
                  <td>{lineOf.get(env.rollEntryId)?.displayName || "—"}</td>
                  <td className="small">{(JSON.parse(env.reasons) as string[]).map((r) => REASON[r] ?? r).join(", ")}</td>
                  <td>
                    <StatusStamp status={env.status} />
                  </td>
                  <td className="small muted">{fmtDateTime(env.decidedAt, org.timezone)}</td>
                  <td className="small muted">{env.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      ) : null}
    </>
  );
}
