// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: read/cancel exact original resources; no human absence or new charge.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantPaymentRecoveryRequest } from "@/adapters/payments";
import { actorString, defineOrchestratedService, defineService, ServiceError } from "@/core/service";
import { paymentRow } from "./contract";
import { assertChargeEvidence, paymentRouting, routingForPayment, verifiedCheckoutSession } from "./merchant-charge";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { merchantObservationRef, merchantPaymentEvidence, recordMerchantPaymentObservation } from "./merchant-payment-observations";
import { merchantPaymentRequests, merchantPaymentRetirementAcks, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { applyPaymentCheckout, recordProviderPaymentResult } from "./payment-provider-service";
import { invoices, payments } from "./schema";

const checkoutRef = z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(200);
const paymentRef = z.string().regex(/^pi_[A-Za-z0-9_]+$/).max(200);
const terminal = z.object({ checkoutRef, paymentRef: paymentRef.optional(), sessionStatus: z.enum(["expired", "complete"]), intentStatus: z.string().nullable(), amountReceivedMinor: z.literal(0) })
  .refine(value => value.sessionStatus === "expired"
    ? !value.paymentRef && value.intentStatus === null || Boolean(value.paymentRef && ["canceled", "requires_payment_method", "requires_confirmation", "requires_action"].includes(value.intentStatus ?? ""))
    : Boolean(value.paymentRef && value.intentStatus === "canceled"), "The provider must prove this original checkout can no longer collect money.");

export const merchantPaymentRecoverySource = defineService({
  name: "invoicing.merchantPaymentRecoverySource", summary: "Read the exact original request and charge namespace without replacing its provider contact after a CRM merge.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }),
  output: z.object({ payment: paymentRow, routing: paymentRouting, providerInvoiceRef: z.uuid(), providerContactRef: z.uuid() }),
  handler: async ({ paymentId }, ctx) => {
    const [source] = await ctx.tx.select({ payment: payments, request: merchantPaymentRequests }).from(payments)
      .innerJoin(merchantPaymentRequests, eq(merchantPaymentRequests.paymentId, payments.id)).where(eq(payments.id, paymentId));
    if (!source || source.payment.provider !== "stripe" || source.payment.method !== "hosted_checkout" || !source.payment.idempotencyKey) throw new ServiceError("conflict", "This original hosted payment has no durable provider request proof. Restore its actual receipt; do not infer a historical request from today's buyer.");
    const routing = await routingForPayment(ctx, paymentId);
    if (!routing.providerPlatformAccountId || source.request.providerInvoiceRef !== source.payment.invoiceId) throw new ServiceError("conflict", "The original merchant request has no matching immutable invoice and platform scope.");
    return { payment: source.payment, routing, providerInvoiceRef: source.request.providerInvoiceRef, providerContactRef: source.request.providerContactRef };
  },
});

export const retainMerchantRetirementAck = defineService({
  name: "invoicing.retainMerchantRetirementAck", summary: "Commit a positive original checkout expiration or authorization cancellation before subsequent reads.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), checkoutRef, paymentRef: paymentRef.optional(), kind: z.enum(["session_expired", "intent_canceled"]) }), output: z.object({ retained: z.literal(true) }),
  handler: async (input, ctx) => {
    const source = await ctx.callAsSystem(merchantPaymentRecoverySource, { paymentId: input.paymentId });
    if (source.payment.providerCheckoutRef && source.payment.providerCheckoutRef !== input.checkoutRef) throw new ServiceError("conflict", "This acknowledgement belongs to another original checkout.");
    if (input.kind === "intent_canceled" && !input.paymentRef) throw new ServiceError("validation", "The original canceled authorization must identify its PaymentIntent.");
    await ctx.tx.insert(merchantPaymentRetirementAcks).values({ ...input, evidenceDigest: merchantTaxDigest(input) }).onConflictDoNothing();
    ctx.setSubject("payment", input.paymentId);
    return { retained: true as const };
  },
});

export const applyMerchantTerminalReceipt = defineService({
  name: "invoicing.applyMerchantTerminalReceipt", summary: "Record authenticated original zero-money terminal proof before releasing this failed payment attempt.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: terminal.safeExtend({ paymentId: z.uuid(), initiatedBy: z.string().min(1).max(300) }), output: paymentRow,
  handler: async ({ paymentId, initiatedBy, ...proof }, ctx) => {
    const source = await ctx.callAsSystem(merchantPaymentRecoverySource, { paymentId });
    await ctx.tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, source.payment.invoiceId)).for("update");
    const [current] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    const positives = await ctx.tx.select({ id: merchantPaymentObservations.id }).from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.status, "succeeded"))).limit(1);
    if (!current || current.status === "succeeded" || positives.length || current.providerCheckoutRef && current.providerCheckoutRef !== proof.checkoutRef) throw new ServiceError("conflict", "Positive money or a different original checkout needs reconciliation before any terminal claim.");
    const [existing] = await ctx.tx.select().from(merchantPaymentTerminalReceipts).where(eq(merchantPaymentTerminalReceipts.paymentId, paymentId));
    const values = { paymentId, ...proof, paymentRef: proof.paymentRef ?? null };
    if (existing && Object.entries(values).some(([key, value]) => existing[key as keyof typeof existing] !== value)) throw new ServiceError("conflict", "This original attempt already has contradictory terminal provider evidence.");
    if (!existing) await ctx.tx.insert(merchantPaymentTerminalReceipts).values(values);
    if (["failed", "cancelled"].includes(current.status)) return current;
    return ctx.callAsSystem(recordProviderPaymentResult, { paymentId, initiatedBy, outcome: { kind: "fail", code: "provider_terminal_unpaid", message: "The original provider checkout is terminal with no received money." } });
  },
});

export const reconcileMerchantCheckout = defineOrchestratedService({
  name: "invoicing.reconcileMerchantCheckout", summary: "Recover or retire the authenticated original checkout; unknown effects remain blocked and positive money is retained first.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), action: z.enum(["inspect", "retire"]), checkoutRef: checkoutRef.optional() }).strict(),
  output: z.object({ payment: paymentRow, state: z.enum(["unresolved", "ambiguous", "open", "pending", "paid", "not_paid"]), checkoutRef: checkoutRef.optional(), checkoutUrl: z.string().url().optional(), checkoutExpiresAt: z.iso.datetime().optional(), unapplied: z.boolean() }),
  handler: async (input, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const source = await merchantPaymentRecoverySource.call({ paymentId: input.paymentId }, system);
    const { routing } = source, adapter = paymentAdapter(source.payment.provider);
    if (!adapter.recoverMerchantPayment || input.action === "retire" && !adapter.retireMerchantPayment) throw new ServiceError("conflict", "The configured provider cannot reconcile this original merchant checkout.");
    if (source.payment.providerCheckoutRef && input.checkoutRef && source.payment.providerCheckoutRef !== input.checkoutRef) throw new ServiceError("conflict", "Use this payment's exact original checkout reference.");
    let current = source.payment, unapplied = false;
    const observe: NonNullable<MerchantPaymentRecoveryRequest["onPaymentObserved"]> = async (_originalCheckout, evidence) => {
      await recordMerchantPaymentObservation.call({ paymentId: current.id, providerEventRef: merchantObservationRef(evidence), evidence }, system);
      if (evidence.status !== "succeeded") return;
      try {
        if (current.amountMinor !== evidence.amountMinor || current.currency !== evidence.currency) throw new ServiceError("conflict", "The provider's actual money differs from this original payment amount.");
        assertChargeEvidence(routing, evidence);
        if (current.status === "succeeded") {
          if (current.providerRef !== evidence.providerRef) throw new ServiceError("conflict", "An additional original provider charge needs separate reconciliation.");
          return;
        }
        current = await recordProviderPaymentResult.call({ paymentId: current.id, initiatedBy: actorString(caller), outcome: { kind: "settle", providerRef: evidence.providerRef, processedAt: evidence.occurredAt ? new Date(evidence.occurredAt) : undefined } }, system);
      } catch (error) {
        if (!(error instanceof ServiceError) || !["conflict", "validation"].includes(error.code)) throw error;
        unapplied = true;
      }
    };
    const request: MerchantPaymentRecoveryRequest = { ...routing, providerPlatformAccountId: routing.providerPlatformAccountId!, paymentAttemptId: current.id,
      invoiceId: source.providerInvoiceRef, contactId: source.providerContactRef, amountMinor: current.amountMinor, currency: current.currency,
      createdAt: current.createdAt.toISOString(), idempotencyKey: current.idempotencyKey, checkoutRef: current.providerCheckoutRef ?? input.checkoutRef,
      onPaymentObserved: observe, onRetirementAcknowledged: async proof => { await retainMerchantRetirementAck.call({ paymentId: current.id, ...proof }, system); } };
    const result = input.action === "retire" ? await adapter.retireMerchantPayment!(request) : await adapter.recoverMerchantPayment(request);
    if (result.state === "paid") await observe(result.checkoutRef, result.evidence);
    else if (result.state === "open") current = await applyPaymentCheckout.call({ paymentId: current.id, checkout: verifiedCheckoutSession.parse(result.checkout), initiatedBy: actorString(caller) }, system);
    else if (result.state === "not_paid") current = await applyMerchantTerminalReceipt.call({ paymentId: current.id, initiatedBy: actorString(caller), ...terminal.parse(result) }, system);
    else if (result.state === "pending") await recordMerchantPaymentObservation.call({ paymentId: current.id, providerEventRef: merchantObservationRef(result.evidence), evidence: merchantPaymentEvidence.parse(result.evidence) }, system);
    return { payment: current, state: result.state,
      checkoutRef: result.state === "open" ? result.checkout.providerRef : "checkoutRef" in result ? result.checkoutRef : undefined,
      checkoutUrl: result.state === "open" ? result.checkout.url : undefined,
      checkoutExpiresAt: result.state === "open" ? result.checkout.expiresAt : undefined, unapplied };
  },
});

export default [merchantPaymentRecoverySource, retainMerchantRetirementAck, applyMerchantTerminalReceipt, reconcileMerchantCheckout];
