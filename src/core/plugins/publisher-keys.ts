// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.42: trust is owner configuration, never a key supplied with an artifact.
import { desc, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { okResult, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError, type Actor, type Tx } from "@/core/service";
import { installedPlugins, pluginPublisherKeys, pluginRegistries } from "./schema";
import { PUBLISHER_KEY_ID, publisherPublicKey, signatureKeyId, verifySignature } from "./integrity";

export const publisherKeyId = z.string().regex(PUBLISHER_KEY_ID);
const publicPem = z.string().max(2048).refine(value => {
  try { publisherPublicKey(value); return true; } catch { return false; }
}, "Provide an Ed25519 public key in PUBLIC KEY PEM format.").transform(value => publisherPublicKey(value).publicKey);

export const publisherKeyRow = row({
  keyId: publisherKeyId, publisher: z.string(), publicKey: z.string(),
  trustedBy: z.string(), createdAt: timestamp, revokedAt: timestamp.nullable(),
});

export async function lockPublisherTrust(tx: Tx): Promise<void> {
  // All trust/configuration and artifact state changes share this lock. A
  // revocation cannot race an enable, install, update, rollback or cache write.
  await tx.execute(sql`select pg_advisory_xact_lock(1691709, 342)`);
}

export function requirePublisherReviewer(actor: Actor): void {
  if (actor.kind !== "user" || actor.role !== "owner" || actor.keyScopes !== undefined) {
    throw new ServiceError("permission", "Only the signed-in owner can approve plugin trust.");
  }
  if (!actor.security?.stepUpValid) {
    throw new ServiceError("step_up_required", "Confirm your identity before approving plugin trust.");
  }
}

export async function trustedPublisherKey(tx: Tx, keyId: string) {
  const [key] = await tx.select().from(pluginPublisherKeys).where(eq(pluginPublisherKeys.keyId, keyId)).limit(1);
  if (!key || key.revokedAt) throw new ServiceError("permission", "That publisher key is not trusted or has been revoked.");
  return key;
}

export async function assertTrustedArtifact(tx: Tx, integrity: string, signature: string) {
  const keyId = signatureKeyId(signature);
  if (!keyId) throw new ServiceError("permission", "Use an Ed25519 signature from an owner-trusted publisher key.");
  const key = await trustedPublisherKey(tx, keyId);
  if (!verifySignature(integrity, signature, key.publicKey)) throw new ServiceError("permission", "That plugin signature does not match its artifact.");
  return key;
}

export const listPublisherKeys = defineService({
  name: "plugins.listPublisherKeys", summary: "Public publisher keys trusted by the owner, including revocations.",
  kind: "query", permission: "scoped", input: z.object({}), output: z.array(publisherKeyRow),
  handler: (_input, ctx) => ctx.tx.select().from(pluginPublisherKeys).orderBy(desc(pluginPublisherKeys.createdAt)),
});

export const trustPublisherKey = defineService({
  name: "plugins.trustPublisherKey", summary: "Trust a publisher public key after independently checking its fingerprint.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ publisher: z.string().trim().min(1).max(120), publicKey: publicPem, fingerprint: publisherKeyId, confirmation: z.literal(true) }),
  output: publisherKeyRow,
  handler: async (input, ctx) => {
    requirePublisherReviewer(ctx.actor);
    const key = publisherPublicKey(input.publicKey);
    if (input.fingerprint !== key.keyId) throw new ServiceError("validation", "The public key does not match the fingerprint you confirmed.");
    await lockPublisherTrust(ctx.tx);
    const [existing] = await ctx.tx.select().from(pluginPublisherKeys).where(eq(pluginPublisherKeys.keyId, key.keyId));
    if (existing) throw new ServiceError("conflict", existing.revokedAt ? "That key was revoked. Trust a new publisher key instead." : "That publisher key is already trusted.");
    const [stored] = await ctx.tx.insert(pluginPublisherKeys).values({ ...key, publisher: input.publisher, trustedBy: actorString(ctx.actor) }).returning();
    ctx.setSubject("plugin_publisher_key", key.keyId);
    ctx.queueEvent("plugin.publisherKeyTrusted", { keyId: key.keyId, publisher: input.publisher });
    return stored!;
  },
});

export const revokePublisherKey = defineService({
  name: "plugins.revokePublisherKey", summary: "Revoke a publisher key and disable its installed artifacts.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ keyId: publisherKeyId, confirmation: z.literal(true) }), output: okResult.extend({ disabled: z.number() }),
  handler: async (input, ctx) => {
    requirePublisherReviewer(ctx.actor);
    await lockPublisherTrust(ctx.tx);
    await trustedPublisherKey(ctx.tx, input.keyId);
    await ctx.tx.update(pluginPublisherKeys).set({ revokedAt: sql`now()` }).where(eq(pluginPublisherKeys.keyId, input.keyId));
    const disabled = await ctx.tx.update(installedPlugins).set({ status: "disabled", disabledReason: "The owner revoked this plugin's publisher key." })
      .where(like(installedPlugins.signature, `ed25519:${input.keyId}:%`)).returning({ id: installedPlugins.id });
    ctx.setSubject("plugin_publisher_key", input.keyId);
    ctx.queueEvent("plugin.publisherKeyRevoked", { keyId: input.keyId, disabled: disabled.length });
    return { ok: true as const, disabled: disabled.length };
  },
});

export const setRegistryPublisherKey = defineService({
  name: "plugins.setRegistryPublisherKey", summary: "Pin a registry to a trusted publisher key, clearing its old catalog.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ id: uuid, keyId: publisherKeyId }), output: okResult,
  handler: async (input, ctx) => {
    requirePublisherReviewer(ctx.actor);
    await lockPublisherTrust(ctx.tx);
    await trustedPublisherKey(ctx.tx, input.keyId);
    const [registry] = await ctx.tx.update(pluginRegistries).set({ publisherKeyId: input.keyId, signature: null, cachedIndex: {}, fetchedAt: null })
      .where(eq(pluginRegistries.id, input.id)).returning({ id: pluginRegistries.id });
    if (!registry) throw new ServiceError("not_found", "That plugin registry is not configured.");
    ctx.setSubject("plugin_registry", registry.id);
    ctx.queueEvent("plugin.registryKeyChanged", { id: registry.id, keyId: input.keyId });
    return { ok: true as const };
  },
});

export default [listPublisherKeys, trustPublisherKey, revokePublisherKey, setRegistryPublisherKey];
