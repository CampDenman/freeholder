// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What may be booked on a calendar (MASTER.md §4.4, C6.02).
//
// §4.4: "Availability is **computed, never stored**." So nothing here caches a
// slot. What it does is turn the two things an owner actually writes — a weekly
// pattern, and the days that break it — into concrete open windows for a date
// range, which is the input the resolver (C6.03) subtracts bookings from.
//
// Two rules decide every awkward case:
//
// **An exception always wins over a rule** for the days it covers. An owner
// writing "closed the 24th to the 2nd" has said something more specific than
// their Tuesday hours, and a resolver that merged the two would open on
// Christmas Day.
//
// **A window is an instant range, not a clock reading.** Hours are stored as
// local times because that is how they are written and how they should survive
// a clock change, and they are resolved against the calendar's own zone at the
// moment they are asked for.
import { and, asc, eq, lte, gte, or, isNull, sql } from "drizzle-orm";
import { zonedInstant } from "@/core/i18n/zoned";
import {
  availabilityExceptions,
  availabilityRules,
  type AVAILABILITY_KINDS,
} from "@/core/scheduling/schema";
import type { Tx } from "@/core/service";

export interface OpenWindow {
  startsAt: Date;
  endsAt: Date;
  kind: (typeof AVAILABILITY_KINDS)[number];
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseDate(value: string): CalendarDate {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

function isoDate(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** `09:30:00` → minutes past local midnight. */
function minutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number) as [number, number];
  return hour * 60 + minute;
}

/**
 * Every day between two dates, inclusive, as calendar dates.
 *
 * Calendar arithmetic rather than adding 24 hours, because two days a year one
 * of those is not the other.
 */
function daysBetween(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const found: CalendarDate[] = [];
  const end = Date.UTC(to.year, to.month - 1, to.day);
  for (
    let cursor = Date.UTC(from.year, from.month - 1, from.day);
    cursor <= end && found.length < 400;
    cursor += 86_400_000
  ) {
    const at = new Date(cursor);
    found.push({
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      day: at.getUTCDate(),
    });
  }
  return found;
}

/** The weekday a date falls on, 0 = Sunday, with no zone involved. */
function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * When a calendar is open between two dates.
 *
 * Returns instant ranges in chronological order, merged where a day's windows
 * touch. `onDate` bounds are the calendar's own local dates, because "the week
 * of the 14th" means the same thing to the person reading the diary as to the
 * person keeping it.
 */
export async function openWindows(
  tx: Tx,
  input: {
    calendarId: string;
    timezone: string;
    /** Inclusive local dates, `YYYY-MM-DD`. */
    from: string;
    to: string;
    /** Which hours count. Booking pages ask for `bookable` and nothing else. */
    kinds?: readonly (typeof AVAILABILITY_KINDS)[number][];
  },
): Promise<OpenWindow[]> {
  const kinds = input.kinds ?? (["bookable"] as const);
  const from = parseDate(input.from);
  const to = parseDate(input.to);
  const days = daysBetween(from, to);
  if (days.length === 0) return [];

  const rules = await tx
    .select()
    .from(availabilityRules)
    .where(
      and(
        eq(availabilityRules.calendarId, input.calendarId),
        sql`${availabilityRules.kind} = any(${sql.param([...kinds])})`,
        // A rule that stopped applying before the range began, or starts
        // after it ends, cannot contribute a window to it.
        or(
          isNull(availabilityRules.effectiveFrom),
          lte(availabilityRules.effectiveFrom, input.to),
        ),
        or(
          isNull(availabilityRules.effectiveTo),
          gte(availabilityRules.effectiveTo, input.from),
        ),
      ),
    )
    .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.starts));

  const exceptions = await tx
    .select()
    .from(availabilityExceptions)
    .where(
      and(
        eq(availabilityExceptions.calendarId, input.calendarId),
        lte(availabilityExceptions.startsOn, input.to),
        gte(availabilityExceptions.endsOn, input.from),
      ),
    )
    .orderBy(asc(availabilityExceptions.startsOn));

  const windows: OpenWindow[] = [];
  for (const day of days) {
    const key = isoDate(day);
    const covering = exceptions.filter(
      (exception) => exception.startsOn <= key && exception.endsOn >= key,
    );

    // Closed wins outright, and wins over an `open` exception on the same day:
    // an owner who wrote both has said one thing that shuts the day and one
    // that opens part of it, and the safe reading of a contradiction about
    // being open is the one that does not take a booking.
    if (covering.some((exception) => exception.kind === "closed")) continue;

    // Anything else specific to this day replaces the pattern entirely, which
    // is what "override" means. `reduced` and `open` differ only in intent.
    const specific = covering.filter((exception) => exception.kind !== "closed");
    const spans =
      specific.length > 0
        ? specific.map((exception) => ({
            from: minutes(exception.starts!),
            to: minutes(exception.ends!),
            kind: "bookable" as const,
          }))
        : rules
            .filter((rule) => rule.weekday === weekdayOf(day))
            .filter(
              (rule) =>
                (!rule.effectiveFrom || rule.effectiveFrom <= key) &&
                (!rule.effectiveTo || rule.effectiveTo >= key),
            )
            .map((rule) => ({
              from: minutes(rule.starts),
              to: minutes(rule.ends),
              kind: rule.kind,
            }));

    for (const span of spans) {
      windows.push({
        startsAt: zonedInstant(input.timezone, {
          ...day,
          hour: Math.floor(span.from / 60),
          minute: span.from % 60,
        }),
        endsAt: zonedInstant(input.timezone, {
          ...day,
          hour: Math.floor(span.to / 60),
          minute: span.to % 60,
        }),
        kind: span.kind,
      });
    }
  }

  windows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  // Two rules that meet at noon are one window from nine to five. Merging here
  // means the resolver never has to notice the difference, and a slot that
  // straddled the join is not lost.
  const merged: OpenWindow[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && last.kind === window.kind && window.startsAt <= last.endsAt) {
      if (window.endsAt > last.endsAt) last.endsAt = window.endsAt;
      continue;
    }
    merged.push({ ...window });
  }
  return merged;
}
