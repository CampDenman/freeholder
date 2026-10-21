// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Personal keys (MASTER.md §44.10, C12.14).
//
// A person makes a key for their own agent. The key acts as them: every
// service checks their own permissions, and the key narrows that to the
// services it names. It can never call staff or system services, never step
// up, never mint another key, and always expires. Owners still see and can
// revoke every key in Admin → Access.
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, listExternalServices, ServiceError, type Actor } from "@/core/service";
import { mintApiKey } from "./tokens";
import { apiKeys } from "./schema";

const MAX_DAYS = 90;

function person(actor: Actor): string {
  if (actor.kind !== "user") throw new ServiceError("permission", "Sign in to make a key for your agent.");
  // A key must not mint keys: issuing credentials is something a person does.
  if (actor.keyScopes) throw new ServiceError("permission", "A key cannot make or change keys. Sign in to do that.");
  return actor.userId;
}

/** Scopes a person may give their own agent: what they could do themselves, never staff or system services. */
function assertPersonalScopes(scopes: string[]): void {
  const services = [...listExternalServices().values()];
  const byName = new Map(services.map((s) => [s.def.name, s.def]));
  const families = new Set(services.map((s) => `${s.def.name.split(".")[0]}.*`));
  for (const scope of scopes) {
    const def = byName.get(scope);
    if (!def && !families.has(scope)) throw new ServiceError("validation", `No such capability: ${scope}.`);
    if (def && (def.permission === "scoped" || def.permission === "system")) {
      throw new ServiceError("validation", `${scope} is for the site's staff and cannot be given to a personal key.`);
    }
  }
}

const label = (stored: string) => stored.replace(/^personal:[0-9a-f]{8}:/, "");

const keyRow = row({
  id: uuid,
  name: z.string(),
  prefix: z.string(),
  scopes: listed(z.string()),
  lastUsedAt: timestamp.nullable(),
  expiresAt: timestamp.nullable(),
  createdAt: timestamp,
});

export const createMyKey = defineService({
  name: "apikeys.createMine",
  summary: "Make a key so your own agent can act as you, limited to the services you choose, for up to 90 days.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 10, windowSeconds: 3600, message: "You are making keys very quickly. Please wait.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(z.string().min(1).max(120)).min(1).max(100),
    expiresInDays: z.number().int().min(1).max(MAX_DAYS).default(30),
  }),
  output: keyRow.extend({ token: z.string() }),
  handler: async (input, ctx) => {
    const userId = person(ctx.actor);
    assertPersonalScopes(input.scopes);
    const minted = mintApiKey();
    const [created] = await ctx.tx
      .insert(apiKeys)
      .values({
        // Key names are unique among live keys site-wide; this one is only this person's.
        name: `personal:${userId.slice(0, 8)}:${input.name}`,
        tokenHash: minted.tokenHash,
        prefix: minted.prefix,
        scopes: input.scopes,
        actsAsUserId: userId,
        createdBy: userId,
        expiresAt: sql`now() + ${`${input.expiresInDays} days`}::interval`,
      })
      .returning()
      .catch((error: unknown) => {
        const text = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "";
        if (text.includes("api_keys_live_name_idx")) {
          throw new ServiceError("conflict", `You already have a key called "${input.name}".`);
        }
        throw error;
      });
    ctx.setSubject("api_key", created!.id);
    ctx.queueEvent("apikey.created", { id: created!.id, name: created!.name });
    return { ...created!, name: label(created!.name), token: minted.token };
  },
});

export const myKeys = defineService({
  name: "apikeys.mine",
  summary: "The keys you made for your own agents that still work.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(keyRow),
  handler: async (_input, ctx) => {
    const userId = person(ctx.actor);
    const rows = await ctx.tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.actsAsUserId, userId), isNull(apiKeys.revokedAt), sql`${apiKeys.expiresAt} > now()`))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map((r) => ({ id: r.id, name: label(r.name), prefix: r.prefix, scopes: r.scopes, lastUsedAt: r.lastUsedAt, expiresAt: r.expiresAt, createdAt: r.createdAt }));
  },
});

export const revokeMyKey = defineService({
  name: "apikeys.revokeMine",
  summary: "Stop one of your agent keys from working.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const userId = person(ctx.actor);
    const [revoked] = await ctx.tx
      .update(apiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(apiKeys.id, input.id), eq(apiKeys.actsAsUserId, userId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (!revoked) throw new ServiceError("not_found", "That key is not yours or already stopped.");
    ctx.setSubject("api_key", revoked.id);
    return { ok: true as const };
  },
});

export default [createMyKey, myKeys, revokeMyKey];
