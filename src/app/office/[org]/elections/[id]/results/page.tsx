import "../../../../../count.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { getDict } from "@/i18n";
import { orgBrand } from "@/lib/org";
import { liveResult, verifyElection } from "@/lib/ballot";
import { fmtDateTime } from "@/lib/format";
import type { Result } from "@/lib/count";
import { Empty, Sheet, StatusStamp } from "@/components/office/ui";
import { PrintButton, Submit } from "@/components/office/client";
import { ResultsView } from "@/components/ResultsView";
import { runAction } from "../../actions";

export const metadata = { title: "Results" };
export const dynamic = "force-dynamic";

export default async function OfficeResults({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ d?: string; recount?: string }> }) {
  const { org: slug, id } = await params;
  const sp = await searchParams;
  const { org, role } = await requireOffice(slug);
  const e = await db.election.findFirst({ where: { id, orgId: org.id } });
  if (!e) notFound();
  const dict = getDict(org, orgBrand(org).words);
  // Officers watch the box fill only when results are live; a sealed count stays sealed for them too.
  const result: Result | null = e.result ? (JSON.parse(e.result) as Result) : e.status === "OPEN" && e.resultsMode === "LIVE" ? await liveResult(e.id) : null;
  const check = sp.recount ? await verifyElection(e.id) : null;
  const children = await db.election.findMany({ where: { parentId: e.id }, select: { id: true, title: true, status: true } });
  return (
    <Sheet
      title={<h2>The count</h2>}
      lede={e.countedAt ? `Counted ${fmtDateTime(e.countedAt, org.timezone)}${e.certifiedAt ? `, certified ${fmtDateTime(e.certifiedAt, org.timezone)}` : ""}. Seal ${e.resultHash?.slice(0, 16)}…` : "Not counted yet."}
      aside={
        <div className="row no-print">
          {e.status === "COUNTED" && atLeast(role, "OFFICER") ? (
            <form action={runAction}>
              <input type="hidden" name="org" value={org.slug} />
              <input type="hidden" name="id" value={e.id} />
              <Submit className="btn primary" name="op" value="certify">
                Certify
              </Submit>
            </form>
          ) : null}
          {e.result ? (
            <Link className="btn ghost sm" href="?recount=1">
              Recount
            </Link>
          ) : null}
          {e.result ? <PrintButton label="Print the record" /> : null}
        </div>
      }
    >
      {check ? (
        <div className={`memo ${check.ok ? "" : "err"}`} style={{ marginBottom: 16 }}>
          <b>{check.ok ? "Recount" : "Recount failed"}</b>
          {check.ok ? `${check.ballots} ballots recounted from the chain; the result and the seal match.` : check.problems.join(" ")}
        </div>
      ) : null}
      {children.length ? (
        <p className="small" style={{ marginBottom: 14 }}>
          Second round:{" "}
          {children.map((c) => (
            <Link key={c.id} href={`/office/${org.slug}/elections/${c.id}/setup`} style={{ marginRight: 10 }}>
              {c.title} <StatusStamp status={c.status} />
            </Link>
          ))}
        </p>
      ) : null}
      {result ? <ResultsView result={result} dict={dict} district={sp.d ?? null} hrefFor={(x) => (x ? `?d=${x}` : "?")} /> : <Empty>{e.status === "OPEN" ? "Sealed until the polls close." : "Nothing counted yet."}</Empty>}
    </Sheet>
  );
}
