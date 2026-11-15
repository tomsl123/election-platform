"use server";
import { db } from "@/lib/db";
import { audit, verifyJournal } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { actorFrom, flag, go, int, oneOf, slugify, str } from "@/lib/action";
import { saveSettings } from "@/lib/settings";
import { refreshIpLists } from "@/lib/ipintel";

export async function createOrgAction(fd: FormData) {
  const auth = await requirePlatformAdmin();
  const name = str(fd, "name", 120);
  const shortName = str(fd, "shortName", 16) || name.slice(0, 16);
  const slug = slugify(str(fd, "slug", 48) || shortName);
  if (name.length < 2 || !slug) go("/platform", "err", "Give the organisation a name and an address.");
  if (await db.organisation.findUnique({ where: { slug } })) go("/platform", "err", `The address /o/${slug} is taken.`);
  const org = await db.organisation.create({ data: { name, shortName, slug } });
  const actor = await actorFrom(auth);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "org.created", entity: "Organisation", entityId: org.id, ip: actor.ip });
  go(`/office/${slug}/settings`, "ok", `${name} is founded. Give it its colours and staff.`);
}

export async function savePlatformAction(fd: FormData) {
  const auth = await requirePlatformAdmin();
  const group = str(fd, "group");
  if (group === "site") {
    await saveSettings("site", { name: str(fd, "name", 80) || "Polling Station", baseUrl: str(fd, "baseUrl", 200).replace(/\/+$/, "") });
  } else if (group === "smtp") {
    await saveSettings("smtp", {
      enabled: flag(fd, "enabled"),
      transport: oneOf(str(fd, "transport"), ["smtp", "file"] as const, "smtp"),
      host: str(fd, "host", 200),
      port: int(fd, "port", 587, 1, 65535),
      secure: flag(fd, "secure"),
      user: str(fd, "user", 200),
      pass: str(fd, "pass", 300) || undefined,
      fromName: str(fd, "fromName", 80),
      fromAddress: str(fd, "fromAddress", 200),
    });
  } else if (group === "security") {
    await saveSettings("security", { sessionHours: int(fd, "sessionHours", 72, 1, 24 * 60), loginAttempts: int(fd, "loginAttempts", 8, 3, 100), inviteDays: int(fd, "inviteDays", 7, 1, 60) });
  } else if (group === "iplists") {
    await saveSettings("iplists", {
      torUrl: str(fd, "torUrl", 300),
      vpnUrl: str(fd, "vpnUrl", 300),
      datacenterUrl: str(fd, "datacenterUrl", 300),
      provider: oneOf(str(fd, "provider"), ["none", "proxycheck", "ipqs"] as const, "none"),
      apiKey: str(fd, "apiKey", 200) || undefined,
    });
  } else if (group === "sso") {
    const parliamentUrl = str(fd, "parliamentUrl", 200).replace(/\/+$/, "");
    const secret = str(fd, "secret", 300);
    if (parliamentUrl && !/^https?:\/\/[^\s/]+/.test(parliamentUrl)) go("/platform/settings", "err", "The Parliament address must start with http:// or https://.");
    if (secret && secret.length < 32) go("/platform/settings", "err", "The shared secret needs at least 32 characters. Generate it in Parliament.");
    await saveSettings("sso", {
      enabled: flag(fd, "enabled"),
      parliamentUrl,
      clientId: str(fd, "clientId", 80) || "polling-station",
      secret: secret || undefined,
      label: str(fd, "label", 60) || "USFC Parliament",
    });
  } else go("/platform/settings", "err", "Unknown settings group.");
  const actor = await actorFrom(auth);
  await audit({ actorId: actor.id, actorLabel: actor.label, action: "platform.settings", details: { group }, ip: actor.ip });
  go("/platform/settings", "ok", "Saved.");
}

export async function refreshListsAction() {
  await requirePlatformAdmin();
  const r = await refreshIpLists(true);
  go("/platform/health", r.ok ? "ok" : "err", r.message);
}

export async function verifyJournalAction() {
  await requirePlatformAdmin();
  const r = await verifyJournal();
  go("/platform/health", r.ok ? "ok" : "err", r.ok ? `The journal is intact: ${r.entries} entries.` : `The journal is broken at entry ${r.brokenAt}.`);
}

export async function retryOutboxAction() {
  await requirePlatformAdmin();
  await db.outbox.updateMany({ where: { status: "FAILED" }, data: { status: "PENDING", attempts: 0, nextTryAt: new Date() } });
  go("/platform/health", "ok", "Failed messages are queued again.");
}
