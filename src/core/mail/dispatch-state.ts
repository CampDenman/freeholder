// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: commit a physical caller witness before entering provider I/O.
import { and, eq, isNull, sql } from "drizzle-orm";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { ServiceError, type Tx } from "@/core/service";
import { mailReceipts } from "./receipts";
import { originalMailRoute, type MailRouteInput } from "./dispatch-route";
import { mailDeliveries, mailDispatches, mailDispatchRequests, mailLegacyResolutions, mailOutbox, mailRecordSubjects } from "./schema";
import { lockMailHolds, mailRecordIsUnheld } from "./record-retention";

export class MailDispatchRefusal extends ServiceError {
  constructor(message: string) { super("conflict", message); }
}
export const MAIL_ROUTE_CHANGED = "The original mail route or request changed. Review the original send before replacing it.";
export const MAIL_RECIPIENT_RETIRED = "The original recipient's identity changed or was retired. The original private evidence remains for review.";

export async function claimPhysicalMailDispatch(tx: Tx, deliveryId: string, route: MailRouteInput, payload: string): Promise<string | null> {
  await lockContactIdentityForRead(tx);
  const receipts = await mailReceipts(tx);
  const [delivery] = await tx.select().from(mailDeliveries).where(eq(mailDeliveries.id, deliveryId)).for("update");
  if (!delivery || delivery.redactedAt || !["queued", "failed"].includes(delivery.status)) return null;
  const [retired] = await tx.execute<{ found: boolean }>(sql`select exists(select 1 from ${mailRecordSubjects} s where s.kind='delivery' and s.record_id=${deliveryId} and (s.contact_id is null or not exists(select 1 from contacts c where c.id=s.contact_id and c.email=${delivery.recipient}))) as found`);
  if (retired?.found) {
    throw new MailDispatchRefusal(MAIL_RECIPIENT_RETIRED);
  }
  const [request] = await tx.select().from(mailDispatchRequests).where(eq(mailDispatchRequests.deliveryId, deliveryId));
  const prior = await tx.select({ state: mailDispatches.state, attempt: mailDispatches.attempt }).from(mailDispatches).where(eq(mailDispatches.deliveryId, deliveryId));
  const [legacy] = await tx.select({ id: mailLegacyResolutions.deliveryId }).from(mailLegacyResolutions).where(eq(mailLegacyResolutions.deliveryId, deliveryId));
  const [body] = await tx.select({ id: mailOutbox.deliveryId }).from(mailOutbox).where(and(eq(mailOutbox.deliveryId, deliveryId), sql`${mailOutbox.createdAt} >= clock_timestamp()-interval '30 days'`));
  // Absence of a journal is historical uncertainty, never permission to
  // invent a route or retry a former caller. Each admission permits one call.
  if (!request || legacy || !body || prior.length !== delivery.attempts || request.admittedAttempt !== delivery.attempts + 1 || prior.some(row => row.state !== "not_submitted") || request.admittedAttempt > 20) return null;
  const snapshot = await originalMailRoute(tx, route, receipts);
  if (request.routeDigest !== receipts.digest("dispatch-route", JSON.stringify(snapshot)) || request.payloadDigest !== receipts.digest("dispatch-payload", payload)) {
    throw new MailDispatchRefusal(MAIL_ROUTE_CHANGED);
  }
  const [dispatch] = await tx.insert(mailDispatches).values({ deliveryId, routeDigest: request.routeDigest, payloadDigest: request.payloadDigest, attempt: request.admittedAttempt, state: "running" }).returning({ id: mailDispatches.id });
  await tx.update(mailDeliveries).set({ attempts: request.admittedAttempt, updatedAt: new Date() }).where(eq(mailDeliveries.id, deliveryId));
  return dispatch!.id;
}

/** Unknown callers never reopen their request for an automatic retry. */
export type ObservedMailReply = { providerRef: string; acceptance?: unknown; submitted: boolean };
export async function markPhysicalMailUnknown(tx: Tx, dispatchId: string, observed?: ObservedMailReply): Promise<void> {
  const receipts = await mailReceipts(tx);
  const [original] = await tx.select().from(mailDispatches).where(eq(mailDispatches.id, dispatchId));
  if (!original) throw new Error("The original physical mail witness is missing. Restore its matching backup.");
  await tx.select({ id: mailDeliveries.id }).from(mailDeliveries).where(eq(mailDeliveries.id, original.deliveryId)).for("update");
  const [dispatch] = await tx.select().from(mailDispatches).where(eq(mailDispatches.id, dispatchId)).for("update");
  if (!dispatch) throw new Error("The original physical mail witness is missing. Restore its matching backup.");
  // Preserve a reply observed before ordinary apply failed. This recovery
  // phase neither settles the request nor repeats provider I/O. Redacted
  // evidence keeps only the keyed receipt, never restored plaintext.
  if (observed?.submitted && (dispatch.state === "running" || dispatch.state === "unknown" || dispatch.resolutionSource === "human_provider_confirmation")) {
    const contradicted = dispatch.state === "not_submitted";
    await tx.update(mailDispatches).set({
      replyProviderRef: dispatch.redactedAt ? null : observed.providerRef,
      replyEvidenceDigest: receipts.digest("dispatch-resolution", JSON.stringify({ dispatchId, providerRef: observed.providerRef, acceptance: observed.acceptance })),
      ...(contradicted ? { state: "unknown" as const, finishedAt: null, resolutionSource: null } : {}),
    }).where(eq(mailDispatches.id, dispatchId));
  }
  await tx.update(mailDispatches).set({ state: "unknown" }).where(and(eq(mailDispatches.id, dispatchId), eq(mailDispatches.state, "running")));
  await tx.update(mailDeliveries).set({ status: "unknown", lastError: "The original provider outcome is unknown. Verify that send and stop its caller before any replacement.", updatedAt: new Date() }).where(and(eq(mailDeliveries.id, dispatch.deliveryId), sql`exists(select 1 from ${mailDispatches} where ${mailDispatches.id}=${dispatchId} and ${mailDispatches.state}='unknown')`));
}

/** Apply only this exact caller's positive response, in the outcome TX. */
export async function acceptPhysicalMailSubmission(tx: Tx, dispatchId: string, providerRef: string, acceptance?: unknown, submitted = true): Promise<boolean> {
  const receipts = await mailReceipts(tx);
  const [dispatch] = await tx.select().from(mailDispatches).where(eq(mailDispatches.id, dispatchId)).for("update");
  if (!dispatch) throw new Error("The original physical mail witness is missing. Restore its matching backup.");
  if (dispatch.state !== "running" || dispatch.resolutionSource) {
    if (submitted && dispatch.resolutionSource === "human_provider_confirmation") {
      const contradicted = dispatch.state === "not_submitted";
      await tx.update(mailDispatches).set({ replyProviderRef: dispatch.redactedAt ? null : providerRef, replyEvidenceDigest: receipts.digest("dispatch-resolution", JSON.stringify({ dispatchId, providerRef, acceptance })), ...(contradicted ? { state: "unknown" as const, finishedAt: null, resolutionSource: null } : {}) }).where(eq(mailDispatches.id, dispatchId));
      if (contradicted) await tx.update(mailDeliveries).set({ status: "unknown", lastError: "A positive original server reply conflicts with the prior review. Verify that exact send again.", updatedAt: new Date() }).where(eq(mailDeliveries.id, dispatch.deliveryId));
    }
    return false;
  }
  const outcome = submitted ? "submitted" as const : "not_submitted" as const;
  await tx.update(mailDispatches).set({ state: outcome, providerRef, resolutionSource: "adapter", resolutionDigest: receipts.digest("dispatch-resolution", JSON.stringify({ dispatchId, outcome, providerRef, acceptance })), finishedAt: sql`clock_timestamp()` }).where(eq(mailDispatches.id, dispatchId));
  return true;
}

/** Legal holds cover the original body even after a positive send outcome. */
export async function removeSettledMailBody(tx: Tx, deliveryId: string, held: string[]): Promise<void> {
  const [eligible] = await tx.select({ id: mailDeliveries.id }).from(mailDeliveries).where(and(eq(mailDeliveries.id, deliveryId), isNull(mailDeliveries.redactedAt), mailRecordIsUnheld("delivery", mailDeliveries.id, held)));
  if (eligible) await tx.delete(mailOutbox).where(eq(mailOutbox.deliveryId, deliveryId));
}

export { lockMailHolds };
