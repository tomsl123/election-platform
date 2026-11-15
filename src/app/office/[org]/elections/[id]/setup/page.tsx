import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { atLeast, requireOffice } from "@/lib/auth";
import { isEditable } from "@/lib/elections";
import { toLocalInput } from "@/lib/format";
import { SIGNALS, NOTICE_KEYS, parseNotices, parsePolicy, parseRoutes, type Signal } from "@/lib/types";
import { Check, Field, Radio, Sheet } from "@/components/office/ui";
import { ShowWhen, Submit } from "@/components/office/client";
import { duplicateElectionAction, saveSetupAction } from "../../actions";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

const SIGNAL_TEXT: Record<Signal, [string, string]> = {
  VPN: ["VPN", "Address of a commercial VPN"],
  TOR: ["Tor", "Address of a Tor exit"],
  DATACENTER: ["Datacenter", "Address of a hosting provider, not a home or phone line"],
  PROXY_API: ["Proxy (lookup)", "The lookup service says residential proxy"],
  DEVICE_REPEAT: ["Same device", "This browser already checked in under another identity"],
  DEVICE_SIMILAR: ["Similar device", "A browser with the same fingerprint already checked in"],
  IP_SHARED: ["Shared address", "Several voters on one address (threshold below)"],
  DISPOSABLE_EMAIL: ["Throwaway e-mail", "The address is from a disposable mail service"],
  NO_MX: ["Dead e-mail domain", "The domain cannot receive mail"],
  TOO_FAST: ["Too fast", "Papers were cast in under four seconds"],
  LOOKUP_FAILED: ["Lookup failed", "The lookup service could not be reached"],
};

const NOTICE_TEXT: Record<(typeof NOTICE_KEYS)[number], string> = {
  announce: "Announce on Discord when scheduled",
  invite: "E-mail invitations when the roll is published",
  opened: "Tell voters when the polls open",
  closingSoon: "Remind voters who have not voted before the close",
  result: "Send the result when counted and certified",
  envelope: "Tell a voter when their held envelope is decided",
  heldDigest: "Tell officers when envelopes are waiting",
};

export default async function SetupPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const { org, role } = await requireOffice(slug);
  const e = await db.election.findFirst({ where: { id, orgId: org.id } });
  if (!e) notFound();
  const sets = await db.districtSet.findMany({ where: { orgId: org.id }, include: { _count: { select: { districts: true } } } });
  const routes = parseRoutes(e.routes);
  const policy = parsePolicy(e.fraud, e.access as "PUBLIC" | "INVITE");
  const notices = parseNotices(e.notices);
  const roles = JSON.parse(e.discordRoleIds || "[]") as string[];
  const tz = org.timezone;
  const locked = !isEditable(e) || !atLeast(role, "OFFICER");

  return (
    <form action={saveSetupAction}>
      <input type="hidden" name="org" value={org.slug} />
      <input type="hidden" name="id" value={e.id} />
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 20 }}>
        <div className="grid2">
          <Sheet title={<h2>The election</h2>}>
            <div className="stack">
              <Field label="Title">
                <input name="title" defaultValue={e.title} required />
              </Field>
              <Field label="Address" hint={`/o/${org.slug}/e/…`}>
                <input name="slug" defaultValue={e.slug} pattern="[a-z0-9\-]+" />
              </Field>
              <Field label="Summary" hint="Shown on the notice board">
                <textarea name="summary" defaultValue={e.summary} rows={2} />
              </Field>
              <div className="fields">
                <Field label="Polls open" hint={`${tz}; empty = by hand`}>
                  <input type="datetime-local" name="opensAt" defaultValue={toLocalInput(e.opensAt, tz)} />
                </Field>
                <Field label="Polls close" hint="Empty = by hand">
                  <input type="datetime-local" name="closesAt" defaultValue={toLocalInput(e.closesAt, tz)} />
                </Field>
              </div>
            </div>
          </Sheet>

          <Sheet title={<h2>Who may vote, and how they get in</h2>}>
            <div className="stack">
              <fieldset className="group">
                <legend>Voters</legend>
                <Radio name="access" value="PUBLIC" label="The public" hint="Anyone with a verified e-mail address, guarded by the fraud checks" defaultChecked={e.access === "PUBLIC"} />
                <Radio name="access" value="INVITE" label="Only those on the roll" hint="The register, a list, code cards, or a Discord role" defaultChecked={e.access === "INVITE"} />
              </fieldset>
              <fieldset className="group">
                <legend>Ways in</legend>
                <ShowWhen field="access" equals={["PUBLIC"]}>
                  <Check name="route.EMAIL_CODE" label="E-mail code" hint="A 6-digit code to the voter's address" defaultChecked={routes.includes("EMAIL_CODE")} />
                </ShowWhen>
                <Check name="route.LINK" label="One-time link" hint="A personal link by e-mail; works once" defaultChecked={routes.includes("LINK")} />
                <Check name="route.ACCOUNT" label="Signed-in account" hint="Voters sign in with an account whose e-mail is on the roll" defaultChecked={routes.includes("ACCOUNT")} />
                <Check name="route.CODE" label="Code cards" hint="Printed or messaged one-time codes" defaultChecked={routes.includes("CODE")} />
                <Check name="route.DISCORD" label="Discord role" hint="Members of your server holding a role below" defaultChecked={routes.includes("DISCORD")} />
              </fieldset>
              <ShowWhen field="route.DISCORD" equals={["on"]}>
                <div className="fields">
                  <Field label="Discord role ids" hint="Separated by spaces">
                    <input name="discordRoleIds" defaultValue={roles.join(" ")} />
                  </Field>
                  <Field label="Minimum account age (days)">
                    <input name="discordMinAgeDays" type="number" min={0} defaultValue={e.discordMinAgeDays} />
                  </Field>
                </div>
              </ShowWhen>
            </div>
          </Sheet>
        </div>

        <div className="grid2">
          <Sheet title={<h2>What is made public</h2>}>
            <div className="stack">
              <fieldset className="group">
                <legend>Ballots</legend>
                <Radio name="transparency" value="SECRET" label="Secret" hint="Nobody's name is ever shown" defaultChecked={e.transparency === "SECRET"} />
                <Radio name="transparency" value="WHO_VOTED" label="Who voted" hint="The register of who has voted is public; choices stay secret" defaultChecked={e.transparency === "WHO_VOTED"} />
                <Radio name="transparency" value="SHOW_OF_HANDS" label="Show of hands" hint="Each voter's name is shown with their choices" defaultChecked={e.transparency === "SHOW_OF_HANDS"} />
              </fieldset>
              <ShowWhen field="transparency" equals={["SHOW_OF_HANDS"]}>
                <Check name="handsLive" label="Hands go up live" hint="Otherwise the named choices are published when the polls close" defaultChecked={e.handsLive} />
              </ShowWhen>
              <fieldset className="group">
                <legend>Results</legend>
                <Radio name="resultsMode" value="SEALED" label="Sealed until the close" hint="Then counted in front of everyone" defaultChecked={e.resultsMode === "SEALED"} />
                <Radio name="resultsMode" value="LIVE" label="Live" hint="The tally grows as ballots drop" defaultChecked={e.resultsMode === "LIVE"} />
              </fieldset>
              <Check name="turnoutLive" label="Show turnout while the polls are open" defaultChecked={e.turnoutLive} />
              <Check name="allowRevote" label="Voters may vote again until the close" hint="Only their last visit counts" defaultChecked={e.allowRevote} />
            </div>
          </Sheet>

          <Sheet title={<h2>Constituencies</h2>}>
            <div className="stack">
              <Field label="District set" hint="Optional: voters belong to a district and get its papers">
                <select name="districtSetId" defaultValue={e.districtSetId ?? ""}>
                  <option value="">None: one national ballot</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s._count.districts})
                    </option>
                  ))}
                </select>
              </Field>
              <fieldset className="group">
                <legend>How voters get their district</legend>
                <Radio name="districtAssign" value="NONE" label="They don't" defaultChecked={e.districtAssign === "NONE"} />
                <Radio name="districtAssign" value="REGISTER" label="From the register or the roll" defaultChecked={e.districtAssign === "REGISTER"} />
                <Radio name="districtAssign" value="SELF" label="They choose it at the desk" hint="For public elections" defaultChecked={e.districtAssign === "SELF"} />
              </fieldset>
              <hr className="rule" />
              <h3>Second rounds</h3>
              <p className="small muted">When a paper ends without a majority, a second round is drawn up with the two leaders.</p>
              <div className="fields">
                <Field label="Opens hours after the count" hint="Empty = draft only">
                  <input name="runoffAfterHours" type="number" min={0} defaultValue={e.runoffAfterHours ?? ""} />
                </Field>
                <Field label="Stays open (hours)">
                  <input name="runoffLastsHours" type="number" min={1} defaultValue={e.runoffLastsHours ?? ""} />
                </Field>
              </div>
              <hr className="rule" />
              <h3>Nominations</h3>
              <p className="small muted">Optional. Candidates register themselves between these times; you approve them.</p>
              <div className="fields">
                <Field label="Open">
                  <input type="datetime-local" name="nominationsOpenAt" defaultValue={toLocalInput(e.nominationsOpenAt, tz)} />
                </Field>
                <Field label="Close">
                  <input type="datetime-local" name="nominationsCloseAt" defaultValue={toLocalInput(e.nominationsCloseAt, tz)} />
                </Field>
              </div>
            </div>
          </Sheet>
        </div>

        <Sheet title={<h2>Guarding against repeat voting</h2>} lede="For each sign, what happens to the visit: refuse it at the door, hold the ballots in an envelope for you to decide, or ignore the sign.">
          <div className="ledger-wrap">
            <table className="ledger">
              <tbody>
                {SIGNALS.map((s) => (
                  <tr key={s}>
                    <td>
                      <b>{SIGNAL_TEXT[s][0]}</b>
                      <div className="small muted">{SIGNAL_TEXT[s][1]}</div>
                    </td>
                    <td className="num">
                      <span className="toggle3" role="radiogroup" aria-label={SIGNAL_TEXT[s][0]}>
                        {(["BLOCK", "HOLD", "IGNORE"] as const).map((a) => (
                          <label key={a}>
                            <input type="radio" name={`fraud.${s}`} value={a} defaultChecked={policy.actions[s] === a} />
                            <span className={a.toLowerCase()}>{a === "BLOCK" ? "refuse" : a === "HOLD" ? "hold" : "ignore"}</span>
                          </label>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="fields" style={{ marginTop: 14 }}>
            <Field label="Shared address threshold" hint="This many other voters on one address raises the sign">
              <input name="ipSharedThreshold" type="number" min={1} defaultValue={policy.ipSharedThreshold} />
            </Field>
            <Field label="Undecided envelopes at the count">
              <select name="heldDefault" defaultValue={e.heldDefault}>
                <option value="WAIT">Wait: counting needs every envelope decided</option>
                <option value="ACCEPT">Count them</option>
                <option value="REJECT">Set them aside</option>
              </select>
            </Field>
          </div>
        </Sheet>

        <Sheet title={<h2>Notices</h2>}>
          <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {NOTICE_KEYS.map((k) => (
              <Check key={k} name={`notice.${k}`} label={NOTICE_TEXT[k]} defaultChecked={notices[k]} />
            ))}
            <Field label="Remind this many minutes before the close">
              <input name="closingSoonMinutes" type="number" min={0} defaultValue={notices.closingSoonMinutes} />
            </Field>
          </div>
        </Sheet>

        {locked ? null : (
          <div className="row end">
            <Submit>Save the setup</Submit>
          </div>
        )}
      </fieldset>
      {atLeast(role, "OFFICER") ? (
        <div className="row end" style={{ marginTop: 10 }}>
          <button formAction={duplicateElectionAction} className="btn ghost sm">
            Copy as a new draft
          </button>
        </div>
      ) : null}
    </form>
  );
}
