// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: mandatory-evidence discriminator, never a born funding/money grant.
import {z} from "zod";
import {ATOMIC_CREDIT_FEE_DECLARATION_PROTOCOL} from "./atomic-credit-fee-protocol";
const sha=z.string().regex(/^[a-f0-9]{64}$/),minor=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const atomicCreditFeeDeclaration=z.object({protocol:z.literal(ATOMIC_CREDIT_FEE_DECLARATION_PROTOCOL),quoteId:z.uuid(),resourceId:z.uuid(),subscriptionId:z.uuid(),plannedProrationId:z.uuid(),
 originalInvoiceId:z.uuid(),originalInvoiceLineId:z.uuid(),fundings:z.array(z.object({fundingId:z.uuid(),sourcePaymentId:z.uuid(),sourceApplicationId:z.uuid().nullable(),amountMinor:minor,feeEvidenceDigest:sha}).strict()).min(1).max(1000),
 digest:sha,authentication:sha,
}).strict();
export type AtomicCreditFeeDeclaration=z.infer<typeof atomicCreditFeeDeclaration>;
