import "../../../../../hallway.css";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getOrg, orgBrand } from "@/lib/org";
import { getDict, t } from "@/i18n";
import { Crest } from "@/components/Crest";
import { Sym } from "@/components/Symbol";
import { Hallway } from "@/components/Hallway";
import { LiveRefresh } from "@/components/office/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Register" };

/** The open register: who has voted (who-voted and show-of-hands elections), and for a show of hands, how. */
export default async function RegisterPage({ params }: { params: Promise<{ org: string; election: string }> }) {
  const { org: slug, election } = await params;
  const org = await getOrg(slug);
  if (!org) notFound();
  const e = await db.election.findFirst({ where: { orgId: org.id, slug: election }, include: { contests: { orderBy: { position: "asc" }, include: { options: true } } } });
  if (!e || e.status === "DRAFT" || e.transparency === "SECRET") notFound();
  const brand = orgBrand(org);
  const dict = getDict(org, brand.words);
  const lines = await db.rollEntry.findMany({ where: { electionId: e.id, status: "VOTED", nameStruck: false }, orderBy: [{ votedAt: "asc" }, { displayName: "asc" }], take: 5000 });
  const handsVisible = e.transparency === "SHOW_OF_HANDS" && (e.handsLive || !["OPEN", "READY", "NOMINATIONS"].includes(e.status));
  const ballots = handsVisible ? await db.ballot.findMany({ where: { electionId: e.id, status: "COUNTED", rollEntryId: { in: lines.map((l) => l.id) } }, select: { rollEntryId: true, contestId: true, data: true } }) : [];
  const options = new Map(e.contests.flatMap((c) => c.options.map((o) => [o.id, o] as const)));
  const marksOf = (lineId: string) =>
    ballots
      .filter((b) => b.rollEntryId === lineId)
      .flatMap((b) => {
        const m = JSON.parse(b.data) as { x?: string[]; r?: string[]; s?: Record<string, number> };
        return (m.x ?? m.r?.slice(0, 1) ?? Object.keys(m.s ?? {}).slice(0, 1)).map((id) => options.get(id)).filter(Boolean);
      });
  const half = Math.ceil(lines.length / 2);
  const col = (list: typeof lines, offset: number) => (
    <ol>
      {list.map((l, i) => (
        <li key={l.id}>
          <span className="n">{offset + i + 1}</span>
          <span className="who">{l.displayName || "—"}</span>
          {handsVisible ? (
            <span className="hands">
              {marksOf(l.id).map((o, k) => (
                <span key={k} style={{ color: o!.color }} title={o!.name}>
                  <Sym name={o!.symbol || "star"} />
                </span>
              ))}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
  return (
    <Hallway org={org} subtitle={e.title}>
      {e.status === "OPEN" ? <LiveRefresh electionId={e.id} /> : null}
      <section className="paper">
        <header>
          <Crest uploadId={brand.crestUploadId} />
          <h1>{t(dict, "register.title")}</h1>
          <span className="stamp blue">{lines.length} {t(dict, "register.voted")}</span>
        </header>
        <div className="book">
          {col(lines.slice(0, half), 0)}
          {col(lines.slice(half), half)}
        </div>
      </section>
    </Hallway>
  );
}
