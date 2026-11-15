import "../../../../../../hallway.css";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOrg, orgBrand } from "@/lib/org";
import { parseRule } from "@/lib/types";
import { Crest } from "@/components/Crest";
import { Hallway } from "@/components/Hallway";
import { Sym } from "@/components/Symbol";
import { Flash, Submit } from "@/components/office/client";
import { confirmSignAction, signAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign a nomination" };

export default async function SupportPage({ params }: { params: Promise<{ org: string; election: string; option: string }> }) {
  const { org: slug, election, option } = await params;
  const org = await getOrg(slug);
  if (!org) notFound();
  const o = await db.option.findFirst({ where: { id: option, contest: { election: { orgId: org.id, slug: election } } }, include: { contest: { include: { election: true } }, _count: { select: { supports: true } } } });
  if (!o) notFound();
  const brand = orgBrand(org);
  const need = parseRule(o.contest.rule).supportersRequired;
  const open = o.status === "PENDING" && o.contest.election.status === "NOMINATIONS" && need > 0;
  const pending = (await cookies()).get(`ps_sig_${o.id}`)?.value;
  const hidden = (
    <>
      <input type="hidden" name="org" value={org.slug} />
      <input type="hidden" name="election" value={o.contest.election.slug} />
      <input type="hidden" name="option" value={o.id} />
    </>
  );
  return (
    <Hallway org={org} subtitle={o.contest.election.title}>
      <section className="paper" style={{ maxWidth: 560, justifySelf: "center", width: "100%" }}>
        <header>
          <Crest uploadId={brand.crestUploadId} />
          <h1>{o.name}</h1>
          <span className="stamp blue">{o.contest.title}</span>
        </header>
        <Suspense>
          <Flash />
        </Suspense>
        <div className="nominee">
          <span style={{ color: o.color }}>
            {o.photoId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${o.photoId}`} alt="" />
            ) : (
              <Sym name={o.symbol || "star"} />
            )}
          </span>
          <div>
            {o.subtitle ? <b>{o.subtitle}</b> : null}
            {o.statement ? <p>{o.statement}</p> : null}
          </div>
        </div>
        <p className="small">
          {need ? `${o._count.supports} of ${need} signatures.` : "No signatures are needed."} {o.status === "APPROVED" ? "Approved: on the paper." : o.status === "REJECTED" ? "Not approved." : "Waiting for the returning officer."}
        </p>
        {open ? (
          pending ? (
            <form action={confirmSignAction} className="nomform">
              {hidden}
              <label className="field">
                <span>Code from your e-mail</span>
                <input name="code" inputMode="numeric" maxLength={6} required autoFocus />
              </label>
              <div className="acts">
                <Submit className="btn enter">Sign</Submit>
              </div>
            </form>
          ) : (
            <form action={signAction} className="nomform">
              {hidden}
              <label className="field">
                <span>Your name</span>
                <input name="name" required maxLength={80} />
              </label>
              <label className="field">
                <span>Your e-mail (not published)</span>
                <input name="email" type="email" required />
              </label>
              <div className="acts">
                <Submit className="btn enter">Send me a code</Submit>
              </div>
            </form>
          )
        ) : null}
      </section>
    </Hallway>
  );
}
