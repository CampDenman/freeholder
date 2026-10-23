// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Do Node and Postgres agree what time it is here? (MASTER.md §4.9, §17)
//
// Each ships its own copy of the tz database — Node inside ICU, Postgres in
// its image or its host's system files — and they are updated on different
// schedules. When a government moves a clock rule, one copy learns first.
// Freeholder does every local-time calculation in Node precisely so that the
// pages, the reports and the reminders cannot disagree with each other; but
// anything that still reads Postgres's copy (an export run by hand, a BI tool
// pointed at the database) will then be an hour out, and an owner should know.
//
// So this is a warning, never a failure: the site itself is consistent. It
// compares the offset each side reports for the business's zone at a handful
// of instants — now, six months either side, and either side of the next
// clock change — and names both versions when they disagree.
import { nextOffsetChange, zoneOffsetMs } from "@/core/i18n/zoned";
import type { Check } from "./index";

/** The instants worth asking about: now, ±6 months, and around the next change. */
export function probeInstants(now: Date, timezone: string): Date[] {
  const SIX_MONTHS = 182 * 86_400_000;
  const instants = [
    now,
    new Date(now.getTime() - SIX_MONTHS),
    new Date(now.getTime() + SIX_MONTHS),
  ];
  const change = nextOffsetChange(now, timezone);
  if (change) {
    instants.push(new Date(change.getTime() - 3_600_000), new Date(change.getTime() + 3_600_000));
  }
  return instants;
}

export interface ZoneProbe {
  /** Offset in minutes Postgres reports for each instant, in order. */
  offsets(instants: Date[], timezone: string): Promise<number[]>;
  /** The server's version string, for the report. */
  version(): Promise<string>;
}

const TITLE = "Time zone data";

/**
 * The business's stored zone is not one `Intl` knows — saved before profiles
 * were validated, or an abbreviation Postgres accepted. Screens count in UTC
 * until it is fixed; doctor says so rather than staying silent.
 */
export function unknownZoneCheck(timezone: string): Check {
  return {
    id: "time.zoneData",
    title: TITLE,
    verdict: "warn",
    detail: `The business's time zone "${timezone}" is not one the site recognises, so reports and charts are counting in UTC.`,
    remedy: "Choose the business's time zone again in Settings, from the list.",
    message: { key: "doctor.timeZone.unknown", params: { zone: timezone } },
  };
}

export async function checkTimezoneData(
  timezone: string,
  probe: ZoneProbe,
  now: Date = new Date(),
  nodeTz: string = process.versions.tz ?? "unknown",
): Promise<Check> {
  const instants = probeInstants(now, timezone);
  const nodeOffsets = instants.map((instant) => Math.round(zoneOffsetMs(instant, timezone) / 60_000));
  let postgresOffsets: number[];
  let postgresVersion: string;
  try {
    [postgresOffsets, postgresVersion] = await Promise.all([
      probe.offsets(instants, timezone),
      probe.version(),
    ]);
  } catch (error) {
    return {
      id: "time.zoneData",
      title: TITLE,
      verdict: "warn",
      detail: `The database could not read the time zone ${timezone}: ${error instanceof Error ? error.message : String(error)}`,
      remedy:
        "Times on the site are unaffected, because they are worked out by the app. Anything reading the database directly will not know this zone; update the database's time zone data.",
      message: { key: "doctor.timeZone.unreadable", params: { zone: timezone } },
    };
  }

  const disagreements = instants.flatMap((instant, index) =>
    nodeOffsets[index] === postgresOffsets[index]
      ? []
      : [{ instant, node: nodeOffsets[index]!, postgres: postgresOffsets[index]! }],
  );
  if (disagreements.length === 0) {
    return {
      id: "time.zoneData",
      title: TITLE,
      verdict: "ok",
      detail: `The app and the database agree on ${timezone} (app tz data ${nodeTz}).`,
      message: { key: "doctor.timeZone.agree", params: { zone: timezone, node: nodeTz } },
    };
  }

  const first = disagreements[0]!;
  const offset = (minutes: number) => {
    const sign = minutes < 0 ? "-" : "+";
    const absolute = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  };
  const params = {
    zone: timezone,
    at: first.instant.toISOString(),
    nodeOffset: offset(first.node),
    postgresOffset: offset(first.postgres),
    node: nodeTz,
    postgres: postgresVersion,
  };
  return {
    id: "time.zoneData",
    title: TITLE,
    verdict: "warn",
    detail:
      `The app and the database disagree about ${timezone}: at ${params.at} the app (tz data ${nodeTz}) says ${params.nodeOffset}, ` +
      `the database (Postgres ${postgresVersion}) says ${params.postgresOffset}. ` +
      `Pages, reports and reminders use the app's answer, so the site is consistent.`,
    remedy:
      "Anything that reads the database directly will be an hour out at these times. Update whichever side is older: the app's Node version, or the database's time zone data.",
    message: { key: "doctor.timeZone.disagree", params },
  };
}
