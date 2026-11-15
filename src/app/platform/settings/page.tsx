import { absoluteUrl, getSettings } from "@/lib/settings";
import { Check, Field, Sheet } from "@/components/office/ui";
import { Submit } from "@/components/office/client";
import { SmtpForm } from "@/components/office/SmtpForm";
import { savePlatformAction } from "../actions";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

export default async function PlatformSettingsPage() {
  const s = await getSettings(true);
  return (
    <>
      <div className="grid2">
        <Sheet title={<h2>The site</h2>}>
          <form action={savePlatformAction} className="stack">
            <input type="hidden" name="group" value="site" />
            <Field label="Name">
              <input name="name" defaultValue={s.site.name} />
            </Field>
            <Field label="Public address" hint="Used in e-mail and Discord links">
              <input name="baseUrl" defaultValue={s.site.baseUrl} />
            </Field>
            <div className="row end">
              <Submit>Save</Submit>
            </div>
          </form>
        </Sheet>
        <Sheet title={<h2>Accounts</h2>}>
          <form action={savePlatformAction} className="stack">
            <input type="hidden" name="group" value="security" />
            <div className="fields">
              <Field label="Session hours">
                <input name="sessionHours" type="number" defaultValue={s.security.sessionHours} />
              </Field>
              <Field label="Sign-in attempts / 15 min">
                <input name="loginAttempts" type="number" defaultValue={s.security.loginAttempts} />
              </Field>
              <Field label="Invitations last (days)">
                <input name="inviteDays" type="number" defaultValue={s.security.inviteDays} />
              </Field>
            </div>
            <div className="row end">
              <Submit>Save</Submit>
            </div>
          </form>
        </Sheet>
      </div>
      <Sheet title={<h2>Platform mail</h2>} lede="Account e-mail, and every organisation that has no mail of its own.">
        <SmtpForm action={savePlatformAction} smtp={s.smtp} hidden={{ group: "smtp" }} />
      </Sheet>
      <Sheet title={<h2>VPN and proxy detection</h2>} lede="Local lists are always used and refreshed daily. A lookup service adds residential-proxy detection; voters' addresses are then sent to it.">
        <form action={savePlatformAction} className="stack">
          <input type="hidden" name="group" value="iplists" />
          <Field label="Tor exit list">
            <input name="torUrl" defaultValue={s.iplists.torUrl} />
          </Field>
          <Field label="VPN ranges">
            <input name="vpnUrl" defaultValue={s.iplists.vpnUrl} />
          </Field>
          <Field label="Datacenter ranges">
            <input name="datacenterUrl" defaultValue={s.iplists.datacenterUrl} />
          </Field>
          <div className="fields">
            <Field label="Lookup service">
              <select name="provider" defaultValue={s.iplists.provider}>
                <option value="none">None (local lists only)</option>
                <option value="proxycheck">proxycheck.io</option>
                <option value="ipqs">IPQualityScore</option>
              </select>
            </Field>
            <Field label="API key" hint={s.iplists.apiKey ? "Stored. Leave empty to keep it." : undefined}>
              <input name="apiKey" type="password" autoComplete="off" />
            </Field>
          </div>
          <div className="row end">
            <Submit>Save</Submit>
          </div>
        </form>
      </Sheet>
      <Sheet title={<h2>Shared sign-in</h2>} lede="Members of USFC Parliament sign in here with their Parliament account. Parliament must have the same client id and secret under Tech admin.">
        <form action={savePlatformAction} className="stack">
          <input type="hidden" name="group" value="sso" />
          <Check name="enabled" label="Offer shared sign-in" defaultChecked={s.sso.enabled} />
          <div className="fields">
            <Field label="Parliament address">
              <input name="parliamentUrl" defaultValue={s.sso.parliamentUrl} placeholder="https://parliament.example.org" />
            </Field>
            <Field label="Button label">
              <input name="label" defaultValue={s.sso.label} />
            </Field>
            <Field label="Client id">
              <input name="clientId" defaultValue={s.sso.clientId} />
            </Field>
            <Field label="Shared secret" hint={s.sso.secret ? "Stored. Leave empty to keep it." : "At least 32 characters"}>
              <input name="secret" type="password" autoComplete="off" />
            </Field>
          </div>
          <p className="small">
            Return address to enter in Parliament: <code>{absoluteUrl(s, "/api/sso/parliament/callback")}</code>
          </p>
          <div className="row end">
            <Submit>Save</Submit>
          </div>
        </form>
      </Sheet>
    </>
  );
}
