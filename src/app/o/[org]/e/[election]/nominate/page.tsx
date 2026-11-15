import "../../../../../hallway.css";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOrg, orgBrand } from "@/lib/org";
import { fmtDateTime } from "@/lib/format";
import { Crest } from "@/components/Crest";
import { Hallway } from "@/components/Hallway";
import { SYMBOLS, Sym } from "@/components/Symbol";
import { Flash, Submit } from "@/components/office/client";
import { cancelNominationAction, confirmNominationAction, fileNominationAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nominate" };

export default async function NominatePage({ params }: { params: Promise<{ org: string; election: string }> }) {
  const { org: slug, election } = await params;
  const org = await getOrg(slug);
  if (!org) notFound();
  const e = await db.election.findFirst({ where: { orgId: org.id, slug: election }, include: { contests: { where: { method: { not: "YESNO" } }, orderBy: { position: "asc" } } } });
  if (!e || e.status === "DRAFT") notFound();
  const brand = orgBrand(org);
  const pending = (await cookies()).get(`ps_nom_${e.id}`)?.value;
  const [parties, districts] = await Promise.all([
    db.party.findMany({ where: { orgId: org.id }, orderBy: { position: "asc" } }),
    e.districtSetId ? db.district.findMany({ where: { setId: e.districtSetId }, orderBy: { position: "asc" } }) : Promise.resolve([]),
  ]);
  const hidden = (
    <>
      <input type="hidden" name="org" value={org.slug} />
      <input type="hidden" name="election" value={e.slug} />
    </>
  );
  return (
    <Hallway org={org} subtitle={e.title}>
      <section className="paper" style={{ maxWidth: 640, justifySelf: "center", width: "100%" }}>
        <header>
          <Crest uploadId={brand.crestUploadId} />
          <h1>Nomination</h1>
          <span className="stamp blue">{e.title}</span>
        </header>
        <Suspense>
          <Flash />
        </Suspense>
        {e.status !== "NOMINATIONS" ? (
          <p>Nominations are closed{e.nominationsCloseAt ? ` since ${fmtDateTime(e.nominationsCloseAt, org.timezone)}` : ""}.</p>
        ) : pending ? (
          <form action={confirmNominationAction} className="nomform">
            {hidden}
            <p>A code is on its way to your e-mail. Enter it to file the nomination.</p>
            <label className="field">
              <span>Code</span>
              <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus />
            </label>
            <div className="acts">
              <Submit className="btn enter">File the nomination</Submit>
              <button formAction={cancelNominationAction} className="btn" formNoValidate>
                Start again
              </button>
            </div>
          </form>
        ) : (
          <form action={fileNominationAction} className="nomform">
            {hidden}
            {e.nominationsCloseAt ? <p className="small muted">Nominations close {fmtDateTime(e.nominationsCloseAt, org.timezone)}.</p> : null}
            <label className="field">
              <span>Paper</span>
              <select name="contest" required>
                {e.contests.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            {districts.length && e.contests.some((c) => c.scope === "PER_DISTRICT") ? (
              <label className="field">
                <span>District (for per-district papers)</span>
                <select name="district" defaultValue="">
                  <option value="">—</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>Name on the paper</span>
              <input name="name" required maxLength={120} />
            </label>
            <label className="field">
              <span>Party</span>
              <select name="party" defaultValue="">
                <option value="">Independent</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.abbr} · {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Under the name</span>
              <input name="subtitle" maxLength={80} placeholder="Title, or empty for the party" />
            </label>
            <fieldset className="field">
              <span>Symbol</span>
              <div className="sympick">
                {SYMBOLS.map((s) => (
                  <label key={s} title={s}>
                    <input type="radio" name="symbol" value={s} />
                    <Sym name={s} />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>Colour</span>
              <input type="color" name="color" defaultValue="#23201c" />
            </label>
            <label className="field">
              <span>Photo (optional, up to 2 MB)</span>
              <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" />
            </label>
            <label className="field">
              <span>Statement</span>
              <textarea name="statement" rows={4} maxLength={2000} />
            </label>
            <label className="field">
              <span>Your e-mail (not published)</span>
              <input name="email" type="email" required />
            </label>
            <div className="acts">
              <Submit className="btn enter">Send me a code</Submit>
            </div>
          </form>
        )}
      </section>
    </Hallway>
  );
}
