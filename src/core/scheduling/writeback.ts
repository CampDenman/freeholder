// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Writing a booking to the calendar it belongs on (MASTER.md §4.4, §41; C6.06).
//
// §41 draws the line and this file stays on the right side of it: Freeholder
// **writes the bookings it made and reads busy time**. It does not sync
// arbitrary events, does not reconcile edits made upstream, and does not try
// to own somebody else's calendar — "becoming a general calendar-sync product
// means owning every conflict-resolution edge in the industry."
//
// The subtle part is not the writing. It is what happens next.
//
// An appointment written to Google comes back through C4.12's sync as a busy
// event on the same calendar. Left alone the resolver sees the appointment
// twice — once as the booking, once as its own reflection — and rescheduling
// collides with the ghost, because the exclusion constraint is quite right
// that something already occupies that hour. So every path that writes
// upstream records what it wrote, reconciliation claims the reflection when it
// arrives, and the resolver ignores a claimed one. A booking blocks time once.
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { bookings, calendars, externalBusyBlocks } from "@/core/scheduling/schema";
import { externalEvents } from "@/core/connections/schema";
import {
  deleteEvent,
  writeEvent,
  writeTargetFor,
} from "@/core/connections/calendar-write";
import type { Tx } from "@/core/service";

/**
 * What the upstream calendar is told, and no more than that.
 *
 * The customer's name and nothing else. An upstream calendar is a place other
 * people's software reads and other people's phones display; a service name
 * and a phone number in an event title is a disclosure nobody agreed to.
 */
function titleFor(contactName: string | null): string {
  return contactName ? `Booking — ${contactName}` : "Booking";
}

/**
 * Push a booking to its calendar's upstream provider, if it has one.
 *
 * Never throws into the caller. A booking that could not be mirrored is still
 * a booking: it exists here, it blocks time here, and the owner's own diary
 * was already right. Failing an appointment because Google was briefly
 * unreachable would be choosing the mirror over the original.
 */
export async function mirrorBooking(bookingId: string): Promise<{
  mirrored: boolean;
  ref?: string;
}> {
  try {
    return await db().transaction(async (tx) => {
      const [booking] = await tx
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          status: bookings.status,
          timezoneAtBooking: bookings.timezoneAtBooking,
          providerEventRef: bookings.providerEventRef,
          externalCalendarId: calendars.externalCalendarId,
          contactName: contacts.name,
        })
        .from(bookings)
        .innerJoin(calendars, eq(calendars.id, bookings.calendarId))
        .innerJoin(contacts, eq(contacts.id, bookings.contactId))
        .where(eq(bookings.id, bookingId))
        .limit(1);
      if (!booking) return { mirrored: false };

      const target = await writeTargetFor(tx, booking.externalCalendarId);
      if (!target) return { mirrored: false };

      const ref = await writeEvent(tx, target, {
        providerRef: booking.providerEventRef,
        summary: titleFor(booking.contactName),
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        timezone: booking.timezoneAtBooking,
      });
      await tx
        .update(bookings)
        .set({ providerEventRef: ref, updatedAt: sql`now()` })
        .where(eq(bookings.id, booking.id));
      return { mirrored: true, ref };
    });
  } catch (error) {
    console.warn(`[scheduling] booking ${bookingId} could not be mirrored`, error);
    return { mirrored: false };
  }
}

/** Take a booking off the upstream calendar when it stops being an appointment. */
export async function unmirrorBooking(bookingId: string): Promise<{ removed: boolean }> {
  try {
    return await db().transaction(async (tx) => {
      const [booking] = await tx
        .select({
          id: bookings.id,
          providerEventRef: bookings.providerEventRef,
          externalCalendarId: calendars.externalCalendarId,
        })
        .from(bookings)
        .innerJoin(calendars, eq(calendars.id, bookings.calendarId))
        .where(eq(bookings.id, bookingId))
        .limit(1);
      if (!booking?.providerEventRef) return { removed: false };

      const target = await writeTargetFor(tx, booking.externalCalendarId);
      if (!target) return { removed: false };

      await deleteEvent(tx, target, booking.providerEventRef);
      await tx
        .update(bookings)
        .set({ providerEventRef: null, updatedAt: sql`now()` })
        .where(eq(bookings.id, booking.id));
      // The reflection goes with it, or the hour stays blocked by a ghost of
      // an appointment nobody has.
      await tx
        .delete(externalBusyBlocks)
        .where(eq(externalBusyBlocks.bookingId, booking.id));
      await tx
        .update(externalEvents)
        .set({ bookingId: null, updatedAt: sql`now()` })
        .where(eq(externalEvents.bookingId, booking.id));
      return { removed: true };
    });
  } catch (error) {
    console.warn(`[scheduling] booking ${bookingId} could not be unmirrored`, error);
    return { removed: false };
  }
}

/**
 * Claim the synced events that are Freeholder's own bookings looking back.
 *
 * Matched by the provider's own id, which is the only identifier both sides
 * agree on. A title match would claim a customer's unrelated appointment the
 * first time somebody named one the same thing, and the cost of that mistake
 * is an hour the owner is told is free when it is not.
 *
 * Cheap when there is nothing to claim, which is the normal case.
 */
export async function reconcileMirroredBookings(tx: Tx): Promise<{ claimed: number }> {
  const mine = await tx
    .select({ id: bookings.id, ref: bookings.providerEventRef })
    .from(bookings)
    .where(isNotNull(bookings.providerEventRef));
  if (mine.length === 0) return { claimed: 0 };

  let claimed = 0;
  for (const booking of mine) {
    const rows = await tx
      .update(externalEvents)
      .set({ bookingId: booking.id, updatedAt: sql`now()` })
      .where(
        and(
          eq(externalEvents.externalId, booking.ref!),
          isNull(externalEvents.bookingId),
        ),
      )
      .returning({ id: externalEvents.id });
    claimed += rows.length;
  }
  return { claimed };
}

/**
 * Mirror in response to a committed booking event.
 *
 * The event bus rather than the mutation, deliberately. An upstream write
 * cannot be rolled back, so a booking that failed after writing would leave an
 * event on somebody's real calendar for an appointment that does not exist.
 * Waiting for the commit costs a moment and removes that entirely.
 *
 * Never throws into the bus: the mutation has already committed, and a
 * provider being briefly unreachable must not undo it.
 */
export async function mirrorForBookingEvent(
  eventName: string,
  payload: unknown,
): Promise<void> {
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) return;

  try {
    if (eventName === "booking.created" || eventName === "booking.confirmed") {
      await mirrorBooking(id);
      return;
    }
    if (eventName === "booking.cancelled") {
      await unmirrorBooking(id);
      return;
    }
    if (eventName === "booking.rescheduled") {
      // The old event goes and the new one is written. Leaving both would
      // double-book the owner on their own phone.
      const previous = typeof record.previousId === "string" ? record.previousId : null;
      if (previous) await unmirrorBooking(previous);
      await mirrorBooking(id);
    }
  } catch (error) {
    // The booking has already committed and is correct here, which is the
    // copy that matters.
    console.warn(`[scheduling] mirroring ${eventName} for ${id} failed`, error);
  }
}
