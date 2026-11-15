import "../office.css";
import { Shell } from "@/components/office/Shell";
import { getSettings } from "@/lib/settings";

// Every page here reads settings from the database, which does not exist while the image is built.
export const dynamic = "force-dynamic";

export default async function HallLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <Shell title={settings.site.name} subtitle="Election office" narrow>
      {children}
    </Shell>
  );
}
