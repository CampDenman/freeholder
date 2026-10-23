// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: the day /book opens on when the address names none.
import { addDays, periodKey, zonedDate } from "@/core/i18n/zoned";

/**
 * How far ahead /book looks for a first free day. Inside the slot service's
 * own range limit (62 days); each calendar's booking horizon still trims the
 * answer, because the resolver applies it.
 */
export const OPENING_WINDOW_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date /book shows first.
 *
 * An explicit `?date=` always wins. Otherwise the page opens on the first
 * day inside the window with a time free, so a visitor's first sight is a
 * list of times rather than "no times on this date". "Today" is the
 * business's today, not the server's UTC one: an evening visitor in Pacific
 * time would otherwise land on tomorrow. With nothing free in the window, or
 * if the search itself fails, the page opens on today and says so as before.
 *
 * `firstSlot` is one ranged ask of the slot service for the earliest free
 * time between two dates (both inclusive, in the business's calendar).
 */
export async function openingDate(
  requested: string | undefined,
  zone: string,
  firstSlot?: (from: string, to: string) => Promise<{ startsAt: Date } | undefined>,
  now: Date = new Date(),
): Promise<string> {
  if (requested && ISO_DATE.test(requested)) return requested;
  const today = zonedDate(now, zone);
  const from = periodKey(today, "day");
  if (!firstSlot) return from;
  const to = periodKey(addDays(today, OPENING_WINDOW_DAYS - 1), "day");
  const slot = await firstSlot(from, to).catch(() => undefined);
  if (!slot) return from;
  const found = periodKey(zonedDate(slot.startsAt, zone), "day");
  // A slot dated before today (a calendar in another zone) is not a reason
  // to open on yesterday.
  return found < from ? from : found;
}
