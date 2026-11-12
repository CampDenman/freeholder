// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The buyer's declared destination has its own role and retention protection.
import { eq, inArray, sql } from "drizzle-orm";
import { bookingCommercialSources, bookings } from "@/core/scheduling/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { bookingMerchantScopes } from "./booking-merchant-schema";

registerContactPrivacySource({
  scope: "contact.bookingMerchantTax", tables: ["booking_merchant_scopes", "booking_commercial_sources"], retentionScopes: ["contact.bookings", "commerce.money"], eraseOrder: 5,
  exportData: async (tx, contactId) => ({
    destinations: await tx.select({ bookingId: bookingMerchantScopes.bookingId, taxDestination: bookingMerchantScopes.taxDestination, quoteDigest: bookingMerchantScopes.quoteDigest })
      .from(bookingMerchantScopes).innerJoin(bookings, eq(bookings.id, bookingMerchantScopes.bookingId)).where(eq(bookings.contactId, contactId)),
    originalSources: await tx.select({ source: bookingCommercialSources }).from(bookingCommercialSources).innerJoin(bookings, eq(bookings.id, bookingCommercialSources.bookingId)).where(eq(bookings.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    const changed = await tx.update(bookingMerchantScopes).set({ taxDestination: {}, destinationErasedAt: sql`coalesce(${bookingMerchantScopes.destinationErasedAt},now())` })
      .where(inArray(bookingMerchantScopes.bookingId, tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.contactId, contactId)))).returning({ id: bookingMerchantScopes.bookingId });
    return { affected: changed.length };
  },
});
