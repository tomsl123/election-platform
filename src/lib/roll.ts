// The roll of an election: who may vote, and how each person gets in.
// Invite-only elections build it from the register, a CSV list, code cards, or a Discord role.
import { randomInt } from "node:crypto";
import type { Election, Organisation } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { encrypt, sha256 } from "./crypto";
import { emailKey, emailKeyHash, isEmail, maskEmail, normaliseEmail } from "./email";
import { assertEditable, ElectionError } from "./elections";
import { createToken } from "./tokens";
import type { Actor } from "./action";

/** The identity keys a person may already hold on this roll, best match first. */
export async function identityCandidates(orgId: string, who: { email?: string | null; discordId?: string | null }): Promise<string[]> {
  const keys: string[] = [];
  if (who.email) {
    const reg = await db.registerEntry.findFirst({ where: { orgId, emailKey: emailKey(who.email), status: "ACTIVE" } });
    if (reg) keys.push(`reg:${reg.id}`);
    keys.push(`email:${emailKeyHash(who.email)}`);
  }
  if (who.discordId) {
    const reg = await db.registerEntry.findFirst({ where: { orgId, discordUserId: who.discordId, status: "ACTIVE" } });
    if (reg) keys.push(`reg:${reg.id}`);
    keys.push(`discord:${who.discordId}`);
  }
  return [...new Set(keys)];
}

/** Finds this person's line on the roll by any of their keys, or by their e-mail hash. */
export async function findRollLine(electionId: string, keys: string[], email?: string | null) {
  if (keys.length) {
    const hit = await db.rollEntry.findFirst({ where: { electionId, identityKey: { in: keys } } });
    if (hit) return hit;
  }
  if (email) return db.rollEntry.findFirst({ where: { electionId, emailKeyHash: emailKeyHash(email) } });
  return null;
}

function lineData(email: string | null) {
  return email
    ? { emailEnc: encrypt(normaliseEmail(email)), emailMasked: maskEmail(email), emailKeyHash: emailKeyHash(email) }
    : {};
}

/** Adds every active register entry (optionally of one district) to the roll. */
export async function addFromRegister(org: Organisation, e: Election, actor: Actor, districtId: string | null) {
  assertEditable(e);
  const entries = await db.registerEntry.findMany({
    where: { orgId: org.id, status: "ACTIVE", ...(districtId ? { districts: { some: { districtId } } } : {}) },
    include: { districts: true },
  });
  let added = 0;
  for (const r of entries) {
    const identityKey = `reg:${r.id}`;
    const exists = await db.rollEntry.findUnique({ where: { electionId_identityKey: { electionId: e.id, identityKey } } });
    if (exists) continue;
    const district = e.districtSetId ? (r.districts.find((d) => d.setId === e.districtSetId)?.districtId ?? null) : null;
    await db.rollEntry.create({
      data: { electionId: e.id, identityKey, route: "LINK", registerEntryId: r.id, userId: r.userId, displayName: r.displayName, districtId: district, ...lineData(r.email) },
    });
    added++;
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "roll.from_register", entity: "Election", entityId: e.id, ip: actor.ip, details: { added, districtId } });
  return added;
}

/** "email,name,district" per line (name and district optional). District is matched by code or name. */
export async function addFromCsv(org: Organisation, e: Election, actor: Actor, text: string) {
  assertEditable(e);
  const districts = e.districtSetId ? await db.district.findMany({ where: { setId: e.districtSetId } }) : [];
  let added = 0;
  const problems: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [n, line] of lines.entries()) {
    const cells = line.split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const email = cells[0] ?? "";
    if (n === 0 && !isEmail(email) && /mail/i.test(email)) continue; // header row
    if (!isEmail(email)) {
      problems.push(`Line ${n + 1}: "${email}" is not an e-mail address.`);
      continue;
    }
    const name = cells[1] || email.split("@")[0];
    let districtId: string | null = null;
    if (cells[2]) {
      const d = districts.find((x) => x.code.toLowerCase() === cells[2].toLowerCase() || x.name.toLowerCase() === cells[2].toLowerCase());
      if (!d) problems.push(`Line ${n + 1}: no district "${cells[2]}".`);
      districtId = d?.id ?? null;
    }
    const keys = await identityCandidates(org.id, { email });
    if (await findRollLine(e.id, keys, email)) continue;
    await db.rollEntry.create({ data: { electionId: e.id, identityKey: keys[0], route: "LINK", displayName: name.slice(0, 80), districtId, registerEntryId: keys[0].startsWith("reg:") ? keys[0].slice(4) : null, ...lineData(email) } });
    added++;
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "roll.imported", entity: "Election", entityId: e.id, ip: actor.ip, details: { added, problems: problems.length } });
  return { added, problems };
}

export async function removeFromRoll(org: Organisation, e: Election, actor: Actor, rollEntryId: string) {
  assertEditable(e);
  const line = await db.rollEntry.findFirst({ where: { id: rollEntryId, electionId: e.id } });
  if (!line) return;
  await db.rollEntry.delete({ where: { id: line.id } });
  await db.token.deleteMany({ where: { purpose: "VOTE", rollEntryId: line.id } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "roll.removed", entity: "Election", entityId: e.id, ip: actor.ip, details: { name: line.displayName } });
}

export async function clearRoll(org: Organisation, e: Election, actor: Actor) {
  assertEditable(e);
  const n = await db.rollEntry.deleteMany({ where: { electionId: e.id } });
  await db.token.deleteMany({ where: { purpose: "VOTE", electionId: e.id } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "roll.cleared", entity: "Election", entityId: e.id, ip: actor.ip, details: { removed: n.count } });
}

// ── One-time links ──────────────────────────────────────────────────────────

function linkExpiry(e: Election): Date {
  return e.closesAt ?? new Date(Date.now() + 60 * 86400_000);
}

/** A fresh one-time voting link for one line of the roll (any earlier link of that line stops working). */
export async function issueLink(e: Election, rollEntryId: string): Promise<string> {
  await db.token.deleteMany({ where: { purpose: "VOTE", rollEntryId } });
  const { raw } = await createToken("VOTE", { electionId: e.id, rollEntryId, expiresAt: linkExpiry(e) });
  return `/v/${raw}`;
}

// ── Code cards ──────────────────────────────────────────────────────────────

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}
export const codeHash = (electionId: string, raw: string) => sha256(`code:${electionId}:${normaliseCode(raw)}`);

export async function generateCodes(org: Organisation, e: Election, actor: Actor, count: number, districtId: string | null, label: string) {
  assertEditable(e);
  if (count < 1 || count > 2000) throw new ElectionError("Make between 1 and 2000 cards at a time.");
  const batch = new Date().toISOString().slice(0, 16).replace("T", " ");
  for (let i = 0; i < count; i++) {
    let raw = "";
    for (let k = 0; k < 8; k++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const pretty = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    await db.accessCode.create({ data: { electionId: e.id, codeHash: codeHash(e.id, pretty), codeEnc: encrypt(pretty), batch, label: label.slice(0, 60), districtId } });
  }
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "codes.generated", entity: "Election", entityId: e.id, ip: actor.ip, details: { count, districtId, batch } });
  return batch;
}

export async function removeCodeBatch(org: Organisation, e: Election, actor: Actor, batch: string) {
  assertEditable(e);
  const n = await db.accessCode.deleteMany({ where: { electionId: e.id, batch, usedAt: null } });
  await audit({ orgId: org.id, actorId: actor.id, actorLabel: actor.label, action: "codes.removed", entity: "Election", entityId: e.id, ip: actor.ip, details: { batch, removed: n.count } });
}
