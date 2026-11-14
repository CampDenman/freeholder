// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A subscription's life (MASTER.md §4.15, §43 C9.13).
//
// Three commitments run through this file.
//
// **The period is the truth.** A subscription is not "active" because a flag
// says so; it is active because it is inside a period somebody paid for.
// Renewal advances the period and raises an invoice, expiry ends the row when
// the last paid period runs out, and §4.15's rule falls out of that rather
// than being enforced separately: "access never quietly outlives the money,
// and never disappears before the period the customer paid for."
//
// **Money is somebody else's job.** Every period raises an ordinary `Invoice`
// (§4.6's single money object) through `invoicing.createDraft` with
// `source_type = 'subscription'`, priced by `catalog.resolvePrice`. This
// module has no price column and no total, so there is nowhere for a
// subscription's idea of what it costs to drift from the catalogue's.
//
// **Every transition is written down.** `subscription_events` is appended,
// never edited: `status` says where a subscription is and the events say how
// it got there, which is the only one of the two that can answer "why did this
// customer stop paying in March".
import { and, asc, desc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { selfServePlans, planSeller } from "./plan-access";
export { selfServePlans, planSeller } from "./plan-access";
import { matchesIlike, registerSearchSource } from "@/core/search/registry";
import { listed, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import {
  defineService,
  permits,
  getService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { prepareBuyerAgreementErasure, minimizeBuyerAgreements } from "./buyer-agreement-erasure";
import { buyerAcceptedProration } from "./proration-buyer-export";
import { syncSubscriptionAccess } from "@/core/entitlements/service";
import { exportControlledProviderHistory } from "./controlled-provider-witnesses";
import { exportControlledTargetFinancialHistory } from "@/modules/invoicing/controlled-target-financial-export";
import { controlledFinancialWitness } from "@/modules/invoicing/controlled-provider-financial-witness";
import { subscriptionProrationCardWitnesses, exportProrationCardHistory } from "./proration-card-witnesses";
import prorationCardServices from "./proration-card-service";
import grossProrationQuotes from "./proration-quote";
import grossProrationServices, { completePaidGrossProration } from "./proration-service";
import prorationCreditOwnerServices from "./proration-credit-owner";
import { subscriptionProrationCashConfirmations, subscriptionProrationCreditConfirmations } from "./proration-boundary-schema";
import { subscriptionProrations, subscriptionProrationPrincipal, subscriptionProrationCreditUses } from "./proration-schema";
import { originalCashRecoveryFinancialWitness } from "@/modules/invoicing/original-cash-recovery-store";
import { exportOriginalCashHistory } from "@/modules/invoicing/original-cash-invoice-history";
import { cashInspectionFinancialWitness, exportCashInspectionStops, exportControlledCashInspectionLineages } from "@/modules/invoicing/merchant-cash-inspection-financial";
import { contacts } from "@/core/contacts/schema";
import { getBusiness } from "@/core/settings/service";
import { productVariants, products } from "@/modules/catalog/schema";
import { resolvePrice } from "@/modules/catalog/pricing";
import { commercialBillingStart, pendingCommercialAmendment } from "./commercial-amendment-calendar";
import { assertPaidAmendmentInvoice } from "./commercial-amendment-payment";
import { invoiceSettled } from "@/modules/invoicing/invoice-balance";
import { originalMerchantPlan, originalMerchantTerms } from "./merchant-terms-read";
import { newProviderCalendarStart, periodEnd } from "./calendar";
export { periodEnd } from "./calendar";
import { raiseInvoice } from "./period-invoice";
export { raiseInvoice } from "./period-invoice";
import merchantTermsQuoteServices from "./merchant-terms-quote";
import merchantTermsStoreServices, { freezeOriginalMerchantTerms } from "./merchant-terms-store";
import { paymentAdapter } from "@/adapters/payments";
import { paymentMethods } from "@/modules/invoicing/schema";
import { invoices } from "@/modules/invoicing/schema";
import marketPolicyServices, { captureSubscriptionMarketPolicy, getSubscriptionMarketPolicy } from "./market-policy";
import { subscriptionPaymentScope } from "./market-policy";
import { subscriptionMethodScopeMatches, subscriptionTaxDestination } from "./merchant-scope-contract";
import { merchantSubscriptionUndo, subscriptionOriginalEvidence } from "./merchant-scope";
import {
  BILLING_MODES,
  CANCEL_BEHAVIOURS,
  DUNNING_CHANNELS,
  DUNNING_FINAL_ACTIONS,
  PLAN_INTERVALS,
  PLAN_STATUSES,
  PRORATION_MODES,
  SUBSCRIPTION_EVENT_KINDS,
  SUBSCRIPTION_STATUSES,
  dunningPolicies,
  plans,
  subscriptionCommercialTerms,
  subscriptionEvents,
  subscriptionMerchantScopes,
  subscriptionProviderChargeReceipts,
  subscriptions,
} from "./schema";

const planRow = row({
  id: uuidSchema,
  productId: uuidSchema,
  name: z.string(),
  interval: z.enum(PLAN_INTERVALS),
  intervalCount: z.number().int(),
  trialDays: z.number().int(),
  trialRequiresCard: z.boolean(),
  setupFeeMinor: z.number().int(),
  billingMode: z.enum(BILLING_MODES),
  cancelBehaviour: z.enum(CANCEL_BEHAVIOURS),
  proration: z.enum(PRORATION_MODES),
  status: z.enum(PLAN_STATUSES),
  updatedAt: timestamp,
});

const dunningRow = row({
  retries: z.array(z.number().int()),
  graceDays: z.number().int(),
  notifyChannels: z.array(z.enum(DUNNING_CHANNELS)),
  finalAction: z.enum(DUNNING_FINAL_ACTIONS),
  downgradeToPlanId: uuidSchema.nullable(),
});

const planOut = planRow.extend({ dunning: dunningRow.nullable() });

const dunningInput = z
  .object({
    retries: z.array(z.number().int().min(0).max(90)).min(1).max(8).default([3, 7, 14]),
    graceDays: z.number().int().min(0).max(365).default(14),
    notifyChannels: z.array(z.enum(DUNNING_CHANNELS)).min(1).max(3).default(["email"]),
    finalAction: z.enum(DUNNING_FINAL_ACTIONS).default("pause"),
    downgradeToPlanId: uuidSchema.nullable().optional(),
  })
  .superRefine((value, issue) => {
    if (value.finalAction === "downgrade" && !value.downgradeToPlanId) {
      issue.addIssue({
        code: "custom",
        path: ["downgradeToPlanId"],
        message: "A downgrade needs the plan they fall back to.",
      });
    }
  });

const subscriptionRow = row({
  id: uuidSchema,
  contactId: uuidSchema,
  planId: uuidSchema,
  productVariantId: uuidSchema,
  currency: z.string(),
  billingMode: z.enum(BILLING_MODES),
  status: z.enum(SUBSCRIPTION_STATUSES),
  currentPeriodStart: timestamp,
  currentPeriodEnd: timestamp,
  trialEndsAt: timestamp.nullable(),
  paymentMethodId: uuidSchema.nullable(),
  signupPending: z.boolean(),
  signupInvoiceId: uuidSchema.nullable(),
  pendingPlanId: uuidSchema.nullable(),
  provider: z.string().nullable(),
  providerRef: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  pausedAt: timestamp.nullable(),
  cancelledAt: timestamp.nullable(),
  endedAt: timestamp.nullable(),
  graceEndsAt: timestamp.nullable(),
  dunningNextAt: timestamp.nullable(),
  updatedAt: timestamp,
});

const DAY_MS = 86_400_000;

function retryOffsets(retries: number[]): number[] {
  return [...new Set(retries.filter((day) => Number.isInteger(day) && day >= 0))].sort(
    (left, right) => left - right,
  );
}

/** Append one moment. Never updates: the history is the point. */
export async function record(
  ctx: ServiceContext,
  subscriptionId: string,
  kind: (typeof SUBSCRIPTION_EVENT_KINDS)[number],
  extra: { invoiceId?: string | null; detail?: string | null } = {},
): Promise<void> {
  await ctx.tx.insert(subscriptionEvents).values({
    subscriptionId,
    kind,
    invoiceId: extra.invoiceId ?? null,
    detail: extra.detail ?? null,
  });
}

async function policyFor(tx: Tx, planId: string) {
  const [policy] = await tx
    .select()
    .from(dunningPolicies)
    .where(eq(dunningPolicies.planId, planId))
    .limit(1);
  return policy ?? null;
}

async function attachDunning<T extends { id: string }>(tx: Tx, rows: T[]) {
  if (rows.length === 0) return rows.map((row) => ({ ...row, dunning: null }));
  const policies = await tx
    .select()
    .from(dunningPolicies)
    .where(
      inArray(
        dunningPolicies.planId,
        rows.map((row) => row.id),
      ),
    );
  const byPlan = new Map(policies.map((policy) => [policy.planId, policy]));
  return rows.map((row) => {
    const policy = byPlan.get(row.id);
    return {
      ...row,
      dunning: policy
        ? {
            retries: retryOffsets(policy.retries),
            graceDays: policy.graceDays,
            notifyChannels: policy.notifyChannels,
            finalAction: policy.finalAction,
            downgradeToPlanId: policy.downgradeToPlanId,
          }
        : null,
    };
  });
}

async function writePolicy(
  tx: Tx,
  planId: string,
  input: z.infer<typeof dunningInput>,
) {
  const retries = retryOffsets(input.retries);
  const values = {
    retries,
    graceDays: input.graceDays,
    notifyChannels: [...new Set(input.notifyChannels)],
    finalAction: input.finalAction,
    downgradeToPlanId:
      input.finalAction === "downgrade" ? (input.downgradeToPlanId ?? null) : null,
  };
  const [existing] = await tx
    .select({ id: dunningPolicies.id })
    .from(dunningPolicies)
    .where(eq(dunningPolicies.planId, planId))
    .limit(1);
  if (existing) {
    await tx.update(dunningPolicies).set(values).where(eq(dunningPolicies.id, existing.id));
    return;
  }
  await tx.insert(dunningPolicies).values({ planId, ...values });
}

export async function keepAccess(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  planName: string,
  endsAt: Date,
  status: "active" | "paused" | "expired" = "active",
) {
  await ctx.callAsSystem(syncSubscriptionAccess, {
    subscriptionId: subscription.id,
    contactId: subscription.contactId,
    planId: subscription.planId,
    planName,
    startsAt: subscription.currentPeriodStart,
    endsAt,
    status,
  });
}

async function notifyDunning(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  policy: typeof dunningPolicies.$inferSelect,
  attempt: number,
) {
  if (policy.notifyChannels.length === 0) return;
  await ctx.callAsSystem(getService("notifications.create"), {
    recipient: { kind: "contact", id: subscription.contactId },
    topic: "subscriptions.dunning",
    priority: "warning",
    titleKey: "subscriptions.dunning.noticeTitle",
    bodyKey: "subscriptions.dunning.noticeBody",
    href: `/portal/subscriptions/${subscription.id}`,
    idempotencyKey: `dunning:${subscription.id}:${attempt}`,
  });
}

/** Apply a period-end plan change that proration `none` deferred. */
/**
 * The variant a plan is bought through: its default when that is on sale,
 * else its first active variant; null when nothing on the product can be
 * sold (C11.10).
 */
export async function planVariant(ctx: ServiceContext, productId: string): Promise<string | null> {
  const [found] = await ctx.tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.status, "active")))
    .orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt))
    .limit(1);
  return found?.id ?? null;
}

export async function applyPendingPlan(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
): Promise<typeof subscriptions.$inferSelect> {
  if (!subscription.pendingPlanId || subscription.cancelAtPeriodEnd) return subscription;
  const [nextPlan] = await ctx.tx.select().from(plans).where(eq(plans.id, subscription.pendingPlanId));
  if (!nextPlan) return subscription;
  // The new plan is priced by its own product's variant. Keeping the old
  // variant would bill the old price at every renewal after the switch. A
  // plan with nothing on sale is not switched to; the change stays pending.
  const amendment = await pendingCommercialAmendment(ctx, subscription);
  if (subscription.merchantScopeVersion === 1 && amendment?.amendment.state !== "activated") return subscription;
  if (amendment) {
    if (amendment.terms.effectivePeriodStart.getTime() > Date.now() || amendment.terms.effectivePeriodStart < subscription.currentPeriodEnd) return subscription;
    // Acceptance authorizes billing; only the canonical paid period authorizes
    // a different entitlement. Neither a pending invoice nor partial cash does.
    const sourceId = `${subscription.id}:${amendment.terms.effectivePeriodStart.toISOString()}`;
    const [paid] = await ctx.tx.select().from(invoices).where(and(eq(invoices.sourceType, "subscription"), eq(invoices.sourceId, sourceId))).limit(1);
    if (!paid || paid.contactId !== subscription.contactId || paid.currency !== subscription.currency || !paid.issuedAt
      || paid.status !== "paid" || !invoiceSettled(paid) || paid.refundedMinor !== 0) return subscription;
    await assertPaidAmendmentInvoice(ctx, subscription, amendment.terms, paid);
  }
  const productVariantId = amendment ? amendment.terms.snapshot.productVariantId : await planVariant(ctx, nextPlan.productId);
  const billingMode = amendment ? amendment.terms.snapshot.billingMode : nextPlan.billingMode;
  if (!productVariantId) return subscription;
  await ctx.tx
    .update(subscriptions)
    .set({ planId: nextPlan.id, pendingPlanId: null, billingMode, productVariantId })
    .where(eq(subscriptions.id, subscription.id));
  await ctx.tx.insert(subscriptionEvents).values({
    subscriptionId: subscription.id,
    kind: "plan_changed",
    fromPlanId: subscription.planId,
    toPlanId: nextPlan.id,
    detail: "period_end",
  });
  return {
    ...subscription,
    planId: nextPlan.id,
    pendingPlanId: null,
    billingMode,
    productVariantId,
  };
}

export async function beginDunning(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  extra: { detail?: string; invoiceId?: string | null } = {},
) {
  const policy = await policyFor(ctx.tx, subscription.planId);
  if (!policy) return;
  const now = new Date();
  const offsets = retryOffsets(policy.retries);
  const graceEnds = new Date(now.getTime() + policy.graceDays * DAY_MS);
  const first = offsets[0] ?? policy.graceDays;
  const immediate = first === 0;
  const nextOffset = immediate ? offsets[1] : first;
  const nextAt =
    nextOffset === undefined
      ? graceEnds
      : new Date(now.getTime() + nextOffset * DAY_MS);
  await ctx.tx
    .update(subscriptions)
    .set({
      status: "past_due",
      dunningStartedAt: now,
      dunningAttempt: immediate ? 1 : 0,
      dunningNextAt: nextAt,
      graceEndsAt: graceEnds,
      dunningInvoiceId: extra.invoiceId ?? subscription.dunningInvoiceId,
    })
    .where(eq(subscriptions.id, subscription.id));
  await record(ctx, subscription.id, "dunning", {
    invoiceId: extra.invoiceId ?? null,
    detail: extra.detail ?? "started",
  });
  ctx.queueEvent("subscription.dunning", { subscriptionId: subscription.id });
  const [plan] = await ctx.tx
    .select({ name: plans.name })
    .from(plans)
    .where(eq(plans.id, subscription.planId));
  await keepAccess(ctx, subscription, plan?.name ?? "Membership", graceEnds, "active");
  if (immediate) await notifyDunning(ctx, subscription, policy, 0);
}

async function clearDunningClock(
  ctx: ServiceContext,
  subscriptionId: string,
  patch: Record<string, unknown> = {},
) {
  await ctx.tx
    .update(subscriptions)
    .set({
      dunningStartedAt: null,
      dunningAttempt: 0,
      dunningNextAt: null,
      graceEndsAt: null,
      dunningInvoiceId: null,
      ...patch,
    })
    .where(eq(subscriptions.id, subscriptionId));
}

/* --------------------------------------------------------------- plans */

export const savePlan = defineService({
  name: "subscriptions.savePlan",
  writeClass: "write",
  summary: "Create or change a recurring offer.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    productId: uuidSchema,
    name: z.string().trim().min(1).max(200),
    interval: z.enum(PLAN_INTERVALS).default("month"),
    intervalCount: z.number().int().min(1).max(52).default(1),
    trialDays: z.number().int().min(0).max(365).default(0),
    trialRequiresCard: z.boolean().default(false),
    setupFeeMinor: z.number().int().min(0).default(0),
    billingMode: z.enum(BILLING_MODES).default("manual"),
    cancelBehaviour: z.enum(CANCEL_BEHAVIOURS).default("period_end"),
    proration: z.enum(PRORATION_MODES).default("create_prorations"),
    status: z.enum(PLAN_STATUSES).default("draft"),
    dunning: dunningInput.optional(),
  }),
  output: planOut,
  handler: async (input, ctx) => {
    const [product] = await ctx.tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!product) throw new ServiceError("not_found", "That product is not here.");

    if (input.billingMode !== "manual") {
      const adapter = paymentAdapter();
      const capabilities = adapter.capabilities();
      if (input.billingMode === "platform" && !capabilities.offSessionCharges) {
        throw new ServiceError(
          "validation",
          "Platform billing needs a payment provider that can charge a stored method off-session.",
        );
      }
      if (input.billingMode === "provider" && !capabilities.subscriptions) {
        throw new ServiceError(
          "validation",
          "Provider billing needs a payment provider that can run its own subscription schedule.",
        );
      }
      if (!adapter.status.available) {
        throw new ServiceError("conflict", adapter.status.message);
      }
    }

    const values = {
      productId: input.productId,
      name: input.name,
      interval: input.interval,
      intervalCount: input.intervalCount,
      trialDays: input.trialDays,
      trialRequiresCard: input.trialRequiresCard,
      setupFeeMinor: input.setupFeeMinor,
      billingMode: input.billingMode,
      cancelBehaviour: input.cancelBehaviour,
      proration: input.proration,
      status: input.status,
    };

    if (input.id) {
      const [updated] = await ctx.tx
        .update(plans)
        .set(values)
        .where(eq(plans.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such plan.");
      if (input.dunning) await writePolicy(ctx.tx, updated.id, input.dunning);
      ctx.setSubject("plan", updated.id);
      return (await attachDunning(ctx.tx, [updated]))[0]!;
    }
    const [created] = await ctx.tx.insert(plans).values(values).returning();
    if (input.dunning) await writePolicy(ctx.tx, created!.id, input.dunning);
    ctx.setSubject("plan", created!.id);
    ctx.queueEvent("plan.created", { planId: created!.id });
    return (await attachDunning(ctx.tx, [created!]))[0]!;
  },
});

export const listPlans = defineService({
  name: "subscriptions.listPlans",
  summary: "Recurring offers, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ status: z.enum(PLAN_STATUSES).optional() }),
  output: listed(planOut),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(plans)
      .where(input.status ? eq(plans.status, input.status) : undefined)
      .orderBy(desc(plans.createdAt))
      .limit(200);
    return attachDunning(ctx.tx, rows);
  },
});

export const listOfferedPlans = defineService({
  name: "subscriptions.listOffered",
  summary: "Plans a customer may move to from the portal.",
  kind: "query",
  permission: "authenticated",
  input: z.object({
    /** The customer's own subscription; its seller decides which plans are offered. */
    subscriptionId: uuidSchema.optional(),
  }),
  output: listed(planRow),
  handler: async (input, ctx) => {
    let sellerUserId: string | null = null;
    if (input.subscriptionId) {
      if (ctx.actor.kind !== "user") return [];
      const [own] = await ctx.tx
        .select({ planId: subscriptions.planId })
        .from(subscriptions)
        .innerJoin(contacts, eq(contacts.id, subscriptions.contactId))
        .where(and(eq(subscriptions.id, input.subscriptionId), eq(contacts.userId, ctx.actor.userId)))
        .limit(1);
      if (!own) return [];
      sellerUserId = await planSeller(ctx, own.planId);
    }
    return selfServePlans(ctx, sellerUserId);
  },
});

/* -------------------------------------------------------- subscribing */

/**
 * What this period costs, asked before anything is written.
 *
 * Priced through `catalog.resolvePrice` rather than from anything stored here,
 * so a subscription cannot drift from the catalogue, and so an unpriced
 * currency refuses rather than billing zero. §4.9: a variant is either priced
 * in a currency or unavailable in it.
 *
 * Asked *first*, and separately, for a reason that is not obvious: a failed
 * statement aborts the whole Postgres transaction, so a sweep that let the
 * invoice throw and then tried to write "payment failed" would fail at the
 * writing. The one predictable refusal is therefore a read, taken before
 * anything has been written; an unexpected error is left to propagate. That is
 * the honest division — a refusal is a recorded outcome, a bug is not.
 */
export async function priceFor(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  periodStart = subscription.currentPeriodStart,
): Promise<{ amountMinor: number } | { refused: string }> {
  const accepted = await originalMerchantTerms(ctx, subscription, periodStart);
  if (accepted) return { amountMinor: accepted.snapshot.periodAmountMinor };
  const priced = (await ctx.callAsSystem(resolvePrice, {
    variantId: subscription.productVariantId,
    currency: subscription.currency,
    contactId: subscription.contactId,
    quantity: 1,
  })) as { available: boolean; amountMinor?: number; reason?: string };
  if (!priced.available || priced.amountMinor === undefined) {
    return {
      refused: `No price in ${subscription.currency}: ${priced.reason ?? "that variant is not sold in this currency"}.`,
    };
  }
  return { amountMinor: priced.amountMinor };
}


export const subscribe = defineService({
  name: "subscriptions.subscribe",
  writeClass: "write",
  summary: "Start somebody on a plan.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: uuidSchema,
    planId: uuidSchema,
    /** Which variant is being bought, when the product has more than one. */
    productVariantId: uuidSchema.optional(),
    currency: z.string().trim().length(3).optional(),
    /** Required for platform and provider billing. */
    paymentMethodId: uuidSchema.optional(),
    deferFirstPayment: z.boolean().default(false),
    taxDestination: subscriptionTaxDestination.optional(),
    commercialTerms: z.object({ quoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
      locale: z.enum(["en", "es", "fr", "ar"]).default("en"), source: z.enum(["owner_subscription", "public_join"]).default("owner_subscription") }).optional(),
  }),
  output: row({
    subscription: subscriptionRow,
    /** The first invoice, or null while a trial is running. */
    invoiceId: uuidSchema.nullable(),
  }),
  handler: async (input, ctx) => {
    if (input.commercialTerms?.source === "public_join" && ctx.actor.kind !== "system") {
      throw new ServiceError("permission", "Public agreement acceptance belongs to the signed-in buyer's actual signup service.");
    }
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, input.planId)).for("share");
    if (!plan) throw new ServiceError("not_found", "There is no such plan.");
    if (plan.status !== "active") {
      throw new ServiceError("conflict", "That plan is not on sale.");
    }

    const variantId =
      input.productVariantId ??
      (
        await ctx.tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(
            and(
              eq(productVariants.productId, plan.productId),
              eq(productVariants.isDefault, true),
            ),
          )
          .limit(1)
      )[0]?.id;
    if (!variantId) {
      throw new ServiceError(
        "validation",
        "Say which variant is being subscribed to: that product has no default one.",
      );
    }

    const business = await ctx.call(getBusiness, {});
    const currency = input.currency ?? business?.baseCurrency;
    if (!currency) {
      throw new ServiceError("conflict", "Set the business's base currency before selling a plan.");
    }

    let paymentMethod: typeof paymentMethods.$inferSelect | null = null;
    if (plan.billingMode !== "manual" && (!input.deferFirstPayment || input.paymentMethodId)) {
      if (!input.paymentMethodId) {
        throw new ServiceError(
          "validation",
          "Automatic billing needs a stored payment method on this contact.",
        );
      }
      const [method] = await ctx.tx
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.id, input.paymentMethodId))
        .limit(1);
      if (!method || method.contactId !== input.contactId || method.status !== "active") {
        throw new ServiceError(
          "not_found",
          "That stored payment method is not available for this contact.",
        );
      }
      paymentMethod = method;
    }

    const now = input.commercialTerms&&plan.billingMode==="provider"?newProviderCalendarStart(new Date()):new Date();
    // A card-required trial without a method is not a trial yet. It waits,
    // paused, until the card exists. The trial window is counted from that
    // moment, not from the click. Manual billing cannot store a card, so it
    // still refuses rather than opening a trial nobody can renew.
    const awaitingCard =
      input.deferFirstPayment && plan.trialDays > 0 && plan.trialRequiresCard && !paymentMethod;
    if (awaitingCard && plan.billingMode === "manual") {
      throw new ServiceError("conflict", "This trial needs a saved payment method before it can start.");
    }
    const trialing = plan.trialDays > 0 && !awaitingCard;
    const pending = Boolean(input.deferFirstPayment && !trialing);
    // A trial *is* the first period. Treating it as a prelude would leave a
    // subscription with no period at all for its first fortnight, and every
    // question about "what are they inside" would have no answer. A card that
    // has not been saved yet is not that period: one day keeps the row ordered
    // until the trial actually starts.
    const start = now;
    const end = awaitingCard
      ? periodEnd(now, "day", 1)
      : trialing
        ? periodEnd(now, "day", plan.trialDays)
        : periodEnd(now, plan.interval, plan.intervalCount);

    const [created] = await ctx.tx
      .insert(subscriptions)
      .values({
        contactId: input.contactId,
        planId: plan.id,
        productVariantId: variantId,
        currency,
        acceptedSetupFeeMinor: plan.setupFeeMinor,
        billingMode: plan.billingMode,
        provider: paymentMethod?.provider ?? (plan.billingMode !== "manual" ? paymentAdapter().id : null),
        paymentMethodId: paymentMethod?.id ?? null,
        status: pending ? "paused" : trialing ? "trialing" : "active",
        signupPending: pending,
        pausedAt: pending ? now : null,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        trialEndsAt: trialing ? end : null,
      })
      .returning();

    await ctx.callAsSystem(captureSubscriptionMarketPolicy, { subscriptionId: created!.id, taxDestination: input.taxDestination });
    const merchant = await ctx.callAsSystem(getSubscriptionMarketPolicy, { subscriptionId: created!.id });
    if (merchant?.model === "seller_merchant") {
      if (!input.commercialTerms) throw new ServiceError("conflict", "Review and explicitly accept the merchant's original commercial quote before starting this agreement.");
      await ctx.callAsSystem(freezeOriginalMerchantTerms, { subscriptionId: created!.id, acceptedQuoteDigest: input.commercialTerms.quoteDigest,
        acceptanceSource: input.commercialTerms.source, deferFirstPayment: input.deferFirstPayment, locale: input.commercialTerms.locale });
    } else if (input.commercialTerms) {
      throw new ServiceError("conflict", "This accepted merchant quote does not belong to the selected agreement.");
    }
    if (merchant?.model === "seller_merchant" && plan.billingMode !== "manual" && created!.provider !== "stripe") {
      await ctx.tx.update(subscriptions).set({provider:"stripe"}).where(eq(subscriptions.id,created!.id));
      created!.provider = "stripe";
    }
    if (paymentMethod && !subscriptionMethodScopeMatches(await subscriptionPaymentScope(ctx, created!.id), paymentMethod)) throw new ServiceError("conflict", "The saved method belongs to a different original platform or charge account.");
    await record(ctx, created!.id, "created");
    if (!pending) await record(ctx, created!.id, trialing ? "trialing" : "activated");

    // A trial bills nothing, which is what makes it a trial. The first invoice
    // is raised by the renewal sweep when the trial period ends. A card that
    // is still missing is not a trial: the setup fee, when there is one, is
    // the only line. A zero-total invoice would mark itself paid, so a fee of
    // zero raises nothing and the card is saved through method setup instead.
    let invoiceId: string | null = null;
    if (awaitingCard && plan.setupFeeMinor > 0) {
      invoiceId = await raiseInvoice(ctx, created!, {
        amountMinor: 0,
        setupFeeMinor: plan.setupFeeMinor,
        periodStart: start,
        periodEnd: end,
      });
    } else if (!trialing && !awaitingCard) {
      const price = await priceFor(ctx, created!);
      if ("refused" in price) {
        throw new ServiceError("conflict", `This plan cannot be billed. ${price.refused}`);
      }
      invoiceId = await raiseInvoice(ctx, created!, {
        amountMinor: price.amountMinor,
        setupFeeMinor: plan.setupFeeMinor,
        periodStart: start,
        periodEnd: end,
      });
      await ctx.tx
        .insert(subscriptionEvents)
        .values({ subscriptionId: created!.id, kind: "renewed", invoiceId });
    }

    if (pending) {
      await ctx.tx.update(subscriptions).set({ signupInvoiceId: invoiceId }).where(eq(subscriptions.id, created!.id));
      created!.signupInvoiceId = invoiceId;
    }
    ctx.setSubject("subscription", created!.id);
    ctx.queueEvent("subscription.created", {
      subscriptionId: created!.id,
      contactId: input.contactId,
      planId: plan.id,
    });
    await ctx.callAsSystem(syncSubscriptionAccess, {
      subscriptionId: created!.id,
      contactId: created!.contactId,
      planId: plan.id,
      planName: plan.name,
      startsAt: created!.currentPeriodStart,
      endsAt: created!.currentPeriodEnd,
      status: pending ? "paused" : "active",
    });
    return { subscription: created!, invoiceId };
  },
});

/* ------------------------------------------------------- the calendar */

/**
 * Advance every subscription whose period has run out.
 *
 * One at a time, each in the caller's transaction, because a renewal raises an
 * invoice and a failure on one subscriber must not roll back the others. The
 * sweep is idempotent by the invoice's own key: running twice in a minute
 * raises no second invoice.
 */
export const renewDue = defineService({
  name: "subscriptions.renewDue",
  writeClass: "write",
  summary: "Advance the period of every subscription that has reached its end.",
  kind: "mutation",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: row({
    renewed: z.number().int(),
    ended: z.number().int(),
    failed: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const now = new Date();
    const due = await ctx.tx
      .select()
      .from(subscriptions)
      .where(
        and(
          or(eq(subscriptions.status, "active"), eq(subscriptions.status, "trialing")),
          lte(subscriptions.currentPeriodEnd, now),
        ),
      )
      .orderBy(asc(subscriptions.currentPeriodEnd))
      .limit(input.limit);

    let renewed = 0;
    let ended = 0;
    let failed = 0;

    for (const subscription of due) {
      if (subscription.billingMode === "provider") {
        continue;
      }
      if (subscription.billingMode === "platform" && !subscription.cancelAtPeriodEnd) {
        continue;
      }
      const commercialCalendar = await commercialBillingStart(ctx, subscription);
      if (!subscription.cancelAtPeriodEnd && (!commercialCalendar.ready || commercialCalendar.start > now)) continue;
      Object.assign(subscription, await applyPendingPlan(ctx, subscription));
      // Somebody who asked to stop leaves at the end of the period they paid
      // for — §4.15's rule, applied at the only moment it can be applied.
      if (subscription.cancelAtPeriodEnd) {
        await ctx.tx
          .update(subscriptions)
          .set({ status: "expired", endedAt: now })
          .where(eq(subscriptions.id, subscription.id));
        await record(ctx, subscription.id, "expired");
        ctx.queueEvent("subscription.expired", { subscriptionId: subscription.id });
        const [endedPlan] = await ctx.tx
          .select({ name: plans.name })
          .from(plans)
          .where(eq(plans.id, subscription.planId));
        await ctx.callAsSystem(syncSubscriptionAccess, {
          subscriptionId: subscription.id,
          contactId: subscription.contactId,
          planId: subscription.planId,
          planName: endedPlan?.name ?? "Membership",
          startsAt: subscription.currentPeriodStart,
          endsAt: now,
          status: "expired",
        });
        ended += 1;
        continue;
      }

      const [currentPlan] = await ctx.tx
        .select()
        .from(plans)
        .where(eq(plans.id, subscription.planId));
      if (!currentPlan) {
        failed += 1;
        continue;
      }

      const start = commercialCalendar.start;
      const plan = await originalMerchantPlan(ctx, subscription, currentPlan, start);
      const end = periodEnd(start, plan.interval, plan.intervalCount);

      const price = await priceFor(ctx, subscription, start);
      if ("refused" in price) {
        // Not silently skipped: the reason lands on the history, where an
        // owner will look. A DunningPolicy (C9.16) then retries, keeps access
        // for the grace window, and takes the final action the owner chose.
        // The period still does not move: nobody is given a month they were
        // not billed for.
        await record(ctx, subscription.id, "payment_failed", { detail: price.refused });
        ctx.queueEvent("subscription.paymentFailed", {
          subscriptionId: subscription.id,
          detail: price.refused,
        });
        await beginDunning(ctx, subscription, { detail: price.refused });
        failed += 1;
        continue;
      }

      const invoiceId = await raiseInvoice(ctx, subscription, {
        amountMinor: price.amountMinor,
        periodStart: start,
        periodEnd: end,
      });
      if (subscription.merchantScopeVersion === 1 && subscription.pendingPlanId) {
        const applied = await applyPendingPlan(ctx, subscription);
        if (applied.pendingPlanId) continue; // The invoice exists, but no unpaid amendment grants access.
        Object.assign(subscription, applied);
      }
      await ctx.tx
        .update(subscriptions)
        .set({
          status: "active",
          currentPeriodStart: start,
          currentPeriodEnd: end,
          trialEndsAt: null,
        })
        .where(eq(subscriptions.id, subscription.id));
      // A trial that ends by being billed has become a subscription, and the
      // history should say so in those words.
      if (subscription.status === "trialing") {
        await record(ctx, subscription.id, "activated");
      }
      await record(ctx, subscription.id, "renewed", { invoiceId });
      ctx.queueEvent("subscription.renewed", {
        subscriptionId: subscription.id,
        invoiceId,
      });
      await ctx.callAsSystem(syncSubscriptionAccess, {
        subscriptionId: subscription.id,
        contactId: subscription.contactId,
        planId: plan.id,
        planName: plan.name,
        startsAt: start,
        endsAt: end,
        status: "active",
      });
      // Manual billing has already moved the period; the invoice still has to
      // be paid. A policy starts the chase clock without taking access away.
      const policy = await policyFor(ctx.tx, plan.id);
      if (policy) {
        const offsets = retryOffsets(policy.retries);
        const first = offsets[0] ?? policy.graceDays;
        await ctx.tx
          .update(subscriptions)
          .set({
            dunningStartedAt: now,
            dunningAttempt: 0,
            dunningNextAt: new Date(now.getTime() + first * DAY_MS),
            graceEndsAt: new Date(now.getTime() + policy.graceDays * DAY_MS),
            dunningInvoiceId: invoiceId,
          })
          .where(eq(subscriptions.id, subscription.id));
      }
      renewed += 1;
    }

    return { renewed, ended, failed };
  },
});

/* ----------------------------------------------------- what a person does */

export const pauseSubscription = defineService({
  name: "subscriptions.pause",
  writeClass: "write",
  summary: "Stop billing without ending the agreement.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: subscriptionRow,
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.id));
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    if (
      subscription.status !== "active" &&
      subscription.status !== "trialing" &&
      subscription.status !== "past_due"
    ) {
      throw new ServiceError("conflict", "Only a running subscription can be paused.");
    }
    const [paused] = await ctx.tx
      .update(subscriptions)
      .set({
        status: "paused",
        pausedAt: new Date(),
        dunningStartedAt: null,
        dunningAttempt: 0,
        dunningNextAt: null,
        graceEndsAt: null,
        dunningInvoiceId: null,
      })
      .where(eq(subscriptions.id, input.id))
      .returning();
    await record(ctx, input.id, "paused");
    ctx.setSubject("subscription", input.id);
    ctx.queueEvent("subscription.paused", { subscriptionId: input.id });
    const [plan] = await ctx.tx
      .select({ name: plans.name })
      .from(plans)
      .where(eq(plans.id, paused!.planId));
    await ctx.callAsSystem(syncSubscriptionAccess, {
      subscriptionId: paused!.id,
      contactId: paused!.contactId,
      planId: paused!.planId,
      planName: plan?.name ?? "Membership",
      startsAt: paused!.currentPeriodStart,
      endsAt: paused!.currentPeriodEnd,
      status: "paused",
    });
    return paused!;
  },
});

export const resumeSubscription = defineService({
  name: "subscriptions.resume",
  writeClass: "write",
  summary: "Start billing again where it stopped.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: subscriptionRow,
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.id));
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    if (subscription.signupPending) throw new ServiceError("conflict", "Pay the first invoice before activating this signup.");
    if (subscription.status !== "paused") {
      throw new ServiceError("conflict", "That subscription is not paused.");
    }

    const [plan] = await ctx.tx
      .select()
      .from(plans)
      .where(eq(plans.id, subscription.planId));

    // The unused remainder travels with them. Pausing on day three of a month
    // and resuming in August should not cost the other twenty-seven days: the
    // new period is as long as what was left, so a pause postpones billing
    // rather than quietly charging for time nobody had.
    const now = new Date();
    const remaining = Math.max(
      0,
      subscription.currentPeriodEnd.getTime() -
        (subscription.pausedAt ?? subscription.currentPeriodStart).getTime(),
    );
    const accepted = await originalMerchantTerms(ctx, subscription, now);
    const end = remaining > 0 ? new Date(now.getTime() + remaining) : periodEnd(
      now,
      accepted?.snapshot.interval ?? plan?.interval ?? "month",
      accepted?.snapshot.intervalCount ?? plan?.intervalCount ?? 1,
    );

    const [resumed] = await ctx.tx
      .update(subscriptions)
      .set({
        status: subscription.trialEndsAt ? "trialing" : "active",
        pausedAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: end,
      })
      .where(eq(subscriptions.id, input.id))
      .returning();
    await record(ctx, input.id, "resumed");
    ctx.setSubject("subscription", input.id);
    ctx.queueEvent("subscription.resumed", { subscriptionId: input.id });
    const [resumedPlan] = await ctx.tx
      .select({ name: plans.name })
      .from(plans)
      .where(eq(plans.id, resumed!.planId));
    await ctx.callAsSystem(syncSubscriptionAccess, {
      subscriptionId: resumed!.id,
      contactId: resumed!.contactId,
      planId: resumed!.planId,
      planName: resumedPlan?.name ?? "Membership",
      startsAt: resumed!.currentPeriodStart,
      endsAt: resumed!.currentPeriodEnd,
      status: "active",
    });
    return resumed!;
  },
});

export const cancelSubscription = defineService({
  name: "subscriptions.cancel",
  writeClass: "write",
  summary: "End a subscription, at the period end or at once.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    /** Overrides the plan's stated behaviour, for the case an owner refunds. */
    immediately: z.boolean().optional(),
    reason: z.string().trim().max(1000).optional(),
  }),
  output: subscriptionRow,
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.id))
      .for("update");
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    if (subscription.status === "cancelled" || subscription.status === "expired") {
      throw new ServiceError("conflict", "That subscription has already ended.");
    }

    const [plan] = await ctx.tx
      .select({ cancelBehaviour: plans.cancelBehaviour })
      .from(plans)
      .where(eq(plans.id, subscription.planId));
    const accepted = await originalMerchantTerms(ctx, subscription);
    const atOnce = subscription.signupPending || (input.immediately ?? (accepted?.snapshot.cancelBehaviour ?? plan?.cancelBehaviour) === "immediate");
    const now = new Date();

    const [cancelled] = await ctx.tx
      .update(subscriptions)
      .set(
        atOnce
          ? { status: "cancelled", cancelledAt: now, endedAt: now, cancelAtPeriodEnd: false }
          : // Still running, and still theirs until the period they paid for
            // runs out. The sweep ends it then.
            { cancelledAt: now, cancelAtPeriodEnd: true },
      )
      .where(eq(subscriptions.id, input.id))
      .returning();
    await record(ctx, input.id, "cancelled", { detail: input.reason ?? null });
    ctx.setSubject("subscription", input.id);
    ctx.queueEvent("subscription.cancelled", {
      subscriptionId: input.id,
      immediately: atOnce,
    });
    await ctx.callAsSystem(syncSubscriptionAccess, {
      subscriptionId: cancelled!.id,
      contactId: cancelled!.contactId,
      planId: cancelled!.planId,
      planName: "Membership",
      startsAt: cancelled!.currentPeriodStart,
      endsAt: atOnce ? now : cancelled!.currentPeriodEnd,
      status: atOnce ? "expired" : "active",
    });
    return cancelled!;
  },
});

/* -------------------------------------------------------------- dunning */

async function invoiceIsPaid(tx: Tx, invoiceId: string | null): Promise<boolean> {
  if (!invoiceId) return false;
  const [invoice] = await tx
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return invoice?.status === "paid";
}

async function applyFinalAction(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  policy: typeof dunningPolicies.$inferSelect,
) {
  if (policy.finalAction === "pause") {
    await ctx.call(pauseSubscription, { id: subscription.id });
    return;
  }
  if (policy.finalAction === "cancel") {
    await ctx.call(cancelSubscription, { id: subscription.id, immediately: true });
    return;
  }
  const targetId = policy.downgradeToPlanId;
  if (!targetId) {
    await ctx.call(pauseSubscription, { id: subscription.id });
    return;
  }
  const [target] = await ctx.tx.select().from(plans).where(eq(plans.id, targetId)).limit(1);
  if (!target) {
    await ctx.call(pauseSubscription, { id: subscription.id });
    return;
  }
  await ctx.tx
    .update(subscriptions)
    .set({
      planId: target.id,
      status: "active",
      dunningStartedAt: null,
      dunningAttempt: 0,
      dunningNextAt: null,
      graceEndsAt: null,
      dunningInvoiceId: null,
    })
    .where(eq(subscriptions.id, subscription.id));
  await ctx.tx.insert(subscriptionEvents).values({
    subscriptionId: subscription.id,
    kind: "plan_changed",
    fromPlanId: subscription.planId,
    toPlanId: target.id,
    detail: "dunning downgrade",
  });
  ctx.queueEvent("subscription.planChanged", {
    subscriptionId: subscription.id,
    fromPlanId: subscription.planId,
    toPlanId: target.id,
  });
  await keepAccess(
    ctx,
    { ...subscription, planId: target.id },
    target.name,
    subscription.currentPeriodEnd,
    "active",
  );
}

export const recoverDunning = defineService({
  name: "subscriptions.recoverDunning",
  writeClass: "write",
  summary: "End dunning because the invoice was paid.",
  kind: "mutation",
  permission: "system",
  input: z.object({ invoiceId: uuidSchema }),
  output: row({ recovered: z.boolean() }),
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.dunningInvoiceId, input.invoiceId))
      .limit(1);
    if (!subscription) {
      const [invoice] = await ctx.tx
        .select({ sourceType: invoices.sourceType, sourceId: invoices.sourceId })
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId))
        .limit(1);
      if (invoice?.sourceType !== "subscription" || !invoice.sourceId) {
        return { recovered: false };
      }
      const subscriptionId = invoice.sourceId.split(":")[0] ?? "";
      if (!uuidSchema.safeParse(subscriptionId).success) {
        return { recovered: false };
      }
      const [bySource] = await ctx.tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId))
        .limit(1);
      if (!bySource || (bySource.status !== "past_due" && !bySource.dunningNextAt)) {
        return { recovered: false };
      }
      return recoverOne(ctx, bySource);
    }
    return recoverOne(ctx, subscription);
  },
});

async function recoverOne(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
) {
  const [plan] = await ctx.tx
    .select({ name: plans.name })
    .from(plans)
    .where(eq(plans.id, subscription.planId));
  const status = subscription.status === "past_due" ? "active" : subscription.status;
  await clearDunningClock(ctx, subscription.id, {
    status: status === "expired" || status === "cancelled" ? subscription.status : status,
  });
  if (subscription.status === "past_due") {
    await record(ctx, subscription.id, "dunning", { detail: "recovered" });
    await keepAccess(
      ctx,
      subscription,
      plan?.name ?? "Membership",
      subscription.currentPeriodEnd,
      "active",
    );
  }
  return { recovered: true };
}

export const advanceDunning = defineService({
  name: "subscriptions.advanceDunning",
  writeClass: "write",
  summary: "Send the next dunning notice, or take the final action.",
  kind: "mutation",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: row({
    noticed: z.number().int(),
    recovered: z.number().int(),
    finished: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const now = new Date();
    const due = await ctx.tx
      .select()
      .from(subscriptions)
      .where(
        and(
          isNotNull(subscriptions.dunningNextAt),
          lte(subscriptions.dunningNextAt, now),
          inArray(subscriptions.status, ["past_due", "active", "trialing"]),
        ),
      )
      .orderBy(asc(subscriptions.dunningNextAt))
      .limit(input.limit);

    let noticed = 0;
    let recovered = 0;
    let finished = 0;

    for (const subscription of due) {
      if (await invoiceIsPaid(ctx.tx, subscription.dunningInvoiceId)) {
        await recoverOne(ctx, subscription);
        recovered += 1;
        continue;
      }

      const policy = await policyFor(ctx.tx, subscription.planId);
      if (!policy) {
        await clearDunningClock(ctx, subscription.id);
        continue;
      }

      const offsets = retryOffsets(policy.retries);
      const started = subscription.dunningStartedAt ?? now;
      const attempt = subscription.dunningAttempt;
      const graceEnds = subscription.graceEndsAt ?? new Date(started.getTime() + policy.graceDays * DAY_MS);

      if (subscription.status !== "past_due") {
        const [plan] = await ctx.tx
          .select({ name: plans.name })
          .from(plans)
          .where(eq(plans.id, subscription.planId));
        const nextOffset = offsets[attempt + 1];
        const nextAt =
          nextOffset === undefined
            ? graceEnds
            : new Date(started.getTime() + nextOffset * DAY_MS);
        await ctx.tx
          .update(subscriptions)
          .set({
            status: "past_due",
            graceEndsAt: graceEnds,
            dunningAttempt: attempt + 1,
            dunningNextAt: nextAt,
          })
          .where(eq(subscriptions.id, subscription.id));
        await record(ctx, subscription.id, "dunning", {
          invoiceId: subscription.dunningInvoiceId,
          detail: "invoice unpaid",
        });
        ctx.queueEvent("subscription.dunning", { subscriptionId: subscription.id });
        await keepAccess(ctx, subscription, plan?.name ?? "Membership", graceEnds, "active");
        await notifyDunning(ctx, subscription, policy, attempt);
        noticed += 1;
        continue;
      }

      if (attempt < offsets.length) {
        await notifyDunning(ctx, subscription, policy, attempt);
        await record(ctx, subscription.id, "dunning", {
          invoiceId: subscription.dunningInvoiceId,
          detail: `retry ${attempt + 1}`,
        });
        const nextOffset = offsets[attempt + 1];
        const nextAt =
          nextOffset === undefined
            ? graceEnds
            : new Date(started.getTime() + nextOffset * DAY_MS);
        await ctx.tx
          .update(subscriptions)
          .set({ dunningAttempt: attempt + 1, dunningNextAt: nextAt })
          .where(eq(subscriptions.id, subscription.id));
        noticed += 1;
        continue;
      }

      if (now < graceEnds) {
        await ctx.tx
          .update(subscriptions)
          .set({ dunningNextAt: graceEnds })
          .where(eq(subscriptions.id, subscription.id));
        continue;
      }

      await applyFinalAction(ctx, subscription, policy);
      finished += 1;
    }

    return { noticed, recovered, finished };
  },
});

export const completePaidCommercialAmendment = defineService({
  name: "subscriptions.completePaidAmendment", summary: "Apply only the exact fully paid accepted next-period amendment.",
  kind: "mutation", permission: "system", external: false, input: z.object({ invoiceId: uuidSchema }), output: z.object({ applied: z.boolean() }),
  handler: async ({ invoiceId }, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    const id = z.uuid().safeParse(invoice?.sourceId?.split(":")[0]);
    if (!invoice || invoice.sourceType !== "subscription" || !id.success || invoice.status !== "paid" || !invoiceSettled(invoice)) return { applied: false };
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id.data)).limit(1).for("update");
    if (!parent || parent.merchantScopeVersion !== 1 || !parent.pendingPlanId || parent.signupPending || parent.cancelAtPeriodEnd || parent.cancelledAt
      || !["active", "trialing", "past_due"].includes(parent.status)) return { applied: false };
    const calendar = await commercialBillingStart(ctx, parent);
    if (!calendar.ready || calendar.start.getTime() > Date.now() || invoice.sourceId !== `${parent.id}:${calendar.start.toISOString()}`) return { applied: false };
    const current = await applyPendingPlan(ctx, parent);
    if (current.pendingPlanId) return { applied: false };
    const [offer] = await ctx.tx.select().from(plans).where(eq(plans.id, current.planId)).limit(1);
    if (!offer) throw new ServiceError("conflict", "Restore the paid amendment's original plan before advancing access.");
    const plan = await originalMerchantPlan(ctx, current, offer, calendar.start);
    const start = calendar.start, end = periodEnd(start, plan.interval, plan.intervalCount);
    await ctx.tx.update(subscriptions).set({ status: "active", currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt: null }).where(eq(subscriptions.id, parent.id));
    await record(ctx, parent.id, "renewed", { invoiceId });
    await keepAccess(ctx, { ...current, currentPeriodStart: start, currentPeriodEnd: end }, plan.name, end, "active");
    ctx.setSubject("subscription", parent.id); return { applied: true };
  },
});

export async function onInvoicePaid(
  payload: unknown,
  _eventName?: string,
): Promise<void> {
  const invoiceId =
    payload && typeof payload === "object" && "invoiceId" in payload
      ? (payload as { invoiceId?: string }).invoiceId
      : undefined;
  if (!invoiceId) return;
  await completePaidGrossProration.call({ invoiceId }, { kind: "system" });
  await recoverDunning.call({ invoiceId }, { kind: "system" });
  await activatePaidSignup.call({ invoiceId }, { kind: "system" });
  await completePaidPlanChange.call({ invoiceId }, { kind: "system" });
  await completePaidCommercialAmendment.call({ invoiceId }, { kind: "system" });
}

/* -------------------------------------------------------------- reading */

export const listSubscriptions = defineService({
  name: "subscriptions.list",
  summary: "Subscriptions, newest first.",
  kind: "query",
  permission: "scoped",
  // C8.11: the customer this asks about may ask it themselves. The field must
  // be present and their own — an absent filter means everybody, which is
  // refused rather than ignored.
  selfService: { contactField: "contactId" },
  input: z.object({
    contactId: uuidSchema.optional(),
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(subscriptionRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(subscriptions)
      .where(
        and(
          input.contactId ? eq(subscriptions.contactId, input.contactId) : undefined,
          input.status ? eq(subscriptions.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(input.limit);
    if (permits(ctx.actor, "scoped", "subscriptions.list", "query")) return rows;
    // A self-service reader receives only the contract's customer fields.
    // row() deliberately allows unknown database columns; stripping here
    // prevents provider references, retry keys and private overrides leaking.
    return rows.map((subscription) => subscriptionRow.strip().parse({
      ...subscription,
      provider: null,
      providerRef: null,
      paymentMethodId: null,
    }));
  },
});

export const getSubscription = defineService({
  name: "subscriptions.get",
  summary: "One subscription and everything that has happened to it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({
    subscription: subscriptionRow,
    plan: planRow.nullable(),
    history: listed(
      row({
        kind: z.enum(SUBSCRIPTION_EVENT_KINDS),
        invoiceId: uuidSchema.nullable(),
        detail: z.string().nullable(),
        at: timestamp,
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, input.id));
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    const [plan] = await ctx.tx
      .select()
      .from(plans)
      .where(eq(plans.id, subscription.planId));
    const staff = permits(ctx.actor, "scoped", "subscriptions.get", "query");
    const history = (
      await ctx.tx
        .select({
          kind: subscriptionEvents.kind,
          invoiceId: subscriptionEvents.invoiceId,
          detail: subscriptionEvents.detail,
          at: subscriptionEvents.at,
        })
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.subscriptionId, input.id))
        .orderBy(desc(subscriptionEvents.at))
        .limit(200)
    ).map((event) => ({
      ...event,
      // The provider customer reference binds the saved card to this trial.
      // Staff can see it. A self-service read cannot.
      detail: !staff && event.kind === "card_setup" ? null : event.detail,
    }));
    return { subscription, plan: plan?await originalMerchantPlan(ctx,subscription,plan):null, history };
  },
});

/* ------------------------------------------------ the customer's own copy */

/**
 * Cancel one's own subscription.
 *
 * §4.15 calls self-service mandatory and says why: "Every cancellation an
 * owner has to process by email is a support cost and, in several
 * jurisdictions, a legal exposure ('click to cancel' rules)." The contact
 * comes from the session and never from the request, so this can only ever end
 * the caller's own subscription.
 */
export const cancelMySubscription = defineService({
  name: "subscriptions.cancelMine",
  writeClass: "write",
  summary: "Let a signed-in customer cancel their own subscription.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: uuidSchema }),
  output: row({
    cancelled: z.boolean(),
    endsAt: timestamp,
    provider: z.string().nullable(),
    providerRef: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    // Resolved from the session exactly as the portal does, so a customer can
    // only ever reach their own row: the contact comes from `users.id`, never
    // from anything the request said.
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to manage your subscription.");
    }
    const [me] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.userId, ctx.actor.userId))
      .limit(1);
    if (!me) throw new ServiceError("not_found", "This account has no customer record.");
    const [subscription] = await ctx.tx
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, input.id), eq(subscriptions.contactId, me.id)));
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");

    const ended = (await ctx.callAsSystem(getService("subscriptions.cancel"), {
      id: input.id,
    })) as {
      currentPeriodEnd: Date;
      endedAt: Date | null;
      provider: string | null;
      providerRef: string | null;
    };
    return {
      cancelled: true,
      endsAt: ended.endedAt ?? ended.currentPeriodEnd,
      provider: ended.provider,
      providerRef: ended.providerRef,
    };
  },
});

/* ------------------------------------------------------ the contact spine */

// §4.1: a table with a `contact_id` repoints on merge, or the first merge
// orphans it. A subscription is a standing agreement, so it moves wholesale.
registerContactReference({
  table: "subscriptions",
  repoint: async (tx, duplicateId, survivingId) => {
    await tx
      .update(subscriptions)
      .set({ contactId: survivingId })
      .where(eq(subscriptions.contactId, duplicateId));
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    // Exactly recoverable: a subscription moves wholesale and nothing is
    // combined, so the rows that moved are the rows that move back.
    const moved = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.contactId, duplicateId)).orderBy(subscriptions.id).limit(5001);
    const original = await subscriptionOriginalEvidence(tx, [duplicateId, survivingId]);
    if (moved.length > 5000 || original.overflow) return { state: [], undoable: false, blocker: "Original subscription evidence exceeds the safe merge undo limit." };
    const movedIds = moved.map(each => each.id);
    return { state: original.evidence.length ? { movedIds, originalEvidence: original.evidence } : movedIds, undoable: true };
  },
  restoreAfterUndo: async (tx, before, after, duplicateId, survivingId) => {
    const original = await subscriptionOriginalEvidence(tx, [duplicateId, survivingId]);
    const modern = !Array.isArray(before) ? merchantSubscriptionUndo.parse(before) : null;
    if (modern) {
      const expected = merchantSubscriptionUndo.parse(after);
      if (original.overflow || JSON.stringify(original.evidence) !== JSON.stringify(expected.originalEvidence)) throw new ServiceError("conflict", "Original subscription scope or observed money changed after the merge. Reconcile it before separating ownership.");
    } else if (original.overflow || original.evidence.length) throw new ServiceError("conflict", "This historical merge did not record the new original subscription evidence. Restore the pre-upgrade snapshot to separate it safely.");
    const ids = (modern?.movedIds ?? (Array.isArray(before) ? before : [])).filter(
      (each): each is string => typeof each === "string",
    );
    if (ids.length === 0) return;
    await tx
      .update(subscriptions)
      .set({ contactId: duplicateId })
      .where(inArray(subscriptions.id, ids));
  },
});

// Erasure keeps the row and loses the person: a business must still be able to
// say how many subscriptions it had last March, and the money is the
// invoice's problem rather than this table's.
registerContactPrivacySource({
  scope: "subscriptions.agreements",
  tables: ["subscriptions", "subscription_events", "subscription_merchant_scopes", "subscription_provider_charge_receipts", "subscription_commercial_terms", "subscription_commercial_amendments", "subscription_commercial_resumptions", "subscription_provider_generations", "subscription_provider_invoice_observations", "subscription_provider_invoice_lines", "subscription_provider_read_tickets", "subscription_provider_read_finishes", "subscription_provider_read_stops",
    "subscription_prorations", "subscription_proration_principal", "subscription_proration_credit_uses", "subscription_proration_cash_confirmations", "subscription_proration_credit_confirmations", "subscription_proration_payment_protocols", "subscription_proration_card_mandates", "subscription_proration_card_attempts", "subscription_proration_card_jobs", "subscription_proration_card_reads", "subscription_proration_card_read_finishes", "subscription_proration_card_read_stops", "subscription_controlled_resources", "subscription_controlled_operations", "subscription_controlled_calls", "subscription_controlled_facts", "subscription_controlled_finishes", "subscription_controlled_stops", "subscription_controlled_verifications", "subscription_controlled_charge_origins", "subscription_controlled_closures", "subscription_controlled_cash_inspection_lineages", "subscription_controlled_quotes", "subscription_controlled_collections", "subscription_controlled_components", "subscription_controlled_invoice_bindings", "subscription_controlled_item_receipts", "subscription_controlled_invoice_proofs"],
  retentionScopes: ["commerce.money"],
  exportData: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        status: subscriptions.status,
        currency: subscriptions.currency,
        acceptedSetupFeeMinor: subscriptions.acceptedSetupFeeMinor,
        setupFeeInvoiceId: subscriptions.setupFeeInvoiceId,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelledAt: subscriptions.cancelledAt,
        endedAt: subscriptions.endedAt,
        originalTaxDestination: subscriptionMerchantScopes.taxDestination,
      })
      .from(subscriptions)
      .leftJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.contactId, contactId)).limit(5001);
    const charges = await tx.select({ id: subscriptionProviderChargeReceipts.id, subscriptionId: subscriptionProviderChargeReceipts.subscriptionId,
      amountMinor: subscriptionProviderChargeReceipts.amountMinor, currency: subscriptionProviderChargeReceipts.currency, observedAt: subscriptionProviderChargeReceipts.createdAt })
      .from(subscriptionProviderChargeReceipts).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderChargeReceipts.subscriptionId))
      .where(eq(subscriptions.contactId, contactId)).limit(5001);
    const byAgreement = new Map<string, typeof charges>();
    for (const charge of charges) {
      const group = byAgreement.get(charge.subscriptionId) ?? []; group.push(charge); byAgreement.set(charge.subscriptionId, group);
    }
    const accepted = rows.length ? await tx.select({ subscriptionId: subscriptionCommercialTerms.subscriptionId, revision: subscriptionCommercialTerms.revision,
      snapshot: subscriptionCommercialTerms.snapshot, taxDestination: subscriptionCommercialTerms.taxDestination, acceptedAt: subscriptionCommercialTerms.acceptedAt,
      effectivePeriodStart: subscriptionCommercialTerms.effectivePeriodStart, noticeSnapshot: subscriptionCommercialTerms.noticeSnapshot })
      .from(subscriptionCommercialTerms).where(inArray(subscriptionCommercialTerms.subscriptionId, rows.map(row => row.id))).orderBy(subscriptionCommercialTerms.revision).limit(5001) : [];
    const amendments = rows.length ? await tx.select({ subscriptionId: subscriptionCommercialAmendments.subscriptionId, termsId: subscriptionCommercialAmendments.termsId,
      planId: subscriptionCommercialAmendments.planId, acceptedBy: subscriptionCommercialAmendments.acceptedBy, state: subscriptionCommercialAmendments.state, createdAt: subscriptionCommercialAmendments.createdAt })
      .from(subscriptionCommercialAmendments).where(inArray(subscriptionCommercialAmendments.subscriptionId, rows.map(row => row.id))).limit(5001) : [];
    const resumptions = rows.length ? await tx.select({ subscriptionId: subscriptionCommercialResumptions.subscriptionId, termsId: subscriptionCommercialResumptions.termsId,
      originalPeriodEnd: subscriptionCommercialResumptions.originalPeriodEnd, acceptedPeriodStart: subscriptionCommercialResumptions.acceptedPeriodStart, createdAt: subscriptionCommercialResumptions.createdAt })
      .from(subscriptionCommercialResumptions).where(inArray(subscriptionCommercialResumptions.subscriptionId, rows.map(row => row.id))).limit(5001) : [];
    const periodInvoices = rows.length ? await tx.select({ subscriptionId: subscriptionProviderInvoiceObservations.subscriptionId, currency: subscriptionProviderInvoiceObservations.currency,
      totalMinor: subscriptionProviderInvoiceObservations.totalMinor, paidMinor: subscriptionProviderInvoiceObservations.paidMinor, remainingMinor: subscriptionProviderInvoiceObservations.remainingMinor,
      verified: subscriptionProviderInvoiceObservations.verified, createdAt: subscriptionProviderInvoiceObservations.createdAt })
      .from(subscriptionProviderInvoiceObservations).where(inArray(subscriptionProviderInvoiceObservations.subscriptionId, rows.map(row => row.id))).limit(5001) : [];
    const readerTickets = rows.length ? await tx.select({ subscriptionId: subscriptionProviderReadTickets.subscriptionId, readId: subscriptionProviderReadTickets.readId, admittedAt: subscriptionProviderReadTickets.createdAt,
      finishedAt: subscriptionProviderReadFinishes.createdAt }).from(subscriptionProviderReadTickets).leftJoin(subscriptionProviderReadFinishes, eq(subscriptionProviderReadFinishes.readId, subscriptionProviderReadTickets.readId))
      .where(inArray(subscriptionProviderReadTickets.subscriptionId, rows.map(row => row.id))).limit(5001) : [];
    const readerStops = rows.length ? await tx.select({ subscriptionId: subscriptionProviderReadStops.subscriptionId, readId: subscriptionProviderReadStops.readId, reviewedAt: subscriptionProviderReadStops.createdAt })
      .from(subscriptionProviderReadStops).where(inArray(subscriptionProviderReadStops.subscriptionId, rows.map(row => row.id))).limit(5001) : [];
    const prorations = rows.length ? await tx.select({ id: subscriptionProrations.id, subscriptionId: subscriptionProrations.subscriptionId,
      planId:subscriptionProrations.planId,previousTermsId:subscriptionProrations.previousTermsId,termsId:subscriptionProrations.termsId,snapshot: subscriptionProrations.snapshot,
      taxDestination: subscriptionProrations.taxDestination, noticeSnapshot: subscriptionProrations.noticeSnapshot, effectiveAt: subscriptionProrations.effectiveAt,
      originalPeriodStart: subscriptionProrations.originalPeriodStart, originalPeriodEnd: subscriptionProrations.originalPeriodEnd, originalTrialEndsAt: subscriptionProrations.originalTrialEndsAt,
      proposedPeriodStart:subscriptionProrations.proposedPeriodStart,proposedPeriodEnd:subscriptionProrations.proposedPeriodEnd,
      originalInvoiceId:subscriptionProrations.originalInvoiceId,originalInvoiceLineId:subscriptionProrations.originalInvoiceLineId,
      targetInvoice:{id:invoices.id,currency:invoices.currency,totalMinor:invoices.totalMinor,paidMinor:invoices.paidMinor,creditedMinor:invoices.creditedMinor,refundedMinor:invoices.refundedMinor},
      debitInvoiceId: subscriptionProrations.debitInvoiceId, creditNoteId: subscriptionProrations.creditNoteId, debitNetMinor: subscriptionProrations.debitNetMinor, debitTaxMinor: subscriptionProrations.debitTaxMinor,
      creditNetMinor: subscriptionProrations.creditNetMinor, creditTaxMinor: subscriptionProrations.creditTaxMinor, state: subscriptionProrations.state, appliedAt: subscriptionProrations.appliedAt,cancelledAt:subscriptionProrations.cancelledAt, createdAt: subscriptionProrations.createdAt })
      .from(subscriptionProrations).leftJoin(invoices,eq(invoices.id,subscriptionProrations.debitInvoiceId)).where(inArray(subscriptionProrations.subscriptionId, rows.map(row => row.id))).limit(5001) : [];
    const prorationIds = prorations.map(row => row.id);
    const prorationPrincipal = prorationIds.length ? await tx.select({ prorationId: subscriptionProrationPrincipal.prorationId, sourcePaymentId: subscriptionProrationPrincipal.sourcePaymentId,
      sourceApplicationId: subscriptionProrationPrincipal.sourceApplicationId, amountMinor: subscriptionProrationPrincipal.amountMinor }).from(subscriptionProrationPrincipal).where(inArray(subscriptionProrationPrincipal.prorationId, prorationIds)).limit(5001) : [];
    const prorationCredits = prorationIds.length ? await tx.select({ prorationId: subscriptionProrationCreditUses.prorationId, creditNoteId: subscriptionProrationCreditUses.creditNoteId, amountMinor: subscriptionProrationCreditUses.amountMinor })
      .from(subscriptionProrationCreditUses).where(inArray(subscriptionProrationCreditUses.prorationId, prorationIds)).limit(5001) : [];
    // These exact actual receipt FKs belong to the subject's subscriptions even
    // when original paid cash has never acquired any local invoice/payment.
    const cashBoundary = prorationIds.length ? await tx.select({ prorationId: subscriptionProrationCashConfirmations.prorationId, paymentId: subscriptionProrationCashConfirmations.paymentId,
      retainedAt: subscriptionProrationCashConfirmations.retainedAt }).from(subscriptionProrationCashConfirmations).where(inArray(subscriptionProrationCashConfirmations.prorationId, prorationIds)).limit(5001) : [];
    const creditBoundary = prorationIds.length ? await tx.select({ prorationId: subscriptionProrationCreditConfirmations.prorationId, applicationId: subscriptionProrationCreditConfirmations.applicationId,
      retainedAt: subscriptionProrationCreditConfirmations.retainedAt }).from(subscriptionProrationCreditConfirmations).where(inArray(subscriptionProrationCreditConfirmations.prorationId, prorationIds)).limit(5001) : [];
    const cardWitness = await subscriptionProrationCardWitnesses(tx, prorations.flatMap(row => row.debitInvoiceId ? [row.debitInvoiceId] : []));
    if (cardWitness.incomplete) throw new ServiceError("conflict", "Restore the complete original stored-method/reader inventory before export.");
    const cardHistory = exportProrationCardHistory(cardWitness);
    const cardCount = Object.values(cardHistory).reduce((total, family) => total + family.length, 0);
    const controlled=await controlledFinancialWitness(tx,{subscriptionIds:rows.map(row=>row.id)});
    if(controlled.incomplete)throw new ServiceError("conflict","Restore every original controlled calendar/caller/fact, including resources without an invoice or cash receipt, before export.");
    const controlledHistory=exportControlledProviderHistory(controlled.history),controlledCount=controlled.entries.length;
    const targetHistory=controlled.targets?await exportControlledTargetFinancialHistory(tx,controlled.targets):null;
    const controlledFor=(subscriptionId:string)=>{
      const resources=controlledHistory.resources.filter(row=>row.subscriptionId===subscriptionId),resourceIds=new Set(resources.map(row=>row.resourceId));
      const operations=controlledHistory.operations.filter(row=>resourceIds.has(row.resourceId)),operationIds=new Set(operations.map(row=>row.operationId));
      const calls=controlledHistory.calls.filter(row=>operationIds.has(row.operationId)),callIds=new Set(calls.map(row=>row.callId));
      const quotes=targetHistory?.quotes.filter(row=>row.subscriptionId===subscriptionId)??[],quoteIds=new Set(quotes.map(row=>row.quoteId));
      const collections=targetHistory?.collections.filter(row=>quoteIds.has(row.quoteId))??[],collectionIds=new Set(collections.map(row=>row.collectionId));
      const components=targetHistory?.components.filter(row=>collectionIds.has(row.collectionId))??[],componentIds=new Set(components.map(row=>row.componentId));
      return{resources,operations,calls,facts:controlledHistory.facts.filter(row=>callIds.has(row.callId)),actualFinishes:controlledHistory.actualFinishes.filter(row=>callIds.has(row.callId)),
        independentStops:controlledHistory.independentStops.filter(row=>callIds.has(row.callId)),verifications:controlledHistory.verifications.filter(row=>operationIds.has(row.operationId)),
        originalChargeLinks:controlledHistory.originalChargeLinks.filter(row=>resourceIds.has(row.resourceId)),actualClosures:controlledHistory.actualClosures.filter(row=>resourceIds.has(row.resourceId)),
        ...(quotes.length?{originalTargets:{quotes,collections,components,invoiceBindings:targetHistory?.invoiceBindings.filter(row=>collectionIds.has(row.collectionId))??[],
          itemReceipts:targetHistory?.itemReceipts.filter(row=>componentIds.has(row.componentId))??[],invoiceProofs:targetHistory?.invoiceProofs.filter(row=>collectionIds.has(row.collectionId))??[]}}:{})};
    };
    const originalCash = await originalCashRecoveryFinancialWitness(tx, [], charges.map(row => row.id));
    const inspectionStops = await cashInspectionFinancialWitness(tx, { paymentIds: [], receiptIds: charges.map(row => row.id), resourceIds: controlled.history.resources.map(row => row.id) });
    const actualReceiptIds = new Set(charges.map(row => row.id));
    if (inspectionStops.lineages.some(row => !actualReceiptIds.has(row.receiptId))) throw new ServiceError("conflict", "Restore the exact original subscription receipt ownership before exporting inspection lineages.");
    const exportedInspectionStops = exportCashInspectionStops(inspectionStops.stops);
    const exportedInspectionLineages = exportControlledCashInspectionLineages(inspectionStops.lineages);
    const aggregate = rows.length + charges.length + accepted.length + amendments.length + resumptions.length + periodInvoices.length + readerTickets.length + readerStops.length
      + controlledCount + cardCount + prorations.length + prorations.filter(row=>row.targetInvoice!==null).length + prorationPrincipal.length + prorationCredits.length + cashBoundary.length + creditBoundary.length + originalCash.owners.length + originalCash.operations.length + originalCash.facts.length + originalCash.closures.length + originalCash.feedback.length + inspectionStops.admissions.length + inspectionStops.stops.length + inspectionStops.lineages.length;
    if (aggregate > 5000) throw new ServiceError("conflict", "Restore a bounded complete original subscription subject export; receipt-only cash and its authentic children cannot be truncated.");
    const cashHistory = exportOriginalCashHistory(originalCash);
    const cashFor = (subscriptionId: string) => {
      const receiptIds = new Set(charges.filter(row => row.subscriptionId === subscriptionId).map(row => row.id));
      const owners = cashHistory.owners.filter(row => row.subscriptionChargeReceiptId !== null && receiptIds.has(row.subscriptionChargeReceiptId)), ownerIds = new Set(owners.map(row => row.id));
      const inspectionIds = new Set(inspectionStops.receiptInspectionOwnership.filter(row => receiptIds.has(row.receiptId)).map(row => row.inspectionId));
      const independentInspectionStops = exportedInspectionStops.filter(row => inspectionIds.has(row.inspectionId));
      const originalInspectionLineages = exportedInspectionLineages.filter(row => receiptIds.has(row.receiptId) && inspectionIds.has(row.inspectionId));
      return { owners, ...(independentInspectionStops.length ? { independentInspectionStops } : {}), ...(originalInspectionLineages.length ? { originalInspectionLineages } : {}), operations: cashHistory.operations.filter(row => ownerIds.has(row.recoveryId)), facts: cashHistory.facts.filter(row => ownerIds.has(row.recoveryId)),
        closures: cashHistory.closures.filter(row => ownerIds.has(row.recoveryId)), feedback: cashHistory.feedback.filter(row => row.namespace.subscriptionChargeReceiptId !== null && receiptIds.has(row.namespace.subscriptionChargeReceiptId)) };
    };
    return rows.map(row => ({ ...row, observedRenewalCharges: byAgreement.get(row.id) ?? [], acceptedCommercialTerms: accepted.filter(value => value.subscriptionId === row.id),
      acceptedAmendments: amendments.filter(value => value.subscriptionId === row.id), acceptedCalendarResumptions: resumptions.filter(value => value.subscriptionId === row.id), observedPeriodInvoices: periodInvoices.filter(value => value.subscriptionId === row.id),
      providerReaderHistory: readerTickets.filter(value => value.subscriptionId === row.id), providerReaderRuntimeStops: readerStops.filter(value => value.subscriptionId === row.id),
      originalReceiptCashHistory: cashFor(row.id), originalControlledProviderHistory:controlledFor(row.id), acceptedGrossProrations: prorations.filter(value => value.subscriptionId === row.id).map(value => ({ ...buyerAcceptedProration(value,value.targetInvoice),
        originalPrincipal: prorationPrincipal.filter(principal => principal.prorationId === value.id), acceptedCreditUse: prorationCredits.filter(credit => credit.prorationId === value.id),
        originalCardPaymentHistory: Object.fromEntries(Object.entries(cardHistory).map(([key, family]) => [key, family.filter(entry => entry.invoiceId === value.debitInvoiceId)])),
        actualCashRetention: cashBoundary.filter(receipt => receipt.prorationId === value.id), actualCreditRetention: creditBoundary.filter(receipt => receipt.prorationId === value.id) })) }));
  },
  erase: async (tx: Tx, contactId: string, context) => {
    if (!context.service) throw new ServiceError("conflict", "Original agreement erasure requires its actual shared privacy context.");
    const prepared = await context.service.callAsSystem(prepareBuyerAgreementErasure, { requestId: context.requestId });
    const rows = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.contactId, contactId));
    // Stop local access immediately; these flags are never remote stop proof.
    await tx.update(subscriptions).set({ grants: {}, cancelAtPeriodEnd: true }).where(eq(subscriptions.contactId, contactId));
    const pending = new Set(prepared.pendingAgreements.map(value => value.subscriptionId));
    const affected = await minimizeBuyerAgreements(tx, rows.filter(row => !pending.has(row.id)).map(row => row.id));
    return { affected, pendingJobs: prepared.pendingJobs };
  },
});

// The customer's own copy of all this (§4.15's mandatory self-service).
import "./portal";
import {
  attachProviderSchedule,
  cancelAgreement,
  cancelMyAgreement,
  changeMyPlan,
  changePlan,
  chargePlatformDue,
  chargePlatformInvoice,
  completePaidPlanChange,
  enroll,
  proratedDifference,
  reconcileProviderPeriod,
} from "./billing";

export {
  attachProviderSchedule,
  cancelAgreement,
  cancelMyAgreement,
  changeMyPlan,
  changePlan,
  chargePlatformDue,
  chargePlatformInvoice,
  enroll,
  proratedDifference,
  reconcileProviderPeriod,
};

import publicMembershipServices, { activatePaidSignup } from "./public-signup";
import setupErasureServices from "./setup-erasure";
import setupDispatchServices from "./setup-dispatch";
import setupReconciliationServices from "./setup-reconciliation";
import providerChargeReceiptServices from "./provider-charge-services";
import commercialAmendmentServices from "./commercial-amendments";
import providerReaderRecoveryServices from "./provider-reader-recovery";
import { subscriptionProviderReadTickets, subscriptionProviderReadFinishes, subscriptionProviderReadStops } from "./provider-read-ownership-schema";
import { subscriptionProviderInvoiceObservations } from "./provider-period-schema";
import { subscriptionCommercialResumptions } from "./commercial-resumption-schema";
import { subscriptionCommercialAmendments } from "./commercial-amendment-schema";

export default [
  ...prorationCardServices,
  ...grossProrationQuotes,
  ...grossProrationServices,
  ...prorationCreditOwnerServices,
  ...providerReaderRecoveryServices,
  completePaidCommercialAmendment,
  ...marketPolicyServices,
  ...merchantTermsQuoteServices,
  ...merchantTermsStoreServices,
  ...publicMembershipServices,
  ...setupErasureServices,
  ...setupDispatchServices,
  ...setupReconciliationServices,
  ...providerChargeReceiptServices,
  ...commercialAmendmentServices,
  savePlan,
  listPlans,
  listOfferedPlans,
  subscribe,
  enroll,
  renewDue,
  chargePlatformDue,
  chargePlatformInvoice,
  attachProviderSchedule,
  changePlan,
  changeMyPlan,
  completePaidPlanChange,
  reconcileProviderPeriod,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  cancelAgreement,
  listSubscriptions,
  getSubscription,
  cancelMySubscription,
  cancelMyAgreement,
  advanceDunning,
  recoverDunning,
];

registerSearchSource({
  kind: "subscription", module: "subscriptions", readService: "subscriptions.get", tables: ["subscriptions"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx.select({ id: subscriptions.id, contactId: subscriptions.contactId, name: plans.name })
      .from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(or(matchesIlike(plans.name, pattern), matchesIlike(sql`${subscriptions.id}::text`, pattern), matchesIlike(sql`${subscriptions.contactId}::text`, pattern)))
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id)).limit(limit);
    return rows.map(item => ({ kind: "subscription", id: item.id, title: item.name, href: `/admin/subscriptions/${item.id}`,
      snippet: null, contactId: item.contactId, module: "subscriptions" }));
  },
});
