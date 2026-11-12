// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: every shared refund mutation respects original physical admission.
import { allowOriginalMerchantRefundWrites } from "./merchant-refund-store";
import { and, eq } from "drizzle-orm";
import { actorString, ServiceError, type ServiceContext } from "@/core/service";
import { routingForPayment } from "./merchant-charge";
import { assertMerchantRefundCreatorsQuiesced } from "./merchant-refund-dispatch";
import { lockMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundDispatches, merchantRefundObservations, merchantRefundRequests, merchantRefundReservationRetirements, merchantRefundTerminalReceipts, merchantRefundResourceBindings } from "./merchant-refund-schema";
import type { refunds } from "./schema";
async function originalRefund(ctx: ServiceContext, refund: typeof refunds.$inferSelect) {
  const routing = await routingForPayment(ctx, refund.paymentId);
  if (!routing.providerPlatformAccountId) return null;
  const [request] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refund.id));
  if (!request || request.paymentId !== refund.paymentId || request.amountMinor !== refund.amountMinor || request.currency !== refund.currency) throw new ServiceError("conflict", "Restore the exact original merchant refund receipt before changing its money state.");
  await lockMerchantRefundCash(ctx, { ...request, providerRef: request.originalPaymentRef });
  await allowOriginalMerchantRefundWrites(ctx.tx);
  return request;
}
/** Called after the existing refund lock; dispatch takes that lock before cash too. */
export async function retireOriginalMerchantRefund(ctx: ServiceContext, refund: typeof refunds.$inferSelect): Promise<void> {
  const original = await originalRefund(ctx, refund);
  if (!original) return;
  const [dispatch] = await ctx.tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, original.id)).limit(1);
  if (dispatch) throw new ServiceError("conflict", "This original refund was physically admitted. Reconcile its actual provider outcome; cancelling its local row cannot release that money.");
  await allowOriginalMerchantRefundWrites(ctx.tx);
  await ctx.tx.insert(merchantRefundReservationRetirements).values({ requestId: original.id, requestDigest: original.requestDigest,
    reason: "cancelled_before_dispatch", initiatedBy: actorString(ctx.actor) }).onConflictDoNothing();
}
export async function assertOriginalMerchantRefundStart(ctx: ServiceContext, refund: typeof refunds.$inferSelect, providerRef?: string): Promise<boolean> {
  const original = await originalRefund(ctx, refund);
  if (!original) return false;
  if (ctx.actor.kind !== "system") throw new ServiceError("permission", "Original merchant refund admission is an internal provider phase.");
  const [dispatch] = await ctx.tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, original.id)).limit(1);
  if (!dispatch) throw new ServiceError("conflict", "Commit the original physical refund admission before processing its provider work.");
  if (providerRef) {
    const [binding] = await ctx.tx.select({ id: merchantRefundResourceBindings.id }).from(merchantRefundResourceBindings).where(and(eq(merchantRefundResourceBindings.requestId, original.id), eq(merchantRefundResourceBindings.providerRef, providerRef))).limit(1);
    if (!binding) throw new ServiceError("conflict", "This provider reference is not bound to the actual original refund request.");
  }
  return true;
}
export async function assertOriginalMerchantRefundResult(ctx: ServiceContext, refund: typeof refunds.$inferSelect, outcome: "succeeded" | "failed", providerRef?: string): Promise<void> {
  const original = await originalRefund(ctx, refund);
  if (!original) return;
  await assertMerchantRefundCreatorsQuiesced(ctx, original.id);
  const [retired] = await ctx.tx.select().from(merchantRefundReservationRetirements).where(eq(merchantRefundReservationRetirements.requestId, original.id));
  if (outcome === "failed" && retired?.requestDigest === original.requestDigest) return;
  const bindings = await ctx.tx.select().from(merchantRefundResourceBindings).where(eq(merchantRefundResourceBindings.requestId, original.id)).limit(5001);
  const acks = bindings.filter(row => row.origin === "physical_ack"), refs = new Set((acks.length ? acks : bindings).map(row => row.providerRef));
  if (bindings.length > 5000 || refs.size !== 1 || providerRef && !refs.has(providerRef)) throw new ServiceError("conflict", "Restore the one actual original resource ACK or verified request-log binding before changing this refund.");
  const resource = [...refs][0]!;
  const observations = await ctx.tx.select().from(merchantRefundObservations).where(and(eq(merchantRefundObservations.requestId, original.id), eq(merchantRefundObservations.providerRef, resource))).limit(5001);
  const bound = observations.filter(row => row.bindingVerified && row.providerPlatformAccountId === original.providerPlatformAccountId && row.chargeAccountId === original.chargeAccountId
    && row.providerApiVersion === original.providerApiVersion && row.paymentProviderRef === original.originalPaymentRef && row.amountMinor === original.amountMinor && row.currency === original.currency);
  const unresolvedAction = bound.some(row => row.status === "requires_action" || row.status === null);
  const succeeded = bound.some(row => row.status === "succeeded"), failed = bound.some(row => row.status === "failed" || row.status === "canceled");
  // Later bank/action contradictions require their explicit current-state
  // reconciliation receipt. Historic positive money is never overwritten.
  if (observations.length > 5000 || succeeded && (failed || unresolvedAction) || outcome === "succeeded" && !succeeded || outcome === "failed" && !failed) throw new ServiceError("conflict", "Retain the actual original terminal refund proof; unknown or contradictory cash cannot release its reservation.");
  if (outcome === "failed") {
    const actual = bound.find(row => row.status === "failed" || row.status === "canceled")!;
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantRefundTerminalReceipts).values({ requestId: original.id, observationId: actual.id }).onConflictDoNothing();
  }
}
// Uncalled until the complete schema and common refund mutation hooks compose.
