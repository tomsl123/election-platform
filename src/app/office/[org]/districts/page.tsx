import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { Empty, Field, Sheet } from "@/components/office/ui";
import { ConfirmSubmit, Submit } from "@/components/office/client";
import { districtAction } from "../standing-actions";

export const metadata = { title: "Districts" };
export const dynamic = "force-dynamic";

export default async function DistrictsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOffice(slug);
  const officer = atLeast(role, "OFFICER");
  const sets = await db.districtSet.findMany({ where: { orgId: org.id }, include: { districts: { orderBy: { position: "asc" } } } });
  const members = await db.registerDistrict.groupBy({ by: ["districtId"], _count: true });
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
      {sets.map((s) => (
        <Sheet
          key={s.id}
          title={<h2>{s.name}</h2>}
          lede={`${s.districts.length} districts`}
          aside={
            officer ? (
              <form action={districtAction}>
                {hidden({ set: s.id })}
                <ConfirmSubmit confirm="Remove the set?" name="op" value="removeSet">
                  Remove the set
                </ConfirmSubmit>
              </form>
            ) : null
          }
        >
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th className="num">Seats</th>
                  <th className="num">Registered</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.districts.map((d) => (
                  <tr key={d.id}>
                    <td colSpan={officer ? 3 : 1}>
                      {officer ? (
                        <form action={districtAction} className="row" id={`d-${d.id}`}>
                          {hidden({ set: s.id, district: d.id })}
                          <input name="name" defaultValue={d.name} aria-label="Name" style={{ flex: 2, minWidth: 120, font: "inherit", border: 0, borderBottom: "1px solid #999", background: "transparent" }} />
                          <input name="code" defaultValue={d.code} aria-label="Code" style={{ width: 80, font: "inherit", border: 0, borderBottom: "1px solid #999", background: "transparent" }} />
                          <input name="seats" type="number" defaultValue={d.seats} aria-label="Seats" style={{ width: 70, font: "inherit", border: 0, borderBottom: "1px solid #999", background: "transparent", textAlign: "right" }} />
                        </form>
                      ) : (
                        d.name
                      )}
                    </td>
                    {officer ? null : (
                      <>
                        <td className="mono small">{d.code}</td>
                        <td className="num">{d.seats}</td>
                      </>
                    )}
                    <td className="num">{members.find((m) => m.districtId === d.id)?._count ?? 0}</td>
                    <td className="num">
                      {officer ? (
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
          {officer ? (
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
          ) : null}
        </Sheet>
      ))}
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
        </Sheet>
      ) : null}
    </>
  );
}
