import type { SmtpConfig } from "@/lib/settings";
import { Check, Field } from "./ui";
import { Submit } from "./client";

/** The SMTP form, shared by the platform settings and each organisation's settings. */
export function SmtpForm({ action, smtp, hidden, intro }: { action: (fd: FormData) => Promise<void>; smtp: SmtpConfig; hidden: Record<string, string>; intro?: string }) {
  return (
    <form action={action} className="stack">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {intro ? <p className="muted small">{intro}</p> : null}
      <Check name="enabled" label="Send e-mail" defaultChecked={smtp.enabled} />
      <div className="fields">
        <Field label="Transport">
          <select name="transport" defaultValue={smtp.transport}>
            <option value="smtp">SMTP server</option>
            <option value="file">Development mailbox (data/mailbox)</option>
          </select>
        </Field>
        <Field label="Host">
          <input name="host" defaultValue={smtp.host} placeholder="smtp.example.org" />
        </Field>
        <Field label="Port">
          <input name="port" type="number" defaultValue={smtp.port} min={1} max={65535} />
        </Field>
        <Field label="User">
          <input name="user" defaultValue={smtp.user} autoComplete="off" />
        </Field>
        <Field label="Password" hint={smtp.pass ? "Stored. Leave empty to keep it." : undefined}>
          <input name="pass" type="password" autoComplete="new-password" />
        </Field>
        <Field label="Sender name">
          <input name="fromName" defaultValue={smtp.fromName} />
        </Field>
        <Field label="Sender address">
          <input name="fromAddress" type="email" defaultValue={smtp.fromAddress} />
        </Field>
      </div>
      <Check name="secure" label="Implicit TLS (port 465)" hint="Otherwise STARTTLS is required" defaultChecked={smtp.secure} />
      <div className="row end">
        <Submit>Save mail</Submit>
      </div>
    </form>
  );
}
