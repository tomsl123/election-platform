// Staff of an organisation: invitations and roles.
import { db } from "./db";
import { audit } from "./audit";
import { absoluteUrl, getSettings } from "./settings";
import { queueMail } from "./notify";
import { createToken } from "./tokens";
import { Problem } from "./problem";
import { ORG_ROLES, type OrgRole } from "./types";

export type InvitePayload = { orgId: string; role: OrgRole; displayName: string };

/** Invites a person to an organisation's staff. Existing accounts are added at once. Returns a link when mail is off. */
export async function inviteStaff(orgId: string, emailRaw: string, displayName: string, role: OrgRole, actor: { id: string; label: string }): Promise<{ added: boolean; link?: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Problem("Enter a valid e-mail address.");
  if (!ORG_ROLES.includes(role)) throw new Problem("Choose a role.");
  const org = await db.organisation.findUniqueOrThrow({ where: { id: orgId } });
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    await db.orgMember.upsert({ where: { orgId_userId: { orgId, userId: existing.id } }, create: { orgId, userId: existing.id, role }, update: { role } });
    await audit({ orgId, actorId: actor.id, actorLabel: actor.label, action: "staff.added", entity: "User", entityId: existing.id, details: { role } });
    return { added: true };
  }
  const settings = await getSettings();
  const payload: InvitePayload = { orgId, role, displayName };
  const { raw } = await createToken("INVITE", { email, payload: JSON.stringify(payload), createdBy: actor.id, expiresAt: new Date(Date.now() + settings.security.inviteDays * 86400_000) });
  const url = absoluteUrl(settings, `/invite/${raw}`);
  const sent = await queueMail(org, email, "INVITE", `You are invited to the ${org.name} election office`, {
    heading: `${org.name}: election office`,
    lines: [`${actor.label} invites you to join the election office as ${role.toLowerCase()}.`, `The link works once and lapses in ${settings.security.inviteDays} days.`],
    cta: { label: "Accept the invitation", url },
  });
  await audit({ orgId, actorId: actor.id, actorLabel: actor.label, action: "staff.invited", details: { email, role } });
  return { added: false, link: sent ? undefined : url };
}

