// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What may be booked on a calendar (C6.02, MASTER.md §4.4).
//
// Availability is computed, never stored, so the tests that matter are the
// ones where computing it is easy to get wrong: an override that has to beat a
// pattern, a contradiction that has to fail safe, and the two mornings a year
// that are not where the clock says they are.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/core/auth/schema";
import { availabilityRules } from "@/core/scheduling/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar } from "@/core/scheduling/service";
import {
  addAvailabilityException,
  calendarOpenWindows,
  copyAvailabilityToDays,
  listAvailability,
  removeAvailabilityException,
  setAvailability,
} from "@/core/scheduling/availability-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

// 2026-09-14 is a Monday; 2026-09-15 a Tuesday.
const MONDAY = "2026-09-14";
const TUESDAY = "2026-09-15";

describe.runIf(hasDatabase)("availability", { timeout: 60_000 }, () => {
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

  async function calendar(timezone = "Europe/London") {
    return createCalendar.call(
      { kind: "resource", name: `Studio ${timezone}`, timezone },
      OWNER,
    );
  }

  async function weekdayHours(calendarId: string, weekday: number) {
    await setAvailability.call(
      {
        calendarId,
        rules: [{ weekday, starts: "09:00", ends: "17:00", kind: "bookable" }],
      },
      OWNER,
    );
  }

  it("turns a weekly rule into the hours of an actual day", async () => {
    const studio = await calendar("UTC");
    await weekdayHours(studio.id, 1);
    const windows = await calendarOpenWindows.call(
      { calendarId: studio.id, from: MONDAY, to: TUESDAY },
      OWNER,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.startsAt.toISOString()).toBe("2026-09-14T09:00:00.000Z");
    expect(windows[0]?.endsAt.toISOString()).toBe("2026-09-14T17:00:00.000Z");
  });

  it("joins two rules that meet, so a slot across the join is not lost", async () => {
    const studio = await calendar("UTC");
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [
          { weekday: 1, starts: "09:00", ends: "12:00", kind: "bookable" },
          { weekday: 1, starts: "12:00", ends: "17:00", kind: "bookable" },
        ],
      },
      OWNER,
    );
    const windows = await calendarOpenWindows.call(
      { calendarId: studio.id, from: MONDAY, to: MONDAY },
      OWNER,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.endsAt.toISOString()).toBe("2026-09-14T17:00:00.000Z");
  });

  it("lets a closure beat the pattern", async () => {
    const studio = await calendar("UTC");
    await weekdayHours(studio.id, 1);
    await addAvailabilityException.call(
      { calendarId: studio.id, startsOn: MONDAY, kind: "closed", reason: "Bank holiday" },
      OWNER,
    );
    // An owner writing "closed on the 14th" has said something more specific
    // than their Monday hours.
    expect(
      await calendarOpenWindows.call(
        { calendarId: studio.id, from: MONDAY, to: MONDAY },
        OWNER,
      ),
    ).toEqual([]);
  });

  it("replaces the pattern on a reduced day rather than adding to it", async () => {
    const studio = await calendar("UTC");
    await weekdayHours(studio.id, 1);
    await addAvailabilityException.call(
      {
        calendarId: studio.id,
        startsOn: MONDAY,
        kind: "reduced",
        starts: "13:00",
        ends: "16:00",
        reason: "Training in the morning",
      },
      OWNER,
    );
    const windows = await calendarOpenWindows.call(
      { calendarId: studio.id, from: MONDAY, to: MONDAY },
      OWNER,
    );
    // Reduced means reduced: 09:00 must not survive alongside it.
    expect(windows).toHaveLength(1);
    expect(windows[0]?.startsAt.toISOString()).toBe("2026-09-14T13:00:00.000Z");
    expect(windows[0]?.endsAt.toISOString()).toBe("2026-09-14T16:00:00.000Z");
  });

  it("opens a day the pattern never covered", async () => {
    const studio = await calendar("UTC");
    await weekdayHours(studio.id, 1);
    // A Saturday nobody normally works.
    await addAvailabilityException.call(
      {
        calendarId: studio.id,
        startsOn: "2026-09-19",
        kind: "open",
        starts: "10:00",
        ends: "14:00",
      },
      OWNER,
    );
    const windows = await calendarOpenWindows.call(
      { calendarId: studio.id, from: "2026-09-19", to: "2026-09-19" },
      OWNER,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.startsAt.toISOString()).toBe("2026-09-19T10:00:00.000Z");
  });

  it("shuts the day when somebody has written both a closure and an opening", async () => {
    const studio = await calendar("UTC");
    await weekdayHours(studio.id, 1);
    await addAvailabilityException.call(
      { calendarId: studio.id, startsOn: MONDAY, kind: "closed" },
      OWNER,
    );
    await addAvailabilityException.call(
      { calendarId: studio.id, startsOn: MONDAY, kind: "open", starts: "10:00", ends: "12:00" },
      OWNER,
    );
    // A contradiction about being open resolves the way that does not take a
    // booking somebody cannot honour.
    expect(
      await calendarOpenWindows.call(
        { calendarId: studio.id, from: MONDAY, to: MONDAY },
        OWNER,
      ),
    ).toEqual([]);
  });

  it("covers every day of a multi-day closure", async () => {
    const studio = await calendar("UTC");
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          starts: "09:00",
          ends: "17:00",
          kind: "bookable" as const,
        })),
      },
      OWNER,
    );
    await addAvailabilityException.call(
      {
        calendarId: studio.id,
        startsOn: "2026-12-24",
        endsOn: "2027-01-02",
        kind: "closed",
        reason: "Christmas",
      },
      OWNER,
    );
    const windows = await calendarOpenWindows.call(
      { calendarId: studio.id, from: "2026-12-23", to: "2027-01-03" },
      OWNER,
    );
    // Open either side, shut for all ten days between, including across the
    // year boundary.
    expect(windows).toHaveLength(2);
    expect(windows[0]?.startsAt.toISOString().slice(0, 10)).toBe("2026-12-23");
    expect(windows[1]?.startsAt.toISOString().slice(0, 10)).toBe("2027-01-03");
  });

  it("keeps nine in the morning at nine when the clocks change", async () => {
    const studio = await calendar("America/New_York");
    // 2026-03-08 is the Sunday the clocks go forward in New York.
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [
          { weekday: 6, starts: "09:00", ends: "17:00", kind: "bookable" },
          { weekday: 1, starts: "09:00", ends: "17:00", kind: "bookable" },
        ],
      },
      OWNER,
    );
    const windows = await calendarOpenWindows.call(
      { calendarId: studio.id, from: "2026-03-07", to: "2026-03-09" },
      OWNER,
    );
    // The Saturday before is 14:00Z; the Monday after is 13:00Z. Both are nine
    // in the morning to the person opening the door, which is the whole reason
    // hours are stored as local times.
    expect(windows[0]?.startsAt.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(windows[1]?.startsAt.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("only reports the kinds that were asked for", async () => {
    const studio = await calendar("UTC");
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [
          { weekday: 1, starts: "09:00", ends: "17:00", kind: "bookable" },
          { weekday: 1, starts: "17:00", ends: "22:00", kind: "on_call" },
        ],
      },
      OWNER,
    );
    // An on-call window is real availability to somebody planning cover, and
    // it is not a slot on a booking page.
    const bookable = await calendarOpenWindows.call(
      { calendarId: studio.id, from: MONDAY, to: MONDAY },
      OWNER,
    );
    expect(bookable).toHaveLength(1);
    expect(bookable[0]?.endsAt.toISOString()).toBe("2026-09-14T17:00:00.000Z");

    const both = await calendarOpenWindows.call(
      { calendarId: studio.id, from: MONDAY, to: MONDAY, kinds: ["bookable", "on_call"] },
      OWNER,
    );
    // Different kinds are not merged even where they touch: they mean
    // different things to whoever is reading them.
    expect(both).toHaveLength(2);
  });

  it("honours the dates a rule is effective between", async () => {
    const studio = await calendar("UTC");
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [
          {
            weekday: 1,
            starts: "09:00",
            ends: "17:00",
            kind: "bookable",
            effectiveFrom: "2026-06-01",
            effectiveTo: "2026-08-31",
          },
        ],
      },
      OWNER,
    );
    // Summer hours that have ended.
    expect(
      await calendarOpenWindows.call(
        { calendarId: studio.id, from: MONDAY, to: MONDAY },
        OWNER,
      ),
    ).toEqual([]);
    expect(
      await calendarOpenWindows.call(
        { calendarId: studio.id, from: "2026-08-31", to: "2026-08-31" },
        OWNER,
      ),
    ).toHaveLength(1);
  });

  it("replaces a week rather than merging into it", async () => {
    const studio = await calendar("UTC");
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [
          { weekday: 1, starts: "09:00", ends: "17:00", kind: "bookable" },
          { weekday: 4, starts: "09:00", ends: "17:00", kind: "bookable" },
        ],
      },
      OWNER,
    );
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [{ weekday: 1, starts: "09:00", ends: "17:00", kind: "bookable" }],
      },
      OWNER,
    );
    // A Thursday somebody deleted must not still be open.
    expect(await db().select().from(availabilityRules)).toHaveLength(1);
  });

  it("copies a day's hours onto the days that share them", async () => {
    const studio = await calendar("UTC");
    await weekdayHours(studio.id, 1);
    const copied = await copyAvailabilityToDays.call(
      { calendarId: studio.id, fromWeekday: 1, toWeekdays: [2, 3, 4, 5] },
      OWNER,
    );
    expect(copied.copied).toBe(4);
    const { rules } = await listAvailability.call({ calendarId: studio.id }, OWNER);
    expect(rules.map((rule) => rule.weekday).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("takes back an exception when it turns out to be wrong", async () => {
    const studio = await calendar("UTC");
    await weekdayHours(studio.id, 1);
    const closure = await addAvailabilityException.call(
      { calendarId: studio.id, startsOn: MONDAY, kind: "closed" },
      OWNER,
    );
    await removeAvailabilityException.call({ id: closure.id }, OWNER);
    expect(
      await calendarOpenWindows.call(
        { calendarId: studio.id, from: MONDAY, to: MONDAY },
        OWNER,
      ),
    ).toHaveLength(1);
  });

  it("refuses hours it cannot mean", async () => {
    const studio = await calendar("UTC");
    // An overnight shift is two rules, not one that ends before it starts.
    expect(
      (
        await failure(
          setAvailability.call(
            {
              calendarId: studio.id,
              rules: [{ weekday: 1, starts: "22:00", ends: "02:00", kind: "bookable" }],
            },
            OWNER,
          ),
        )
      ).message,
    ).toContain("Split a shift");

    expect(
      (
        await failure(
          addAvailabilityException.call(
            { calendarId: studio.id, startsOn: MONDAY, kind: "closed", starts: "09:00" },
            OWNER,
          ),
        )
      ).message,
    ).toContain("A closure has no hours");

    expect(
      (
        await failure(
          addAvailabilityException.call(
            { calendarId: studio.id, startsOn: MONDAY, kind: "reduced" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
  });
});
