"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireOffice } from "@/lib/auth";
import { actorFrom, explain, flag, go, int, oneOf, str } from "@/lib/action";
import { orgBrand, saveOrgGroup } from "@/lib/org";
import { storeImage } from "@/lib/uploads";
import { BRAND_COLORS, ORG_ROLES, type Brand } from "@/lib/types";
import { inviteStaff } from "@/lib/staff";
import { deliverMail, renderEmail } from "@/lib/mailer";
import { mailFor, orgDiscord } from "@/lib/org";
import { isDiscordWebhook, postDiscord } from "@/lib/discord";
import { getSettings } from "@/lib/settings";
import { randomToken, sha256 } from "@/lib/crypto";

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function saveOrgAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings`;
  const name = str(fd, "name", 120);
  const shortName = str(fd, "shortName", 16);
  const timezone = str(fd, "timezone", 60);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    go(back, "err", "That time zone is not known.");
  }
  if (name.length < 2) go(back, "err", "Give the organisation a name.");
  await db.organisation.update({ where: { id: org.id }, data: { name, shortName: shortName || name.slice(0, 16), timezone } });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "org.renamed", ip: actor.ip });
  revalidatePath(`/office/${slug}`, "layout");
  go(back, "ok", "Saved.");
}

export async function saveBrandAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings`;
  const brand: Brand = orgBrand(org);
  for (const k of BRAND_COLORS) {
    const v = str(fd, `color.${k}`, 7);
    if (HEX.test(v)) brand.colors[k] = v.toLowerCase();
  }
  const tints = str(fd, "tints", 200)
    .split(/[\s,]+/)
    .filter((t) => HEX.test(t));
  if (tints.length) brand.tints = tints.slice(0, 12);
  const words: Record<string, string> = {};
  for (const line of str(fd, "words", 4000).split(/\r?\n/)) {
    const m = /^\s*([\w.]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (m) words[m[1]] = m[2].slice(0, 200);
  }
  brand.words = words;
  if (flag(fd, "removeCrest")) brand.crestUploadId = null;
  const file = fd.get("crest");
  if (file instanceof File && file.size > 0) {
    try {
      const up = await storeImage(org.id, file);
      brand.crestUploadId = up.id;
    } catch (err) {
      go(back, "err", explain(err));
    }
  }
  await db.organisation.update({ where: { id: org.id }, data: { brand: JSON.stringify(brand) } });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "org.brand", ip: actor.ip });
  revalidatePath(`/office/${slug}`, "layout");
  go(back, "ok", "The colours are hung.");
}

export async function saveOrgSmtpAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  await saveOrgGroup(org.id, "smtp", {
    enabled: flag(fd, "enabled"),
    transport: oneOf(str(fd, "transport"), ["smtp", "file"] as const, "smtp"),
    host: str(fd, "host", 200),
    port: int(fd, "port", 587, 1, 65535),
    secure: flag(fd, "secure"),
    user: str(fd, "user", 200),
    pass: str(fd, "pass", 300),
    fromName: str(fd, "fromName", 80),
    fromAddress: str(fd, "fromAddress", 200),
  });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "org.smtp", ip: actor.ip });
  go(`/office/${slug}/settings`, "ok", "Mail settings saved.");
}

export async function testMailAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings`;
  const smtp = await mailFor(org);
  if (!smtp.enabled) go(back, "err", "No mail is switched on, here or for the platform.");
  const settings = await getSettings();
  try {
    const { text, html } = renderEmail({ heading: "Test from the polling station", lines: [`${org.name} can send e-mail.`], footer: settings.site.name });
    await deliverMail(smtp, { to: auth.user.email, subject: `${org.shortName}: test e-mail`, text, html });
  } catch (err) {
    go(back, "err", `The test failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  go(back, "ok", `A test went to ${auth.user.email}.`);
}

export async function saveDiscordAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings`;
  const webhookUrl = str(fd, "webhookUrl", 300);
  if (webhookUrl && !isDiscordWebhook(webhookUrl)) go(back, "err", "That is not a Discord webhook address.");
  await saveOrgGroup(org.id, "discord", {
    enabled: flag(fd, "enabled"),
    webhookUrl,
    botName: str(fd, "botName", 80),
    roleId: str(fd, "roleId", 30).replace(/\D/g, ""),
    clientId: str(fd, "clientId", 40).replace(/\D/g, ""),
    clientSecret: str(fd, "clientSecret", 200),
    guildId: str(fd, "guildId", 30).replace(/\D/g, ""),
  });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "org.discord", ip: actor.ip });
  go(back, "ok", "Discord settings saved.");
}

export async function testDiscordAction(fd: FormData) {
  const slug = str(fd, "org");
  const { org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings`;
  const d = orgDiscord(org);
  if (!d.webhookUrl) go(back, "err", "Save a webhook address first.");
  try {
    await postDiscord(d.webhookUrl, { username: d.botName || org.shortName, embeds: [{ title: "Test from the polling station", description: `${org.name} can post here.`, color: 0xc9a14a }] });
  } catch (err) {
    go(back, "err", `The test failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  go(back, "ok", "A test post was sent.");
}

export async function inviteStaffAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings`;
  const actor = await actorFrom(auth);
  let result: Awaited<ReturnType<typeof inviteStaff>> | null = null;
  try {
    result = await inviteStaff(org.id, str(fd, "email", 200), str(fd, "displayName", 80), oneOf(str(fd, "role"), ORG_ROLES, "OFFICER"), actor);
  } catch (err) {
    go(back, "err", explain(err));
  }
  if (result?.added) go(back, "ok", "They already had an account and are now on the staff.");
  if (result?.link) go(`${back}?invite=${encodeURIComponent(result.link)}`, "ok", "Mail is off: hand them this link yourself.");
  go(back, "ok", "The invitation is on its way.");
}

export async function changeStaffAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings`;
  const memberId = str(fd, "member");
  const m = await db.orgMember.findFirst({ where: { id: memberId, orgId: org.id } });
  if (!m) go(back, "err", "That person is not on the staff.");
  const owners = await db.orgMember.count({ where: { orgId: org.id, role: "OWNER" } });
  const actor = await actorFrom(auth);
  if (str(fd, "op") === "remove") {
    if (m.role === "OWNER" && owners <= 1) go(back, "err", "The last owner cannot be removed.");
    await db.orgMember.delete({ where: { id: m.id } });
    await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "staff.removed", entity: "User", entityId: m.userId, ip: actor.ip });
    go(back, "ok", "Removed from the staff.");
  }
  const role = oneOf(str(fd, "role"), ORG_ROLES, m.role as (typeof ORG_ROLES)[number]);
  if (m.role === "OWNER" && role !== "OWNER" && owners <= 1) go(back, "err", "The last owner must stay an owner.");
  await db.orgMember.update({ where: { id: m.id }, data: { role } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "staff.role", entity: "User", entityId: m.userId, details: { role }, ip: actor.ip });
  go(back, "ok", "Role changed.");
}

export async function saveUctvAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  await saveOrgGroup(org.id, "uctv", { enabled: flag(fd, "enabled"), baseUrl: str(fd, "baseUrl", 200).replace(/\/+$/, ""), apiKey: str(fd, "apiKey", 300), autoSend: flag(fd, "autoSend") });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "org.uctv", ip: actor.ip });
  go(`/office/${slug}/settings`, "ok", "UCTV settings saved.");
}

export async function createApiKeyAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const name = str(fd, "name", 60) || "API key";
  const scope = oneOf(str(fd, "scope"), ["READ", "MANAGE"] as const, "READ");
  const raw = `ps_${randomToken(24)}`;
  await db.apiKey.create({ data: { orgId: org.id, name, scope, keyHash: sha256(raw) } });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "apikey.created", details: { name, scope }, ip: actor.ip });
  go(`/office/${slug}/settings?key=${encodeURIComponent(raw)}#api`, "ok", "Copy the key now. It is shown only once.");
}

export async function removeApiKeyAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  await db.apiKey.deleteMany({ where: { id: str(fd, "id"), orgId: org.id } });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "apikey.removed", ip: actor.ip });
  go(`/office/${slug}/settings#api`, "ok", "Key removed.");
}

export async function addWebhookAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  const back = `/office/${slug}/settings#api`;
  const url = str(fd, "url", 300);
  const { webhookUrlProblem } = await import("@/lib/webhooks");
  const problem = webhookUrlProblem(url);
  if (problem) go(back, "err", problem);
  const events = fd.getAll("events").map(String);
  const secret = randomToken(24);
  const { encrypt } = await import("@/lib/crypto");
  await db.webhook.create({ data: { orgId: org.id, url, secretEnc: encrypt(secret), events: JSON.stringify(events) } });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "webhook.added", details: { url }, ip: actor.ip });
  go(`/office/${slug}/settings?hooksecret=${encodeURIComponent(secret)}#api`, "ok", "Webhook added. Copy its signing secret now.");
}

export async function removeWebhookAction(fd: FormData) {
  const slug = str(fd, "org");
  const { auth, org } = await requireOffice(slug, "OWNER");
  await db.webhook.deleteMany({ where: { id: str(fd, "id"), orgId: org.id } });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "webhook.removed", ip: actor.ip });
  go(`/office/${slug}/settings#api`, "ok", "Webhook removed.");
}
