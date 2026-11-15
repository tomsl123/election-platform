import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { setupAction } from "../actions";

export const metadata = { title: "Open the polling station" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await db.user.count()) > 0) redirect("/login");
  return (
    <Sheet title="Open the polling station" lede="First run. You become the platform administrator and found the first organisation.">
      <form action={setupAction} className="stack">
        <Field label="Setup token" hint="SETUP_TOKEN from the server's .env file">
          <input name="token" type="password" required autoComplete="off" />
        </Field>
        <hr className="rule" />
        <div className="fields">
          <Field label="Your name">
            <input name="displayName" required autoComplete="name" />
          </Field>
          <Field label="E-mail address">
            <input name="email" type="email" required autoComplete="username" />
          </Field>
        </div>
        <Field label="Password" hint="At least 10 characters">
          <input name="password" type="password" required autoComplete="new-password" minLength={10} />
        </Field>
        <hr className="rule" />
        <Field label="First organisation">
          <input name="orgName" required placeholder="United States of Free Cliffs" />
        </Field>
        <div className="fields">
          <Field label="Short name">
            <input name="shortName" required placeholder="USFC" maxLength={16} />
          </Field>
          <Field label="Address" hint="/o/usfc">
            <input name="slug" placeholder="usfc" pattern="[a-z0-9\-]+" />
          </Field>
        </div>
        <div className="row end">
          <Submit>Open</Submit>
        </div>
      </form>
    </Sheet>
  );
}
