import { Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { forgotAction } from "../actions";

export const metadata = { title: "Forgotten password" };

export default function ForgotPage() {
  return (
    <Sheet title="Forgotten password" lede="A link to choose a new password is sent to your address.">
      <form action={forgotAction} className="stack">
        <Field label="E-mail address">
          <input type="email" name="email" autoComplete="username" required autoFocus />
        </Field>
        <div className="row">
          <Submit>Send the link</Submit>
        </div>
      </form>
    </Sheet>
  );
}
