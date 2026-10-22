// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Wall clock to instant (MASTER.md §4.9, C4.13). The whole reason this exists
// is the two days a year when a day is not 24 hours long.
import { describe, expect, it } from "vitest";
import {
  addDays,
  addPeriods,
  isTimezone,
  localBuckets,
  localPeriodOf,
  monthsBetween,
  nextOffsetChange,
  startOfPeriod,
  zonedDate,
  zonedInstant,
  zonedWallTime,
  zoneOffsetMs,
} from "@/core/i18n/zoned";

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

// The 2026-10-22 rule (§4.9): local-time math lives in Node and SQL sees UTC
// instants. These are the cases that rule leans on — every zone that keeps
// daylight time has one day a year with an hour that never happened and one
// with an hour that happened twice. Transitions are pinned to dates whose
// rules are settled history, so a tz data update cannot move them.
const at = (
  timezone: string,
  parts: Parameters<typeof zonedInstant>[1],
  repeated?: "earlier" | "later",
) => zonedInstant(timezone, parts, { repeated }).toISOString();

describe("wall time to instant across clock changes", () => {
  it.each([
    // zone, skipped local time, the instant it is read as (after the gap)
    ["America/Vancouver", { year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "2026-03-08T10:30:00.000Z"],
    ["Europe/London", { year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, "2026-03-29T01:30:00.000Z"],
    ["Australia/Sydney", { year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, "2026-10-03T16:30:00.000Z"],
  ])("%s: an hour the clock skipped lands after the gap", (zone, parts, expected) => {
    expect(at(zone, parts)).toBe(expected);
  });

  it.each([
    // zone, repeated local time, first instant, second instant
    ["America/Vancouver", { year: 2025, month: 11, day: 2, hour: 1, minute: 30 }, "2025-11-02T08:30:00.000Z", "2025-11-02T09:30:00.000Z"],
    ["Europe/London", { year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, "2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"],
    ["Australia/Sydney", { year: 2026, month: 4, day: 5, hour: 2, minute: 30 }, "2026-04-04T15:30:00.000Z", "2026-04-04T16:30:00.000Z"],
  ])("%s: an hour the clock repeated resolves deliberately", (zone, parts, earlier, later) => {
    expect(at(zone, parts)).toBe(earlier);
    expect(at(zone, parts, "earlier")).toBe(earlier);
    expect(at(zone, parts, "later")).toBe(later);
  });

  it("has one answer, either way, in a zone with no daylight time", () => {
    const parts = { year: 2026, month: 3, day: 8, hour: 2, minute: 30 };
    expect(at("Asia/Tokyo", parts, "earlier")).toBe("2026-03-07T17:30:00.000Z");
    expect(at("Asia/Tokyo", parts, "later")).toBe("2026-03-07T17:30:00.000Z");
    expect(nextOffsetChange(new Date("2026-01-01T00:00:00Z"), "Asia/Tokyo")).toBeNull();
  });

  it("reads an instant back as the wall clock showed it", () => {
    expect(zonedWallTime(new Date("2025-11-02T09:30:00Z"), "America/Vancouver")).toEqual({
      year: 2025, month: 11, day: 2, hour: 1, minute: 30,
    });
    expect(zonedWallTime(new Date("2026-04-04T16:30:00Z"), "Australia/Sydney")).toEqual({
      year: 2026, month: 4, day: 5, hour: 2, minute: 30,
    });
  });

  it("finds the next clock change to the minute", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(nextOffsetChange(from, "America/Vancouver")?.toISOString()).toBe("2026-03-08T10:00:00.000Z");
    expect(nextOffsetChange(from, "Europe/London")?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(nextOffsetChange(from, "Australia/Sydney")?.toISOString()).toBe("2026-04-04T16:00:00.000Z");
  });

  it("knows a zone Intl knows and refuses one it does not", () => {
    expect(isTimezone("Australia/Sydney")).toBe(true);
    expect(isTimezone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("local periods as UTC boundaries", () => {
  const hours = (bucket: { start: Date; end: Date }) =>
    (bucket.end.getTime() - bucket.start.getTime()) / HOUR;

  it.each([
    ["America/Vancouver", "2026-03-07T12:00:00Z", "2026-03-10T00:00:00Z", [24, 23, 24]],
    ["America/Vancouver", "2025-11-01T12:00:00Z", "2025-11-03T00:00:00Z", [24, 25]],
    ["Europe/London", "2026-10-24T12:00:00Z", "2026-10-26T00:00:00Z", [24, 25]],
    ["Australia/Sydney", "2026-04-04T00:00:00Z", "2026-04-05T12:00:00Z", [24, 25]],
    ["Asia/Tokyo", "2026-03-07T00:00:00Z", "2026-03-09T00:00:00Z", [24, 24, 24]],
  ])("%s: day buckets are as long as the day on the wall", (zone, from, to, lengths) => {
    const buckets = localBuckets(zone, new Date(from), new Date(to), "day");
    expect(buckets.map(hours)).toEqual(lengths);
    // Contiguous: each bucket ends where the next begins, so nothing falls
    // between two days and nothing is counted in both.
    for (let i = 1; i < buckets.length; i += 1) {
      expect(buckets[i]!.start).toEqual(buckets[i - 1]!.end);
    }
  });

  it("starts a month at the zone's midnight, on either side of a change", () => {
    const months = localBuckets(
      "Europe/London",
      new Date("2026-03-15T00:00:00Z"),
      new Date("2026-04-15T00:00:00Z"),
      "month",
    );
    expect(months.map((each) => [each.key, each.start.toISOString()])).toEqual([
      ["2026-03", "2026-03-01T00:00:00.000Z"],
      ["2026-04", "2026-03-31T23:00:00.000Z"],
    ]);
  });

  it("names the local day, not the UTC one", () => {
    // 22:00 UTC is already tomorrow in Sydney and still today in Vancouver.
    const instant = new Date("2026-12-09T22:00:00Z");
    expect(localPeriodOf(instant, "Australia/Sydney", "day").key).toBe("2026-12-10");
    expect(localPeriodOf(instant, "America/Vancouver", "day").key).toBe("2026-12-09");
  });

  it("starts weeks on Monday and quarters on their first month, like date_trunc did", () => {
    expect(startOfPeriod({ year: 2026, month: 3, day: 8 }, "week")).toEqual({ year: 2026, month: 3, day: 2 });
    expect(startOfPeriod({ year: 2026, month: 3, day: 9 }, "week")).toEqual({ year: 2026, month: 3, day: 9 });
    expect(startOfPeriod({ year: 2026, month: 11, day: 20 }, "quarter")).toEqual({ year: 2026, month: 10, day: 1 });
    expect(addPeriods({ year: 2026, month: 1, day: 1 }, "quarter", -1)).toEqual({ year: 2025, month: 10, day: 1 });
    expect(monthsBetween("2025-11", "2026-02")).toBe(3);
  });
});
