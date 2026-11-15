import "../office.css";
import { Shell } from "@/components/office/Shell";
import { getSettings } from "@/lib/settings";

export default async function HallLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <Shell title={settings.site.name} subtitle="Election office" narrow>
      {children}
    </Shell>
  );
}
