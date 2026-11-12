// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: receipt coverage complements authenticated HTTP and money application.
import { describe, expect, it } from "vitest";
import type { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
import { scheduleCallerHasStopped, scheduleKnownResources, scheduleOperationDigest, scheduleQuiescenceCovers } from "@/modules/subscriptions/provider-schedule-proof";

type Resource = typeof subscriptionProviderScheduleResources.$inferSelect;
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const subscriptionId = "00000000-0000-4000-8000-000000000080";
const id = "00000000-0000-4000-8000-000000000081";
const another = "00000000-0000-4000-8000-000000000082";
const operation = (over: Partial<Operation> = {}): Operation => {
  const value: Operation = {
  id, subscriptionId, operationRevision: 1, kind: "pause", providerApiVersion: "2026-10-28.endive",
  originalRequest: { providerSubscriptionRef: "sub_Original", providerPlatformAccountId: "acct_Original" },
  requestDigest: "a".repeat(64), idempotencyKey: "fictional-pause-80", state: "confirmed", positiveObserved: true,
  providerObservation: { history: [{ providerSubscriptionRef: "sub_Original", state: "paused" }] },
  createdAt: new Date("2026-11-12T00:00:00Z"), finishedAt: new Date("2026-11-12T00:01:00Z"), ...over,
  };
  return { ...value, originalRequest: { ...value.originalRequest, callerCompletionDigest: "c".repeat(64) },
    providerObservation: { ...value.providerObservation, history: [...value.providerObservation.history as unknown[],
      { source: "physical_caller_finished", operationId: value.id, requestDigest: value.requestDigest, completionDigest: "c".repeat(64) }] } };
};
const stoppedResource = (providerSubscriptionRef = "sub_Original") => ({ providerSubscriptionRef, providerState: "paused" as const, invoiceEnumerationDigest: "b".repeat(64), invoices: [] });
function resource(operations: Operation[] = [operation()]): Resource {
  return { subscriptionId, providerSubscriptionRef: "sub_Original", providerCustomerRef: "cus_Original", operationRevision: operations.length,
    evidenceRevision: 0, state: "quiesced", recoveryPending: false, createdAt: new Date("2026-11-12T00:00:00Z"), updatedAt: new Date("2026-11-12T00:02:00Z"),
    stoppedProof: { operationRevision: operations.length, evidenceRevision: 0, journalDigest: scheduleOperationDigest(operations), resources: [stoppedResource()] } };
}

describe("current original provider quiescence coverage", () => {
  it("accepts current settled original receipt coverage and refuses local pause flags", () => {
    expect(scheduleQuiescenceCovers(resource(), [operation()])).toBe(true);
    expect(scheduleQuiescenceCovers({ ...resource(), state: "active" }, [operation()])).toBe(false);
    expect(scheduleQuiescenceCovers({ ...resource(), stoppedProof: null }, [operation()])).toBe(false);
    expect(scheduleQuiescenceCovers({ ...resource(), recoveryPending: true }, [operation()])).toBe(false);
  });
  it("never uses a newer clock to settle unknown or running physical work", () => {
    for (const state of ["unknown", "running"] as const) {
      const operations = [operation({ state })];
      expect(scheduleQuiescenceCovers({ ...resource(operations), updatedAt: new Date("2099-01-01") }, operations)).toBe(false);
    }
  });
  it("does not mistake positive provider evidence for the admitted caller finishing", () => {
    const admitted = operation();
    admitted.providerObservation = { history: [{ providerSubscriptionRef: "sub_Original", state: "paused", source: "authenticated_invoice_payment" }] };
    expect(scheduleCallerHasStopped(admitted)).toBe(false);
    expect(scheduleQuiescenceCovers(resource([admitted]), [admitted])).toBe(false);
    admitted.providerObservation.history = [...admitted.providerObservation.history as unknown[],
      { source: "physical_caller_finished", operationId: another, requestDigest: admitted.requestDigest, completionDigest: "c".repeat(64) }];
    expect(scheduleCallerHasStopped(admitted)).toBe(false);
  });
  it("requires exact revisions, a complete contiguous journal and its original owner", () => {
    expect(scheduleQuiescenceCovers({ ...resource(), evidenceRevision: 1 }, [operation()])).toBe(false);
    expect(scheduleQuiescenceCovers({ ...resource(), operationRevision: 2 }, [operation()])).toBe(false);
    expect(scheduleQuiescenceCovers(resource([]), [])).toBe(false);
    const gap = [operation({ operationRevision: 2 })];
    expect(scheduleQuiescenceCovers(resource(gap), gap)).toBe(false);
    const foreign = [operation({ subscriptionId: another })];
    expect(scheduleQuiescenceCovers(resource(foreign), foreign)).toBe(false);
  });
  it("covers every alternate actual late-positive create without replacing the first resource", () => {
    const operations = [operation(), operation({ id: another, operationRevision: 2, kind: "create", originalRequest: { providerPlatformAccountId: "acct_Original" },
      providerObservation: { history: [{ providerSubscriptionRef: "sub_Late", state: "active" }] } })];
    const original = resource(operations);
    expect([...scheduleKnownResources(original, operations)!]).toEqual(["sub_Original", "sub_Late"]);
    expect(scheduleQuiescenceCovers(original, operations)).toBe(false);
    original.stoppedProof!.resources.push(stoppedResource("sub_Late"));
    expect(scheduleQuiescenceCovers(original, operations)).toBe(true);
    expect(original.providerSubscriptionRef).toBe("sub_Original");
  });
  it("keeps a positive create without its actual resource reference unresolved", () => {
    const operations = [operation({ kind: "create", providerObservation: { history: [{ state: "active" }] } })];
    expect(scheduleKnownResources(resource(operations), operations)).toBeNull();
    expect(scheduleQuiescenceCovers(resource(operations), operations)).toBe(false);
  });
  it("is independent of object key order while preserving appended observed facts", () => {
    const left = operation({ providerObservation: { history: [{ state: "paused", providerSubscriptionRef: "sub_Original" }] } });
    const right = operation({ providerObservation: { history: [{ providerSubscriptionRef: "sub_Original", state: "paused" }] } });
    expect(scheduleOperationDigest([left])).toBe(scheduleOperationDigest([right]));
    const before = resource([left]);
    const after = operation({ providerObservation: { history: [{ providerSubscriptionRef: "sub_Original", state: "paused" }, { providerSubscriptionRef: "sub_Late", state: "active" }] } });
    expect(scheduleQuiescenceCovers(before, [after])).toBe(false);
  });
  it("requires a complete original enumeration witness and canonical paid-money references", () => {
    const original = resource();
    original.stoppedProof!.resources[0]!.invoiceEnumerationDigest = "";
    expect(scheduleQuiescenceCovers(original, [operation()])).toBe(false);
    original.stoppedProof!.resources[0]!.invoiceEnumerationDigest = "b".repeat(64);
    original.stoppedProof!.resources[0]!.invoices.push({ providerInvoiceRef: "in_Original", state: "paid", cancelledIntentRefs: [], paid: [] });
    expect(scheduleQuiescenceCovers(original, [operation()])).toBe(false);
    original.stoppedProof!.resources[0]!.invoices[0]!.paid.push({ providerPaymentIntentRef: "pi_Original", receiptId: id, paymentId: another, invoiceId: subscriptionId });
    expect(scheduleQuiescenceCovers(original, [operation()])).toBe(true);
    original.stoppedProof!.resources[0]!.invoices[0]!.cancelledIntentRefs.push("pi_Original");
    expect(scheduleQuiescenceCovers(original, [operation()])).toBe(false);
  });
});
