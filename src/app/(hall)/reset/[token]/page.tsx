import { redirect } from "next/navigation";
import { findToken } from "@/lib/tokens";
import { withNotice } from "@/lib/format";
import { Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { resetAction } from "../../actions";

export const metadata = { title: "New password" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await findToken("RESET", token))) redirect(withNotice("/login", "err", "That reset link has been used or has lapsed."));
  return (
    <Sheet title="Choose a new password">
      <form action={resetAction} className="stack">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" hint="At least 10 characters">
          <input type="password" name="password" autoComplete="new-password" required minLength={10} autoFocus />
        </Field>
        <Field label="Again">
          <input type="password" name="confirm" autoComplete="new-password" required />
        </Field>
        <div className="row">
          <Submit>Save</Submit>
        </div>
      </form>
    </Sheet>
  );
}
