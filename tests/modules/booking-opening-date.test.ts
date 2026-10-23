// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: the day /book (and the embed and the reschedule flow, which render
// the same page) opens on when the address names none.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { openingDate, OPENING_WINDOW_DAYS } from "../../app/(public)/book/opening-date";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar, setServiceCalendars } from "@/core/scheduling/service";
import { setAvailability } from "@/core/scheduling/availability-service";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { createAudience, setAudienceServices } from "@/core/scheduling/audiences";
import { createProduct, upsertServiceOffering } from "@/modules/catalog/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("the day /book opens on", () => {
  const none = async () => undefined;

  it("is the business's today in a zone behind UTC, not UTC's tomorrow", async () => {
    // 05:30 UTC on the 23rd is 22:30 on the 22nd in Vancouver.
    const now = new Date("2026-10-23T05:30:00.000Z");
    expect(await openingDate(undefined, "America/Vancouver", none, now)).toBe("2026-10-22");
    expect(await openingDate(undefined, "America/Vancouver", undefined, now)).toBe("2026-10-22");
  });

  it("is the business's today in a zone ahead of UTC, not UTC's yesterday", async () => {
    // 12:30 UTC on the 23rd is 01:30 on the 24th in Auckland.
    const now = new Date("2026-10-23T12:30:00.000Z");
    expect(await openingDate(undefined, "Pacific/Auckland", none, now)).toBe("2026-10-24");
  });

  it("asks once, over the window, starting at the business's today", async () => {
    const asked: [string, string][] = [];
    const now = new Date("2026-10-23T05:30:00.000Z");
    await openingDate(undefined, "America/Vancouver", async (from, to) => {
      asked.push([from, to]);
      return undefined;
    }, now);
    expect(asked).toEqual([["2026-10-22", "2026-12-20"]]);
    expect(OPENING_WINDOW_DAYS).toBe(60);
  });

  it("dates the first free time in the business's zone", async () => {
    // 03:00 UTC on the 26th is still the evening of the 25th in Vancouver.
    const now = new Date("2026-10-23T05:30:00.000Z");
    const first = async () => ({ startsAt: new Date("2026-10-26T03:00:00.000Z") });
    expect(await openingDate(undefined, "America/Vancouver", first, now)).toBe("2026-10-25");
  });

  it("falls back to today when nothing is free in the window, or the search fails", async () => {
    const now = new Date("2026-10-23T12:30:00.000Z");
    expect(await openingDate(undefined, "Pacific/Auckland", none, now)).toBe("2026-10-24");
    const broken = async () => { throw new Error("catalog not installed"); };
    expect(await openingDate(undefined, "Pacific/Auckland", broken, now)).toBe("2026-10-24");
  });

  it("always respects an explicit date, without searching", async () => {
    let searched = false;
    const first = async () => { searched = true; return { startsAt: new Date("2026-10-30T17:00:00.000Z") }; };
    expect(await openingDate("2026-11-05", "America/Vancouver", first)).toBe("2026-11-05");
    expect(searched).toBe(false);
    // Not a date: treated as absent.
    expect(await openingDate("next tuesday", "UTC", first, new Date("2026-10-23T00:00:00Z"))).toBe("2026-10-30");
  });
});

describe.runIf(hasDatabase)("the day /book opens on, against the slot service", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" }).onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  /** A public service whose one calendar opens only on the given UTC weekdays. */
  async function service(weekdays: number[]) {
    const calendar = await createCalendar.call({ kind: "resource", name: "Chair", timezone: "UTC" }, OWNER);
    await setAvailability.call({
      calendarId: calendar.id,
      rules: weekdays.map((weekday) => ({ weekday, starts: "09:00", ends: "17:00", kind: "bookable" as const })),
    }, OWNER);
    const product = await createProduct.call({ name: "Consultation", slug: "consultation", kind: "service" }, OWNER);
    const offering = await upsertServiceOffering.call({ productId: product.id, durationMin: 60, locationType: "in_person" }, OWNER);
    await setServiceCalendars.call({ serviceOfferingId: offering.id, members: [{ calendarId: calendar.id, role: "primary", priority: 0 }] }, OWNER);
    const audience = await createAudience.call({ name: "Public", who: "public", hours: "calendar" }, OWNER);
    await setAudienceServices.call({ id: audience.id, serviceOfferingIds: [offering.id] }, OWNER);
    // Exactly what the page passes: one ranged ask, earliest time only.
    return async (from: string, to: string) =>
      (await availableSlots.call({ productId: product.id, serviceOfferingId: offering.id, from, to, seats: 1, limit: 1 }, ANONYMOUS))[0];
  }

  const inDays = (days: number) => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + days);
    return day;
  };

  it("opens three days out when today has no times and that day does", async () => {
    const target = inDays(3);
    const first = await service([target.getUTCDay()]);
    expect(await openingDate(undefined, "UTC", first)).toBe(target.toISOString().slice(0, 10));
  });

  it("opens on today when nothing is free in the window", async () => {
    // The calendar has no open hours at all: nothing is free.
    const first = await service([]);
    expect(await openingDate(undefined, "UTC", first)).toBe(new Date().toISOString().slice(0, 10));
  });

  it("keeps an explicit date even when an earlier one is free", async () => {
    const first = await service([0, 1, 2, 3, 4, 5, 6]);
    const later = inDays(20).toISOString().slice(0, 10);
    expect(await openingDate(later, "UTC", first)).toBe(later);
  });
});
