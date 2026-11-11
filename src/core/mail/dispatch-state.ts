// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: commit a physical caller witness before entering provider I/O.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import type { Tx } from "@/core/service";
import { mailReceipts } from "./receipts";
import { originalMailRoute, type MailRouteInput } from "./dispatch-route";
import { mailDeliveries, mailDispatches, mailDispatchRequests, mailLegacyResolutions, mailOutbox } from "./schema";
import { lockMailHolds, mailRecordIsUnheld } from "./record-retention";

export async function claimPhysicalMailDispatch(tx: Tx, deliveryId: string, route: MailRouteInput, payload: string): Promise<string | null> {
  await lockContactIdentityForRead(tx);
  const receipts = await mailReceipts(tx);
  const [delivery] = await tx.select().from(mailDeliveries).where(eq(mailDeliveries.id, deliveryId)).for("update");
  if (!delivery || delivery.redactedAt || !["queued", "failed"].includes(delivery.status)) return null;
  const [request] = await tx.select().from(mailDispatchRequests).where(eq(mailDispatchRequests.deliveryId, deliveryId));
  const prior = await tx.select({ state: mailDispatches.state, attempt: mailDispatches.attempt }).from(mailDispatches).where(eq(mailDispatches.deliveryId, deliveryId));
  const [legacy] = await tx.select({ id: mailLegacyResolutions.deliveryId }).from(mailLegacyResolutions).where(eq(mailLegacyResolutions.deliveryId, deliveryId));
  const [body] = await tx.select({ id: mailOutbox.deliveryId }).from(mailOutbox).where(and(eq(mailOutbox.deliveryId, deliveryId), sql`${mailOutbox.createdAt} >= clock_timestamp()-interval '30 days'`));
  // Absence of a journal is historical uncertainty, never permission to
  // invent a route or retry a former caller. One intent has one physical call.
  if (!request || legacy || !body || prior.length !== delivery.attempts || request.admittedAttempt !== delivery.attempts + 1 || prior.some(row => row.state !== "not_submitted") || request.admittedAttempt > 20) return null;
  const snapshot = await originalMailRoute(tx, route, receipts);
  if (request.routeDigest !== receipts.digest("dispatch-route", JSON.stringify(snapshot)) || request.payloadDigest !== receipts.digest("dispatch-payload", payload)) {
    await tx.update(mailDeliveries).set({ status: "failed", lastError: "The original mail route or request changed. Review the original send before replacing it.", updatedAt: new Date() }).where(eq(mailDeliveries.id, deliveryId));
    return null;
  }
  const [dispatch] = await tx.insert(mailDispatches).values({ deliveryId, routeDigest: request.routeDigest, payloadDigest: request.payloadDigest, attempt: request.admittedAttempt, state: "running" }).returning({ id: mailDispatches.id });
  await tx.update(mailDeliveries).set({ attempts: request.admittedAttempt, updatedAt: new Date() }).where(eq(mailDeliveries.id, deliveryId));
  return dispatch!.id;
}

/** Unknown callers never reopen their request for an automatic retry. */
export async function markPhysicalMailUnknown(tx: Tx, dispatchId: string): Promise<void> {
  await mailReceipts(tx);
  const [dispatch] = await tx.select().from(mailDispatches).where(eq(mailDispatches.id, dispatchId));
  if (!dispatch) throw new Error("The original physical mail witness is missing. Restore its matching backup.");
  await tx.select({ id: mailDeliveries.id }).from(mailDeliveries).where(eq(mailDeliveries.id, dispatch.deliveryId)).for("update");
  await tx.update(mailDispatches).set({ state: "unknown" }).where(and(eq(mailDispatches.id, dispatchId), eq(mailDispatches.state, "running")));
  await tx.update(mailDeliveries).set({ status: "failed", lastError: "The original provider outcome is unknown. Verify that send and stop its caller before any replacement.", updatedAt: new Date() }).where(and(eq(mailDeliveries.id, dispatch.deliveryId), sql`exists(select 1 from ${mailDispatches} where ${mailDispatches.id}=${dispatchId} and ${mailDispatches.state}='unknown')`));
}

/** Apply only this exact caller's positive response, in the outcome TX. */
export async function acceptPhysicalMailSubmission(tx: Tx, dispatchId: string, providerRef: string): Promise<boolean> {
  const receipts = await mailReceipts(tx);
  const [dispatch] = await tx.select().from(mailDispatches).where(eq(mailDispatches.id, dispatchId)).for("update");
  if (!dispatch) throw new Error("The original physical mail witness is missing. Restore its matching backup.");
  if (dispatch.state !== "running" || dispatch.resolutionSource) return false;
  await tx.update(mailDispatches).set({ state: "submitted", providerRef, resolutionSource: "adapter", resolutionDigest: receipts.digest("dispatch-resolution", JSON.stringify({ dispatchId, outcome: "submitted", providerRef })), finishedAt: sql`clock_timestamp()` }).where(eq(mailDispatches.id, dispatchId));
  return true;
}

/** Legal holds cover the original body even after a positive send outcome. */
export async function removeSettledMailBody(tx: Tx, deliveryId: string, held: string[]): Promise<void> {
  const [eligible] = await tx.select({ id: mailDeliveries.id }).from(mailDeliveries).where(and(eq(mailDeliveries.id, deliveryId), isNull(mailDeliveries.redactedAt), mailRecordIsUnheld("delivery", mailDeliveries.id, held)));
  if (eligible) await tx.delete(mailOutbox).where(eq(mailOutbox.deliveryId, deliveryId));
}

export const physicallySettledMail = sql`(
 exists(select 1 from ${mailDispatches} where ${mailDispatches.deliveryId}=${mailDeliveries.id} and ${inArray(mailDispatches.state, ["submitted", "not_submitted"])})
 or exists(select 1 from ${mailLegacyResolutions} where ${mailLegacyResolutions.deliveryId}=${mailDeliveries.id})
) and not exists(select 1 from ${mailDispatches} where ${mailDispatches.deliveryId}=${mailDeliveries.id} and ${inArray(mailDispatches.state, ["running", "unknown"])})`;

export { lockMailHolds };
