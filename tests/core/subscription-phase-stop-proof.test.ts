// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: declared original stop history cannot turn null linkage into absence.
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { closedOriginalPhaseSchedules, originalPhaseResources } from "@/modules/subscriptions/provider-phase-resources";
import { scheduleQuiescenceCovers, scheduleOperationDigest } from "@/modules/subscriptions/provider-schedule-proof";
import type { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const sub = "00000000-0000-4000-8000-000000000601", creatorId = "00000000-0000-4000-8000-000000000602", stopId = "00000000-0000-4000-8000-000000000603";
function declared(linked = false): Operation[] {
  const originalRequest = { resourceKind: "phase_schedule", callerCompletionDigest: "a".repeat(64), phases: [{ start: "2027-06-01T00:00:00.000Z" }] };
  const stopRequest = { resourceKind: "phase_schedule_stop", providerScheduleRef: "sub_sched_original", originalFirstPhaseStart: "2027-06-01T00:00:00.000Z", callerCompletionDigest: "b".repeat(64) };
  const requestDigest = merchantTaxDigest(originalRequest), stopDigest = merchantTaxDigest(stopRequest);
  const actual = { providerScheduleRef: "sub_sched_original", providerSubscriptionRefs: linked ? ["sub_original"] : [], linkedInventoryComplete: true, state: "canceled", source: "cancel_ack",
    neverStartedProof: linked ? null : { originalFirstPhaseStart: "2027-06-01T00:00:00.000Z", providerCreatedAt: "2026-11-13T00:00:00.000Z", providerCanceledAt: "2026-11-13T00:01:00.000Z" } };
  const base = { subscriptionId: sub, providerApiVersion: "2026-10-28.endive", state: "confirmed" as const, positiveObserved: true,
    createdAt: new Date("2026-11-13T00:00:00Z"), finishedAt: new Date("2026-11-13T00:01:00Z") };
  return [{ ...base, id: creatorId, operationRevision: 1, kind: "create", idempotencyKey: "declared-original-create", originalRequest, requestDigest,
    providerObservation: { history: [{ source: "phase_schedule_ack", operationId: creatorId, requestDigest, providerScheduleRef: "sub_sched_original", providerSubscriptionRef: linked ? "sub_original" : null },
      { source: "physical_caller_finished", operationId: creatorId, requestDigest, completionDigest: "a".repeat(64), outcome: "returned" }] } },
    { ...base, id: stopId, operationRevision: 2, kind: "cancel", idempotencyKey: "declared-original-stop", originalRequest: stopRequest, requestDigest: stopDigest,
      providerObservation: { history: [{ source: "phase_schedule_stop_ack", operationId: stopId, requestDigest: stopDigest, providerScheduleRef: "sub_sched_original", actualDigest: merchantTaxDigest(actual), actual },
        { source: "physical_caller_finished", operationId: stopId, requestDigest: stopDigest, completionDigest: "b".repeat(64), outcome: "returned" }] } }];
}
describe("original primary schedule stop coverage", () => {
  it("covers a genuinely future canceled schedule with explicit provider pre-start evidence and real caller finishes", () => {
    expect(closedOriginalPhaseSchedules(declared())).toHaveLength(1);
  });
  it("does not replace either original caller's finish with a provider stop acknowledgment", () => {
    for (const index of [0, 1]) { const rows = declared(); rows[index]!.providerObservation.history = (rows[index]!.providerObservation.history as Array<Record<string, unknown>>).filter(entry => entry.source !== "physical_caller_finished"); expect(closedOriginalPhaseSchedules(rows)).toBeNull(); }
  });
  it("does not treat null current linkage as proof that no subscription was ever created", () => {
    const rows = declared(), history = rows[1]!.providerObservation.history as Array<Record<string, unknown>>, actual = { ...(history[0]!.actual as Record<string, unknown>), neverStartedProof: null };
    history[0] = { ...history[0], actual, actualDigest: merchantTaxDigest(actual) }; expect(closedOriginalPhaseSchedules(rows)).toBeNull();
  });
  it("retains a historical linked subscription even when the current stop ACK has a null link", () => {
    const rows = declared(true), history = rows[1]!.providerObservation.history as Array<Record<string, unknown>>, actual = { ...(history[0]!.actual as Record<string, unknown>), providerSubscriptionRefs: [] };
    history[0] = { ...history[0], actual, actualDigest: merchantTaxDigest(actual) };
    expect(closedOriginalPhaseSchedules(rows)![0]!.linkedSubscriptionRefs).toEqual(["sub_original"]);
  });
  it("keeps a missing original primary resource acknowledgment as explicit recovery debt", () => {
    const rows = declared(); rows[0]!.providerObservation.history = (rows[0]!.providerObservation.history as Array<Record<string, unknown>>).filter(entry => entry.source !== "phase_schedule_ack"); expect(originalPhaseResources(rows)).toBeNull();
  });
  it("requires complete linked inventory and a returned cancellation promise", () => {
    const rows = declared(), history = rows[1]!.providerObservation.history as Array<Record<string, unknown>>; history[1] = { ...history[1], outcome: "threw" }; expect(closedOriginalPhaseSchedules(rows)).toBeNull();
    const incomplete = declared(), original = incomplete[1]!.providerObservation.history as Array<Record<string, unknown>>, actual = { ...(original[0]!.actual as Record<string, unknown>), linkedInventoryComplete: false };
    original[0] = { ...original[0], actual, actualDigest: merchantTaxDigest(actual) }; expect(closedOriginalPhaseSchedules(incomplete)).toBeNull();
  });
  it("binds the stopped proof to the actual current operation and evidence revisions", () => {
    const operations = declared(), now = new Date("2026-11-13T00:01:00Z");
    const resource: typeof subscriptionProviderScheduleResources.$inferSelect = { subscriptionId: sub, providerSubscriptionRef: null, providerCustomerRef: "cus_original", operationRevision: 2, evidenceRevision: 5,
      state: "quiesced", recoveryPending: false, stoppedProof: { operationRevision: 2, evidenceRevision: 5, journalDigest: scheduleOperationDigest(operations), phaseSchedules: closedOriginalPhaseSchedules(operations)!, resources: [] }, createdAt: now, updatedAt: now };
    expect(scheduleQuiescenceCovers(resource, operations)).toBe(true);
    expect(scheduleQuiescenceCovers({ ...resource, evidenceRevision: 6 }, operations)).toBe(false);
  });
});
