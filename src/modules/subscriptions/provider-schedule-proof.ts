// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a quiescence receipt covers exact durable facts, never a local status.
import { createHash } from "node:crypto";
import { originalPhaseResources, closedOriginalPhaseSchedules } from "./provider-phase-resources";
import type { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";

type Resource = typeof subscriptionProviderScheduleResources.$inferSelect;
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const record = object(value);
  return record ? Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)])) : value;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const providerReference = (value: unknown): string | null => typeof value === "string" && /^sub_[A-Za-z0-9]{1,195}$/.test(value) ? value : null;
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sha256 = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** A provider ACK/webhook cannot prove the original admitted caller finished.
 * The finish phase validates its private nonce; stopped-caller review validates
 * fresh human authority before appending these separately bound witnesses. */
export function scheduleCallerHasStopped(operation: Operation): boolean {
  const completionDigest = operation.originalRequest.callerCompletionDigest;
  if (!sha256(completionDigest) || !Array.isArray(operation.providerObservation.history)) return false;
  return operation.providerObservation.history.some(value => {
    const entry = object(value);
    if (entry?.operationId !== operation.id || entry.requestDigest !== operation.requestDigest) return false;
    if (entry.source === "physical_caller_finished") return entry.completionDigest === completionDigest;
    return entry.source === "human_stopped_caller" && typeof entry.actor === "string" && entry.actor.startsWith("user:") && uuid(entry.actor.slice(5))
      && sha256(entry.stoppedCallerEvidenceDigest) && sha256(entry.providerFinalEvidenceDigest);
  });
}

/** Stable input order is explicit: database/default JSON property order is irrelevant. */
export function scheduleOperationDigest(operations: readonly Operation[]): string {
  return digest([...operations].sort((left, right) => left.operationRevision - right.operationRevision || left.id.localeCompare(right.id))
    .map(operation => [operation.id, operation.subscriptionId, operation.operationRevision, operation.kind,
      operation.providerApiVersion, operation.requestDigest, operation.idempotencyKey, operation.state,
      operation.positiveObserved, operation.providerObservation]));
}

/** An alternate late-positive create remains a real original remote resource. */
export function scheduleKnownResources(resource: Resource, operations: readonly Operation[]): Set<string> | null {
  const references = new Set<string>();
  const phases = originalPhaseResources(operations);
  if (!phases) return null;
  for (const phase of phases.values()) for (const linked of phase.providerSubscriptionRefs) references.add(linked);
  if (resource.providerSubscriptionRef) references.add(resource.providerSubscriptionRef);
  for (const operation of operations) {
    const target = providerReference(operation.originalRequest.providerSubscriptionRef);
    if (target) references.add(target);
    const history = operation.providerObservation.history;
    if (history !== undefined && !Array.isArray(history)) return null;
    let actualCreate = false;
    for (const entry of Array.isArray(history) ? history : []) {
      const observation = object(entry);
      const actual = providerReference(observation?.providerSubscriptionRef);
      if (actual) { references.add(actual); actualCreate = true; }
    }
    if (operation.kind === "create" && operation.originalRequest.resourceKind !== "phase_schedule" && operation.positiveObserved && !actualCreate) return null;
  }
  return references;
}

/** Cash application and fee-debt checks are additional required query phases. */
export function scheduleQuiescenceCovers(resource: Resource | undefined, operations: readonly Operation[]): boolean {
  if (!resource || resource.state !== "quiesced" || resource.recoveryPending || !resource.stoppedProof
    || !resource.providerCustomerRef || !resource.providerSubscriptionRef && !resource.stoppedProof.phaseSchedules?.length
    || resource.operationRevision < 1
    || resource.stoppedProof.operationRevision !== resource.operationRevision
    || resource.stoppedProof.evidenceRevision !== resource.evidenceRevision
    || resource.stoppedProof.journalDigest !== scheduleOperationDigest(operations)
    || operations.length !== resource.operationRevision
    || [...operations].sort((left, right) => left.operationRevision - right.operationRevision).some((operation, index) => operation.operationRevision !== index + 1)
    || operations.some(operation => operation.subscriptionId !== resource.subscriptionId || !["confirmed", "refused"].includes(operation.state) || !scheduleCallerHasStopped(operation))) return false;
  const phases = originalPhaseResources(operations); if (!phases) return false;
  if (phases.size) {
    const closed = closedOriginalPhaseSchedules(operations);
    if (!closed || closed.length !== phases.size || digest(closed) !== digest(resource.stoppedProof.phaseSchedules)) return false;
  } else if (resource.stoppedProof.phaseSchedules?.length) return false;
  const references = scheduleKnownResources(resource, operations);
  if (!references || !references.size && !phases.size || resource.stoppedProof.resources.length !== references.size) return false;
  const seen = new Set<string>();
  for (const actual of resource.stoppedProof.resources) {
    if (!references.has(actual.providerSubscriptionRef) || seen.has(actual.providerSubscriptionRef)
      || !["paused", "cancelled"].includes(actual.providerState) || !/^[a-f0-9]{64}$/.test(actual.invoiceEnumerationDigest)) return false;
    seen.add(actual.providerSubscriptionRef);
    const invoiceRefs = new Set<string>();
    for (const invoice of actual.invoices) {
      if (!/^in_[A-Za-z0-9]{1,196}$/.test(invoice.providerInvoiceRef) || invoiceRefs.has(invoice.providerInvoiceRef)
        || !["paid", "void"].includes(invoice.state)) return false;
      invoiceRefs.add(invoice.providerInvoiceRef);
      const intentRefs = [...invoice.cancelledIntentRefs, ...invoice.paid.map(payment => payment.providerPaymentIntentRef), ...(invoice.returnedUnapplied ?? []).map(payment => payment.providerPaymentIntentRef)];
      if (new Set(intentRefs).size !== intentRefs.length || intentRefs.some(ref => !/^pi_[A-Za-z0-9]{1,196}$/.test(ref))
        || invoice.paid.some(payment => !uuid(payment.receiptId) || !uuid(payment.paymentId) || !uuid(payment.invoiceId))
        || (invoice.returnedUnapplied ?? []).some(payment => !uuid(payment.receiptId) || !uuid(payment.returnReceiptId))
        || invoice.zeroTotalInvoiceId !== undefined && !uuid(invoice.zeroTotalInvoiceId)
        || invoice.state === "paid" && invoice.paid.length === 0 && !invoice.returnedUnapplied?.length && !invoice.zeroTotalInvoiceId) return false;
    }
  }
  return true;
}
