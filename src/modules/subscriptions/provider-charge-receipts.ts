// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: preserve authenticated scheduled cash before applying its invoice.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { PaymentProviderEvent } from "@/adapters/payments";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { registerSubscriptionProviderChargeObserver, registerSubscriptionProviderEvidenceRetainer } from "@/modules/invoicing/merchant-provider-stage";
import { registerSubscriptionInvoiceRouting } from "@/modules/invoicing/merchant-agreement-charge";
import { invoices } from "@/modules/invoicing/schema";
import { subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts, subscriptions } from "./schema";
import { subscriptionChargeScope, subscriptionMerchantScope } from "./merchant-scope-contract";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const reference = z.string().min(1).max(500);
const cash = z.object({
  provider: z.literal("stripe"), providerSubscriptionRef: reference,
  providerPlatformAccountId: account.optional(), providerAccountId: account.optional(),
  providerInvoiceRef: reference, providerPaymentIntentRef: reference, providerChargeRef: reference.optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/),
  destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional(),
  customerChargeVerified: z.boolean().default(false), merchantRouteVerified: z.boolean().default(false),
  subscriptionId: z.uuid().optional(), providerScheduleOperationId: z.uuid().optional(), providerCustomerRef: reference.optional(),
});

async function originalAgreement(ctx: ServiceContext, provider: string, providerRef: string, platform?: string, chargeAccount?: string, lineage?: z.infer<typeof cash>) {
  const rows = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes })
    .from(subscriptions).innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
    .where(and(eq(subscriptions.provider, provider), eq(subscriptions.providerRef, providerRef))).limit(100);
  if (!rows.length && lineage?.subscriptionId && lineage.providerScheduleOperationId) {
    const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(and(eq(subscriptionProviderScheduleOperations.id, lineage.providerScheduleOperationId),
      eq(subscriptionProviderScheduleOperations.subscriptionId, lineage.subscriptionId))).limit(1);
    const [original] = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes }).from(subscriptions)
      .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id)).where(and(eq(subscriptions.id, lineage.subscriptionId),
        eq(subscriptions.merchantScopeVersion, 1), eq(subscriptionMerchantScopes.providerPlatformAccountId, platform ?? ""), sql`${subscriptionMerchantScopes.chargeAccountId} is not distinct from ${chargeAccount ?? null}`)).limit(1);
    if (!operation || !original || !["create", "update", "resume"].includes(operation.kind)
      || operation.providerApiVersion !== original.scope.providerScheduleApiVersion || operation.originalRequest.providerPlatformAccountId !== original.scope.providerPlatformAccountId
      || (operation.originalRequest.providerAccountId ?? null) !== original.scope.chargeAccountId) throw new ServiceError("conflict", "The paid provider resource has no matching original admitted subscription operation.");
    return { ...original, operation };
  }
  if (!rows.length) return null;
  const matching = rows.filter(row => row.scope.providerPlatformAccountId === platform && row.scope.chargeAccountId === (chargeAccount ?? null));
  if (matching.length !== 1 || rows.length === 100) throw new ServiceError("conflict", "Reconcile this renewal against its exact original agreement and platform.");
  if (matching[0]!.subscription.merchantScopeVersion !== 1) throw new ServiceError("conflict", "A historical agreement cannot acquire a new payment route.");
  return { ...matching[0]!, operation: null };
}

export const retainProviderCharge = defineService({
  name: "subscriptions.retainProviderCharge",
  summary: "Commit authenticated original scheduled money before ordinary invoice application.",
  kind: "mutation", permission: "system", external: false,
  auditInputFields: ["providerSubscriptionRef", "providerPaymentIntentRef"],
  input: cash, output: z.object({ receiptId: z.uuid().nullable(), observationId: z.uuid().nullable(), matchesOriginalMoney: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const original = await originalAgreement(ctx, input.provider, input.providerSubscriptionRef, input.providerPlatformAccountId, input.providerAccountId, input);
    if (!original) return { receiptId: null, observationId: null, matchesOriginalMoney: true };
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, original.subscription.id)).limit(1).for("update");
    if (!parent) throw new ServiceError("conflict", "Restore the original subscription parent before retaining its money.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${input.providerPlatformAccountId}:${input.providerAccountId ?? ""}:${input.providerPaymentIntentRef}`}))`);
    if (original.operation) {
      // The actual authenticated paid-resource witness commits with cash,
      // before ordinary price, tax, calendar or settlement application.
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, original.subscription.id)).limit(1).for("update");
      if (!resource) throw new ServiceError("conflict", "Restore the original admitted schedule resource before retaining its associated cash.");
      const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, original.operation.id)).limit(1).for("update");
      if (!operation) throw new ServiceError("conflict", "Restore the original admitted operation before retaining its associated cash.");
      const history = z.array(z.record(z.string(), z.unknown())).max(5000).parse(operation.providerObservation.history ?? []);
      const witnessed = history.some(entry => entry.source === "authenticated_invoice_payment" && entry.providerSubscriptionRef === input.providerSubscriptionRef);
      if (!witnessed) {
        const contradictory = operation.state === "refused" || history.some(entry => typeof entry.providerSubscriptionRef === "string" && entry.providerSubscriptionRef !== input.providerSubscriptionRef);
        await ctx.tx.update(subscriptionProviderScheduleOperations).set({ positiveObserved: true, state: contradictory ? "unknown" : "confirmed",
          providerObservation: { ...operation.providerObservation, history: [...history, { source: "authenticated_invoice_payment", observedAt: new Date().toISOString(), providerSubscriptionRef: input.providerSubscriptionRef,
            providerInvoiceRef: input.providerInvoiceRef, providerPaymentIntentRef: input.providerPaymentIntentRef, ...(input.providerCustomerRef ? { providerCustomerRef: input.providerCustomerRef } : {}) }] }, finishedAt: operation.finishedAt ?? new Date() }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
        await ctx.tx.update(subscriptionProviderScheduleResources).set({ providerSubscriptionRef: resource.providerSubscriptionRef ?? input.providerSubscriptionRef,
          providerCustomerRef: resource.providerCustomerRef ?? input.providerCustomerRef ?? null, evidenceRevision: resource.evidenceRevision + 1,
          state: "unknown", stoppedProof: null, recoveryPending: true, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, original.subscription.id));
      }
      if (!parent.providerRef && (!parent.provider || parent.provider === input.provider)) await ctx.tx.update(subscriptions).set({ provider: input.provider, providerRef: input.providerSubscriptionRef }).where(eq(subscriptions.id, original.subscription.id));
    }
    const facts = { subscriptionId: original.subscription.id, providerPlatformAccountId: original.scope.providerPlatformAccountId,
      chargeAccountId: original.scope.chargeAccountId, providerSubscriptionRef: input.providerSubscriptionRef, providerInvoiceRef: input.providerInvoiceRef,
      providerApiVersion: original.scope.providerScheduleApiVersion,
      providerPaymentIntentRef: input.providerPaymentIntentRef, providerChargeRef: input.providerChargeRef ?? null, amountMinor: input.amountMinor, currency: input.currency };
    const actualRoute = { actualDestinationAccountId: input.destinationAccountId ?? null, actualSettlementMerchantAccountId: input.settlementMerchantAccountId ?? null,
      customerChargeVerified: input.customerChargeVerified,
      merchantRouteVerified: input.merchantRouteVerified && input.destinationAccountId === (original.scope.collectionKind === "destination" ? original.scope.recipientAccountId : undefined)
        && input.settlementMerchantAccountId === (original.scope.collectionKind === "destination" ? original.scope.settlementMerchantAccountId : undefined) };
    const observed = { ...facts, ...actualRoute }, observationDigest = createHash("sha256").update(JSON.stringify(observed)).digest("hex");
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true)`);
    await ctx.tx.insert(subscriptionProviderChargeObservations).values({ ...observed, observationDigest }).onConflictDoNothing();
    const [observation] = await ctx.tx.select({ id: subscriptionProviderChargeObservations.id }).from(subscriptionProviderChargeObservations)
      .where(and(eq(subscriptionProviderChargeObservations.subscriptionId, original.subscription.id), eq(subscriptionProviderChargeObservations.observationDigest, observationDigest)));
    if (!observation) throw new ServiceError("conflict", "The authenticated original cash observation could not be retained.");
    const [existing] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(and(
      eq(subscriptionProviderChargeReceipts.providerPlatformAccountId, original.scope.providerPlatformAccountId),
      sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${original.scope.chargeAccountId}`,
      eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef, input.providerPaymentIntentRef))).for("update");
    if (existing) {
      const matchesOriginalMoney = !Object.entries(facts).some(([key, value]) => key !== "providerChargeRef" && existing[key as keyof typeof facts] !== value)
        && (!existing.providerChargeRef || !input.providerChargeRef || existing.providerChargeRef === input.providerChargeRef);
      if (matchesOriginalMoney && !existing.providerChargeRef && input.providerChargeRef) await ctx.tx.update(subscriptionProviderChargeReceipts).set({ providerChargeRef: input.providerChargeRef }).where(eq(subscriptionProviderChargeReceipts.id, existing.id));
      return { receiptId: existing.id, observationId: observation.id, matchesOriginalMoney };
    }
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true)`);
    const [receipt] = await ctx.tx.insert(subscriptionProviderChargeReceipts).values({ ...facts, ...actualRoute }).returning({ id: subscriptionProviderChargeReceipts.id });
    ctx.setSubject("subscription", original.subscription.id);
    return { receiptId: receipt!.id, observationId: observation.id, matchesOriginalMoney: true };
  },
});

export const completeProviderChargeFee = defineService({
  name: "subscriptions.completeProviderChargeFee", summary: "Complete only previously missing authenticated fee facts on original scheduled money.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["receiptId"],
  input: z.object({ receiptId: z.uuid(), amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/) }),
  output: z.object({ recorded: z.literal(true) }),
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, input.receiptId)).for("update");
    if (!existing) throw new ServiceError("not_found", "The original subscription charge receipt is unavailable.");
    if (existing.observedApplicationFeeMinor !== null && existing.observedApplicationFeeMinor !== input.amountMinor
      || existing.observedApplicationFeeCurrency !== null && existing.observedApplicationFeeCurrency !== input.currency) throw new ServiceError("conflict", "The actual fee contradicts its original observed receipt.");
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderChargeReceipts).set({ observedApplicationFeeMinor: input.amountMinor, observedApplicationFeeCurrency: input.currency }).where(eq(subscriptionProviderChargeReceipts.id, input.receiptId));
    ctx.setSubject("subscription", existing.subscriptionId);
    return { recorded: true as const };
  },
});

/** Capture only: a later policy or fee failure cannot stop the next paid fact. */
async function captureSubscriptionCharge(provider: string, event: PaymentProviderEvent): Promise<{ event: PaymentProviderEvent; applicationAllowed: boolean }> {
  if (event.kind !== "subscription_period_paid" || !event.providerPlatformAccountId) return { event, applicationAllowed: true };
  if (provider !== "stripe" || !event.invoiceProviderRef || !event.paymentProviderRef || !event.amountMinor || !event.currency) throw new ServiceError("conflict", "The authenticated renewal lacks its original invoice or intent evidence.");
  const { receiptId, observationId, matchesOriginalMoney } = await retainProviderCharge.call({ provider, providerSubscriptionRef: event.providerRef, providerPlatformAccountId: event.providerPlatformAccountId,
    providerAccountId: event.providerAccountId, providerInvoiceRef: event.invoiceProviderRef, providerPaymentIntentRef: event.paymentProviderRef,
    providerChargeRef: event.providerChargeRef, amountMinor: event.amountMinor, currency: event.currency,
    destinationAccountId: event.destinationAccountId, settlementMerchantAccountId: event.settlementMerchantAccountId,
    subscriptionId: event.subscriptionId, providerScheduleOperationId: event.providerScheduleOperationId, providerCustomerRef: event.providerCustomerRef,
    customerChargeVerified: event.customerChargeVerified, merchantRouteVerified: event.merchantRouteVerified }, { kind: "system" });
  if (!receiptId) return { event, applicationAllowed: true };
  return { event: { ...event, subscriptionChargeReceiptId: receiptId, subscriptionChargeObservationId: observationId }, applicationAllowed: matchesOriginalMoney && event.customerChargeVerified === true && Boolean(event.providerChargeRef) };
}

/** Called outside ordinary application: each .call commits its own short phase. */
export async function retainSubscriptionChargeEvidence(provider: string, event: PaymentProviderEvent): Promise<PaymentProviderEvent> {
  const captured = await captureSubscriptionCharge(provider, event);
  const prepared = captured.event;
  if (prepared.kind !== "subscription_period_paid" || !prepared.subscriptionChargeReceiptId) return prepared;
  // The observation above is already committed. Never throw away a later
  // authenticated contradiction by rolling it back with invoice policy.
  if (!captured.applicationAllowed) throw new ServiceError("conflict", "The original observed renewal money is retained and needs reconciliation before invoice application.");
  if (prepared.observedApplicationFeeMinor !== undefined && prepared.applicationFeeCurrency) await completeProviderChargeFee.call({ receiptId: prepared.subscriptionChargeReceiptId, amountMinor: prepared.observedApplicationFeeMinor, currency: prepared.applicationFeeCurrency }, { kind: "system" });
  return prepared;
}

registerSubscriptionProviderChargeObserver(async (provider, event) => (await captureSubscriptionCharge(provider, event)).event);
registerSubscriptionProviderEvidenceRetainer(retainSubscriptionChargeEvidence);
registerSubscriptionInvoiceRouting(async (ctx, input) => {
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId));
  if (invoice?.sourceType !== "subscription" || !invoice.sourceId) return null;
  const subscriptionId = invoice.sourceId.split(":")[0]!;
  const [original] = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes, policy: subscriptionMarketPolicies })
    .from(subscriptions).innerJoin(subscriptionMarketPolicies, eq(subscriptionMarketPolicies.subscriptionId, subscriptions.id))
    .leftJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id)).where(eq(subscriptions.id, subscriptionId));
  if (!original || original.subscription.merchantScopeVersion === 0 || original.policy.model !== "seller_merchant") return null;
  if (!original.scope || original.policy.providerAccountId !== original.scope.recipientAccountId) throw new ServiceError("conflict", "This new agreement lacks its immutable original merchant scope.");
  const scope = subscriptionChargeScope(subscriptionMerchantScope.parse(original.scope));
  const routing = { subscriptionId, agreementRoutingVersion: 1 as const, scope, siteFeeBps: original.policy.siteFeeBps };
  if (input.method !== "provider_schedule") return routing;
  if (!input.subscriptionChargeReceiptId) throw new ServiceError("conflict", "An automatic renewal needs its original committed charge receipt.");
  const [receipt] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, input.subscriptionChargeReceiptId));
  if (!receipt || receipt.subscriptionId !== subscriptionId || receipt.currency !== invoice.currency || receipt.providerSubscriptionRef !== original.subscription.providerRef
    || receipt.providerPlatformAccountId !== original.scope.providerPlatformAccountId || receipt.chargeAccountId !== original.scope.chargeAccountId) throw new ServiceError("conflict", "This renewal receipt belongs to another original agreement or account.");
  if (!receipt.providerChargeRef) throw new ServiceError("conflict", "The original paid intent is retained; complete its actual charge reference before invoice application.");
  return { ...routing, providerOrigin: { receiptId: receipt.id, providerApiVersion: subscriptionMerchantScope.parse(original.scope).providerScheduleApiVersion, providerSubscriptionRef: receipt.providerSubscriptionRef, providerInvoiceRef: receipt.providerInvoiceRef, providerPaymentIntentRef: receipt.providerPaymentIntentRef, providerChargeRef: receipt.providerChargeRef } };
});

export default [retainProviderCharge, completeProviderChargeFee];
