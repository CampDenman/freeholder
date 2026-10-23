// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: the day /book (and the embed and the reschedule flow, which render
// the same page) opens on when the address names none, and the times on it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bookingDay,
  openingDate,
  OPENING_CACHE_MS,
  resetOpeningDateCache,
  type DaySearch,
} from "../../app/(public)/book/opening-date";
import { businessDayBounds, isCalendarDate } from "@/core/scheduling/business-day";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar, setServiceCalendars } from "@/core/scheduling/service";
import { setAvailability } from "@/core/scheduling/availability-service";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { createAudience, setAudienceServices } from "@/core/scheduling/audiences";
import { getBusiness, updateBusiness } from "@/core/settings/service";
import { createProduct, upsertServiceOffering } from "@/modules/catalog/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const none = async () => undefined;
// 05:30 UTC on the 23rd is 22:30 on the 22nd in Los Angeles.
const PACIFIC_EVENING = new Date("2026-10-23T05:30:00.000Z");
// 12:30 UTC on the 23rd is 01:30 on the 24th in Auckland.
const AUCKLAND_NIGHT = new Date("2026-10-23T12:30:00.000Z");

describe("the day /book opens on", () => {
  beforeEach(() => resetOpeningDateCache());

  it("is the business's today in a zone behind UTC, not UTC's tomorrow", async () => {
    expect(await openingDate({ zone: "America/Los_Angeles", firstSlot: none, now: PACIFIC_EVENING })).toBe("2026-10-22");
    expect(await openingDate({ zone: "America/Los_Angeles", now: PACIFIC_EVENING })).toBe("2026-10-22");
  });

  it("is the business's today in a zone ahead of UTC, not UTC's yesterday", async () => {
    expect(await openingDate({ zone: "Pacific/Auckland", firstSlot: none, now: AUCKLAND_NIGHT })).toBe("2026-10-24");
  });

  it("looks at a week first and widens to the whole window only when it is empty", async () => {
    const asked: [string, string][] = [];
    await openingDate({ zone: "America/Los_Angeles", now: PACIFIC_EVENING, firstSlot: async (from, to) => { asked.push([from, to]); return undefined; } });
    // From the day before today: a calendar behind the business holds the
    // start of the business's today on its own yesterday.
    expect(asked).toEqual([["2026-10-21", "2026-10-28"], ["2026-10-21", "2026-12-20"]]);

    asked.length = 0;
    await openingDate({ zone: "America/Los_Angeles", now: PACIFIC_EVENING, firstSlot: async (from, to) => { asked.push([from, to]); return { startsAt: new Date("2026-10-25T17:00:00Z") }; } });
    expect(asked).toEqual([["2026-10-21", "2026-10-28"]]);
  });

  it("dates the first free time in the business's zone", async () => {
    // 03:00 UTC on the 26th is still the evening of the 25th in Los Angeles.
    const first = async () => ({ startsAt: new Date("2026-10-26T03:00:00.000Z") });
    expect(await openingDate({ zone: "America/Los_Angeles", firstSlot: first, now: PACIFIC_EVENING })).toBe("2026-10-25");
  });

  it("falls back to today when nothing is free in the window, or the search fails", async () => {
    expect(await openingDate({ zone: "Pacific/Auckland", firstSlot: none, now: AUCKLAND_NIGHT })).toBe("2026-10-24");
    let asks = 0;
    const broken = async () => { asks += 1; throw new Error("catalog not installed"); };
    expect(await openingDate({ zone: "Pacific/Auckland", firstSlot: broken, now: AUCKLAND_NIGHT, cacheKey: "k" })).toBe("2026-10-24");
    // A failure neither widens the search nor is remembered.
    expect(asks).toBe(1);
    await openingDate({ zone: "Pacific/Auckland", firstSlot: broken, now: AUCKLAND_NIGHT, cacheKey: "k" });
    expect(asks).toBe(2);
  });

  it("always respects a real explicit date, without searching", async () => {
    let searched = 0;
    const first = async () => { searched += 1; return { startsAt: new Date("2026-10-30T17:00:00.000Z") }; };
    expect(await openingDate({ requested: "2026-11-05", zone: "America/Los_Angeles", firstSlot: first })).toBe("2026-11-05");
    expect(searched).toBe(0);
    // Not a date, or a date that does not exist: treated as absent.
    for (const requested of ["next tuesday", "2026-02-31", "2026-13-01", "2026-00-10"]) {
      expect(await openingDate({ requested, zone: "UTC", firstSlot: first, now: new Date("2026-10-23T00:00:00Z") })).toBe("2026-10-30");
    }
    expect(searched).toBe(4);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
  });

  it("reuses an answer for a minute, per question, and then asks again", async () => {
    let asks = 0;
    const counted = async () => { asks += 1; return undefined; };
    const at = (ms: number) => new Date(PACIFIC_EVENING.getTime() + ms);
    const ask = (cacheKey: string, ms = 0) => openingDate({ zone: "America/Los_Angeles", firstSlot: counted, now: at(ms), cacheKey });
    await ask("svc|seats:1");
    expect(asks).toBe(2); // a fully booked service: week, then window
    await ask("svc|seats:1", OPENING_CACHE_MS - 1);
    expect(asks).toBe(2);
    await ask("svc|seats:2", 1);
    expect(asks).toBe(4);
    await ask("svc|seats:1", OPENING_CACHE_MS);
    expect(asks).toBe(6);
  });
});

describe("the /book page's wiring", () => {
  beforeEach(() => resetOpeningDateCache());
  const service = { productId: "00000000-0000-4000-8000-0000000000a1", offeringId: "00000000-0000-4000-8000-0000000000a2" };
  const MOVE = "00000000-0000-4000-8000-0000000000a3";

  function recorder(slots: { startsAt: Date }[] = []) {
    const inputs: DaySearch[] = [];
    return { inputs, search: async (input: (typeof inputs)[number]) => { inputs.push(input); return slots; } };
  }

  it("asks with the moving booking excluded, and never caches a move", async () => {
    const { inputs, search } = recorder();
    for (let i = 0; i < 2; i++) {
      await bookingDay({ zone: "America/Los_Angeles", service, seats: 2, move: MOVE, anonymous: false, search, now: PACIFIC_EVENING });
    }
    // Week, window and the day view, twice over: nothing reused.
    expect(inputs).toHaveLength(6);
    for (const input of inputs) {
      expect(input).toMatchObject({ productId: service.productId, serviceOfferingId: service.offeringId, seats: 2, excludeBookingId: MOVE });
    }
  });

  it("caches an anonymous visitor's opening date, but not a signed-in customer's", async () => {
    const anonymous = recorder();
    for (let i = 0; i < 2; i++) await bookingDay({ zone: "UTC", service, seats: 1, anonymous: true, search: anonymous.search, now: PACIFIC_EVENING });
    expect(anonymous.inputs.filter((input) => input.limit === 1)).toHaveLength(2);
    expect(anonymous.inputs.every((input) => !("excludeBookingId" in input))).toBe(true);
    const signedIn = recorder();
    for (let i = 0; i < 2; i++) await bookingDay({ zone: "UTC", service, seats: 1, anonymous: false, search: signedIn.search, now: PACIFIC_EVENING });
    expect(signedIn.inputs.filter((input) => input.limit === 1)).toHaveLength(4);
  });

  it("shows the business's day: asks the calendar days around it and keeps only its own times", async () => {
    const slots = [
      { startsAt: new Date("2026-10-25T06:30:00Z") }, // 24th, 23:30 in Los Angeles
      { startsAt: new Date("2026-10-25T07:00:00Z") }, // 25th, 00:00
      { startsAt: new Date("2026-10-26T03:00:00Z") }, // 25th, 20:00
      { startsAt: new Date("2026-10-26T07:00:00Z") }, // 26th, 00:00
    ];
    const { inputs, search } = recorder(slots);
    const day = await bookingDay({ requested: "2026-10-25", zone: "America/Los_Angeles", service, seats: 1, anonymous: true, search });
    expect(inputs).toEqual([{
      productId: service.productId, serviceOfferingId: service.offeringId, seats: 1,
      from: "2026-10-24", to: "2026-10-26",
      // Cut to the business day inside the service, before the limit counts.
      notBefore: "2026-10-25T07:00:00.000Z", notAfter: "2026-10-26T06:59:59.999Z",
      limit: 500,
    }]);
    expect(day.slots.map((slot) => slot.startsAt.toISOString())).toEqual(["2026-10-25T07:00:00.000Z", "2026-10-26T03:00:00.000Z"]);
  });
});

describe("a business day's bounds", () => {
  it("is 24 hours on an ordinary day", () => {
    expect(businessDayBounds("2026-10-25", "America/Los_Angeles")).toEqual({
      notBefore: new Date("2026-10-25T07:00:00.000Z"),
      notAfter: new Date("2026-10-26T06:59:59.999Z"),
    });
  });

  it("is 25 hours on the day the clocks go back, and 23 on the day they go forward", () => {
    const fallBack = businessDayBounds("2026-11-01", "America/Los_Angeles");
    expect(fallBack).toEqual({ notBefore: new Date("2026-11-01T07:00:00.000Z"), notAfter: new Date("2026-11-02T07:59:59.999Z") });
    expect(fallBack.notAfter.getTime() + 1 - fallBack.notBefore.getTime()).toBe(25 * 3_600_000);
    const springForward = businessDayBounds("2026-03-08", "America/Los_Angeles");
    expect(springForward).toEqual({ notBefore: new Date("2026-03-08T08:00:00.000Z"), notAfter: new Date("2026-03-09T06:59:59.999Z") });
    expect(springForward.notAfter.getTime() + 1 - springForward.notBefore.getTime()).toBe(23 * 3_600_000);
  });

  it("dates every instant inside the bounds to that day, and none outside", () => {
    const { notBefore, notAfter } = businessDayBounds("2026-11-01", "America/Los_Angeles");
    const day = (instant: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(instant);
    expect([day(notBefore), day(notAfter)]).toEqual(["2026-11-01", "2026-11-01"]);
    expect(day(new Date(notBefore.getTime() - 1))).toBe("2026-10-31");
    expect(day(new Date(notAfter.getTime() + 1))).toBe("2026-11-02");
  });
});

describe.runIf(hasDatabase)("the day /book opens on, against the slot service", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    resetOpeningDateCache();
    await ready();
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" }).onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  /** A public service whose one UTC calendar opens only on the given UTC weekdays. */
  async function service(weekdays: number[], hours = { starts: "09:00", ends: "17:00" }) {
    const calendar = await createCalendar.call({ kind: "resource", name: "Chair", timezone: "UTC" }, OWNER);
    await setAvailability.call({
      calendarId: calendar.id,
      rules: weekdays.map((weekday) => ({ weekday, ...hours, kind: "bookable" as const })),
    }, OWNER);
    const product = await createProduct.call({ name: "Consultation", slug: "consultation", kind: "service" }, OWNER);
    const offering = await upsertServiceOffering.call({ productId: product.id, durationMin: 60, locationType: "in_person" }, OWNER);
    await setServiceCalendars.call({ serviceOfferingId: offering.id, members: [{ calendarId: calendar.id, role: "primary", priority: 0 }] }, OWNER);
    const audience = await createAudience.call({ name: "Public", who: "public", hours: "calendar" }, OWNER);
    await setAudienceServices.call({ id: audience.id, serviceOfferingIds: [offering.id] }, OWNER);
    return {
      service: { productId: product.id, offeringId: offering.id },
      search: (input: Parameters<typeof availableSlots.call>[0]) => availableSlots.call(input, ANONYMOUS),
    };
  }

  // One clock per test: the page and the expectation must agree on "today"
  // even when the test runs across midnight.
  const inDays = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000);
  const utcDate = (instant: Date) => instant.toISOString().slice(0, 10);

  it("opens three days out when today has no times and that day does", async () => {
    const now = new Date();
    const target = inDays(now, 3);
    const { service: svc, search } = await service([target.getUTCDay()]);
    const day = await bookingDay({ zone: "UTC", service: svc, seats: 1, anonymous: true, search, now });
    expect(day.date).toBe(utcDate(target));
    expect(day.slots.length).toBeGreaterThan(0);
  });

  it("opens on today, saying so, when nothing is free in the window", async () => {
    const now = new Date();
    const { service: svc, search } = await service([]);
    const day = await bookingDay({ zone: "UTC", service: svc, seats: 1, anonymous: true, search, now });
    expect(day).toEqual({ date: utcDate(now), slots: [], unavailable: false });
  });

  it("keeps an explicit date even when an earlier one is free", async () => {
    const now = new Date();
    const { service: svc, search } = await service([0, 1, 2, 3, 4, 5, 6]);
    const later = utcDate(inDays(now, 20));
    const day = await bookingDay({ requested: later, zone: "UTC", service: svc, seats: 1, anonymous: true, search, now });
    expect(day.date).toBe(later);
    expect(day.slots.every((slot) => utcDate(slot.startsAt) === later)).toBe(true);
  });

  it("shows every time of the chosen day for a pool of calendars open at any hour", async () => {
    // Three pool calendars, any hour, fifteen-minute appointments every
    // fifteen minutes: 96 starts a day each, 288 for the day. Asking the three
    // calendar days around it with a limit of 500 once let the day before use
    // up the limit and cut the chosen day at 212 with no error.
    const now = new Date();
    const chosen = utcDate(inDays(now, 5));
    const product = await createProduct.call({ name: "Drop-in", slug: "drop-in", kind: "service" }, OWNER);
    const offering = await upsertServiceOffering.call({ productId: product.id, durationMin: 15, locationType: "in_person", assignment: "pool" }, OWNER);
    const members = [];
    for (const name of ["Ana", "Ben", "Cy"]) {
      const calendar = await createCalendar.call({ kind: "resource", name, timezone: "UTC" }, OWNER);
      members.push({ calendarId: calendar.id, role: "primary" as const, priority: 0 });
    }
    await setServiceCalendars.call({ serviceOfferingId: offering.id, members }, OWNER);
    const audience = await createAudience.call({ name: "Anyone, any time", who: "public", hours: "any" }, OWNER);
    await setAudienceServices.call({ id: audience.id, serviceOfferingIds: [offering.id] }, OWNER);
    const day = await bookingDay({
      requested: chosen, zone: "UTC", service: { productId: product.id, offeringId: offering.id }, seats: 1, anonymous: true, now,
      search: (input) => availableSlots.call({ ...input, granularityMin: 15 }, ANONYMOUS),
    });
    expect(day.slots).toHaveLength(288);
    expect(day.slots.every((slot) => utcDate(slot.startsAt) === chosen)).toBe(true);
    expect(day.slots.at(-1)!.startsAt.toISOString()).toBe(`${chosen}T23:45:00.000Z`);
  });

  it("agrees with the day view when the business and the calendar keep different zones", async () => {
    await updateBusiness.call({ name: "Vancouver studio", country: "CA", baseCurrency: "CAD", timezone: "America/Vancouver", enabledLocales: ["en"] }, OWNER);
    const zone = (await getBusiness.call({}, ANONYMOUS))!.timezone;
    expect(zone).toBe("America/Vancouver");
    const now = new Date();
    // The UTC calendar opens 02:00–04:00 on one UTC date: the evening of the
    // day before, in Vancouver.
    const target = inDays(now, 3);
    const { service: svc, search } = await service([target.getUTCDay()], { starts: "02:00", ends: "04:00" });
    const evening = utcDate(inDays(target, -1));
    // An hour long, every fifteen minutes: 02:00 to 03:00 UTC.
    const times = ["02:00", "02:15", "02:30", "02:45", "03:00"].map((time) => `${utcDate(target)}T${time}:00.000Z`);

    const opened = await bookingDay({ zone, service: svc, seats: 1, anonymous: true, search, now });
    expect(opened.date).toBe(evening);
    expect(opened.slots.map((slot) => slot.startsAt.toISOString())).toEqual(times);

    // The same day asked for explicitly shows the same times, and the
    // calendar's own date for them is not a business day with times.
    const asked = await bookingDay({ requested: evening, zone, service: svc, seats: 1, anonymous: false, search, now });
    expect(asked.slots.map((slot) => slot.startsAt.toISOString())).toEqual(times);
    expect((await bookingDay({ requested: utcDate(target), zone, service: svc, seats: 1, anonymous: false, search, now })).slots).toEqual([]);
  });
});
