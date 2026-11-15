import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Crest } from "@/components/Crest";
import { Flash, Tabs } from "./client";
import { logoutAction } from "@/app/(hall)/actions";

export type Tab = { href: string; label: string; exact?: boolean };

/** The office frame: brass rail with crest and title, index tabs, a notice slot, the desk. */
export function Shell({
  title,
  subtitle,
  crestId,
  tabs = [],
  user,
  narrow = false,
  style,
  children,
}: {
  title: string;
  subtitle?: string;
  crestId?: string | null;
  tabs?: Tab[];
  user?: { name: string; platform?: boolean } | null;
  narrow?: boolean;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="office" style={style}>
      <header className="o-rail">
        <Crest uploadId={crestId} />
        <div className="o-title">
          <small>{subtitle ?? "Polling station"}</small>
          <b>{title}</b>
        </div>
        {user ? (
          <div className="o-user">
            {user.platform ? <Link href="/platform">Platform</Link> : null}
            <span>{user.name}</span>
            <form action={logoutAction}>
              <button type="submit" className="btn sm ghost">
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </header>
      {tabs.length ? <Tabs tabs={tabs} /> : null}
      <main className={`o-main ${narrow ? "narrow" : ""}`}>
        <Suspense>
          <Flash />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
