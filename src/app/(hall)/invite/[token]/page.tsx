import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { findToken } from "@/lib/tokens";
import { withNotice } from "@/lib/format";
import type { InvitePayload } from "@/lib/staff";
import { Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { acceptInviteAction } from "../../actions";

export const metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await findToken("INVITE", token);
  if (!row || !row.email) redirect(withNotice("/login", "err", "That invitation has been used or has lapsed."));
  const payload = JSON.parse(row.payload) as InvitePayload;
  const org = await db.organisation.findUnique({ where: { id: payload.orgId } });
  return (
    <Sheet title={`${org?.name ?? "Election office"}`} lede={`You are invited as ${payload.role.toLowerCase()}. Choose your password to accept.`}>
      <form action={acceptInviteAction} className="stack">
        <input type="hidden" name="token" value={token} />
        <Field label="E-mail address">
          <input value={row.email} readOnly />
        </Field>
        <Field label="Your name">
          <input name="displayName" defaultValue={payload.displayName} required autoComplete="name" />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <input type="password" name="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Again">
          <input type="password" name="confirm" autoComplete="new-password" required />
        </Field>
        <div className="row">
          <Submit>Accept</Submit>
        </div>
      </form>
    </Sheet>
  );
}
