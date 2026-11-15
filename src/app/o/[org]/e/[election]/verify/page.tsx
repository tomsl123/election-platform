import "../../../../../hallway.css";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOrg, orgBrand } from "@/lib/org";
import { getDict, t } from "@/i18n";
import { lookupReceipt } from "@/lib/ballot";
import { requestMeta } from "@/lib/auth";
import { hit } from "@/lib/ratelimit";
import { Crest } from "@/components/Crest";
import { Hallway } from "@/components/Hallway";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check a receipt" };

const WORD: Record<string, "verify.in" | "verify.held" | "verify.rejected" | "verify.replaced"> = { COUNTED: "verify.in", HELD: "verify.held", REJECTED: "verify.rejected", SUPERSEDED: "verify.replaced" };
const TONE: Record<string, string> = { COUNTED: "green", HELD: "brass", REJECTED: "red", SUPERSEDED: "red" };

export default async function VerifyPage({ params, searchParams }: { params: Promise<{ org: string; election: string }>; searchParams: Promise<{ code?: string }> }) {
  const { org: slug, election } = await params;
  const { code } = await searchParams;
  const org = await getOrg(slug);
  if (!org) notFound();
  const e = await db.election.findFirst({ where: { orgId: org.id, slug: election } });
  if (!e || e.status === "DRAFT") notFound();
  const brand = orgBrand(org);
  const dict = getDict(org, brand.words);
  let result: Awaited<ReturnType<typeof lookupReceipt>> | "slow" = null;
  if (code) {
    const gate = await hit(`verify:${(await requestMeta()).ip}`, 30, 600);
    result = gate.ok ? await lookupReceipt(e.id, code) : "slow";
  }
  return (
    <Hallway org={org} subtitle={e.title}>
      <section className="paper" style={{ maxWidth: 560, justifySelf: "center", width: "100%" }}>
        <header>
          <Crest uploadId={brand.crestUploadId} />
          <h1>{t(dict, "verify.title")}</h1>
        </header>
        <form className="field" style={{ gap: 12 }}>
          <label className="field">
            <span>{t(dict, "verify.code")}</span>
            <input name="code" defaultValue={code} autoComplete="off" required maxLength={20} placeholder="XXXX-XXXX-XXXX" />
          </label>
          <button className="btn" style={{ justifySelf: "start" }}>
            {t(dict, "verify.check")}
          </button>
        </form>
        {code ? (
          <div className="verdict" role="status">
            {result === "slow" ? (
              <p>{t(dict, "err.tooMany", { minutes: 10 })}</p>
            ) : result && result.length ? (
              result.map((r) => (
                <div key={r.contest}>
                  <span>{r.contest}</span>
                  <span className={`stamp ${TONE[r.status ?? ""] ?? ""}`}>{t(dict, WORD[r.status ?? ""] ?? "verify.unknown")}</span>
                </div>
              ))
            ) : (
              <p className="muted">{t(dict, "verify.unknown")}</p>
            )}
          </div>
        ) : null}
      </section>
    </Hallway>
  );
}
