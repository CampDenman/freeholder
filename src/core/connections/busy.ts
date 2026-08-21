// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The busy union (MASTER.md §4.4, §41; C4.13).
//
// §4.4 says availability is computed and never stored, and that imported busy
// time is "never shown to customers, always respected". Both halves live here.
//
// The union is the only supported way to ask what external calendars have
// already taken. It is a list of periods and nothing else — no titles, no
// calendar names, no account, not even a count of how many things overlap. A
// caller that wanted to leak a private engagement could not, because there is
// nothing in the returned shape to leak. When the availability resolver lands
// (C6.03) this is the door it knocks on, and the reason it cannot get details
// through it is that they were never carried this far.
import { z } from "zod";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { timestamp } from "@/core/contract";
import {
  connectedAccounts,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
import { defineService, ServiceError, type Tx } from "@/core/service";
import type { Database } from "@/core/db";

type Queryable = Tx | Database;

export interface BusyWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * How far ahead one question may reach.
 *
 * §4.4's booking horizon is a business setting and shorter than this; the cap
 * exists so that a caller cannot ask for every event ever synced in one query.
 */
const MAX_RANGE_DAYS = 400;

/**
 * Periods in which the business is already busy, merged.
 *
 * Merging is not a tidiness pass. Two overlapping engagements are one period
 * of unavailability, and a resolver that saw them separately would have to
 * merge them anyway or double-count — better once, here, where the rule that
 * `ignored` calendars do not participate is also enforced.
 */
export async function externalBusyWindows(
  tx: Queryable,
  input: { from: Date; to: Date },
): Promise<BusyWindow[]> {
  if (input.to <= input.from) return [];

  const rows = await tx
    .select({
      startsAt: externalEvents.startsAt,
      endsAt: externalEvents.endsAt,
    })
    .from(externalEvents)
    .innerJoin(
      externalCalendars,
      eq(externalCalendars.id, externalEvents.externalCalendarId),
    )
    .innerJoin(
      connectedAccounts,
      eq(connectedAccounts.id, externalCalendars.connectedAccountId),
    )
    .where(
      and(
        // Personal until said otherwise (§41). An account nobody shared with
        // the business does not get to block the business's diary, however
        // full it is.
        eq(connectedAccounts.sharedWithBusiness, true),
        sql`${externalCalendars.role} <> 'ignored'`,
        eq(externalEvents.busy, true),
        gt(externalEvents.endsAt, input.from),
        lt(externalEvents.startsAt, input.to),
      ),
    )
    .orderBy(asc(externalEvents.startsAt));

  const merged: BusyWindow[] = [];
  for (const row of rows) {
    // Clamped, so a fortnight-long event answers the question that was asked
    // rather than swamping it.
    const startsAt = row.startsAt < input.from ? input.from : row.startsAt;
    const endsAt = row.endsAt > input.to ? input.to : row.endsAt;
    if (endsAt <= startsAt) continue;

    const last = merged[merged.length - 1];
    // Touching counts as overlapping: a gap of zero minutes is not a slot.
    if (last && startsAt <= last.endsAt) {
      if (endsAt > last.endsAt) last.endsAt = endsAt;
      continue;
    }
    merged.push({ startsAt, endsAt });
  }
  return merged;
}

export const busyWindows = defineService({
  name: "connections.busyWindows",
  summary: "When connected calendars say the business is already busy.",
  kind: "query",
  permission: "scoped",
  input: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  output: z.array(z.object({ startsAt: timestamp, endsAt: timestamp })),
  handler: async (input, ctx) => {
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (to <= from) {
      throw new ServiceError("validation", "The range must end after it starts.");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new ServiceError(
        "validation",
        `Ask about at most ${MAX_RANGE_DAYS} days at a time.`,
      );
    }
    return externalBusyWindows(ctx.tx, { from, to });
  },
});

/**
 * Every calendar feeding the union, and every one deliberately not feeding it.
 *
 * The second half is the point. A calendar that is connected but personal, or
 * marked ignored, is exactly the calendar somebody will later swear should
 * have blocked a booking — so it is listed, with the reason it did not count.
 */
export const calendarSources = defineService({
  name: "connections.calendarSources",
  summary: "Every connected calendar and whether it blocks the business's time.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.uuid(),
      accountId: z.uuid(),
      account: z.string(),
      provider: z.enum(["google", "microsoft", "apple", "caldav", "imap"]),
      name: z.string(),
      role: z.enum(["busy_source", "bookable", "ignored"]),
      sharedWithBusiness: z.boolean(),
      detailVisibility: z.enum(["busy_only", "full"]),
      status: z.enum(["active", "needs_reconnect", "revoked"]),
      lastError: z.string().nullable(),
      lastSyncAt: timestamp.nullable(),
      blocking: z.boolean(),
    }),
  ),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind === "agent") {
      throw new ServiceError(
        "permission",
        "An API key cannot read connected calendars. Sign in to see them.",
      );
    }
    const rows = await ctx.tx
      .select({
        id: externalCalendars.id,
        accountId: connectedAccounts.id,
        email: connectedAccounts.email,
        provider: connectedAccounts.provider,
        name: externalCalendars.name,
        role: externalCalendars.role,
        sharedWithBusiness: connectedAccounts.sharedWithBusiness,
        detailVisibility: connectedAccounts.detailVisibility,
        status: connectedAccounts.status,
        lastError: connectedAccounts.lastError,
        lastSyncAt: externalCalendars.lastSyncAt,
      })
      .from(externalCalendars)
      .innerJoin(
        connectedAccounts,
        eq(connectedAccounts.id, externalCalendars.connectedAccountId),
      )
      .orderBy(asc(connectedAccounts.email), asc(externalCalendars.name));

    return rows.map((row) => ({
      ...row,
      account: row.email ?? row.provider,
      blocking: row.sharedWithBusiness && row.role !== "ignored",
    }));
  },
});

export default [busyWindows, calendarSources];
