// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: read/cancel exact original resources; no human absence or new charge.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withProrationPaymentRecovery, type ProrationRecoveryObserver } from "@/modules/subscriptions/proration-card-read-runtime";
import { paymentAdapter, type MerchantIntentRecoveryRequest, type MerchantPaymentRecoveryRequest } from "@/adapters/payments";
import { actorString, defineOrchestratedService, defineService, ServiceError, type Actor } from "@/core/service";
import { paymentRow } from "./contract";
import { assertChargeEvidence, paymentRouting, routingForPayment, verifiedCheckoutSession } from "./merchant-charge";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { merchantObservationRef, merchantPaymentEvidence } from "./merchant-payment-observations";
import { merchantPaymentRequests, merchantPaymentResourceBindings, merchantPaymentRetirementAcks, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { applyPaymentCheckout, recordProviderPaymentResult } from "./payment-provider-service";
import { invoices, payments } from "./schema";
import { merchantCheckoutReference as checkoutRef, merchantIntentReference as paymentRef, merchantTerminalProof as terminal } from "./merchant-terminal-proof";
import { flushLocalMerchantPaymentDispatchFinishes } from "./merchant-payment-request";

export const merchantPaymentRecoverySource = defineService({
  name: "invoicing.merchantPaymentRecoverySource", summary: "Read the exact original request and charge namespace without replacing its provider contact after a CRM merge.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }),
  output: z.object({ payment: paymentRow, routing: paymentRouting, providerInvoiceRef: z.uuid(), providerContactRef: z.uuid(), originalResourceRefs: z.array(z.string()) }),
  handler: async ({ paymentId }, ctx) => {
    const [source] = await ctx.tx.select({ payment: payments, request: merchantPaymentRequests }).from(payments)
      .innerJoin(merchantPaymentRequests, eq(merchantPaymentRequests.paymentId, payments.id)).where(eq(payments.id, paymentId));
    if (!source || source.payment.provider !== "stripe" || !["hosted_checkout", "saved_method"].includes(source.payment.method) || !source.payment.idempotencyKey) throw new ServiceError("conflict", "This original payment has no durable provider request proof. Restore its actual receipt; do not infer a historical request from today's buyer.");
    const routing = await routingForPayment(ctx, paymentId);
    if (!routing.providerPlatformAccountId || source.request.providerInvoiceRef !== source.payment.invoiceId) throw new ServiceError("conflict", "The original merchant request has no matching immutable invoice and platform scope.");
    const bindings = await ctx.tx.select().from(merchantPaymentResourceBindings).where(eq(merchantPaymentResourceBindings.paymentId, paymentId)).orderBy(desc(merchantPaymentResourceBindings.observedAt), desc(merchantPaymentResourceBindings.id)).limit(1001);
    if (bindings.length > 1000) throw new ServiceError("conflict", "The original provider request provenance exceeds its review bound.");
    const originalResourceRefs = ["checkout", "intent"].flatMap(kind => {
      const matching = bindings.filter(binding => binding.resourceKind === kind), acks = matching.filter(binding => binding.origin === "physical_ack");
      return acks.length ? [...new Set(acks.map(binding => binding.resourceRef))] : matching.length ? [matching[0]!.resourceRef] : [];
    });
    return { payment: source.payment, routing, providerInvoiceRef: source.request.providerInvoiceRef, providerContactRef: source.request.providerContactRef, originalResourceRefs };
  },
});

export const retainMerchantRetirementAck = defineService({
  name: "invoicing.retainMerchantRetirementAck", summary: "Commit a positive original checkout expiration or PaymentIntent cancellation before subsequent reads.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), checkoutRef: checkoutRef.optional(), paymentRef: paymentRef.optional(), kind: z.enum(["session_expired", "intent_canceled"]) }), output: z.object({ retained: z.literal(true) }),
  handler: async (input, ctx) => {
    const source = await ctx.callAsSystem(merchantPaymentRecoverySource, { paymentId: input.paymentId });
    if (source.payment.providerCheckoutRef && source.payment.providerCheckoutRef !== input.checkoutRef) throw new ServiceError("conflict", "This acknowledgement belongs to another original checkout.");
    if (source.payment.method === "hosted_checkout" ? !input.checkoutRef : input.checkoutRef || !input.paymentRef || input.kind !== "intent_canceled") throw new ServiceError("conflict", "The physical cancellation must identify this original payment's actual resource type.");
    if (input.paymentRef && source.payment.providerRef?.startsWith("pi_") && source.payment.providerRef !== input.paymentRef) throw new ServiceError("conflict", "This acknowledgement belongs to another original PaymentIntent.");
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
    if (!current || current.status === "succeeded" || positives.length || current.providerCheckoutRef && current.providerCheckoutRef !== proof.checkoutRef
      || (source.payment.method === "hosted_checkout" ? !proof.checkoutRef : Boolean(proof.checkoutRef || proof.sessionStatus || !proof.paymentRef))
      || proof.paymentRef && current.providerRef?.startsWith("pi_") && current.providerRef !== proof.paymentRef
      || !source.originalResourceRefs.includes(proof.checkoutRef ?? proof.paymentRef ?? "")) throw new ServiceError("conflict", "Positive money or an unproved original request/resource needs reconciliation before any terminal claim.");
    const [existing] = await ctx.tx.select().from(merchantPaymentTerminalReceipts).where(eq(merchantPaymentTerminalReceipts.paymentId, paymentId));
    const values = { paymentId, ...proof, checkoutRef: proof.checkoutRef ?? null, sessionStatus: proof.sessionStatus ?? null, paymentRef: proof.paymentRef ?? null };
    if (existing && Object.entries(values).some(([key, value]) => existing[key as keyof typeof existing] !== value)) throw new ServiceError("conflict", "This original attempt already has contradictory terminal provider evidence.");
    if (!existing) await ctx.tx.insert(merchantPaymentTerminalReceipts).values(values);
    if (["failed", "cancelled"].includes(current.status)) return current;
    return ctx.callAsSystem(recordProviderPaymentResult, { paymentId, initiatedBy, outcome: { kind: "fail", code: "provider_terminal_unpaid", message: "The original provider resource is terminal with no received money." } });
  },
});

type RecoveryInput = { paymentId: string; action: "inspect" | "retire"; checkoutRef?: string; paymentRef?: string };
async function reconcileOriginalMerchantResource(input: RecoveryInput, caller: Actor) {
  return withProrationPaymentRecovery(input, caller, observer => reconcileOriginalMerchantResourceBody(input, caller, observer));
}
async function reconcileOriginalMerchantResourceBody(input: RecoveryInput, caller: Actor, observer: ProrationRecoveryObserver) {
    const system = { kind: "system", request: caller.request } as const;
    await flushLocalMerchantPaymentDispatchFinishes(input.paymentId);
    const source = await merchantPaymentRecoverySource.call({ paymentId: input.paymentId }, system);
    const { routing } = source, adapter = paymentAdapter(source.payment.provider);
    const saved = source.payment.method === "saved_method";
    if (saved ? Boolean(input.checkoutRef) : Boolean(input.paymentRef)) throw new ServiceError("validation", "Use the original resource type for this payment method.");
    if (saved ? !adapter.recoverMerchantIntent || input.action === "retire" && !adapter.retireMerchantIntent : !adapter.recoverMerchantPayment || input.action === "retire" && !adapter.retireMerchantPayment) throw new ServiceError("conflict", "The configured provider cannot reconcile this original merchant payment.");
    if (source.payment.providerCheckoutRef && input.checkoutRef && source.payment.providerCheckoutRef !== input.checkoutRef) throw new ServiceError("conflict", "Use this payment's exact original checkout reference.");
    if (saved && source.payment.providerRef && input.paymentRef && source.payment.providerRef !== input.paymentRef) throw new ServiceError("conflict", "Use this payment's exact original PaymentIntent reference.");
    const original = saved
      ? source.payment.providerRef ?? input.paymentRef ?? source.originalResourceRefs.find(ref => ref.startsWith("pi_"))
      : source.payment.providerCheckoutRef ?? input.checkoutRef ?? source.originalResourceRefs.find(ref => ref.startsWith("cs_"));
    if (input.action === "retire" && (!original || !source.originalResourceRefs.includes(original))) throw new ServiceError("conflict", "Inspect this resource and verify its actual original provider request before canceling it. A metadata match alone cannot supply that provenance.");
    let current = source.payment, unapplied = false;
    const observe: NonNullable<MerchantIntentRecoveryRequest["onPaymentObserved"]> = async evidence => {
      await observer.observe();
      await observer.retainObservation({ paymentId: current.id, providerEventRef: merchantObservationRef(evidence), evidence });
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
    if (saved) {
      const intentRequest: MerchantIntentRecoveryRequest = { ...routing, providerPlatformAccountId: routing.providerPlatformAccountId!, paymentAttemptId: current.id,
        invoiceId: source.providerInvoiceRef, contactId: source.providerContactRef, amountMinor: current.amountMinor, currency: current.currency,
        createdAt: current.createdAt.toISOString(), idempotencyKey: current.idempotencyKey, paymentRef: original,
        onPaymentObserved: observe, onRetirementAcknowledged: async proof => { await observer.observe(); await observer.retainRetirement({ paymentId: current.id, ...proof }); } };
      const result = input.action === "retire" ? await adapter.retireMerchantIntent!(intentRequest) : await adapter.recoverMerchantIntent!(intentRequest);
      await observer.returned(result);
      if (result.state === "paid" || result.state === "pending") await observe(result.evidence);
      else if (result.state === "not_paid" && source.originalResourceRefs.includes(result.paymentRef)) current = await applyMerchantTerminalReceipt.call({ paymentId: current.id, initiatedBy: actorString(caller), ...terminal.parse(result) }, system);
      return { payment: current, state: result.state === "not_paid" && !source.originalResourceRefs.includes(result.paymentRef) ? "unresolved" as const : result.state, paymentRef: "paymentRef" in result ? result.paymentRef : undefined, unapplied };
    }
    const request: MerchantPaymentRecoveryRequest = { ...routing, providerPlatformAccountId: routing.providerPlatformAccountId!, paymentAttemptId: current.id,
      invoiceId: source.providerInvoiceRef, contactId: source.providerContactRef, amountMinor: current.amountMinor, currency: current.currency,
      createdAt: current.createdAt.toISOString(), idempotencyKey: current.idempotencyKey, checkoutRef: original,
      onPaymentObserved: (_checkoutRef, evidence) => observe(evidence), onRetirementAcknowledged: async proof => { await observer.observe(); await observer.retainRetirement({ paymentId: current.id, ...proof }); } };
    const result = input.action === "retire" ? await adapter.retireMerchantPayment!(request) : await adapter.recoverMerchantPayment!(request);
    await observer.returned(result);
    if (result.state === "paid") await observe(result.evidence);
    else if (result.state === "open" && source.originalResourceRefs.includes(result.checkout.providerRef)) current = await applyPaymentCheckout.call({ paymentId: current.id, checkout: verifiedCheckoutSession.parse(result.checkout), initiatedBy: actorString(caller) }, system);
    else if (result.state === "not_paid" && source.originalResourceRefs.includes(result.checkoutRef)) current = await applyMerchantTerminalReceipt.call({ paymentId: current.id, initiatedBy: actorString(caller), ...terminal.parse(result) }, system);
    else if (result.state === "pending") await observer.retainObservation({ paymentId: current.id, providerEventRef: merchantObservationRef(result.evidence), evidence: merchantPaymentEvidence.parse(result.evidence) });
    const boundOpen = result.state === "open" && source.originalResourceRefs.includes(result.checkout.providerRef);
    const unboundTerminal = result.state === "not_paid" && !source.originalResourceRefs.includes(result.checkoutRef);
    return { payment: current, state: result.state === "open" && !boundOpen || unboundTerminal ? "unresolved" as const : result.state,
      checkoutRef: result.state === "open" ? result.checkout.providerRef : "checkoutRef" in result ? result.checkoutRef : undefined,
      checkoutUrl: boundOpen ? result.checkout.url : undefined,
      checkoutExpiresAt: boundOpen ? result.checkout.expiresAt : undefined, unapplied };
}

/** Only an already-authorized checkout parent uses this fixed read-only path. */
export function inspectMerchantCheckoutForRetry(paymentId: string, caller: Actor) {
  return reconcileOriginalMerchantResource({ paymentId, action: "inspect" }, caller);
}

export const reconcileMerchantCheckout = defineOrchestratedService({
  name: "invoicing.reconcileMerchantCheckout", summary: "Recover or retire the authenticated original checkout or saved-method PaymentIntent; unknown effects remain blocked and positive money is retained first.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), action: z.enum(["inspect", "retire"]), checkoutRef: checkoutRef.optional(), paymentRef: paymentRef.optional() }).strict(),
  output: z.object({ payment: paymentRow, state: z.enum(["unresolved", "ambiguous", "open", "pending", "paid", "not_paid"]), checkoutRef: checkoutRef.optional(), paymentRef: paymentRef.optional(), checkoutUrl: z.string().url().optional(), checkoutExpiresAt: z.iso.datetime().optional(), unapplied: z.boolean() }),
  handler: reconcileOriginalMerchantResource,
});

export default [merchantPaymentRecoverySource, retainMerchantRetirementAck, applyMerchantTerminalReceipt, reconcileMerchantCheckout];
