import { redirect } from "next/navigation";
import { getAuth, pendingSignIn } from "@/lib/auth";
import { withNotice } from "@/lib/format";
import { Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { abandonSignInAction, loginCodeAction } from "../../actions";

export const metadata = { title: "Two-step sign-in" };
export const dynamic = "force-dynamic";

export default async function LoginCodePage() {
  if (await getAuth()) redirect("/");
  const pending = await pendingSignIn();
  if (!pending) redirect(withNotice("/login", "err", "That sign-in has lapsed. Enter your e-mail and password again."));
  return (
    <Sheet title="Your second signature" lede={`Password accepted for ${pending.user.displayName}. Enter the 6-digit code from your authenticator app.`}>
      <form action={loginCodeAction} className="stack">
        <Field label="Authenticator code">
          <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="000000" required autoFocus />
        </Field>
        <div className="row">
          <Submit>Sign in</Submit>
        </div>
      </form>
      <form action={abandonSignInAction} style={{ marginTop: 14 }}>
        <button type="submit" className="linkish">
          Not you? Start again
        </button>
      </form>
    </Sheet>
  );
}
