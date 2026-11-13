// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual original return-part and credit ownership, never amount matching.
import { z } from "zod";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const legacyReturnPartWitness = z.object({
  returnId: z.uuid(), allocationId: z.uuid(), creditNoteId: z.uuid(), allocationDigest: digest, creditDigest: digest,
}).strict();
export type LegacyReturnPartWitness = z.infer<typeof legacyReturnPartWitness>;
export const legacyReturnBankOwnerResult = z.object({ owner: legacyReturnPartWitness.nullable(), refundIds: z.array(z.uuid()).max(5000), cashRefundIds: z.array(z.uuid()).max(5000), confirmedRefundIds: z.array(z.uuid()).max(5000), unresolvedRefundIds: z.array(z.uuid()).max(5000), allocationMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), allCurrent: z.boolean(), confirmedMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), partFulfilled: z.boolean(), needsReview: z.boolean() }).strict();
/** Identity chooses the owner. Amounts are checked only after this exact
 * original return/allocation/payment relation has already been selected. */
export function legacyReturnKeyOwnsAllocation(key: string, returnId: string, allocationId: string, paymentId: string) {
  return key.startsWith(`return:${returnId}:allocation:${allocationId}:`) || key === `return:${returnId}:refund:${paymentId}`
    || key.startsWith(`return:${returnId}:provider:`) && key.endsWith(`:${paymentId}`);
}
