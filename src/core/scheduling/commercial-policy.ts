// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Optional member commerce captures actual ownership in the booking transaction.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type ServiceContext } from "@/core/service";

import { bookingCommercialSources, bookings } from "./schema";

export const bookingCommercialSource = z.object({ serviceOfferingId: z.uuid(), productId: z.uuid(), sellerUserId: z.uuid().nullable() });
let resolve: ((ctx: ServiceContext, offeringId: string) => Promise<z.infer<typeof bookingCommercialSource> | null>) | undefined;
export function registerBookingCommercialSourceResolver(next: NonNullable<typeof resolve>): void { resolve = next; }

export const bookingTaxDestination = z.object({ country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  region: z.string().trim().min(1).max(200).optional(), postalCode: z.string().trim().min(1).max(40).optional(), city: z.string().trim().min(1).max(200).optional() }).strict();
export type BookingCommercialCapture = { bookingId: string; rescheduledFromId?: string; taxDestination?: z.infer<typeof bookingTaxDestination>; commercialQuoteDigest?: string };
let capture: ((ctx: ServiceContext, input: BookingCommercialCapture) => Promise<void>) | undefined;

export function registerBookingCommercialCapture(next: NonNullable<typeof capture>): void { capture = next; }
export async function captureBookingCommercialPolicy(ctx: ServiceContext, input: BookingCommercialCapture): Promise<void> {
  const [booking] = await ctx.tx.select().from(bookings).where(eq(bookings.id, input.bookingId));
  if (!booking) throw new ServiceError("conflict", "The new booking source is missing.");
  if (booking.marketPolicyVersion === 0 || !booking.serviceOfferingId) return;
  const [existing] = await ctx.tx.select().from(bookingCommercialSources).where(eq(bookingCommercialSources.bookingId, booking.id));
  if (existing) return;
  let source: z.infer<typeof bookingCommercialSource>;
  if (input.rescheduledFromId) {
    const [original] = await ctx.tx.select().from(bookingCommercialSources).where(eq(bookingCommercialSources.bookingId, input.rescheduledFromId));
    if (!original) return; // Preserve an unpriced external/unknown source; never guess a new owner.
    source = bookingCommercialSource.parse(original);
  } else {
    const supplied = await resolve?.(ctx, booking.serviceOfferingId);
    if (!supplied) return; // Core calendars may reference a non-catalog offering without billing it.
    source = bookingCommercialSource.parse(supplied);
  }
  if (source.serviceOfferingId !== booking.serviceOfferingId) throw new ServiceError("conflict", "This booking does not match its original service offering.");
  await ctx.tx.insert(bookingCommercialSources).values({ bookingId: booking.id, ...source });
  if (source.sellerUserId && !capture) throw new ServiceError("conflict", "The member service's original commercial policy is unavailable.");
  await capture?.(ctx, input);
}
