// Single-purpose secret links and codes. Only hashes are stored.
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { randomToken, sha256 } from "./crypto";

export type TokenPurpose = "INVITE" | "RESET" | "VOTE" | "EMAIL_CODE" | "SSO_NONCE" | "OAUTH_STATE" | "NOMINATION" | "SUPPORT";

export async function createToken(
  purpose: TokenPurpose,
  data: Omit<Prisma.TokenUncheckedCreateInput, "purpose" | "tokenHash"> & { raw?: string },
  tx: Tx | typeof db = db,
): Promise<{ raw: string; id: string }> {
  const { raw: given, ...rest } = data;
  const raw = given ?? randomToken(24);
  const row = await tx.token.create({ data: { ...rest, purpose, tokenHash: sha256(`${purpose}:${raw}`) } });
  return { raw, id: row.id };
}

/** A token that is still good: right purpose, not used, not expired. */
export async function findToken(purpose: TokenPurpose, raw: string) {
  if (!raw || raw.length > 200) return null;
  const row = await db.token.findUnique({ where: { tokenHash: sha256(`${purpose}:${raw}`) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= new Date()) return null;
  return row;
}

export function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
