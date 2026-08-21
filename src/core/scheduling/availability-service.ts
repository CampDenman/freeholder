// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Writing a calendar's hours (MASTER.md §4.4, C6.02).
//
// Rules are set as a whole week at a time, and exceptions one at a time. That
// asymmetry is deliberate and matches how the two are actually edited: a
// weekly pattern is reviewed as a shape ("Tuesdays and Thursdays, nine to
// five"), while a closure is added on the day somebody hears about it and
// removed on the day it turns out to be wrong.
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { listed, row, uuid } from "@/core/contract";
import {
  availabilityExceptions,
  availabilityRules,
  calendars,
  AVAILABILITY_KINDS,
  EXCEPTION_KINDS,
} from "@/core/scheduling/schema";
import { openWindows } from "@/core/scheduling/availability";
import { defineService, ServiceError, type Tx } from "@/core/service";

const clock = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time is written as HH:MM on a 24-hour clock.");
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date is written as YYYY-MM-DD.");

const ruleRow = row({
  id: uuid,
  calendarId: uuid,
  weekday: z.number().int(),
  starts: z.string(),
  ends: z.string(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  kind: z.enum(AVAILABILITY_KINDS),
});

const exceptionRow = row({
  id: uuid,
  calendarId: uuid,
  startsOn: z.string(),
  endsOn: z.string(),
  kind: z.enum(EXCEPTION_KINDS),
  starts: z.string().nullable(),
  ends: z.string().nullable(),
  reason: z.string().nullable(),
});

async function activeCalendar(
  tx: Tx,
  id: string,
): Promise<{ id: string; timezone: string }> {
  const [calendar] = await tx
    .select({
      id: calendars.id,
      timezone: calendars.timezone,
      status: calendars.status,
    })
    .from(calendars)
    .where(eq(calendars.id, id))
    .limit(1);
  if (!calendar) throw new ServiceError("not_found", "No such calendar.");
  if (calendar.status !== "active") {
    throw new ServiceError(
      "conflict",
      "An archived calendar takes no new work. Restore it before setting hours.",
    );
  }
  return { id: calendar.id, timezone: calendar.timezone };
}

export const listAvailability = defineService({
  name: "availability.rules",
  summary: "A calendar's weekly hours and the days that break them.",
  kind: "query",
  permission: "scoped",
  input: z.object({ calendarId: z.uuid() }),
  output: z.object({
    rules: listed(ruleRow),
    exceptions: listed(exceptionRow),
  }),
  handler: async (input, ctx) => ({
    rules: await ctx.tx
      .select()
      .from(availabilityRules)
      .where(eq(availabilityRules.calendarId, input.calendarId))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.starts)),
    exceptions: await ctx.tx
      .select()
      .from(availabilityExceptions)
      .where(eq(availabilityExceptions.calendarId, input.calendarId))
      .orderBy(asc(availabilityExceptions.startsOn)),
  }),
});

export const setAvailability = defineService({
  name: "availability.setRules",
  summary: "Set a calendar's weekly hours.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    calendarId: z.uuid(),
    rules: z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          starts: clock,
          ends: clock,
          effectiveFrom: isoDate.nullish(),
          effectiveTo: isoDate.nullish(),
          kind: z.enum(AVAILABILITY_KINDS).default("bookable"),
        }),
      )
      .max(100),
  }),
  output: z.object({ calendarId: uuid, rules: z.number().int() }),
  handler: async (input, ctx) => {
    await activeCalendar(ctx.tx, input.calendarId);
    for (const rule of input.rules) {
      // Said in words before the database says it as a violated check: an
      // overnight shift is two rules, because a window that ends before it
      // starts has to be special-cased by every reader.
      if (rule.ends <= rule.starts) {
        throw new ServiceError(
          "validation",
          "Hours end after they start. Split a shift that runs past midnight into two.",
        );
      }
      if (rule.effectiveFrom && rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) {
        throw new ServiceError("validation", "That range ends before it begins.");
      }
    }

    // A week is reviewed as a shape, so it is written as one. Merging would
    // leave a Thursday somebody deleted still open.
    await ctx.tx
      .delete(availabilityRules)
      .where(eq(availabilityRules.calendarId, input.calendarId));
    if (input.rules.length > 0) {
      await ctx.tx.insert(availabilityRules).values(
        input.rules.map((rule) => ({
          calendarId: input.calendarId,
          weekday: rule.weekday,
          starts: rule.starts,
          ends: rule.ends,
          effectiveFrom: rule.effectiveFrom ?? null,
          effectiveTo: rule.effectiveTo ?? null,
          kind: rule.kind,
        })),
      );
    }

    ctx.setSubject("calendar", input.calendarId);
    ctx.queueEvent("calendar.hoursChanged", {
      id: input.calendarId,
      rules: input.rules.length,
    });
    return { calendarId: input.calendarId, rules: input.rules.length };
  },
});

export const addAvailabilityException = defineService({
  name: "availability.addException",
  summary: "Close a calendar for a day, or open it when it would be shut.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    calendarId: z.uuid(),
    startsOn: isoDate,
    endsOn: isoDate.optional(),
    kind: z.enum(EXCEPTION_KINDS),
    starts: clock.nullish(),
    ends: clock.nullish(),
    reason: z.string().trim().max(200).nullish(),
  }),
  output: exceptionRow,
  handler: async (input, ctx) => {
    await activeCalendar(ctx.tx, input.calendarId);
    const endsOn = input.endsOn ?? input.startsOn;
    if (endsOn < input.startsOn) {
      throw new ServiceError("validation", "That range ends before it begins.");
    }
    if (input.kind === "closed") {
      if (input.starts || input.ends) {
        throw new ServiceError(
          "validation",
          "A closure has no hours. Use reduced hours to open for part of a day.",
        );
      }
    } else if (!input.starts || !input.ends || input.ends <= input.starts) {
      throw new ServiceError(
        "validation",
        "Opening or reducing a day needs hours that end after they start.",
      );
    }

    const [created] = await ctx.tx
      .insert(availabilityExceptions)
      .values({
        calendarId: input.calendarId,
        startsOn: input.startsOn,
        endsOn,
        kind: input.kind,
        starts: input.kind === "closed" ? null : input.starts!,
        ends: input.kind === "closed" ? null : input.ends!,
        reason: input.reason ?? null,
      })
      .returning();

    ctx.setSubject("calendar", input.calendarId);
    ctx.queueEvent("calendar.hoursChanged", { id: input.calendarId });
    return created!;
  },
});

export const removeAvailabilityException = defineService({
  name: "availability.removeException",
  summary: "Take back a closure or an extra day.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const [removed] = await ctx.tx
      .delete(availabilityExceptions)
      .where(eq(availabilityExceptions.id, input.id))
      .returning({ id: availabilityExceptions.id, calendarId: availabilityExceptions.calendarId });
    if (!removed) throw new ServiceError("not_found", "No such exception.");
    ctx.setSubject("calendar", removed.calendarId);
    ctx.queueEvent("calendar.hoursChanged", { id: removed.calendarId });
    return { id: removed.id };
  },
});

export const calendarOpenWindows = defineService({
  name: "availability.windows",
  summary: "When a calendar is open across a range of dates.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    calendarId: z.uuid(),
    from: isoDate,
    to: isoDate,
    kinds: z.array(z.enum(AVAILABILITY_KINDS)).min(1).optional(),
  }),
  output: z.array(
    z.object({
      startsAt: z.date(),
      endsAt: z.date(),
      kind: z.enum(AVAILABILITY_KINDS),
    }),
  ),
  handler: async (input, ctx) => {
    const [calendar] = await ctx.tx
      .select({ id: calendars.id, timezone: calendars.timezone })
      .from(calendars)
      .where(eq(calendars.id, input.calendarId))
      .limit(1);
    if (!calendar) throw new ServiceError("not_found", "No such calendar.");
    if (input.to < input.from) {
      throw new ServiceError("validation", "That range ends before it begins.");
    }
    return openWindows(ctx.tx, {
      calendarId: calendar.id,
      timezone: calendar.timezone,
      from: input.from,
      to: input.to,
      kinds: input.kinds,
    });
  },
});

/** A weekday's hours, copied to every other weekday an owner picked. */
export const copyAvailabilityToDays = defineService({
  name: "availability.copyDay",
  summary: "Copy one day's hours onto other days of the week.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    calendarId: z.uuid(),
    fromWeekday: z.number().int().min(0).max(6),
    toWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  output: z.object({ calendarId: uuid, copied: z.number().int() }),
  handler: async (input, ctx) => {
    await activeCalendar(ctx.tx, input.calendarId);
    const source = await ctx.tx
      .select()
      .from(availabilityRules)
      .where(
        and(
          eq(availabilityRules.calendarId, input.calendarId),
          eq(availabilityRules.weekday, input.fromWeekday),
        ),
      );
    if (source.length === 0) {
      throw new ServiceError("conflict", "That day has no hours to copy.");
    }
    const targets = [...new Set(input.toWeekdays)].filter(
      (weekday) => weekday !== input.fromWeekday,
    );
    if (targets.length === 0) {
      throw new ServiceError("validation", "Choose a day other than the one being copied.");
    }

    await ctx.tx
      .delete(availabilityRules)
      .where(
        and(
          eq(availabilityRules.calendarId, input.calendarId),
          sql`${availabilityRules.weekday} = any(${sql.param(targets)})`,
        ),
      );
    await ctx.tx.insert(availabilityRules).values(
      targets.flatMap((weekday) =>
        source.map((rule) => ({
          calendarId: input.calendarId,
          weekday,
          starts: rule.starts,
          ends: rule.ends,
          effectiveFrom: rule.effectiveFrom,
          effectiveTo: rule.effectiveTo,
          kind: rule.kind,
        })),
      ),
    );

    ctx.setSubject("calendar", input.calendarId);
    ctx.queueEvent("calendar.hoursChanged", { id: input.calendarId });
    return { calendarId: input.calendarId, copied: targets.length * source.length };
  },
});

export default [
  listAvailability,
  setAvailability,
  addAvailabilityException,
  removeAvailabilityException,
  calendarOpenWindows,
  copyAvailabilityToDays,
];
