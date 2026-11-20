// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: only exact application projection fields have an immutable preimage.
import {z} from "zod";
export const atomicCreditInvoiceProjection=z.object({invoiceId:z.uuid(),creditedMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 status:z.enum(["draft","sent","viewed","partially_paid","paid","overdue","void","refunded"]),paidAt:z.iso.datetime({offset:true}).nullable(),updatedAt:z.iso.datetime({offset:true})}).strict();
export type AtomicCreditInvoiceProjection=z.infer<typeof atomicCreditInvoiceProjection>;
export const atomicCreditProrationProjection=z.object({prorationId:z.uuid(),originalJobId:z.uuid().nullable(),jobClaimDigest:z.string().regex(/^[a-f0-9]{64}$/).nullable(),originalTask:z.object({prorationId:z.uuid(),subscriptionId:z.uuid(),originalJobId:z.uuid(),acceptedQuoteDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().nullable(),
 state:z.enum(["accepted","preparing","awaiting_invoice","awaiting_payment","awaiting_effective","applied","cancelled","review"])}).strict();
export const atomicCreditSubscriptionProjection=z.object({subscriptionId:z.uuid(),pendingPlanId:z.uuid().nullable(),updatedAt:z.iso.datetime({offset:true})}).strict();
export type AtomicCreditProrationProjection=z.infer<typeof atomicCreditProrationProjection>;
export type AtomicCreditSubscriptionProjection=z.infer<typeof atomicCreditSubscriptionProjection>;
