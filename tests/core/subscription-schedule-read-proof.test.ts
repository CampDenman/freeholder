// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: declared GET evidence cannot substitute for original physical shutdown.
import { describe, expect, it } from "vitest";
import { verifiedScheduleRead } from "@/modules/subscriptions/provider-schedule-read-proof";
import { phaseOperationCallerFinished } from "@/modules/subscriptions/provider-phase-resources";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import type { subscriptionProviderScheduleOperations } from "@/modules/subscriptions/provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const readId = "00000000-0000-4000-8000-000000000902", actualDigest = "c".repeat(64);
function declared(): Operation {
  const id = "00000000-0000-4000-8000-000000000901", originalRequest = { resourceKind: "phase_schedule_stop", providerScheduleRef: "sub_sched_original", callerCompletionDigest: "a".repeat(64) };
  const requestDigest = merchantTaxDigest(originalRequest);
  return { id, subscriptionId: "00000000-0000-4000-8000-000000000903", operationRevision: 2, kind: "cancel", originalRequest, requestDigest, providerApiVersion: "2026-10-28.endive",
    idempotencyKey: "declared-original-cancel", state: "confirmed", positiveObserved: true, createdAt: new Date(0), finishedAt: new Date(1000), providerObservation: { history: [
      { source: "physical_caller_finished", operationId: id, requestDigest, completionDigest: "a".repeat(64), outcome: "threw" },
      { source: "schedule_read_admitted", operationId: id, requestDigest, readId, kind: "phase_stop", completionDigest: "b".repeat(64), request: { providerScheduleRef: "sub_sched_original" } },
      { source: "schedule_read_finished", operationId: id, requestDigest, readId, completionDigest: "b".repeat(64), outcome: "returned", verified: true, actualDigest },
    ] } };
}
const history = (operation: Operation) => operation.providerObservation.history as Array<Record<string, unknown>>;
describe("separate original schedule GET completion authority", () => {
  it("recognizes an actual separate returned GET after the original cancellation threw", () => {
    const operation = declared(); expect(verifiedScheduleRead(operation, readId, actualDigest)).toBe(true); expect(phaseOperationCallerFinished(operation)).toBe(true); expect(phaseOperationCallerFinished(operation, true)).toBe(false);
  });
  it("does not use a returned GET or local finishedAt as the original mutation caller finish", () => {
    const operation = declared(); operation.providerObservation.history = history(operation).slice(1);
    expect(verifiedScheduleRead(operation, readId, actualDigest)).toBe(true); expect(phaseOperationCallerFinished(operation)).toBe(false);
  });
  it("refuses an unadmitted GET and a different completion nonce", () => {
    const absent = declared(); absent.providerObservation.history = history(absent).filter(entry => entry.source !== "schedule_read_admitted"); expect(verifiedScheduleRead(absent, readId, actualDigest)).toBe(false);
    const nonce = declared(); history(nonce)[2]!.completionDigest = "d".repeat(64); expect(verifiedScheduleRead(nonce, readId, actualDigest)).toBe(false);
  });
  it("refuses borrowing the original physical caller's nonce as the read's authority", () => {
    const operation = declared(); history(operation)[1]!.completionDigest = "a".repeat(64); history(operation)[2]!.completionDigest = "a".repeat(64); expect(verifiedScheduleRead(operation, readId, actualDigest)).toBe(false);
  });
  it("requires the original primary target and phase-stop read kind", () => {
    for (const patch of [{ kind: "invoice_action" }, { request: { providerScheduleRef: "sub_sched_other" } }]) {
      const operation = declared(); Object.assign(history(operation)[1]!, patch); expect(verifiedScheduleRead(operation, readId, actualDigest)).toBe(false);
    }
  });
  it("retains stale or thrown GETs without accepting them as positive closure", () => {
    for (const patch of [{ verified: false }, { outcome: "threw" }, { actualDigest: "e".repeat(64) }, { requestDigest: "f".repeat(64) }]) {
      const operation = declared(); Object.assign(history(operation)[2]!, patch); expect(verifiedScheduleRead(operation, readId, actualDigest)).toBe(false);
    }
  });
});
