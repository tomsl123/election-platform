// Nominations: between the nomination dates, candidates put themselves on a paper. They prove
// their e-mail with a code, may need supporters' signatures, and an officer approves them.
import type { Organisation } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { decrypt, encrypt, hmac, randomToken, safeEqual } from "./crypto";
import { emailKey, isEmail, normaliseEmail } from "./email";
import { queueMail } from "./notify";
import { absoluteUrl, getSettings } from "./settings";
import { createToken, findToken, sixDigits } from "./tokens";
import { Problem } from "./problem";
import { parseRule } from "./types";
import type { Actor } from "./action";
import { freezeDistricts, thawDistricts } from "./districts";

export type NominationInput = { contestId: string; districtId: string | null; name: string; subtitle: string; partyId: string | null; symbol: string; color: string; statement: string; email: string; photoId: string | null };

const CODE_MINUTES = 15;

/** Opens and closes nominations by the clock. Closing moves a ready election to READY. */
export async function nominationClock(now: Date) {
  const toOpen = await db.election.findMany({ where: { status: "DRAFT", nominationsOpenAt: { lte: now }, nominationsCloseAt: { gt: now } } });
  for (const e of toOpen) {
    await db.election.update({ where: { id: e.id }, data: { status: "NOMINATIONS" } });
    await freezeDistricts(e.id);
    await audit({ orgId: e.orgId, actorLabel: "the clock", action: "nominations.opened", entity: "Election", entityId: e.id });
  }
  const toClose = await db.election.findMany({ where: { status: "NOMINATIONS", nominationsCloseAt: { lte: now } } });
  for (const e of toClose) await closeNominations(e.id, { id: null, label: "the clock" });
}

export async function openNominations(org: Organisation, electionId: string, actor: Actor) {
  const e = await db.election.findFirstOrThrow({ where: { id: electionId, orgId: org.id } });
  if (e.status !== "DRAFT") throw new Problem("Nominations open only from a draft.");
  await db.election.update({ where: { id: e.id }, data: { status: "NOMINATIONS" } });
  await freezeDistricts(e.id);
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "nominations.opened", entity: "Election", entityId: e.id, ip: actor.ip });
}

export async function closeNominations(electionId: string, actor: Actor) {
  const e = await db.election.findUniqueOrThrow({ where: { id: electionId }, include: { contests: { include: { options: true } } } });
  if (e.status !== "NOMINATIONS") return;
  const { openProblems, getElection } = await import("./elections");
  const full = await getElection(e.orgId, e.id);
  const ready = !!e.opensAt && full !== null && (await openProblems(full)).length === 0;
  await db.election.update({ where: { id: e.id }, data: { status: ready ? "READY" : "DRAFT" } });
  if (!ready) await thawDistricts(e.id);
  await audit({ orgId: e.orgId, actorId: actor.id, actorLabel: actor.label, action: "nominations.closed", entity: "Election", entityId: e.id, details: { next: ready ? "READY" : "DRAFT" } });
}

/** Step one: checks the nomination and mails a code to the nominee. Returns the challenge for a cookie. */
export async function fileNomination(org: Organisation, electionId: string, input: NominationInput): Promise<string> {
  const e = await db.election.findFirst({ where: { id: electionId, orgId: org.id }, include: { contests: true } });
  if (!e || e.status !== "NOMINATIONS") throw new Problem("Nominations are not open.");
  const c = e.contests.find((x) => x.id === input.contestId);
  if (!c || c.method === "YESNO") throw new Problem("Choose a paper to stand on.");
  if (c.scope === "PER_DISTRICT") {
    const d = input.districtId ? await db.district.findFirst({ where: { id: input.districtId, setId: e.districtSetId ?? "" } }) : null;
    if (!d) throw new Problem("Choose the district you stand in.");
  }
  const email = normaliseEmail(input.email);
  if (!isEmail(email)) throw new Problem("That e-mail address is not valid.");
  if (input.name.trim().length < 2) throw new Problem("Write the name to print on the paper.");
  if (input.partyId && !(await db.party.findFirst({ where: { id: input.partyId, orgId: org.id } }))) throw new Problem("That party is not known.");
  const dup = await db.option.findFirst({ where: { contestId: c.id, nominatedByEmail: emailKey(email), status: { in: ["PENDING", "APPROVED"] } } });
  if (dup) throw new Problem("A nomination from this address is already on that paper.");
  const code = sixDigits();
  const raw = randomToken(24);
  await createToken("NOMINATION", { raw, electionId: e.id, payload: JSON.stringify({ ...input, email: encrypt(email), check: hmac("nomination-code", `${raw}:${code}`) }), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) });
  const sent = await queueMail(org, email, "NOMINATION_CODE", `${code} · nomination for ${e.title}`, { heading: code, stamp: "Nomination", lines: [`Your code to confirm standing in ${e.title}.`, "It works for fifteen minutes. If you did not ask for it, ignore this message."] });
  if (!sent) throw new Problem("This office cannot send e-mail right now.");
  return raw;
}

/** Step two: the code proves the address; the nomination joins the paper, waiting for approval. */
export async function confirmNomination(org: Organisation, raw: string, code: string) {
  const tok = await findToken("NOMINATION", raw);
  if (!tok) throw new Problem("That code has expired. File the nomination again.");
  if (tok.attempts >= 5) throw new Problem("Too many wrong codes. File the nomination again.");
  const p = JSON.parse(tok.payload) as NominationInput & { check: string };
  if (!safeEqual(hmac("nomination-code", `${raw}:${code.replace(/\D/g, "")}`), p.check)) {
    await db.token.update({ where: { id: tok.id }, data: { attempts: { increment: 1 } } });
    throw new Problem("That code is not right.");
  }
  const claimed = await db.token.updateMany({ where: { id: tok.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new Problem("That nomination has already been confirmed.");
  const c = await db.contest.findUniqueOrThrow({ where: { id: p.contestId }, include: { election: true } });
  if (c.election.orgId !== org.id || c.election.status !== "NOMINATIONS") throw new Problem("Nominations have closed.");
  const email = decrypt(p.email) ?? "";
  const party = p.partyId ? await db.party.findUnique({ where: { id: p.partyId } }) : null;
  const o = await db.option.create({
    data: {
      contestId: c.id,
      districtId: c.scope === "PER_DISTRICT" ? p.districtId : null,
      name: p.name.trim().slice(0, 120),
      subtitle: (p.subtitle || party?.abbr || "").slice(0, 80),
      partyId: party?.id ?? null,
      color: /^#[0-9a-f]{6}$/i.test(p.color) && p.color !== "#23201c" ? p.color : (party?.color ?? "#23201c"),
      symbol: (p.symbol || party?.symbol || "").slice(0, 20),
      statement: p.statement.slice(0, 2000),
      photoId: p.photoId,
      status: "PENDING",
      nominatedByEmail: emailKey(email),
      position: await db.option.count({ where: { contestId: c.id } }),
    },
  });
  await audit({ orgId: org.id, actorLabel: o.name, action: "nomination.filed", entity: "Option", entityId: o.id, details: { contest: c.title } });
  const settings = await getSettings();
  const need = parseRule(c.rule).supportersRequired;
  await queueMail(org, email, "NOMINATION_FILED", `${org.shortName}: your nomination for ${c.title}`, {
    heading: c.election.title,
    stamp: "Filed",
    lines: [`Your nomination on the paper "${c.title}" is filed and waits for the returning officer.`, need ? `It needs ${need} supporters' signatures. Share the link below.` : ""].filter(Boolean),
    ...(need ? { cta: { label: "Collect signatures", url: absoluteUrl(settings, `/o/${org.slug}/e/${c.election.slug}/nominate/${o.id}`) } } : {}),
  });
  const staff = await db.orgMember.findMany({ where: { orgId: org.id, role: { in: ["OWNER", "OFFICER"] } }, include: { user: true } });
  for (const s of staff) {
    await queueMail(org, s.user.email, "NOMINATION_STAFF", `${org.shortName}: a nomination for ${c.title}`, { heading: o.name, lines: [`Filed on "${c.title}" in ${c.election.title}.`], cta: { label: "Review it", url: absoluteUrl(settings, `/office/${org.slug}/elections/${c.electionId}/papers#${c.id}`) } });
  }
  return o;
}

/** A supporter signs a nomination: a code proves their address, one signature per inbox. */
export async function requestSignature(org: Organisation, optionId: string, name: string, emailRaw: string): Promise<string> {
  const o = await db.option.findFirst({ where: { id: optionId, status: "PENDING", contest: { election: { orgId: org.id, status: "NOMINATIONS" } } } });
  if (!o) throw new Problem("That nomination is not collecting signatures.");
  const email = normaliseEmail(emailRaw);
  if (!isEmail(email)) throw new Problem("That e-mail address is not valid.");
  if (name.trim().length < 2) throw new Problem("Write your name.");
  if (await db.nominationSupport.findUnique({ where: { optionId_emailKey: { optionId, emailKey: emailKey(email) } } })) throw new Problem("You have already signed this nomination.");
  const code = sixDigits();
  const raw = randomToken(24);
  await createToken("SUPPORT", { raw, payload: JSON.stringify({ optionId, name: name.trim().slice(0, 80), email: encrypt(email), check: hmac("support-code", `${raw}:${code}`) }), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) });
  const sent = await queueMail(org, email, "SUPPORT_CODE", `${code} · signing for ${o.name}`, { heading: code, stamp: "Signature", lines: [`Your code to sign the nomination of ${o.name}.`] });
  if (!sent) throw new Problem("This office cannot send e-mail right now.");
  return raw;
}

export async function confirmSignature(raw: string, code: string) {
  const tok = await findToken("SUPPORT", raw);
  if (!tok || tok.attempts >= 5) throw new Problem("That code has expired. Start again.");
  const p = JSON.parse(tok.payload) as { optionId: string; name: string; email: string; check: string };
  if (!safeEqual(hmac("support-code", `${raw}:${code.replace(/\D/g, "")}`), p.check)) {
    await db.token.update({ where: { id: tok.id }, data: { attempts: { increment: 1 } } });
    throw new Problem("That code is not right.");
  }
  await db.token.update({ where: { id: tok.id }, data: { usedAt: new Date() } });
  const key = emailKey(decrypt(p.email) ?? "");
  try {
    await db.nominationSupport.create({ data: { optionId: p.optionId, emailKey: key, displayName: p.name } });
  } catch {
    throw new Problem("You have already signed this nomination.");
  }
}

/** Tells a nominee the officer's decision. */
export async function tellNominee(org: Organisation, optionId: string, approved: boolean) {
  const o = await db.option.findUnique({ where: { id: optionId }, include: { contest: { include: { election: true } } } });
  if (!o?.nominatedByEmail) return;
  // The stored key is the folded address; it still reaches the same inbox.
  await queueMail(org, o.nominatedByEmail, "NOMINATION_DECIDED", `${org.shortName}: your nomination for ${o.contest.title}`, {
    heading: o.contest.election.title,
    stamp: approved ? "Approved" : "Not approved",
    lines: [approved ? `You will be printed on the paper "${o.contest.title}".` : `Your nomination on "${o.contest.title}" was not approved.`],
  });
}
