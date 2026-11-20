// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the server derives money; callers select only currency and a mode.
import { z } from "zod";

export const bookingCommercialSelection = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  mode: z.enum(["full", "deposit_balance"]),
});
export const bookingCommercialPrice = bookingCommercialSelection.extend({
  seats: z.number().int().min(1).max(1000),
  baseAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dueNowMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxCategoryCode: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(80),
}).refine(value => value.dueNowMinor <= value.baseAmountMinor, "The booking deposit exceeds its actual price.");
export type BookingCommercialPrice = z.infer<typeof bookingCommercialPrice>;
