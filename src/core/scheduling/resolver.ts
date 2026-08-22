// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The availability resolver (MASTER.md §4.4, C6.03).
//
// §4.4: "Availability is **computed, never stored**. The answer to 'what can I
// book?' is derived at request time from the rules, the exceptions, existing
// bookings, the external busy blocks, the buffers, the lead time, the horizon,
// and the capacity — because every cached answer is a double-booking waiting
// for a cache miss."
//
// So this reads all of those and returns slots. The order matters and is the
// whole design:
//
//   1. open windows from the pattern and its exceptions (C6.02)
//   2. minus what is already booked (C6.07)
//   3. minus busy time synced from a connected calendar (C4.12/C4.13)
//   4. cut into slots of the service's duration, on the granularity asked for
//   5. each slot widened by the service's buffers before it is tested, so a
//      photographer is not booked back-to-back across town
//   6. dropped if it is inside the lead time or beyond the horizon
//   7. dropped if the day is already at the calendar's daily cap
//
// **Compound requirements are resolved together, not in sequence.** A service
// needing a therapist *and* a room offers a slot only where both are free. A
// resolver that picked the person first and then looked for a room would offer
// slots it cannot honour, which is worse than offering fewer.
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { openWindows, type OpenWindow } from "@/core/scheduling/availability";
import {
  bookings,
  calendars,
  calendarMemberships,
  externalBusyBlocks,
  HOLDING_STATUSES,
} from "@/core/scheduling/schema";
import {
  connectedAccounts,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
import { zonedDate, zonedInstant } from "@/core/i18n/zoned";
import type { Tx } from "@/core/service";

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  /** Which calendar would take it, so the customer can be told who they got. */
  calendarId: string;
  calendarName: string;
  /** The room, van or chair that goes with it, when the service needs one. */
  resourceCalendarIds: string[];
  /** Places left, for a class. Always 1 for a calendar that holds one thing. */
  seatsAvailable: number;
}

export interface SlotRequest {
  serviceOfferingId: string;
  /** Inclusive local dates in the business's zone, `YYYY-MM-DD`. */
  from: string;
  to: string;
  timezone: string;
  durationMin: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  /** Travel between locations, added to the buffer after (§4.10). */
  travelTimeMin?: number;
  /** 15-minute increments, or on the hour only. */
  granularityMin?: number;
  capacity?: number;
  assignment?: "specific" | "pool" | "round_robin";
  /** "I want Sam" — offered first, and never the only answer for a pool. */
  preferredCalendarId?: string;
  /** Seats this enquiry wants, so a party of three is not offered a single place. */
  seats?: number;
  /** Now, injectable so a test is not at the mercy of the clock. */
  now?: Date;
  maxSlots?: number;
  /**
   * Hours imposed by the audience rather than by the calendar (C6.05).
   *
   * §41: bookability is a property of the audience, not of the calendar. A
   * friend booking at 8pm on Sunday is not constrained by shop hours — so
   * `any` opens the whole range and `custom` replaces the calendar's pattern.
   * Busy time is subtracted either way, because that rule is not an hours
   * rule and a booking system that can double-book its owner is worse than
   * none.
   */
  /** An audience's own notice and horizon, where it has stated one (C6.05). */
  noticeOverrideMin?: number;
  horizonOverrideDays?: number;
  audienceHours?:
    | { mode: "calendar" }
    | { mode: "any" }
    | { mode: "custom"; rules: readonly { weekday: number; starts: string; ends: string }[] };
}

interface Busy {
  startsAt: Date;
  endsAt: Date;
}

const DEFAULT_GRANULARITY = 15;
const DEFAULT_MAX_SLOTS = 500;

/** Everything a calendar has already committed to, from both sources. */
async function busyFor(
  tx: Tx,
  calendarId: string,
  window: { from: Date; to: Date },
): Promise<Busy[]> {
  const booked = await tx
    .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.calendarId, calendarId),
        sql`${bookings.status} = any(${sql.param([...HOLDING_STATUSES])})`,
        gte(bookings.endsAt, window.from),
        lte(bookings.startsAt, window.to),
      ),
    );

  // §4.4: imported busy time is "never shown to customers, always respected".
  // It reaches here through the calendar's link to the synced one (C6.01), and
  // carries only times — the privacy design in C4.12 means there is nothing
  // else on it to reach a booking page.
  const external = await tx
    .select({ startsAt: externalEvents.startsAt, endsAt: externalEvents.endsAt })
    .from(externalEvents)
    .innerJoin(
      externalCalendars,
      eq(externalCalendars.id, externalEvents.externalCalendarId),
    )
    .innerJoin(calendars, eq(calendars.externalCalendarId, externalCalendars.id))
    .innerJoin(
      connectedAccounts,
      eq(connectedAccounts.id, externalCalendars.connectedAccountId),
    )
    .where(
      and(
        eq(calendars.id, calendarId),
        eq(connectedAccounts.sharedWithBusiness, true),
        sql`${externalCalendars.role} <> 'ignored'`,
        eq(externalEvents.busy, true),
        // A synced event that is one of our own bookings looking back at us
        // (C6.06). The booking above already blocks the hour; counting the
        // reflection too would let an appointment collide with its own ghost
        // when somebody tries to move it.
        isNull(externalEvents.bookingId),
        gte(externalEvents.endsAt, window.from),
        lte(externalEvents.startsAt, window.to),
      ),
    );

  // §4.4's `ExternalBusyBlock`: time imported from a feed rather than through
  // a connected account. "Never shown to customers, always respected" — and
  // the ICS path works with no adapter at all, so an owner who connected
  // nothing still has their other diary honoured.
  const imported = await tx
    .select({ startsAt: externalBusyBlocks.startsAt, endsAt: externalBusyBlocks.endsAt })
    .from(externalBusyBlocks)
    .where(
      and(
        eq(externalBusyBlocks.calendarId, calendarId),
        eq(externalBusyBlocks.busy, true),
        isNull(externalBusyBlocks.bookingId),
        gte(externalBusyBlocks.endsAt, window.from),
        lte(externalBusyBlocks.startsAt, window.to),
      ),
    );

  return [...booked, ...external, ...imported].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

function overlaps(a: Busy, b: Busy): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Seats already held on a shared calendar across a candidate slot. */
function seatsHeld(
  held: { startsAt: Date; endsAt: Date; capacityUsed: number }[],
  slot: Busy,
): number {
  return held
    .filter((booking) => overlaps(booking, slot))
    .reduce((total, booking) => total + booking.capacityUsed, 0);
}

/**
 * The candidate start times inside one open window.
 *
 * Aligned to the granularity from the top of the window's hour, so "on the
 * hour only" means on the hour rather than on the hour the window happens to
 * open at.
 */
function* startsIn(
  window: OpenWindow,
  durationMin: number,
  granularityMin: number,
): Generator<Date> {
  const step = granularityMin * 60_000;
  const duration = durationMin * 60_000;
  const anchor = new Date(window.startsAt);
  anchor.setUTCMinutes(0, 0, 0);
  let cursor = anchor.getTime();
  while (cursor < window.startsAt.getTime()) cursor += step;
  for (; cursor + duration <= window.endsAt.getTime(); cursor += step) {
    yield new Date(cursor);
  }
}

/**
 * The open windows a request should be cut into slots from.
 *
 * The calendar's own pattern unless the audience has said otherwise, which is
 * where §41's "bookability is per audience" actually bites: two people asking
 * about the same calendar on the same day get different windows, and the same
 * busy time subtracted from both.
 */
async function windowsFor(
  tx: Tx,
  request: SlotRequest,
  member: { calendarId: string; timezone: string },
): Promise<OpenWindow[]> {
  const hours = request.audienceHours ?? { mode: "calendar" as const };
  if (hours.mode === "calendar") {
    return openWindows(tx, {
      calendarId: member.calendarId,
      timezone: member.timezone,
      from: request.from,
      to: request.to,
      kinds: ["bookable"],
    });
  }

  const days = eachDay(request.from, request.to);
  if (hours.mode === "any") {
    // Midnight to midnight in the calendar's own zone, so "any time" is a real
    // day rather than 24 hours from wherever the server thinks midnight is.
    return days.map((day) => ({
      startsAt: zonedInstant(member.timezone, day),
      endsAt: zonedInstant(member.timezone, addCalendarDays(day, 1)),
      kind: "bookable" as const,
    }));
  }

  const windows: OpenWindow[] = [];
  for (const day of days) {
    const weekday = new Date(
      Date.UTC(day.year, day.month - 1, day.day),
    ).getUTCDay();
    for (const rule of hours.rules.filter((candidate) => candidate.weekday === weekday)) {
      const [fromHour, fromMinute] = rule.starts.split(":").map(Number) as [number, number];
      const [toHour, toMinute] = rule.ends.split(":").map(Number) as [number, number];
      windows.push({
        startsAt: zonedInstant(member.timezone, {
          ...day,
          hour: fromHour,
          minute: fromMinute,
        }),
        endsAt: zonedInstant(member.timezone, { ...day, hour: toHour, minute: toMinute }),
        kind: "bookable",
      });
    }
  }
  return windows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

interface DayParts {
  year: number;
  month: number;
  day: number;
}

function eachDay(from: string, to: string): DayParts[] {
  const parse = (value: string): DayParts => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    return { year, month, day };
  };
  const start = parse(from);
  const end = parse(to);
  const found: DayParts[] = [];
  const last = Date.UTC(end.year, end.month - 1, end.day);
  for (
    let cursor = Date.UTC(start.year, start.month - 1, start.day);
    cursor <= last && found.length < 400;
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

function addCalendarDays(date: DayParts, days: number): DayParts {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/**
 * What can be booked, for one service, across a range of dates.
 *
 * Returns slots in time order. A slot names the calendar that would take it,
 * because §4.4 wants the customer told who they got.
 */
export async function resolveSlots(tx: Tx, request: SlotRequest): Promise<Slot[]> {
  const now = request.now ?? new Date();
  const granularity = request.granularityMin ?? DEFAULT_GRANULARITY;
  const bufferBefore = (request.bufferBeforeMin ?? 0) * 60_000;
  // Travel rides with the buffer after: both are the reason the next slot
  // cannot start the moment this one ends.
  const bufferAfter =
    ((request.bufferAfterMin ?? 0) + (request.travelTimeMin ?? 0)) * 60_000;
  const seats = request.seats ?? 1;
  const maxSlots = request.maxSlots ?? DEFAULT_MAX_SLOTS;

  const members = await tx
    .select({
      calendarId: calendars.id,
      name: calendars.name,
      timezone: calendars.timezone,
      capacityDefault: calendars.capacityDefault,
      bookingHorizonDays: calendars.bookingHorizonDays,
      minNoticeMin: calendars.minNoticeMin,
      maxPerDay: calendars.maxPerDay,
      role: calendarMemberships.role,
      priority: calendarMemberships.priority,
    })
    .from(calendarMemberships)
    .innerJoin(calendars, eq(calendars.id, calendarMemberships.calendarId))
    .where(
      and(
        eq(calendarMemberships.serviceOfferingId, request.serviceOfferingId),
        eq(calendars.status, "active"),
      ),
    )
    .orderBy(asc(calendarMemberships.priority), asc(calendars.name));
  if (members.length === 0) return [];

  const people = members.filter((member) => member.role !== "resource");
  const resources = members.filter((member) => member.role === "resource");
  if (people.length === 0) return [];

  const candidates =
    request.assignment === "specific" && request.preferredCalendarId
      ? people.filter((member) => member.calendarId === request.preferredCalendarId)
      : request.preferredCalendarId
        ? // A preference, not a filter: §4.4 wants the named person offered
          // first without the pool being hidden behind them.
          [
            ...people.filter((member) => member.calendarId === request.preferredCalendarId),
            ...people.filter((member) => member.calendarId !== request.preferredCalendarId),
          ]
        : people;
  if (candidates.length === 0) return [];

  const rangeStart = new Date(`${request.from}T00:00:00.000Z`);
  const rangeEnd = new Date(`${request.to}T23:59:59.999Z`);
  // Widened, because a booking that started before the range can still block
  // a slot inside it.
  const busyWindow = {
    from: new Date(rangeStart.getTime() - 86_400_000),
    to: new Date(rangeEnd.getTime() + 86_400_000),
  };

  // Loaded once per calendar rather than per slot: a fortnight of fifteen
  // minute slots is a thousand candidates, and a query each would be a
  // thousand queries.
  const busyByCalendar = new Map<string, Busy[]>();
  const heldByCalendar = new Map<
    string,
    { startsAt: Date; endsAt: Date; capacityUsed: number }[]
  >();
  for (const member of [...candidates, ...resources]) {
    busyByCalendar.set(member.calendarId, await busyFor(tx, member.calendarId, busyWindow));
    if (member.capacityDefault > 1) {
      heldByCalendar.set(
        member.calendarId,
        await tx
          .select({
            startsAt: bookings.startsAt,
            endsAt: bookings.endsAt,
            capacityUsed: bookings.capacityUsed,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.calendarId, member.calendarId),
              sql`${bookings.status} = any(${sql.param([...HOLDING_STATUSES])})`,
              gte(bookings.endsAt, busyWindow.from),
              lte(bookings.startsAt, busyWindow.to),
            ),
          ),
      );
    }
  }

  const perDay = new Map<string, number>();
  const found: Slot[] = [];

  for (const member of candidates) {
    // The audience's terms where it has stated them, the calendar's otherwise.
    // A friend booking at short notice is the audience overriding the
    // calendar, which is exactly what §41 means by bookability being per
    // audience.
    const noticeMin = request.noticeOverrideMin ?? member.minNoticeMin;
    const horizonDays = request.horizonOverrideDays ?? member.bookingHorizonDays;
    const earliest = new Date(now.getTime() + noticeMin * 60_000);
    const latest = new Date(now.getTime() + horizonDays * 86_400_000);

    const windows = await windowsFor(tx, request, {
      calendarId: member.calendarId,
      timezone: member.timezone,
    });

    for (const window of windows) {
      for (const startsAt of startsIn(window, request.durationMin, granularity)) {
        if (found.length >= maxSlots) return found;
        const endsAt = new Date(startsAt.getTime() + request.durationMin * 60_000);

        // Lead time and horizon: no bookings in the next two hours, none more
        // than six months out.
        if (startsAt < earliest || startsAt > latest) continue;

        // The buffers are what is tested against existing work, not the
        // appointment itself, so a slot that would leave no travel time is
        // never offered.
        const guarded = {
          startsAt: new Date(startsAt.getTime() - bufferBefore),
          endsAt: new Date(endsAt.getTime() + bufferAfter),
        };

        const shared = member.capacityDefault > 1;
        if (shared) {
          const taken = seatsHeld(heldByCalendar.get(member.calendarId) ?? [], {
            startsAt,
            endsAt,
          });
          if (taken + seats > member.capacityDefault) continue;
        } else if (
          (busyByCalendar.get(member.calendarId) ?? []).some((busy) =>
            overlaps(busy, guarded),
          )
        ) {
          continue;
        }

        // Daily and weekly caps, because burnout is a scheduling bug.
        const day = zonedDate(startsAt, member.timezone);
        const dayKey = `${member.calendarId}:${day.year}-${day.month}-${day.day}`;
        if (member.maxPerDay !== null && (perDay.get(dayKey) ?? 0) >= member.maxPerDay) {
          continue;
        }

        // Compound requirements, chosen together rather than in sequence: the
        // slot exists only if a resource is free for it too.
        const resource = resources.find(
          (candidate) =>
            !(busyByCalendar.get(candidate.calendarId) ?? []).some((busy) =>
              overlaps(busy, guarded),
            ),
        );
        if (resources.length > 0 && !resource) continue;

        found.push({
          startsAt,
          endsAt,
          calendarId: member.calendarId,
          calendarName: member.name,
          resourceCalendarIds: resource ? [resource.calendarId] : [],
          seatsAvailable: shared
            ? member.capacityDefault -
              seatsHeld(heldByCalendar.get(member.calendarId) ?? [], { startsAt, endsAt })
            : 1,
        });
        perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
      }
    }
  }

  // Round-robin spreads the work; everything else reads in time order with the
  // preferred or highest-priority calendar winning a tie.
  if (request.assignment === "round_robin") {
    const load = new Map(candidates.map((member) => [member.calendarId, 0]));
    return dedupeByStart(
      found.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      load,
    );
  }

  return found.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      candidates.findIndex((member) => member.calendarId === a.calendarId) -
        candidates.findIndex((member) => member.calendarId === b.calendarId),
  );
}

/**
 * One offer per start time, given to whoever has least on.
 *
 * A customer picking a time should be shown the time once. Which of three
 * available people they get is the business's decision, and round-robin is the
 * business saying "whoever is quietest".
 */
function dedupeByStart(slots: Slot[], load: Map<string, number>): Slot[] {
  const byStart = new Map<number, Slot[]>();
  for (const slot of slots) {
    const key = slot.startsAt.getTime();
    byStart.set(key, [...(byStart.get(key) ?? []), slot]);
  }
  const chosen: Slot[] = [];
  const running = new Map(load);
  for (const key of [...byStart.keys()].sort((a, b) => a - b)) {
    const options = byStart.get(key)!;
    const pick = options.reduce((least, option) =>
      (running.get(option.calendarId) ?? 0) < (running.get(least.calendarId) ?? 0)
        ? option
        : least,
    );
    running.set(pick.calendarId, (running.get(pick.calendarId) ?? 0) + 1);
    chosen.push(pick);
  }
  return chosen;
}
