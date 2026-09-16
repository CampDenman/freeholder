// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading a schedule (C4.14, MASTER.md §40, §4.9).
//
// Its own module because both ends need it and they already need each other:
// playbooks compute the first occurrence when a schedule is written, and the
// scheduler computes the next one when a window is spent.
import { CronExpressionParser } from "cron-parser";
import { getBusiness } from "@/core/settings/service";
import { ServiceError, type ServiceContext } from "@/core/service";

/**
 * The next time a cron expression comes round, in a named zone.
 *
 * Strictly after the given moment, so advancing from an occurrence cannot
 * return that same occurrence and spin.
 */
export function nextOccurrence(
  expression: string,
  timezone: string,
  after: Date,
): Date {
  return CronExpressionParser.parse(expression, {
    currentDate: after,
    tz: timezone,
  })
    .next()
    .toDate();
}

/** A schedule this platform will accept, with the reason it will not. */
export function assertSchedule(expression: string, timezone: string): void {
  if (expression.trim().split(/\s+/).length !== 5) {
    throw new ServiceError(
      "validation",
      "A schedule is five fields: minute, hour, day of month, month, day of week.",
    );
  }
  try {
    nextOccurrence(expression, timezone, new Date());
  } catch {
    throw new ServiceError("validation", `"${expression}" is not a schedule I can read.`);
  }
}

export function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ServiceError("validation", `"${timezone}" is not a timezone I know.`);
  }
}

/**
 * The zone a playbook is read in: its own, else the business's, else UTC.
 *
 * A playbook that names no zone follows the business, which is what makes an
 * exported playbook portable — it arrives on somebody else's instance and runs
 * at seven in *their* morning.
 */
export async function scheduleZone(playbook: {
  timezone: string | null;
}): Promise<string> {
  if (playbook.timezone) return playbook.timezone;
  const business = await getBusiness.call({}, { kind: "anonymous" }).catch(() => null);
  return business?.timezone ?? "UTC";
}

/** Resolve the same default without opening a second service transaction. */
export async function scheduleZoneIn(
  ctx: ServiceContext,
  playbook: { timezone: string | null },
): Promise<string> {
  if (playbook.timezone) return playbook.timezone;
  const business = await ctx.call(getBusiness, {}).catch(() => null);
  return business?.timezone ?? "UTC";
}
