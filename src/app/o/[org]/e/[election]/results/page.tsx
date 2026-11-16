import "../../../../../hallway.css";
import "../../../../../count.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOrg, orgBrand } from "@/lib/org";
import { getDict, t } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { visibleResult } from "@/lib/results";
import { mapFor } from "@/lib/districts";
import { Crest } from "@/components/Crest";
import { Hallway } from "@/components/Hallway";
import { ResultsView } from "@/components/ResultsView";
import { LiveRefresh } from "@/components/office/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ org: string; election: string }>; searchParams: Promise<{ d?: string }> }) {
  const { org: slug, election } = await params;
  const { d } = await searchParams;
  const org = await getOrg(slug);
  if (!org) notFound();
  const e = await db.election.findFirst({ where: { orgId: org.id, slug: election } });
  if (!e || e.status === "DRAFT") notFound();
  const brand = orgBrand(org);
  const dict = getDict(org, brand.words);
  const { kind, result } = await visibleResult(e);
  const voted = kind === "sealed" && e.turnoutLive ? await db.rollEntry.count({ where: { electionId: e.id, status: { in: ["VOTED", "HELD"] } } }) : null;
  const base = `/o/${org.slug}/e/${e.slug}`;
  const geo = result ? await mapFor(e) : null;
  const runoff = await db.election.findFirst({ where: { parentId: e.id, status: { not: "DRAFT" } }, select: { slug: true, title: true } });
  return (
    <Hallway org={org} subtitle={e.title}>
      {e.status === "OPEN" ? <LiveRefresh electionId={e.id} /> : null}
      <section className="paper">
        <header>
          <Crest uploadId={brand.crestUploadId} />
          <h1>{e.title}</h1>
          {e.status === "CERTIFIED" ? (
            <span className="stamp green">
              {t(dict, "results.certified")} · {t(dict, "certify.by")}
            </span>
          ) : kind === "live" ? (
            <span className="stamp brass">{t(dict, "results.live")}</span>
          ) : null}
        </header>
        {kind === "sealed" || !result ? (
          <div className="sealed-box">
            <svg viewBox="0 0 120 110" aria-hidden="true">
              <path d="M10 40h100v62H10z" fill="#1f3b2b" />
              <path d="M18 26h84l8 14H10z" fill="#2d5a3e" />
              <rect x="40" y="31" width="40" height="5" rx="2.5" fill="#06100a" />
              <circle cx="60" cy="66" r="12" fill="#9b1f18" />
              <path d="M52 66h16M60 58v16" stroke="#e7b2a8" strokeWidth="2" />
            </svg>
            <p>{t(dict, "results.sealed")}</p>
            {voted !== null ? <p className="small">{t(dict, "board.turnout", { n: voted })}</p> : null}
          </div>
        ) : (
          <ResultsView result={result} dict={dict} district={d && result.districts.some((x) => x.id === d) ? d : null} hrefFor={(x) => (x ? `?d=${x}` : "?")} map={geo} />
        )}
        <p className="small muted no-print" style={{ marginTop: 18, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {e.countedAt ? <span>{fmtDateTime(e.countedAt, org.timezone)}</span> : null}
          {e.resultHash ? (
            <span className="mono" title="Seal">
              #{e.resultHash.slice(0, 16)}
            </span>
          ) : null}
          <Link href={`${base}/verify`}>{t(dict, "verify.title")}</Link>
          {e.transparency !== "SECRET" ? <Link href={`${base}/register`}>{t(dict, "station.register")}</Link> : null}
          {["COUNTED", "CERTIFIED"].includes(e.status) ? <a href={`${base}/ballots.json`}>ballots.json</a> : null}
          {runoff ? <Link href={`/o/${org.slug}/e/${runoff.slug}`}>{runoff.title} →</Link> : null}
        </p>
      </section>
    </Hallway>
  );
}
