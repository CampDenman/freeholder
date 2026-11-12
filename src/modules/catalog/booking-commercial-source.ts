// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bookingCommercialSource, registerBookingCommercialSourceResolver } from "@/core/scheduling/commercial-policy";
import { defineService } from "@/core/service";
import { products, serviceOfferings } from "./schema";

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
export default [resolveBookingCommercialSource];
