// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: a GET has its own admission and finish, never the POST's nonce.
import type { subscriptionProviderScheduleOperations } from "./provider-schedule-schema";
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function verifiedScheduleRead(operation: Operation, readId: unknown, actualDigest: unknown): boolean {
  if (typeof readId !== "string" || typeof actualDigest !== "string" || !Array.isArray(operation.providerObservation.history)) return false;
  const history = operation.providerObservation.history.map(object);
  const admitted = history.find(entry => entry?.source === "schedule_read_admitted" && entry.readId === readId && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest);
  if (operation.originalRequest.resourceKind === "phase_schedule_stop" && (admitted?.kind !== "phase_stop"
    || object(admitted.request)?.providerScheduleRef !== operation.originalRequest.providerScheduleRef)) return false;
  return !!admitted && admitted.completionDigest !== operation.originalRequest.callerCompletionDigest && typeof admitted.completionDigest === "string" && /^[a-f0-9]{64}$/.test(admitted.completionDigest)
    && history.some(entry => entry?.source === "schedule_read_finished" && entry.readId === readId && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest
      && entry.completionDigest === admitted.completionDigest && entry.outcome === "returned" && entry.verified === true && entry.actualDigest === actualDigest);
}
