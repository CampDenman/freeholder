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
} from "@/core/service";
import { createPayment, failPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices, paymentMethods } from "@/modules/invoicing/schema";
import { resolvePrice } from "@/modules/catalog/pricing";
import { plans, subscriptionEvents, subscriptions } from "./schema";
import {
  applyPendingPlan,
  beginDunning,
  cancelMySubscription,
  cancelSubscription,
  keepAccess,
  periodEnd,
  priceFor,
  raiseInvoice,
  record,
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
  }),
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.subscriptionId))
      .limit(1);
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    const current = await applyPendingPlan(ctx, subscription);
    if (current.billingMode !== "platform") {
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
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, current.planId));
    if (!plan) throw new ServiceError("not_found", "There is no such plan.");
    const start = current.currentPeriodEnd;
    const end = periodEnd(start, plan.interval, plan.intervalCount);
    let invoiceId = input.invoiceId ?? null;
    if (!invoiceId) {
      const price = await priceFor(ctx, current);
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
    const amountMinor = invoice.totalMinor - invoice.paidMinor;
    if (amountMinor <= 0) {
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
    if (!method || method.status !== "active") {
      throw new ServiceError("conflict", "Platform billing needs an active stored payment method.");
    }
    const payment = await ctx.call(createPayment, {
      invoiceId: invoice.id,
      provider: method.provider,
      method: "saved_method",
      amountMinor,
      idempotencyKey: `subscription-charge:${current.id}:${invoice.id}`,
    });
    return {
      skip: false,
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
    succeeded: z.boolean(),
    failureMessage: z.string().max(500).optional(),
  }),
  output: row({ advanced: z.boolean() }),
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.subscriptionId))
      .limit(1);
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
    if (input.succeeded) {
      await ctx.call(settlePayment, {
        id: input.paymentId,
        providerRef: input.providerRef,
        processedAt: new Date(),
      });
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
    if (claimed.skip || !claimed.paymentId || !claimed.methodRef || !claimed.provider) {
      return { advanced: false, skipped: true };
    }
    const adapter = paymentAdapter(claimed.provider);
    try {
      const result = await adapter.chargeSavedMethod({
        methodRef: claimed.methodRef,
        customerRef: claimed.customerRef ?? undefined,
        invoiceId: claimed.invoiceId!,
        contactId: claimed.contactId,
        currency: claimed.currency,
        amountMinor: claimed.amountMinor,
        description: claimed.description,
        idempotencyKey: claimed.idempotencyKey,
      });
      const applied = await applyCharge.call(
        {
          subscriptionId: claimed.subscriptionId,
          invoiceId: claimed.invoiceId!,
          paymentId: claimed.paymentId,
          providerRef: result.providerRef,
          succeeded: result.status === "succeeded",
          failureMessage: result.failureMessage,
        },
        { kind: "system" },
      );
      return { advanced: applied.advanced, skipped: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The provider could not charge that method.";
      await applyCharge.call(
        {
          subscriptionId: claimed.subscriptionId,
          invoiceId: claimed.invoiceId!,
          paymentId: claimed.paymentId,
          providerRef: `failed:${claimed.paymentId}`,
          succeeded: false,
          failureMessage: message.slice(0, 500),
        },
        { kind: "system" },
      );
      return { advanced: false, skipped: false };
    }
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
    methodRef: z.string(),
    customerRef: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    interval: z.enum(["day", "week", "month", "year"]),
    intervalCount: z.number().int(),
    description: z.string(),
    idempotencyKey: z.string(),
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
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
    if (!plan) throw new ServiceError("not_found", "There is no such plan.");
    const [method] = subscription.paymentMethodId
      ? await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, subscription.paymentMethodId)).limit(1)
      : [];
    if (!method?.providerMethodRef || !method.providerCustomerRef) {
      throw new ServiceError("conflict", "Provider billing needs a stored method with a provider customer.");
    }
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
      methodRef: method.providerMethodRef,
      customerRef: method.providerCustomerRef,
      amountMinor: priced.amountMinor,
      currency: subscription.currency,
      interval: plan.interval,
      intervalCount: plan.intervalCount,
      description: plan.name,
      idempotencyKey: `subscription-schedule:${subscription.id}`,
    };
  },
});

const applyProviderSchedule = defineService({
  name: "subscriptions.applyProviderSchedule",
  writeClass: "write",
  summary: "Stamp the provider's schedule reference on the subscription.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    subscriptionId: uuidSchema,
    provider: z.string().min(1).max(80),
    providerRef: z.string().min(1).max(500),
  }),
  output: row({ id: uuidSchema }),
  handler: async (input, ctx) => {
    await ctx.tx
      .update(subscriptions)
      .set({ provider: input.provider, providerRef: input.providerRef })
      .where(eq(subscriptions.id, input.subscriptionId));
    ctx.setSubject("subscription", input.subscriptionId);
    return { id: input.subscriptionId };
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
    const created = await paymentAdapter(claimed.provider).createRecurringSchedule({
      customerRef: claimed.customerRef,
      methodRef: claimed.methodRef,
      currency: claimed.currency,
      amountMinor: claimed.amountMinor,
      interval: claimed.interval,
      intervalCount: claimed.intervalCount,
      description: claimed.description,
      idempotencyKey: claimed.idempotencyKey,
      metadata: {
        subscriptionId: claimed.subscriptionId,
        contactId: claimed.contactId,
        planId: claimed.planId,
      },
    });
    await applyProviderSchedule.call(
      {
        subscriptionId: claimed.subscriptionId,
        provider: claimed.provider,
        providerRef: created.providerRef,
      },
      actor,
    );
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
  methodRef: z.string().nullable(),
  customerRef: z.string().nullable(),
});

const applyPlanChange = defineService({
  name: "subscriptions.applyPlanChange",
  writeClass: "write",
  summary: "Record a plan change locally, raising a proration invoice when the plan says to.",
  kind: "mutation",
  permission: "scoped",
  input: planChangeInput,
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
    const [fromPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
    const [toPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, input.planId));
    if (!fromPlan || !toPlan) throw new ServiceError("not_found", "There is no such plan.");
    if (toPlan.status !== "active") throw new ServiceError("conflict", "That plan is not on sale.");
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
    if (toPlan.id === fromPlan.id) {
      return {
        subscriptionId: subscription.id,
        invoiceId: null,
        proratedMinor: 0,
        deferred: false,
        billingMode: subscription.billingMode,
        provider: subscription.provider,
        providerRef: subscription.providerRef,
        amountMinor: 0,
        ...schedule,
      };
    }
    const { productVariants } = await import("@/modules/catalog/schema");
    const [nextVariant] = await ctx.tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, toPlan.productId),
          eq(productVariants.isDefault, true),
        ),
      )
      .limit(1);
    const nextVariantId = nextVariant?.id ?? subscription.productVariantId;
    const newPrice = await priceFor(ctx, { ...subscription, productVariantId: nextVariantId });
    const newMinor = "refused" in newPrice ? 0 : newPrice.amountMinor;
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
        ...schedule,
      };
    }
    const oldPrice = await priceFor(ctx, subscription);
    if ("refused" in oldPrice || "refused" in newPrice) {
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
    return {
      subscriptionId: subscription.id,
      invoiceId,
      proratedMinor: net,
      deferred: false,
      billingMode: toPlan.billingMode,
      provider: subscription.provider,
      providerRef: subscription.providerRef,
      amountMinor: newMinor,
      ...schedule,
    };
  },
});

async function syncProviderAfterPlanChange(
  applied: z.infer<typeof planChangeOutput>,
  actor: Actor,
): Promise<void> {
  const stillProvider = applied.billingMode === "provider" || applied.deferred;
  if (stillProvider && applied.provider && applied.providerRef && applied.methodRef && applied.customerRef) {
    await paymentAdapter(applied.provider).updateRecurringSchedule({
      providerRef: applied.providerRef,
      amountMinor: applied.amountMinor,
      currency: applied.currency,
      interval: applied.interval,
      intervalCount: applied.intervalCount,
      description: applied.description,
      proration: applied.proration,
      idempotencyKey: `subscription-plan-change:${applied.subscriptionId}:${applied.providerRef}`,
    });
    return;
  }
  if (applied.billingMode === "provider" && !applied.providerRef) {
    await attachProviderSchedule.call({ subscriptionId: applied.subscriptionId }, actor);
    return;
  }
  if (!stillProvider && applied.previousProvider && applied.previousProviderRef) {
    await paymentAdapter(applied.previousProvider).cancelRecurringSchedule({
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
      .select({ id: subscriptions.id, contactId: subscriptions.contactId })
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
    const applied = await applyPlanChange.call(allowed, { kind: "system" });
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

async function settlePeriodInvoice(
  ctx: Parameters<typeof raiseInvoice>[0],
  subscription: typeof subscriptions.$inferSelect,
  options: {
    amountMinor?: number;
    periodStart: Date;
    periodEnd: Date;
    provider: string;
    providerRef: string;
  },
): Promise<string | null> {
  const sourceId = `${subscription.id}:${options.periodStart.toISOString()}`;
  const [existing] = await ctx.tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.sourceType, "subscription"), eq(invoices.sourceId, sourceId)))
    .limit(1);
  let invoice = existing ?? null;
  if (!invoice) {
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
    const price = await priceFor(ctx, subscription);
    if ("refused" in price) return null;
    const invoiceId = await raiseInvoice(ctx, subscription, {
      amountMinor: options.amountMinor ?? price.amountMinor,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
    });
    const [raised] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    invoice = raised ?? null;
  }
  if (!invoice) return null;
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  if (outstanding <= 0) return invoice.id;
  const payment = await ctx.call(createPayment, {
    invoiceId: invoice.id,
    provider: options.provider,
    method: "provider_schedule",
    amountMinor: outstanding,
    idempotencyKey: `subscription-provider:${subscription.id}:${invoice.id}`,
  });
  await ctx.call(settlePayment, {
    id: payment.id,
    providerRef: `${options.providerRef}:${invoice.id}`,
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
    kind: z.enum(["subscription_period_paid", "subscription_period_failed", "subscription_cancelled"]),
    amountMinor: z.number().int().optional(),
    currency: z.string().length(3).optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
  }),
  output: row({ applied: z.boolean() }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.provider, input.provider), eq(subscriptions.providerRef, input.providerRef)))
      .limit(1);
    if (!found) return { applied: false };
    let subscription = found;
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.planId));
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
    const now = new Date();
    const start = input.periodStart ? new Date(input.periodStart) : subscription.currentPeriodStart;
    const end = input.periodEnd
      ? new Date(input.periodEnd)
      : periodEnd(start, plan?.interval ?? "month", plan?.intervalCount ?? 1);
    const renewing = end > subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now;
    if (renewing) {
      subscription = await applyPendingPlan(ctx, subscription);
    }
    const invoiceId = await settlePeriodInvoice(ctx, subscription, {
      amountMinor: input.amountMinor,
      periodStart: renewing ? subscription.currentPeriodEnd : subscription.currentPeriodStart,
      periodEnd: renewing
        ? periodEnd(subscription.currentPeriodEnd, plan?.interval ?? "month", plan?.intervalCount ?? 1)
        : subscription.currentPeriodEnd,
      provider: input.provider,
      providerRef: input.providerRef,
    });
    if (subscription.status === "cancelled" || subscription.status === "expired") {
      return { applied: Boolean(invoiceId) };
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
}): Promise<void> {
  if (!subscription.provider || !subscription.providerRef) return;
  await paymentAdapter(subscription.provider).cancelRecurringSchedule({
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
    await stopProviderSchedule(cancelled);
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
    await stopProviderSchedule(ended);
    return { cancelled: ended.cancelled, endsAt: ended.endsAt };
  },
});
