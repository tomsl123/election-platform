import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requireOffice } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { orgBrand } from "@/lib/org";
import { absoluteUrl, getSettings } from "@/lib/settings";
import { Crest } from "@/components/Crest";
import { Empty, Sheet } from "@/components/office/ui";
import { PrintButton } from "@/components/office/client";

export const metadata = { title: "Code cards" };
export const dynamic = "force-dynamic";

export default async function CardsPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ batch?: string }> }) {
  const { org: slug, id } = await params;
  const { batch } = await searchParams;
  const { org } = await requireOffice(slug, "OFFICER");
  const e = await db.election.findFirst({ where: { id, orgId: org.id } });
  if (!e) notFound();
  const codes = await db.accessCode.findMany({ where: { electionId: e.id, ...(batch ? { batch } : {}) }, orderBy: { createdAt: "asc" }, take: 2000 });
  const settings = await getSettings();
  const brand = orgBrand(org);
  const cards = await Promise.all(
    codes.map(async (c) => {
      const code = decrypt(c.codeEnc) ?? "";
      const url = absoluteUrl(settings, `/c/${code}`);
      return { id: c.id, code, url, used: !!c.usedAt, qr: await QRCode.toDataURL(url, { margin: 0, width: 192, errorCorrectionLevel: "M" }) };
    }),
  );
  return (
    <Sheet title={<h2>Code cards</h2>} lede={`${cards.length} cards${batch ? ` from ${batch}` : ""}. Each lets one person in once.`} aside={<PrintButton label="Print the cards" />}>
      {cards.length === 0 ? (
        <Empty>No cards.</Empty>
      ) : (
        <div className="cards">
          {cards.map((c) => (
            <div key={c.id} className={`card ${c.used ? "used" : ""}`}>
              <div>
                <Crest uploadId={brand.crestUploadId} />
                <small>
                  {org.shortName} · {e.title}
                </small>
                <code>{c.code}</code>
                <small>{c.url.replace(/^https?:\/\//, "")}</small>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.qr} alt="" />
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
