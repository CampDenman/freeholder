// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Automatic billing: platform charges and provider schedules (C9.33).
import { and, asc, eq, inArray, like, lte, or } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import {
  defineOrchestratedService,
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import { createPayment, failPayment, settlePayment, startPayment } from "@/modules/invoicing/invoice-service";
import { assertChargeEvidence, assertProviderAccount, paymentRouting, routingForPayment } from "@/modules/invoicing/merchant-charge";
import { getSubscriptionPaymentScope, subscriptionPaymentScope } from "./market-policy";
import { subscriptionMethodScopeMatches } from "./merchant-scope-contract";
import { subscriptionProviderInvoiceObservations } from "./provider-period-schema";
import { proveMerchantProviderPeriod, assertCanonicalProviderPeriod } from "./provider-periods";
import { originalMerchantPlan, originalMerchantTerms } from "./merchant-terms-read";
import { merchantObservationRef, recordMerchantPaymentObservation } from "@/modules/invoicing/merchant-payment-observations";
import { invoices, paymentMethods, payments } from "@/modules/invoicing/schema";
import { resolvePrice } from "@/modules/catalog/pricing";
import { plans, subscriptionEvents, subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts, subscriptions } from "./schema";
import {
  applyPendingPlan,
  completePaidCommercialAmendment,
  beginDunning,
  cancelMySubscription,
  cancelSubscription,
  keepAccess,
  periodEnd,
  planSeller,
  planVariant,
  priceFor,
  raiseInvoice,
  record,
  selfServePlans,
  subscribe,
} from "./service";

export function proratedDifference(
  oldMinor: number,
  newMinor: number,
  periodStart: Date,
  periodEndAt: Date,
  at: Date,
): number {
  const total = periodEndAt.getTime() - periodStart.getTime();
  const remaining = Math.max(0, periodEndAt.getTime() - at.getTime());
  if (total <= 0) return 0;
  return Math.round((newMinor * remaining) / total) - Math.round((oldMinor * remaining) / total);
}

function mayChargePlatform(subscription: typeof subscriptions.$inferSelect): boolean {
  return subscription.billingMode === "platform"
    && !subscription.signupPending
    && !subscription.cancelledAt
    && !subscription.cancelAtPeriodEnd
    && ["active", "trialing", "past_due"].includes(subscription.status);
}

const claimCharge = defineService({
  name: "subscriptions.claimPlatformCharge",
  writeClass: "write",
  summary: "Raise the period invoice and a payment row before charging a stored method.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    subscriptionId: uuidSchema,
    invoiceId: uuidSchema.optional(),
  }),
  output: z.object({
    skip: z.boolean(),
    subscriptionId: uuidSchema,
    invoiceId: uuidSchema.nullable(),
    paymentId: uuidSchema.nullable(),
    provider: z.string().nullable(),
    methodRef: z.string().nullable(),
    customerRef: z.string().nullable(),
    amountMinor: z.number().int(),
    currency: z.string(),
    description: z.string(),
    idempotencyKey: z.string(),
    contactId: uuidSchema,
    routing: paymentRouting.optional(),
  }),
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.subscriptionId))
      .limit(1)
      .for("update");
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    const current = mayChargePlatform(subscription) && subscription.merchantScopeVersion !== 1 ? await applyPendingPlan(ctx, subscription) : subscription;
    if (!mayChargePlatform(current) || current.merchantScopeVersion === 1 && current.currentPeriodEnd.getTime() > Date.now()) {
      return {
        skip: true,
        subscriptionId: current.id,
        invoiceId: null,
        paymentId: null,
        provider: null,
        methodRef: null,
        customerRef: null,
        amountMinor: 0,
        currency: current.currency,
        description: "",
        idempotencyKey: "",
        contactId: current.contactId,
      };
    }
    const [currentPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, current.planId));
    if (!currentPlan) throw new ServiceError("not_found", "There is no such plan.");
    const start = current.currentPeriodEnd;
    const plan = await originalMerchantPlan(ctx, current, currentPlan, start);
    const end = periodEnd(start, plan.interval, plan.intervalCount);
    let invoiceId = input.invoiceId ?? null;
    if (!invoiceId) {
      const price = await priceFor(ctx, current, start);
      if ("refused" in price) {
        await record(ctx, current.id, "payment_failed", { detail: price.refused });
        await beginDunning(ctx, current, { detail: price.refused });
        return {
          skip: true,
          subscriptionId: current.id,
          invoiceId: null,
          paymentId: null,
          provider: null,
          methodRef: null,
          customerRef: null,
          amountMinor: 0,
          currency: subscription.currency,
          description: price.refused,
          idempotencyKey: "",
          contactId: subscription.contactId,
        };
      }
      invoiceId = await raiseInvoice(ctx, current, {
        amountMinor: price.amountMinor,
        periodStart: start,
        periodEnd: end,
      });
    }
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "The period invoice is missing.");
    if (invoice.contactId !== current.contactId || invoice.currency !== current.currency || invoice.sourceType !== "subscription" || invoice.sourceId?.split(":")[0] !== current.id || !invoice.issuedAt || !["sent", "viewed", "partially_paid", "overdue", "paid"].includes(invoice.status)) {
      throw new ServiceError("conflict", "That invoice cannot be charged to this membership.");
    }
    const amountMinor = invoice.totalMinor - invoice.paidMinor;
    if (amountMinor <= 0) {
      if (current.merchantScopeVersion === 1 && current.pendingPlanId) await ctx.callAsSystem(completePaidCommercialAmendment, { invoiceId });
      return {
        skip: true,
        subscriptionId: current.id,
        invoiceId,
        paymentId: null,
        provider: current.provider,
        methodRef: null,
        customerRef: null,
        amountMinor: 0,
        currency: invoice.currency,
        description: "",
        idempotencyKey: "",
        contactId: current.contactId,
      };
    }
    const [method] = current.paymentMethodId
      ? await ctx.tx
          .select()
          .from(paymentMethods)
          .where(eq(paymentMethods.id, current.paymentMethodId))
          .limit(1)
      : [];
    if (!method || method.status !== "active" || method.contactId !== current.contactId) {
      throw new ServiceError("conflict", "Platform billing needs an active stored payment method.");
    }
    const payment = await ctx.call(createPayment, {
      invoiceId: invoice.id,
      provider: method.provider,
      method: "saved_method",
      amountMinor,
      idempotencyKey: `subscription-charge:${current.id}:${invoice.id}`,
    });
    const routing = await routingForPayment(ctx, payment.id);
    if (!subscriptionMethodScopeMatches(routing, method)) throw new ServiceError("conflict", "The stored method belongs to a different original platform or charge account.");
    return {
      skip: false,
      routing,
      subscriptionId: current.id,
      invoiceId: invoice.id,
      paymentId: payment.id,
      provider: method.provider,
      methodRef: method.providerMethodRef,
      customerRef: method.providerCustomerRef,
      amountMinor,
      currency: invoice.currency,
      description: `Subscription ${current.id}`,
      idempotencyKey: `subscription-charge:${current.id}:${invoice.id}`,
      contactId: current.contactId,
    };
  },
});

const applyCharge = defineService({
  name: "subscriptions.applyPlatformCharge",
  writeClass: "write",
  summary: "Record an off-session charge and advance or dunn the subscription.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    subscriptionId: uuidSchema,
    invoiceId: uuidSchema,
    paymentId: uuidSchema,
    providerRef: z.string().min(1).max(500),
    status: z.enum(["pending", "succeeded", "failed"]),
    providerAccountId: paymentRouting.shape.providerAccountId,
    providerPlatformAccountId: paymentRouting.shape.providerPlatformAccountId,
    destinationAccountId: paymentRouting.shape.destinationAccountId,
    settlementMerchantAccountId: paymentRouting.shape.settlementMerchantAccountId,
    customerChargeVerified: z.boolean().optional(),
    merchantRouteVerified: z.boolean().optional(),
    providerChargeRef: z.string().min(1).max(500).optional(),
    applicationFeeMinor: paymentRouting.shape.applicationFeeMinor,
    amountMinor: z.number().int().min(0).optional(),
    currency: z.string().length(3).optional(),
    failureMessage: z.string().max(500).optional(),
  }),
  output: row({ advanced: z.boolean() }),
  handler: async (input, ctx) => {
    let [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.subscriptionId))
      .limit(1)
      .for("update");
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment || payment.invoiceId !== input.invoiceId || payment.method !== "saved_method") throw new ServiceError("conflict", "This result does not match the original membership payment.");
    const routing = await routingForPayment(ctx, payment.id);
    assertChargeEvidence(routing, input);
    if ((input.amountMinor !== undefined && input.amountMinor !== payment.amountMinor) || (input.currency && input.currency.toUpperCase() !== payment.currency) || (routing.providerAccountId && input.status === "succeeded" && (input.amountMinor === undefined || !input.currency))) throw new ServiceError("conflict", "The provider did not confirm the membership payment amount and currency.");
    if (input.status === "pending") {
      await ctx.call(startPayment, { id: payment.id, providerRef: input.providerRef });
      return { advanced: false };
    }
    let [currentPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
    let plan = currentPlan ? await originalMerchantPlan(ctx, subscription, currentPlan, subscription.currentPeriodEnd) : undefined;
    if (input.status === "succeeded") {
      await ctx.call(settlePayment, {
        id: input.paymentId,
        providerRef: input.providerRef,
        processedAt: new Date(),
      });
      // Provider I/O can finish after cancellation or pausing committed. The
      // money still belongs in the ledger, but it cannot restart membership
      // access or extend a cancelled renewal promise.
      if (!mayChargePlatform(subscription)) return { advanced: false };
      subscription = await applyPendingPlan(ctx, subscription);
      [currentPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
      plan = currentPlan ? await originalMerchantPlan(ctx, subscription, currentPlan, subscription.currentPeriodEnd) : undefined;
      if (subscription.merchantScopeVersion === 1 && subscription.pendingPlanId) return { advanced: false };
      const now = new Date();
      if (subscription.currentPeriodEnd > now) {
        if (subscription.status === "trialing") {
          await ctx.tx
            .update(subscriptions)
            .set({ status: "active", trialEndsAt: null })
            .where(eq(subscriptions.id, subscription.id));
          await record(ctx, subscription.id, "activated");
        }
        await keepAccess(ctx, subscription, plan?.name ?? "Membership", subscription.currentPeriodEnd, "active");
        return { advanced: false };
      }
      const start = subscription.currentPeriodEnd;
      const end = periodEnd(start, plan?.interval ?? "month", plan?.intervalCount ?? 1);
      await ctx.tx
        .update(subscriptions)
        .set({
          status: "active",
          currentPeriodStart: start,
          currentPeriodEnd: end,
          trialEndsAt: null,
        })
        .where(eq(subscriptions.id, subscription.id));
      if (subscription.status === "trialing") await record(ctx, subscription.id, "activated");
      await record(ctx, subscription.id, "renewed", { invoiceId: input.invoiceId });
      await keepAccess(ctx, { ...subscription, currentPeriodStart: start, currentPeriodEnd: end }, plan?.name ?? "Membership", end, "active");
      return { advanced: true };
    }
    await ctx.call(failPayment, {
      id: input.paymentId,
      code: "provider_failed",
      message: input.failureMessage ?? "The stored payment method was declined.",
    });
    await record(ctx, subscription.id, "payment_failed", {
      invoiceId: input.invoiceId,
      detail: input.failureMessage ?? "declined",
    });
    if (!mayChargePlatform(subscription)) return { advanced: false };
    await beginDunning(ctx, subscription, {
      invoiceId: input.invoiceId,
      detail: input.failureMessage ?? "declined",
    });
    return { advanced: false };
  },
});

export const chargePlatformInvoice = defineOrchestratedService({
  name: "subscriptions.chargePlatformInvoice",
  writeClass: "write",
  summary: "Charge a stored method for one platform-billed period.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ subscriptionId: uuidSchema, invoiceId: uuidSchema.optional() }),
  output: row({ advanced: z.boolean(), skipped: z.boolean() }),
  handler: async (input, _actor) => {
    const claimed = await claimCharge.call(input, { kind: "system" });
    if (claimed.skip || !claimed.paymentId || !claimed.methodRef || !claimed.provider || !claimed.invoiceId) {
      return { advanced: false, skipped: true };
    }
    const adapter = paymentAdapter(claimed.provider);
    const invoiceId = claimed.invoiceId;
    const paymentId = claimed.paymentId;
    let result;
    try {
      result = await adapter.chargeSavedMethod({
        ...claimed.routing,
        paymentAttemptId: paymentId,
        methodRef: claimed.methodRef,
        customerRef: claimed.customerRef ?? undefined,
        invoiceId,
        contactId: claimed.contactId,
        currency: claimed.currency,
        amountMinor: claimed.amountMinor,
        description: claimed.description,
        idempotencyKey: claimed.idempotencyKey,
      });
    } catch {
      // Transport errors can arrive after a successful charge. Preserve the
      // original attempt for same-key recovery or authenticated feedback;
      // an exception is not provider evidence of a decline.
      throw new ServiceError("conflict", "The provider charge needs reconciliation. Retry this same membership payment before creating another attempt.");
    }
    if (claimed.routing?.providerPlatformAccountId) await recordMerchantPaymentObservation.call({ paymentId, providerEventRef: merchantObservationRef(result), evidence: result }, { kind: "system" });
    const applied = await applyCharge.call({
      subscriptionId: claimed.subscriptionId,
      invoiceId,
      paymentId,
      ...result,
    }, { kind: "system" });
    return { advanced: applied.advanced, skipped: false };
  },
});

const duePlatform = defineService({
  name: "subscriptions.listDuePlatform",
  summary: "Platform-billed subscriptions whose period has ended.",
  kind: "query",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: listed(z.object({ id: uuidSchema })),
  handler: async (input, ctx) => {
    const now = new Date();
    const rows = await ctx.tx
      .select({ id: subscriptions.id, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.billingMode, "platform"),
          or(eq(subscriptions.status, "active"), eq(subscriptions.status, "trialing")),
          lte(subscriptions.currentPeriodEnd, now),
        ),
      )
      .orderBy(asc(subscriptions.currentPeriodEnd))
      .limit(input.limit);
    return rows.filter((row) => !row.cancelAtPeriodEnd).map((row) => ({ id: row.id }));
  },
});

export const chargePlatformDue = defineOrchestratedService({
  name: "subscriptions.chargePlatformDue",
  writeClass: "write",
  summary: "Charge every due platform-billed subscription.",
  kind: "mutation",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: row({ charged: z.number().int() }),
  handler: async (input, actor) => {
    const due = await duePlatform.call(input, actor);
    let charged = 0;
    for (const row of due) {
      const result = await chargePlatformInvoice.call({ subscriptionId: row.id }, actor);
      if (result.advanced) charged += 1;
    }
    return { charged };
  },
});

const claimProviderSchedule = defineService({
  name: "subscriptions.claimProviderSchedule",
  external: false,
  writeClass: "write",
  summary: "Read the facts a provider schedule needs.",
  kind: "query",
  permission: "scoped",
  input: z.object({ subscriptionId: uuidSchema }),
  output: z.object({
    subscriptionId: uuidSchema,
    contactId: uuidSchema,
    planId: uuidSchema,
    provider: z.string(),
    existingRef: z.string().nullable(),
    methodRef: z.string(),
    customerRef: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    interval: z.enum(["day", "week", "month", "year"]),
    intervalCount: z.number().int(),
    description: z.string(),
    firstBillingAt: z.string().optional(),
    idempotencyKey: z.string(),
    routing: getSubscriptionPaymentScope.def.output,
  }),
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.subscriptionId))
      .limit(1);
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    if (subscription.billingMode !== "provider") {
      throw new ServiceError("conflict", "That subscription is not on provider billing.");
    }
    if (subscription.signupPending || subscription.cancelledAt || subscription.cancelAtPeriodEnd || !["active", "trialing"].includes(subscription.status)) {
      throw new ServiceError("conflict", "That membership cannot start a renewal schedule.");
    }
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
    if (!plan) throw new ServiceError("not_found", "There is no such plan.");
    const [method] = subscription.paymentMethodId
      ? await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, subscription.paymentMethodId)).limit(1)
      : [];
    if (!method?.providerMethodRef || !method.providerCustomerRef || method.status !== "active" || method.contactId !== subscription.contactId) {
      throw new ServiceError("conflict", "Provider billing needs a stored method with a provider customer.");
    }
    const routing = await subscriptionPaymentScope(ctx, subscription.id, true);
    if (subscription.merchantScopeVersion === 1 && routing.providerPlatformAccountId) {
      throw new ServiceError("conflict", "Accept the original recurring quotation and use its durable schedule journal before starting this new merchant provider schedule.");
    }
    if (method.providerAccountId !== (routing.providerAccountId ?? "") || (routing.providerAccountId && method.provider !== "stripe")) throw new ServiceError("conflict", "Provider billing needs a saved method for the original merchant account.");
    const priced = (await ctx.callAsSystem(resolvePrice, {
      variantId: subscription.productVariantId,
      currency: subscription.currency,
      contactId: subscription.contactId,
      quantity: 1,
    })) as { available: boolean; amountMinor?: number };
    if (!priced.available || priced.amountMinor === undefined) {
      throw new ServiceError("conflict", "That plan has no price in this currency.");
    }
    return {
      subscriptionId: subscription.id,
      contactId: subscription.contactId,
      planId: plan.id,
      provider: method.provider,
      existingRef: subscription.providerRef,
      methodRef: method.providerMethodRef,
      customerRef: method.providerCustomerRef,
      amountMinor: priced.amountMinor,
      currency: subscription.currency,
      interval: plan.interval,
      intervalCount: plan.intervalCount,
      description: plan.name,
      firstBillingAt: subscription.publicRequestKey || subscription.trialEndsAt ? subscription.currentPeriodEnd.toISOString() : undefined,
      idempotencyKey: `subscription-schedule:${subscription.id}`,
      routing,
    };
  },
});

const applyProviderSchedule = defineService({
  name: "subscriptions.applyProviderSchedule",
  external: false,
  writeClass: "write",
  summary: "Stamp the provider's schedule reference on the subscription.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    subscriptionId: uuidSchema,
    provider: z.string().min(1).max(80),
    providerRef: z.string().min(1).max(500),
    providerAccountId: paymentRouting.shape.providerAccountId,
    applicationFeePercent: z.number().min(0).max(100).optional(),
  }),
  output: row({ id: uuidSchema, accepted: z.boolean() }),
  handler: async (input, ctx) => {
    const [current] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1).for("update");
    if (!current || current.signupPending || current.cancelledAt || current.cancelAtPeriodEnd || !["active", "trialing"].includes(current.status)) return { id: input.subscriptionId, accepted: false };
    const routing = await subscriptionPaymentScope(ctx, current.id);
    assertProviderAccount(routing, input);
    if (routing.providerAccountId && (input.provider !== "stripe" || routing.applicationFeePercent !== input.applicationFeePercent)) throw new ServiceError("conflict", "The provider did not confirm the original seller schedule fee.");
    await ctx.tx
      .update(subscriptions)
      .set({ provider: input.provider, providerRef: input.providerRef })
      .where(eq(subscriptions.id, input.subscriptionId));
    ctx.setSubject("subscription", input.subscriptionId);
    return { id: input.subscriptionId, accepted: true };
  },
});

export const attachProviderSchedule = defineOrchestratedService({
  name: "subscriptions.attachProviderSchedule",
  writeClass: "write",
  summary: "Hand the billing calendar to the payment provider.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ subscriptionId: uuidSchema }),
  output: row({ id: uuidSchema, providerRef: z.string() }),
  handler: async (input, actor) => {
    const claimed = await claimProviderSchedule.call(input, actor);
    if (claimed.existingRef) return { id: claimed.subscriptionId, providerRef: claimed.existingRef };
    const created = await paymentAdapter(claimed.provider).createRecurringSchedule({
      ...claimed.routing,
      customerRef: claimed.customerRef,
      methodRef: claimed.methodRef,
      currency: claimed.currency,
      amountMinor: claimed.amountMinor,
      interval: claimed.interval,
      intervalCount: claimed.intervalCount,
      description: claimed.description,
      firstBillingAt: claimed.firstBillingAt,
      idempotencyKey: claimed.idempotencyKey,
      metadata: {
        subscriptionId: claimed.subscriptionId,
        contactId: claimed.contactId,
        planId: claimed.planId,
      },
    });
    const applied = await applyProviderSchedule.call(
      {
        subscriptionId: claimed.subscriptionId,
        provider: claimed.provider,
        providerRef: created.providerRef,
        providerAccountId: created.providerAccountId,
        applicationFeePercent: created.applicationFeePercent,
      },
      actor,
    );
    if (!applied.accepted) {
      await paymentAdapter(claimed.provider).cancelRecurringSchedule({ providerAccountId: claimed.routing.providerAccountId, providerRef: created.providerRef, idempotencyKey: `subscription-cancel:${created.providerRef}` });
      throw new ServiceError("conflict", "The membership was cancelled while its schedule was being created.");
    }
    return { id: claimed.subscriptionId, providerRef: created.providerRef };
  },
});

export const enroll = defineOrchestratedService({
  name: "subscriptions.enroll",
  writeClass: "write",
  summary: "Start a subscription and, when billing is automatic, charge or hand the schedule over.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: uuidSchema,
    planId: uuidSchema,
    productVariantId: uuidSchema.optional(),
    currency: z.string().trim().length(3).optional(),
    paymentMethodId: uuidSchema.optional(),
  }),
  output: z.object({
    subscriptionId: uuidSchema,
    invoiceId: uuidSchema.nullable(),
    status: z.string(),
  }),
  handler: async (input, actor: Actor) => {
    const started = await subscribe.call(input, actor);
    if (started.subscription.status === "trialing" || started.subscription.billingMode === "manual") {
      return {
        subscriptionId: started.subscription.id,
        invoiceId: started.invoiceId,
        status: started.subscription.status,
      };
    }
    if (started.subscription.billingMode === "platform" && started.invoiceId) {
      await chargePlatformInvoice.call(
        { subscriptionId: started.subscription.id, invoiceId: started.invoiceId },
        actor,
      );
    }
    if (started.subscription.billingMode === "provider") {
      await attachProviderSchedule.call({ subscriptionId: started.subscription.id }, actor);
    }
    return {
      subscriptionId: started.subscription.id,
      invoiceId: started.invoiceId,
      status: started.subscription.status,
    };
  },
});

const planChangeInput = z.object({
  id: uuidSchema,
  planId: uuidSchema,
});
const planChangeOutput = z.object({
  subscriptionId: uuidSchema,
  invoiceId: uuidSchema.nullable(),
  proratedMinor: z.number().int(),
  deferred: z.boolean(),
  billingMode: z.enum(["provider", "platform", "manual"]),
  provider: z.string().nullable(),
  providerRef: z.string().nullable(),
  previousProvider: z.string().nullable(),
  previousProviderRef: z.string().nullable(),
  interval: z.enum(["day", "week", "month", "year"]),
  intervalCount: z.number().int(),
  amountMinor: z.number().int(),
  currency: z.string(),
  description: z.string(),
  proration: z.enum(["create_prorations", "none"]),
  /** A customer's switch is recorded but waits for `invoiceId` to be paid. */
  awaitingPayment: z.boolean(),
  methodRef: z.string().nullable(),
  customerRef: z.string().nullable(),
});

const applyPlanChange = defineService({
  name: "subscriptions.applyPlanChange",
  writeClass: "write",
  summary: "Record a plan change locally, raising a proration invoice when the plan says to.",
  kind: "mutation",
  permission: "scoped",
  input: planChangeInput.extend({
    /**
     * A customer's own change never grants a dearer plan ahead of payment:
     * when the plan's proration raises an invoice now, the switch waits for
     * that invoice to be paid in full (C11.10, §4.15).
     */
    settleBeforeGrant: z.boolean().default(false),
  }),
  output: planChangeOutput,
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.id))
      .limit(1);
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    if (subscription.status !== "active" && subscription.status !== "trialing") {
      throw new ServiceError("conflict", "Only a running subscription can change plan.");
    }
    if (await originalMerchantTerms(ctx, subscription)) throw new ServiceError("conflict", "Review an explicit original merchant agreement amendment and stop its remote schedule before changing these accepted terms.");
    const [fromPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
    const [toPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, input.planId));
    if (!fromPlan || !toPlan) throw new ServiceError("not_found", "There is no such plan.");
    if (await planSeller(ctx, fromPlan.id) !== await planSeller(ctx, toPlan.id)) throw new ServiceError("conflict", "A subscription cannot change to a different seller's plan.");
    if (toPlan.status !== "active") throw new ServiceError("conflict", "That plan is not on sale.");
    // One change at a time: a change waiting on its proration invoice must be
    // paid or that invoice voided before another is asked for, so a stale
    // invoice can never grant a plan nobody still wants (C11.10).
    const [waiting] = await ctx.tx
      .select({ id: subscriptionEvents.id })
      .from(subscriptionEvents)
      .innerJoin(invoices, eq(invoices.id, subscriptionEvents.invoiceId))
      .where(
        and(
          eq(subscriptionEvents.subscriptionId, subscription.id),
          eq(subscriptionEvents.kind, "plan_change_pending"),
          eq(subscriptionEvents.fromPlanId, subscription.planId),
          inArray(invoices.status, ["draft", "sent", "viewed", "partially_paid", "overdue"]),
        ),
      )
      .limit(1);
    if (waiting) {
      throw new ServiceError("conflict", "A plan change is waiting for its invoice. Pay it, or ask us to cancel it, first.");
    }
    const [method] = subscription.paymentMethodId
      ? await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, subscription.paymentMethodId)).limit(1)
      : [];
    const schedule = {
      previousProvider: subscription.provider,
      previousProviderRef: subscription.providerRef,
      methodRef: method?.providerMethodRef ?? null,
      customerRef: method?.providerCustomerRef ?? null,
      interval: toPlan.interval,
      intervalCount: toPlan.intervalCount,
      currency: subscription.currency,
      description: toPlan.name,
      proration: fromPlan.proration,
    };
    const routing = await subscriptionPaymentScope(ctx, subscription.id);
    if (method && method.providerAccountId !== (routing.providerAccountId ?? "")) throw new ServiceError("conflict", "This plan's stored method belongs to a different merchant account.");
    if (toPlan.id === fromPlan.id) {
      return {
        subscriptionId: subscription.id,
        invoiceId: null,
        proratedMinor: 0,
        deferred: false,
        awaitingPayment: false,
        billingMode: subscription.billingMode,
        provider: subscription.provider,
        providerRef: subscription.providerRef,
        amountMinor: 0,
        ...schedule,
      };
    }
    const nextVariantId = await planVariant(ctx, toPlan.productId);
    if (!nextVariantId) throw new ServiceError("conflict", "That plan has nothing on sale right now.");
    const newPrice = await priceFor(ctx, { ...subscription, productVariantId: nextVariantId });
    if ("refused" in newPrice) {
      // Never schedule or prorate against a price of zero standing in for
      // "not priced in this currency".
      throw new ServiceError("conflict", "That plan is not priced in this subscription's currency.");
    }
    const newMinor = newPrice.amountMinor;
    if (fromPlan.proration === "none") {
      await ctx.tx
        .update(subscriptions)
        .set({ pendingPlanId: toPlan.id })
        .where(eq(subscriptions.id, subscription.id));
      await record(ctx, subscription.id, "plan_changed", { detail: "deferred to period end" });
      ctx.setSubject("subscription", subscription.id);
      return {
        subscriptionId: subscription.id,
        invoiceId: null,
        proratedMinor: 0,
        deferred: true,
        billingMode: subscription.billingMode,
        provider: subscription.provider,
        providerRef: subscription.providerRef,
        amountMinor: newMinor,
        awaitingPayment: false,
        ...schedule,
      };
    }
    const oldPrice = await priceFor(ctx, subscription);
    if ("refused" in oldPrice) {
      throw new ServiceError("conflict", "Both plans must be priced in this currency to prorate.");
    }
    const net = proratedDifference(
      oldPrice.amountMinor,
      newMinor,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
      new Date(),
    );
    let invoiceId: string | null = null;
    if (net > 0 && toPlan.billingMode !== "provider") {
      invoiceId = await raiseInvoice(ctx, subscription, {
        amountMinor: net,
        periodStart: new Date(),
        periodEnd: subscription.currentPeriodEnd,
      });
    }
    // The plan bills the difference now. A customer's own switch is recorded
    // as waiting on that invoice and granted by `completePaidPlanChange` once
    // it settles; until then they keep the plan they have paid for. A provider
    // schedule bills its own proration, so that lane is not held here.
    if (input.settleBeforeGrant && invoiceId && subscription.billingMode !== "provider") {
      await ctx.tx.insert(subscriptionEvents).values({
        subscriptionId: subscription.id,
        kind: "plan_change_pending",
        fromPlanId: fromPlan.id,
        toPlanId: toPlan.id,
        invoiceId,
        detail: nextVariantId,
      });
      ctx.setSubject("subscription", subscription.id);
      return {
        subscriptionId: subscription.id,
        invoiceId,
        proratedMinor: net,
        deferred: false,
        awaitingPayment: true,
        billingMode: subscription.billingMode,
        provider: subscription.provider,
        providerRef: subscription.providerRef,
        amountMinor: newMinor,
        ...schedule,
      };
    }
    await switchPlan(ctx, subscription, fromPlan, toPlan, nextVariantId, invoiceId);
    return {
      subscriptionId: subscription.id,
      invoiceId,
      proratedMinor: net,
      deferred: false,
      awaitingPayment: false,
      billingMode: toPlan.billingMode,
      provider: subscription.provider,
      providerRef: subscription.providerRef,
      amountMinor: newMinor,
      ...schedule,
    };
  },
});

async function switchPlan(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  fromPlan: typeof plans.$inferSelect,
  toPlan: typeof plans.$inferSelect,
  nextVariantId: string,
  invoiceId: string | null,
): Promise<void> {
  await ctx.tx
    .update(subscriptions)
    .set({
      planId: toPlan.id,
      productVariantId: nextVariantId,
      billingMode: toPlan.billingMode,
      pendingPlanId: null,
    })
    .where(eq(subscriptions.id, subscription.id));
  await ctx.tx.insert(subscriptionEvents).values({
    subscriptionId: subscription.id,
    kind: "plan_changed",
    fromPlanId: fromPlan.id,
    toPlanId: toPlan.id,
    invoiceId,
  });
  ctx.setSubject("subscription", subscription.id);
  ctx.queueEvent("subscription.planChanged", {
    subscriptionId: subscription.id,
    fromPlanId: fromPlan.id,
    toPlanId: toPlan.id,
  });
  await keepAccess(
    ctx,
    { ...subscription, planId: toPlan.id },
    toPlan.name,
    subscription.currentPeriodEnd,
    "active",
  );
}

/**
 * Grant a customer's plan change once its proration invoice is paid in full.
 * A change superseded in the meantime (the subscription is no longer on the
 * plan it started from, or no longer running) is left alone (C11.10).
 */
export const completePaidPlanChange = defineService({
  name: "subscriptions.completePaidPlanChange",
  writeClass: "write",
  summary: "Switch plan once the proration invoice for a customer's change is paid.",
  kind: "mutation",
  permission: "system",
  input: z.object({ invoiceId: uuidSchema }),
  output: z.object({ switched: z.boolean() }),
  handler: async (input, ctx) => {
    const [pending] = await ctx.tx
      .select()
      .from(subscriptionEvents)
      .where(and(eq(subscriptionEvents.kind, "plan_change_pending"), eq(subscriptionEvents.invoiceId, input.invoiceId)))
      .limit(1);
    if (!pending?.fromPlanId || !pending.toPlanId || !pending.detail) return { switched: false };
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice || invoice.status !== "paid" || invoice.paidMinor < invoice.totalMinor) return { switched: false };
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, pending.subscriptionId))
      .limit(1)
      .for("update");
    if (
      !subscription ||
      subscription.planId !== pending.fromPlanId ||
      (subscription.status !== "active" && subscription.status !== "trialing")
    ) {
      return { switched: false };
    }
    const [fromPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, pending.fromPlanId));
    const [toPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, pending.toPlanId));
    if (!fromPlan || !toPlan) return { switched: false };
    await switchPlan(ctx, subscription, fromPlan, toPlan, pending.detail, input.invoiceId);
    return { switched: true };
  },
});

async function syncProviderAfterPlanChange(
  applied: z.infer<typeof planChangeOutput>,
  actor: Actor,
): Promise<void> {
  const stillProvider = applied.billingMode === "provider" || applied.deferred;
  const routing = await getSubscriptionPaymentScope.call({ subscriptionId: applied.subscriptionId, verify: stillProvider }, { kind: "system", request: actor.request });
  if (stillProvider && applied.provider && applied.providerRef && applied.methodRef && applied.customerRef) {
    const updated = await paymentAdapter(applied.provider).updateRecurringSchedule({
      ...routing,
      providerRef: applied.providerRef,
      amountMinor: applied.amountMinor,
      currency: applied.currency,
      interval: applied.interval,
      intervalCount: applied.intervalCount,
      description: applied.description,
      proration: applied.proration,
      idempotencyKey: `subscription-plan-change:${applied.subscriptionId}:${applied.providerRef}`,
    });
    assertProviderAccount(routing, updated);
    if (routing.providerAccountId && updated.applicationFeePercent !== routing.applicationFeePercent) throw new ServiceError("conflict", "The provider did not confirm the original seller subscription fee.");
    return;
  }
  if (applied.billingMode === "provider" && !applied.providerRef) {
    await attachProviderSchedule.call({ subscriptionId: applied.subscriptionId }, actor);
    return;
  }
  if (!stillProvider && applied.previousProvider && applied.previousProviderRef) {
    await paymentAdapter(applied.previousProvider).cancelRecurringSchedule({
      providerAccountId: routing.providerAccountId,
      providerRef: applied.previousProviderRef,
      idempotencyKey: `subscription-plan-cancel-schedule:${applied.subscriptionId}`,
    });
  }
}

export const changePlan = defineOrchestratedService({
  name: "subscriptions.changePlan",
  writeClass: "write",
  summary: "Move a subscriber to another plan, prorating when the current plan says to.",
  kind: "mutation",
  permission: "scoped",
  input: planChangeInput,
  output: planChangeOutput,
  handler: async (input, actor) => {
    const applied = await applyPlanChange.call(input, actor);
    await syncProviderAfterPlanChange(applied, actor);
    if (applied.billingMode === "platform" && applied.invoiceId) {
      await chargePlatformInvoice.call(
        { subscriptionId: applied.subscriptionId, invoiceId: applied.invoiceId },
        actor,
      );
    }
    return applied;
  },
});

const assertOwnSubscription = defineService({
  name: "subscriptions.assertOwn",
  summary: "Confirm a subscription belongs to the signed-in customer.",
  kind: "query",
  permission: "authenticated",
  input: planChangeInput,
  output: planChangeInput,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to change your plan.");
    }
    const [subscription] = await ctx.tx
      .select({ id: subscriptions.id, contactId: subscriptions.contactId, planId: subscriptions.planId })
      .from(subscriptions)
      .where(eq(subscriptions.id, input.id))
      .limit(1);
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    const { contacts: contactTable } = await import("@/core/contacts/schema");
    const [owner] = await ctx.tx
      .select({ id: contactTable.id })
      .from(contactTable)
      .where(eq(contactTable.userId, ctx.actor.userId))
      .limit(1);
    if (!owner || owner.id !== subscription.contactId) {
      throw new ServiceError("not_found", "There is no such subscription.");
    }
    const offered = await selfServePlans(ctx, await planSeller(ctx, subscription.planId));
    if (!offered.some((plan) => plan.id === input.planId)) {
      throw new ServiceError("conflict", "That plan is not available to choose.");
    }
    return input;
  },
});

export const changeMyPlan = defineOrchestratedService({
  name: "subscriptions.changeMine",
  writeClass: "write",
  summary: "Change your own plan from the portal.",
  kind: "mutation",
  permission: "authenticated",
  input: planChangeInput,
  output: planChangeOutput,
  handler: async (input, actor) => {
    const allowed = await assertOwnSubscription.call(input, actor);
    const applied = await applyPlanChange.call(
      { ...allowed, settleBeforeGrant: true },
      { kind: "system" },
    );
    if (!applied.awaitingPayment) await syncProviderAfterPlanChange(applied, actor);
    if (applied.billingMode === "platform" && applied.invoiceId) {
      await chargePlatformInvoice.call(
        { subscriptionId: applied.subscriptionId, invoiceId: applied.invoiceId },
        actor,
      );
    }
    return applied;
  },
});

async function attachScheduledCashObservation(ctx: ServiceContext, paymentId: string, subscriptionId: string, options: {
  providerPlatformAccountId?: string; subscriptionChargeObservationId?: string; paymentProviderRef?: string; amountMinor: number; currency: string;
}) {
  if (!options.providerPlatformAccountId) return;
  if (!options.subscriptionChargeObservationId) throw new ServiceError("conflict", "This renewal needs its retained actual charge observation before applying payment.");
  const [observed] = await ctx.tx.select().from(subscriptionProviderChargeObservations).where(eq(subscriptionProviderChargeObservations.id, options.subscriptionChargeObservationId));
  if (!observed || observed.subscriptionId !== subscriptionId || observed.providerPaymentIntentRef !== options.paymentProviderRef
    || observed.providerPlatformAccountId !== options.providerPlatformAccountId || observed.amountMinor !== options.amountMinor || observed.currency !== options.currency
    || !observed.customerChargeVerified) throw new ServiceError("conflict", "The retained cash observation does not prove this original renewal payment.");
  await ctx.callAsSystem(recordMerchantPaymentObservation, { paymentId, providerEventRef: `subscription-cash:${observed.id}`, evidence: {
    providerRef: observed.providerPaymentIntentRef, status: "succeeded", amountMinor: observed.amountMinor, currency: observed.currency,
    providerPlatformAccountId: observed.providerPlatformAccountId, providerAccountId: observed.chargeAccountId ?? undefined,
    destinationAccountId: observed.actualDestinationAccountId ?? undefined, settlementMerchantAccountId: observed.actualSettlementMerchantAccountId ?? undefined,
    customerChargeVerified: observed.customerChargeVerified, merchantRouteVerified: observed.merchantRouteVerified, providerChargeRef: observed.providerChargeRef ?? undefined,
  } });
}

async function settlePeriodInvoice(
  ctx: Parameters<typeof raiseInvoice>[0],
  subscription: typeof subscriptions.$inferSelect,
  options: {
    amountMinor: number;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    provider: string;
    providerRef: string;
    providerAccountId?: string;
    providerPlatformAccountId?: string;
    subscriptionChargeReceiptId?: string;
    subscriptionChargeObservationId?: string;
    subscriptionInvoiceObservationId?: string;
    customerChargeVerified?: boolean;
    paymentProviderRef?: string;
    applicationFeeMinor?: number;
  },
): Promise<string | null> {
  if (options.providerPlatformAccountId && !options.subscriptionInvoiceObservationId) throw new ServiceError("conflict", "Retain this original period's actual invoice lineage before balance application.");
  const periodProof = options.providerPlatformAccountId ? await ctx.callAsSystem(proveMerchantProviderPeriod, {
    observationId: options.subscriptionInvoiceObservationId!, receiptId: options.subscriptionChargeReceiptId, subscriptionId: subscription.id,
    periodStart: options.periodStart.toISOString(), periodEnd: options.periodEnd.toISOString() }) : null;
  const sourceId = `${subscription.id}:${options.periodStart.toISOString()}`;
  const [existing] = await ctx.tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.sourceType, "subscription"), eq(invoices.sourceId, sourceId)))
    .limit(1);
  let invoice = existing ?? null;
  if (!invoice && !options.providerPlatformAccountId) {
    const [open] = await ctx.tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.sourceType, "subscription"),
          like(invoices.sourceId, `${subscription.id}:%`),
          inArray(invoices.status, ["sent", "viewed", "partially_paid", "overdue"]),
        ),
      )
      .limit(1);
    invoice = open ?? null;
  }
  if (!invoice) {
    const price = await priceFor(ctx, subscription, options.periodStart);
    if ("refused" in price) return null;
    const invoiceId = await raiseInvoice(ctx, subscription, {
      amountMinor: price.amountMinor,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
    });
    const [raised] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    invoice = raised ?? null;
  }
  if (!invoice) return null;
  if (periodProof) await assertCanonicalProviderPeriod(ctx, invoice.id, periodProof.phase);
  if (options.currency !== invoice.currency) throw new ServiceError("conflict", "The provider payment currency does not match the membership invoice.");
  if (options.providerPlatformAccountId && options.paymentProviderRef) {
    const [applied] = await ctx.tx.select().from(payments).where(and(eq(payments.invoiceId, invoice.id), eq(payments.status, "succeeded"), eq(payments.providerRef, options.paymentProviderRef))).limit(1);
    if (applied) {
      if (applied.amountMinor !== options.amountMinor || applied.currency !== options.currency) throw new ServiceError("conflict", "The original provider payment reference already has different canonical money.");
      await attachScheduledCashObservation(ctx, applied.id, subscription.id, options);
      assertChargeEvidence(await routingForPayment(ctx, applied.id), { ...options, status: "succeeded" }); return invoice.id;
    }
  }
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  if (periodProof && invoice.totalMinor === 0 && options.amountMinor === 0) return invoice.id;
  if (outstanding <= 0) {
    if (options.providerAccountId || options.providerPlatformAccountId) throw new ServiceError("conflict", "A different original charge already paid this period. Reconcile the extra money.");
    return invoice.id;
  }
  if (options.amountMinor <= 0 || options.amountMinor > outstanding || !options.providerPlatformAccountId && options.amountMinor !== outstanding) throw new ServiceError("conflict", "The provider payment amount does not match this original invoice's remaining balance.");
  const payment = await ctx.call(createPayment, {
    invoiceId: invoice.id,
    provider: options.provider,
    method: "provider_schedule",
    amountMinor: options.amountMinor,
    idempotencyKey: options.providerPlatformAccountId ? `subscription-provider:${subscription.id}:${invoice.id}:${options.subscriptionChargeReceiptId}` : `subscription-provider:${subscription.id}:${invoice.id}`,
    subscriptionChargeReceiptId: options.subscriptionChargeReceiptId,
  });
  const routing = await routingForPayment(ctx, payment.id);
  await attachScheduledCashObservation(ctx, payment.id, subscription.id, options);
  assertChargeEvidence(routing, { ...options, status: "succeeded" });
  if ((routing.providerAccountId || routing.providerPlatformAccountId) && !options.paymentProviderRef) throw new ServiceError("conflict", "The seller payment needs its original provider charge reference.");
  await ctx.call(settlePayment, {
    id: payment.id,
    providerRef: options.paymentProviderRef ?? `${options.providerRef}:${invoice.id}`,
    processedAt: new Date(),
  });
  return invoice.id;
}

export const reconcileProviderPeriod = defineService({
  name: "subscriptions.reconcileProviderPeriod",
  writeClass: "write",
  summary: "Follow a provider schedule event: the provider's calendar is the truth.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    provider: z.string().min(1).max(80),
    providerRef: z.string().min(1).max(500),
    providerAccountId: z.string().max(200).default(""),
    providerPlatformAccountId: paymentRouting.shape.providerPlatformAccountId,
    subscriptionChargeReceiptId: z.uuid().optional(),
    subscriptionChargeObservationId: z.uuid().optional(),
    subscriptionInvoiceObservationId: z.uuid().optional(),
    paymentProviderRef: z.string().max(500).optional(),
    applicationFeeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    kind: z.enum(["subscription_period_paid", "subscription_period_failed", "subscription_cancelled"]),
    amountMinor: z.number().int().min(0).optional(),
    currency: z.string().length(3).optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
  }),
  output: row({ applied: z.boolean() }),
  handler: async (input, ctx) => {
    const [cashSource] = input.providerPlatformAccountId && input.subscriptionChargeReceiptId ? await ctx.tx.select({ subscriptionId: subscriptionProviderChargeReceipts.subscriptionId }).from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, input.subscriptionChargeReceiptId)).limit(1) : [];
    const [invoiceSource] = input.providerPlatformAccountId && input.subscriptionInvoiceObservationId ? await ctx.tx.select({ subscriptionId: subscriptionProviderInvoiceObservations.subscriptionId }).from(subscriptionProviderInvoiceObservations).where(eq(subscriptionProviderInvoiceObservations.id, input.subscriptionInvoiceObservationId)).limit(1) : [];
    const originalSubscriptionId = cashSource?.subscriptionId ?? invoiceSource?.subscriptionId;
    const candidates = await ctx.tx
      .select({ subscription: subscriptions, scope: subscriptionMerchantScopes, policy: subscriptionMarketPolicies })
      .from(subscriptions)
      .leftJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
      .leftJoin(subscriptionMarketPolicies, eq(subscriptionMarketPolicies.subscriptionId, subscriptions.id))
      .where(and(eq(subscriptions.provider, input.provider), originalSubscriptionId ? eq(subscriptions.id, originalSubscriptionId) : eq(subscriptions.providerRef, input.providerRef)))
      .limit(100).for("update", { of: subscriptions });
    if (!candidates.length) return { applied: false };
    const matching = candidates.filter(row => input.providerPlatformAccountId
      ? row.scope?.providerPlatformAccountId === input.providerPlatformAccountId && row.scope.chargeAccountId === (input.providerAccountId || null)
      : !row.scope && (row.policy?.providerAccountId ?? "") === input.providerAccountId);
    if (matching.length !== 1 || candidates.length === 100) throw new ServiceError("conflict", "Reconcile this provider event against its exact original subscription namespace.");
    const found = matching[0]!.subscription;
    const routing = await subscriptionPaymentScope(ctx, found.id);
    assertProviderAccount({ providerAccountId: routing.providerAccountId, providerPlatformAccountId: routing.providerPlatformAccountId }, { providerAccountId: input.providerAccountId || undefined, providerPlatformAccountId: input.providerPlatformAccountId });
    let subscription = found;
    let [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
    if (plan) plan = await originalMerchantPlan(ctx, subscription, plan, input.periodStart ? new Date(input.periodStart) : subscription.currentPeriodStart);
    if (input.kind === "subscription_cancelled") {
      if (subscription.status === "cancelled" || subscription.status === "expired") return { applied: false };
      const now = new Date();
      await ctx.tx
        .update(subscriptions)
        .set({ status: "cancelled", cancelledAt: now, endedAt: now, cancelAtPeriodEnd: false })
        .where(eq(subscriptions.id, subscription.id));
      await record(ctx, subscription.id, "cancelled", { detail: "provider" });
      await keepAccess(ctx, subscription, plan?.name ?? "Membership", now, "expired");
      return { applied: true };
    }
    if (input.kind === "subscription_period_failed") {
      await record(ctx, subscription.id, "payment_failed", { detail: "provider" });
      await beginDunning(ctx, subscription, { detail: "provider" });
      return { applied: true };
    }
    if (input.amountMinor === undefined || !input.currency) throw new ServiceError("validation", "A membership payment needs provider amount and currency evidence.");
    if (routing.providerPlatformAccountId) {
      if (!input.subscriptionInvoiceObservationId) throw new ServiceError("conflict", "Retain complete admitted invoice/price lineage before applying this original provider period.");
      if (input.amountMinor > 0 && !input.subscriptionChargeReceiptId) throw new ServiceError("conflict", "Retain this automatic renewal's original charge before applying its invoice.");
      const [receipt] = input.subscriptionChargeReceiptId ? await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, input.subscriptionChargeReceiptId)) : [];
      if (input.amountMinor > 0 && (!receipt || receipt.subscriptionId !== found.id || receipt.providerSubscriptionRef !== input.providerRef || receipt.providerPaymentIntentRef !== input.paymentProviderRef
        || receipt.amountMinor !== input.amountMinor || receipt.currency !== input.currency || receipt.providerPlatformAccountId !== routing.providerPlatformAccountId
        || receipt.chargeAccountId !== (routing.providerAccountId ?? null))) throw new ServiceError("conflict", "This scheduled payment differs from its committed original charge receipt.");
    }
    const now = new Date();
    const start = input.periodStart ? new Date(input.periodStart) : subscription.currentPeriodStart;
    const end = input.periodEnd
      ? new Date(input.periodEnd)
      : periodEnd(start, plan?.interval ?? "month", plan?.intervalCount ?? 1);
    const renewing = end > subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now;
    if (renewing) {
      subscription = await applyPendingPlan(ctx, subscription);
      [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
      if (plan) plan = await originalMerchantPlan(ctx, subscription, plan, start);
    }
    if (routing.providerAccountId || routing.providerPlatformAccountId) {
      if (input.provider !== "stripe" || input.amountMinor > 0 && !input.paymentProviderRef || (!routing.providerPlatformAccountId && input.applicationFeeMinor === undefined) || !input.periodStart || !input.periodEnd) throw new ServiceError("conflict", "The provider must prove this seller period's actual charge and dates; legacy fees retain their original evidence contract.");
      const expectedStart = end > subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now ? subscription.currentPeriodEnd : subscription.currentPeriodStart;
      const expectedEnd = expectedStart === subscription.currentPeriodEnd ? periodEnd(expectedStart, plan?.interval ?? "month", plan?.intervalCount ?? 1) : subscription.currentPeriodEnd;
      if (Math.floor(start.getTime()/1000) !== Math.floor(expectedStart.getTime()/1000) || Math.floor(end.getTime()/1000) !== Math.floor(expectedEnd.getTime()/1000)) throw new ServiceError("conflict", "The seller payment dates do not match the original membership period.");
    }
    const invoiceId = await settlePeriodInvoice(ctx, subscription, {
      amountMinor: input.amountMinor,
      currency: input.currency,
      periodStart: routing.providerPlatformAccountId ? start : renewing ? subscription.currentPeriodEnd : subscription.currentPeriodStart,
      periodEnd: routing.providerPlatformAccountId ? end : renewing ? periodEnd(subscription.currentPeriodEnd, plan?.interval ?? "month", plan?.intervalCount ?? 1) : subscription.currentPeriodEnd,
      provider: input.provider,
      providerRef: input.providerRef,
      providerAccountId: routing.providerAccountId,
      providerPlatformAccountId: routing.providerPlatformAccountId,
      subscriptionChargeReceiptId: input.subscriptionChargeReceiptId,
      subscriptionChargeObservationId: input.subscriptionChargeObservationId,
      subscriptionInvoiceObservationId: input.subscriptionInvoiceObservationId,
      customerChargeVerified: routing.providerPlatformAccountId ? true : undefined,
      paymentProviderRef: input.paymentProviderRef,
      applicationFeeMinor: input.applicationFeeMinor,
    });
    if (routing.providerPlatformAccountId && !invoiceId) throw new ServiceError("conflict", "The original paid renewal is retained; reconcile its pinned invoice before advancing access.");
    if (routing.providerPlatformAccountId && invoiceId) {
      const [paid] = await ctx.tx.select({ status: invoices.status, paidMinor: invoices.paidMinor, totalMinor: invoices.totalMinor }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!paid || paid.status !== "paid" || paid.paidMinor !== paid.totalMinor) return { applied: true }; // Partial actual cash grants no next-period access.
    }
    if (subscription.status === "cancelled" || subscription.status === "expired") {
      return { applied: Boolean(invoiceId) };
    }
    if (renewing) {
      subscription = await applyPendingPlan(ctx, subscription);
      [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
      if (plan) plan = await originalMerchantPlan(ctx, subscription, plan, start);
      if (subscription.merchantScopeVersion === 1 && subscription.pendingPlanId) return { applied: true };
    }
    if (!renewing) {
      if (subscription.status === "trialing") {
        await ctx.tx
          .update(subscriptions)
          .set({ status: "active", trialEndsAt: null })
          .where(eq(subscriptions.id, subscription.id));
        await record(ctx, subscription.id, "activated");
      }
      return { applied: true };
    }
    const nextStart = subscription.currentPeriodEnd;
    const nextEnd = periodEnd(nextStart, plan?.interval ?? "month", plan?.intervalCount ?? 1);
    await ctx.tx
      .update(subscriptions)
      .set({
        status: subscription.status === "paused" ? "paused" : "active",
        currentPeriodStart: nextStart,
        currentPeriodEnd: nextEnd,
        trialEndsAt: null,
      })
      .where(eq(subscriptions.id, subscription.id));
    await record(ctx, subscription.id, "renewed", { invoiceId });
    if (subscription.status !== "paused") {
      await keepAccess(
        ctx,
        { ...subscription, currentPeriodStart: nextStart, currentPeriodEnd: nextEnd },
        plan?.name ?? "Membership",
        nextEnd,
        "active",
      );
    }
    return { applied: true };
  },
});

async function stopProviderSchedule(subscription: {
  provider: string | null;
  providerRef: string | null;
}, subscriptionId: string): Promise<void> {
  if (!subscription.provider || !subscription.providerRef) return;
  const routing = await getSubscriptionPaymentScope.call({ subscriptionId }, { kind: "system" });
  await paymentAdapter(subscription.provider).cancelRecurringSchedule({
    providerAccountId: routing.providerAccountId,
    providerRef: subscription.providerRef,
    idempotencyKey: `subscription-cancel:${subscription.providerRef}`,
  });
}

export const cancelAgreement = defineOrchestratedService({
  name: "subscriptions.cancelAgreement",
  writeClass: "write",
  summary: "Cancel a subscription and stop the provider's schedule if it has one.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    immediately: z.boolean().optional(),
    reason: z.string().trim().max(1000).optional(),
  }),
  output: row({
    id: uuidSchema,
    status: z.string(),
    cancelAtPeriodEnd: z.boolean(),
  }),
  handler: async (input, actor) => {
    const cancelled = await cancelSubscription.call(input, actor);
    await stopProviderSchedule(cancelled, input.id);
    return {
      id: cancelled.id,
      status: cancelled.status,
      cancelAtPeriodEnd: cancelled.cancelAtPeriodEnd,
    };
  },
});

export const cancelMyAgreement = defineOrchestratedService({
  name: "subscriptions.cancelMyAgreement",
  writeClass: "write",
  summary: "Cancel your own subscription and stop the provider's schedule if it has one.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: uuidSchema }),
  output: row({
    cancelled: z.boolean(),
    endsAt: z.coerce.date(),
  }),
  handler: async (input, actor) => {
    const ended = await cancelMySubscription.call(input, actor);
    await stopProviderSchedule(ended, input.id);
    return { cancelled: ended.cancelled, endsAt: ended.endsAt };
  },
});
