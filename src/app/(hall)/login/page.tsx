import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if ((await db.user.count()) === 0) redirect("/setup");
  if (await getAuth()) redirect(next && next.startsWith("/") ? next : "/");
  const settings = await getSettings();
  return (
    <Sheet title="Sign in" lede="Election staff and voters with an account.">
      <form action={loginAction} className="stack">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="E-mail address">
          <input type="email" name="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" name="password" autoComplete="current-password" required />
        </Field>
        <div className="row between">
          <Submit>Sign in</Submit>
          <Link href="/forgot">Forgotten password</Link>
        </div>
      </form>
      {settings.sso.enabled && settings.sso.parliamentUrl ? (
        <>
          <hr className="rule" />
          <a className="btn" href={`/sso/parliament/start?next=${encodeURIComponent(next ?? "/")}`}>
            Continue with {settings.sso.label}
          </a>
        </>
      ) : null}
    </Sheet>
  );
}
