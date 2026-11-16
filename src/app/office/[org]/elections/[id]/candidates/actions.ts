"use server";
// Sends the candidates report by e-mail, one message per address.
import { requireOffice } from "@/lib/auth";
import { actorFrom, flag, go, str } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { normaliseEmail, parseAddresses } from "@/lib/email";
import { hit } from "@/lib/ratelimit";
import { queueCandidateReport } from "@/lib/notify";
import { plural } from "@/lib/format";

const MAX_RECIPIENTS = 50;

export async function sendReportAction(fd: FormData) {
  const slug = str(fd, "org");
  const id = str(fd, "id");
  const { org, auth } = await requireOffice(slug, "OFFICER");
  const back = `/office/${slug}/elections/${id}/candidates`;
  const e = await db.election.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
  if (!e) go(back, "err", "That election does not exist.");

  const { ok, bad } = parseAddresses(str(fd, "to", 20000));
  if (flag(fd, "me") && !ok.includes(normaliseEmail(auth.user.email))) ok.push(normaliseEmail(auth.user.email));
  if (bad.length) go(back, "err", `Not an e-mail address: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "…" : ""}`);
  if (ok.length === 0) go(back, "err", "Give at least one address.");
  if (ok.length > MAX_RECIPIENTS) go(back, "err", `At most ${MAX_RECIPIENTS} addresses at a time.`);
  const limit = await hit(`report-mail:${org.id}`, 20, 3600);
  if (!limit.ok) go(back, "err", "Too many reports sent in the last hour. Try again later.");

  const actor = await actorFrom(auth);
  const note = str(fd, "note", 2000).trim();
  let queued = 0;
  for (const to of ok) if (await queueCandidateReport(org, to, e!.id, note, auth.user.displayName || actor.label)) queued++;
  if (queued === 0) go(back, "err", "E-mail is switched off for this organisation. Switch it on in Settings.");
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "report.sent", entity: "Election", entityId: e!.id, ip: actor.ip, details: { recipients: queued } });
  go(back, "ok", `The report is on its way to ${plural(queued, "address", "addresses")}.`);
}
