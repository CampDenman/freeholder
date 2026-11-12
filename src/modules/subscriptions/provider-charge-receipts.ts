// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: preserve authenticated scheduled cash before applying its invoice.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { PaymentProviderEvent } from "@/adapters/payments";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { registerSubscriptionProviderEvidenceRetainer } from "@/modules/invoicing/merchant-provider-stage";
import { registerSubscriptionInvoiceRouting } from "@/modules/invoicing/merchant-agreement-charge";
import { invoices } from "@/modules/invoicing/schema";
import { subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptionProviderChargeReceipts, subscriptions } from "./schema";
import { subscriptionChargeScope, subscriptionMerchantScope } from "./merchant-scope-contract";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const reference = z.string().min(1).max(500);
const cash = z.object({
  provider: z.literal("stripe"), providerSubscriptionRef: reference,
  providerPlatformAccountId: account.optional(), providerAccountId: account.optional(),
  providerInvoiceRef: reference, providerPaymentIntentRef: reference, providerChargeRef: reference,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/),
});

async function originalAgreement(ctx: ServiceContext, provider: string, providerRef: string, platform?: string, chargeAccount?: string) {
  const rows = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes })
    .from(subscriptions).innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
    .where(and(eq(subscriptions.provider, provider), eq(subscriptions.providerRef, providerRef))).limit(100);
  if (!rows.length) return null;
  const matching = rows.filter(row => row.scope.providerPlatformAccountId === platform && row.scope.chargeAccountId === (chargeAccount ?? null));
  if (matching.length !== 1 || rows.length === 100) throw new ServiceError("conflict", "Reconcile this renewal against its exact original agreement and platform.");
  if (matching[0]!.subscription.merchantScopeVersion !== 1) throw new ServiceError("conflict", "A historical agreement cannot acquire a new payment route.");
  return matching[0]!;
}

export const retainProviderCharge = defineService({
  name: "subscriptions.retainProviderCharge",
  summary: "Commit authenticated original scheduled money before ordinary invoice application.",
  kind: "mutation", permission: "system", external: false,
  auditInputFields: ["providerSubscriptionRef", "providerPaymentIntentRef"],
  input: cash, output: z.object({ receiptId: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    const original = await originalAgreement(ctx, input.provider, input.providerSubscriptionRef, input.providerPlatformAccountId, input.providerAccountId);
    if (!original) return { receiptId: null };
    if (original.subscription.billingMode !== "provider" || original.subscription.currency !== input.currency) throw new ServiceError("conflict", "The observed payment differs from its original subscription currency or schedule.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${input.providerPlatformAccountId}:${input.providerAccountId ?? ""}:${input.providerPaymentIntentRef}`}))`);
    const facts = { subscriptionId: original.subscription.id, providerPlatformAccountId: original.scope.providerPlatformAccountId,
      chargeAccountId: original.scope.chargeAccountId, providerSubscriptionRef: input.providerSubscriptionRef, providerInvoiceRef: input.providerInvoiceRef,
      providerApiVersion: original.scope.providerScheduleApiVersion,
      providerPaymentIntentRef: input.providerPaymentIntentRef, providerChargeRef: input.providerChargeRef, amountMinor: input.amountMinor, currency: input.currency };
    const [existing] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(and(
      eq(subscriptionProviderChargeReceipts.providerPlatformAccountId, original.scope.providerPlatformAccountId),
      sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${original.scope.chargeAccountId}`,
      eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef, input.providerPaymentIntentRef))).for("update");
    if (existing) {
      if (Object.entries(facts).some(([key, value]) => existing[key as keyof typeof facts] !== value)) throw new ServiceError("conflict", "The provider contradicted original observed subscription money; preserve and reconcile its first receipt.");
      return { receiptId: existing.id };
    }
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true)`);
    const [receipt] = await ctx.tx.insert(subscriptionProviderChargeReceipts).values(facts).returning({ id: subscriptionProviderChargeReceipts.id });
    ctx.setSubject("subscription", original.subscription.id);
    return { receiptId: receipt!.id };
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

/** Called outside ordinary application: each .call commits its own short phase. */
export async function retainSubscriptionChargeEvidence(provider: string, event: PaymentProviderEvent): Promise<PaymentProviderEvent> {
  if (event.kind !== "subscription_period_paid" || !event.providerPlatformAccountId) return event;
  if (provider !== "stripe" || !event.invoiceProviderRef || !event.paymentProviderRef || !event.providerChargeRef || !event.amountMinor || !event.currency) throw new ServiceError("conflict", "The authenticated renewal lacks its original invoice, intent or charge evidence.");
  const { receiptId } = await retainProviderCharge.call({ provider, providerSubscriptionRef: event.providerRef, providerPlatformAccountId: event.providerPlatformAccountId,
    providerAccountId: event.providerAccountId, providerInvoiceRef: event.invoiceProviderRef, providerPaymentIntentRef: event.paymentProviderRef,
    providerChargeRef: event.providerChargeRef, amountMinor: event.amountMinor, currency: event.currency }, { kind: "system" });
  if (!receiptId) return event;
  if (event.observedApplicationFeeMinor !== undefined && event.applicationFeeCurrency) await completeProviderChargeFee.call({ receiptId, amountMinor: event.observedApplicationFeeMinor, currency: event.applicationFeeCurrency }, { kind: "system" });
  return { ...event, subscriptionChargeReceiptId: receiptId };
}

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
  return { ...routing, providerOrigin: { receiptId: receipt.id, providerApiVersion: subscriptionMerchantScope.parse(original.scope).providerScheduleApiVersion, providerSubscriptionRef: receipt.providerSubscriptionRef, providerInvoiceRef: receipt.providerInvoiceRef, providerPaymentIntentRef: receipt.providerPaymentIntentRef, providerChargeRef: receipt.providerChargeRef } };
});

export default [retainProviderCharge, completeProviderChargeFee];
