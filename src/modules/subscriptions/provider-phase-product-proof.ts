// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: confirmed public-product work is not a hidden billing resource.
import { z } from "zod";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { scheduleCallerHasStopped } from "./provider-schedule-proof";
import type { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
const productProof = z.object({ version: z.literal(1), operationId: z.uuid(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/), providerProductRef: z.string().regex(/^prod_[A-Za-z0-9]{1,195}$/) });
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
export function verifiedOriginalPhaseProduct(operation: Operation): string | null {
  const proof = productProof.safeParse(operation.providerObservation.productProof);
  const physical = z.object({ method: z.literal("POST"), path: z.literal("/v1/products"), body: z.record(z.string(), z.string()) }).safeParse(operation.originalRequest.physical);
  const parsedHistory = z.array(z.record(z.string(), z.unknown())).max(5000).safeParse(operation.providerObservation.history);
  if (operation.kind !== "create_product" || operation.state !== "confirmed" || !operation.positiveObserved || !scheduleCallerHasStopped(operation)
    || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest || operation.originalRequest.resourceKind !== "phase_product"
    || !physical.success || physical.data.body["metadata[freeholder_subscription_id]"] !== operation.subscriptionId
    || physical.data.body["metadata[freeholder_phase_product_operation_id]"] !== operation.id || !proof.success
    || proof.data.operationId !== operation.id || proof.data.requestDigest !== operation.requestDigest || !parsedHistory.success) return null;
  const history = parsedHistory.data;
  if (history.some(entry => entry.providerSubscriptionRef !== undefined || entry.providerScheduleRef !== undefined)) return null;
  const acknowledgments = history.filter(entry => entry.source === "phase_product_ack");
  if (!acknowledgments.length || acknowledgments.some(entry => entry.operationId !== operation.id || entry.requestDigest !== operation.requestDigest
    || entry.providerProductRef !== proof.data.providerProductRef)) return null;
  if (!history.some(entry => entry.source === "phase_product_read_verified" && entry.operationId === operation.id
    && entry.requestDigest === operation.requestDigest && entry.providerProductRef === proof.data.providerProductRef)) return null;
  return proof.data.providerProductRef;
}
/** Requires the complete contiguous journal, real original endpoint, actual
 * finished caller and independently verified product. Unknown is never empty. */
export function verifiedPreparatoryPhaseProducts(resource: typeof subscriptionProviderScheduleResources.$inferSelect,
  operations: readonly Operation[]): boolean {
  if (resource.state !== "uncreated" || resource.recoveryPending || resource.providerSubscriptionRef || resource.providerCustomerRef
    || !operations.length || operations.length !== resource.operationRevision) return false;
  return operations.every((operation, index) => operation.subscriptionId === resource.subscriptionId
    && operation.operationRevision === index + 1 && verifiedOriginalPhaseProduct(operation) !== null);
}
