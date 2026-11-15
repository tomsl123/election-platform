// Publishing the roll of an invite-only election: each voter is told how to get in
// (their own one-time link, or signing in), by e-mail.
import type { Organisation } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { decrypt } from "./crypto";
import { fmtDateTime } from "./format";
import { queueMail } from "./notify";
import { mailFor } from "./org";
import { issueLink } from "./roll";
import { absoluteUrl, getSettings } from "./settings";
import { assertEditable, ElectionError } from "./elections";
import { parseNotices, parseRoutes } from "./types";
import type { Actor } from "./action";

export async function publishRoll(org: Organisation, electionId: string, actor: Actor): Promise<{ mailed: number }> {
  const e = await db.election.findFirstOrThrow({ where: { id: electionId, orgId: org.id } });
  assertEditable(e);
  if (e.access !== "INVITE") throw new ElectionError("Only invite-only elections have a roll to publish.");
  const lines = await db.rollEntry.findMany({ where: { electionId: e.id } });
  if (lines.length === 0) throw new ElectionError("The roll is empty.");
  await db.election.update({ where: { id: e.id }, data: { rollPublishedAt: new Date() } });
  const routes = parseRoutes(e.routes);
  const notices = parseNotices(e.notices);
  const smtp = await mailFor(org);
  let mailed = 0;
  if (smtp.enabled && notices.invite) {
    const settings = await getSettings();
    const when = e.opensAt ? `Polls open ${fmtDateTime(e.opensAt, org.timezone)}${e.closesAt ? ` and close ${fmtDateTime(e.closesAt, org.timezone)}` : ""}.` : e.closesAt ? `Polls close ${fmtDateTime(e.closesAt, org.timezone)}.` : "";
    const station = absoluteUrl(settings, `/o/${org.slug}/e/${e.slug}`);
    for (const line of lines) {
      const to = decrypt(line.emailEnc);
      if (!to) continue;
      const link = routes.includes("LINK") ? absoluteUrl(settings, await issueLink(e, line.id)) : null;
      await queueMail(org, to, "INVITE_VOTE", `${org.shortName}: your ballot for ${e.title}`, {
        heading: e.title,
        stamp: "Your ballot",
        lines: [`${line.displayName ? line.displayName + ", y" : "Y"}ou are on the roll.`, when, link ? "This link is yours alone. It lets you vote once. Do not forward it." : "Sign in with this e-mail address to vote."].filter(Boolean),
        cta: link ? { label: "Enter the polling station", url: link } : { label: "Go to the polling station", url: station },
      });
      mailed++;
    }
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "roll.published", entity: "Election", entityId: e.id, ip: actor.ip, details: { lines: lines.length, mailed } });
  return { mailed };
}
