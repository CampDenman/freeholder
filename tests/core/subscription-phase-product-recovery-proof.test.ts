// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: declared prior product facts never let a GET invent creator shutdown.
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { recoverableOriginalPhaseProduct } from "@/modules/subscriptions/provider-phase-product-proof";
import type { subscriptionProviderScheduleOperations } from "@/modules/subscriptions/provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
function declared(): Operation {
  const id = "00000000-0000-4000-8000-000000000301", subscriptionId = "00000000-0000-4000-8000-000000000302";
  const originalRequest = { resourceKind: "phase_product", callerCompletionDigest: "a".repeat(64), physical: { method: "POST", path: "/v1/products", body: {
    "metadata[freeholder_subscription_id]": subscriptionId, "metadata[freeholder_phase_product_operation_id]": id } } };
  const requestDigest = merchantTaxDigest(originalRequest);
  return { id, subscriptionId, kind: "create_product", operationRevision: 1, providerApiVersion: "2026-10-28.endive", originalRequest, requestDigest,
    idempotencyKey: "declared-original-product", state: "unknown", positiveObserved: true, createdAt: new Date("2026-11-13T00:00:00Z"), finishedAt: new Date("2026-11-13T00:00:01Z"),
    providerObservation: { history: [{ source: "phase_product_ack", operationId: id, requestDigest, providerProductRef: "prod_original" },
      { source: "physical_caller_finished", operationId: id, requestDigest, completionDigest: "a".repeat(64), outcome: "threw" }] } };
}
describe("original product read recovery authority", () => {
  it("permits read recovery of one retained ACK after the creating promise actually threw", () => {
    expect(recoverableOriginalPhaseProduct(declared())).toBe("prod_original");
  });
  it("refuses a positive GET and local finishedAt without original creating-caller completion", () => {
    const operation = declared();
    operation.providerObservation = { history: [{ source: "phase_product_ack", operationId: operation.id, requestDigest: operation.requestDigest, providerProductRef: "prod_original" },
      { source: "phase_product_read_verified", operationId: operation.id, requestDigest: operation.requestDigest, providerProductRef: "prod_original" }] };
    expect(recoverableOriginalPhaseProduct(operation)).toBeNull();
  });
  it("does not choose one product from conflicting original positive acknowledgments", () => {
    const operation = declared();
    (operation.providerObservation.history as unknown[]).push({ source: "phase_product_ack", operationId: operation.id, requestDigest: operation.requestDigest, providerProductRef: "prod_alternative" });
    expect(recoverableOriginalPhaseProduct(operation)).toBeNull();
  });
  it("refuses substituted original request, absent ACK and hidden billing resources", () => {
    const operation = declared();
    expect(recoverableOriginalPhaseProduct({ ...operation, originalRequest: { ...operation.originalRequest, resourceKind: "other" } })).toBeNull();
    expect(recoverableOriginalPhaseProduct({ ...operation, positiveObserved: false })).toBeNull();
    (operation.providerObservation.history as unknown[]).push({ source: "late_original_resource", providerScheduleRef: "sub_sched_original" });
    expect(recoverableOriginalPhaseProduct(operation)).toBeNull();
  });
});
