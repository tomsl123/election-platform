import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { orgUctv } from "@/lib/org";
import { readCounties, readMap } from "@/lib/district-file";
import { lockedBy, readSource } from "@/lib/districts";
import { Empty, Field, Sheet } from "@/components/office/ui";
import { ConfirmSubmit, Submit } from "@/components/office/client";
import { HexMap, countyIndex, districtHue } from "@/components/HexMap";
import { districtAction, districtImportAction } from "../standing-actions";

export const metadata = { title: "Districts" };
export const dynamic = "force-dynamic";

const inline = { font: "inherit", border: 0, borderBottom: "1px solid #999", background: "transparent" } as const;

function ImportForms({ slug, setId, uctv }: { slug: string; setId: string | null; uctv: boolean }) {
  const hidden = (
    <>
      <input type="hidden" name="org" value={slug} />
      {setId ? <input type="hidden" name="set" value={setId} /> : null}
    </>
  );
  return (
    <div className="grid2" style={{ marginTop: 14 }}>
      <form action={districtImportAction} className="stack">
        {hidden}
        <Field label={setId ? "Import a file into this set" : "Or start from a file"} hint="District file or UCTV export (.json), or CSV: code, name, seats, county">
          <input type="file" name="file" accept=".json,.csv,application/json,text/csv,text/plain" />
        </Field>
        <details>
          <summary className="small muted">Paste instead</summary>
          <textarea name="text" rows={4} placeholder={"code,name,seats,county\nREL,Reliberated,50,North Reliberated"} style={{ width: "100%", marginTop: 8 }} />
        </details>
        <div className="row end">
          <Submit className="btn" name="op" value="stage">
            Preview
          </Submit>
        </div>
      </form>
      {uctv ? (
        <form action={districtImportAction} className="stack">
          {hidden}
          <Field label="From UCTV" hint="Races become districts, with their counties and the map drawn in UCTV.">
            <input name="uctvElectionId" placeholder="UCTV election id" required />
          </Field>
          <div className="row end">
            <Submit className="btn" name="op" value="pull">
              Preview
            </Submit>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default async function DistrictsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOffice(slug);
  const officer = atLeast(role, "OFFICER");
  const uctv = orgUctv(org).enabled;
  const sets = await db.districtSet.findMany({ where: { orgId: org.id }, include: { districts: { orderBy: { position: "asc" } } } });
  const members = await db.registerDistrict.groupBy({ by: ["districtId"], _count: true });
  const locks = Object.fromEntries(await Promise.all(sets.map(async (s) => [s.id, await lockedBy(s.id)] as const)));
  const hidden = (extra: Record<string, string>) => (
    <>
      <input type="hidden" name="org" value={org.slug} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
  return (
    <>
      {sets.length === 0 ? (
        <Sheet title="Districts" lede="Constituencies: voters belong to one district in each set, and per-district papers are counted per district.">
          <Empty>No district sets.</Empty>
        </Sheet>
      ) : null}
      {sets.map((s) => {
        const locked = locks[s.id] ?? [];
        const edit = officer && locked.length === 0;
        const counties = s.districts.map((d) => ({ ...d, list: readCounties(d.counties) }));
        const countyCount = counties.reduce((n, d) => n + d.list.length, 0);
        const map = readMap(s.map);
        const source = readSource(s.source);
        const hue = Object.fromEntries(counties.flatMap((d, i) => d.list.map((c, j) => [c.id, districtHue(i, j)])));
        return (
          <Sheet
            key={s.id}
            title={<h2>{s.name}</h2>}
            lede={[`${s.districts.length} districts`, countyCount ? `${countyCount} counties` : null, map ? "map" : null, source.label ? `from ${source.label}` : null].filter(Boolean).join(" · ")}
            aside={
              <span className="row end">
                <a className="btn sm" href={`/office/${org.slug}/districts/${s.id}/export`} download>
                  JSON
                </a>
                <a className="btn sm" href={`/office/${org.slug}/districts/${s.id}/export?format=csv`} download>
                  CSV
                </a>
                {edit ? (
                  <form action={districtAction}>
                    {hidden({ set: s.id })}
                    <ConfirmSubmit confirm="Remove the set?" name="op" value="removeSet">
                      Remove the set
                    </ConfirmSubmit>
                  </form>
                ) : null}
              </span>
            }
          >
            {locked.length ? (
              <p className="small muted" role="note">
                Held still while {locked.join(", ")} {locked.length === 1 ? "runs" : "run"}: districts change again once {locked.length === 1 ? "it is" : "they are"} counted or back in draft.
              </p>
            ) : null}
            {map ? (
              <div className="district-map">
                <HexMap map={map} districtOf={countyIndex(counties.map((d) => ({ id: d.id, counties: d.list })))} fill={(_, cid) => hue[cid] ?? "#ccc"} nameOf={(id) => s.districts.find((d) => d.id === id)?.name ?? ""} />
              </div>
            ) : null}
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th className="num">Seats</th>
                    <th className="num">Counties</th>
                    <th className="num">Registered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {counties.map((d) => (
                    <tr key={d.id}>
                      <td colSpan={edit ? 3 : 1}>
                        {edit ? (
                          <form action={districtAction} className="row" id={`d-${d.id}`}>
                            {hidden({ set: s.id, district: d.id })}
                            <input name="name" defaultValue={d.name} aria-label="Name" style={{ ...inline, flex: 2, minWidth: 120 }} />
                            <input name="code" defaultValue={d.code} aria-label="Code" style={{ ...inline, width: 80 }} />
                            <input name="seats" type="number" defaultValue={d.seats} aria-label="Seats" style={{ ...inline, width: 70, textAlign: "right" }} />
                          </form>
                        ) : (
                          d.name
                        )}
                      </td>
                      {edit ? null : (
                        <>
                          <td className="mono small">{d.code}</td>
                          <td className="num">{d.seats}</td>
                        </>
                      )}
                      <td className="num" title={d.list.map((c) => c.name).join(", ")}>
                        {d.list.length || ""}
                      </td>
                      <td className="num">{members.find((m) => m.districtId === d.id)?._count ?? 0}</td>
                      <td className="num">
                        {edit ? (
                          <span className="row end">
                            <button form={`d-${d.id}`} className="btn sm" name="op" value="save">
                              Save
                            </button>
                            <form action={districtAction}>
                              {hidden({ set: s.id, district: d.id })}
                              <ConfirmSubmit confirm="Remove?" name="op" value="remove">
                                Remove
                              </ConfirmSubmit>
                            </form>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {edit ? (
              <>
                <form action={districtAction} className="fields" style={{ marginTop: 14, gridTemplateColumns: "2fr 1fr 1fr auto" }}>
                  {hidden({ set: s.id, op: "add" })}
                  <Field label="New district">
                    <input name="name" required />
                  </Field>
                  <Field label="Code">
                    <input name="code" required maxLength={12} />
                  </Field>
                  <Field label="Seats">
                    <input name="seats" type="number" min={1} defaultValue={1} />
                  </Field>
                  <div className="row end" style={{ alignSelf: "end" }}>
                    <Submit className="btn">Add</Submit>
                  </div>
                </form>
                <ImportForms slug={org.slug} setId={s.id} uctv={uctv} />
              </>
            ) : null}
          </Sheet>
        );
      })}
      {officer ? (
        <Sheet title={<h2>New district set</h2>}>
          <form action={districtAction} className="row">
            {hidden({ op: "addSet" })}
            <label className="field" style={{ flex: 1 }}>
              <span>Name</span>
              <input name="name" required placeholder="Senate districts" />
            </label>
            <Submit className="btn">Create</Submit>
          </form>
          <ImportForms slug={org.slug} setId={null} uctv={uctv} />
        </Sheet>
      ) : null}
    </>
  );
}
