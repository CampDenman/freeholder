// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: explicit human evidence settles each original physical call.
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { boundStorage } from "@/adapters/storage";
import { timestamp } from "@/core/contract";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { actorString, defineOrchestratedService, defineService, hasModuleAccess, ServiceError, type Actor } from "@/core/service";
import { mediaObjects } from "./schema";
import { allowMediaReceiptWrites, lockObjectDigest } from "./write-ledger";
import { mediaObjectWrites } from "./write-schema";

function human(actor: Actor) {
  if (actor.kind !== "user" || actor.keyScopes || !hasModuleAccess(actor, "media", "manage")) throw new ServiceError("permission", "Sign in as a person with permission to manage media recovery.");
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const confirmation = z.object({ id: z.uuid(), expectedUpdatedAt: z.iso.datetime(), originalNamespace: digest,
  outcome: z.enum(["applied", "not_applied"]), sha256: digest.optional(), bytes: z.number().int().min(0).max(5 * 1024 ** 3).optional(),
  providerFinalReference: z.string().trim().min(8).max(300),
  providerEvidence: z.string().trim().min(20).max(2_000),
  stoppedWriterEvidence: z.string().trim().min(20).max(2_000),
  confirmation: z.literal("ORIGINAL STORAGE OUTCOME CONFIRMED"),
});
const publicRow = z.object({ id: z.uuid(), operation: z.enum(["put", "delete"]), key: z.string(), namespace: digest.nullable(),
  bytes: z.number().nullable(), sha256: digest.nullable(), contentType: z.string(), state: z.string(),
  observedAcceptedAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp });
export const listStorageOperations = defineService({
  name: "media.listStorageOperations", summary: "Inspect unresolved original storage operations before human recovery.", kind: "query", permission: "scoped", agentCallable: false,
  input: z.object({ limit: z.number().int().min(1).max(100).default(25) }), output: z.object({ rows: z.array(publicRow) }),
  handler: async (input, ctx) => {
    human(ctx.actor);
    return { rows: await ctx.tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.state, ["unverified", "started", "unknown"]))
      .orderBy(asc(mediaObjectWrites.createdAt), asc(mediaObjectWrites.id)).limit(input.limit) };
  },
});
const claimStorageRecovery = defineService({
  name: "media.claimStorageRecovery", summary: "Capture unchanged original storage intent for a person's review.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  external: false, orchestratedBy: "media.reconcileStorageOperation", auditInputFields: ["id", "outcome"],
  input: confirmation, output: publicRow,
  handler: async (input, ctx) => {
    human(ctx.actor);
    await lockContactIdentityForRead(ctx.tx);
    const [row] = await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, input.id)).limit(1).for("update");
    if (!row) throw new ServiceError("not_found", "The original storage receipt is unavailable.");
    if (row.redactedAt || !["unverified", "started", "unknown"].includes(row.state) || row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ServiceError("conflict", "The original operation changed. Reload it before reviewing the outcome.");
    if (row.namespace && row.namespace !== input.originalNamespace) throw new ServiceError("conflict", "The evidence does not identify the original storage resource.");
    if (row.observedAcceptedAt && input.outcome === "not_applied") throw new ServiceError("conflict", "The provider already acknowledged this operation. A later failure cannot erase that fact.");
    ctx.setSubject("media_storage_operation", row.id);
    return row;
  },
});
const applyStorageRecovery = defineService({
  name: "media.applyStorageRecovery", summary: "Record a person's verified original provider and stopped-writer evidence.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  external: false, orchestratedBy: "media.reconcileStorageOperation", auditInputFields: ["id", "outcome"],
  input: confirmation.extend({ storageKind: z.enum(["local", "s3", "replit"]), storageLocation: z.record(z.string(), z.string()) }), output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    human(ctx.actor);
    await lockContactIdentityForRead(ctx.tx);
    await allowMediaReceiptWrites(ctx.tx);
    const [intent] = await ctx.tx.select({ keyDigest: mediaObjectWrites.keyDigest }).from(mediaObjectWrites).where(eq(mediaObjectWrites.id, input.id)).limit(1);
    if (!intent) throw new ServiceError("not_found", "The original storage receipt is unavailable.");
    await lockObjectDigest(ctx.tx, intent.keyDigest);
    const [row] = await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, input.id)).limit(1).for("update");
    if (!row || row.redactedAt || !["unverified", "started", "unknown"].includes(row.state) || row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ServiceError("conflict", "The storage operation changed during verification. Reload it before reviewing again.");
    if (row.namespace && row.namespace !== input.originalNamespace) throw new ServiceError("conflict", "This is not the original storage namespace.");
    if (row.observedAcceptedAt && input.outcome === "not_applied") throw new ServiceError("conflict", "A recorded provider acknowledgement cannot be marked unapplied.");
    const evidenceDigest = createHash("sha256").update(JSON.stringify({ ...input, actor: actorString(ctx.actor) })).digest("hex");
    const absent = row.operation === "put" ? input.outcome === "not_applied" : input.outcome === "applied";
    await ctx.tx.update(mediaObjectWrites).set({ state: input.outcome === "applied" ? "accepted" : "confirmed_absent",
      ...(!row.namespace ? { namespace: input.originalNamespace, storageKind: input.storageKind, storageLocation: input.storageLocation, sha256: input.sha256 ?? null, bytes: row.bytes ?? input.bytes ?? null } : {}),
      reviewedAt: new Date(), reviewedBy: actorString(ctx.actor), evidenceDigest,
      ...(absent ? { deletedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(mediaObjectWrites.id, row.id));
    if (row.operation === "delete" && absent) {
      // Only this exact provider resource was verified. Another unknown PUT
      // still protects its ownership and pending erasure receipt.
      await ctx.tx.update(mediaObjectWrites).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(mediaObjectWrites.keyDigest, row.keyDigest), eq(mediaObjectWrites.namespace, input.originalNamespace), eq(mediaObjectWrites.state, "accepted"), isNull(mediaObjectWrites.deletedAt)));
    }
    const unresolved = await ctx.tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(eq(mediaObjectWrites.keyDigest, row.keyDigest), inArray(mediaObjectWrites.state, ["unverified", "started", "unknown"]))).limit(1);
    if (absent && !unresolved.length) await ctx.tx.delete(mediaObjects).where(and(eq(mediaObjects.key, row.key), eq(mediaObjects.state, "pending")));
    ctx.setSubject("media_storage_operation", row.id);
    return { ok: true as const };
  },
});
export const reconcileStorageOperation = defineOrchestratedService({
  name: "media.reconcileStorageOperation", summary: "Verify the original storage resource and record a fresh person's final provider evidence.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  auditInputFields: ["id", "outcome"], input: confirmation, output: z.object({ ok: z.literal(true) }),
  handler: async (input, actor) => {
    human(actor);
    const original = await claimStorageRecovery.call(input, actor);
    const { store, binding } = await boundStorage();
    if (binding.namespace !== input.originalNamespace || (original.namespace && original.namespace !== binding.namespace)) throw new ServiceError("conflict", "Restore the exact original private storage resource before reviewing this operation.");
    const absent = original.operation === "put" ? input.outcome === "not_applied" : input.outcome === "applied";
    if (absent) {
      if (await store.head(original.key)) throw new ServiceError("conflict", "The original object is still present. The recorded provider outcome must match it.");
    } else {
      const expected = original.sha256 ?? input.sha256;
      const expectedBytes = original.bytes ?? input.bytes;
      if (!expected || (input.sha256 && input.sha256 !== expected) || expectedBytes === undefined || (input.bytes !== undefined && input.bytes !== expectedBytes)) throw new ServiceError("validation", "Verify the exact original object's byte count and SHA-256 before recording this outcome.");
      const stream = await store.stream(original.key);
      if (!stream) throw new ServiceError("conflict", "The original object is not present.");
      const hash = createHash("sha256"); let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.byteLength;
        if (bytes > expectedBytes) throw new ServiceError("conflict", "The original object has different bytes.");
        hash.update(chunk);
      }
      if (bytes !== expectedBytes || hash.digest("hex") !== expected) throw new ServiceError("conflict", "The original object does not match this operation's exact bytes.");
    }
    return applyStorageRecovery.call({ ...input, storageKind: binding.kind, storageLocation: { ...binding.location } }, actor);
  },
});
export default [listStorageOperations, claimStorageRecovery, applyStorageRecovery, reconcileStorageOperation];
