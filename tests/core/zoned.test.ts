// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Wall clock to instant (MASTER.md §4.9, C4.13). The whole reason this exists
// is the two days a year when a day is not 24 hours long.
import { describe, expect, it } from "vitest";
import { addDays, zonedDate, zonedInstant, zoneOffsetMs } from "@/core/i18n/zoned";

const NEW_YORK = "America/New_York";
const HOUR = 3_600_000;

function localReading(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

describe("zoned time", () => {
  it("reports how far ahead of UTC a zone is, on each side of a change", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), NEW_YORK)).toBe(-5 * HOUR);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), NEW_YORK)).toBe(-4 * HOUR);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "UTC")).toBe(0);
  });

  it("finds the instant a zone's clock reads a given midnight", () => {
    expect(zonedInstant(NEW_YORK, { year: 2026, month: 1, day: 15 }).toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
    expect(zonedInstant(NEW_YORK, { year: 2026, month: 7, day: 15 }).toISOString()).toBe(
      "2026-07-15T04:00:00.000Z",
    );
  });

  it("makes the short day 23 hours and the long day 25", () => {
    // The two days a calendar drawn on a 24-hour assumption is wrong by an
    // hour for every block on it.
    const springStart = zonedInstant(NEW_YORK, { year: 2026, month: 3, day: 8 });
    const springEnd = zonedInstant(NEW_YORK, { year: 2026, month: 3, day: 9 });
    expect(springEnd.getTime() - springStart.getTime()).toBe(23 * HOUR);

    const autumnStart = zonedInstant(NEW_YORK, { year: 2026, month: 11, day: 1 });
    const autumnEnd = zonedInstant(NEW_YORK, { year: 2026, month: 11, day: 2 });
    expect(autumnEnd.getTime() - autumnStart.getTime()).toBe(25 * HOUR);
  });

  it("answers an hour the clock skipped with a real instant after the gap", () => {
    // 02:30 did not happen in New York that morning. The wrong answer is
    // 01:30, an hour early, which would start a day before the day began.
    const skipped = zonedInstant(NEW_YORK, {
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
    });
    expect(localReading(skipped, NEW_YORK)).toBe("2026-03-08, 03:30");
  });

  it("keeps a zone's own calendar date, not the server's", () => {
    // Late evening in New York is already tomorrow in UTC. A week laid out
    // from the wrong one of those is a week out by a day.
    const evening = new Date("2026-06-02T02:00:00Z");
    expect(zonedDate(evening, NEW_YORK)).toEqual({ year: 2026, month: 6, day: 1 });
    expect(zonedDate(evening, "UTC")).toEqual({ year: 2026, month: 6, day: 2 });
  });

  it("moves whole calendar days across month and year ends", () => {
    expect(addDays({ year: 2026, month: 12, day: 30 }, 3)).toEqual({
      year: 2027,
      month: 1,
      day: 2,
    });
    expect(addDays({ year: 2028, month: 3, day: 1 }, -1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });
});
