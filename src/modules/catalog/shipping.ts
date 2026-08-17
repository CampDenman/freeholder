// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shipping zones, methods and quotes (MASTER.md §4.11, C5.18).

import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { decimalToMinor } from "@/adapters/payments/currency";
import { defineService, ServiceError } from "@/core/service";
import { SHIPPING_METHOD_KINDS } from "./contract";
import { quoteMethods } from "./shipping-quote";
import {
  deliveryWindows,
  packagingBoxes,
  shippingMethods,
  shippingRateBands,
  shippingZones,
} from "./schema";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

export const createShippingZone = defineService({
  name: "catalog.createShippingZone",
  summary: "Add a destination zone matched most-specific-first.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    countries: z.array(z.string().trim().toUpperCase().length(2)).default([]),
    regions: z.array(z.string().trim().min(1).max(40)).default([]),
    postalPatterns: z.array(z.string().trim().min(1).max(40)).default([]),
    priority: z.number().int().min(0).max(10_000).default(0),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.insert(shippingZones).values(input).returning();
    ctx.setSubject("shippingZone", row!.id);
    return row!;
  },
});

export const listShippingZones = defineService({
  name: "catalog.listShippingZones",
  summary: "Every shipping zone, highest priority first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: (_input, ctx) =>
    ctx.tx.select().from(shippingZones).orderBy(asc(shippingZones.priority), asc(shippingZones.name)),
});

export const createShippingMethod = defineService({
  name: "catalog.createShippingMethod",
  summary: "Add a shipping method to a zone.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    zoneId: id,
    name: z.string().trim().min(1).max(80),
    kind: z.enum(SHIPPING_METHOD_KINDS),
    currency,
    handlingFee: z.string().trim().optional(),
    amount: z.string().trim().optional(),
    threshold: z.string().trim().optional(),
    minDays: z.number().int().min(0).max(365).optional(),
    maxDays: z.number().int().min(0).max(365).optional(),
    locationId: id.optional(),
  }),
  handler: async (input, ctx) => {
    const [zone] = await ctx.tx.select({ id: shippingZones.id }).from(shippingZones).where(eq(shippingZones.id, input.zoneId));
    if (!zone) throw new ServiceError("not_found", "That shipping zone is not here.");
    if ((input.kind === "pickup" || input.kind === "local_delivery") && !input.locationId) {
      throw new ServiceError("validation", "Pickup and local delivery need a location.");
    }
    const [row] = await ctx.tx
      .insert(shippingMethods)
      .values({
        zoneId: input.zoneId,
        name: input.name,
        kind: input.kind,
        handlingFeeMinor: input.handlingFee ? decimalToMinor(input.handlingFee, input.currency) : 0,
        amountMinor: input.amount ? decimalToMinor(input.amount, input.currency) : null,
        thresholdMinor: input.threshold ? decimalToMinor(input.threshold, input.currency) : null,
        minDays: input.minDays ?? null,
        maxDays: input.maxDays ?? null,
        locationId: input.locationId ?? null,
      })
      .returning();
    ctx.setSubject("shippingMethod", row!.id);
    return row!;
  },
});

export const addShippingRateBand = defineService({
  name: "catalog.addShippingRateBand",
  summary: "Add a weight, price or item band to a method.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    methodId: id,
    currency,
    minValue: z.number().int().min(0),
    maxValue: z.number().int().min(0).optional(),
    amount: z.string().trim(),
    perUnit: z.string().trim().optional(),
  }),
  handler: async (input, ctx) => {
    const [method] = await ctx.tx.select().from(shippingMethods).where(eq(shippingMethods.id, input.methodId));
    if (!method) throw new ServiceError("not_found", "That shipping method is not here.");
    const [row] = await ctx.tx
      .insert(shippingRateBands)
      .values({
        methodId: input.methodId,
        minValue: input.minValue,
        maxValue: input.maxValue ?? null,
        amountMinor: decimalToMinor(input.amount, input.currency),
        perUnitMinor: input.perUnit ? decimalToMinor(input.perUnit, input.currency) : 0,
      })
      .returning();
    ctx.setSubject("shippingMethod", input.methodId);
    return row!;
  },
});

export const createPackagingBox = defineService({
  name: "catalog.createPackagingBox",
  summary: "Record a box used for dimensional-weight quotes.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    innerLengthMm: z.number().int().min(1),
    innerWidthMm: z.number().int().min(1),
    innerHeightMm: z.number().int().min(1),
    maxWeightG: z.number().int().min(1),
    tareWeightG: z.number().int().min(0).default(0),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.insert(packagingBoxes).values(input).returning();
    ctx.setSubject("packagingBox", row!.id);
    return row!;
  },
});

export const createDeliveryWindow = defineService({
  name: "catalog.createDeliveryWindow",
  summary: "Add a pickup or local-delivery window at a location.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    locationId: id,
    starts: z.string().regex(/^\d{2}:\d{2}$/),
    ends: z.string().regex(/^\d{2}:\d{2}$/),
    capacity: z.number().int().min(1).max(10_000).default(1),
    cutoffHours: z.number().int().min(0).max(72).default(2),
  }),
  handler: async (input, ctx) => {
    if (input.ends <= input.starts) {
      throw new ServiceError("validation", "A delivery window must end after it starts.");
    }
    const [row] = await ctx.tx.insert(deliveryWindows).values(input).returning();
    ctx.setSubject("deliveryWindow", row!.id);
    return row!;
  },
});

export const listShippingCatalog = defineService({
  name: "catalog.listShippingCatalog",
  summary: "Zones, methods, bands, boxes and windows for the owner workspace.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const [zones, methods, bands, boxes, windows] = await Promise.all([
      ctx.tx.select().from(shippingZones).orderBy(asc(shippingZones.priority)),
      ctx.tx.select().from(shippingMethods).orderBy(asc(shippingMethods.name)),
      ctx.tx.select().from(shippingRateBands).orderBy(asc(shippingRateBands.minValue)),
      ctx.tx.select().from(packagingBoxes).orderBy(asc(packagingBoxes.name)),
      ctx.tx.select().from(deliveryWindows).orderBy(asc(deliveryWindows.starts)),
    ]);
    return { zones, methods, bands, boxes, windows };
  },
});

export const quoteShipping = defineService({
  name: "catalog.quoteShipping",
  summary: "Quote every matching method for a destination and parcel.",
  kind: "query",
  permission: "public",
  input: z.object({
    country: z.string().trim().length(2).toUpperCase(),
    region: z.string().trim().max(40).optional(),
    postal: z.string().trim().max(16).optional(),
    currency,
    locationId: id.optional(),
    items: z
      .array(
        z.object({
          quantity: z.number().int().min(1),
          weightG: z.number().int().min(0),
          priceMinor: z.number().int().min(0),
          lengthMm: z.number().int().min(1).optional(),
          widthMm: z.number().int().min(1).optional(),
          heightMm: z.number().int().min(1).optional(),
          requiresShipping: z.boolean().optional(),
        }),
      )
      .min(1),
  }),
  handler: async (input, ctx) => {
    const [zones, methods, bands, boxes] = await Promise.all([
      ctx.tx.select().from(shippingZones),
      ctx.tx.select().from(shippingMethods),
      ctx.tx.select().from(shippingRateBands),
      ctx.tx.select().from(packagingBoxes),
    ]);
    return quoteMethods({
      destination: { country: input.country, region: input.region, postal: input.postal },
      currency: input.currency,
      locationId: input.locationId,
      items: input.items,
      zones,
      methods: methods.map((method) => ({
        ...method,
        bands: bands.filter((band) => band.methodId === method.id),
      })),
      boxes,
    });
  },
});

export default [
  createShippingZone,
  listShippingZones,
  createShippingMethod,
  addShippingRateBand,
  createPackagingBox,
  createDeliveryWindow,
  listShippingCatalog,
  quoteShipping,
];
