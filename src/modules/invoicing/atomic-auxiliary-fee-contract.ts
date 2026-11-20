// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: a fee-only target is never relabeled full/partial customer closure.
import {z} from "zod";
export const ATOMIC_AUXILIARY_FEE_TARGET="freeholder.original-cash-atomic-fee-target.v1";
export const ATOMIC_AUXILIARY_FEE_CLOSURE="freeholder.original-cash-atomic-fee-closure.v1";
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const atomicAuxiliaryFeeTarget=z.object({protocol:z.literal(ATOMIC_AUXILIARY_FEE_TARGET),targetKey:sha,recoveryId:uuid,paymentId:uuid,receiptId:uuid,invoiceId:uuid,collectionId:uuid,batchId:uuid,receiptProofId:uuid,namespaceKey:z.string().min(1),platform:z.string(),account:z.string(),paymentRef:z.string(),chargeRef:z.string(),feeRef:z.string(),currency:z.string().regex(/^[A-Z]{3}$/),originalFeeMinor:minor,targetRetainedFeeMinor:minor,priorReturnedMinor:minor,amountMinor:minor.positive(),originalInventoryOperationId:uuid,economicRevision:sha,sourceRevision:sha,unionRevision:sha,requestedBy:z.string().min(1)}).strict();
export type AtomicAuxiliaryFeeTarget=z.infer<typeof atomicAuxiliaryFeeTarget>;
export const atomicAuxiliaryFeeClosure=z.object({protocol:z.literal(ATOMIC_AUXILIARY_FEE_CLOSURE),targetFactId:uuid,targetKey:sha,recoveryId:uuid,paymentId:uuid,receiptId:uuid,originalInventoryOperationId:uuid,bankInspectionId:uuid,bankObservationId:uuid,targetRetainedFeeMinor:minor,acceptedReturnedMinor:minor,revision:sha}).strict();
