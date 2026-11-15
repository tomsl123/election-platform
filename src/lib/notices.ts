// The election's notices, by e-mail and on Discord, at each milestone. Each one respects the
// election's switches (Setup → Notices). One-time links are only ever sent by e-mail.
import type { Election, Organisation } from "@prisma/client";
import { db } from "./db";
import { decrypt } from "./crypto";
import { fmtDateTime } from "./format";
import { queueDiscord, queueMail } from "./notify";
import { issueLink } from "./roll";
import { absoluteUrl, getSettings } from "./settings";
import { parseNotices, parseRoutes } from "./types";
import type { Result } from "./count";

type WithOrg = Election & { org: Organisation };

async function load(electionId: string): Promise<WithOrg | null> {
  return db.election.findUnique({ where: { id: electionId }, include: { org: true } });
}

const station = (e: WithOrg) => `/o/${e.org.slug}/e/${e.slug}`;

function when(e: WithOrg) {
  const tz = e.org.timezone;
  return [e.opensAt ? `Polls open ${fmtDateTime(e.opensAt, tz)}.` : "", e.closesAt ? `Polls close ${fmtDateTime(e.closesAt, tz)}.` : ""].filter(Boolean).join(" ");
}

/** Short lines naming each paper's outcome, for e-mail and Discord. */
export function summary(result: Result): string[] {
  return result.contests.map((c) => {
    const t = c.national;
    const name = (id: string) => c.options.find((o) => o.id === id)?.name ?? "?";
    if (c.scope === "PER_DISTRICT" && t.byParty) {
      const parties = Object.entries(t.byParty).sort((a, b) => b[1].seats - a[1].seats).map(([pid, p]) => `${c.options.find((o) => o.partyId === pid)?.subtitle ?? pid} ${p.seats}`);
      return `${c.title}: ${parties.join(", ")}`;
    }
    if (t.outcome === "RUNOFF") return `${c.title}: second round between ${(t.finalists ?? []).map(name).join(" and ")}`;
    if (t.outcome === "TIED") return `${c.title}: a tie`;
    if (t.seats) return `${c.title}: ${Object.entries(t.seats).filter(([, n]) => n > 0).map(([id, n]) => `${name(id)} ${n}`).join(", ")}`;
    return `${c.title}: ${t.winners.map(name).join(", ") || "no result"}`;
  });
}

/** Lines of an invite-only roll who still have to vote, with their address. */
async function waitingVoters(e: Election) {
  const lines = await db.rollEntry.findMany({ where: { electionId: e.id, status: { in: ["INVITED", "CHECKED_IN"] }, emailEnc: { not: null } } });
  return lines.map((l) => ({ line: l, to: decrypt(l.emailEnc) })).filter((x): x is { line: typeof x.line; to: string } => !!x.to);
}

export async function noticeScheduled(electionId: string) {
  const e = await load(electionId);
  if (!e || !parseNotices(e.notices).announce) return;
  await queueDiscord(e.org, { kind: "ANNOUNCE", title: e.title, body: [e.summary, when(e)].filter(Boolean).join("\n"), link: station(e), mentionRole: true, color: "brass" });
}

export async function noticeOpened(electionId: string) {
  const e = await load(electionId);
  if (!e) return;
  const n = parseNotices(e.notices);
  if (!n.opened) return;
  await queueDiscord(e.org, { kind: "OPENED", title: `Polls open: ${e.title}`, body: [e.summary, e.closesAt ? `Polls close ${fmtDateTime(e.closesAt, e.org.timezone)}.` : ""].filter(Boolean).join("\n"), link: station(e), mentionRole: true, color: "curtain" });
  if (e.access !== "INVITE") return;
  const settings = await getSettings();
  const routes = parseRoutes(e.routes);
  for (const { line, to } of await waitingVoters(e)) {
    const link = routes.includes("LINK") ? absoluteUrl(settings, await issueLink(e, line.id)) : null;
    await queueMail(e.org, to, "OPENED", `${e.org.shortName}: the polls are open for ${e.title}`, {
      heading: e.title,
      stamp: "Polls open",
      lines: [e.closesAt ? `Polls close ${fmtDateTime(e.closesAt, e.org.timezone)}.` : "The polls are open.", link ? "This link is yours alone and works once. Any earlier link no longer works." : "Sign in with this e-mail address to vote."],
      cta: { label: "Enter the polling station", url: link ?? absoluteUrl(settings, station(e)) },
    });
  }
}

export async function noticeClosingSoon(electionId: string) {
  const e = await load(electionId);
  if (!e || !parseNotices(e.notices).closingSoon) return;
  const voted = await db.rollEntry.count({ where: { electionId: e.id, status: { in: ["VOTED", "HELD"] } } });
  const closes = e.closesAt ? fmtDateTime(e.closesAt, e.org.timezone) : "soon";
  await queueDiscord(e.org, { kind: "CLOSING", title: `Closing soon: ${e.title}`, body: `Polls close ${closes}.`, link: station(e), color: "red", fields: e.turnoutLive ? [{ name: "Voted", value: String(voted), inline: true }] : undefined });
  if (e.access !== "INVITE") return;
  const settings = await getSettings();
  const routes = parseRoutes(e.routes);
  for (const { line, to } of await waitingVoters(e)) {
    const link = routes.includes("LINK") ? absoluteUrl(settings, await issueLink(e, line.id)) : null;
    await queueMail(e.org, to, "CLOSING", `${e.org.shortName}: last call for ${e.title}`, {
      heading: e.title,
      stamp: "Closing soon",
      lines: [`Your ballot has not been cast. Polls close ${closes}.`],
      cta: { label: "Enter the polling station", url: link ?? absoluteUrl(settings, station(e)) },
    });
  }
}

export async function noticeResult(electionId: string, stage: "counted" | "certified") {
  const e = await load(electionId);
  if (!e?.result || !parseNotices(e.notices).result) return;
  const lines = summary(JSON.parse(e.result) as Result);
  const results = `${station(e)}/results`;
  await queueDiscord(e.org, { kind: stage === "counted" ? "COUNTED" : "CERTIFIED", title: `${stage === "counted" ? "Counted" : "Certified"}: ${e.title}`, body: lines.join("\n"), link: results, color: stage === "counted" ? "blue" : "curtain" });
  if (stage !== "certified" || e.access !== "INVITE") return;
  const settings = await getSettings();
  const voters = await db.rollEntry.findMany({ where: { electionId: e.id, emailEnc: { not: null } } });
  for (const v of voters) {
    const to = decrypt(v.emailEnc);
    if (!to) continue;
    await queueMail(e.org, to, "RESULT", `${e.org.shortName}: the result of ${e.title}`, { heading: e.title, stamp: "Certified", lines, cta: { label: "See the count", url: absoluteUrl(settings, results) } });
  }
}

/** At most hourly: tell the officers how many envelopes wait in the tray. */
export async function noticeHeldDigest(now: Date) {
  const elections = await db.election.findMany({ where: { status: { in: ["OPEN", "CLOSED"] }, envelopes: { some: { status: "HELD" } } }, include: { org: true } });
  const settings = await getSettings();
  for (const e of elections) {
    if (!parseNotices(e.notices).heldDigest) continue;
    if (e.heldDigestAt && now.getTime() - e.heldDigestAt.getTime() < 3600_000) continue;
    const waiting = await db.envelope.count({ where: { electionId: e.id, status: "HELD", createdAt: { gt: e.heldDigestAt ?? new Date(0) } } });
    await db.election.update({ where: { id: e.id }, data: { heldDigestAt: now } });
    if (!waiting) continue;
    const staff = await db.orgMember.findMany({ where: { orgId: e.orgId, role: { in: ["OWNER", "OFFICER"] } }, include: { user: true } });
    for (const s of staff) {
      await queueMail(e.org, s.user.email, "HELD_DIGEST", `${e.org.shortName}: ${waiting} envelope${waiting === 1 ? "" : "s"} wait in the tray`, {
        heading: e.title,
        stamp: "Held envelopes",
        lines: [`${waiting} new visit${waiting === 1 ? " was" : "s were"} held for your decision.`],
        cta: { label: "Open the tray", url: absoluteUrl(settings, `/office/${e.org.slug}/elections/${e.id}/held`) },
      });
    }
  }
}
