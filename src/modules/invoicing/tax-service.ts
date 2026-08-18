// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-defined tax configuration and built-in quoting (C5.02-C5.04).

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { TaxQuoteRequest } from "@/adapters/tax";
import { listed, uuid } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import {
  publicTaxTemplate as publicTaxTemplateSchema,
  taxCategoryRow,
  taxExemptionRow,
  taxQuote,
  taxRateRow,
  taxRegistrationRow,
  taxZoneRow,
} from "./contract";
import {
  invoices,
  taxCategories,
  taxExemptions,
  taxRates,
  taxRegistrations,
  taxZones,
} from "./schema";
import { calculateTaxQuote, type TaxRuleSet } from "./tax-engine";
import { sumMinor } from "./money";
import { publicTaxTemplate, taxTemplate, taxTemplates } from "./tax-templates";

const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const categoryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  .max(80);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nonNegativeMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveQuantity = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ratePpm = z.number().int().min(0).max(10_000_000);
const address = z.object({
  country,
  region: z.string().trim().toUpperCase().max(100).optional(),
  postalCode: z.string().trim().toUpperCase().max(30).optional(),
  city: z.string().trim().max(200).optional(),
});

function normalizePostal(value: string | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function postalMatches(postalCode: string | undefined, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true;
  const value = normalizePostal(postalCode);
  if (!value) return false;
  return patterns.some((raw) => {
    const pattern = normalizePostal(raw.replace(/\*+$/, ""));
    return raw.trim().endsWith("*") ? value.startsWith(pattern) : value === pattern;
  });
}

function regionMatches(region: string | undefined, regions: readonly string[]): boolean {
  if (regions.length === 0) return true;
  if (!region) return false;
  const normalized = region.trim().toUpperCase();
  return regions.some((candidate) => candidate.trim().toUpperCase() === normalized);
}

function specificity(zone: typeof taxZones.$inferSelect): number {
  return (zone.postalPatterns.length > 0 ? 2 : 0) + (zone.regions.length > 0 ? 1 : 0);
}

function applicableOn(rate: typeof taxRates.$inferSelect, onDate: string): boolean {
  return (
    rate.active &&
    (!rate.effectiveFrom || rate.effectiveFrom <= onDate) &&
    (!rate.effectiveTo || rate.effectiveTo >= onDate)
  );
}

export const listTaxConfiguration = defineService({
  name: "invoicing.taxConfiguration",
  summary: "Tax categories, zones, rates, registrations, and exemptions.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    categories: listed(taxCategoryRow),
    zones: listed(taxZoneRow),
    rates: listed(taxRateRow),
    registrations: listed(taxRegistrationRow),
    exemptions: listed(taxExemptionRow),
  }),
  handler: async (_input, ctx) => {
    const [categories, zones, rates, registrations, exemptions] = await Promise.all([
      ctx.tx.select().from(taxCategories).orderBy(asc(taxCategories.code)),
      ctx.tx.select().from(taxZones).orderBy(asc(taxZones.country), asc(taxZones.name)),
      ctx.tx.select().from(taxRates).orderBy(asc(taxRates.zoneId), asc(taxRates.priority)),
      ctx.tx.select().from(taxRegistrations).orderBy(asc(taxRegistrations.zoneId)),
      ctx.tx.select().from(taxExemptions).orderBy(asc(taxExemptions.contactId)),
    ]);
    return { categories, zones, rates, registrations, exemptions };
  },
});

export const createTaxCategory = defineService({
  name: "invoicing.createTaxCategory",
  summary: "Create a reusable product tax category.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    code: categoryCode,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).optional(),
    defaultRateHintPpm: ratePpm.optional(),
  }),
  output: taxCategoryRow,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx.insert(taxCategories).values(input).returning();
    ctx.setSubject("taxCategory", created!.id);
    return created!;
  },
});

export const createTaxZone = defineService({
  name: "invoicing.createTaxZone",
  summary: "Create a location-matched tax zone with explicit rounding rules.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    country,
    regions: z.array(z.string().trim().toUpperCase().min(1).max(100)).max(500).default([]),
    postalPatterns: z
      .array(z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 *-]{0,29}$/))
      .max(5_000)
      .default([]),
    priority: z.number().int().min(-100_000).max(100_000).default(0),
    basis: z.enum(["origin", "destination"]).default("destination"),
    pricesIncludeTax: z.boolean().default(false),
    roundingScope: z.enum(["line", "invoice"]).default("line"),
    roundingMode: z.enum(["half_up", "bankers"]).default("half_up"),
  }),
  output: taxZoneRow,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx.insert(taxZones).values(input).returning();
    ctx.setSubject("taxZone", created!.id);
    return created!;
  },
});

export const listTaxTemplates = defineService({
  name: "invoicing.listTaxTemplates",
  summary: "List source-attributed built-in tax starters and their activation limits.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    group: z
      .enum(["canada", "european_union", "united_kingdom", "united_states", "australia", "new_zealand"])
      .optional(),
  }),
  output: z.object({
    templates: listed(publicTaxTemplateSchema),
    warning: z.string(),
  }),
  handler: async (input) => ({
    templates: taxTemplates
      .filter((template) => !input.group || template.group === input.group)
      .map(publicTaxTemplate),
    warning:
      "Templates are dated starters, not tax advice. They remain non-collecting until an owner reviews and activates their registration.",
  }),
});

export const installTaxTemplate = defineService({
  name: "invoicing.installTaxTemplate",
  summary: "Install one versioned tax starter in monitoring mode without silently enabling collection.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().trim().min(1).max(120),
    pricesIncludeTax: z.boolean().optional(),
    thresholdMinor: nonNegativeMinor.default(0),
    thresholdCurrency: currency.optional(),
  }).refine((value) => value.thresholdMinor === 0 || Boolean(value.thresholdCurrency), {
    message: "A non-zero tax threshold needs its currency.",
    path: ["thresholdCurrency"],
  }),
  output: z.object({
    created: z.boolean(),
    template: publicTaxTemplateSchema,
    zone: taxZoneRow,
    rates: listed(taxRateRow),
    registration: taxRegistrationRow.nullable(),
  }),
  handler: async (input, ctx) => {
    const definition = taxTemplate(input.key);
    if (!definition) throw new ServiceError("not_found", "That tax template is not available.");

    // Transaction-scoped advisory locking makes a double-click and two setup
    // screens converge before the unique template constraint is reached.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tax-template:${definition.key}`}))`);
    const [existing] = await ctx.tx
      .select()
      .from(taxZones)
      .where(eq(taxZones.templateKey, definition.key))
      .limit(1);
    if (existing) {
      if (existing.templateVersion !== definition.version) {
        throw new ServiceError(
          "conflict",
          "That tax starter is an older version. Review its rates before applying an update.",
        );
      }
      const [rates, registrations] = await Promise.all([
        ctx.tx.select().from(taxRates).where(eq(taxRates.zoneId, existing.id)).orderBy(asc(taxRates.priority)),
        ctx.tx.select().from(taxRegistrations).where(eq(taxRegistrations.zoneId, existing.id)),
      ]);
      ctx.setSubject("taxZone", existing.id);
      return {
        created: false,
        template: publicTaxTemplate(definition),
        zone: existing,
        rates,
        registration: registrations[0] ?? null,
      };
    }

    await ctx.tx
      .insert(taxCategories)
      .values({
        code: "standard",
        name: "Standard taxable",
        description: "The jurisdiction's standard taxable goods and services.",
      })
      .onConflictDoNothing({ target: taxCategories.code });
    const [zone] = await ctx.tx
      .insert(taxZones)
      .values({
        name: definition.name,
        templateKey: definition.key,
        templateVersion: definition.version,
        country: definition.country,
        regions: [...definition.regions],
        postalPatterns: [],
        priority: definition.regions.length ? 100 : 0,
        basis: definition.basis,
        pricesIncludeTax: input.pricesIncludeTax ?? definition.pricesIncludeTax,
        roundingScope: definition.roundingScope,
        roundingMode: definition.roundingMode,
      })
      .returning();
    const rates = await ctx.tx
      .insert(taxRates)
      .values(
        definition.rates.map((rate) => ({
          zoneId: zone!.id,
          name: rate.name,
          jurisdiction: rate.jurisdiction,
          ratePpm: rate.ratePpm,
          compound: false,
          priority: rate.priority ?? 0,
          appliesToShipping: rate.appliesToShipping,
        })),
      )
      .returning();
    const [registration] = await ctx.tx
      .insert(taxRegistrations)
      .values({
        zoneId: zone!.id,
        thresholdMinor: input.thresholdMinor,
        thresholdCurrency: input.thresholdCurrency,
        status: "monitoring",
      })
      .returning();
    ctx.setSubject("taxZone", zone!.id);
    return {
      created: true,
      template: publicTaxTemplate(definition),
      zone: zone!,
      rates,
      registration: registration!,
    };
  },
});

export const addTaxRate = defineService({
  name: "invoicing.addTaxRate",
  summary: "Add an effective-dated category or shipping rate to a tax zone.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    zoneId: z.string().uuid(),
    categoryId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().min(1).max(200),
    ratePpm,
    compound: z.boolean().default(false),
    priority: z.number().int().min(-100_000).max(100_000).default(0),
    appliesToShipping: z.boolean().default(false),
    effectiveFrom: dateString.optional(),
    effectiveTo: dateString.optional(),
  }).refine(
    (value) => !value.effectiveFrom || !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    { message: "The rate cannot end before it starts.", path: ["effectiveTo"] },
  ),
  output: taxRateRow,
  handler: async (input, ctx) => {
    const [zone] = await ctx.tx.select({ id: taxZones.id }).from(taxZones).where(eq(taxZones.id, input.zoneId));
    if (!zone) throw new ServiceError("not_found", "That tax zone is not here.");
    if (input.categoryId) {
      const [category] = await ctx.tx
        .select({ id: taxCategories.id })
        .from(taxCategories)
        .where(eq(taxCategories.id, input.categoryId));
      if (!category) throw new ServiceError("not_found", "That tax category is not here.");
    }
    const [created] = await ctx.tx.insert(taxRates).values(input).returning();
    ctx.setSubject("taxRate", created!.id);
    return created!;
  },
});

export const setTaxRegistration = defineService({
  name: "invoicing.setTaxRegistration",
  summary: "Record collection status, registration identity, and threshold for a zone.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid().optional(),
    zoneId: z.string().uuid(),
    number: z.string().trim().max(200).nullable().optional(),
    scheme: z.enum(["standard", "oss", "ioss", "simplified"]).optional(),
    collectsFrom: dateString.optional(),
    thresholdMinor: nonNegativeMinor.optional(),
    thresholdCurrency: currency.optional(),
    status: z.enum(["monitoring", "active", "paused", "closed"]),
    acknowledgeTemplateLimitations: z.boolean().default(false),
  }),
  output: taxRegistrationRow,
  handler: async (input, ctx) => {
    const { id, acknowledgeTemplateLimitations, ...values } = input;
    const [zone] = await ctx.tx.select().from(taxZones).where(eq(taxZones.id, input.zoneId)).limit(1);
    if (!zone) throw new ServiceError("not_found", "That tax zone is not here.");
    if (input.status === "active" && zone.templateKey) {
      const definition = taxTemplate(zone.templateKey);
      if (definition?.activationLimitation && !acknowledgeTemplateLimitations) {
        throw new ServiceError(
          "validation",
          `Review required before collection: ${definition.activationLimitation}`,
        );
      }
    }
    if (!id) {
      const thresholdMinor = values.thresholdMinor ?? 0;
      if (thresholdMinor > 0 && !values.thresholdCurrency) {
        throw new ServiceError("validation", "A non-zero tax threshold needs its currency.");
      }
      const [created] = await ctx.tx
        .insert(taxRegistrations)
        .values({
          ...values,
          scheme: values.scheme ?? "standard",
          thresholdMinor,
        })
        .returning();
      ctx.setSubject("taxRegistration", created!.id);
      return created!;
    }
    const [existing] = await ctx.tx
      .select()
      .from(taxRegistrations)
      .where(eq(taxRegistrations.id, id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That tax registration is not here.");
    const thresholdMinor = values.thresholdMinor ?? existing.thresholdMinor;
    const thresholdCurrency = values.thresholdCurrency ?? existing.thresholdCurrency;
    if (thresholdMinor > 0 && !thresholdCurrency) {
      throw new ServiceError("validation", "A non-zero tax threshold needs its currency.");
    }
    const [updated] = await ctx.tx
      .update(taxRegistrations)
      .set(values)
      .where(eq(taxRegistrations.id, id))
      .returning();
    if (!updated) throw new ServiceError("conflict", "That tax registration changed while it was being updated.");
    ctx.setSubject("taxRegistration", updated.id);
    return updated;
  },
});

export const setTaxExemption = defineService({
  name: "invoicing.setTaxExemption",
  summary: "Record a validated customer exemption or reverse-charge decision.",
  kind: "mutation",
  permission: "scoped",
  input: z
    .object({
      id: z.string().uuid().optional(),
      contactId: z.string().uuid(),
      zoneId: z.string().uuid(),
      kind: z.enum(["reseller", "nonprofit", "reverse_charge", "diplomatic"]),
      certificateRef: z.string().trim().max(500).optional(),
      validatedAt: z.coerce.date().optional(),
      expiresAt: z.coerce.date().optional(),
      status: z.enum(["pending", "valid", "expired", "revoked"]),
    })
    .refine((value) => value.status !== "valid" || Boolean(value.validatedAt), {
      message: "A valid exemption needs validation evidence.",
      path: ["validatedAt"],
    })
    .refine(
      (value) => !value.validatedAt || !value.expiresAt || value.expiresAt > value.validatedAt,
      { message: "The exemption cannot expire before validation.", path: ["expiresAt"] },
    ),
  output: taxExemptionRow,
  handler: async (input, ctx) => {
    const { id, ...values } = input;
    const [saved] = id
      ? await ctx.tx.update(taxExemptions).set(values).where(eq(taxExemptions.id, id)).returning()
      : await ctx.tx.insert(taxExemptions).values(values).returning();
    if (!saved) throw new ServiceError("not_found", "That tax exemption is not here.");
    ctx.setSubject("taxExemption", saved.id);
    return saved;
  },
});

export const listTaxThresholds = defineService({
  name: "invoicing.taxThresholds",
  summary: "Report currency-safe issued sales against each configured collection threshold.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    asOf: z.coerce.date().default(() => new Date()),
    window: z.enum(["calendar_year", "rolling_12_months"]).default("calendar_year"),
  }),
  output: z.object({
    thresholds: listed(
      z.object({
        zone: z.object({ id: uuid, name: z.string(), country: z.string() }),
        registration: z.object({
          id: uuid,
          status: z.enum(["monitoring", "active", "paused", "closed"]),
          thresholdMinor: z.number().int(),
          thresholdCurrency: z.string().nullable(),
        }),
        window: z.enum(["calendar_year", "rolling_12_months"]),
        startsAt: z.string(),
        endsAt: z.string(),
        state: z.enum(["not_configured", "reached", "approaching", "below"]),
        grossSalesMinor: z.number().int(),
        refundsMinor: z.number().int(),
        netSalesMinor: z.number().int(),
        transactions: z.number().int(),
        remainingMinor: z.number().int(),
        progressPpm: z.number().int(),
        totalsByCurrency: listed(
          z.object({
            currency: z.string(),
            grossSalesMinor: z.number().int(),
            refundsMinor: z.number().int(),
            transactions: z.number().int(),
          }),
        ),
        explanation: z.string(),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const start = new Date(input.asOf);
    if (input.window === "calendar_year") {
      start.setUTCMonth(0, 1);
      start.setUTCHours(0, 0, 0, 0);
    } else {
      start.setUTCFullYear(start.getUTCFullYear() - 1);
    }
    const registrations = await ctx.tx
      .select({ registration: taxRegistrations, zone: taxZones })
      .from(taxRegistrations)
      .innerJoin(taxZones, eq(taxZones.id, taxRegistrations.zoneId))
      .orderBy(asc(taxZones.country), asc(taxZones.name));

    const rows = [];
    for (const { registration, zone } of registrations) {
      const issued = (
        await ctx.tx
          .select({
            currency: invoices.currency,
            totalMinor: invoices.totalMinor,
            refundedMinor: invoices.refundedMinor,
            status: invoices.status,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.taxZoneId, zone.id),
              gte(invoices.issuedAt, start),
              lte(invoices.issuedAt, input.asOf),
            ),
          )
      ).filter((invoice) => invoice.status !== "void" && invoice.status !== "draft");
      const byCurrency = new Map<string, { gross: number[]; refunds: number[]; transactions: number }>();
      for (const invoice of issued) {
        const bucket = byCurrency.get(invoice.currency) ?? { gross: [], refunds: [], transactions: 0 };
        bucket.gross.push(invoice.totalMinor);
        bucket.refunds.push(invoice.refundedMinor);
        bucket.transactions += 1;
        byCurrency.set(invoice.currency, bucket);
      }
      const totalsByCurrency = [...byCurrency.entries()]
        .map(([currencyCode, bucket]) => ({
          currency: currencyCode,
          grossSalesMinor: sumMinor(bucket.gross, "Tax-threshold gross sales"),
          refundsMinor: sumMinor(bucket.refunds, "Tax-threshold refunds"),
          transactions: bucket.transactions,
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency));
      const selected = totalsByCurrency.find((total) => total.currency === registration.thresholdCurrency);
      const grossSalesMinor = selected?.grossSalesMinor ?? 0;
      const thresholdMinor = registration.thresholdMinor;
      const progressPpm = thresholdMinor
        ? Number(
            (BigInt(Math.min(grossSalesMinor, thresholdMinor)) * 1_000_000n) /
              BigInt(thresholdMinor),
          )
        : 0;
      const state =
        thresholdMinor === 0
          ? "not_configured"
          : grossSalesMinor >= thresholdMinor
            ? "reached"
            : progressPpm >= 800_000
              ? "approaching"
              : "below";
      rows.push({
        zone: { id: zone.id, name: zone.name, country: zone.country },
        registration: {
          id: registration.id,
          status: registration.status,
          thresholdMinor,
          thresholdCurrency: registration.thresholdCurrency,
        },
        window: input.window,
        startsAt: start.toISOString(),
        endsAt: input.asOf.toISOString(),
        state,
        grossSalesMinor,
        refundsMinor: selected?.refundsMinor ?? 0,
        netSalesMinor: grossSalesMinor - (selected?.refundsMinor ?? 0),
        transactions: selected?.transactions ?? 0,
        remainingMinor: Math.max(0, thresholdMinor - grossSalesMinor),
        progressPpm,
        totalsByCurrency,
        explanation:
          thresholdMinor === 0
            ? "No monetary threshold is configured; sales are separated by currency and never combined."
            : "Progress uses gross issued sales in the configured currency. Refunds and transaction count are shown separately because jurisdiction rules differ.",
      });
    }
    return { thresholds: rows };
  },
});

export const quoteTax = defineService({
  name: "invoicing.quoteTax",
  summary: "Calculate an explainable tax quote from location, category, registration, and exemption evidence.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    currency,
    origin: address,
    destination: address,
    contactId: z.string().uuid().optional(),
    items: z.array(z.object({
      id: z.string().trim().min(1).max(200),
      quantityMicros: positiveQuantity,
      unitAmountMinor: nonNegativeMinor,
      discountMinor: nonNegativeMinor.default(0),
      category: categoryCode.default("standard"),
      requiresShipping: z.boolean().default(false),
    })).min(1).max(1_000),
    shippingMinor: nonNegativeMinor.default(0),
    occurredAt: z.coerce.date().default(() => new Date()),
  }),
  output: taxQuote,
  handler: async (input, ctx) => {
    const onDate = input.occurredAt.toISOString().slice(0, 10);
    const zones = await ctx.tx.select().from(taxZones).where(eq(taxZones.active, true));
    const matching = zones
      .filter((zone) => {
        const selected = zone.basis === "origin" ? input.origin : input.destination;
        return (
          zone.country === selected.country &&
          regionMatches(selected.region, zone.regions) &&
          postalMatches(selected.postalCode, zone.postalPatterns)
        );
      })
      .sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority || a.name.localeCompare(b.name));
    const zone = matching[0];
    const request: TaxQuoteRequest = {
      currency: input.currency,
      pricesIncludeTax: zone?.pricesIncludeTax ?? false,
      origin: input.origin,
      destination: input.destination,
      ...(input.contactId ? { customer: { contactId: input.contactId } } : {}),
      items: input.items,
      shippingMinor: input.shippingMinor,
      occurredAt: input.occurredAt.toISOString(),
    };
    if (!zone) {
      return {
        provider: "built_in",
        currency: input.currency,
        lines: [],
        totalTaxMinor: 0,
        includedTaxMinor: 0,
        explanation: ["No active tax zone matches this transaction location."],
        zone: null,
        registration: null,
        exemption: null,
      };
    }
    const [registrations, rateRows, exemptions] = await Promise.all([
      ctx.tx.select().from(taxRegistrations).where(
        and(
          eq(taxRegistrations.zoneId, zone.id),
          eq(taxRegistrations.status, "active"),
          or(isNull(taxRegistrations.collectsFrom), lte(taxRegistrations.collectsFrom, onDate)),
        ),
      ),
      ctx.tx
        .select({ rate: taxRates, categoryCode: taxCategories.code })
        .from(taxRates)
        .leftJoin(taxCategories, eq(taxCategories.id, taxRates.categoryId))
        .where(eq(taxRates.zoneId, zone.id)),
      input.contactId
        ? ctx.tx.select().from(taxExemptions).where(
            and(
              eq(taxExemptions.contactId, input.contactId),
              eq(taxExemptions.zoneId, zone.id),
              eq(taxExemptions.status, "valid"),
              lte(taxExemptions.validatedAt, input.occurredAt),
              or(isNull(taxExemptions.expiresAt), gte(taxExemptions.expiresAt, input.occurredAt)),
            ),
          ).orderBy(desc(taxExemptions.validatedAt), asc(taxExemptions.id))
        : Promise.resolve([]),
    ]);
    const registration = registrations[0];
    if (!registration) {
      return {
        provider: "built_in",
        currency: input.currency,
        lines: [],
        totalTaxMinor: 0,
        includedTaxMinor: 0,
        explanation: [`${zone.name} matched, but the business has no active collection registration for it.`],
        zone: { id: zone.id, name: zone.name },
        registration: null,
        exemption: null,
      };
    }
    const exemption = exemptions[0];
    const ruleSet: TaxRuleSet = {
      zoneId: zone.id,
      zoneName: zone.name,
      pricesIncludeTax: zone.pricesIncludeTax,
      roundingScope: zone.roundingScope,
      roundingMode: zone.roundingMode,
      rules: rateRows
        .filter(({ rate }) => applicableOn(rate, onDate))
        .map(({ rate, categoryCode: code }) => ({
          id: rate.id,
          name: rate.name,
          jurisdiction: rate.jurisdiction,
          ratePpm: rate.ratePpm,
          compound: rate.compound,
          priority: rate.priority,
          appliesToShipping: rate.appliesToShipping,
          ...(code ? { categoryCode: code } : {}),
          ...(registration.number ? { registrationNumber: registration.number } : {}),
        })),
      ...(exemption
        ? {
            exemption: {
              kind: exemption.kind,
              legend:
                exemption.kind === "reverse_charge"
                  ? "Tax not charged — reverse charge applies."
                  : `Tax not charged — valid ${exemption.kind.replace("_", " ")} exemption.`,
            },
          }
        : {}),
    };
    return {
      ...calculateTaxQuote(request, ruleSet),
      zone: { id: zone.id, name: zone.name },
      registration: { id: registration.id, number: registration.number },
      exemption: exemption ? { id: exemption.id, kind: exemption.kind } : null,
    };
  },
});

export default [
  listTaxConfiguration,
  createTaxCategory,
  createTaxZone,
  listTaxTemplates,
  installTaxTemplate,
  addTaxRate,
  setTaxRegistration,
  setTaxExemption,
  listTaxThresholds,
  quoteTax,
];
