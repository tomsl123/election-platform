import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { isEditable } from "@/lib/elections";
import { fmtDateTime } from "@/lib/format";
import { parseRoutes } from "@/lib/types";
import { Empty, Field, Sheet, StatusStamp } from "@/components/office/ui";
import { ConfirmSubmit, CopyText, Submit } from "@/components/office/client";
import { rollAction } from "../../actions";

export const metadata = { title: "Roll" };
export const dynamic = "force-dynamic";

const PAGE = 200;

export default async function RollPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ link?: string; line?: string; q?: string; page?: string }> }) {
  const { org: slug, id } = await params;
  const sp = await searchParams;
  const { org, role } = await requireOffice(slug);
  const e = await db.election.findFirst({ where: { id, orgId: org.id } });
  if (!e) notFound();
  const editable = isEditable(e) && atLeast(role, "OFFICER");
  const routes = parseRoutes(e.routes);
  const page = Math.max(0, Number(sp.page) || 0);
  const where = { electionId: e.id, ...(sp.q ? { displayName: { contains: sp.q } } : {}) };
  const [lines, total, byStatus, districts, batches] = await Promise.all([
    db.rollEntry.findMany({ where, orderBy: [{ status: "asc" }, { displayName: "asc" }], take: PAGE, skip: page * PAGE }),
    db.rollEntry.count({ where }),
    db.rollEntry.groupBy({ by: ["status"], where: { electionId: e.id }, _count: true }),
    e.districtSetId ? db.district.findMany({ where: { setId: e.districtSetId }, orderBy: { position: "asc" } }) : Promise.resolve([]),
    db.accessCode.groupBy({ by: ["batch", "label", "districtId"], where: { electionId: e.id }, _count: true }),
  ]);
  const usedByBatch = await db.accessCode.groupBy({ by: ["batch"], where: { electionId: e.id, usedAt: { not: null } }, _count: true });
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const districtName = (did: string | null) => districts.find((d) => d.id === did)?.name ?? "";
  const hidden = (extra: Record<string, string> = {}) => (
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
      <Sheet
        title={<h2>{e.access === "INVITE" ? "The roll" : "Register of voters"}</h2>}
        lede={
          e.access === "INVITE"
            ? e.rollPublishedAt
              ? `Published ${fmtDateTime(e.rollPublishedAt, org.timezone)}.`
              : "Not published yet: nobody has been told."
            : "Public election: a line is written here for each person who checks in at the desk."
        }
        aside={
          <span className="row small">
            <span className="pill">{total} lines</span>
            <span className="pill">{count("VOTED")} voted</span>
            {count("HELD") ? <span className="pill">{count("HELD")} held</span> : null}
            {count("BLOCKED") ? <span className="pill">{count("BLOCKED")} refused</span> : null}
          </span>
        }
      >
        {sp.link ? (
          <div className="memo" style={{ marginBottom: 14 }}>
            <b>Link</b>
            <code style={{ wordBreak: "break-all" }}>{sp.link}</code> <CopyText text={sp.link} />
          </div>
        ) : null}
        <form className="row" style={{ marginBottom: 10 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Find a name</span>
            <input name="q" defaultValue={sp.q} />
          </label>
          <button className="btn sm">Find</button>
        </form>
        {lines.length === 0 ? (
          <Empty>{e.access === "INVITE" ? "Nobody on the roll yet." : "Nobody has checked in yet."}</Empty>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>E-mail</th>
                  {districts.length ? <th>District</th> : null}
                  <th>Way in</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={l.nameStruck ? "struck" : ""} style={sp.line === l.id ? { background: "#fbf0a8" } : undefined}>
                    <td>{l.displayName || <span className="muted">—</span>}</td>
                    <td className="small mono">{l.emailMasked}</td>
                    {districts.length ? <td className="small">{districtName(l.districtId)}</td> : null}
                    <td className="small">{l.route.replace("_", " ").toLowerCase()}</td>
                    <td>
                      <StatusStamp status={l.status} />
                    </td>
                    <td className="num">
                      <form action={rollAction} className="row end">
                        {hidden({ line: l.id })}
                        {e.access === "INVITE" && routes.includes("LINK") && atLeast(role, "OFFICER") && ["INVITED", "CHECKED_IN"].includes(l.status) && e.status !== "CLOSED" ? (
                          <Submit className="btn sm ghost" name="op" value="link">
                            Link
                          </Submit>
                        ) : null}
                        {editable && l.status === "INVITED" ? (
                          <ConfirmSubmit confirm="Remove?" name="op" value="remove">
                            Remove
                          </ConfirmSubmit>
                        ) : null}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE ? (
          <p className="row" style={{ marginTop: 10 }}>
            {page > 0 ? <Link href={`?page=${page - 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>← Earlier</Link> : null}
            {(page + 1) * PAGE < total ? <Link href={`?page=${page + 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>Later →</Link> : null}
          </p>
        ) : null}
      </Sheet>

      {e.access === "INVITE" && editable ? (
        <div className="grid2">
          <Sheet title={<h2>Add voters</h2>}>
            <form action={rollAction} className="stack">
              {hidden({ op: "register" })}
              <p className="small muted">Everyone active on the organisation&apos;s register, or only one district.</p>
              <div className="row">
                {districts.length ? (
                  <select name="districtId" aria-label="District" defaultValue="">
                    <option value="">Every district</option>
                    {districts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Submit className="btn">From the register</Submit>
              </div>
            </form>
            <hr className="rule" />
            <form action={rollAction} className="stack">
              {hidden({ op: "csv" })}
              <Field label="Paste a list" hint="One per line: e-mail, name, district (code or name)">
                <textarea name="csv" rows={4} placeholder={"tudlenudle@usfc.test, Tudlenudle, DEAD"} />
              </Field>
              <Field label="Or a CSV file">
                <input type="file" name="file" accept=".csv,text/csv,text/plain" />
              </Field>
              <div className="row end">
                <Submit className="btn">Add to the roll</Submit>
              </div>
            </form>
          </Sheet>
          <div className="stack" style={{ gap: 20 }}>
            {routes.includes("CODE") ? (
              <Sheet title={<h2>Code cards</h2>} lede="Each card lets one person in once. Hand them out, or message them.">
                {batches.length ? (
                  <table className="ledger" style={{ marginBottom: 12 }}>
                    <tbody>
                      {batches.map((b) => (
                        <tr key={b.batch + (b.districtId ?? "")}>
                          <td>
                            {b.label || b.batch} <span className="small muted">{districtName(b.districtId)}</span>
                          </td>
                          <td className="num small">
                            {b._count} cards · {usedByBatch.find((u) => u.batch === b.batch)?._count ?? 0} used
                          </td>
                          <td className="num">
                            <form action={rollAction} className="row end">
                              {hidden({ batch: b.batch })}
                              <Link className="btn sm ghost" href={`roll/cards?batch=${encodeURIComponent(b.batch)}`}>
                                Print
                              </Link>
                              <ConfirmSubmit confirm="Destroy unused?" name="op" value="dropBatch">
                                Destroy
                              </ConfirmSubmit>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                <form action={rollAction} className="fields">
                  {hidden({ op: "codes" })}
                  <Field label="How many">
                    <input name="count" type="number" min={1} max={2000} defaultValue={20} />
                  </Field>
                  <Field label="Label" hint="For you, e.g. the place they go">
                    <input name="label" placeholder="Cliffside Acres hall" />
                  </Field>
                  {districts.length ? (
                    <Field label="District">
                      <select name="districtId" defaultValue="">
                        <option value="">None</option>
                        {districts.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <div className="row end" style={{ alignSelf: "end" }}>
                    <Submit className="btn">Make cards</Submit>
                  </div>
                </form>
              </Sheet>
            ) : null}
            <Sheet title={<h2>Publish</h2>} lede="Tells every voter on the roll how to get in. Their links work once the polls open.">
              <form action={rollAction} className="row between">
                {hidden()}
                <ConfirmSubmit confirm="Empty the whole roll?" name="op" value="clear" className="btn sm ghost">
                  Empty the roll
                </ConfirmSubmit>
                <Submit name="op" value="publish">
                  {e.rollPublishedAt ? "Send the invitations again" : "Publish the roll"}
                </Submit>
              </form>
            </Sheet>
          </div>
        </div>
      ) : null}
    </>
  );
}
