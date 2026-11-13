// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual signatures and exact read authority; no database/provider work.
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalProviderReadAdmission, providerReaderStopVerdict, signProviderReadProof, stoppedProviderRead, verifiedProviderReadProof } from "@/modules/subscriptions/provider-read-signatures";
import { originalProviderReadsFinished, verifiedScheduleRead } from "@/modules/subscriptions/provider-schedule-read-proof";
import type { subscriptionProviderScheduleOperations } from "@/modules/subscriptions/provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const subscriptionId = "00000000-0000-4000-8000-000000000501", operationId = "00000000-0000-4000-8000-000000000502", readId = "00000000-0000-4000-8000-000000000503", callerId = "00000000-0000-4000-8000-000000000504";
function original() {
  const originalRequest = { resourceKind: "phase_schedule_stop", providerScheduleRef: "sub_sched_original", callerCompletionDigest: "a".repeat(64) }, requestDigest = merchantTaxDigest(originalRequest);
  const base = { source: "schedule_read_admitted", operationId, requestDigest, readId, callerId, completionDigest: "b".repeat(64), kind: "phase_stop", request: { providerScheduleRef: "sub_sched_original" } };
  const admission = { ...base, ownership: signProviderReadProof("admission", { operationId, subscriptionId, readId, requestDigest, callerId, caller: { id: callerId, pid: 12345, host: "declared-proof-fixture", startedAt: "2026-11-13T00:00:00.000Z", bootId: null, pidNamespace: null, startTicks: null }, completionDigest: base.completionDigest, admissionDigest: merchantTaxDigest(base), sourceRevision: "c".repeat(64) }) };
  const operation: Operation = { id: operationId, subscriptionId, operationRevision: 1, kind: "cancel", originalRequest, requestDigest, providerApiVersion: "2026-10-28.endive", idempotencyKey: "original-signed-reader", state: "unknown", positiveObserved: true, createdAt: new Date(0), finishedAt: null, providerObservation: { history: [admission] } };
  return { admission, operation };
}
function stopped(admission: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  const proof = signProviderReadProof("stop_review", { readId, operationId, subscriptionId, requestDigest: admission.requestDigest, callerId,
    originalAdmission: admission, admissionDigest: merchantTaxDigest(admission), reviewedBy: "user:00000000-0000-4000-8000-000000000505", mechanicalCheck: "original_process_absent", hostingEvidenceDigest: "d".repeat(64), sourceRevision: "e".repeat(64), ...patch });
  return { source: "provider_read_stop_reviewed", operationId, requestDigest: admission.requestDigest, readId, receiptDigest: merchantTaxDigest(proof), proof };
}
describe("signed original provider reader proof", () => {
  it("verifies a real signature independently of JSON key order and refuses payload substitution", () => {
    const proof = signProviderReadProof("admission", { a: 1, b: 2 });
    expect(verifiedProviderReadProof({ ...proof, payload: { b: 2, a: 1 } }, "admission")).not.toBeNull();
    expect(verifiedProviderReadProof({ ...proof, payload: { a: 2, b: 2 } }, "admission")).toBeNull();
  });
  it("separates admission, actual finish and independent human review signing domains", () => {
    const proof = signProviderReadProof("admission", { readId });
    expect(verifiedProviderReadProof({ ...proof, kind: "finish" }, "finish")).toBeNull();
    expect(verifiedProviderReadProof({ ...proof, publicKey: "untrusted malformed public key" }, "admission")).toBeNull();
  });
  it("binds the actual signed admission to its original caller, nonce and operation", () => {
    const { admission } = original(); expect(originalProviderReadAdmission(admission)).toBe(true);
    for (const patch of [{ callerId: operationId }, { completionDigest: "f".repeat(64) }, { operationId: subscriptionId }]) expect(originalProviderReadAdmission({ ...admission, ...patch })).toBe(false);
  });
  it("requires the original key's signed actual finish for a newly signed admission", () => {
    const { admission, operation } = original();
    const finish = { source: "schedule_read_finished", readId, operationId, requestDigest: operation.requestDigest, completionDigest: admission.completionDigest, outcome: "returned", verified: true, actualDigest: "f".repeat(64) };
    operation.providerObservation.history = [admission, finish]; expect(originalProviderReadsFinished(operation)).toBe(false);
    const ownership = signProviderReadProof("finish", { readId, operationId, subscriptionId, callerId, requestDigest: operation.requestDigest, admissionDigest: merchantTaxDigest(admission), completionDigest: admission.completionDigest, outcome: "returned", factsDigest: "f".repeat(64) });
    operation.providerObservation.history = [admission, { ...finish, ownership }]; expect(originalProviderReadsFinished(operation)).toBe(true);
  });
  it("recognizes an independent signed stop while leaving the actual finish absent", () => {
    const { admission, operation } = original(), stop = stopped(admission);
    expect(stoppedProviderRead(admission, stop, subscriptionId)).toBe(true);
    operation.providerObservation.history = [admission, stop]; expect(originalProviderReadsFinished(operation)).toBe(true);
    expect(verifiedScheduleRead(operation, readId, "f".repeat(64))).toBe(false);
  });
  it("refuses another read's valid signed stop or missing original admission evidence", () => {
    const { admission } = original();
    for (const patch of [{ readId: operationId }, { operationId: readId }, { subscriptionId: callerId }, { originalAdmission: {} }, { reviewedBy: "agent:reviewer" }]) expect(stoppedProviderRead(admission, stopped(admission, patch), subscriptionId)).toBe(false);
  });
  it("does not accept a tampered independent stop receipt even when its public projection looks current", () => {
    const { admission } = original(), stop = stopped(admission);
    expect(stoppedProviderRead(admission, { ...stop, receiptDigest: "a".repeat(64) }, subscriptionId)).toBe(false);
    expect(stoppedProviderRead(admission, { ...stop, proof: { ...stop.proof, payload: { ...stop.proof.payload, mechanicalCheck: "unobservable_host_review" } } }, subscriptionId)).toBe(false);
  });
  it("retains historical sparse provenance without inventing a new signed admission", () => {
    const { admission } = original(), sparse: Record<string, unknown> = { ...admission }; delete sparse.ownership;
    expect(originalProviderReadAdmission(sparse)).toBe(true); expect(stoppedProviderRead(sparse, stopped(sparse), subscriptionId)).toBe(true);
    expect(sparse.ownership).toBeUndefined();
  });
  const authority = { expectedAdmissionDigest: "a", actualAdmissionDigest: "a", expectedSourceRevision: "b", actualSourceRevision: "b", expectedCallerId: callerId, actualCallerId: callerId, finished: false, liveness: "absent" as "live" | "absent" | "unobservable", runtimeEvidence: false };
  it.each([
    [{ liveness: "live", runtimeEvidence: true }, "live"], [{ liveness: "absent" }, "original_process_absent"],
    [{ liveness: "unobservable" }, "missing_runtime_evidence"], [{ liveness: "unobservable", runtimeEvidence: true }, "unobservable_host_review"],
    [{ finished: true }, "changed_or_finished"], [{ actualCallerId: readId }, "changed_or_finished"],
    [{ actualAdmissionDigest: "changed" }, "changed_or_finished"], [{ actualSourceRevision: "changed" }, "changed_or_finished"],
  ] as const)("checks authentic stop authority %o", (patch, expected) => { expect(providerReaderStopVerdict({ ...authority, ...patch })).toBe(expected); });
});
