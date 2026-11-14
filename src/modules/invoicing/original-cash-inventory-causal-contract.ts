// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a signed historical comparison is never current money authority.
import { z } from "zod";
export const ORIGINAL_INVENTORY_CAUSAL_PROTOCOL = "freeholder.original-cash-inventory-causal.v2";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const originalInventoryPreimageEntry = z.object({
  table: z.string().regex(/^[a-z_][a-z0-9_.]*$/), id: z.uuid(),
  // history_canonical hashes the sorted actual history contributions for this
  // physical identity. It is NOT a PostgreSQL row fingerprint.
  fingerprints: z.object({ postgres_row: sha.optional(), history_canonical: sha.optional(), dependency_canonical: sha.optional() }).strict()
    .refine(value => Object.values(value).some(digest => digest !== undefined)),
}).strict();
export const originalInventoryResolutionPreimage = z.object({ subscriptionId: z.uuid(), coverageRevision: sha, resolutionsDigest: sha,
  unresolvedFactIds: z.array(z.uuid()).max(5000), additionalReviewFactIds: z.array(z.uuid()).max(5000), evidenceEntriesDigest: sha }).strict();
export const originalInventoryComparison = z.object({ protocol: z.literal(ORIGINAL_INVENTORY_CAUSAL_PROTOCOL),
  recoveryId: z.uuid(), namespaceKey: sha, operationId: z.uuid(), callerId: z.uuid(), nonceHash: sha,
  sourceCashDigest: sha, sourceHistoryDigest: sha, sourceRevision: sha,
  preimageEntries: z.array(originalInventoryPreimageEntry).max(5000),
  controlledResolutionPreimages: z.array(originalInventoryResolutionPreimage).max(5000),
}).strict().superRefine((value, ctx) => {
  const keys = value.preimageEntries.map(row => `${row.table}:${row.id}`);
  if (new Set(keys).size !== keys.length || value.preimageEntries.some(row => row.table === "original_cash_recovery_operations" && row.id === value.operationId)
    || new Set(value.controlledResolutionPreimages.map(row => row.subscriptionId)).size !== value.controlledResolutionPreimages.length)
    ctx.addIssue({ code: "custom", message: "The complete pre-admission physical identities must be unique and cannot already include this new caller." });
});
export type OriginalInventoryComparison = z.infer<typeof originalInventoryComparison>;
export type OriginalInventoryPreimageEntry = z.infer<typeof originalInventoryPreimageEntry>;
export type OriginalInventoryResolutionPreimage = z.infer<typeof originalInventoryResolutionPreimage>;

// Existing signed partial_closure evidence; this defines no new durable kind
// or field and supplies no whole-return/principal authority.
export const originalInventoryPartialClosureEvidence=z.object({targetFactId:z.uuid(),targetKey:sha,sourceDigest:sha,revision:sha,originalInventoryOperationId:z.uuid(),
  customerReturnedMinor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),feeTargetMinor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),recipientTargetMinor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict();
export type OriginalInventoryPartialClosureEvidence=z.infer<typeof originalInventoryPartialClosureEvidence>;
