// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bookingCommercialSource, registerBookingCommercialSourceResolver } from "@/core/scheduling/commercial-policy";
import { defineService } from "@/core/service";
import { ServiceError } from "@/core/service";
import { bookingCommercialPrice, bookingCommercialSelection } from "@/core/scheduling/commercial-quote";
import { taxCategories } from "@/modules/invoicing/schema";
import { products, serviceOfferings } from "./schema";
import { quoteServicePayment } from "./offerings";

export const resolveBookingCommercialSource = defineService({
  name: "catalog.resolveBookingCommercialSource", summary: "Capture the actual offering product and seller in its new booking transaction.",
  kind: "query", permission: "system", external: false, input: z.object({ offeringId: z.uuid() }), output: bookingCommercialSource.nullable(),
  handler: async ({ offeringId }, ctx) => {
    const [source] = await ctx.tx.select({ serviceOfferingId: serviceOfferings.id, productId: products.id, sellerUserId: products.sellerUserId })
      .from(serviceOfferings).innerJoin(products, eq(products.id, serviceOfferings.productId)).where(eq(serviceOfferings.id, offeringId)).for("share");
    return source ?? null;
  },
});
registerBookingCommercialSourceResolver((ctx, offeringId) => ctx.callAsSystem(resolveBookingCommercialSource, { offeringId }));

export const quoteBookingCommercialSource = defineService({
  name: "catalog.quoteBookingCommercialSource", summary: "Derive an original bookable product's actual price and tax category on the server.",
  kind: "query", permission: "system", external: false,
  input: bookingCommercialSelection.extend({ offeringId: z.uuid(), expectedSellerUserId: z.uuid().nullable(), contactId: z.uuid().nullable(), seats: z.number().int().min(1).max(1000) }),
  output: bookingCommercialPrice,
  handler: async (input, ctx) => {
    const [source] = await ctx.tx.select({ productId: products.id, sellerUserId: products.sellerUserId, category: taxCategories.code })
      .from(serviceOfferings).innerJoin(products, eq(products.id, serviceOfferings.productId))
      .leftJoin(taxCategories, eq(taxCategories.id, products.taxCategoryId)).where(eq(serviceOfferings.id, input.offeringId));
    if (!source || source.sellerUserId !== input.expectedSellerUserId) throw new ServiceError("conflict", "The service's original merchant changed. Review a new agreement before accepting a new price.");
    const quote = await ctx.callAsSystem(quoteServicePayment, { productId: source.productId, currency: input.currency, mode: input.mode, quantity: input.seats, ...(input.contactId ? { contactId: input.contactId } : {}) });
    if (!quote.available) throw new ServiceError("conflict", "The original service is not priced in this currency.");
    return bookingCommercialPrice.parse({ currency: input.currency, mode: input.mode, seats: input.seats, baseAmountMinor: quote.priceMinor, dueNowMinor: quote.dueNowMinor, taxCategoryCode: source.category ?? "standard" });
  },
});
export default [resolveBookingCommercialSource, quoteBookingCommercialSource];
