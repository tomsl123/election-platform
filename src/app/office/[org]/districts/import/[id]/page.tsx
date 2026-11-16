import { notFound } from "next/navigation";
import { requireOffice } from "@/lib/auth";
import { loadImport } from "@/lib/districts";
import { Check, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { HexMap, countyIndex, districtHue } from "@/components/HexMap";
import { districtImportAction } from "../../../standing-actions";

export const metadata = { title: "Import districts" };
export const dynamic = "force-dynamic";

const FIELD: Record<string, string> = { name: "name", seats: "seats", ref: "UCTV race", counties: "counties" };

export default async function ImportPreview({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org } = await requireOffice(slug, "OFFICER");
  const loaded = await loadImport(org, id);
  if (!loaded) notFound();
  const { staged, set, plan, locked } = loaded;
  const file = staged.parsed.file;
  const removable = plan.missing.filter((m) => !m.used);
  const nothing = plan.add.length === 0 && plan.change.length === 0 && !plan.mapChanged && removable.length === 0;

  // The map as it will be after applying: every planned district, coloured by position.
  const planned = [...plan.change.map((c) => ({ id: c.code, counties: c.to.counties })), ...plan.add.map((a) => ({ id: a.code, counties: a.counties }))];
  const kept = (set?.districts ?? []).filter((d) => plan.missing.some((m) => m.id === d.id)).map((d) => ({ id: d.code, counties: JSON.parse(d.counties || "[]") as Array<{ id: string }> }));
  const index = countyIndex([...planned, ...kept]);
  const order = [...new Set(Object.values(index))];
  const names = new Map<string, string>([...plan.change.map((c) => [c.code, c.to.name] as const), ...plan.add.map((a) => [a.code, a.name] as const)]);
  const hidden = (
    <>
      <input type="hidden" name="org" value={org.slug} />
      <input type="hidden" name="import" value={id} />
    </>
  );

  return (
    <>
      <Sheet
        title={<h2>{set ? `Import into ${set.name}` : `New set: ${file.name || staged.label}`}</h2>}
        lede={`${staged.label} · ${file.districts.length} districts${file.map ? " · with a map" : ""}`}
        aside={
          <a className="btn sm" href={`/office/${org.slug}/districts`}>
            Back
          </a>
        }
      >
        {staged.parsed.notes.map((n) => (
          <p key={n} className="small muted" role="note">
            {n}
          </p>
        ))}
        {locked.length ? (
          <p className="small" role="alert">
            {locked.join(", ")} {locked.length === 1 ? "uses" : "use"} this set, so it cannot change now.
          </p>
        ) : null}
        <div className="ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>What</th>
                <th>Code</th>
                <th>District</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {plan.add.map((a) => (
                <tr key={`a-${a.code}`}>
                  <td>Add</td>
                  <td className="mono small">{a.code}</td>
                  <td>{a.name}</td>
                  <td className="small muted">
                    {a.seats} seat{a.seats === 1 ? "" : "s"}
                    {a.counties.length ? ` · ${a.counties.length} counties` : ""}
                  </td>
                </tr>
              ))}
              {plan.change.map((c) => (
                <tr key={`c-${c.id}`}>
                  <td>Change</td>
                  <td className="mono small">{c.code}</td>
                  <td>{c.to.name}</td>
                  <td className="small muted">
                    {c.fields
                      .map((f) =>
                        f === "name" ? `name was ${c.was.name}` : f === "seats" ? `seats ${c.was.seats} → ${c.to.seats}` : f === "counties" ? `counties ${c.was.counties.length} → ${c.to.counties.length}` : FIELD[f],
                      )
                      .join(" · ")}
                  </td>
                </tr>
              ))}
              {plan.missing.map((m) => (
                <tr key={`m-${m.id}`}>
                  <td>{m.used ? "Keep" : "Not in file"}</td>
                  <td className="mono small">{m.code}</td>
                  <td>{m.name}</td>
                  <td className="small muted">{m.used ? "in use by papers or voters, so it stays" : "stays unless you remove it below"}</td>
                </tr>
              ))}
              {plan.same ? (
                <tr>
                  <td>Same</td>
                  <td />
                  <td>{plan.same} districts</td>
                  <td className="small muted">no change</td>
                </tr>
              ) : null}
              {plan.mapChanged ? (
                <tr>
                  <td>Map</td>
                  <td />
                  <td>{plan.map ? `${Object.keys(plan.map.cells).length} hexes` : "removed"}</td>
                  <td className="small muted">{file.map ? "from the file" : "kept, without cells of counties that are gone"}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {plan.map ? (
          <div className="district-map">
            <HexMap map={plan.map} districtOf={index} fill={(did) => districtHue(Math.max(0, order.indexOf(did)))} nameOf={(code) => names.get(code) ?? code} />
          </div>
        ) : null}
        {locked.length === 0 ? (
          <div className="row between" style={{ marginTop: 18 }}>
            <form action={districtImportAction}>
              {hidden}
              <Submit className="btn" name="op" value="discard">
                Discard
              </Submit>
            </form>
            <form action={districtImportAction} className="row">
              {hidden}
              {removable.length ? <Check name="removeMissing" label={`Remove the ${removable.length} district${removable.length === 1 ? "" : "s"} not in the file`} /> : null}
              <Submit name="op" value="apply" disabled={nothing && removable.length === 0}>
                {set ? "Apply" : "Create the set"}
              </Submit>
            </form>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
