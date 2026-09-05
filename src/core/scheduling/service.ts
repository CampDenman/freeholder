// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Managing calendars (MASTER.md §4.4, C6.01).
//
// Two rules shape almost everything here.
//
// **A booking names a calendar, never a user.** So the services take calendar
// ids, a person's calendar is one row among three kinds, and nothing in the
// scheduling engine ever has to ask whether a thing has a login.
//
// **Archiving, never deleting.** A calendar with history behind it is a record
// of what happened; removing it would take a year of appointments with it.
// §4.4's `status` is the whole mechanism, and the services refuse to hand out
// an archived calendar for new work while leaving it perfectly readable.
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { listed, row, uuid } from "@/core/contract";
import { violates } from "@/core/db/errors";
import { users } from "@/core/auth/schema";
import { externalCalendars } from "@/core/connections/schema";
import {
  calendars,
  calendarMemberships,
  CALENDAR_KINDS,
  CALENDAR_STATUSES,
  MEMBERSHIP_ROLES,
} from "@/core/scheduling/schema";
import { getBusiness } from "@/core/settings/service";
import {
  defineService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";
// Booked time, as a funnel stage (§4.7, C9.07).
import "./funnel";

const timezoneValue = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "That is not a timezone I know.");

/** Lowercase, hyphenated, and stable — a calendar's slug reaches URLs (§5). */
const slugValue = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "A slug is lowercase words joined by hyphens.");

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "calendar"
  );
}

const calendarRow = row({
  id: uuid,
  kind: z.enum(CALENDAR_KINDS),
  name: z.string(),
  slug: z.string(),
  userId: uuid.nullable(),
  locationId: uuid.nullable(),
  timezone: z.string(),
  capacityDefault: z.number().int(),
  colour: z.string().nullable(),
  externalCalendarId: uuid.nullable(),
  bookingHorizonDays: z.number().int(),
  minNoticeMin: z.number().int(),
  maxPerDay: z.number().int().nullable(),
  status: z.enum(CALENDAR_STATUSES),
});

const definition = {
  name: z.string().trim().min(1).max(120),
  slug: slugValue.optional(),
  timezone: timezoneValue.optional(),
  locationId: z.uuid().nullish(),
  capacityDefault: z.number().int().min(1).max(10_000).optional(),
  colour: z.string().trim().max(40).nullish(),
  externalCalendarId: z.uuid().nullish(),
  bookingHorizonDays: z.number().int().min(1).max(1_095).optional(),
  minNoticeMin: z.number().int().min(0).max(43_200).optional(),
  maxPerDay: z.number().int().min(1).max(1_000).nullish(),
};

/** The business's zone is the sensible default for a calendar that names none. */
async function defaultTimezone(ctx: ServiceContext): Promise<string> {
  const business = await ctx.call(getBusiness, {}).catch(() => null);
  return business?.timezone ?? "UTC";
}

async function assertHolder(tx: Tx, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const [person] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) throw new ServiceError("validation", "No such person to own that calendar.");
}

async function assertExternal(
  tx: Tx,
  externalCalendarId: string | null | undefined,
): Promise<void> {
  if (!externalCalendarId) return;
  const [found] = await tx
    .select({ id: externalCalendars.id })
    .from(externalCalendars)
    .where(eq(externalCalendars.id, externalCalendarId))
    .limit(1);
  if (!found) {
    throw new ServiceError("validation", "No such connected calendar to link to.");
  }
}

export const listCalendars = defineService({
  name: "calendars.list",
  summary: "Every calendar: the business, its people, and its resources.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    kind: z.enum(CALENDAR_KINDS).optional(),
    includeArchived: z.boolean().default(false),
  }),
  output: listed(calendarRow),
  handler: async (input, ctx) => {
    const filters = [
      input.kind ? eq(calendars.kind, input.kind) : undefined,
      input.includeArchived ? undefined : eq(calendars.status, "active"),
    ].filter(Boolean);
    return ctx.tx
      .select()
      .from(calendars)
      .where(filters.length > 0 ? and(...filters) : undefined)
      // The business first, then people, then the things they use.
      .orderBy(
        sql`case ${calendars.kind} when 'business' then 0 when 'person' then 1 else 2 end`,
        asc(calendars.name),
      );
  },
});

export const getCalendar = defineService({
  name: "calendars.get",
  summary: "One calendar and the services it takes part in.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: calendarRow
    .extend({
      memberships: listed(
        row({
          id: uuid,
          serviceOfferingId: uuid,
          role: z.enum(MEMBERSHIP_ROLES),
          priority: z.number().int(),
          skillLevel: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [calendar] = await ctx.tx
      .select()
      .from(calendars)
      .where(eq(calendars.id, input.id))
      .limit(1);
    if (!calendar) return null;
    const memberships = await ctx.tx
      .select()
      .from(calendarMemberships)
      .where(eq(calendarMemberships.calendarId, calendar.id))
      .orderBy(asc(calendarMemberships.priority));
    return { ...calendar, memberships };
  },
});

export const createCalendar = defineService({
  name: "calendars.create",
  summary: "Add a person, a resource, or the business's own calendar.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    kind: z.enum(CALENDAR_KINDS),
    userId: z.uuid().nullish(),
    ...definition,
  }),
  output: calendarRow,
  handler: async (input, ctx) => {
    // The constraint the database also enforces, said in words somebody can
    // act on rather than as a violated check.
    if (input.kind === "person" && !input.userId) {
      throw new ServiceError("validation", "A person's calendar needs the person.");
    }
    if (input.kind !== "person" && input.userId) {
      throw new ServiceError(
        "validation",
        "Only a person's calendar has a holder. A room has no login.",
      );
    }
    await assertHolder(ctx.tx, input.userId);
    await assertExternal(ctx.tx, input.externalCalendarId);

    const [created] = await ctx.tx
      .insert(calendars)
      .values({
        kind: input.kind,
        name: input.name,
        slug: input.slug ?? slugify(input.name),
        userId: input.userId ?? null,
        locationId: input.locationId ?? null,
        timezone: input.timezone ?? (await defaultTimezone(ctx)),
        capacityDefault: input.capacityDefault ?? 1,
        colour: input.colour ?? null,
        externalCalendarId: input.externalCalendarId ?? null,
        ...(input.bookingHorizonDays === undefined
          ? {}
          : { bookingHorizonDays: input.bookingHorizonDays }),
        ...(input.minNoticeMin === undefined ? {} : { minNoticeMin: input.minNoticeMin }),
        maxPerDay: input.maxPerDay ?? null,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "calendars_one_business_idx")) {
          throw new ServiceError(
            "conflict",
            "The business already has a calendar. Two would be two answers to when it is open.",
          );
        }
        if (violates(error, "calendars_slug_idx")) {
          throw new ServiceError("conflict", "A calendar already uses that short name.");
        }
        throw error;
      });

    ctx.setSubject("calendar", created!.id);
    ctx.queueEvent("calendar.created", {
      id: created!.id,
      kind: created!.kind,
      name: created!.name,
    });
    return created!;
  },
});

export const updateCalendar = defineService({
  name: "calendars.update",
  summary: "Change a calendar's details, hours policy or capacity.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    id: z.uuid(),
    ...Object.fromEntries(
      Object.entries(definition).map(([key, schema]) => [key, schema.optional()]),
    ),
    name: definition.name.optional(),
    status: z.enum(CALENDAR_STATUSES).optional(),
  }),
  output: calendarRow,
  handler: async (input, ctx) => {
    const { id, ...changes } = input as { id: string } & Record<string, unknown>;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "calendars.update: nothing to change");
    }
    const [before] = await ctx.tx
      .select()
      .from(calendars)
      .where(eq(calendars.id, id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "No such calendar.");
    await assertExternal(ctx.tx, changes.externalCalendarId as string | undefined);

    const [updated] = await ctx.tx
      .update(calendars)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(eq(calendars.id, id))
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "calendars_slug_idx")) {
          throw new ServiceError("conflict", "A calendar already uses that short name.");
        }
        throw error;
      });

    ctx.setSubject("calendar", id);
    ctx.queueEvent("calendar.updated", { id });
    return updated!;
  },
});

export const archiveCalendar = defineService({
  name: "calendars.archive",
  summary: "Stop scheduling on a calendar without losing what it holds.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid(), archived: z.boolean().default(true) }),
  output: z.object({ id: uuid, status: z.enum(CALENDAR_STATUSES) }),
  handler: async (input, ctx) => {
    const [calendar] = await ctx.tx
      .select({ id: calendars.id, kind: calendars.kind })
      .from(calendars)
      .where(eq(calendars.id, input.id))
      .limit(1);
    if (!calendar) throw new ServiceError("not_found", "No such calendar.");
    if (calendar.kind === "business" && input.archived) {
      throw new ServiceError(
        "conflict",
        "The business's own calendar cannot be archived. Change its hours instead.",
      );
    }
    // Never a delete: a calendar with a year of appointments behind it is a
    // record of what happened, and archiving keeps every one of them readable.
    const [updated] = await ctx.tx
      .update(calendars)
      .set({ status: input.archived ? "archived" : "active", updatedAt: sql`now()` })
      .where(eq(calendars.id, input.id))
      .returning({ id: calendars.id, status: calendars.status });

    ctx.setSubject("calendar", input.id);
    ctx.queueEvent("calendar.updated", { id: input.id });
    return updated!;
  },
});

export const setServiceCalendars = defineService({
  name: "calendars.setForService",
  summary: "Say which calendars a service draws on, and in what role.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    serviceOfferingId: z.uuid(),
    members: z
      .array(
        z.object({
          calendarId: z.uuid(),
          role: z.enum(MEMBERSHIP_ROLES).default("primary"),
          priority: z.number().int().min(0).max(1_000).default(0),
          skillLevel: z.string().trim().max(80).nullish(),
        }),
      )
      .max(50),
  }),
  output: z.object({ serviceOfferingId: uuid, members: z.number().int() }),
  handler: async (input, ctx) => {
    const ids = new Set(input.members.map((member) => member.calendarId));
    if (ids.size !== input.members.length) {
      // Two roles for one calendar on one service is a service that needs the
      // same person twice, which is never what somebody meant.
      throw new ServiceError(
        "validation",
        "A calendar can only take one role in a service.",
      );
    }
    for (const member of input.members) {
      const [calendar] = await ctx.tx
        .select({ id: calendars.id, status: calendars.status })
        .from(calendars)
        .where(eq(calendars.id, member.calendarId))
        .limit(1);
      if (!calendar) throw new ServiceError("validation", "No such calendar.");
      if (calendar.status !== "active") {
        throw new ServiceError(
          "conflict",
          "An archived calendar cannot take new work. Restore it first.",
        );
      }
    }

    // Replace rather than merge: the list an owner submitted is the list they
    // meant, and a membership silently surviving a removal would be a resource
    // still being booked after somebody took it out.
    await ctx.tx
      .delete(calendarMemberships)
      .where(eq(calendarMemberships.serviceOfferingId, input.serviceOfferingId));
    if (input.members.length > 0) {
      await ctx.tx.insert(calendarMemberships).values(
        input.members.map((member) => ({
          calendarId: member.calendarId,
          serviceOfferingId: input.serviceOfferingId,
          role: member.role,
          priority: member.priority,
          skillLevel: member.skillLevel ?? null,
        })),
      );
    }

    ctx.setSubject("service_offering", input.serviceOfferingId);
    ctx.queueEvent("calendar.membershipsChanged", {
      serviceOfferingId: input.serviceOfferingId,
      members: input.members.length,
    });
    return {
      serviceOfferingId: input.serviceOfferingId,
      members: input.members.length,
    };
  },
});

export const serviceCalendars = defineService({
  name: "calendars.forService",
  summary: "The calendars one service draws on.",
  kind: "query",
  permission: "scoped",
  input: z.object({ serviceOfferingId: z.uuid() }),
  output: listed(
    row({
      id: uuid,
      calendarId: uuid,
      name: z.string(),
      kind: z.enum(CALENDAR_KINDS),
      timezone: z.string(),
      role: z.enum(MEMBERSHIP_ROLES),
      priority: z.number().int(),
      skillLevel: z.string().nullable(),
      capacityDefault: z.number().int(),
      status: z.enum(CALENDAR_STATUSES),
    }),
  ),
  handler: async (input, ctx) =>
    ctx.tx
      .select({
        id: calendarMemberships.id,
        calendarId: calendars.id,
        name: calendars.name,
        kind: calendars.kind,
        timezone: calendars.timezone,
        role: calendarMemberships.role,
        priority: calendarMemberships.priority,
        skillLevel: calendarMemberships.skillLevel,
        capacityDefault: calendars.capacityDefault,
        status: calendars.status,
        createdAt: calendarMemberships.createdAt,
        updatedAt: calendarMemberships.updatedAt,
      })
      .from(calendarMemberships)
      .innerJoin(calendars, eq(calendars.id, calendarMemberships.calendarId))
      .where(eq(calendarMemberships.serviceOfferingId, input.serviceOfferingId))
      .orderBy(asc(calendarMemberships.priority), asc(calendars.name)),
});

export default [
  listCalendars,
  getCalendar,
  createCalendar,
  updateCalendar,
  archiveCalendar,
  setServiceCalendars,
  serviceCalendars,
];
