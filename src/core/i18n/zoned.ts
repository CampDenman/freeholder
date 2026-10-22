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
  // Against the whole second, because the formatted reading has no
  // milliseconds: otherwise an instant at .500 reports an offset half a
  // second off, and two readings of the same offset compare unequal.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a zone's clock reads this date and time.
 *
 * Two passes, because the offset that converts the answer is the offset *at*
 * the answer, not at the guess — an hour apart across a clock change.
 *
 * An hour the clock skipped has no instant at all, and some zones skip
 * midnight itself. One of the two passes answers such a request with a time
 * before the gap, which would draw a day starting an hour early; the read-back
 * check catches exactly that case and takes the instant after the gap instead
 * — the same resolution every other serious date library makes. An hour the clock
 * repeated has two instants: this returns the first of them unless the caller
 * deliberately asks for the `later` one.
 */
export function zonedInstant(
  timezone: string,
  parts: { year: number; month: number; day: number; hour?: number; minute?: number },
  options: { repeated?: "earlier" | "later" } = {},
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
  // In a gap the two passes straddle it, one reading an offset early and one
  // an offset late. Which pass is which depends on whether the zone is behind
  // or ahead of UTC, so take the later instant rather than a named pass: the
  // reading after the gap, in New York and in Sydney alike.
  if (!reads) return first.getTime() > second.getTime() ? first : second;
  const chosen = second;
  // A repeated hour reads correctly at two instants, an offset change apart
  // (an hour almost everywhere, thirty minutes on Lord Howe Island). Look
  // either side of the one found and pick deliberately.
  const readings = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
    .map((halfHours) => new Date(chosen.getTime() + halfHours * 1_800_000))
    .filter((each) => wall - zoneOffsetMs(each, timezone) === each.getTime());
  return options.repeated === "later" ? readings[readings.length - 1]! : readings[0]!;
}

/** What a zone's clock read at an instant, to the minute. */
export function zonedWallTime(
  instant: Date,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const wall = new Date(instant.getTime() + zoneOffsetMs(instant, timezone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
  };
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

/* ------------------------------------------------------- local periods */
//
// The rule (MASTER.md §4.9): **local-time math lives in Node; SQL sees UTC
// instants.** Postgres and Node each carry their own copy of the tz database,
// updated on different schedules — a managed database can lag a zone's rule
// change by months. A day bucket computed with `AT TIME ZONE` in a query and a
// time rendered with `Intl` on the page then disagree by an hour. So every
// "which local day, week or month is this" question is answered here, and a
// query only ever compares stored instants with the boundaries returned.

export type LocalPeriod = "day" | "week" | "month" | "quarter";

type CalendarDate = { year: number; month: number; day: number };

/** The first date of the period containing `date`. Weeks start Monday (ISO). */
export function startOfPeriod(date: CalendarDate, unit: LocalPeriod): CalendarDate {
  switch (unit) {
    case "day":
      return { ...date };
    case "week": {
      const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
      return addDays(date, -((weekday + 6) % 7));
    }
    case "month":
      return { year: date.year, month: date.month, day: 1 };
    case "quarter":
      return { year: date.year, month: date.month - ((date.month - 1) % 3), day: 1 };
  }
}

/** A period start moved by whole periods, still with no zone involved. */
export function addPeriods(date: CalendarDate, unit: LocalPeriod, count: number): CalendarDate {
  if (unit === "day") return addDays(date, count);
  if (unit === "week") return addDays(date, count * 7);
  const months = unit === "month" ? count : count * 3;
  const moved = new Date(Date.UTC(date.year, date.month - 1 + months, date.day));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` for a day or week, `YYYY-MM` for a month or quarter. */
export function periodKey(date: CalendarDate, unit: LocalPeriod): string {
  return unit === "day" || unit === "week"
    ? `${date.year}-${pad(date.month)}-${pad(date.day)}`
    : `${date.year}-${pad(date.month)}`;
}

export interface LocalBucket {
  key: string;
  /** The instant the local period begins (inclusive). */
  start: Date;
  /** The instant the next local period begins (exclusive). */
  end: Date;
}

/** The local period containing an instant, as UTC boundaries. */
export function localPeriodOf(instant: Date, timezone: string, unit: LocalPeriod): LocalBucket {
  const first = startOfPeriod(zonedDate(instant, timezone), unit);
  return {
    key: periodKey(first, unit),
    start: zonedInstant(timezone, first),
    end: zonedInstant(timezone, addPeriods(first, unit, 1)),
  };
}

/**
 * Every local period overlapping `[from, to)`, oldest first, each with its UTC
 * boundaries. The day a clock changes is 23 or 25 hours long here, as it is on
 * the wall, without asking Postgres what time it is anywhere.
 */
export function localBuckets(
  timezone: string,
  from: Date,
  to: Date,
  unit: LocalPeriod,
): LocalBucket[] {
  const buckets: LocalBucket[] = [];
  let cursor = startOfPeriod(zonedDate(from, timezone), unit);
  let start = zonedInstant(timezone, cursor);
  while (start.getTime() < to.getTime()) {
    const next = addPeriods(cursor, unit, 1);
    const end = zonedInstant(timezone, next);
    buckets.push({ key: periodKey(cursor, unit), start, end });
    cursor = next;
    start = end;
  }
  return buckets;
}

/** Whole months from one `YYYY-MM` key to another. */
export function monthsBetween(fromKey: string, toKey: string): number {
  const [fromYear, fromMonth] = fromKey.split("-").map(Number);
  const [toYear, toMonth] = toKey.split("-").map(Number);
  return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
}

/** True when `Intl` — the zone source every local-time answer comes from — knows this zone. */
export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first instant after `from` at which the zone's offset changes, to the
 * minute, or null when it does not change within `horizonDays`. Scans a day
 * at a time, then halves the last day down to the minute.
 */
export function nextOffsetChange(
  from: Date,
  timezone: string,
  horizonDays = 400,
): Date | null {
  const DAY = 86_400_000;
  const base = zoneOffsetMs(from, timezone);
  let low = from.getTime();
  for (let day = 1; day <= horizonDays; day += 1) {
    const high = from.getTime() + day * DAY;
    if (zoneOffsetMs(new Date(high), timezone) === base) {
      low = high;
      continue;
    }
    let upper = high;
    while (upper - low > 60_000) {
      const middle = low + Math.floor((upper - low) / 2);
      if (zoneOffsetMs(new Date(middle), timezone) === base) low = middle;
      else upper = middle;
    }
    const minute = Math.floor(upper / 60_000) * 60_000;
    return zoneOffsetMs(new Date(minute), timezone) === base
      ? new Date(minute + 60_000)
      : new Date(minute);
  }
  return null;
}
