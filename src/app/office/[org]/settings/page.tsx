import { db } from "@/lib/db";
import { requireOffice } from "@/lib/auth";
import { orgBrand, orgDiscord, orgSmtp, orgUctv } from "@/lib/org";
import { brandStyle } from "@/lib/brand";
import { BRAND_COLORS, ORG_ROLES } from "@/lib/types";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { fmtDateTime } from "@/lib/format";
import { Crest } from "@/components/Crest";
import { Check, Empty, Field, Sheet } from "@/components/office/ui";
import { ConfirmSubmit, CopyText, Submit } from "@/components/office/client";
import { SmtpForm } from "@/components/office/SmtpForm";
import {
  addWebhookAction,
  changeStaffAction,
  createApiKeyAction,
  inviteStaffAction,
  removeApiKeyAction,
  removeWebhookAction,
  saveBrandAction,
  saveDiscordAction,
  saveOrgAction,
  saveOrgSmtpAction,
  saveUctvAction,
  testDiscordAction,
  testMailAction,
} from "./actions";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const COLOR_LABEL: Record<string, string> = {
  curtain: "Curtain",
  curtainLight: "Curtain fold",
  wood: "Booth wood",
  shelf: "Shelf",
  brass: "Brass",
  ink: "Ink",
  wax: "Wax seal",
  box: "Ballot box",
};

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ invite?: string; key?: string; hooksecret?: string }> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const { org, auth } = await requireOffice(slug, "OWNER");
  const brand = orgBrand(org);
  const smtp = orgSmtp(org);
  const discord = orgDiscord(org);
  const uctv = orgUctv(org);
  const [staff, keys, hooks] = await Promise.all([
    db.orgMember.findMany({ where: { orgId: org.id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    db.apiKey.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "asc" } }),
    db.webhook.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const hidden = { org: org.slug };
  const words = Object.entries(brand.words)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");

  return (
    <>
      <div className="grid2">
        <Sheet title={<h2>The organisation</h2>}>
          <form action={saveOrgAction} className="stack">
            <input type="hidden" name="org" value={org.slug} />
            <Field label="Name">
              <input name="name" defaultValue={org.name} required />
            </Field>
            <div className="fields">
              <Field label="Short name">
                <input name="shortName" defaultValue={org.shortName} maxLength={16} />
              </Field>
              <Field label="Time zone" hint="Times are shown and entered in this zone">
                <input name="timezone" defaultValue={org.timezone} />
              </Field>
            </div>
            <p className="small muted">
              Public address: <a href={`/o/${org.slug}`}>/o/{org.slug}</a>
            </p>
            <div className="row end">
              <Submit>Save</Submit>
            </div>
          </form>
        </Sheet>

        <Sheet title={<h2>Staff</h2>} lede="Owners manage settings and staff. Officers run elections. Observers can only read.">
          {sp.invite ? (
            <div className="memo" style={{ marginBottom: 14 }}>
              <b>Link</b>
              <code style={{ wordBreak: "break-all" }}>{sp.invite}</code> <CopyText text={sp.invite} />
            </div>
          ) : null}
          <div className="ledger-wrap">
            <table className="ledger">
              <tbody>
                {staff.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.user.displayName}
                      <div className="small muted">{m.user.email}</div>
                    </td>
                    <td>
                      <form action={changeStaffAction} className="row">
                        <input type="hidden" name="org" value={org.slug} />
                        <input type="hidden" name="member" value={m.id} />
                        <select name="role" defaultValue={m.role} aria-label="Role" style={{ font: "inherit", background: "transparent", border: 0, borderBottom: "1px solid" }}>
                          {ORG_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r.toLowerCase()}
                            </option>
                          ))}
                        </select>
                        <Submit className="btn sm">Set</Submit>
                        {m.userId !== auth.user.id ? (
                          <ConfirmSubmit confirm="Remove?" name="op" value="remove">
                            Remove
                          </ConfirmSubmit>
                        ) : null}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={inviteStaffAction} className="stack" style={{ marginTop: 16 }}>
            <input type="hidden" name="org" value={org.slug} />
            <div className="fields">
              <Field label="E-mail">
                <input name="email" type="email" required />
              </Field>
              <Field label="Name">
                <input name="displayName" />
              </Field>
              <Field label="Role">
                <select name="role" defaultValue="OFFICER">
                  {ORG_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="row end">
              <Submit>Invite</Submit>
            </div>
          </form>
        </Sheet>
      </div>

      <Sheet title={<h2>Colours and crest</h2>} lede="How the polling station looks for this organisation.">
        <form action={saveBrandAction} className="stack" encType="multipart/form-data">
          <input type="hidden" name="org" value={org.slug} />
          <div className="grid2">
            <div className="stack">
              <div className="brand-preview" style={brandStyle(brand)} aria-hidden="true">
                <div className="bp-curtain">
                  <div className="bp-plate">
                    <Crest uploadId={brand.crestUploadId} />
                  </div>
                </div>
                <div className="bp-booth">
                  <div className="bp-paper" />
                </div>
              </div>
              <Field label="Crest" hint="PNG, JPEG or WebP, up to 2 MB. Transparent PNG works best.">
                <input type="file" name="crest" accept="image/png,image/jpeg,image/webp" />
              </Field>
              {brand.crestUploadId ? <Check name="removeCrest" label="Use the default crest instead" /> : null}
            </div>
            <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
              {BRAND_COLORS.map((k) => (
                <Field key={k} label={COLOR_LABEL[k]}>
                  <input type="color" name={`color.${k}`} defaultValue={brand.colors[k]} />
                </Field>
              ))}
            </div>
          </div>
          <Field label="Paper tints" hint="One colour per ballot paper, in order (hex, separated by spaces)">
            <input name="tints" defaultValue={brand.tints.join(" ")} />
          </Field>
          <div className="tints" aria-hidden="true">
            {brand.tints.map((t) => (
              <span key={t} className="swatch" style={{ background: t, width: 26, height: 26, borderRadius: 3 }} />
            ))}
          </div>
          <Field label="Own wording" hint={'One per line, e.g. "station.plate = Cliff Polling Station" or "certify.by = the President"'}>
            <textarea name="words" defaultValue={words} rows={3} />
          </Field>
          <div className="row end">
            <Submit>Hang the colours</Submit>
          </div>
        </form>
      </Sheet>

      <div className="grid2">
        <Sheet title={<h2>Mail</h2>} lede="Off here means the platform's mail is used." aside={<form action={testMailAction}><input type="hidden" name="org" value={org.slug} /><Submit className="btn sm">Send a test</Submit></form>}>
          <SmtpForm action={saveOrgSmtpAction} smtp={smtp} hidden={hidden} />
        </Sheet>
        <Sheet title={<h2>Discord</h2>} aside={<form action={testDiscordAction}><input type="hidden" name="org" value={org.slug} /><Submit className="btn sm">Post a test</Submit></form>}>
          <form action={saveDiscordAction} className="stack">
            <input type="hidden" name="org" value={org.slug} />
            <Check name="enabled" label="Post announcements" defaultChecked={discord.enabled} />
            <Field label="Webhook address" hint={discord.webhookUrl ? "Stored. Leave empty to keep it." : "Channel settings → Integrations → Webhooks"}>
              <input name="webhookUrl" type="password" autoComplete="off" />
            </Field>
            <div className="fields">
              <Field label="Bot name">
                <input name="botName" defaultValue={discord.botName} />
              </Field>
              <Field label="Role to mention" hint="Role id">
                <input name="roleId" defaultValue={discord.roleId} inputMode="numeric" />
              </Field>
            </div>
            <hr className="rule" />
            <p className="small muted">For elections whose roll is a Discord role: an application under discord.com/developers with the redirect address /api/discord/callback.</p>
            <div className="fields">
              <Field label="Server (guild) id">
                <input name="guildId" defaultValue={discord.guildId} inputMode="numeric" />
              </Field>
              <Field label="Application id">
                <input name="clientId" defaultValue={discord.clientId} inputMode="numeric" />
              </Field>
              <Field label="Client secret" hint={discord.clientSecret ? "Stored. Leave empty to keep it." : undefined}>
                <input name="clientSecret" type="password" autoComplete="off" />
              </Field>
            </div>
            <div className="row end">
              <Submit>Save Discord</Submit>
            </div>
          </form>
        </Sheet>
      </div>

      <Sheet title={<h2 id="api">API, webhooks and UCTV</h2>}>
        {sp.key ? (
          <div className="memo" style={{ marginBottom: 14 }}>
            <b>New key</b>
            <code style={{ wordBreak: "break-all" }}>{sp.key}</code> <CopyText text={sp.key} />
          </div>
        ) : null}
        {sp.hooksecret ? (
          <div className="memo" style={{ marginBottom: 14 }}>
            <b>Signing secret</b>
            <code style={{ wordBreak: "break-all" }}>{sp.hooksecret}</code> <CopyText text={sp.hooksecret} />
          </div>
        ) : null}
        <div className="grid2">
          <div className="stack">
            <h3>API keys</h3>
            <p className="small muted">
              Read keys see everything public; manage keys can also open and close elections. Docs: <a href="/api/docs">/api/docs</a>
            </p>
            {keys.length === 0 ? (
              <Empty>No keys.</Empty>
            ) : (
              <table className="ledger">
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        {k.name} <span className="pill">{k.scope.toLowerCase()}</span>
                        <div className="small muted">{k.lastUsedAt ? `Used ${fmtDateTime(k.lastUsedAt, org.timezone)}` : "Never used"}</div>
                      </td>
                      <td className="num">
                        <form action={removeApiKeyAction}>
                          <input type="hidden" name="org" value={org.slug} />
                          <input type="hidden" name="id" value={k.id} />
                          <ConfirmSubmit confirm="Remove?">Remove</ConfirmSubmit>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={createApiKeyAction} className="row">
              <input type="hidden" name="org" value={org.slug} />
              <label className="field" style={{ flex: 1 }}>
                <span>Name</span>
                <input name="name" placeholder="Results bot" />
              </label>
              <select name="scope" aria-label="Scope" defaultValue="READ">
                <option value="READ">read</option>
                <option value="MANAGE">manage</option>
              </select>
              <Submit className="btn sm">Create</Submit>
            </form>
          </div>
          <div className="stack">
            <h3>Webhooks</h3>
            <p className="small muted">Signed with the header X-PS-Signature: sha256=…</p>
            {hooks.length === 0 ? (
              <Empty>No webhooks.</Empty>
            ) : (
              <table className="ledger">
                <tbody>
                  {hooks.map((h) => (
                    <tr key={h.id}>
                      <td className="small" style={{ wordBreak: "break-all" }}>
                        {h.url}
                      </td>
                      <td className="num">
                        <form action={removeWebhookAction}>
                          <input type="hidden" name="org" value={org.slug} />
                          <input type="hidden" name="id" value={h.id} />
                          <ConfirmSubmit confirm="Remove?">Remove</ConfirmSubmit>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={addWebhookAction} className="stack">
              <input type="hidden" name="org" value={org.slug} />
              <Field label="Address">
                <input name="url" type="url" required placeholder="https://bot.example.org/hook" />
              </Field>
              <div className="row">
                {WEBHOOK_EVENTS.map((e) => (
                  <label key={e} className="check small">
                    <input type="checkbox" name="events" value={e} defaultChecked />
                    <span>{e}</span>
                  </label>
                ))}
              </div>
              <div className="row end">
                <Submit className="btn sm">Add webhook</Submit>
              </div>
            </form>
          </div>
        </div>
        <hr className="rule" />
        <h3>UCTV Elections</h3>
        <form action={saveUctvAction} className="stack" style={{ marginTop: 10 }}>
          <input type="hidden" name="org" value={org.slug} />
          <Check name="enabled" label="Send counted results to UCTV" defaultChecked={uctv.enabled} />
          <div className="fields">
            <Field label="UCTV address">
              <input name="baseUrl" defaultValue={uctv.baseUrl} placeholder="https://elections.uctv.example" />
            </Field>
            <Field label="Control API key" hint={uctv.apiKey ? "Stored. Leave empty to keep it." : "uctv_… with control rights"}>
              <input name="apiKey" type="password" autoComplete="off" />
            </Field>
          </div>
          <Check name="autoSend" label="Send automatically when an election is counted" defaultChecked={uctv.autoSend} />
          <div className="row end">
            <Submit>Save UCTV</Submit>
          </div>
        </form>
      </Sheet>
    </>
  );
}
