import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { Empty, Field, Sheet, StatusStamp } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { registerAction } from "../standing-actions";

export const metadata = { title: "Register" };
export const dynamic = "force-dynamic";

const PAGE = 200;

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const { org, role } = await requireOffice(slug);
  const officer = atLeast(role, "OFFICER");
  const page = Math.max(0, Number(sp.page) || 0);
  const where = { orgId: org.id, ...(sp.q ? { OR: [{ displayName: { contains: sp.q } }, { email: { contains: sp.q.toLowerCase() } }] } : {}) };
  const [entries, total, sets] = await Promise.all([
    db.registerEntry.findMany({ where, orderBy: { displayName: "asc" }, include: { districts: true }, take: PAGE, skip: page * PAGE }),
    db.registerEntry.count({ where }),
    db.districtSet.findMany({ where: { orgId: org.id }, include: { districts: { orderBy: { position: "asc" } } } }),
  ]);
  const districtOf = (e: (typeof entries)[number], setId: string) => e.districts.find((d) => d.setId === setId)?.districtId ?? "";
  const DistrictFields = ({ e }: { e?: (typeof entries)[number] }) => (
    <>
      {sets.map((s) => (
        <Field key={s.id} label={s.name}>
          <select name={`district.${s.id}`} defaultValue={e ? districtOf(e, s.id) : ""}>
            <option value="">—</option>
            {s.districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      ))}
    </>
  );
  return (
    <>
      <Sheet title="Register" lede="The organisation's standing list of voters. Invite-only elections build their roll from it; a person's district comes from here." aside={<span className="pill">{total} registered</span>}>
        <form className="row" style={{ marginBottom: 10 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Find</span>
            <input name="q" defaultValue={sp.q} />
          </label>
          <button className="btn sm">Find</button>
        </form>
        {entries.length === 0 ? <Empty>Nobody registered.</Empty> : null}
        {entries.map((e) => (
          <details key={e.id} className="opt">
            <summary>
              <span />
              <span style={e.status === "STRUCK" ? { textDecoration: "line-through", color: "var(--o-soft)" } : undefined}>
                {e.displayName} <span className="small muted mono">{e.email}</span>
                {sets.map((s) => {
                  const d = s.districts.find((x) => x.id === districtOf(e, s.id));
                  return d ? (
                    <span key={s.id} className="pill" style={{ marginLeft: 6 }}>
                      {d.code}
                    </span>
                  ) : null;
                })}
              </span>
              {e.status === "STRUCK" ? <StatusStamp status="STRUCK" /> : <span />}
            </summary>
            {officer ? (
              <div className="inner">
                <form action={registerAction} className="stack">
                  <input type="hidden" name="org" value={org.slug} />
                  <input type="hidden" name="entry" value={e.id} />
                  <div className="fields">
                    <Field label="Name">
                      <input name="displayName" defaultValue={e.displayName} required />
                    </Field>
                    <Field label="E-mail">
                      <input name="email" type="email" defaultValue={e.email ?? ""} />
                    </Field>
                    <Field label="Discord user id">
                      <input name="discordUserId" defaultValue={e.discordUserId ?? ""} inputMode="numeric" />
                    </Field>
                    <DistrictFields e={e} />
                    <Field label="Note">
                      <input name="note" defaultValue={e.note} />
                    </Field>
                  </div>
                  <div className="row between">
                    <Submit className="btn sm ghost" name="op" value={e.status === "STRUCK" ? "restore" : "strike"}>
                      {e.status === "STRUCK" ? "Restore" : "Strike off"}
                    </Submit>
                    <Submit name="op" value="save">
                      Save
                    </Submit>
                  </div>
                </form>
              </div>
            ) : null}
          </details>
        ))}
        {total > PAGE ? (
          <p className="row" style={{ marginTop: 10 }}>
            {page > 0 ? <a href={`?page=${page - 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>← Earlier</a> : null}
            {(page + 1) * PAGE < total ? <a href={`?page=${page + 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>Later →</a> : null}
          </p>
        ) : null}
      </Sheet>
      {officer ? (
        <div className="grid2">
          <Sheet title={<h2>Register someone</h2>}>
            <form action={registerAction} className="stack">
              <input type="hidden" name="org" value={org.slug} />
              <div className="fields">
                <Field label="Name">
                  <input name="displayName" required />
                </Field>
                <Field label="E-mail">
                  <input name="email" type="email" />
                </Field>
                <Field label="Discord user id">
                  <input name="discordUserId" inputMode="numeric" />
                </Field>
                <DistrictFields />
              </div>
              <div className="row end">
                <Submit name="op" value="add">
                  Register
                </Submit>
              </div>
            </form>
          </Sheet>
          <Sheet title={<h2>Import a list</h2>}>
            <form action={registerAction} className="stack">
              <input type="hidden" name="org" value={org.slug} />
              <Field label="Paste" hint="One per line: name, e-mail, district code, Discord id">
                <textarea name="csv" rows={4} placeholder="Tudlenudle, tudlenudle@usfc.test, DEAD" />
              </Field>
              <Field label="Or a CSV file">
                <input type="file" name="file" accept=".csv,text/csv,text/plain" />
              </Field>
              <div className="row end">
                <Submit name="op" value="import">
                  Import
                </Submit>
              </div>
            </form>
          </Sheet>
        </div>
      ) : null}
    </>
  );
}
