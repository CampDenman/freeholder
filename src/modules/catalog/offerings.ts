// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Service offerings, cancellation policies and payment modes (C5.15).
//
// This is configuration on a `service` product, not a booking engine.
// Calendars and waiver templates are attach-points C6 will populate; this
// file refuses live values for them so C5 cannot fake availability or e-sign.

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { decimalToMinor } from "@/adapters/payments/currency";
import { defineService, ServiceError } from "@/core/service";
import { getFormById } from "@/modules/forms/service";
import { roundRatio, safeMinor } from "@/modules/invoicing/money";
import {
  CANCELLATION_FEE_TYPES,
  PRICE_LIST_KINDS,
  PRICE_BREAK_MODES,
  PRICE_RULE_MODES,
  SERVICE_ASSIGNMENTS,
  SERVICE_DEPOSIT_TYPES,
  SERVICE_LOCATION_TYPES,
} from "./contract";
import {
  cancellationPolicies,
  priceRules,
  products,
  serviceOfferings,
  type PriceRuleSchedule,
} from "./schema";
import { resolvePrice } from "./pricing";
import { getProductVariants } from "./variants";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

const cancellationPolicyRow = row({
  id: uuid,
  name: z.string(),
  freeUntilHours: z.number().int(),
  feeType: z.enum(CANCELLATION_FEE_TYPES),
  feeValue: z.number().int().nullable(),
  rescheduleLimit: z.number().int(),
  noShowFeeMinor: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const serviceOfferingRow = row({
  id: uuid,
  productId: uuid,
  durationMin: z.number().int(),
  bufferBeforeMin: z.number().int(),
  bufferAfterMin: z.number().int(),
  locationType: z.enum(SERVICE_LOCATION_TYPES),
  depositType: z.enum(SERVICE_DEPOSIT_TYPES),
  depositValue: z.number().int(),
  cancellationPolicyId: uuid.nullable(),
  intakeFormId: uuid.nullable(),
  waiverTemplateId: uuid.nullable(),
  waiverTitle: z.string().nullable(),
  waiverBody: z.string().nullable(),
  reminderOffsetsMin: z.array(z.number().int()),
  capacity: z.number().int(),
  assignment: z.enum(SERVICE_ASSIGNMENTS),
  calendarIds: listed(uuid),
  travelTimeMin: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const priceRuleRow = row({
  id: uuid,
  productId: uuid,
  mode: z.enum(PRICE_RULE_MODES),
  planSchedule: z.unknown(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const resolvedPrice = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(false),
    currency: z.string(),
    variantId: uuid,
    quantity: z.number().int(),
    reason: z.string(),
  }),
  z.object({
    available: z.literal(true),
    currency: z.string(),
    variantId: uuid,
    quantity: z.number().int(),
    amountMinor: z.number().int(),
    totalMinor: z.number().int(),
    compareAtMinor: z.number().int().nullable(),
    priceListId: uuid,
    priceListName: z.string(),
    kind: z.enum(PRICE_LIST_KINDS),
    breakMode: z.enum(PRICE_BREAK_MODES).nullable(),
    breakdown: listed(z.object({ qty: z.number().int(), unitMinor: z.number().int() })),
    reason: z.string(),
  }),
]);
const servicePaymentQuote = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(false),
    mode: z.enum(PRICE_RULE_MODES),
    currency: z.string(),
    reason: z.string(),
  }),
  z.object({
    available: z.literal(true),
    mode: z.enum(PRICE_RULE_MODES),
    currency: z.string(),
    priceMinor: z.number().int(),
    depositMinor: z.number().int(),
    balanceMinor: z.number().int(),
    dueNowMinor: z.number().int(),
    schedule: z.unknown(),
    durationMin: z.number().int(),
    capacity: z.number().int(),
    price: resolvedPrice,
  }),
]);

function assertFeeValue(
  feeType: (typeof CANCELLATION_FEE_TYPES)[number],
  feeValue: number | null | undefined,
): number | null {
  if (feeType === "none" || feeType === "forfeit_deposit") {
    if (feeValue != null) {
      throw new ServiceError("validation", "That fee type does not take an amount.");
    }
    return null;
  }
  if (feeType === "fixed") {
    if (!Number.isSafeInteger(feeValue) || !feeValue || feeValue <= 0) {
      throw new ServiceError("validation", "A fixed cancellation fee needs a positive amount.");
    }
    return feeValue;
  }
  if (!Number.isSafeInteger(feeValue) || !feeValue || feeValue < 1 || feeValue > 1_000_000) {
    throw new ServiceError(
      "validation",
      "A percent cancellation fee uses integer PPM between 1 and 1,000,000.",
    );
  }
  return feeValue;
}

function assertDepositValue(
  depositType: (typeof SERVICE_DEPOSIT_TYPES)[number],
  depositValue: number,
): number {
  if (depositType === "none") {
    if (depositValue !== 0) {
      throw new ServiceError("validation", "A service with no deposit cannot store a deposit amount.");
    }
    return 0;
  }
  if (depositType === "fixed") {
    if (!Number.isSafeInteger(depositValue) || depositValue <= 0) {
      throw new ServiceError("validation", "A fixed deposit needs a positive amount.");
    }
    return depositValue;
  }
  if (!Number.isSafeInteger(depositValue) || depositValue < 1 || depositValue > 1_000_000) {
    throw new ServiceError(
      "validation",
      "A percent deposit uses integer PPM between 1 and 1,000,000.",
    );
  }
  return depositValue;
}

export function applyServiceDeposit(
  priceMinor: number,
  depositType: (typeof SERVICE_DEPOSIT_TYPES)[number],
  depositValue: number,
): number {
  if (depositType === "none") return 0;
  if (depositType === "fixed") {
    if (depositValue > priceMinor) {
      throw new ServiceError("validation", "A fixed deposit cannot exceed the resolved price.");
    }
    return depositValue;
  }
  return safeMinor(
    roundRatio(BigInt(priceMinor) * BigInt(depositValue), 1_000_000n),
    "Service deposit",
  );
}

function assertSchedule(
  mode: (typeof PRICE_RULE_MODES)[number],
  schedule: PriceRuleSchedule,
): PriceRuleSchedule {
  if (mode === "payment_plan") {
    const count = schedule.installmentCount;
    const interval = schedule.intervalDays;
    if (
      !Number.isSafeInteger(count) ||
      !count ||
      count < 2 ||
      count > 36 ||
      !Number.isSafeInteger(interval) ||
      !interval ||
      interval < 1 ||
      interval > 365
    ) {
      throw new ServiceError(
        "validation",
        "A payment plan needs between 2 and 36 installments and an interval of 1–365 days.",
      );
    }
    return { installmentCount: count, intervalDays: interval };
  }
  if (mode === "retainer") {
    const period = schedule.periodDays;
    if (!Number.isSafeInteger(period) || !period || period < 7 || period > 365) {
      throw new ServiceError("validation", "A retainer needs a period of 7–365 days.");
    }
    return { periodDays: period };
  }
  if (schedule.installmentCount || schedule.intervalDays || schedule.periodDays) {
    throw new ServiceError("validation", "That payment mode does not take a schedule.");
  }
  return {};
}

export const listCancellationPolicies = defineService({
  name: "catalog.listCancellationPolicies",
  summary: "Named cancellation policies that service offerings can attach.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(cancellationPolicyRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(cancellationPolicies).orderBy(asc(cancellationPolicies.name)),
});

export const createCancellationPolicy = defineService({
  name: "catalog.createCancellationPolicy",
  summary: "Create a reusable cancellation policy for service offerings.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    freeUntilHours: z.number().int().min(0).max(24 * 30).default(24),
    feeType: z.enum(CANCELLATION_FEE_TYPES).default("none"),
    feeAmount: z.string().trim().optional(),
    feePercentPpm: z.number().int().min(1).max(1_000_000).optional(),
    rescheduleLimit: z.number().int().min(0).max(100).default(1),
    noShowFeeAmount: z.string().trim().optional(),
    currency: currency.optional(),
  }),
  output: cancellationPolicyRow,
  handler: async (input, ctx) => {
    const feeValue =
      input.feeType === "fixed"
        ? decimalToMinor(input.feeAmount ?? "", input.currency ?? "CAD")
        : input.feeType === "percent"
          ? input.feePercentPpm
          : null;
    const noShowFeeMinor = input.noShowFeeAmount
      ? decimalToMinor(input.noShowFeeAmount, input.currency ?? "CAD")
      : 0;
    const [created] = await ctx.tx
      .insert(cancellationPolicies)
      .values({
        name: input.name,
        freeUntilHours: input.freeUntilHours,
        feeType: input.feeType,
        feeValue: assertFeeValue(input.feeType, feeValue),
        rescheduleLimit: input.rescheduleLimit,
        noShowFeeMinor,
      })
      .returning();
    ctx.setSubject("cancellationPolicy", created!.id);
    return created!;
  },
});

export const deleteCancellationPolicy = defineService({
  name: "catalog.deleteCancellationPolicy",
  summary: "Remove a cancellation policy that no offering uses.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const [used] = await ctx.tx
      .select({ id: serviceOfferings.id })
      .from(serviceOfferings)
      .where(eq(serviceOfferings.cancellationPolicyId, input.id))
      .limit(1);
    if (used) {
      throw new ServiceError(
        "conflict",
        "A service offering still uses that cancellation policy.",
      );
    }
    const [deleted] = await ctx.tx
      .delete(cancellationPolicies)
      .where(eq(cancellationPolicies.id, input.id))
      .returning({ id: cancellationPolicies.id });
    if (!deleted) throw new ServiceError("not_found", "That cancellation policy is not here.");
    ctx.setSubject("cancellationPolicy", deleted.id);
    return { id: deleted.id };
  },
});

export const getServiceOffering = defineService({
  name: "catalog.getServiceOffering",
  summary: "The service configuration layered on one catalog product.",
  kind: "query",
  permission: "public",
  input: z.object({ productId: id }),
  output: serviceOfferingRow.nullable(),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(serviceOfferings)
      .where(eq(serviceOfferings.productId, input.productId))
      .limit(1);
    return row ?? null;
  },
});

export const listPriceRules = defineService({
  name: "catalog.listPriceRules",
  summary: "How a service product may be paid for.",
  kind: "query",
  permission: "public",
  input: z.object({ productId: id }),
  output: listed(priceRuleRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(priceRules)
      .where(eq(priceRules.productId, input.productId))
      .orderBy(asc(priceRules.mode)),
});

export const upsertServiceOffering = defineService({
  name: "catalog.upsertServiceOffering",
  summary: "Configure duration, deposit, intake and capacity on a service product.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    productId: id,
    durationMin: z.number().int().min(1).max(24 * 60),
    bufferBeforeMin: z.number().int().min(0).max(24 * 60).default(0),
    bufferAfterMin: z.number().int().min(0).max(24 * 60).default(0),
    locationType: z.enum(SERVICE_LOCATION_TYPES),
    depositType: z.enum(SERVICE_DEPOSIT_TYPES).default("none"),
    depositAmount: z.string().trim().optional(),
    depositPercentPpm: z.number().int().min(1).max(1_000_000).optional(),
    currency: currency.optional(),
    cancellationPolicyId: id.nullable().optional(),
    intakeFormId: id.nullable().optional(),
    waiverTemplateId: id.nullable().optional(),
    /**
     * The waiver this service asks for, in words (C6.09).
     *
     * The pre-template form of `waiverTemplateId` above. C6.14's templates
     * render into exactly this, which is why the seam is a body rather than a
     * second reference — and why a booking can require a waiver today.
     */
    waiverTitle: z.string().trim().min(1).max(200).nullable().optional(),
    waiverBody: z.string().trim().min(1).max(100_000).nullable().optional(),
    /** How long before the appointment to remind, in minutes (§4.4). */
    reminderOffsetsMin: z
      .array(z.number().int().min(0).max(43_200))
      .max(6)
      .optional(),
    capacity: z.number().int().min(1).max(10_000).default(1),
    assignment: z.enum(SERVICE_ASSIGNMENTS).default("specific"),
    calendarIds: z.array(id).default([]),
    travelTimeMin: z.number().int().min(0).max(24 * 60).default(0),
  }),
  output: serviceOfferingRow,
  handler: async (input, ctx) => {
    const [product] = await ctx.tx
      .select({ id: products.id, kind: products.kind })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    if (product.kind !== "service") {
      throw new ServiceError("validation", "Service offerings attach only to service products.");
    }
    if (input.calendarIds.length > 0) {
      throw new ServiceError(
        "validation",
        "Calendars attach when scheduling exists. Leave the calendar list empty.",
      );
    }
    if (input.waiverTemplateId) {
      throw new ServiceError(
        "validation",
        "Waiver templates attach when contracts exist. Leave the waiver blank.",
      );
    }
    if (input.intakeFormId) {
      const form = await ctx.call(getFormById, { id: input.intakeFormId });
      if (!form) throw new ServiceError("validation", "That intake form is not here.");
    }
    if (input.cancellationPolicyId) {
      const [policy] = await ctx.tx
        .select({ id: cancellationPolicies.id })
        .from(cancellationPolicies)
        .where(eq(cancellationPolicies.id, input.cancellationPolicyId))
        .limit(1);
      if (!policy) throw new ServiceError("validation", "That cancellation policy is not here.");
    }
    const depositValue =
      input.depositType === "fixed"
        ? decimalToMinor(input.depositAmount ?? "", input.currency ?? "CAD")
        : input.depositType === "percent"
          ? (input.depositPercentPpm ?? 0)
          : 0;

    const values = {
      productId: input.productId,
      durationMin: input.durationMin,
      bufferBeforeMin: input.bufferBeforeMin,
      bufferAfterMin: input.bufferAfterMin,
      locationType: input.locationType,
      depositType: input.depositType,
      depositValue: assertDepositValue(input.depositType, depositValue),
      cancellationPolicyId: input.cancellationPolicyId ?? null,
      intakeFormId: input.intakeFormId ?? null,
      waiverTemplateId: null,
      // A waiver needs both halves or neither: a body with no title has
      // nothing to head the page a customer reads, and a title with no body
      // is a requirement nobody can satisfy.
      waiverTitle: input.waiverBody ? (input.waiverTitle ?? "Waiver") : null,
      waiverBody: input.waiverBody ?? null,
      // Sorted longest-notice first, so the list reads in the order the
      // reminders actually go out, and deduped because two reminders at the
      // same offset is one reminder and one mistake.
      reminderOffsetsMin: [...new Set(input.reminderOffsetsMin ?? [1_440, 120])].sort(
        (a, b) => b - a,
      ),
      capacity: input.capacity,
      assignment: input.assignment,
      calendarIds: [],
      travelTimeMin: input.travelTimeMin,
      updatedAt: sql`now()`,
    };

    const [row] = await ctx.tx
      .insert(serviceOfferings)
      .values(values)
      .onConflictDoUpdate({
        target: serviceOfferings.productId,
        set: values,
      })
      .returning();
    ctx.setSubject("serviceOffering", row!.id);
    ctx.queueEvent("catalog.serviceOfferingConfigured", {
      productId: input.productId,
      offeringId: row!.id,
    });
    return row!;
  },
});

export const setPriceRule = defineService({
  name: "catalog.setPriceRule",
  summary: "Allow one payment mode on a service product.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    productId: id,
    mode: z.enum(PRICE_RULE_MODES),
    installmentCount: z.number().int().min(2).max(36).optional(),
    intervalDays: z.number().int().min(1).max(365).optional(),
    periodDays: z.number().int().min(7).max(365).optional(),
  }),
  output: priceRuleRow,
  handler: async (input, ctx) => {
    const [product] = await ctx.tx
      .select({ id: products.id, kind: products.kind })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    if (product.kind !== "service") {
      throw new ServiceError("validation", "Price rules attach only to service products.");
    }
    if (input.mode === "deposit_balance") {
      const [offering] = await ctx.tx
        .select({ depositType: serviceOfferings.depositType })
        .from(serviceOfferings)
        .where(eq(serviceOfferings.productId, input.productId))
        .limit(1);
      if (!offering || offering.depositType === "none") {
        throw new ServiceError(
          "validation",
          "A deposit/balance rule needs a service deposit first.",
        );
      }
    }
    const planSchedule = assertSchedule(input.mode, {
      installmentCount: input.installmentCount,
      intervalDays: input.intervalDays,
      periodDays: input.periodDays,
    });
    const [row] = await ctx.tx
      .insert(priceRules)
      .values({ productId: input.productId, mode: input.mode, planSchedule })
      .onConflictDoUpdate({
        target: [priceRules.productId, priceRules.mode],
        set: { planSchedule, updatedAt: sql`now()` },
      })
      .returning();
    ctx.setSubject("priceRule", row!.id);
    ctx.queueEvent("catalog.priceRuleSet", { productId: input.productId, mode: input.mode });
    return row!;
  },
});

export const removePriceRule = defineService({
  name: "catalog.removePriceRule",
  summary: "Stop offering one payment mode on a service product.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ productId: id, mode: z.enum(PRICE_RULE_MODES) }),
  output: z.object({ id: uuid, mode: z.enum(PRICE_RULE_MODES) }),
  handler: async (input, ctx) => {
    const [deleted] = await ctx.tx
      .delete(priceRules)
      .where(and(eq(priceRules.productId, input.productId), eq(priceRules.mode, input.mode)))
      .returning({ id: priceRules.id });
    if (!deleted) throw new ServiceError("not_found", "That payment mode is not configured.");
    ctx.setSubject("priceRule", deleted.id);
    return { id: deleted.id, mode: input.mode };
  },
});

export const quoteServicePayment = defineService({
  name: "catalog.quoteServicePayment",
  summary: "Explain the deposit and balance a service would collect at a price.",
  kind: "query",
  permission: "public",
  input: z.object({
    productId: id,
    currency,
    mode: z.enum(PRICE_RULE_MODES).default("full"),
    contactId: id.optional(),
    quantity: z.number().int().min(1).max(1_000).default(1),
    at: z.coerce.date().optional(),
  }),
  output: servicePaymentQuote,
  handler: async (input, ctx) => {
    const [offering] = await ctx.tx
      .select()
      .from(serviceOfferings)
      .where(eq(serviceOfferings.productId, input.productId))
      .limit(1);
    if (!offering) {
      throw new ServiceError("validation", "Configure the service offering before quoting payment.");
    }
    const [rule] = await ctx.tx
      .select()
      .from(priceRules)
      .where(and(eq(priceRules.productId, input.productId), eq(priceRules.mode, input.mode)))
      .limit(1);
    if (!rule) {
      throw new ServiceError("validation", "That payment mode is not allowed on this service.");
    }
    const variants = await ctx.callAsSystem(getProductVariants, { productId: input.productId });
    const variant = variants.variants.find((row) => row.isDefault) ?? variants.variants[0];
    if (!variant) {
      throw new ServiceError("validation", "Price a default variant before quoting this service.");
    }
    const priced = await ctx.callAsSystem(resolvePrice, {
      variantId: variant.id,
      currency: input.currency,
      contactId: input.contactId,
      quantity: input.quantity,
      at: input.at,
    });
    if (!priced.available || priced.totalMinor == null) {
      return {
        available: false as const,
        mode: input.mode,
        currency: input.currency,
        reason: priced.reason,
      };
    }
    const depositMinor =
      input.mode === "deposit_balance" || input.mode === "full"
        ? applyServiceDeposit(priced.totalMinor, offering.depositType, offering.depositValue)
        : 0;
    const dueNowMinor =
      input.mode === "full"
        ? priced.totalMinor
        : input.mode === "deposit_balance"
          ? depositMinor
          : input.mode === "payment_plan"
            ? safeMinor(
                roundRatio(
                  BigInt(priced.totalMinor),
                  BigInt(rule.planSchedule.installmentCount ?? 1),
                ),
                "First installment",
              )
            : priced.totalMinor;
    return {
      available: true as const,
      mode: input.mode,
      currency: input.currency,
      priceMinor: priced.totalMinor,
      depositMinor,
      balanceMinor: priced.totalMinor - (input.mode === "deposit_balance" ? depositMinor : 0),
      dueNowMinor,
      schedule: rule.planSchedule,
      durationMin: offering.durationMin,
      capacity: offering.capacity,
      price: priced,
    };
  },
});

/**
 * The terms a booking is made under, for core to snapshot (C6.08).
 *
 * The seam runs this way round on purpose. Core scheduling may not import a
 * module (§11), and a booking must nevertheless carry the cancellation terms
 * the customer saw — so catalog *offers* them and core takes a copy at the
 * moment of booking. Nothing here is a live reference: editing the policy
 * afterwards changes what the next customer agrees to, never what the last
 * one already did.
 */
export const bookingTerms = defineService({
  name: "catalog.bookingTerms",
  summary: "The cancellation terms attached to one service offering.",
  kind: "query",
  permission: "public",
  input: z.object({ serviceOfferingId: id }),
  output: z
    .object({
      name: z.string(),
      freeUntilHours: z.number().int(),
      feeType: z.enum(CANCELLATION_FEE_TYPES),
      feeValue: z.number().int().nullable(),
      rescheduleLimit: z.number().int(),
      noShowFeeMinor: z.number().int(),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({
        name: cancellationPolicies.name,
        freeUntilHours: cancellationPolicies.freeUntilHours,
        feeType: cancellationPolicies.feeType,
        feeValue: cancellationPolicies.feeValue,
        rescheduleLimit: cancellationPolicies.rescheduleLimit,
        noShowFeeMinor: cancellationPolicies.noShowFeeMinor,
      })
      .from(serviceOfferings)
      .innerJoin(
        cancellationPolicies,
        eq(cancellationPolicies.id, serviceOfferings.cancellationPolicyId),
      )
      .where(eq(serviceOfferings.id, input.serviceOfferingId))
      .limit(1);
    // Null rather than an error: a service with no policy attached is a
    // service somebody may cancel freely, not a misconfiguration.
    return found ?? null;
  },
});

/**
 * What has to be true before a slot is confirmed, and when to remind (C6.09).
 *
 * The same seam as `catalog.bookingTerms`, and the same direction: core
 * scheduling may not import a module (§11), so catalog *offers* the
 * requirements and core reads them through the registry. A `waiverBody` here
 * is the pre-template form of §4.4's `waiver_template_id` — C6.14 renders a
 * template into the same place, which is why the column holds words rather
 * than a reference.
 */
export const bookingRequirements = defineService({
  name: "catalog.bookingRequirements",
  summary: "Intake, waiver and reminders configured on one service offering.",
  kind: "query",
  permission: "public",
  input: z.object({ serviceOfferingId: id }),
  output: z
    .object({
      intakeFormId: uuid.nullable(),
      waiverTitle: z.string().nullable(),
      waiverBody: z.string().nullable(),
      reminderOffsetsMin: z.array(z.number().int()),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [offering] = await ctx.tx
      .select({
        intakeFormId: serviceOfferings.intakeFormId,
        waiverTitle: serviceOfferings.waiverTitle,
        waiverBody: serviceOfferings.waiverBody,
        reminderOffsetsMin: serviceOfferings.reminderOffsetsMin,
      })
      .from(serviceOfferings)
      .where(eq(serviceOfferings.id, input.serviceOfferingId))
      .limit(1);
    return offering ?? null;
  },
});

export default [
  listCancellationPolicies,
  createCancellationPolicy,
  deleteCancellationPolicy,
  getServiceOffering,
  listPriceRules,
  upsertServiceOffering,
  setPriceRule,
  removePriceRule,
  quoteServicePayment,
  bookingTerms,
  bookingRequirements,
];
