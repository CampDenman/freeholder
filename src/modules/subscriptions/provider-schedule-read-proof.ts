// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: a GET has its own admission and finish, never the POST's nonce.
import type { subscriptionProviderScheduleOperations } from "./provider-schedule-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalProviderReadAdmission, stoppedProviderRead, verifiedProviderReadProof } from "./provider-read-signatures";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function signedFinishOwned(operation: Operation, admission: Record<string, unknown>, finish: Record<string, unknown>) {
  if (admission.ownership === undefined) return true;
  const original = verifiedProviderReadProof(admission.ownership, "admission"), actual = verifiedProviderReadProof(finish.ownership, "finish");
  return !!original && !!actual && actual.publicKey === original.publicKey && actual.payload.admissionDigest === merchantTaxDigest(admission)
    && actual.payload.readId === admission.readId && actual.payload.operationId === operation.id && actual.payload.subscriptionId === operation.subscriptionId
    && actual.payload.requestDigest === operation.requestDigest && actual.payload.callerId === admission.callerId
    && actual.payload.completionDigest === admission.completionDigest && actual.payload.outcome === finish.outcome;
}
/** A later successful GET cannot finish an earlier admitted physical reader.
 * Process loss or elapsed time leaves that original caller as recovery debt. */
export function originalProviderReadsFinished(operation: Operation): boolean {
  if (!Array.isArray(operation.providerObservation.history) || operation.providerObservation.history.length > 5000) return false;
  const history = operation.providerObservation.history.map(object);
  return history.every(admission => {
    if (!admission) return false;
    if (admission?.source !== "schedule_read_admitted" && admission?.source !== "phase_product_read_admitted") return true;
    if (admission.operationId !== operation.id || admission.requestDigest !== operation.requestDigest || typeof admission.readId !== "string"
      || typeof admission.completionDigest !== "string" || !/^[a-f0-9]{64}$/.test(admission.completionDigest)
      || admission.completionDigest === operation.originalRequest.callerCompletionDigest || !originalProviderReadAdmission(admission)) return false;
    const finished = admission.source === "schedule_read_admitted" ? "schedule_read_finished" : "phase_product_read_finished";
    return history.some(entry => !!entry && stoppedProviderRead(admission, entry, operation.subscriptionId)) || history.some(finish => {
      if (finish?.source !== finished || finish.readId !== admission.readId || finish.operationId !== operation.id
        || finish.requestDigest !== operation.requestDigest || finish.completionDigest !== admission.completionDigest || !["returned", "threw"].includes(String(finish.outcome))) return false;
      return signedFinishOwned(operation, admission, finish);
    });
  });
}
export function verifiedScheduleRead(operation: Operation, readId: unknown, actualDigest: unknown): boolean {
  if (typeof readId !== "string" || typeof actualDigest !== "string" || !Array.isArray(operation.providerObservation.history)) return false;
  const history = operation.providerObservation.history.map(object);
  const admitted = history.find(entry => entry?.source === "schedule_read_admitted" && entry.readId === readId && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest);
  if (operation.originalRequest.resourceKind === "phase_schedule_stop" && (admitted?.kind !== "phase_stop"
    || object(admitted.request)?.providerScheduleRef !== operation.originalRequest.providerScheduleRef)) return false;
  return !!admitted && originalProviderReadAdmission(admitted) && admitted.completionDigest !== operation.originalRequest.callerCompletionDigest && typeof admitted.completionDigest === "string" && /^[a-f0-9]{64}$/.test(admitted.completionDigest)
    && history.some(entry => entry?.source === "schedule_read_finished" && entry.readId === readId && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest
      && entry.completionDigest === admitted.completionDigest && entry.outcome === "returned" && entry.verified === true && entry.actualDigest === actualDigest && signedFinishOwned(operation, admitted, entry));
}
