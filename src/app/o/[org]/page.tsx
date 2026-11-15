import "../../hallway.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOrg, orgBrand } from "@/lib/org";
import { getDict, t } from "@/i18n";
import { fmtDateTime } from "@/lib/format";
import { Crest } from "@/components/Crest";
import { Hallway } from "@/components/Hallway";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }) {
  const org = await getOrg((await params).org);
  return { title: org ? `${org.shortName} · notice board` : "Notice board" };
}

const TONE: Record<string, string> = { OPEN: "green", READY: "brass", NOMINATIONS: "blue", CLOSED: "red", COUNTED: "blue", CERTIFIED: "green", CANCELLED: "red" };

export default async function NoticeBoard({ params }: { params: Promise<{ org: string }> }) {
  const org = await getOrg((await params).org);
  if (!org) notFound();
  const brand = orgBrand(org);
  const dict = getDict(org, brand.words);
  const tz = org.timezone;
  const elections = await db.election.findMany({ where: { orgId: org.id, status: { not: "DRAFT" } }, orderBy: [{ closesAt: "desc" }, { createdAt: "desc" }], take: 60 });
  const turnout = await db.rollEntry.groupBy({ by: ["electionId"], where: { electionId: { in: elections.map((e) => e.id) }, status: { in: ["VOTED", "HELD"] } }, _count: true });
  const lanes = [
    { key: "open", label: t(dict, "board.open"), list: elections.filter((e) => e.status === "OPEN") },
    { key: "soon", label: t(dict, "board.upcoming"), list: elections.filter((e) => e.status === "READY" || e.status === "NOMINATIONS") },
    { key: "past", label: t(dict, "board.past"), list: elections.filter((e) => ["CLOSED", "COUNTED", "CERTIFIED", "CANCELLED"].includes(e.status)) },
  ].filter((l) => l.list.length);

  return (
    <Hallway org={org}>
      <section className="cork" aria-label={t(dict, "board.title")}>
        {lanes.length === 0 ? <p className="empty">{t(dict, "board.none")}</p> : null}
        {lanes.map((lane) => (
          <div key={lane.key} style={{ display: "contents" }}>
            <h2 className="lane">{lane.label}</h2>
            {lane.list.map((e, i) => {
              const base = `/o/${org.slug}/e/${e.slug}`;
              const n = turnout.find((x) => x.electionId === e.id)?._count ?? 0;
              return (
                <article key={e.id} className="notice" style={{ ["--r" as string]: `${((i * 37) % 5) - 2}deg`, animationDelay: `${i * 60}ms` }}>
                  <header>
                    <Crest uploadId={brand.crestUploadId} />
                    <h3>{e.title}</h3>
                  </header>
                  <span className={`stamp ${TONE[e.status] ?? ""}`}>
                    {e.status === "OPEN" ? <span className="open-lamp" aria-hidden="true" /> : null}
                    {t(dict, `status.${e.status}` as Parameters<typeof t>[1])}
                  </span>
                  {e.summary ? <p>{e.summary}</p> : null}
                  {(() => {
                    const text =
                      e.status === "OPEN" || e.status === "READY" || e.status === "NOMINATIONS"
                        ? [e.opensAt && e.status !== "OPEN" ? t(dict, "board.opens", { when: fmtDateTime(e.opensAt, tz) }) : "", e.closesAt ? t(dict, "board.closes", { when: fmtDateTime(e.closesAt, tz) }) : ""].filter(Boolean).join(" · ")
                        : e.closedAt
                          ? t(dict, "board.closed", { when: fmtDateTime(e.closedAt, tz) })
                          : "";
                    return text ? <p className="times">{text}</p> : null;
                  })()}
                  {(e.status === "OPEN" && e.turnoutLive) || ["CLOSED", "COUNTED", "CERTIFIED"].includes(e.status) ? <p className="small">{t(dict, "board.turnout", { n })}</p> : null}
                  <div className="acts">
                    {e.status === "OPEN" ? (
                      <Link className="btn enter" href={base}>
                        {t(dict, "station.enter")}
                      </Link>
                    ) : null}
                    {e.status === "NOMINATIONS" ? (
                      <Link className="btn" href={`${base}/nominate`}>
                        {t(dict, "board.nominate")}
                      </Link>
                    ) : null}
                    {["COUNTED", "CERTIFIED"].includes(e.status) || (e.status === "OPEN" && e.resultsMode === "LIVE") ? (
                      <Link className="btn" href={`${base}/results`}>
                        {t(dict, "station.results")}
                      </Link>
                    ) : null}
                    {e.transparency !== "SECRET" && e.status !== "READY" && e.status !== "NOMINATIONS" ? (
                      <Link className="btn" href={`${base}/register`}>
                        {t(dict, "station.register")}
                      </Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ))}
      </section>
    </Hallway>
  );
}
