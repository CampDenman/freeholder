// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// API keys (MASTER.md §11, §26, §28).
//
// The credential an agent, a script or an external app presents instead of a
// session cookie. §11 already decided what a key *means*: `Actor` has had an
// `agent` kind with `scopes` since the registry was written, and `permits()`
// resolves `contacts.create` and `contacts.*` against it. So this table is
// only the missing half — the secret, and who is allowed to say they hold it.
//
// Hashed at rest, exactly as sessions and reset tokens are. A database leak
// must not hand somebody a working key for every integration on the instance.
// The hash is HMAC-SHA-256 under SESSION_SECRET rather than scrypt: unlike a
// password, a key is 32 bytes of machine-generated randomness, so there is no
// dictionary to slow down and a per-request scrypt would tax every API call
// for nothing.
//
// `prefix` is the part shown back to a human. A key is displayed exactly once,
// at creation, and after that an owner needs some way to tell "the Zapier one"
// from "the one on the laptop" when deciding which to revoke — so the first
// few characters are stored in the clear on purpose.
import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * What this key is for, in the owner's words: "Zapier", "the till". It is
     * also what the audit trail records as the actor (`agent:<name>`), so a
     * blank or duplicated name would make the log unreadable — hence notNull
     * and a unique index over the live ones.
     */
    name: text("name").notNull(),
    /** HMAC-SHA-256 of the token under SESSION_SECRET. Never the token. */
    tokenHash: text("token_hash").notNull(),
    /** "fh_live_a1b2c3" — enough to recognise, not enough to use. */
    prefix: text("prefix").notNull(),
    /**
     * Service names or `<module>.*` families, read by `permits()`.
     *
     * An empty array is a real and useful state: a key with no scopes can call
     * exactly what an anonymous visitor can, which is how you hand somebody a
     * credential for a public read without also handing them the contact list.
     */
    scopes: text("scopes").array().notNull().default(sql`'{}'`),
    /** The owner who minted it. Kept when they leave; the key is the business's. */
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Updated on use, best-effort and outside the caller's transaction.
     * "Last seen three months ago" is what an owner needs to answer the only
     * question that matters about an old key: is anything still using it?
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** Optional. A key for a one-off migration should not outlive it. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /**
     * Revoked keys are kept rather than deleted, so the audit rows that name
     * them still resolve to something. A deleted key turns every action it
     * ever took into "agent:unknown".
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("api_keys_token_hash_idx").on(t.tokenHash),
    index("api_keys_prefix_idx").on(t.prefix),
    // Names are unique among the keys still in use, not for all time: a
    // revoked "Zapier" must not stop an owner minting its replacement.
    uniqueIndex("api_keys_live_name_idx")
      .on(t.name)
      .where(sql`${t.revokedAt} is null`),
  ],
);
