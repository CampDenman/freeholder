// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shipping zones, methods and quotes (MASTER.md §4.11, C5.18).

import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
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

const shippingZoneRow = row({
  id: uuid,
  name: z.string(),
  countries: listed(z.string()),
  regions: listed(z.string()),
  postalPatterns: listed(z.string()),
  priority: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const shippingMethodRow = row({
  id: uuid,
  zoneId: uuid,
  name: z.string(),
  kind: z.enum(SHIPPING_METHOD_KINDS),
  handlingFeeMinor: z.number().int(),
  amountMinor: z.number().int().nullable(),
  thresholdMinor: z.number().int().nullable(),
  minDays: z.number().int().nullable(),
  maxDays: z.number().int().nullable(),
  taxable: z.boolean(),
  locationId: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const shippingRateBandRow = row({
  id: uuid,
  methodId: uuid,
  minValue: z.number().int(),
  maxValue: z.number().int().nullable(),
  amountMinor: z.number().int(),
  perUnitMinor: z.number().int(),
});
const packagingBoxRow = row({
  id: uuid,
  name: z.string(),
  innerLengthMm: z.number().int(),
  innerWidthMm: z.number().int(),
  innerHeightMm: z.number().int(),
  maxWeightG: z.number().int(),
  tareWeightG: z.number().int(),
  createdAt: timestamp,
});
const deliveryWindowRow = row({
  id: uuid,
  locationId: uuid,
  onDate: timestamp.nullable(),
  starts: z.string(),
  ends: z.string(),
  capacity: z.number().int(),
  cutoffHours: z.number().int(),
  createdAt: timestamp,
});
const shippingQuoteRow = row({
  methodId: uuid,
  name: z.string(),
  kind: z.enum(SHIPPING_METHOD_KINDS),
  amountMinor: z.number().int(),
  currency: z.string(),
  minDays: z.number().int().nullable(),
  maxDays: z.number().int().nullable(),
  billableWeightG: z.number().int(),
  boxId: uuid.nullable(),
});

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
  output: shippingZoneRow,
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
  output: listed(shippingZoneRow),
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
  output: shippingMethodRow,
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
  output: shippingRateBandRow,
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
  output: packagingBoxRow,
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
  output: deliveryWindowRow,
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
  output: z.object({
    zones: listed(shippingZoneRow),
    methods: listed(shippingMethodRow),
    bands: listed(shippingRateBandRow),
    boxes: listed(packagingBoxRow),
    windows: listed(deliveryWindowRow),
  }),
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
  output: z.object({
    needed: z.boolean(),
    zoneId: uuid.nullable(),
    quotes: listed(shippingQuoteRow),
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
