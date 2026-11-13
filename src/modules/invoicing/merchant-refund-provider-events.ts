// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed feedback commits original refund facts before its applying transaction.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantRefundObservationCaptures } from "./merchant-refund-current-schema";
import { merchantRefundObservations, merchantRefundRequests, merchantRefundResourceBindings } from "./merchant-refund-schema";
import { recordMerchantRefundObservation } from "./merchant-refund-observations";
import { merchantTaxDigest } from "./merchant-tax-store";
import { routingForPayment } from "./merchant-charge";
import { payments } from "./schema";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";

export const originalRefundProviderEvent = z.object({
  id: z.string().min(1).max(500), kind: z.enum(["refund_processing", "refund_succeeded", "refund_failed"]),
  providerRef: z.string().min(1).max(500), paymentProviderRef: z.string().min(1).max(500).nullable(),
  observedPaymentIntentRef: z.string().min(1).max(500).nullable().optional(),
  providerChargeRef: z.string().min(1).max(500).optional(),
  providerAccountId: z.string().regex(/^(?:|acct_[A-Za-z0-9]+)$/).max(200).optional(),
  providerPlatformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).optional(),
  providerStatus: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable().optional(),
  observedProviderApiVersion: z.string().min(1).max(100).nullable().optional(),
  failureCode: z.literal("provider_cancelled").optional(), failureReason: z.string().max(100).optional(),
  failureBalanceTransactionRef: z.string().min(1).max(200).optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), occurredAt: z.string().datetime(),
});
type Event = z.infer<typeof originalRefundProviderEvent>;
function eventCaptureKey(provider: string, event: Event): string {
  return merchantTaxDigest({ kind: "authenticated-refund-event-v1", provider, eventId: event.id,
    platform: event.providerPlatformAccountId, account: event.providerAccountId || null });
}
interface Owner { requestId: string | null; paymentId: string | null; subscriptionChargeReceiptId: string | null }
async function owner(ctx: ServiceContext, event: Event): Promise<Owner | null> {
  if (!event.providerPlatformAccountId) return null;
  const requests = await ctx.tx.select({ original: merchantRefundRequests }).from(merchantRefundResourceBindings)
    .innerJoin(merchantRefundRequests, eq(merchantRefundRequests.id, merchantRefundResourceBindings.requestId))
    .where(and(eq(merchantRefundResourceBindings.providerRef, event.providerRef),
      eq(merchantRefundRequests.providerPlatformAccountId, event.providerPlatformAccountId),
      sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${event.providerAccountId || null}`)).limit(5001);
  const unique = new Map(requests.map(row => [row.original.id, row.original]));
  if (requests.length > 5000 || unique.size > 1) throw new ServiceError("conflict", "Restore this authenticated refund's one original resource binding; do not select it by amount or metadata.");
  const bound = unique.values().next().value;
  if (bound) return { requestId: bound.id, paymentId: bound.paymentId, subscriptionChargeReceiptId: bound.subscriptionChargeReceiptId };
  const intent = Object.hasOwn(event, "observedPaymentIntentRef") ? event.observedPaymentIntentRef
    : event.paymentProviderRef?.startsWith("pi_") ? event.paymentProviderRef : null;
  if (!intent) return null;
  // Unrequested refunds still own actual original cash. Preserve them without
  // fabricating a refund request, invoice, attempt or CRM subject.
  const receipts = await ctx.tx.select({ id: subscriptionProviderChargeReceipts.id }).from(subscriptionProviderChargeReceipts)
    .where(and(eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef, intent),
      eq(subscriptionProviderChargeReceipts.providerPlatformAccountId, event.providerPlatformAccountId),
      sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${event.providerAccountId || null}`)).limit(2);
  if (receipts.length > 1) throw new ServiceError("conflict", "Restore this refund's one original scheduled cash receipt.");
  if (receipts[0]) return { requestId: null, paymentId: null, subscriptionChargeReceiptId: receipts[0].id };
  const candidates = await ctx.tx.select({ id: payments.id }).from(payments).where(and(eq(payments.provider, "stripe"), eq(payments.providerRef, intent))).limit(5001);
  if (candidates.length > 5000) throw new ServiceError("conflict", "Restore the complete original cash namespace before associating refund feedback.");
  const owned: string[] = [];
  for (const payment of candidates) {
    const route = await routingForPayment(ctx, payment.id);
    if (route.providerPlatformAccountId === event.providerPlatformAccountId && (route.providerAccountId || null) === (event.providerAccountId || null)) owned.push(payment.id);
  }
  if (owned.length > 1) throw new ServiceError("conflict", "Restore this refund's one original applied cash owner; amount equality cannot select it.");
  return owned[0] ? { requestId: null, paymentId: owned[0], subscriptionChargeReceiptId: null } : null;
}

export const retainOriginalMerchantRefundEvent = defineService({
  name: "invoicing.retainOriginalMerchantRefundEvent", summary: "Commit signed original refund occurrences before applying any bank-state or invoice policy.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["provider"],
  input: z.object({ provider: z.string(), event: originalRefundProviderEvent }),
  output: z.object({ managed: z.boolean(), captureId: z.uuid().nullable() }),
  handler: async ({ provider, event }, ctx) => {
    const original = provider === "stripe" ? await owner(ctx, event) : null;
    if (!original) return { managed: false, captureId: null };
    if (event.amountMinor === undefined || event.currency === undefined) throw new ServiceError("conflict", "Retry this authenticated original refund after restoring its actual amount and currency; do not substitute the requested money.");
    const captured = await ctx.callAsSystem(recordMerchantRefundObservation, {
      source: original.paymentId ? { kind: "payment", paymentId: original.paymentId } : { kind: "subscription", receiptId: original.subscriptionChargeReceiptId! },
      ...(original.requestId ? { requestId: original.requestId } : {}), captureKey: eventCaptureKey(provider, event), evidence: {
        providerRef: event.providerRef, providerPlatformAccountId: event.providerPlatformAccountId!,
        ...(event.providerAccountId ? { providerAccountId: event.providerAccountId } : {}),
        providerApiVersion: event.observedProviderApiVersion ?? null,
        paymentProviderRef: Object.hasOwn(event, "observedPaymentIntentRef") ? event.observedPaymentIntentRef ?? null
          : event.paymentProviderRef?.startsWith("pi_") ? event.paymentProviderRef : null,
        ...(event.providerChargeRef ? { providerChargeRef: event.providerChargeRef } : {}),
        amountMinor: event.amountMinor, currency: event.currency, status: event.providerStatus ?? null,
        ...(event.failureCode ? { failureCode: event.failureCode } : {}),
        ...(event.failureReason ? { failureReason: event.failureReason } : {}),
        ...(event.failureBalanceTransactionRef ? { failureBalanceTransactionRef: event.failureBalanceTransactionRef } : {}),
        // Signed refund fields are facts; they do not replace the independent
        // exact-resource read and completion receipt required for bank closure.
        bindingVerified: true,
      },
    });
    return { managed: true, captureId: captured.captureId };
  },
});

export const originalMerchantRefundEventRetained = defineService({
  name: "invoicing.originalMerchantRefundEventRetained", summary: "Require the committed original signed refund occurrence before deferring its ordinary application to current-resource recovery.",
  kind: "query", permission: "system", external: false, input: z.object({ provider: z.string(), event: originalRefundProviderEvent }),
  output: z.object({ managed: z.boolean() }),
  handler: async ({ provider, event }, ctx) => {
    const original = provider === "stripe" ? await owner(ctx, event) : null;
    if (!original) return { managed: false };
    const [captured] = await ctx.tx.select({ requestId: merchantRefundObservations.requestId, providerRef: merchantRefundObservations.providerRef,
      paymentId: merchantRefundObservations.paymentId, receiptId: merchantRefundObservations.subscriptionChargeReceiptId })
      .from(merchantRefundObservationCaptures).innerJoin(merchantRefundObservations, eq(merchantRefundObservations.id, merchantRefundObservationCaptures.observationId))
      .where(eq(merchantRefundObservationCaptures.captureKey, eventCaptureKey(provider, event)));
    if (!captured || captured.requestId !== original.requestId || captured.providerRef !== event.providerRef
      || captured.paymentId !== original.paymentId || captured.receiptId !== original.subscriptionChargeReceiptId) throw new ServiceError("conflict", "Commit the authenticated original refund occurrence before applying its bank state.");
    return { managed: true };
  },
});

export default [retainOriginalMerchantRefundEvent, originalMerchantRefundEventRetained];
