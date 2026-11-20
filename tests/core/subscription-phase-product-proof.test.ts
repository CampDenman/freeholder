// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: read-only declared product history cannot invent zero billing work.
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { verifiedOriginalPhaseProduct, verifiedPreparatoryPhaseProducts,verifiedControlledPhaseProductAncestry } from "@/modules/subscriptions/provider-phase-product-proof";
import type { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
type Resource = typeof subscriptionProviderScheduleResources.$inferSelect;
const subscriptionId = "00000000-0000-4000-8000-000000000001", operationId = "00000000-0000-4000-8000-000000000002";
function history() {
  const originalRequest = { resourceKind: "phase_product", callerCompletionDigest: "a".repeat(64), physical: { method: "POST", path: "/v1/products", body: {
    "metadata[freeholder_subscription_id]": subscriptionId, "metadata[freeholder_phase_product_operation_id]": operationId } } };
  const requestDigest = merchantTaxDigest(originalRequest), binding = { operationId, requestDigest }, product = { ...binding, providerProductRef: "prod_original" };
  const operation: Operation = { id: operationId, subscriptionId, operationRevision: 1, kind: "create_product", providerApiVersion: "2026-10-28.endive", originalRequest, requestDigest,
    idempotencyKey: "original-product", state: "confirmed", positiveObserved: true, createdAt: new Date("2026-11-12T00:00:00Z"), finishedAt: new Date("2026-11-12T00:00:01Z"),
    providerObservation: { productProof: { version: 1, ...product }, history: [{ source: "phase_product_ack", ...product }, { source: "phase_product_read_verified", version: 1, ...product },
      { source: "physical_caller_finished", ...binding, completionDigest: "a".repeat(64), outcome: "returned" }] } };
  const resource: Resource = { subscriptionId, providerSubscriptionRef: null, providerCustomerRef: null, operationRevision: 1, evidenceRevision: 2, state: "uncreated", stoppedProof: null,
    recoveryPending: false, createdAt: new Date("2026-11-12T00:00:00Z"), updatedAt: new Date("2026-11-12T00:00:01Z") };
  return { operation, resource };
}
describe("complete original preparatory product evidence", () => {
  it("distinguishes one confirmed, finished nonbilling product endpoint from any admitted charge resource", () => {
    const { operation, resource } = history(); expect(verifiedOriginalPhaseProduct(operation)).toBe("prod_original"); expect(verifiedPreparatoryPhaseProducts(resource, [operation])).toBe(true);
  });
  it("requires the real independent verification and caller finish rather than the mutable summary pointer", () => {
    const { operation } = history();
    for (const source of ["phase_product_read_verified", "physical_caller_finished"]) {
      const observed = operation.providerObservation.history as Array<Record<string, unknown>>;
      expect(verifiedOriginalPhaseProduct({ ...operation, providerObservation: { ...operation.providerObservation, history: observed.filter(entry => entry.source !== source) } })).toBeNull();
    }
  });
  it("retains a later alternative positive product as uncertainty instead of adopting the first summary", () => {
    const { operation } = history();
    expect(verifiedOriginalPhaseProduct({ ...operation, providerObservation: { ...operation.providerObservation, history: [...operation.providerObservation.history as unknown[],
      { source: "phase_product_ack", operationId, requestDigest: operation.requestDigest, providerProductRef: "prod_alternative" }] } })).toBeNull();
  });
  it("refuses a hidden original subscription or schedule reference in the supposedly nonbilling history", () => {
    const { operation, resource } = history();
    for (const extra of [{ providerSubscriptionRef: "sub_original" }, { providerScheduleRef: "sub_sched_original" }]) expect(verifiedPreparatoryPhaseProducts(resource, [{ ...operation,
      providerObservation: { ...operation.providerObservation, history: [...operation.providerObservation.history as unknown[], { source: "later-original-resource", ...extra }] } }])).toBe(false);
  });
  it("refuses incomplete revision history, unknown outcome and changed original physical endpoint", () => {
    const { operation, resource } = history();
    expect(verifiedPreparatoryPhaseProducts({ ...resource, operationRevision: 2 }, [operation])).toBe(false);
    expect(verifiedOriginalPhaseProduct({ ...operation, state: "unknown" })).toBeNull();
    const changed = { ...operation.originalRequest, physical: { method: "POST", path: "/v1/subscriptions", body: {} } };
    expect(verifiedOriginalPhaseProduct({ ...operation, originalRequest: changed, requestDigest: merchantTaxDigest(changed) })).toBeNull();
  });
});

describe("existing controlled product ancestry keeps raw legacy debt",()=>{
 const controlled=()=>({subscriptionId,termsId:"00000000-0000-4000-8000-000000000003",generation:1,originalSourceRevision:"b".repeat(64),
  originalScope:{subscriptionId,termsId:"00000000-0000-4000-8000-000000000003",generation:1,providerProductRef:"prod_original"}});
 it("recognizes only actual nonbilling product identity without clearing unknown cash flags or authorizing a new legacy bootstrap",()=>{
  const{operation,resource}=history(),unknown={...resource,state:"unknown" as const,recoveryPending:true},before=JSON.stringify({unknown,operation});
  expect(verifiedPreparatoryPhaseProducts(unknown,[operation])).toBe(false);
  expect(verifiedControlledPhaseProductAncestry(unknown,[operation],controlled())).toBe(true);
  expect(JSON.stringify({unknown,operation})).toBe(before);
 });
 it("refuses any legacy billing identity, stop, incomplete journal, unfinished or nonproduct work",()=>{
  const{operation,resource}=history(),unknown={...resource,state:"unknown" as const,recoveryPending:true};
  for(const changed of [{...unknown,providerSubscriptionRef:"sub_legacy"},{...unknown,providerCustomerRef:"cus_legacy"},{...unknown,operationRevision:2},{...unknown,recoveryPending:false},{...unknown,state:"quiescing" as const}])expect(verifiedControlledPhaseProductAncestry(changed,[operation],controlled())).toBe(false);
  for(const changed of [{...operation,state:"unknown" as const},{...operation,kind:"create" as const},{...operation,operationRevision:2}])expect(verifiedControlledPhaseProductAncestry(unknown,[changed],controlled())).toBe(false);
  expect(verifiedControlledPhaseProductAncestry(unknown,[],controlled())).toBe(false);
 });
 it("requires the exact stored controlled subscription, terms, generation and original verified product",()=>{
  const{operation,resource}=history(),unknown={...resource,state:"unknown" as const,recoveryPending:true},source=controlled();
  for(const changed of [{...source,subscriptionId:"00000000-0000-4000-8000-000000000004"},{...source,termsId:"00000000-0000-4000-8000-000000000004"},{...source,generation:2},{...source,originalSourceRevision:"invalid"},{...source,originalScope:{...source.originalScope,providerProductRef:"prod_other"}}])expect(verifiedControlledPhaseProductAncestry(unknown,[operation],changed)).toBe(false);
 });
 it("cannot turn retained subscription/schedule evidence or missing original verification into product identity",()=>{
  const{operation,resource}=history(),unknown={...resource,state:"unknown" as const,recoveryPending:true};
  const old=operation.providerObservation.history as Array<Record<string,unknown>>;
  for(const observations of [old.filter(row=>row.source!=="phase_product_read_verified"),[...old,{source:"actual-foreign-billing",providerSubscriptionRef:"sub_foreign"}],[...old,{source:"actual-foreign-billing",providerScheduleRef:"sub_sched_foreign"}]])expect(verifiedControlledPhaseProductAncestry(unknown,[{...operation,providerObservation:{...operation.providerObservation,history:observations}}],controlled())).toBe(false);
 });
});
