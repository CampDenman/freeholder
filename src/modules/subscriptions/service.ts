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
import { and, asc, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { syncSubscriptionAccess } from "@/core/entitlements/service";
import { contacts } from "@/core/contacts/schema";
import { listLocations } from "@/core/locations/service";
import { currentBusiness } from "@/core/settings/read";
import { productVariants, products } from "@/modules/catalog/schema";
import { resolvePrice } from "@/modules/catalog/pricing";
import { createDraftInvoice, issueInvoice } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
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
  subscriptionEvents,
  subscriptions,
} from "./schema";

/** Quantity is fixed-point in `invoicing`; one of something is this. */
const QUANTITY_SCALE = 1_000_000;

/**
 * The end of a period that starts here.
 *
 * Calendar arithmetic rather than a fixed number of days: a monthly
 * subscription taken out on the 31st renews on the 30th in April and the 28th
 * in February, which is what everybody means by "monthly" and what adding
 * 30 days does not do.
 */
export function periodEnd(
  from: Date,
  interval: (typeof PLAN_INTERVALS)[number],
  count: number,
): Date {
  const end = new Date(from.getTime());
  if (interval === "day") end.setUTCDate(end.getUTCDate() + count);
  else if (interval === "week") end.setUTCDate(end.getUTCDate() + 7 * count);
  else if (interval === "year") end.setUTCFullYear(end.getUTCFullYear() + count);
  else {
    // Months, with the overflow Date would otherwise silently roll forward:
    // 31 January plus one month is 28 or 29 February, never 2 or 3 March.
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + count);
    const lastOfMonth = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
    ).getUTCDate();
    end.setUTCDate(Math.min(day, lastOfMonth));
  }
  return end;
}

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
async function record(
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

async function keepAccess(
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

async function beginDunning(
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

    // The automatic modes are C9.33's, and both need an off-session charge the
    // payments adapter does not offer yet. Refusing here is better than
    // accepting a plan that would silently never bill anybody.
    if (input.billingMode !== "manual") {
      throw new ServiceError(
        "validation",
        "Only manual billing is available so far: automatic renewals need a saved-card charge the payment provider adapter does not support yet.",
      );
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
async function priceFor(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
): Promise<{ amountMinor: number } | { refused: string }> {
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

/**
 * The period's invoice.
 *
 * §4.6's single money object, raised through `invoicing.createDraft` with
 * `source_type = 'subscription'`; this module keeps no total of its own.
 */
async function raiseInvoice(
  ctx: ServiceContext,
  subscription: typeof subscriptions.$inferSelect,
  options: {
    amountMinor: number;
    setupFeeMinor?: number;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<string> {
  const [variant] = await ctx.tx
    .select({ sku: productVariants.sku, name: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, subscription.productVariantId));

  const [person] = await ctx.tx
    .select({ country: contacts.country })
    .from(contacts)
    .where(eq(contacts.id, subscription.contactId));
  const locations = await ctx.callAsSystem(listLocations, {});
  const origin = locations.find((each) => each.isPrimary) ?? locations[0];

  const lines = [
    {
      sourceType: "subscription" as const,
      sourceId: subscription.id,
      description: `${variant?.name ?? "Subscription"} — ${options.periodStart
        .toISOString()
        .slice(0, 10)} to ${options.periodEnd.toISOString().slice(0, 10)}`,
      quantityMicros: QUANTITY_SCALE,
      unitAmountMinor: options.amountMinor,
    },
  ];
  // Charged once, on the first invoice only, because that is what a setup fee
  // is — a line on a renewal would be a second one.
  if (options.setupFeeMinor && options.setupFeeMinor > 0) {
    lines.push({
      sourceType: "subscription" as const,
      sourceId: subscription.id,
      description: `${variant?.name ?? "Subscription"} — setup`,
      quantityMicros: QUANTITY_SCALE,
      unitAmountMinor: options.setupFeeMinor,
    });
  }

  const draft = await ctx.callAsSystem(createDraftInvoice, {
    contactId: subscription.contactId,
    currency: subscription.currency,
    sourceType: "subscription" as const,
    // The period, not just the subscription. `invoices` is uniquely indexed on
    // (source_type, source_id) — one invoice per source thing — so a recurring
    // agreement has to name which period each invoice is for, or the second
    // month collides with the first. The same compound-id convention the
    // deposit/balance pair uses.
    sourceId: `${subscription.id}:${options.periodStart.toISOString()}`,
    // One invoice per subscription per period, whatever retries the sweep
    // makes. The period start is in the key because that is what makes this
    // period's invoice a different request from the last one's.
    idempotencyKey: `subscription:${subscription.id}:${options.periodStart.toISOString()}`,
    lines,
    tax:
      origin && person?.country
        ? {
            mode: "calculate" as const,
            origin: {
              country: origin.country,
              region: origin.region ?? undefined,
              postalCode: origin.postalCode ?? undefined,
              city: origin.city ?? undefined,
            },
            destination: { country: person.country },
          }
        : {
            mode: "not_applicable" as const,
            reason: "This subscription has no taxable origin and destination pair.",
          },
  });
  const issued = await ctx.callAsSystem(issueInvoice, { id: draft.invoice.id });
  return issued.invoice.id;
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
  }),
  output: row({
    subscription: subscriptionRow,
    /** The first invoice, or null while a trial is running. */
    invoiceId: uuidSchema.nullable(),
  }),
  handler: async (input, ctx) => {
    const [plan] = await ctx.tx.select().from(plans).where(eq(plans.id, input.planId));
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

    const business = await currentBusiness();
    const currency = input.currency ?? business?.baseCurrency;
    if (!currency) {
      throw new ServiceError("conflict", "Set the business's base currency before selling a plan.");
    }

    const now = new Date();
    const trialing = plan.trialDays > 0;
    // A trial *is* the first period. Treating it as a prelude would leave a
    // subscription with no period at all for its first fortnight, and every
    // question about "what are they inside" would have no answer.
    const start = now;
    const end = trialing
      ? periodEnd(now, "day", plan.trialDays)
      : periodEnd(now, plan.interval, plan.intervalCount);

    const [created] = await ctx.tx
      .insert(subscriptions)
      .values({
        contactId: input.contactId,
        planId: plan.id,
        productVariantId: variantId,
        currency,
        billingMode: plan.billingMode,
        status: trialing ? "trialing" : "active",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        trialEndsAt: trialing ? end : null,
      })
      .returning();

    await record(ctx, created!.id, "created");
    await record(ctx, created!.id, trialing ? "trialing" : "activated");

    // A trial bills nothing, which is what makes it a trial. The first invoice
    // is raised by the renewal sweep when the trial period ends.
    let invoiceId: string | null = null;
    if (!trialing) {
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
      status: "active",
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

      const [plan] = await ctx.tx
        .select()
        .from(plans)
        .where(eq(plans.id, subscription.planId));
      if (!plan) {
        failed += 1;
        continue;
      }

      const start = subscription.currentPeriodEnd;
      const end = periodEnd(start, plan.interval, plan.intervalCount);

      const price = await priceFor(ctx, subscription);
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
    const end = remaining > 0 ? new Date(now.getTime() + remaining) : periodEnd(
      now,
      plan?.interval ?? "month",
      plan?.intervalCount ?? 1,
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
      .where(eq(subscriptions.id, input.id));
    if (!subscription) throw new ServiceError("not_found", "There is no such subscription.");
    if (subscription.status === "cancelled" || subscription.status === "expired") {
      throw new ServiceError("conflict", "That subscription has already ended.");
    }

    const [plan] = await ctx.tx
      .select({ cancelBehaviour: plans.cancelBehaviour })
      .from(plans)
      .where(eq(plans.id, subscription.planId));
    const atOnce = input.immediately ?? plan?.cancelBehaviour === "immediate";
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

export async function onInvoicePaid(
  payload: unknown,
  _eventName?: string,
): Promise<void> {
  const invoiceId =
    payload && typeof payload === "object" && "invoiceId" in payload
      ? (payload as { invoiceId?: string }).invoiceId
      : undefined;
  if (!invoiceId) return;
  await recoverDunning.call({ invoiceId }, { kind: "system" });
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
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(subscriptions)
      .where(
        and(
          input.contactId ? eq(subscriptions.contactId, input.contactId) : undefined,
          input.status ? eq(subscriptions.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(input.limit),
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
    const history = await ctx.tx
      .select({
        kind: subscriptionEvents.kind,
        invoiceId: subscriptionEvents.invoiceId,
        detail: subscriptionEvents.detail,
        at: subscriptionEvents.at,
      })
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.subscriptionId, input.id))
      .orderBy(desc(subscriptionEvents.at))
      .limit(200);
    return { subscription, plan: plan ?? null, history };
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
  output: row({ cancelled: z.boolean(), endsAt: timestamp }),
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
    })) as { currentPeriodEnd: Date; endedAt: Date | null };
    return { cancelled: true, endsAt: ended.endedAt ?? ended.currentPeriodEnd };
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
  captureForUndo: async (tx, duplicateId) => {
    // Exactly recoverable: a subscription moves wholesale and nothing is
    // combined, so the rows that moved are the rows that move back.
    const moved = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.contactId, duplicateId));
    return { state: moved.map((each) => each.id), undoable: true };
  },
  restoreAfterUndo: async (tx, before, _after, duplicateId) => {
    const ids = (Array.isArray(before) ? before : []).filter(
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
  tables: ["subscriptions", "subscription_events"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        status: subscriptions.status,
        currency: subscriptions.currency,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelledAt: subscriptions.cancelledAt,
        endedAt: subscriptions.endedAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    // Ended rather than deleted, and the grants dropped. A business must still
    // be able to say how many subscriptions it had last March, and the money
    // is the invoice's record rather than this table's — but somebody who
    // asked to be forgotten must stop holding access.
    const cleared = await tx
      .update(subscriptions)
      .set({ grants: {}, cancelAtPeriodEnd: true })
      .where(eq(subscriptions.contactId, contactId))
      .returning({ id: subscriptions.id });
    return { affected: cleared.length };
  },
});

// The customer's own copy of all this (§4.15's mandatory self-service).
import "./portal";

export default [
  savePlan,
  listPlans,
  subscribe,
  renewDue,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  listSubscriptions,
  getSubscription,
  cancelMySubscription,
  advanceDunning,
  recoverDunning,
];
