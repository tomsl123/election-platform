import "../office.css";
import { Shell } from "@/components/office/Shell";
import { requirePlatformAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePlatformAdmin();
  const settings = await getSettings();
  return (
    <Shell
      title={settings.site.name}
      subtitle="Platform"
      user={{ name: auth.user.displayName }}
      tabs={[
        { href: "/platform", label: "Organisations", exact: true },
        { href: "/platform/settings", label: "Settings" },
        { href: "/platform/health", label: "Health" },
      ]}
    >
      {children}
    </Shell>
  );
}
