import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOffice } from "@/lib/auth";
import { Sheet, StatusStamp } from "@/components/office/ui";
import { SubTabs } from "@/components/office/client";

export default async function ElectionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org } = await requireOffice(slug);
  const e = await db.election.findFirst({ where: { id, orgId: org.id } });
  if (!e) notFound();
  const held = await db.envelope.count({ where: { electionId: e.id, status: "HELD" } });
  const pending = await db.option.count({ where: { contest: { electionId: e.id }, status: "PENDING" } });
  const b = `/office/${org.slug}/elections/${e.id}`;
  return (
    <>
      <Sheet
        className="tight"
        title={
          <div className="row" style={{ gap: 14 }}>
            <h1 style={{ fontSize: 24 }}>{e.title}</h1>
            <StatusStamp status={e.status} />
            {e.round > 1 ? <span className="pill">round {e.round}</span> : null}
          </div>
        }
        aside={
          <Link className="btn sm ghost" href={`/o/${org.slug}/e/${e.slug}`} target="_blank">
            Polling station ↗
          </Link>
        }
      >
        <SubTabs
          tabs={[
            { href: `${b}/setup`, label: "Setup" },
            { href: `${b}/papers`, label: pending ? `Papers (${pending} nominated)` : "Papers" },
            { href: `${b}/roll`, label: e.access === "INVITE" ? "Roll" : "Register" },
            { href: `${b}/run`, label: "Polling day" },
            { href: `${b}/held`, label: held ? `Held (${held})` : "Held" },
            { href: `${b}/results`, label: "Results" },
          ]}
        />
      </Sheet>
      {children}
    </>
  );
}
