import Link from "next/link";
import type { ReactNode } from "react";
import type { Organisation } from "@prisma/client";
import { Crest } from "./Crest";
import { orgBrand } from "@/lib/org";
import { brandStyle } from "@/lib/brand";
import { getDict, t } from "@/i18n";

/** The frame of every public page outside the booth: brass rail with the crest, then the wall. */
export function Hallway({ org, children, subtitle }: { org: Organisation; children: ReactNode; subtitle?: string }) {
  const brand = orgBrand(org);
  const dict = getDict(org, brand.words);
  return (
    <div className="hallway" style={brandStyle(brand)}>
      <header className="rail">
        <Crest uploadId={brand.crestUploadId} />
        <div>
          <small>{subtitle ?? t(dict, "board.title")}</small>
          <b>{org.name}</b>
        </div>
        <nav>
          <Link href={`/o/${org.slug}`}>{t(dict, "board.title")}</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
