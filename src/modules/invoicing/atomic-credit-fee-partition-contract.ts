// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: immutable economics and genuine current evidence stay separate.
import {z} from "zod";
import {ATOMIC_CREDIT_FEE_PROTOCOL} from "./atomic-credit-fee-protocol";
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const atomicCreditFeeEconomicPlan=z.object({
 protocol:z.literal(ATOMIC_CREDIT_FEE_PROTOCOL),epochKind:z.enum(["direct","inherited"]),sourcePaymentId:uuid,sourceApplicationId:uuid.nullable(),parentFundingId:uuid.nullable(),sourceCollectionId:uuid,sourceResourceId:uuid,
 originalPaymentFeeMinor:minor,originalResourceRetiredFeeMinor:minor,
 originalPrincipalMinor:minor.positive(),originalFeeMinor:minor,acceptedRetiredFeeMinor:minor,actualCollectedFeeMinor:minor,
 allocatedPrincipalMinor:minor,allocatedNominalFeeMinor:minor,allocatedRetiredFeeMinor:minor,allocatedAssignedFeeMinor:minor,declaredProvenFeeMinor:minor,
 currentCoveredAssignedFeeMinor:minor,currentOwedAssignedFeeMinor:minor,availablePrincipalMinor:minor,availableActualFeeMinor:minor,
 takePrincipalMinor:minor,takeNominalFeeMinor:minor,takeRetiredFeeMinor:minor,takeAssignedFeeMinor:minor,takeProvenCollectedMinor:minor,takeOwedFeeMinor:minor,
 afterPrincipalMinor:minor,afterNominalFeeMinor:minor,afterAssignedFeeMinor:minor,remainingPrincipalMinor:minor,remainingActualFeeMinor:minor,priorFundingIds:z.array(uuid).max(5000),
 retiredResources:z.array(z.object({ledger:z.enum(["merchant_fee","original_auxiliary"]),operationId:uuid,providerRef:z.string(),feeRef:z.string(),amountMinor:minor.positive(),currency:z.string().regex(/^[A-Z]{3}$/)}).strict()).max(5000),economicRevision:sha,
}).strict();
export type AtomicCreditFeeEconomicPlan=z.infer<typeof atomicCreditFeeEconomicPlan>;
export const atomicCreditFeeStoredEconomics=z.object({plan:atomicCreditFeeEconomicPlan,currentParentRevision:sha,currentFeeProofRevision:sha,bankNamespaceRevision:sha,sourceGraphRevision:sha,feeEvidenceDigest:sha}).strict();
export type AtomicCreditFeeStoredEconomics=z.infer<typeof atomicCreditFeeStoredEconomics>;
export const atomicCreditFeePhysicalEntry=z.object({table:z.string().min(1),id:z.string().min(1),fingerprint:sha,hashDomain:z.literal("postgres_row")}).strict();
export type AtomicCreditFeePhysicalEntry=z.infer<typeof atomicCreditFeePhysicalEntry>;

export const atomicCreditFeeCurrentEntry=z.object({key:z.string().min(3),postgres_row:sha.optional(),dependency_canonical:sha.optional(),schedule_stable:sha.optional()}).strict().refine(row=>Boolean(row.postgres_row||row.dependency_canonical||row.schedule_stable));
export type AtomicCreditFeeCurrentEntry=z.infer<typeof atomicCreditFeeCurrentEntry>;
