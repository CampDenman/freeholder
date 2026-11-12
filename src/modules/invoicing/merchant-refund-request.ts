// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: immutable cash-owner arguments, including money with no local invoice.
import { stripeMerchantRefundBody } from "@/adapters/payments/stripe-merchant-refund-body";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { refunds } from "./schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError } from "@/core/service";
import { createRefund } from "./invoice-service";
import { lockMerchantRefundCash, merchantRefundSource, originalMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundRequests, type MerchantRefundProviderArguments } from "./merchant-refund-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
const minor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const input = z.object({ source: merchantRefundSource, amountMinor: minor, idempotencyKey: z.string().min(1).max(240),
  reason: z.string().trim().min(3).max(1000), initiatedBy: z.string().min(1).max(300) });
const originalRequest = z.object({ refundAttemptId: z.uuid(), paymentId: z.uuid().optional(), subscriptionChargeReceiptId: z.uuid().optional(),
  subscriptionOrigin: z.object({ providerApiVersion: z.literal("2026-10-28.endive"), providerSubscriptionRef: z.string(), providerInvoiceRef: z.string(), providerPaymentIntentRef: z.string() }).optional(),
  providerRef: z.string().regex(/^pi_[A-Za-z0-9_]+$/), providerPlatformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), providerAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).optional(),
  providerApiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]), currency: z.string().regex(/^[A-Z]{3}$/), amountMinor: minor,
  idempotencyKey: z.string(), frozenBody: z.string().min(1).max(5000), reverseTransfer: z.literal(false), refundApplicationFee: z.literal(false) });
export const merchantRefundRequestRow = z.object({ id: z.uuid(), purpose: z.enum(["invoice_refund", "unapplied_return"]), refundId: z.uuid().nullable(),
  paymentId: z.uuid().nullable(), originalObservationId: z.uuid().nullable(), subscriptionChargeReceiptId: z.uuid().nullable(), subscriptionChargeObservationId: z.uuid().nullable(),
  providerPlatformAccountId: z.string(), chargeAccountId: z.string().nullable(), providerApiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]),
  originalPaymentRef: z.string(), amountMinor: minor, originalCashAmountMinor: minor, currency: z.string(), idempotencyKey: z.string(), reasonDigest: z.string().length(64), originalRequest,
  requestDigest: z.string().length(64), createdAt: z.date() });
export const claimMerchantRefundRequest = defineService({
  name: "invoicing.claimMerchantRefundRequest", summary: "Freeze actual original cash and refund arguments before provider work, without inventing a payment.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input, output: merchantRefundRequestRow,
  auditInputFields: ["source", "amountMinor", "idempotencyKey", "initiatedBy"],
  handler: async (value, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund-idempotency:${value.idempotencyKey}`}))`);
    if (value.source.kind === "payment") await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${value.source.paymentId}`}))`);
    // Parent agreement locks, where needed by billing, precede this canonical
    // cash lock. This phase never subsequently acquires a subscription parent.
    const initial = await originalMerchantRefundCash(ctx, value.source);
    await lockMerchantRefundCash(ctx, initial);
    const cash = await originalMerchantRefundCash(ctx, value.source);
    const purpose = value.source.kind === "payment" && !value.source.observationId ? "invoice_refund" as const : "unapplied_return" as const;
    const [existing] = await ctx.tx.select().from(merchantRefundRequests).where(and(eq(merchantRefundRequests.providerPlatformAccountId, cash.providerPlatformAccountId),
      sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${cash.chargeAccountId}`, eq(merchantRefundRequests.idempotencyKey, value.idempotencyKey)));
    if (existing) {
      if (existing.purpose !== purpose || existing.amountMinor !== value.amountMinor || existing.reasonDigest !== merchantTaxDigest(value.reason)
        || existing.paymentId !== cash.paymentId || value.source.kind === "payment" && value.source.observationId !== undefined && existing.originalObservationId !== cash.originalObservationId
        || existing.subscriptionChargeReceiptId !== cash.subscriptionChargeReceiptId
        || value.source.kind === "subscription" && existing.subscriptionChargeObservationId !== cash.subscriptionChargeObservationId
        || existing.originalPaymentRef !== cash.providerRef || existing.originalCashAmountMinor !== cash.amountMinor || existing.currency !== cash.currency) throw new ServiceError("conflict", "That original refund key already binds different cash or arguments.");
      return merchantRefundRequestRow.parse(existing);
    }
    if (cash.amountMinor < value.amountMinor || purpose === "invoice_refund" && !cash.applied) throw new ServiceError("conflict", "Use the actual applied cash amount for an invoice refund.");
    if (purpose === "unapplied_return" && cash.applied) throw new ServiceError("conflict", "Use the ordinary invoice refund path for cash already applied to a payment.");
    if (purpose === "invoice_refund" && cash.paymentId) {
      // Existing pre-protocol reservations cannot be silently adopted. The
      // current core createRefund phase captures every newly inserted one,
      // including prepared return batches, before their transaction commits.
      const [old] = await ctx.tx.select().from(refunds).where(and(eq(refunds.provider, "stripe"), eq(refunds.idempotencyKey, value.idempotencyKey)));
      if (old) throw new ServiceError("conflict", "Restore the original merchant request receipt for this existing refund; no new POST is authorized.");
      const refund = await ctx.callAsSystem(createRefund, { paymentId: cash.paymentId, amountMinor: value.amountMinor, idempotencyKey: value.idempotencyKey, reason: value.reason });
      const [captured] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refund.id));
      if (!captured) throw new ServiceError("conflict", "The current shared refund source has not captured this original physical request.");
      return merchantRefundRequestRow.parse(captured);
    }
    const id = randomUUID();
    const frozenBody = stripeMerchantRefundBody({ refundAttemptId: id, paymentId: cash.paymentId ?? undefined, subscriptionChargeReceiptId: cash.subscriptionChargeReceiptId ?? undefined,
      providerPlatformAccountId: cash.providerPlatformAccountId, paymentProviderRef: cash.providerRef, amountMinor: value.amountMinor });
    const request: MerchantRefundProviderArguments = originalRequest.parse({ refundAttemptId: id,
      ...(cash.paymentId ? { paymentId: cash.paymentId } : { subscriptionChargeReceiptId: cash.subscriptionChargeReceiptId }),
      ...(cash.subscriptionOrigin ? { subscriptionOrigin: cash.subscriptionOrigin } : {}), providerRef: cash.providerRef,
      providerPlatformAccountId: cash.providerPlatformAccountId, ...(cash.chargeAccountId ? { providerAccountId: cash.chargeAccountId } : {}),
      providerApiVersion: cash.providerApiVersion, currency: cash.currency, amountMinor: value.amountMinor,
      idempotencyKey: `freeholder-merchant-refund:${id}`, frozenBody, reverseTransfer: false, refundApplicationFee: false });
    const [saved] = await ctx.tx.insert(merchantRefundRequests).values({ id, purpose, refundId: null,
      paymentId: cash.paymentId, originalObservationId: cash.originalObservationId, subscriptionChargeReceiptId: cash.subscriptionChargeReceiptId,
      subscriptionChargeObservationId: cash.subscriptionChargeObservationId, providerPlatformAccountId: cash.providerPlatformAccountId,
      chargeAccountId: cash.chargeAccountId, providerApiVersion: cash.providerApiVersion, originalPaymentRef: cash.providerRef,
      originalCashAmountMinor: cash.amountMinor, amountMinor: value.amountMinor, currency: cash.currency, idempotencyKey: value.idempotencyKey, reasonDigest: merchantTaxDigest(value.reason),
      originalRequest: request, requestDigest: merchantTaxDigest(request) }).returning();
    ctx.setSubject(cash.paymentId ? "payment" : "subscription_provider_charge", cash.paymentId ?? cash.subscriptionChargeReceiptId!);
    return merchantRefundRequestRow.parse(saved);
  },
});
// Unregistered until the matching application guard, dispatch and evidence qualify.
