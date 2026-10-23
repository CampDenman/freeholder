// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: "a day" on the booking page is the business's day.
//
// `scheduling.slots` reads `from`/`to` in each calendar's own zone, which is
// right for building that calendar's windows. A customer, though, picks a
// date on the business's calendar, and a calendar in another zone puts some
// of that day's times on its previous or next date. So a business day is
// asked as the calendar days either side of it and then cut back to the
// instants the business's clock dates to it.
import { addDays, periodKey, zonedDate } from "@/core/i18n/zoned";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` naming a day that exists: 2026-02-31 does not. */
export function isCalendarDate(value: string | undefined): value is string {
  const match = ISO_DATE.exec(value ?? "");
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

/** The calendar dates that can hold any instant of a business date, in any zone. */
export function aroundBusinessDay(date: string): { from: string; to: string } {
  return {
    from: periodKey(addDays(parts(date), -1), "day"),
    to: periodKey(addDays(parts(date), 1), "day"),
  };
}

/** The business date an instant falls on. */
export function businessDate(instant: Date, zone: string): string {
  return periodKey(zonedDate(instant, zone), "day");
}

/** Only the slots the business's clock dates to `date`. */
export function onBusinessDay<T extends { startsAt: Date }>(
  slots: readonly T[],
  date: string,
  zone: string,
): T[] {
  return slots.filter((slot) => businessDate(slot.startsAt, zone) === date);
}
