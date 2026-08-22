// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The booking lifecycle (MASTER.md §4.4, C6.07).
//
// §4.4's state machine, and the rules that keep it honest:
//
//   requested → confirmed → in_progress → completed | no_show
//   any → cancelled (policy applied)  |  rescheduled (new row, links to prior)
//
// **A booking names a calendar, never a user**, which is what lets a room and
// a therapist be booked by the same machinery.
//
// **Double-booking is prevented in the database.** The exclusion constraint in
// `0087` is the guarantee; everything here is the message somebody reads when
// it fires. §4.4 is blunt about why: no amount of careful service-layer
// checking survives two processes.
//
// **A booking is not a payment.** Deposits and fees resolve to an invoice like
// everything else; this file records the link and never moves money itself.
//
// **Everything emits a timeline event**, so the CRM shows a client's whole
// history without booking knowing the CRM exists.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { lostARace, violates } from "@/core/db/errors";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import {
  bookings,
  bookingParticipants,
  calendars,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  HOLDING_STATUSES,
  PARTICIPANT_STATUSES,
} from "@/core/scheduling/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";

/** What may follow what. Anything absent from this map is not a transition. */
const NEXT: Record<string, readonly string[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "completed", "no_show", "cancelled"],
  in_progress: ["completed", "no_show", "cancelled"],
  completed: [],
  no_show: [],
  cancelled: [],
};

const bookingRow = row({
  id: uuid,
  contactId: uuid,
  serviceOfferingId: uuid.nullable(),
  calendarId: uuid,
  secondaryCalendarIds: z.array(uuid),
  startsAt: timestamp,
  endsAt: timestamp,
  timezoneAtBooking: z.string(),
  status: z.enum(BOOKING_STATUSES),
  locationId: uuid.nullable(),
  locationDetail: z.string().nullable(),
  capacityUsed: z.number().int(),
  exclusive: z.boolean(),
  invoiceId: uuid.nullable(),
  rescheduledFromId: uuid.nullable(),
  intakeSubmissionId: uuid.nullable(),
  waiverId: uuid.nullable(),
  source: z.enum(BOOKING_SOURCES),
  notes: z.string().nullable(),
  cancellationReason: z.string().nullable(),
});

/**
 * A timeline entry for everything that happens to a booking.
 *
 * Written here rather than by a listener, because the CRM showing "requested,
 * confirmed, attended" in order is the point of the feature and not a
 * side-effect that may be dropped.
 */
async function recordOnTimeline(
  ctx: ServiceContext,
  input: { contactId: string; bookingId: string; eventType: string; payload?: object },
): Promise<void> {
  await ctx.tx.insert(timelineEvents).values({
    contactId: input.contactId,
    actor:
      ctx.actor.kind === "user"
        ? `user:${ctx.actor.userId}`
        : ctx.actor.kind === "agent"
          ? `agent:${ctx.actor.keyName}`
          : "system",
    eventType: input.eventType,
    subjectType: "booking",
    subjectId: input.bookingId,
    payload: input.payload ?? {},
  });
}

async function bookableCalendar(
  ctx: ServiceContext,
  id: string,
): Promise<{ id: string; timezone: string; capacityDefault: number }> {
  const [calendar] = await ctx.tx
    .select({
      id: calendars.id,
      timezone: calendars.timezone,
      capacityDefault: calendars.capacityDefault,
      status: calendars.status,
    })
    .from(calendars)
    .where(eq(calendars.id, id))
    .limit(1);
  if (!calendar) throw new ServiceError("not_found", "No such calendar.");
  if (calendar.status !== "active") {
    throw new ServiceError("conflict", "That calendar takes no new bookings.");
  }
  return {
    id: calendar.id,
    timezone: calendar.timezone,
    capacityDefault: calendar.capacityDefault,
  };
}

/**
 * Serialise everybody trying to take a seat on the same calendar (C6.04).
 *
 * The exclusion constraint protects a calendar that holds one thing at once,
 * and deliberately does not fire on a shared one — a class of twelve overlaps
 * by design. That leaves counting seats, which is check-then-act: two
 * transactions can both read "two of three taken" and both insert, and the
 * class ends up with four people in a room for three.
 *
 * A row lock on the calendar is the cheapest correct answer. The second
 * transaction waits for the first to commit and then counts what is really
 * there. It costs nothing on an exclusive calendar because that path never
 * takes it, and nothing at all when two people book *different* calendars.
 */
async function lockCalendarForSeating(
  ctx: ServiceContext,
  calendarId: string,
): Promise<void> {
  await ctx.tx.execute(
    sql`select id from ${calendars} where ${calendars.id} = ${calendarId} for update`,
  );
}

/** The seats already held on a shared calendar for an overlapping window. */
async function seatsTaken(
  ctx: ServiceContext,
  input: { calendarId: string; startsAt: Date; endsAt: Date; excludeId?: string },
): Promise<number> {
  const [held] = await ctx.tx
    .select({ seats: sql<number>`coalesce(sum(${bookings.capacityUsed}), 0)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.calendarId, input.calendarId),
        sql`${bookings.status} = any(${sql.param([...HOLDING_STATUSES])})`,
        // ISO strings rather than Dates: a raw fragment bypasses the driver's
        // parameter coercion, and a Date reaches the socket unserialised.
        sql`tstzrange(${bookings.startsAt}, ${bookings.endsAt}, '[)')
            && tstzrange(${input.startsAt.toISOString()}::timestamptz,
                         ${input.endsAt.toISOString()}::timestamptz, '[)')`,
        input.excludeId ? sql`${bookings.id} <> ${input.excludeId}` : undefined,
      ),
    );
  return held?.seats ?? 0;
}

export const createBooking = defineService({
  name: "bookings.create",
  summary: "Put an appointment on a calendar.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "blocks",
  input: z.object({
    calendarId: z.uuid(),
    /** The one automated door into the spine (§2 principle 3). */
    contact: z.object({
      email: z.string().trim().email().toLowerCase(),
      name: z.string().trim().min(1).max(200).optional(),
      phone: z.string().trim().max(100).optional(),
    }),
    serviceOfferingId: z.uuid().nullish(),
    secondaryCalendarIds: z.array(z.uuid()).max(10).default([]),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacityUsed: z.number().int().min(1).max(1_000).default(1),
    locationId: z.uuid().nullish(),
    locationDetail: z.string().trim().max(500).nullish(),
    source: z.enum(BOOKING_SOURCES).default("admin"),
    notes: z.string().trim().max(4_000).nullish(),
    status: z.enum(["requested", "confirmed"]).default("requested"),
  }),
  output: bookingRow,
  handler: async (input, ctx) => {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) {
      throw new ServiceError("validation", "An appointment ends after it starts.");
    }
    const calendar = await bookableCalendar(ctx, input.calendarId);
    for (const secondary of input.secondaryCalendarIds) {
      await bookableCalendar(ctx, secondary);
    }

    // Never `contacts.create`: a customer who has booked before is the same
    // person, and an insert would fork the spine.
    const resolved = (await ctx.callAsSystem(getService("contacts.resolve"), {
      email: input.contact.email,
      ...(input.contact.name ? { name: input.contact.name } : {}),
      ...(input.contact.phone ? { phone: input.contact.phone } : {}),
      source: `booking:${input.source}`,
    })) as { contact: { id: string } };

    const exclusive = calendar.capacityDefault <= 1;
    if (!exclusive) {
      // A class of twelve: the constraint deliberately does not fire here, so
      // the seat count is checked under a lock in the transaction that takes
      // them. Without the lock this is check-then-act, and two people take the
      // last place at once.
      await lockCalendarForSeating(ctx, calendar.id);
      const taken = await seatsTaken(ctx, {
        calendarId: calendar.id,
        startsAt,
        endsAt,
      });
      if (taken + input.capacityUsed > calendar.capacityDefault) {
        throw new ServiceError(
          "conflict",
          `Only ${calendar.capacityDefault - taken} place(s) left at that time.`,
        );
      }
    }

    const [created] = await ctx.tx
      .insert(bookings)
      .values({
        contactId: resolved.contact.id,
        serviceOfferingId: input.serviceOfferingId ?? null,
        calendarId: calendar.id,
        secondaryCalendarIds: input.secondaryCalendarIds,
        startsAt,
        endsAt,
        // Kept because a DST change between booking and appointment should be
        // a known quantity rather than a surprise (§4.4).
        timezoneAtBooking: calendar.timezone,
        status: input.status,
        locationId: input.locationId ?? null,
        locationDetail: input.locationDetail ?? null,
        capacityUsed: input.capacityUsed,
        exclusive,
        rescheduleToken: randomBytes(24).toString("base64url"),
        source: input.source,
        notes: input.notes ?? null,
      })
      .returning()
      .catch((error: unknown) => {
        // The constraint by name, and the whole family of concurrency
        // refusals besides. Which one arrives depends on timing rather than on
        // anything the person did, and translating only the first gives a
        // friendly sentence most of the time and raw SQL the rest of it.
        if (violates(error, "bookings_no_overlap") || lostARace(error)) {
          throw new ServiceError(
            "conflict",
            "That time was taken while you were booking it. Choose another.",
          );
        }
        throw error;
      });

    await recordOnTimeline(ctx, {
      contactId: resolved.contact.id,
      bookingId: created!.id,
      eventType: "booking.requested",
      payload: { startsAt: startsAt.toISOString(), calendarId: calendar.id },
    });
    ctx.setSubject("booking", created!.id);
    ctx.queueEvent("booking.created", {
      id: created!.id,
      calendarId: calendar.id,
      contactId: resolved.contact.id,
      startsAt: startsAt.toISOString(),
    });
    return created!;
  },
});

export const setBookingStatus = defineService({
  name: "bookings.setStatus",
  summary: "Move an appointment through its lifecycle.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "blocks",
  input: z.object({
    id: z.uuid(),
    status: z.enum(BOOKING_STATUSES),
    reason: z.string().trim().max(500).nullish(),
  }),
  output: bookingRow,
  handler: async (input, ctx) => {
    const [booking] = await ctx.tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.id))
      .limit(1);
    if (!booking) throw new ServiceError("not_found", "No such appointment.");
    if (booking.status === input.status) return booking;

    const allowed = NEXT[booking.status] ?? [];
    if (!allowed.includes(input.status)) {
      // A finished appointment is history. Reopening one would rewrite what
      // happened, and the honest move is a new booking.
      throw new ServiceError(
        "conflict",
        `An appointment that is ${booking.status} cannot become ${input.status}.`,
      );
    }
    if (input.status === "cancelled" && !input.reason) {
      // The reason reaches the customer and the timeline. A cancellation
      // nobody can explain is the one that costs the business the client.
      throw new ServiceError("validation", "Say why it was cancelled.");
    }

    const [updated] = await ctx.tx
      .update(bookings)
      .set({
        status: input.status,
        cancellationReason:
          input.status === "cancelled" ? (input.reason ?? null) : booking.cancellationReason,
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, input.id))
      .returning();

    await recordOnTimeline(ctx, {
      contactId: booking.contactId,
      bookingId: booking.id,
      eventType: `booking.${input.status}`,
      payload: input.reason ? { reason: input.reason } : {},
    });
    ctx.setSubject("booking", booking.id);
    ctx.queueEvent(`booking.${input.status}`, {
      id: booking.id,
      contactId: booking.contactId,
      calendarId: booking.calendarId,
    });
    return updated!;
  },
});

export const rescheduleBooking = defineService({
  name: "bookings.reschedule",
  summary: "Move an appointment, keeping the history of where it was.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "blocks",
  input: z.object({
    id: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    calendarId: z.uuid().optional(),
    reason: z.string().trim().max(500).nullish(),
  }),
  output: bookingRow,
  handler: async (input, ctx) => {
    const [previous] = await ctx.tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.id))
      .limit(1);
    if (!previous) throw new ServiceError("not_found", "No such appointment.");
    if (!HOLDING_STATUSES.includes(previous.status as (typeof HOLDING_STATUSES)[number])) {
      throw new ServiceError(
        "conflict",
        "Only an appointment that is still going ahead can be moved.",
      );
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) {
      throw new ServiceError("validation", "An appointment ends after it starts.");
    }
    const calendar = await bookableCalendar(ctx, input.calendarId ?? previous.calendarId);

    // The old row is released first, so moving an appointment by an hour does
    // not collide with itself.
    await ctx.tx
      .update(bookings)
      .set({
        status: "cancelled",
        cancellationReason: input.reason ?? "Rescheduled.",
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, previous.id));

    const [moved] = await ctx.tx
      .insert(bookings)
      .values({
        contactId: previous.contactId,
        serviceOfferingId: previous.serviceOfferingId,
        calendarId: calendar.id,
        secondaryCalendarIds: previous.secondaryCalendarIds,
        startsAt,
        endsAt,
        timezoneAtBooking: calendar.timezone,
        // A moved appointment is as agreed as the one it replaced.
        status: previous.status,
        locationId: previous.locationId,
        locationDetail: previous.locationDetail,
        capacityUsed: previous.capacityUsed,
        exclusive: calendar.capacityDefault <= 1,
        invoiceId: previous.invoiceId,
        rescheduledFromId: previous.id,
        rescheduleToken: randomBytes(24).toString("base64url"),
        intakeSubmissionId: previous.intakeSubmissionId,
        waiverId: previous.waiverId,
        source: previous.source,
        notes: previous.notes,
      })
      .returning()
      .catch((error: unknown) => {
        if (violates(error, "bookings_no_overlap") || lostARace(error)) {
          throw new ServiceError(
            "conflict",
            "That time is taken. Choose another and the appointment stays where it is.",
          );
        }
        throw error;
      });

    await recordOnTimeline(ctx, {
      contactId: previous.contactId,
      bookingId: moved!.id,
      eventType: "booking.rescheduled",
      payload: {
        from: previous.startsAt.toISOString(),
        to: startsAt.toISOString(),
        previousId: previous.id,
      },
    });
    ctx.setSubject("booking", moved!.id);
    ctx.queueEvent("booking.rescheduled", {
      id: moved!.id,
      previousId: previous.id,
      contactId: previous.contactId,
    });
    return moved!;
  },
});

export const listBookings = defineService({
  name: "bookings.list",
  summary: "Appointments in a window, by calendar or by customer.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    calendarId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    statuses: z.array(z.enum(BOOKING_STATUSES)).min(1).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: listed(
    bookingRow.extend({
      contactName: z.string().nullable(),
      contactEmail: z.string().nullable(),
      calendarName: z.string(),
    }),
  ),
  handler: async (input, ctx) => {
    const filters = [
      input.calendarId ? eq(bookings.calendarId, input.calendarId) : undefined,
      input.contactId ? eq(bookings.contactId, input.contactId) : undefined,
      input.from ? gte(bookings.endsAt, new Date(input.from)) : undefined,
      input.to ? lte(bookings.startsAt, new Date(input.to)) : undefined,
      input.statuses
        ? sql`${bookings.status} = any(${sql.param([...input.statuses])})`
        : undefined,
    ].filter(Boolean);

    return ctx.tx
      .select({
        id: bookings.id,
        contactId: bookings.contactId,
        serviceOfferingId: bookings.serviceOfferingId,
        calendarId: bookings.calendarId,
        secondaryCalendarIds: bookings.secondaryCalendarIds,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        timezoneAtBooking: bookings.timezoneAtBooking,
        status: bookings.status,
        locationId: bookings.locationId,
        locationDetail: bookings.locationDetail,
        capacityUsed: bookings.capacityUsed,
        exclusive: bookings.exclusive,
        invoiceId: bookings.invoiceId,
        rescheduledFromId: bookings.rescheduledFromId,
        intakeSubmissionId: bookings.intakeSubmissionId,
        waiverId: bookings.waiverId,
        source: bookings.source,
        notes: bookings.notes,
        cancellationReason: bookings.cancellationReason,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
        contactName: contacts.name,
        contactEmail: contacts.email,
        calendarName: calendars.name,
      })
      .from(bookings)
      .innerJoin(contacts, eq(contacts.id, bookings.contactId))
      .innerJoin(calendars, eq(calendars.id, bookings.calendarId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(bookings.startsAt))
      .limit(input.limit);
  },
});

export const getBooking = defineService({
  name: "bookings.get",
  summary: "One appointment and everybody on it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: bookingRow
    .extend({
      participants: listed(
        row({
          id: uuid,
          contactId: uuid.nullable(),
          name: z.string().nullable(),
          status: z.enum(PARTICIPANT_STATUSES),
          seatCount: z.number().int(),
        }),
      ),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [booking] = await ctx.tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.id))
      .limit(1);
    if (!booking) return null;
    const participants = await ctx.tx
      .select()
      .from(bookingParticipants)
      .where(eq(bookingParticipants.bookingId, booking.id))
      .orderBy(asc(bookingParticipants.createdAt));
    return { ...booking, participants };
  },
});

export const addBookingParticipant = defineService({
  name: "bookings.addParticipant",
  summary: "Add somebody to a group booking.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "blocks",
  input: z.object({
    bookingId: z.uuid(),
    email: z.string().trim().email().toLowerCase().optional(),
    /** "and my sister" is a real thing to book, and she has no email address. */
    name: z.string().trim().min(1).max(200).optional(),
    seatCount: z.number().int().min(1).max(100).default(1),
  }),
  output: row({
    id: uuid,
    contactId: uuid.nullable(),
    name: z.string().nullable(),
    status: z.enum(PARTICIPANT_STATUSES),
    seatCount: z.number().int(),
  }),
  handler: async (input, ctx) => {
    if (!input.email && !input.name) {
      throw new ServiceError("validation", "A guest needs a name or an email address.");
    }
    const [booking] = await ctx.tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) throw new ServiceError("not_found", "No such appointment.");

    const calendar = await bookableCalendar(ctx, booking.calendarId);
    await lockCalendarForSeating(ctx, calendar.id);
    const taken = await seatsTaken(ctx, {
      calendarId: booking.calendarId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      excludeId: booking.id,
    });
    if (taken + booking.capacityUsed + input.seatCount > calendar.capacityDefault) {
      throw new ServiceError("conflict", "There are not that many places left.");
    }

    const contactId = input.email
      ? (
          (await ctx.callAsSystem(getService("contacts.resolve"), {
            email: input.email,
            ...(input.name ? { name: input.name } : {}),
            source: "booking:guest",
          })) as { contact: { id: string } }
        ).contact.id
      : null;

    const [participant] = await ctx.tx
      .insert(bookingParticipants)
      .values({
        bookingId: booking.id,
        contactId,
        name: input.name ?? null,
        seatCount: input.seatCount,
      })
      .returning();

    // The seat the booking itself holds grows with the party.
    await ctx.tx
      .update(bookings)
      .set({
        capacityUsed: booking.capacityUsed + input.seatCount,
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, booking.id));

    ctx.setSubject("booking", booking.id);
    return participant!;
  },
});

/**
 * What an appointment means for the person's own data (§30).
 *
 * Erasure keeps the slot and forgets who it was for. A booking is also the
 * business's record — when somebody was here, what it cost, whether they
 * turned up — and deleting the row would take that with it. Notes are removed
 * because they are the one field somebody writes *about* a person.
 */
registerContactPrivacySource({
  scope: "contact.bookings",
  tables: ["bookings"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(bookings)
      .where(eq(bookings.contactId, contactId))
      .orderBy(asc(bookings.startsAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(bookings)
      .set({
        notes: null,
        locationDetail: null,
        // A signed link that outlived the person's request would be a way back
        // to a booking they asked to be forgotten from.
        rescheduleToken: null,
        cancellationReason: null,
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.contactId, contactId))
      .returning({ id: bookings.id });
    return { affected: rows.length };
  },
});

registerContactPrivacySource({
  scope: "contact.bookingParticipants",
  tables: ["booking_participants"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(bookingParticipants)
      .where(eq(bookingParticipants.contactId, contactId)),
  erase: async (tx, contactId) => {
    // A guest row exists to say a seat was taken. Forgetting who took it
    // leaves the seat count true and the person gone.
    const rows = await tx
      .update(bookingParticipants)
      .set({ contactId: null, name: null, updatedAt: sql`now()` })
      .where(eq(bookingParticipants.contactId, contactId))
      .returning({ id: bookingParticipants.id });
    return { affected: rows.length };
  },
});

export default [
  createBooking,
  setBookingStatus,
  rescheduleBooking,
  listBookings,
  getBooking,
  addBookingParticipant,
];
