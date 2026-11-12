// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Minting and recognising an API key (MASTER.md §26).
//
// Separate from the service so that verification — which runs on every single
// API request — does not drag the service layer, the audit writer and a
// transaction in behind it. Verification is one indexed lookup and one HMAC.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { apiKeys } from "@/core/apikeys/schema";
import { contacts } from "@/core/contacts/schema";

/**
 * The visible prefix. `fh` names the platform in somebody's environment file,
 * and `live` leaves room for a `test` band later without reissuing anything.
 *
 * It is also what makes a leaked key findable: secret scanners match on fixed
 * prefixes, so a key pasted into a public repository can be recognised as a
 * Freeholder key by a scanner that has never heard of this instance.
 */
export const KEY_PREFIX = "fh_live_";

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    // The same secret sessions use. Failing loudly is right: a key hashed
    // under an empty secret is a key anybody can forge.
    throw new Error(
      "SESSION_SECRET is not set, so API keys cannot be hashed. See .env.example.",
    );
  }
  return value;
}

export function hashApiKey(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}

export interface MintedKey {
  /** Shown once, at creation, and never recoverable afterwards. */
  token: string;
  tokenHash: string;
  prefix: string;
}

/**
 * A new key.
 *
 * 32 bytes of randomness, base64url so it survives a shell, an environment
 * variable and a JSON file without escaping.
 */
export function mintApiKey(): MintedKey {
  const token = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashApiKey(token),
    // Long enough to be distinctive in a list, short enough to be useless: 6
    // characters of a 43-character secret.
    prefix: token.slice(0, KEY_PREFIX.length + 6),
  };
}

export interface VerifiedKey {
  id: string;
  name: string;
  scopes: string[];
  /** C12.14: a personal key acts as this person. */
  actsAsUserId: string | null;
}

/**
 * The key behind a presented token, if it is live.
 *
 * Returns undefined for absent, malformed, unknown, expired and revoked alike.
 * Distinguishing them would tell somebody probing which of their guesses was
 * closest, and none of the distinctions helps a legitimate caller — who either
 * holds a working key or does not.
 */
export async function verifyApiKey(
  token: string | undefined,
): Promise<VerifiedKey | undefined> {
  if (!token || !token.startsWith(KEY_PREFIX)) return undefined;

  const [row] = await db()
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      tokenHash: apiKeys.tokenHash,
      actsAsUserId: apiKeys.actsAsUserId,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.tokenHash, hashApiKey(token)),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`)),
        sql`not exists(select 1 from ${contacts} where ${contacts.userId}=${apiKeys.actsAsUserId} and ${contacts.source}='privacy-erasure')`,
      ),
    )
    .limit(1);
  if (!row) return undefined;

  // The lookup was already by hash, so this comparison can only fail on a
  // hash collision. It is here because comparing secrets with `===` is a habit
  // worth not having: the next person to touch this file may widen the query.
  const presented = Buffer.from(hashApiKey(token));
  const stored = Buffer.from(row.tokenHash);
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    return undefined;
  }

  return { id: row.id, name: row.name, scopes: row.scopes, actsAsUserId: row.actsAsUserId };
}

/**
 * Record that a key was used.
 *
 * Best-effort telemetry outside the business transaction. Complete our own
 * write before returning the authenticated actor, so a guarded operation
 * cannot mistake that write for a concurrent authorization change. Busy rows
 * are skipped and recent use is debounced; failures never fail authentication.
 */
const pendingTouches = new Map<string, Promise<void>>();
export function touchApiKey(id: string): Promise<void> {
  const active = pendingTouches.get(id);
  if (active) return active;
  const writing = (async () => {
    try {
      await db().execute(sql`
        with candidate as (
          select ${apiKeys.id} from ${apiKeys}
          where ${apiKeys.id} = ${id}
            and (${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < clock_timestamp() - interval '1 minute')
          for update skip locked
        )
        update ${apiKeys} set last_used_at = clock_timestamp()
        from candidate where ${apiKeys.id} = candidate.id
      `);
    } catch (error: unknown) {
      console.warn("[apikeys] could not record last use", error);
    }
  })();
  pendingTouches.set(id, writing);
  void writing.then(() => { if (pendingTouches.get(id) === writing) pendingTouches.delete(id); });
  return writing;
}
