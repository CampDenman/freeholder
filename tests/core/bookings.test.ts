// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bookings (C6.07, MASTER.md §4.4).
//
// The test that matters most is the last one: §4.4 says double-booking is
// prevented in the database rather than in the UI, because "no amount of
// careful service-layer checking survives two processes". So one of these
// runs two real transactions at once and expects exactly one to win.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { bookings } from "@/core/scheduling/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar } from "@/core/scheduling/service";
import {
  addBookingParticipant,
  createBooking,
  getBooking,
  listBookings,
  rescheduleBooking,
  setBookingStatus,
} from "@/core/scheduling/bookings";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const NINE = "2026-09-14T09:00:00.000Z";
const TEN = "2026-09-14T10:00:00.000Z";
const ELEVEN = "2026-09-14T11:00:00.000Z";

describe.runIf(hasDatabase)("bookings", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function calendar(capacityDefault = 1, name = "Studio A") {
    return createCalendar.call(
      { kind: "resource", name, capacityDefault, timezone: "Europe/London" },
      OWNER,
    );
  }

  async function book(
    calendarId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return createBooking.call(
      {
        calendarId,
        contact: { email: "rae@example.test", name: "Rae Lane" },
        startsAt: NINE,
        endsAt: TEN,
        ...overrides,
      },
      OWNER,
    );
  }

  it("resolves the customer into the spine rather than creating a second one", async () => {
    const studio = await calendar();
    const first = await book(studio.id);
    const second = await book(studio.id, { startsAt: TEN, endsAt: ELEVEN });
    // A customer who has booked before is the same person.
    expect(second.contactId).toBe(first.contactId);
    expect(await db().select().from(contacts)).toHaveLength(1);

    const [contact] = await db().select().from(contacts);
    expect(contact?.name).toBe("Rae Lane");
    expect(contact?.source).toBe("booking:admin");
  });

  it("keeps the timezone the appointment was agreed in", async () => {
    const studio = await calendar();
    const booking = await book(studio.id);
    // A DST change between booking and appointment should be a known quantity
    // rather than a surprise.
    expect(booking.timezoneAtBooking).toBe("Europe/London");
  });

  it("puts everything that happens on the customer's timeline", async () => {
    const studio = await calendar();
    const booking = await book(studio.id);
    await setBookingStatus.call({ id: booking.id, status: "confirmed" }, OWNER);
    await setBookingStatus.call({ id: booking.id, status: "completed" }, OWNER);

    const entries = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.subjectType, "booking"));
    // The CRM shows a client's whole history without booking knowing the CRM
    // exists.
    expect(entries.map((entry) => entry.eventType)).toEqual([
      "booking.requested",
      "booking.confirmed",
      "booking.completed",
    ]);
  });

  it("refuses a transition that would rewrite what happened", async () => {
    const studio = await calendar();
    const booking = await book(studio.id);
    await setBookingStatus.call({ id: booking.id, status: "confirmed" }, OWNER);
    await setBookingStatus.call({ id: booking.id, status: "completed" }, OWNER);
    // A finished appointment is history. The honest move is a new booking.
    const refused = await failure(
      setBookingStatus.call({ id: booking.id, status: "confirmed" }, OWNER),
    );
    expect(refused.code).toBe("conflict");
  });

  it("insists on a reason for a cancellation", async () => {
    const studio = await calendar();
    const booking = await book(studio.id);
    expect(
      (await failure(setBookingStatus.call({ id: booking.id, status: "cancelled" }, OWNER)))
        .code,
    ).toBe("validation");
    const cancelled = await setBookingStatus.call(
      { id: booking.id, status: "cancelled", reason: "Customer is unwell." },
      OWNER,
    );
    expect(cancelled.cancellationReason).toBe("Customer is unwell.");
  });

  it("frees the time when an appointment is cancelled", async () => {
    const studio = await calendar();
    const booking = await book(studio.id);
    await setBookingStatus.call(
      { id: booking.id, status: "cancelled", reason: "Changed their mind." },
      OWNER,
    );
    // A cancelled booking holds nothing, so the slot is bookable again.
    const replacement = await book(studio.id, {
      contact: { email: "sam@example.test", name: "Sam" },
    });
    expect(replacement.startsAt.toISOString()).toBe(NINE);
  });

  it("moves an appointment into a new row that remembers the old one", async () => {
    const studio = await calendar();
    const booking = await book(studio.id);
    await setBookingStatus.call({ id: booking.id, status: "confirmed" }, OWNER);
    const moved = await rescheduleBooking.call(
      { id: booking.id, startsAt: TEN, endsAt: ELEVEN },
      OWNER,
    );

    expect(moved.id).not.toBe(booking.id);
    expect(moved.rescheduledFromId).toBe(booking.id);
    // A moved appointment is as agreed as the one it replaced.
    expect(moved.status).toBe("confirmed");

    const [previous] = await db().select().from(bookings).where(eq(bookings.id, booking.id));
    expect(previous?.status).toBe("cancelled");
    // The history of a moved appointment survives.
    expect(await db().select().from(bookings)).toHaveLength(2);
  });

  it("lets an appointment move by an hour without colliding with itself", async () => {
    const studio = await calendar();
    const booking = await book(studio.id);
    // The old row is released before the new one is written, or the exclusion
    // constraint would refuse an overlap with the very booking being moved.
    const moved = await rescheduleBooking.call(
      { id: booking.id, startsAt: "2026-09-14T09:30:00.000Z", endsAt: "2026-09-14T10:30:00.000Z" },
      OWNER,
    );
    expect(moved.startsAt.toISOString()).toBe("2026-09-14T09:30:00.000Z");
  });

  it("shares a class calendar between customers up to its capacity", async () => {
    const room = await calendar(3, "Yoga room");
    await book(room.id, { contact: { email: "rae@example.test" } });
    await book(room.id, { contact: { email: "sam@example.test" } });
    await book(room.id, { contact: { email: "kim@example.test" } });
    // Three places, three people, no exclusion: a class overlaps by design.
    expect(await db().select().from(bookings)).toHaveLength(3);

    const full = await failure(
      book(room.id, { contact: { email: "lee@example.test" } }),
    );
    expect(full.code).toBe("conflict");
    expect(full.message).toContain("place");
  });

  it("takes a guest with no email address", async () => {
    const room = await calendar(4, "Yoga room");
    const booking = await book(room.id);
    // "And my sister" is a real thing to book, and refusing to record her
    // because she has no email address pushes the owner back to paper.
    await addBookingParticipant.call(
      { bookingId: booking.id, name: "Rae's sister" },
      OWNER,
    );
    const withGuests = await getBooking.call({ id: booking.id }, OWNER);
    expect(withGuests?.participants).toHaveLength(1);
    expect(withGuests?.participants[0]?.contactId).toBeNull();
    // The seat she takes is counted against the room.
    expect(withGuests?.capacityUsed).toBe(2);
  });

  it("lists a calendar's day and a customer's history", async () => {
    const studio = await calendar();
    await book(studio.id);
    await book(studio.id, {
      startsAt: TEN,
      endsAt: ELEVEN,
      contact: { email: "sam@example.test" },
    });

    const day = await listBookings.call(
      { calendarId: studio.id, from: NINE, to: ELEVEN },
      OWNER,
    );
    expect(day).toHaveLength(2);
    expect(day[0]?.contactEmail).toBe("rae@example.test");
    expect(day[0]?.calendarName).toBe("Studio A");
  });

  it("prevents a double booking in the database, not in the service", async () => {
    const studio = await calendar();
    // Two real transactions, opened at once, both taking the last slot. This
    // is the case §4.4 says no amount of service-layer checking survives.
    const attempts = await Promise.allSettled([
      createBooking.call(
        {
          calendarId: studio.id,
          contact: { email: "rae@example.test" },
          startsAt: NINE,
          endsAt: TEN,
        },
        OWNER,
      ),
      createBooking.call(
        {
          calendarId: studio.id,
          contact: { email: "sam@example.test" },
          startsAt: "2026-09-14T09:30:00.000Z",
          endsAt: "2026-09-14T10:30:00.000Z",
        },
        OWNER,
      ),
    ]);

    const won = attempts.filter((attempt) => attempt.status === "fulfilled");
    const lost = attempts.filter((attempt) => attempt.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(await db().select().from(bookings)).toHaveLength(1);
    // And the loser is told something they can act on, not a database error.
    const reason = (lost[0] as PromiseRejectedResult).reason as { message: string };
    expect(reason.message).toContain("taken");
  });

  it("still refuses an overlap when the two are written one after the other", async () => {
    const studio = await calendar();
    await book(studio.id);
    const overlapping = await failure(
      book(studio.id, {
        contact: { email: "sam@example.test" },
        startsAt: "2026-09-14T09:45:00.000Z",
        endsAt: "2026-09-14T10:45:00.000Z",
      }),
    );
    expect(overlapping.code).toBe("conflict");
  });

  it("allows one appointment to start exactly where another ends", async () => {
    const studio = await calendar();
    await book(studio.id);
    // A half-open range: back-to-back is not an overlap, and buffers are the
    // service's business rather than the constraint's.
    const next = await book(studio.id, {
      contact: { email: "sam@example.test" },
      startsAt: TEN,
      endsAt: ELEVEN,
    });
    expect(next.startsAt.toISOString()).toBe(TEN);
  });
});
