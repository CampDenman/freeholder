// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// ICS in and out, and the reflection problem (C6.06, MASTER.md §4.4, §41).
//
// The test that matters most is the reconciliation one. An appointment written
// to Google comes back through C4.12's sync as a busy event on the same
// calendar; left alone it blocks its hour twice and cannot be moved, because
// the exclusion constraint is quite right that something already occupies it.
// That failure is invisible until somebody tries to reschedule.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { connectedAccounts, externalCalendars, externalEvents } from "@/core/connections/schema";
import { bookings, externalBusyBlocks } from "@/core/scheduling/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { parseIcs, renderCalendar, fold, escapeText, unescapeText } from "@/core/ics";
import { createCalendar, setServiceCalendars, updateCalendar } from "@/core/scheduling/service";
import { setAvailability } from "@/core/scheduling/availability-service";
import { createBooking } from "@/core/scheduling/bookings";
import { resolveSlots } from "@/core/scheduling/resolver";
import { reconcileMirroredBookings } from "@/core/scheduling/writeback";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SERVICE = "00000000-0000-4000-8000-000000000a01";
const ACCOUNT = "00000000-0000-4000-8000-000000000a02";
const MONDAY = "2026-09-14";
const NOW = new Date("2026-09-01T00:00:00.000Z");

describe("RFC 5545, the parts we emit", () => {
  it("folds on octets rather than characters", () => {
    // An emoji is four bytes. A naive character count produces a line a
    // strict parser rejects, and the file opens fine in the one client the
    // author happened to test.
    const line = `SUMMARY:${"🎂".repeat(40)}`;
    const folded = fold(line);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    // And never mid-character: every piece is still readable text.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("escapes what RFC 5545 treats as structure", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("round-trips an event it wrote", () => {
    const rendered = renderCalendar(
      [
        {
          uid: "one@freeholder",
          startsAt: new Date("2026-09-14T09:00:00.000Z"),
          endsAt: new Date("2026-09-14T10:00:00.000Z"),
          summary: "Rae Lane; the usual",
        },
      ],
      { prodId: "-//Test//EN" },
    );
    const [parsed] = parseIcs(rendered);
    expect(parsed).toMatchObject({
      uid: "one@freeholder",
      summary: "Rae Lane; the usual",
      busy: true,
      cancelled: false,
    });
    expect(parsed!.startsAt.toISOString()).toBe("2026-09-14T09:00:00.000Z");
  });

  // The trap in un-escaping is order. A title ending in a backslash renders as
  // `\\` followed by the separator `\;`; undoing `\;` before `\\` reads the
  // second backslash as the escape and produces a semicolon nobody typed.
  it("does not invent structure out of an escaped backslash", () => {
    expect(unescapeText(escapeText("Rae\\; Lane"))).toBe("Rae\\; Lane");
    expect(unescapeText(escapeText("two\nlines, and; both"))).toBe(
      "two\nlines, and; both",
    );
  });

  it("reads a transparent event as not blocking, and a cancelled one as gone", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:free@example",
      "DTSTART:20260914T090000Z",
      "DTEND:20260914T100000Z",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:gone@example",
      "DTSTART:20260914T110000Z",
      "DTEND:20260914T120000Z",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(feed);
    expect(parsed.find((event) => event.uid === "free@example")?.busy).toBe(false);
    expect(parsed.find((event) => event.uid === "gone@example")?.cancelled).toBe(true);
  });

  it("survives a feed containing things it does not understand", () => {
    // A feed with an unknown property still says when somebody is busy.
    // Refusing the whole file over one line would choose purity over the
    // owner's diary.
    const feed = [
      "BEGIN:VCALENDAR",
      "X-SOMETHING-ODD:whatever",
      "BEGIN:VEVENT",
      "UID:ok@example",
      "DTSTART;TZID=Europe/London:20260914T090000",
      "DTEND;TZID=Europe/London:20260914T100000",
      "SUMMARY:A very long line that has been folded by the publisher acros",
      " s two physical lines",
      "ATTENDEE;CN=Somebody:mailto:somebody@example.test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const [parsed] = parseIcs(feed);
    expect(parsed?.uid).toBe("ok@example");
    // Unfolded before it was read, so the summary is one string.
    expect(parsed?.summary).toContain("across two physical lines");
  });

  it("drops an event with no times rather than inventing them", () => {
    const feed = ["BEGIN:VEVENT", "UID:nothing@example", "END:VEVENT"].join("\r\n");
    expect(parseIcs(feed)).toEqual([]);
  });
});

describe.runIf(hasDatabase)("bookings and their reflections", { timeout: 60_000 }, () => {
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

  /** A calendar linked to a synced upstream one. */
  async function linkedCalendar() {
    const calendar = await createCalendar.call(
      { kind: "resource", name: "The chair", timezone: "UTC" },
      OWNER,
    );
    await setAvailability.call(
      {
        calendarId: calendar.id,
        rules: [{ weekday: 1, starts: "09:00", ends: "17:00", kind: "bookable" }],
      },
      OWNER,
    );
    await setServiceCalendars.call(
      {
        serviceOfferingId: SERVICE,
        members: [{ calendarId: calendar.id, role: "primary", priority: 0 }],
      },
      OWNER,
    );
    await db().insert(connectedAccounts).values({
      id: ACCOUNT,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "writeback-account",
      email: "owner@example.test",
      status: "active",
      sharedWithBusiness: true,
    });
    const [synced] = await db()
      .insert(externalCalendars)
      .values({
        connectedAccountId: ACCOUNT,
        externalId: "primary",
        name: "Owner's own",
        role: "bookable",
      })
      .returning({ id: externalCalendars.id });
    await updateCalendar.call({ id: calendar.id, externalCalendarId: synced!.id }, OWNER);
    return { calendar, syncedId: synced!.id };
  }

  async function slots() {
    return db().transaction((tx) =>
      resolveSlots(tx, {
        serviceOfferingId: SERVICE,
        from: MONDAY,
        to: MONDAY,
        timezone: "UTC",
        durationMin: 60,
        granularityMin: 60,
        now: NOW,
      }),
    );
  }

  it("stops a booking blocking its own hour twice", async () => {
    const { calendar, syncedId } = await linkedCalendar();
    const booking = await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T11:00:00.000Z`,
        endsAt: `${MONDAY}T12:00:00.000Z`,
      },
      OWNER,
    );
    // As if it had been written upstream and synced back.
    await db()
      .update(bookings)
      .set({ providerEventRef: "google-event-1" })
      .where(eq(bookings.id, booking.id));
    await db().insert(externalEvents).values({
      externalCalendarId: syncedId,
      externalId: "google-event-1",
      startsAt: new Date(`${MONDAY}T11:00:00.000Z`),
      endsAt: new Date(`${MONDAY}T12:00:00.000Z`),
      busy: true,
    });

    const claimed = await db().transaction((tx) => reconcileMirroredBookings(tx));
    expect(claimed.claimed).toBe(1);
    const [reflection] = await db().select().from(externalEvents);
    expect(reflection?.bookingId).toBe(booking.id);

    // Eleven is blocked once, by the booking. The reflection is ignored.
    const found = await slots();
    expect(found.some((slot) => slot.startsAt.toISOString().includes("T11:00"))).toBe(false);
    expect(found.some((slot) => slot.startsAt.toISOString().includes("T10:00"))).toBe(true);
  });

  it("does not claim somebody else's appointment", async () => {
    const { calendar, syncedId } = await linkedCalendar();
    await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T11:00:00.000Z`,
        endsAt: `${MONDAY}T12:00:00.000Z`,
      },
      OWNER,
    );
    // A real appointment of the owner's, with a different provider id.
    await db().insert(externalEvents).values({
      externalCalendarId: syncedId,
      externalId: "somebody-elses-event",
      startsAt: new Date(`${MONDAY}T14:00:00.000Z`),
      endsAt: new Date(`${MONDAY}T15:00:00.000Z`),
      busy: true,
    });

    await db().transaction((tx) => reconcileMirroredBookings(tx));
    const [event] = await db().select().from(externalEvents);
    // Matching is by the provider's own id. A looser rule would claim a real
    // appointment and tell the owner an occupied hour is free.
    expect(event?.bookingId).toBeNull();
    expect((await slots()).some((slot) => slot.startsAt.toISOString().includes("T14:00"))).toBe(
      false,
    );
  });

  it("blocks time from a published feed with no provider at all", async () => {
    const { calendar } = await linkedCalendar();
    // §4.4: the ICS path works with no adapter. An owner who connected
    // nothing still has their other diary respected.
    await db().insert(externalBusyBlocks).values({
      calendarId: calendar.id,
      sourceRef: "external-uid-1",
      source: "ics",
      startsAt: new Date(`${MONDAY}T13:00:00.000Z`),
      endsAt: new Date(`${MONDAY}T14:00:00.000Z`),
      busy: true,
    });
    const found = await slots();
    expect(found.some((slot) => slot.startsAt.toISOString().includes("T13:00"))).toBe(false);
    expect(found.some((slot) => slot.startsAt.toISOString().includes("T12:00"))).toBe(true);
  });

  it("ignores an imported block marked free", async () => {
    const { calendar } = await linkedCalendar();
    await db().insert(externalBusyBlocks).values({
      calendarId: calendar.id,
      sourceRef: "transparent-uid",
      source: "ics",
      startsAt: new Date(`${MONDAY}T13:00:00.000Z`),
      endsAt: new Date(`${MONDAY}T14:00:00.000Z`),
      busy: false,
    });
    expect(
      (await slots()).some((slot) => slot.startsAt.toISOString().includes("T13:00")),
    ).toBe(true);
  });

  it("publishes a feed that a calendar app can read, and hides it behind its token", async () => {
    const { calendar } = await linkedCalendar();
    await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "rae@example.test", name: "Rae Lane" },
        startsAt: `${MONDAY}T09:00:00.000Z`,
        endsAt: `${MONDAY}T10:00:00.000Z`,
      },
      OWNER,
    );

    const { issueCalendarFeed, calendarFeed } = await import(
      "@/core/scheduling/ics-service"
    );
    const issued = await issueCalendarFeed.call({ id: calendar.id }, {
      ...OWNER,
      security: {
        twoFactorRequired: false,
        twoFactorEnrolled: false,
        twoFactorVerified: false,
        stepUpValid: true,
      },
    });

    const feed = await calendarFeed.call({ token: issued.token }, { kind: "anonymous" });
    expect(feed?.body).toContain("BEGIN:VCALENDAR");
    expect(feed?.body).toContain("Rae Lane");
    expect(parseIcs(feed!.body)).toHaveLength(1);

    // A token nobody issued answers the same way a revoked one does.
    expect(
      await calendarFeed.call({ token: "not-a-real-token-at-all" }, { kind: "anonymous" }),
    ).toBeNull();
  });

  it("gives the customer their own appointment without the owner's notes", async () => {
    const { calendar } = await linkedCalendar();
    await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "rae@example.test", name: "Rae Lane" },
        startsAt: `${MONDAY}T09:00:00.000Z`,
        endsAt: `${MONDAY}T10:00:00.000Z`,
        notes: "Difficult client, allow extra time",
      },
      OWNER,
    );
    const [row] = await db().select().from(bookings);
    const { bookingIcs } = await import("@/core/scheduling/ics-service");
    const attachment = await bookingIcs.call(
      { token: row!.rescheduleToken! },
      { kind: "anonymous" },
    );
    expect(attachment?.body).toContain("BEGIN:VEVENT");
    // The owner wrote that note for themselves.
    expect(attachment?.body).not.toContain("Difficult client");
  });

  it("tells a subscribed client to remove a cancelled appointment", async () => {
    const { calendar } = await linkedCalendar();
    const booking = await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T09:00:00.000Z`,
        endsAt: `${MONDAY}T10:00:00.000Z`,
      },
      OWNER,
    );
    const { setBookingStatus } = await import("@/core/scheduling/bookings");
    await setBookingStatus.call(
      { id: booking.id, status: "cancelled", reason: "Changed their mind." },
      OWNER,
    );
    const [row] = await db().select().from(bookings).where(eq(bookings.id, booking.id));
    const { bookingIcs } = await import("@/core/scheduling/ics-service");
    const attachment = await bookingIcs.call(
      { token: row!.rescheduleToken! },
      { kind: "anonymous" },
    );
    // A stale block left in somebody's week is worse than no attachment.
    expect(attachment?.body).toContain("STATUS:CANCELLED");
    expect(attachment?.body).toContain("METHOD:CANCEL");
  });

  it("keeps a cancelled appointment out of the owner's feed", async () => {
    const { calendar } = await linkedCalendar();
    const booking = await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T09:00:00.000Z`,
        endsAt: `${MONDAY}T10:00:00.000Z`,
      },
      OWNER,
    );
    const { setBookingStatus } = await import("@/core/scheduling/bookings");
    await setBookingStatus.call(
      { id: booking.id, status: "cancelled", reason: "Changed their mind." },
      OWNER,
    );
    const { issueCalendarFeed, calendarFeed } = await import(
      "@/core/scheduling/ics-service"
    );
    const issued = await issueCalendarFeed.call({ id: calendar.id }, {
      ...OWNER,
      security: {
        twoFactorRequired: false,
        twoFactorEnrolled: false,
        twoFactorVerified: false,
        stepUpValid: true,
      },
    });
    const feed = await calendarFeed.call({ token: issued.token }, { kind: "anonymous" });
    expect(parseIcs(feed!.body)).toEqual([]);
  });

  it("forgets what a removed feed was blocking", async () => {
    const { calendar } = await linkedCalendar();
    await db().insert(externalBusyBlocks).values({
      calendarId: calendar.id,
      sourceRef: "external-uid-1",
      source: "ics",
      startsAt: new Date(`${MONDAY}T13:00:00.000Z`),
      endsAt: new Date(`${MONDAY}T14:00:00.000Z`),
      busy: true,
    });
    const { setCalendarImport } = await import("@/core/scheduling/ics-service");
    await setCalendarImport.call({ id: calendar.id, url: null }, OWNER);
    // Otherwise an owner who removed a calendar keeps being busy at times
    // nothing on the screen explains.
    expect(await db().select().from(externalBusyBlocks)).toHaveLength(0);
  });

  it("insists an imported feed is fetched over a channel nobody can rewrite", async () => {
    const { calendar } = await linkedCalendar();
    const { setCalendarImport } = await import("@/core/scheduling/ics-service");
    const { failure } = await import("../helpers/spine");
    const refused = await failure(
      setCalendarImport.call(
        { id: calendar.id, url: "http://calendar.example.test/feed.ics" },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
  });
});
