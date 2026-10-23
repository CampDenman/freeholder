// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: which day /book (and the embed, and ?move= rescheduling) shows, and
// the times on it.
import { addDays, periodKey, zonedDate } from "@/core/i18n/zoned";
import {
  aroundBusinessDay,
  businessDate,
  isCalendarDate,
  onBusinessDay,
} from "@/core/scheduling/business-day";

/** The first, cheap look for a free day. Most services have one this week. */
export const FIRST_LOOK_DAYS = 7;
/**
 * How far ahead /book looks before giving up. Inside the slot service's own
 * range limit (62 days, plus the day before today); each calendar's booking
 * horizon still trims the answer, because the resolver applies it.
 */
export const OPENING_WINDOW_DAYS = 60;
/** How long an anonymous visitor's opening date is reused. */
export const OPENING_CACHE_MS = 60_000;
const CACHE_LIMIT = 1_000;

// Keyed by service, seller and party size only — never by who is asking —
// and only ever filled for anonymous visitors, whose audience is the public
// one. A fully booked service then costs one 60-day scan a minute rather than
// one per page view.
const cache = new Map<string, { date: string; expires: number }>();

export function resetOpeningDateCache(): void {
  cache.clear();
}

function remember(key: string, date: string, now: number): void {
  cache.delete(key);
  cache.set(key, { date, expires: now + OPENING_CACHE_MS });
  if (cache.size <= CACHE_LIMIT) return;
  for (const [stale, entry] of cache) if (entry.expires <= now) cache.delete(stale);
  // Still full of live entries: drop the oldest.
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/**
 * The date /book shows first.
 *
 * A real `?date=` always wins. Otherwise the page opens on the first business
 * day with a time free, so a visitor's first sight is a list of times rather
 * than "no times on this date". "Today" is the business's today, not UTC's: an
 * evening visitor in Pacific time would otherwise land on tomorrow. The search
 * looks at a week first and only then at the whole window; with nothing free,
 * or if the search fails, the page opens on today and says so as before.
 *
 * `firstSlot` is one ranged ask of the slot service for the earliest free
 * time between two calendar dates, both inclusive.
 */
export async function openingDate(options: {
  requested?: string;
  zone: string;
  firstSlot?: (from: string, to: string) => Promise<{ startsAt: Date } | undefined>;
  now?: Date;
  /** Who-independent identity of the question, to reuse the answer briefly. */
  cacheKey?: string;
}): Promise<string> {
  const { requested, zone, firstSlot } = options;
  if (isCalendarDate(requested)) return requested;
  const now = options.now ?? new Date();
  const today = zonedDate(now, zone);
  const todayKey = periodKey(today, "day");
  if (!firstSlot) return todayKey;
  const key = options.cacheKey ? `${options.cacheKey}|${zone}|${todayKey}` : undefined;
  const hit = key ? cache.get(key) : undefined;
  if (hit && hit.expires > now.getTime()) return hit.date;

  // A calendar in a zone behind the business holds the start of the
  // business's today on its own yesterday.
  const from = periodKey(addDays(today, -1), "day");
  const upTo = (days: number) => periodKey(addDays(today, days - 1), "day");
  let failed = false;
  const ask = (to: string) =>
    firstSlot(from, to).catch(() => {
      failed = true;
      return undefined;
    });
  const slot = (await ask(upTo(FIRST_LOOK_DAYS))) ?? (failed ? undefined : await ask(upTo(OPENING_WINDOW_DAYS)));
  const found = slot ? businessDate(slot.startsAt, zone) : todayKey;
  const date = found < todayKey ? todayKey : found;
  if (key && !failed) remember(key, date, now.getTime());
  return date;
}

export interface SlotQuery {
  productId: string;
  serviceOfferingId: string;
  seats: number;
  excludeBookingId?: string;
}

/**
 * The page's wiring: the day to show and the times on it, from the one slot
 * service. A move (`?move=`) asks with the booking excluded, so its own time
 * reads as free, and is never cached because the answer is that customer's.
 */
export async function bookingDay<S extends { startsAt: Date }>(options: {
  requested?: string;
  zone: string;
  service: { productId: string; offeringId: string } | null | undefined;
  seats: number;
  move?: string;
  seller?: string;
  anonymous: boolean;
  search: (input: SlotQuery & { from: string; to: string; limit: number }) => Promise<S[]>;
  now?: Date;
}): Promise<{ date: string; slots: S[]; unavailable: boolean }> {
  const { service, zone, search } = options;
  const query: SlotQuery | null = service
    ? {
        productId: service.productId,
        serviceOfferingId: service.offeringId,
        seats: options.seats,
        ...(options.move ? { excludeBookingId: options.move } : {}),
      }
    : null;
  const date = await openingDate({
    requested: options.requested,
    zone,
    now: options.now,
    firstSlot: query ? async (from, to) => (await search({ ...query, from, to, limit: 1 }))[0] : undefined,
    cacheKey:
      query && options.anonymous && !options.move
        ? `${query.serviceOfferingId}|${query.productId}|seller:${options.seller ?? "-"}|seats:${query.seats}`
        : undefined,
  });
  if (!query) return { date, slots: [], unavailable: false };
  try {
    const slots = await search({ ...query, ...aroundBusinessDay(date), limit: 500 });
    return { date, slots: onBusinessDay(slots, date, zone), unavailable: false };
  } catch {
    return { date, slots: [], unavailable: true };
  }
}
