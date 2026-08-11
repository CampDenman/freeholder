// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Connected accounts (MASTER.md §41), stage 1: somewhere safe to put a token.
//
// No provider yet. What exists here is the model, the encryption, and the
// operations an owner performs on a connection *after* it has been made —
// which is deliberately the order §41's roadmap puts them in, because a place
// to keep a credential should be built before the thing that fetches one.
//
// `connections.record` is the seam the OAuth callback will use. It takes
// tokens directly, which reads oddly as an API endpoint and is not one in
// practice: the callback runs server-side and calls it through `ctx.call`.
// It is a service rather than a bare function so that permissions, validation,
// the transaction and the audit row all apply to the moment a credential
// enters the system — which is exactly the moment they should.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  connectedAccounts,
  connectionCapabilities,
} from "@/core/connections/schema";
import {
  decryptSecret,
  encryptSecret,
  needsRotation,
} from "@/core/connections/crypto";
import { violates } from "@/core/db/errors";
import {
  defineService,
  hasModuleAccess,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";
import type { Database } from "@/core/db";

/**
 * A handle that can run a query — a transaction, or the pool itself.
 *
 * The sync layer calls these from inside a mutation and doctor calls them from
 * outside one, and both are legitimate. Naming the union is cheaper than
 * making every caller open a transaction it does not need.
 */
type Queryable = Tx | Database;

const CAPABILITIES = [
  "calendar_read",
  "calendar_write",
  "mail_read",
  "mail_send",
  "contacts_read",
  "files_read",
] as const;

/**
 * A connection is a person's, so only that person — or the owner — may act on
 * it. The owner is included because they are accountable for the instance and
 * need to be able to disconnect something on their way out of a staff
 * relationship; what they cannot do is *read* it, which no service offers.
 */
async function reachable(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<{ id: string; userId: string }> {
  if (actor.kind === "agent") {
    throw new ServiceError(
      "permission",
      "An API key cannot manage connected accounts. Sign in to manage them.",
    );
  }
  const [row] = await tx
    .select({ id: connectedAccounts.id, userId: connectedAccounts.userId })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, id))
    .limit(1);
  if (!row) throw new ServiceError("not_found", "No such connected account.");

  const isHolder = actor.kind === "user" && actor.userId === row.userId;
  const canManage = hasModuleAccess(actor, "connections", "manage");
  if (!isHolder && !canManage && actor.kind !== "system") {
    throw new ServiceError("not_found", "No such connected account.");
  }
  return row;
}

/**
 * Every connection this caller may see.
 *
 * Never selects `credentials`. A token has no business in a response body, and
 * the surest way to keep one out of a log, a cache or a browser devtools panel
 * is for the query never to ask for it.
 */
export const listConnections = defineService({
  name: "connections.list",
  summary: "The third-party accounts connected to this site.",
  kind: "query",
  permission: "scoped",
  input: z.object({ mine: z.boolean().default(true) }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An API key cannot read connected accounts.",
      );
    }
    if (
      !input.mine &&
      !hasModuleAccess(ctx.actor, "connections", "manage") &&
      ctx.actor.kind !== "system"
    ) {
      throw new ServiceError(
        "permission",
        "Manage access is required to list another person's connections.",
      );
    }
    const onlyMine =
      input.mine && ctx.actor.kind === "user"
        ? eq(connectedAccounts.userId, ctx.actor.userId)
        : undefined;

    return ctx.tx
      .select({
        id: connectedAccounts.id,
        userId: connectedAccounts.userId,
        provider: connectedAccounts.provider,
        email: connectedAccounts.email,
        displayName: connectedAccounts.displayName,
        kind: connectedAccounts.kind,
        scopesGranted: connectedAccounts.scopesGranted,
        status: connectedAccounts.status,
        lastError: connectedAccounts.lastError,
        sharedWithBusiness: connectedAccounts.sharedWithBusiness,
        detailVisibility: connectedAccounts.detailVisibility,
        lastSyncAt: connectedAccounts.lastSyncAt,
        createdAt: connectedAccounts.createdAt,
      })
      .from(connectedAccounts)
      .where(onlyMine)
      .orderBy(asc(connectedAccounts.provider), asc(connectedAccounts.email));
  },
});

/**
 * Record a connection and its credentials.
 *
 * Called by the provider layer once a consent flow has completed. The row id
 * is generated here rather than defaulted by the column because the ciphertext
 * is bound to it (crypto.ts) — the id has to exist before the encryption does.
 */
export const recordConnection = defineService({
  name: "connections.record",
  summary: "Store a completed connection and its credentials.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    userId: z.uuid(),
    provider: z.enum(["google", "microsoft", "apple", "caldav", "imap"]),
    providerAccountId: z.string().min(1).max(200),
    email: z.email().max(320).nullish(),
    displayName: z.string().max(200).nullish(),
    kind: z.enum(["personal", "business"]).default("personal"),
    scopesGranted: z.array(z.string().min(1).max(200)).max(50).default([]),
    /** The refresh/access token bundle, as the provider returned it. */
    credentials: z.record(z.string(), z.unknown()),
    capabilities: z.array(z.enum(CAPABILITIES)).max(10).default([]),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An API key cannot connect an account.",
      );
    }
    // A person may connect their own account; the owner may record one on
    // behalf of somebody only through the system path, which the OAuth
    // callback uses after establishing who consented.
    if (
      ctx.actor.kind === "user" &&
      ctx.actor.userId !== input.userId &&
      !hasModuleAccess(ctx.actor, "connections", "manage")
    ) {
      throw new ServiceError(
        "permission",
        "You can only connect an account to your own profile.",
      );
    }

    const id = randomUUID();
    const encrypted = encryptSecret(JSON.stringify(input.credentials), id);

    const [row] = await ctx.tx
      .insert(connectedAccounts)
      .values({
        id,
        userId: input.userId,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        email: input.email ?? null,
        displayName: input.displayName ?? null,
        kind: input.kind,
        scopesGranted: input.scopesGranted,
        credentials: encrypted,
        status: "active",
      })
      .returning({ id: connectedAccounts.id })
      .catch((error: unknown) => {
        if (violates(error, "connected_accounts_provider_idx")) {
          throw new ServiceError(
            "conflict",
            "That account is already connected. Reconnect it instead of adding it twice.",
          );
        }
        throw error;
      });

    if (input.capabilities.length > 0) {
      await ctx.tx.insert(connectionCapabilities).values(
        input.capabilities.map((capability) => ({
          connectedAccountId: id,
          capability,
          grantedAt: new Date(),
        })),
      );
    }

    ctx.setSubject("connected_account", row!.id);
    // The payload names the provider and the account, never the token — the
    // audit trail is read by people and copied into support threads.
    ctx.queueEvent("connection.recorded", {
      id: row!.id,
      provider: input.provider,
      email: input.email ?? null,
    });
    return { id: row!.id };
  },
});

/**
 * The decrypted credentials for one account.
 *
 * Not a service, and deliberately so: there is no caller outside this process
 * that should ever receive one, so exposing it through the registry would put
 * it in the HTTP API and the MCP tool list by construction (§28). The sync
 * layer imports this function; nothing else may.
 */
export async function readCredentials(
  tx: Queryable,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await tx
    .select({ credentials: connectedAccounts.credentials })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, accountId))
    .limit(1);
  if (!row?.credentials) return null;
  return JSON.parse(decryptSecret(row.credentials, accountId)) as Record<
    string,
    unknown
  >;
}

/** Replace the stored credentials — after a token refresh, or a reconnect. */
export async function writeCredentials(
  tx: Queryable,
  accountId: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  await tx
    .update(connectedAccounts)
    .set({
      credentials: encryptSecret(JSON.stringify(credentials), accountId),
      status: "active",
      lastError: null,
    })
    .where(eq(connectedAccounts.id, accountId));
}

export const setConnectionOptions = defineService({
  name: "connections.setOptions",
  summary: "Change what a connection shares and how much detail it syncs.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.uuid(),
    kind: z.enum(["personal", "business"]).optional(),
    sharedWithBusiness: z.boolean().optional(),
    detailVisibility: z.enum(["busy_only", "full"]).optional(),
  }),
  handler: async (input, ctx) => {
    const { id, ...changes } = input;
    await reachable(ctx.tx, ctx.actor, id);
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "connections.setOptions: nothing to change");
    }

    const [row] = await ctx.tx
      .update(connectedAccounts)
      .set(changes)
      .where(eq(connectedAccounts.id, id))
      .returning({
        id: connectedAccounts.id,
        detailVisibility: connectedAccounts.detailVisibility,
        sharedWithBusiness: connectedAccounts.sharedWithBusiness,
        kind: connectedAccounts.kind,
      });

    ctx.setSubject("connected_account", id);
    ctx.queueEvent("connection.updated", { id });
    return row!;
  },
});

export const setCapability = defineService({
  name: "connections.setCapability",
  summary: "Turn one thing a connection is used for on or off.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.uuid(),
    capability: z.enum(CAPABILITIES),
    enabled: z.boolean(),
  }),
  handler: async (input, ctx) => {
    await reachable(ctx.tx, ctx.actor, input.id);
    const [row] = await ctx.tx
      .insert(connectionCapabilities)
      .values({
        connectedAccountId: input.id,
        capability: input.capability,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [
          connectionCapabilities.connectedAccountId,
          connectionCapabilities.capability,
        ],
        set: { enabled: input.enabled },
      })
      .returning();

    ctx.setSubject("connected_account", input.id);
    ctx.queueEvent("connection.updated", { id: input.id });
    return row!;
  },
});

/**
 * Disconnect.
 *
 * The row goes, and the credentials with it. Keeping a revoked connection
 * "for the history" would mean keeping a token nobody intends to use, which is
 * the kind of tidiness that turns into a breach notification.
 */
export const removeConnection = defineService({
  name: "connections.remove",
  summary: "Disconnect an account and forget its credentials.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  handler: async (input, ctx) => {
    await reachable(ctx.tx, ctx.actor, input.id);
    const [row] = await ctx.tx
      .delete(connectedAccounts)
      .where(eq(connectedAccounts.id, input.id))
      .returning({
        id: connectedAccounts.id,
        provider: connectedAccounts.provider,
      });

    ctx.setSubject("connected_account", input.id);
    ctx.queueEvent("connection.removed", { id: input.id, provider: row!.provider });
    return row!;
  },
});

/**
 * Mark a connection as needing the owner's attention.
 *
 * §41: a revoked grant is a state, not an error. The sync layer calls this
 * when a provider says no, and the briefing (§42) reads it.
 */
export const flagConnection = defineService({
  name: "connections.flag",
  summary: "Record that a connection stopped working.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.uuid(),
    status: z.enum(["needs_reconnect", "revoked"]),
    reason: z.string().max(500),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .update(connectedAccounts)
      .set({ status: input.status, lastError: input.reason })
      .where(eq(connectedAccounts.id, input.id))
      .returning({ id: connectedAccounts.id });
    if (!row) throw new ServiceError("not_found", "No such connected account.");

    ctx.setSubject("connected_account", input.id);
    ctx.queueEvent("connection.needsAttention", {
      id: input.id,
      status: input.status,
    });
    return row;
  },
});

/**
 * Re-encrypt everything under the current key.
 *
 * §41 requires rotation to be a supported operation rather than a reinstall.
 * Rows already written with the current key are skipped, so an interrupted
 * rotation resumes rather than restarting, and running it twice is harmless.
 */
export const rotateCredentials = defineService({
  name: "connections.rotateCredentials",
  summary: "Re-encrypt stored credentials under the current key.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An API key cannot rotate credentials.",
      );
    }

    const rows = await ctx.tx
      .select({
        id: connectedAccounts.id,
        credentials: connectedAccounts.credentials,
      })
      .from(connectedAccounts)
      .where(isNotNull(connectedAccounts.credentials));

    let rotated = 0;
    let failed = 0;
    for (const row of rows) {
      if (!row.credentials) continue;
      if (!needsRotation(row.credentials, row.id)) continue;
      try {
        const plain = decryptSecret(row.credentials, row.id);
        await ctx.tx
          .update(connectedAccounts)
          .set({ credentials: encryptSecret(plain, row.id) })
          .where(eq(connectedAccounts.id, row.id));
        rotated += 1;
      } catch {
        // A row the previous key cannot open either is a row whose key is
        // gone. It is counted and left alone: destroying it would remove the
        // only record that the connection exists, and the owner needs to see
        // it in order to reconnect.
        failed += 1;
        await ctx.tx
          .update(connectedAccounts)
          .set({
            status: "needs_reconnect",
            lastError:
              "Stored credentials could not be read with the configured key. Reconnect this account.",
          })
          .where(eq(connectedAccounts.id, row.id));
      }
    }

    ctx.setSubject("connected_account", "all");
    ctx.queueEvent("connection.rotated", { rotated, failed });
    return { examined: rows.length, rotated, failed };
  },
});

/**
 * Whether anything is connected at all — read by doctor, cheaply.
 *
 * Takes no transaction because its only caller is outside one: doctor runs a
 * series of independent probes, not a mutation.
 */
export async function hasConnections(): Promise<boolean> {
  const { db } = await import("@/core/db");
  const [row] = await db()
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .limit(1);
  return Boolean(row);
}

/** The capabilities actually switched on for an account. */
export async function enabledCapabilities(
  tx: Queryable,
  accountId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ capability: connectionCapabilities.capability })
    .from(connectionCapabilities)
    .where(
      and(
        eq(connectionCapabilities.connectedAccountId, accountId),
        eq(connectionCapabilities.enabled, true),
      ),
    );
  return rows.map((row) => row.capability);
}

export default [
  listConnections,
  recordConnection,
  setConnectionOptions,
  setCapability,
  removeConnection,
  flagConnection,
  rotateCredentials,
];
