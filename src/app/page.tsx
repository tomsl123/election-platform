import "./office.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { orgBrand } from "@/lib/org";
import { Crest } from "@/components/Crest";
import { Shell } from "@/components/office/Shell";
import { Sheet } from "@/components/office/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  if ((await db.user.count()) === 0) redirect("/setup");
  const orgs = await db.organisation.findMany({ orderBy: { createdAt: "asc" } });
  if (orgs.length === 1) redirect(`/o/${orgs[0].slug}`);
  const [settings, auth] = await Promise.all([getSettings(), getAuth()]);
  return (
    <Shell title={settings.site.name} user={auth ? { name: auth.user.displayName, platform: auth.user.isPlatformAdmin } : null} narrow>
      <Sheet title="Polling stations">
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={`/o/${o.slug}`} className="row" style={{ textDecoration: "none", color: "inherit", gap: 14 }}>
                <span style={{ width: 34, height: 40, display: "inline-grid", color: "#8d6a25" }}>
                  <Crest uploadId={orgBrand(o).crestUploadId} />
                </span>
                <span>
                  <b>{o.name}</b>
                  <div className="small muted">/o/{o.slug}</div>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="small" style={{ marginTop: 18 }}>
          <Link href="/login">Staff sign-in</Link>
        </p>
      </Sheet>
    </Shell>
  );
}
