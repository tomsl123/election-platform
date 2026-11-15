import "../../office.css";
import { Shell } from "@/components/office/Shell";
import { requireOffice } from "@/lib/auth";
import { orgBrand } from "@/lib/org";
import { brandStyle } from "@/lib/brand";

export default async function OfficeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { auth, org, role } = await requireOffice(slug);
  const brand = orgBrand(org);
  const base = `/office/${org.slug}`;
  const tabs = [
    { href: `${base}/elections`, label: "Elections" },
    { href: `${base}/register`, label: "Register" },
    { href: `${base}/parties`, label: "Parties" },
    { href: `${base}/districts`, label: "Districts" },
    ...(role === "OWNER" ? [{ href: `${base}/settings`, label: "Settings" }] : []),
    { href: `${base}/journal`, label: "Journal" },
  ];
  return (
    <Shell title={org.name} subtitle={`Election office · ${role.toLowerCase()}`} crestId={brand.crestUploadId} tabs={tabs} user={{ name: auth.user.displayName, platform: auth.user.isPlatformAdmin }} style={brandStyle(brand)}>
      {children}
    </Shell>
  );
}
