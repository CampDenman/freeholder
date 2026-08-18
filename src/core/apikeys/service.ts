// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// API keys (MASTER.md §11, §26, §28).
//
// Human-only and separately grant-scoped: see `refuseAgents` below.
// A key is a standing grant against the whole service registry, so minting one
// is closer to creating a user than to changing a setting.
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { apiKeys } from "@/core/apikeys/schema";
import { mintApiKey } from "@/core/apikeys/tokens";
import { violates } from "@/core/db/errors";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  defineService,
  listServices,
  ServiceError,
  type Actor,
} from "@/core/service";

/**
 * Keys cannot mint or revoke keys.
 *
 * §11's scope model deliberately gives API keys only their explicit scopes.
 * A key scoped `apikeys.*` could therefore satisfy this module like any other.
 * That is right for business services and wrong here, because it makes a
 * limited key a route to an unlimited one —
 * mint a second key with every scope, and the first key's limits were
 * decoration.
 *
 * So the boundary is stated where it matters rather than encoded in the
 * permission system: issuing credentials is something a person does. A
 * compromised key can do damage inside its scopes; it cannot widen them.
 */
function refuseAgents(actor: Actor, verb: string): void {
  if (actor.kind === "agent") {
    throw new ServiceError(
      "permission",
      `An API key cannot ${verb} API keys. Sign in with API-key management access.`,
    );
  }
}

/**
 * A scope names a service, or a whole module with `<module>.*`.
 *
 * Checked against the registry rather than accepted as free text: a scope with
 * a typo grants nothing, and it grants nothing *silently* — the key works for
 * everything public and refuses everything else, which reads as "the API is
 * broken" rather than "the scope is misspelt". The registry is the same list
 * `permits()` will consult, so agreement is guaranteed by construction.
 */
function assertKnownScopes(scopes: string[]): void {
  const services = listServices();
  const families = new Set(
    [...services.keys()].map((name) => `${name.split(".")[0]}.*`),
  );
  const unknown = scopes.filter(
    (scope) => !services.has(scope) && !families.has(scope),
  );
  if (unknown.length > 0) {
    throw new ServiceError(
      "validation",
      `No such ${unknown.length === 1 ? "capability" : "capabilities"}: ${unknown.join(", ")}. Use a service name like "contacts.create", or a whole area like "contacts.*".`,
    );
  }
}

/** Everything a key may be granted, for the admin screen's checklist. */
export const listScopes = defineService({
  name: "apikeys.scopes",
  summary: "Every capability a key can be granted.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      area: z.string(),
      family: z.string(),
      services: listed(
        row({
          name: z.string(),
          summary: z.string(),
          kind: z.enum(["query", "mutation"]),
        }),
      ),
    }),
  ),
  handler: async (_input, _ctx) => {
    const services = [...listServices().values()];
    const modules = new Map<string, { name: string; summary: string; kind: string }[]>();
    for (const service of services) {
      const area = service.def.name.split(".")[0]!;
      const list = modules.get(area) ?? [];
      list.push({
        name: service.def.name,
        summary: service.def.summary,
        kind: service.def.kind,
      });
      modules.set(area, list);
    }
    return [...modules.entries()]
      .map(([area, entries]) => ({
        area,
        family: `${area}.*`,
        services: entries.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.area.localeCompare(b.area));
  },
});

export const createApiKey = defineService({
  name: "apikeys.create",
  summary: "Mint an API key.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    name: z.string().min(1).max(80),
    scopes: z.array(z.string().min(1).max(120)).max(200).default([]),
    /** Days until it stops working. Absent means it does not expire. */
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  }),
  output: row({
    id: uuid,
    name: z.string(),
    tokenHash: z.string(),
    prefix: z.string(),
    scopes: listed(z.string()),
    createdBy: uuid.nullable(),
    lastUsedAt: timestamp.nullable(),
    expiresAt: timestamp.nullable(),
    revokedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    token: z.string(),
  }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "create");
    assertKnownScopes(input.scopes);

    const minted = mintApiKey();
    const [row] = await ctx.tx
      .insert(apiKeys)
      .values({
        name: input.name,
        tokenHash: minted.tokenHash,
        prefix: minted.prefix,
        scopes: input.scopes,
        createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        expiresAt: input.expiresInDays
          ? sql`now() + ${`${input.expiresInDays} days`}::interval`
          : null,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "api_keys_live_name_idx")) {
          throw new ServiceError(
            "conflict",
            `There is already a key called "${input.name}". Revoke it first, or pick another name.`,
          );
        }
        throw error;
      });

    ctx.setSubject("api_key", row!.id);
    ctx.queueEvent("apikey.created", { id: row!.id, name: row!.name });

    // The only time the token exists outside the caller's hands. It is not in
    // the audit trail — `redact` catches the key — and it cannot be read back
    // from any later call, because only its hash was stored.
    return { ...row!, token: minted.token };
  },
});

export const listApiKeys = defineService({
  name: "apikeys.list",
  summary: "Every API key, live and revoked.",
  kind: "query",
  permission: "scoped",
  input: z.object({ includeRevoked: z.boolean().default(false) }),
  output: listed(
    row({
      id: uuid,
      name: z.string(),
      prefix: z.string(),
      scopes: listed(z.string()),
      lastUsedAt: timestamp.nullable(),
      expiresAt: timestamp.nullable(),
      revokedAt: timestamp.nullable(),
      createdAt: timestamp,
    }),
  ),
  handler: async (input, ctx) =>
    ctx.tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(input.includeRevoked ? undefined : isNull(apiKeys.revokedAt))
      .orderBy(desc(apiKeys.createdAt)),
});

export const revokeApiKey = defineService({
  name: "apikeys.revoke",
  summary: "Stop an API key working.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  output: row({
    id: uuid,
    name: z.string(),
  }),
  handler: async (input, ctx) => {
    refuseAgents(ctx.actor, "revoke");

    const [row] = await ctx.tx
      .update(apiKeys)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(apiKeys.id, input.id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id, name: apiKeys.name });

    if (!row) {
      // Already revoked and never existed answer the same way. Revocation is
      // the emergency path — an owner who has just pasted a key into the wrong
      // window wants it dead, not a lecture about which state it was in.
      throw new ServiceError("not_found", "No live key with that id.");
    }

    ctx.setSubject("api_key", row.id);
    ctx.queueEvent("apikey.revoked", { id: row.id, name: row.name });
    return row;
  },
});

export default [listScopes, createApiKey, listApiKeys, revokeApiKey];
