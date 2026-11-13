// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: shared original partial-target contract without registry imports.
import { z } from "zod";
export const ORIGINAL_PARTIAL_CASH_CONFIRMATION = "RECONCILE ONLY THESE ORIGINAL RETURNED PARTS";
export const ORIGINAL_UNASSIGNED_CASH_CONFIRMATION = "REVIEW THIS ACTUAL ORIGINAL CASH RESOURCE";
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const parent = z.object({ providerRef: z.string(), originalMinor: minor, currency: z.string(), accountId: z.string(), chargeRef: z.string() }).strict();
export const originalPartialTargetBasis = z.object({ protocol: z.literal("freeholder.original-cash-partial-target.v1"), targetKey: z.string().length(64),
  sourceDigest: z.string().length(64), originalPrincipalMinor: minor, customerReturnedMinor: minor, principalCurrency: z.string(),
  acceptedFeeMinor: minor, acceptedFeeRetainedMinor: minor, originalInventoryOperationId: z.uuid(),
  fee: parent.nullable(), recipient: parent.nullable(), feeTargetMinor: minor, recipientTargetMinor: minor,
  paymentId: z.uuid(), invoiceId: z.uuid(), originalCreditIds: z.array(z.uuid()).max(5000) }).strict();
export const originalPartialTarget = originalPartialTargetBasis.extend({ authorizedBy: z.string().regex(/^user:[0-9a-f-]{36}$/) }).strict();
