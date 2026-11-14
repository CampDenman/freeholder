// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: absolute original coordinates, immutable original cap anchors.
import {z} from "zod";
import {ATOMIC_CREDIT_RESERVATION_PROTOCOL} from "./atomic-credit-fee-protocol";
import {atomicCreditInvoiceProjection} from "./atomic-credit-before-image-contract";
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const atomicCreditFeeSegment=z.object({
 epochFundingId:z.uuid(),epochStartMinor:minor,epochEndMinor:minor.positive(),epochAssignedFeeMinor:minor,epochProvenCollectedMinor:minor,
 startMinor:minor,endMinor:minor.positive(),nominalFeeMinor:minor,retiredFeeMinor:minor,assignedFeeMinor:minor,provenCollectedMinor:minor,owedFeeMinor:minor,
}).strict();
export type AtomicCreditFeeSegment=z.infer<typeof atomicCreditFeeSegment>;
export const atomicCreditReservationEconomics=z.object({
 protocol:z.literal(ATOMIC_CREDIT_RESERVATION_PROTOCOL),rootFundingId:z.uuid(),sourcePaymentId:z.uuid(),originalPrincipalMinor:minor.positive(),originalFeeMinor:minor,rootEconomicRevision:sha,
 fundingId:z.uuid(),sourceApplicationId:z.uuid().nullable(),fundingEconomicRevision:sha,
 fundingNominalFeeMinor:minor,fundingRetiredFeeMinor:minor,fundingAssignedFeeMinor:minor,fundingProvenCollectedMinor:minor,fundingOwedFeeMinor:minor,
 segments:z.array(atomicCreditFeeSegment).min(1).max(5000),amountMinor:minor.positive(),nominalFeeMinor:minor,retiredFeeMinor:minor,assignedFeeMinor:minor,provenCollectedMinor:minor,owedFeeMinor:minor,
 activeReservationIds:z.array(z.uuid()).max(5000),releasedReservationIds:z.array(z.uuid()).max(5000),currentSourceRevision:sha,postgresSourceRevision:sha,beforeInvoiceProjections:z.array(atomicCreditInvoiceProjection).max(5000),economicRevision:sha,
}).strict();
export type AtomicCreditReservationEconomics=z.infer<typeof atomicCreditReservationEconomics>;
