// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: an actual owner preview reads complete original receipt history.
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { boundStorage } from "@/adapters/storage";
import { defineOrchestratedService, hasModuleAccess, ServiceError, type Actor } from "@/core/service";
import { defineMediaService } from "./guarded-service";
import { lockObjectDigest, objectKeyDigest, storageOperationsHeld } from "./write-ledger";
import { mediaObjectWrites } from "./write-schema";
import { checkedTransferBinding, originalTransferObject, transferBindingSchema, transferInventoryDigest } from "./transfer-witness";

const key = z.string().min(1).max(2048).refine(value => !/[\u0000-\u001f]/.test(value) && !value.split("/").some(part => part === "." || part === ".."));
const inputSchema = z.object({ keys: z.array(key).min(1).max(25), target: transferBindingSchema });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const outputSchema = z.object({
  source: transferBindingSchema, target: transferBindingSchema, inventoryDigest: digest,
  objects: z.array(z.object({ key, keyDigest: digest, sha256: digest, bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), contentType: z.string(), originalReceiptCount: z.number().int().positive() })),
  permitsCopy: z.literal(false), permitsAdoption: z.literal(false), permitsSourceDeletion: z.literal(false),
});
function human(actor: Actor): void {
  if (actor.kind !== "user" || actor.keyScopes || !hasModuleAccess(actor, "media", "manage")) {
    throw new ServiceError("permission", "Sign in as a person with permission to manage media transfers.");
  }
}

const storageTransferInventory = defineMediaService({
  name: "media.storageTransferInventory", summary: "Read complete original histories for a bounded storage-transfer preview.",
  kind: "query", permission: "scoped", agentCallable: false, external: false, orchestratedBy: "media.previewStorageTransfer",
  input: inputSchema.extend({ source: transferBindingSchema }), output: outputSchema,
  handler: async (input, ctx) => {
    human(ctx.actor);
    const source = checkedTransferBinding(input.source), target = checkedTransferBinding(input.target);
    if (new Set(input.keys).size !== input.keys.length) throw new ServiceError("validation", "Choose each original object only once.");
    // The same order is used for every preview. The key's entire history is
    // selected under the writer's actual lock, never a caller's receipt subset.
    const keys = [...input.keys].sort((a, b) => objectKeyDigest(a) < objectKeyDigest(b) ? -1 : objectKeyDigest(a) > objectKeyDigest(b) ? 1 : 0);
    for (const value of keys) await lockObjectDigest(ctx.tx, objectKeyDigest(value));
    const objects: ReturnType<typeof originalTransferObject>[] = [];
    let remaining = 10_000;
    for (const value of keys) {
      const history = await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest, objectKeyDigest(value)))
        .orderBy(asc(mediaObjectWrites.createdAt), asc(mediaObjectWrites.id)).limit(remaining + 1);
      if (history.length > remaining) throw new ServiceError("conflict", "This original receipt history needs a smaller transfer preview.");
      remaining -= history.length;
      const object = originalTransferObject(source, value, history);
      if (await storageOperationsHeld(ctx.tx, history.map(row => row.contactId))) throw new ServiceError("conflict", "A named hold preserves an original object in this preview.");
      objects.push(object);
    }
    return { source, target, inventoryDigest: transferInventoryDigest(source, target, objects),
      objects: objects.map(object => ({ key: object.key, keyDigest: object.keyDigest, sha256: object.sha256, bytes: object.bytes, contentType: object.contentType, originalReceiptCount: object.receipts.length })),
      permitsCopy: false as const, permitsAdoption: false as const, permitsSourceDeletion: false as const };
  },
});

export const previewStorageTransfer = defineOrchestratedService({
  name: "media.previewStorageTransfer", summary: "Preview original object evidence for a different storage resource before planning a transfer.",
  kind: "query", permission: "scoped", agentCallable: false, input: inputSchema, output: outputSchema,
  handler: async (input, actor) => {
    human(actor);
    // Binding resolution may use the provider broker. Capture it outside the
    // service transaction; this preview performs no object GET/PUT/DELETE.
    const { binding } = await boundStorage();
    return storageTransferInventory.call({ ...input, source: checkedTransferBinding(binding) }, actor);
  },
});

export default [previewStorageTransfer, storageTransferInventory];
