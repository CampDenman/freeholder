// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The availability resolver (C6.03, MASTER.md §4.4).
//
// Availability is computed from seven things, and getting any one of them
// wrong offers a slot the business cannot honour — which is worse than
// offering fewer. So each subtraction is tested on its own, against the same
// simple week, so a failure names the thing that broke.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/core/auth/schema";
import { connectedAccounts, externalCalendars, externalEvents } from "@/core/connections/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar, setServiceCalendars, updateCalendar } from "@/core/scheduling/service";
import { setAvailability, addAvailabilityException } from "@/core/scheduling/availability-service";
import { createBooking } from "@/core/scheduling/bookings";
import { resolveSlots } from "@/core/scheduling/resolver";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SERVICE = "00000000-0000-4000-8000-0000000000e0";
// 2026-09-14 is a Monday.
const MONDAY = "2026-09-14";
/** Well before the week under test, so lead time never interferes by accident. */
const NOW = new Date("2026-09-01T00:00:00.000Z");

async function slots(overrides: Record<string, unknown> = {}) {
  return db().transaction((tx) =>
    resolveSlots(tx, {
      serviceOfferingId: SERVICE,
      from: MONDAY,
      to: MONDAY,
      timezone: "UTC",
      durationMin: 60,
      granularityMin: 60,
      now: NOW,
      ...overrides,
    }),
  );
}

/** Just the start times, in a form a failure message can be read from. */
function times(found: { startsAt: Date }[]): string[] {
  return found.map((slot) => slot.startsAt.toISOString().slice(11, 16));
}

describe.runIf(hasDatabase)("the availability resolver", { timeout: 60_000 }, () => {
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

  /** A person who works Mondays, nine to five, on this service. */
  async function therapist(name = "Sam", capacityDefault = 1) {
    const calendar = await createCalendar.call(
      { kind: "resource", name, capacityDefault, timezone: "UTC" },
      OWNER,
    );
    await setAvailability.call(
      {
        calendarId: calendar.id,
        rules: [{ weekday: 1, starts: "09:00", ends: "17:00", kind: "bookable" }],
      },
      OWNER,
    );
    return calendar;
  }

  async function serves(members: { calendarId: string; role: "primary" | "resource" }[]) {
    await setServiceCalendars.call(
      {
        serviceOfferingId: SERVICE,
        members: members.map((member) => ({ ...member, priority: 0 })),
      },
      OWNER,
    );
  }

  it("cuts open hours into slots of the service's length", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    // Nine to five, hourly: eight slots, the last starting at four.
    expect(times(await slots())).toEqual([
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
    ]);
  });

  it("offers nothing on a day the calendar is closed", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    await addAvailabilityException.call(
      { calendarId: sam.id, startsOn: MONDAY, kind: "closed", reason: "Bank holiday" },
      OWNER,
    );
    expect(await slots()).toEqual([]);
  });

  it("subtracts what is already booked", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    await createBooking.call(
      {
        calendarId: sam.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T11:00:00.000Z`,
        endsAt: `${MONDAY}T12:00:00.000Z`,
      },
      OWNER,
    );
    expect(times(await slots())).not.toContain("11:00");
    expect(times(await slots())).toContain("10:00");
  });

  it("subtracts busy time synced from a connected calendar", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);

    // §4.4: imported busy time is never shown to customers and always
    // respected. It reaches the resolver through the calendar's link.
    const accountId = "00000000-0000-4000-8000-0000000000e1";
    await db().insert(connectedAccounts).values({
      id: accountId,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "resolver-account",
      email: "sam@example.test",
      status: "active",
      sharedWithBusiness: true,
    });
    const [synced] = await db()
      .insert(externalCalendars)
      .values({ connectedAccountId: accountId, externalId: "primary", name: "Sam's own" })
      .returning({ id: externalCalendars.id });
    await db().insert(externalEvents).values({
      externalCalendarId: synced!.id,
      externalId: "dentist",
      startsAt: new Date(`${MONDAY}T14:00:00.000Z`),
      endsAt: new Date(`${MONDAY}T15:00:00.000Z`),
      busy: true,
    });
    await updateCalendar.call({ id: sam.id, externalCalendarId: synced!.id }, OWNER);

    const found = times(await slots());
    expect(found).not.toContain("14:00");
    expect(found).toContain("13:00");
    // Nothing about the appointment itself travelled: the resolver returns
    // times and a calendar name, and C4.12 never stored a title to leak.
    expect(JSON.stringify(await slots())).not.toContain("dentist");
  });

  it("leaves room for the buffers either side", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    await createBooking.call(
      {
        calendarId: sam.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T12:00:00.000Z`,
        endsAt: `${MONDAY}T13:00:00.000Z`,
      },
      OWNER,
    );
    // Half an hour either side: the eleven o'clock would end at noon with no
    // gap, and the one o'clock would start the moment the last one ended.
    const guarded = times(await slots({ bufferBeforeMin: 30, bufferAfterMin: 30 }));
    expect(guarded).not.toContain("11:00");
    expect(guarded).not.toContain("13:00");
    expect(guarded).toContain("10:00");
    expect(guarded).toContain("14:00");
  });

  it("counts travel time as part of the gap after", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    await createBooking.call(
      {
        calendarId: sam.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T12:00:00.000Z`,
        endsAt: `${MONDAY}T13:00:00.000Z`,
      },
      OWNER,
    );
    // A photographer is not booked back-to-back across town.
    expect(times(await slots({ travelTimeMin: 45 }))).not.toContain("11:00");
  });

  it("refuses to offer anything inside the notice period", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    await updateCalendar.call({ id: sam.id, minNoticeMin: 24 * 60 }, OWNER);
    // Asking at nine on the morning itself: a day's notice rules the day out.
    const sameDay = await slots({ now: new Date(`${MONDAY}T08:00:00.000Z`) });
    expect(sameDay).toEqual([]);
  });

  it("refuses to offer anything past the horizon", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    await updateCalendar.call({ id: sam.id, bookingHorizonDays: 7 }, OWNER);
    // The Monday is thirteen days out, and the horizon is seven.
    expect(await slots()).toEqual([]);
  });

  it("stops at the calendar's cap for the day", async () => {
    const sam = await therapist();
    await serves([{ calendarId: sam.id, role: "primary" }]);
    await updateCalendar.call({ id: sam.id, maxPerDay: 3 }, OWNER);
    // Burnout is a scheduling bug, so the ceiling is real rather than advice.
    expect(await slots()).toHaveLength(3);
  });

  it("only offers a slot where the person and the room are both free", async () => {
    const sam = await therapist("Sam");
    const roomA = await therapist("Room A");
    await serves([
      { calendarId: sam.id, role: "primary" },
      { calendarId: roomA.id, role: "resource" },
    ]);
    await createBooking.call(
      {
        calendarId: roomA.id,
        contact: { email: "someone@example.test" },
        startsAt: `${MONDAY}T10:00:00.000Z`,
        endsAt: `${MONDAY}T11:00:00.000Z`,
      },
      OWNER,
    );

    const found = await slots();
    // Sam is free at ten; the only room is not. Choosing them together is what
    // stops a slot being offered that cannot be honoured.
    expect(times(found)).not.toContain("10:00");
    expect(found[0]?.resourceCalendarIds).toEqual([roomA.id]);
  });

  it("uses a second room when the first is taken", async () => {
    const sam = await therapist("Sam");
    const roomA = await therapist("Room A");
    const roomB = await therapist("Room B");
    await serves([
      { calendarId: sam.id, role: "primary" },
      { calendarId: roomA.id, role: "resource" },
      { calendarId: roomB.id, role: "resource" },
    ]);
    await createBooking.call(
      {
        calendarId: roomA.id,
        contact: { email: "someone@example.test" },
        startsAt: `${MONDAY}T10:00:00.000Z`,
        endsAt: `${MONDAY}T11:00:00.000Z`,
      },
      OWNER,
    );
    const found = await slots();
    const ten = found.find((slot) => slot.startsAt.toISOString().includes("T10:00"));
    expect(ten?.resourceCalendarIds).toEqual([roomB.id]);
  });

  it("offers the named person first without hiding the others", async () => {
    const sam = await therapist("Sam");
    const kim = await therapist("Kim");
    await serves([
      { calendarId: sam.id, role: "primary" },
      { calendarId: kim.id, role: "primary" },
    ]);
    const found = await slots({ preferredCalendarId: kim.id, assignment: "pool" });
    // A preference, not a filter: Kim is offered first for a given time, and
    // Sam is still there.
    expect(found[0]?.calendarId).toBe(kim.id);
    expect(found.some((slot) => slot.calendarId === sam.id)).toBe(true);
  });

  it("offers only the named person when the service names one", async () => {
    const sam = await therapist("Sam");
    const kim = await therapist("Kim");
    await serves([
      { calendarId: sam.id, role: "primary" },
      { calendarId: kim.id, role: "primary" },
    ]);
    const found = await slots({
      preferredCalendarId: kim.id,
      assignment: "specific",
    });
    expect(found.every((slot) => slot.calendarId === kim.id)).toBe(true);
  });

  it("shows a time once and spreads the work when it is round-robin", async () => {
    const sam = await therapist("Sam");
    const kim = await therapist("Kim");
    await serves([
      { calendarId: sam.id, role: "primary" },
      { calendarId: kim.id, role: "primary" },
    ]);
    const found = await slots({ assignment: "round_robin" });
    // A customer picking a time should be shown the time once; which of two
    // available people they get is the business's decision.
    expect(times(found)).toEqual([
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
    ]);
    const forSam = found.filter((slot) => slot.calendarId === sam.id).length;
    const forKim = found.filter((slot) => slot.calendarId === kim.id).length;
    expect(Math.abs(forSam - forKim)).toBeLessThanOrEqual(1);
  });

  it("counts places on a shared calendar and stops when they run out", async () => {
    const room = await therapist("Yoga room", 3);
    await serves([{ calendarId: room.id, role: "primary" }]);
    await createBooking.call(
      {
        calendarId: room.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T10:00:00.000Z`,
        endsAt: `${MONDAY}T11:00:00.000Z`,
        capacityUsed: 2,
      },
      OWNER,
    );

    const found = await slots();
    const ten = found.find((slot) => slot.startsAt.toISOString().includes("T10:00"));
    expect(ten?.seatsAvailable).toBe(1);
    // A party of two cannot have the one remaining place.
    const forTwo = await slots({ seats: 2 });
    expect(times(forTwo)).not.toContain("10:00");
    expect(times(forTwo)).toContain("11:00");
  });

  it("offers nothing for a service nobody is set up to do", async () => {
    const sam = await therapist();
    // Hours, but no membership: the service draws on no calendars.
    void sam;
    expect(await slots()).toEqual([]);
  });

  it("ignores an archived calendar", async () => {
    const sam = await therapist("Sam");
    const kim = await therapist("Kim");
    await serves([
      { calendarId: sam.id, role: "primary" },
      { calendarId: kim.id, role: "primary" },
    ]);
    await updateCalendar.call({ id: kim.id, status: "archived" }, OWNER);
    const found = await slots();
    expect(found.every((slot) => slot.calendarId === sam.id)).toBe(true);
  });
});
