// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Turning a wall-clock reading into an instant (MASTER.md §4.9).
//
// Everything is stored in UTC, which makes "midnight on Tuesday" a question
// rather than a value: in the business's timezone it is a different instant in
// March than in July, and on the day a clock changes the day itself is 23 or
// 25 hours long. Laying a week out on screen needs the real boundaries, or
// twice a year every block on that day is drawn an hour out.
//
// `Intl` is the only correct source for this in the platform, so both helpers
// are built on it rather than on an offset somebody typed into a setting.

/** How far ahead of UTC a zone is at a given instant, in milliseconds. */
export function zoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which a zone's clock reads this date and time.
 *
 * Two passes, because the offset that converts the answer is the offset *at*
 * the answer, not at the guess — an hour apart across a clock change.
 *
 * An hour the clock skipped has no instant at all, and some zones skip
 * midnight itself. The second pass answers such a request with a time before
 * the gap, which would draw a day starting an hour early; the read-back check
 * catches exactly that case and takes the instant after the gap instead — the
 * same resolution every other serious date library makes. An hour the clock
 * repeated has two instants, and this returns the first of them.
 */
export function zonedInstant(
  timezone: string,
  parts: { year: number; month: number; day: number; hour?: number; minute?: number },
): Date {
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
  );
  const first = new Date(wall - zoneOffsetMs(new Date(wall), timezone));
  const second = new Date(wall - zoneOffsetMs(first, timezone));
  const reads = wall - zoneOffsetMs(second, timezone) === second.getTime();
  return reads ? second : first;
}

/** The calendar date a zone was showing at an instant, as `{year, month, day}`. */
export function zonedDate(
  instant: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: read("year"), month: read("month"), day: read("day") };
}

/** The same calendar date, moved by whole days, with no zone involved yet. */
export function addDays(
  date: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}
