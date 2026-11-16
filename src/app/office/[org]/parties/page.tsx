import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { PartyMark, SYMBOLS } from "@/components/Symbol";
import { Check, Empty, Field, Sheet } from "@/components/office/ui";
import { ConfirmSubmit, Submit } from "@/components/office/client";
import { partyAction } from "../standing-actions";

export const metadata = { title: "Parties" };
export const dynamic = "force-dynamic";

function PartyFields({ p }: { p?: { name: string; abbr: string; color: string; symbol: string; logoId: string | null } }) {
  return (
    <>
    <div className="fields" style={{ gridTemplateColumns: "2fr 1fr auto 1fr" }}>
      <Field label="Name">
        <input name="name" defaultValue={p?.name} required />
      </Field>
      <Field label="Short">
        <input name="abbr" defaultValue={p?.abbr} required maxLength={12} />
      </Field>
      <Field label="Colour">
        <input type="color" name="color" defaultValue={p?.color ?? "#23201c"} />
      </Field>
      <Field label="Symbol">
        <select name="symbol" defaultValue={p?.symbol ?? ""}>
          <option value="">none</option>
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
    </div>
    <div className="fields">
      <Field label="Logo" hint="Optional. Shown instead of the symbol; PNG, JPEG or WebP, at most 2 MB">
        <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
      </Field>
      {p?.logoId ? <Check name="removeLogo" label="Remove the logo" /> : null}
    </div>
    </>
  );
}

export default async function PartiesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, role } = await requireOffice(slug);
  const parties = await db.party.findMany({ where: { orgId: org.id }, orderBy: { position: "asc" } });
  const officer = atLeast(role, "OFFICER");
  return (
    <>
      <Sheet title="Parties" lede="Their colour and symbol, or their logo, are printed beside their candidates and lists.">
        {parties.length === 0 ? <Empty>No parties.</Empty> : null}
        {parties.map((p) => (
          <details key={p.id} className="opt">
            <summary>
              <span className="symcell" style={{ color: p.color }}>
                <PartyMark logoId={p.logoId} symbol={p.symbol} />
              </span>
              <span>
                <b>{p.abbr}</b> {p.name}
              </span>
              <span className="swatch" style={{ background: p.color }} />
            </summary>
            {officer ? (
              <div className="inner">
                <form action={partyAction} className="stack">
                  <input type="hidden" name="org" value={org.slug} />
                  <input type="hidden" name="party" value={p.id} />
                  <PartyFields p={p} />
                  <div className="row between">
                    <ConfirmSubmit confirm="Remove the party?" name="op" value="remove">
                      Remove
                    </ConfirmSubmit>
                    <Submit name="op" value="save">
                      Save
                    </Submit>
                  </div>
                </form>
              </div>
            ) : null}
          </details>
        ))}
      </Sheet>
      {officer ? (
        <Sheet title={<h2>Add a party</h2>}>
          <form action={partyAction} className="stack">
            <input type="hidden" name="org" value={org.slug} />
            <PartyFields />
            <div className="row end">
              <Submit name="op" value="add">
                Add
              </Submit>
            </div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}
