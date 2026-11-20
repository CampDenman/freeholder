// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual primary schedules and linked subscriptions are separate facts.
import { verifiedScheduleRead } from "./provider-schedule-read-proof";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import type { PhaseScheduleStopProof, subscriptionProviderScheduleOperations } from "./provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const schedule = (value: unknown): value is string => typeof value === "string" && /^sub_sched_[A-Za-z0-9]{1,195}$/.test(value);
const subscription = (value: unknown): value is string => typeof value === "string" && /^sub_[A-Za-z0-9]{1,195}$/.test(value);
export interface OriginalPhaseResource { providerScheduleRef: string; providerSubscriptionRefs: Set<string>; creationOperationIds: Set<string>; firstPhaseStart: string | null }
/** An absent positive primary ID is debt. Current nullable linkage never proves
 * an original subscription did not exist; only separate stop proof may do so. */
export function originalPhaseResources(operations: readonly Operation[]): Map<string, OriginalPhaseResource> | null {
  const result = new Map<string, OriginalPhaseResource>();
  for (const operation of operations) {
    if (!["phase_schedule", "phase_schedule_stop"].includes(String(operation.originalRequest.resourceKind))) continue;
    if (merchantTaxDigest(operation.originalRequest) !== operation.requestDigest || !Array.isArray(operation.providerObservation.history)) return null;
    let actualPrimary = false; const operationPrimaries = new Set<string>();
    for (const item of operation.providerObservation.history) {
      const entry = object(item);
      if (!entry || entry.operationId !== operation.id || entry.requestDigest !== operation.requestDigest || !["phase_schedule_ack", "phase_schedule_read_verified", "phase_schedule_read_stale", "phase_schedule_stop_ack"].includes(String(entry.source))) continue;
      if (!schedule(entry.providerScheduleRef)) return null;
      actualPrimary = true; operationPrimaries.add(entry.providerScheduleRef);
      const prior = result.get(entry.providerScheduleRef) ?? { providerScheduleRef: entry.providerScheduleRef, providerSubscriptionRefs: new Set<string>(), creationOperationIds: new Set<string>(), firstPhaseStart: null };
      if (operation.originalRequest.resourceKind === "phase_schedule") {
        prior.creationOperationIds.add(operation.id);
        const phases = operation.originalRequest.phases;
        if (Array.isArray(phases) && phases.length && object(phases[0])?.start && typeof object(phases[0])!.start === "string") {
          const start = String(object(phases[0])!.start);
          if (!prior.firstPhaseStart || start < prior.firstPhaseStart) prior.firstPhaseStart = start;
        }
      }
      if (entry.providerSubscriptionRef !== null && entry.providerSubscriptionRef !== undefined) {
        if (!subscription(entry.providerSubscriptionRef)) return null; prior.providerSubscriptionRefs.add(entry.providerSubscriptionRef);
      }
      const stopped = object(entry.actual);
      if (entry.source === "phase_schedule_stop_ack") {
        if (!stopped || stopped.providerScheduleRef !== entry.providerScheduleRef || !Array.isArray(stopped.providerSubscriptionRefs)) return null;
        for (const ref of stopped.providerSubscriptionRefs) { if (!subscription(ref)) return null; prior.providerSubscriptionRefs.add(ref); }
      }
      result.set(entry.providerScheduleRef, prior);
    }
    if (operation.originalRequest.resourceKind === "phase_schedule" && !actualPrimary) return null;
    if (operation.originalRequest.resourceKind === "phase_schedule") for (const item of operation.providerObservation.history) {
      const entry = object(item);
      if (entry?.source !== "authenticated_invoice_payment") continue;
      if (!subscription(entry.providerSubscriptionRef) || operationPrimaries.size !== 1) return null;
      result.get([...operationPrimaries][0]!)!.providerSubscriptionRefs.add(entry.providerSubscriptionRef);
    }
  }
  return result;
}

/** A provider stop ACK never substitutes for the actual admitted caller finish. */
export function phaseOperationCallerFinished(operation: Operation, requireReturned = false): boolean {
  const nonce = operation.originalRequest.callerCompletionDigest;
  return typeof nonce === "string" && /^[a-f0-9]{64}$/.test(nonce) && Array.isArray(operation.providerObservation.history)
    && operation.providerObservation.history.some(value => {
      const entry = object(value); return entry?.source === "physical_caller_finished" && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest
        && entry.completionDigest === nonce && (entry.outcome === "returned" || !requireReturned && entry.outcome === "threw");
    });
}
/** Only complete original positive resources, actual cancel returns and their
 * authenticated linked inventory can close a primary schedule. */
export function closedOriginalPhaseSchedules(operations: readonly Operation[]): PhaseScheduleStopProof[] | null {
  const resources = originalPhaseResources(operations); if (!resources) return null;
  const result: PhaseScheduleStopProof[] = [];
  for (const resource of resources.values()) {
    if (!resource.creationOperationIds.size) return null;
    for (const id of resource.creationOperationIds) {
      const creator = operations.find(operation => operation.id === id); if (!creator || !phaseOperationCallerFinished(creator)) return null;
    }
    const stop = [...operations].reverse().find(operation => operation.originalRequest.resourceKind === "phase_schedule_stop" && operation.originalRequest.providerScheduleRef === resource.providerScheduleRef);
    if (!stop || stop.kind !== "cancel" || stop.state !== "confirmed" || !phaseOperationCallerFinished(stop) || !Array.isArray(stop.providerObservation.history)) return null;
    const entries = stop.providerObservation.history.map(object).filter(entry => entry?.source === "phase_schedule_stop_ack" && entry.operationId === stop.id && entry.requestDigest === stop.requestDigest);
    const entry = entries.at(-1), actual = object(entry?.actual);
    if (!entry || !actual || actual.providerScheduleRef !== resource.providerScheduleRef || actual.linkedInventoryComplete !== true || !["canceled", "completed", "released"].includes(String(actual.state))
      || !Array.isArray(actual.providerSubscriptionRefs) || actual.providerSubscriptionRefs.some(value => !subscription(value))
      || merchantTaxDigest(actual) !== entry.actualDigest || new Set(actual.providerSubscriptionRefs).size !== actual.providerSubscriptionRefs.length) return null;
    if (!phaseOperationCallerFinished(stop, true) && !verifiedScheduleRead(stop, entry.readId, entry.actualDigest)) return null;
    const actualRefs = actual.providerSubscriptionRefs.filter(subscription), refs = [...resource.providerSubscriptionRefs].sort();
    if (actualRefs.some(ref => !resource.providerSubscriptionRefs.has(ref))) return null;
    const never = object(actual.neverStartedProof);
    if (!refs.length && (!never || actual.state !== "canceled" || never.originalFirstPhaseStart !== resource.firstPhaseStart
      || stop.originalRequest.originalFirstPhaseStart !== resource.firstPhaseStart || typeof never.providerCanceledAt !== "string"
      || typeof never.providerCreatedAt !== "string" || !Number.isFinite(Date.parse(never.providerCreatedAt)) || Date.parse(never.providerCreatedAt) < 0
      || !Number.isFinite(Date.parse(never.providerCanceledAt)) || Date.parse(never.providerCanceledAt) < Date.parse(never.providerCreatedAt) || !resource.firstPhaseStart || Date.parse(never.providerCanceledAt) >= Date.parse(resource.firstPhaseStart))) return null;
    result.push({ providerScheduleRef: resource.providerScheduleRef, stopOperationId: stop.id, stopEvidenceDigest: String(entry.actualDigest), linkedSubscriptionRefs: refs,
      state: actual.state as PhaseScheduleStopProof["state"], neverStartedProof: never ? { originalFirstPhaseStart: String(never.originalFirstPhaseStart), providerCreatedAt: String(never.providerCreatedAt), providerCanceledAt: String(never.providerCanceledAt) } : null });
  }
  return result;
}
