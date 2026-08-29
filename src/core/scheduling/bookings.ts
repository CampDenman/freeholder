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
  cancellationOutcome,
  cancellationTerms,
  mayReschedule,
  noShowOutcome,
  storedOutcome,
  termsFrom,
  type BookingMoney,
  type CancellationTerms,
  type StoredOutcome,
} from "@/core/scheduling/policy";
import {
  cancelRemindersFor,
  scheduleRemindersFor,
} from "@/core/scheduling/reminders";
import { outstandingFor } from "@/core/scheduling/requirements";
import {
  defineService,
  getService,
  listServices,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
// Claims this module's room in the customer portal (C8.11). Imported for
// its side effect: core owns the registry so it never imports a module,
// and something has to make the claim at load time.
import "./portal";

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
  rescheduleCount: z.number().int(),
  cancellationPolicy: cancellationTerms.nullable(),
  cancellationOutcome: storedOutcome.nullable(),
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

/**
 * The cancellation terms to write onto a booking, taken once (C6.08).
 *
 * Core may not import a module (§11), so the terms are asked for through the
 * registry and copied. Catalog being switched off is not an error — it is an
 * instance that sells time without a catalogue, and its bookings simply cancel
 * freely. The call is `callAsSystem` because a customer booking on the public
 * site has no permission to read the catalogue's configuration, and the terms
 * are nevertheless part of what they are agreeing to.
 */
async function termsForOffering(
  ctx: ServiceContext,
  serviceOfferingId: string | null,
): Promise<CancellationTerms | null> {
  if (!serviceOfferingId) return null;
  if (!listServices().has("catalog.bookingTerms")) return null;
  const found = (await ctx.callAsSystem(getService("catalog.bookingTerms"), {
    serviceOfferingId,
  })) as CancellationTerms | null;
  return found ?? null;
}

/**
 * What has been invoiced and paid against an appointment (C6.08).
 *
 * Read from invoicing rather than duplicated here. Two records of what
 * somebody paid is one record too many: the moment they disagree, the wrong
 * one is the one somebody is looking at. An instance with the module switched
 * off, or a free consultation with no invoice at all, has nothing to read and
 * cancels at no charge, which is the correct answer rather than a fallback.
 */
async function moneyFor(
  ctx: ServiceContext,
  invoiceId: string | null,
): Promise<BookingMoney & { currency: string | null }> {
  const nothing = { valueMinor: 0, paidMinor: 0, currency: null };
  if (!invoiceId) return nothing;
  if (!listServices().has("invoicing.get")) return nothing;
  try {
    const bundle = (await ctx.callAsSystem(getService("invoicing.get"), {
      id: invoiceId,
    })) as { invoice: { totalMinor: number; paidMinor: number; currency: string } };
    return {
      valueMinor: bundle.invoice.totalMinor,
      paidMinor: bundle.invoice.paidMinor,
      currency: bundle.invoice.currency,
    };
  } catch {
    // An invoice that has been voided or deleted leaves the appointment with a
    // dangling id. Cancelling it must still work — refusing would trap the
    // booking in a state nobody can leave.
    return nothing;
  }
}

/**
 * Apply the terms this appointment was booked under, and record what they say.
 *
 * Deliberately produces a *record* rather than a transaction. §4.4 is explicit
 * that a booking is not a payment: refunding a card is money leaving the
 * business, which is a step-up-guarded act in the invoicing module and not
 * something a status change performs on its way past. What is stored here is
 * the decision — fee, refund due, still owed, and the sentence the customer is
 * shown — so the owner's refund control has something to act on and the
 * customer has something to be told.
 */
async function decideOutcome(
  ctx: ServiceContext,
  booking: { startsAt: Date; invoiceId: string | null; cancellationPolicy: unknown },
  kind: "cancelled" | "no_show",
): Promise<StoredOutcome> {
  const terms = termsFrom(booking.cancellationPolicy);
  const money = await moneyFor(ctx, booking.invoiceId);
  const decided =
    kind === "no_show"
      ? noShowOutcome({ terms, money })
      : cancellationOutcome({ terms, startsAt: booking.startsAt, now: new Date(), money });
  return storedOutcome.parse({
    free: decided.free,
    feeMinor: decided.feeMinor,
    refundDueMinor: decided.refundDueMinor,
    outstandingMinor: decided.outstandingMinor,
    forfeitsDeposit: decided.forfeitsDeposit,
    paidMinor: money.paidMinor,
    valueMinor: money.valueMinor,
    currency: money.currency,
    policyName: terms.name,
    reason: decided.reason,
    decidedAt: new Date().toISOString(),
  });
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
        // Snapshotted, never referenced: §4.4's "the customer saw the terms
        // before booking" is only true while editing the policy later cannot
        // change what somebody already agreed to (C6.08).
        cancellationPolicy: await termsForOffering(ctx, input.serviceOfferingId ?? null),
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
    /**
     * Confirm it even though the intake or the waiver is outstanding.
     *
     * The owner's call, never a customer-facing one. Somebody who signed on
     * paper in the shop has met the requirement in the way that matters, and a
     * platform that refused to record that would be enforcing its own
     * bookkeeping against the business it serves.
     */
    overrideRequirements: z.boolean().default(false),
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

    // §4.4: intake and a signed waiver come **before the slot is confirmed**,
    // not before it is booked. Somebody who cannot hold a slot until they have
    // signed something is somebody who leaves; the requested → confirmed step
    // is exactly where the condition belongs, and it is the first thing to use
    // the distinction the state machine already made.
    if (input.status === "confirmed" && !input.overrideRequirements) {
      const outstanding = await outstandingFor(ctx, booking);
      if (!outstanding.ready) {
        throw new ServiceError(
          "conflict",
          outstanding.intakeFormId && outstanding.waiverOutstanding
            ? "The intake form and the waiver are both still outstanding."
            : outstanding.intakeFormId
              ? "The intake form has not been filled in yet."
              : "The waiver has not been signed yet.",
        );
      }
    }

    // §4.4: "Cancellation is policy-driven, not ad hoc." The decision is made
    // and recorded here; moving the money is a deliberate act in the invoicing
    // module, because a booking is not a payment.
    const outcome =
      input.status === "cancelled" || input.status === "no_show"
        ? await decideOutcome(ctx, booking, input.status)
        : null;

    const [updated] = await ctx.tx
      .update(bookings)
      .set({
        status: input.status,
        cancellationReason:
          input.status === "cancelled" ? (input.reason ?? null) : booking.cancellationReason,
        ...(outcome ? { cancellationOutcome: outcome } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, input.id))
      .returning();

    // Reminders follow the appointment's life: scheduled when it becomes real,
    // dropped when it stops being. Both inside the same transaction as the
    // status change, because a reminder for an appointment that did not
    // actually get confirmed is worse than none.
    if (input.status === "confirmed") {
      await scheduleRemindersFor(ctx, booking);
    } else if (!HOLDING_STATUSES.includes(input.status as (typeof HOLDING_STATUSES)[number])) {
      await cancelRemindersFor(ctx, booking.id);
    }

    await recordOnTimeline(ctx, {
      contactId: booking.contactId,
      bookingId: booking.id,
      eventType: `booking.${input.status}`,
      payload: {
        ...(input.reason ? { reason: input.reason } : {}),
        ...(outcome ? { outcome } : {}),
      },
    });
    ctx.setSubject("booking", booking.id);
    ctx.queueEvent(`booking.${input.status}`, {
      id: booking.id,
      contactId: booking.contactId,
      calendarId: booking.calendarId,
      ...(outcome ? { outcome } : {}),
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
    /**
     * Move it regardless of the policy — the owner's own override.
     *
     * The policy binds the customer, not the business: an owner who agrees to
     * move somebody's appointment as a favour should not have to cancel and
     * rebook to do it. Never settable from a customer-facing path.
     */
    overridePolicy: z.boolean().default(false),
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
    if (!input.overridePolicy) {
      const verdict = mayReschedule({
        terms: termsFrom(previous.cancellationPolicy),
        rescheduleCount: previous.rescheduleCount,
        startsAt: previous.startsAt,
        now: new Date(),
      });
      if (!verdict.allowed) throw new ServiceError("conflict", verdict.reason!);
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) {
      throw new ServiceError("validation", "An appointment ends after it starts.");
    }
    const calendar = await bookableCalendar(ctx, input.calendarId ?? previous.calendarId);

    // A shared calendar's seats are counted the same way here as when the
    // booking was made. Without it, moving into a full class is the one door
    // left open in the seat accounting — the exclusion constraint deliberately
    // does not fire on a calendar whose bookings overlap by design (C6.04).
    if (calendar.capacityDefault > 1) {
      await lockCalendarForSeating(ctx, calendar.id);
      const taken = await seatsTaken(ctx, {
        calendarId: calendar.id,
        startsAt,
        endsAt,
        excludeId: previous.id,
      });
      if (taken + previous.capacityUsed > calendar.capacityDefault) {
        throw new ServiceError(
          "conflict",
          `Only ${calendar.capacityDefault - taken} place(s) left at that time.`,
        );
      }
    }

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
        // Carried, not recounted. The terms are the ones the customer agreed
        // to, and the count is what a reschedule limit is a limit on — walking
        // `rescheduledFromId` instead would stop enforcing the moment somebody
        // tidied up an old row.
        rescheduleCount: previous.rescheduleCount + 1,
        cancellationPolicy: previous.cancellationPolicy,
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

    // The reminders belong to the appointment, not to the row. The old row is
    // cancelled above, which drops its scheduled reminders; the new one gets
    // its own, computed from where it actually is now.
    await cancelRemindersFor(ctx, previous.id);
    if (HOLDING_STATUSES.includes(moved!.status as (typeof HOLDING_STATUSES)[number])) {
      await scheduleRemindersFor(ctx, moved!);
    }

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

/**
 * The customer's own appointment, found by the link they were sent (C6.08).
 *
 * §4.4: "Customers reschedule through a signed `reschedule_token` link, with
 * **no login and no support email**." The token is the authorisation, which is
 * why this is public — a session would mean the link worked only for customers
 * who happened to have an account, which is the support email again wearing a
 * different hat.
 *
 * What comes back is deliberately narrow: their time, their service, and what
 * the policy lets them do. The owner's notes are not theirs to read.
 */
const tokenView = row({
  id: uuid,
  startsAt: timestamp,
  endsAt: timestamp,
  timezoneAtBooking: z.string(),
  status: z.enum(BOOKING_STATUSES),
  calendarId: uuid,
  calendarName: z.string(),
  locationDetail: z.string().nullable(),
  mayReschedule: z.boolean(),
  mayCancel: z.boolean(),
  /** Why not, when they may not. Shown instead of a dead button. */
  refusal: z.string().nullable(),
  policyName: z.string().nullable(),
  /** The intake form still to fill in, so the page can link straight to it. */
  intakeFormId: uuid.nullable(),
  /** The signing link for an outstanding waiver, or null when there is none. */
  waiverToken: z.string().nullable(),
});

async function tokenBooking(ctx: ServiceContext, token: string) {
  const [found] = await ctx.tx
    .select({
      booking: bookings,
      calendarName: calendars.name,
    })
    .from(bookings)
    .innerJoin(calendars, eq(calendars.id, bookings.calendarId))
    .where(eq(bookings.rescheduleToken, token))
    .limit(1);
  return found ?? null;
}

function tokenViewOf(
  booking: typeof bookings.$inferSelect,
  calendarName: string,
  outstanding?: { intakeFormId: string | null; waiverToken: string | null },
): z.infer<typeof tokenView> {
  const terms = termsFrom(booking.cancellationPolicy);
  const live = HOLDING_STATUSES.includes(
    booking.status as (typeof HOLDING_STATUSES)[number],
  );
  const verdict = mayReschedule({
    terms,
    rescheduleCount: booking.rescheduleCount,
    startsAt: booking.startsAt,
    now: new Date(),
  });
  return {
    id: booking.id,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    timezoneAtBooking: booking.timezoneAtBooking,
    status: booking.status,
    calendarId: booking.calendarId,
    calendarName,
    locationDetail: booking.locationDetail,
    mayReschedule: live && verdict.allowed,
    // Cancelling is always allowed while the appointment is still going ahead.
    // The policy decides what it *costs*, not whether somebody is permitted to
    // stop attending — refusing that would be holding people to an appointment
    // they have told you they cannot make.
    mayCancel: live,
    refusal: live ? (verdict.reason ?? null) : "This appointment is already closed.",
    policyName: booking.cancellationPolicy ? terms.name : null,
    intakeFormId: outstanding?.intakeFormId ?? null,
    waiverToken: outstanding?.waiverToken ?? null,
  };
}

/**
 * What the customer still has to do, and the links that let them do it.
 *
 * The waiver's signing token is fetched here rather than shown in a list,
 * because the person holding *this* booking link is exactly the person the
 * waiver was issued to — handing them their own signing link is the whole
 * point, and it is the only place in the product where that is true.
 */
async function outstandingForToken(
  ctx: ServiceContext,
  booking: {
    id: string;
    serviceOfferingId: string | null;
    intakeSubmissionId: string | null;
    waiverId: string | null;
  },
): Promise<{ intakeFormId: string | null; waiverToken: string | null }> {
  const outstanding = await outstandingFor(ctx, booking);
  let waiverToken: string | null = null;
  if (outstanding.waiverOutstanding && listServices().has("contracts.signingLink")) {
    const link = (await ctx.callAsSystem(getService("contracts.signingLink"), {
      subjectType: "booking",
      subjectId: booking.id,
    })) as { token: string | null };
    waiverToken = link.token;
  }
  return { intakeFormId: outstanding.intakeFormId, waiverToken };
}

export const bookingByToken = defineService({
  name: "bookings.byToken",
  summary: "One appointment, for the customer holding its link.",
  kind: "query",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: tokenView.nullable(),
  handler: async (input, ctx) => {
    const found = await tokenBooking(ctx, input.token);
    if (!found) return null;
    return tokenViewOf(
      found.booking,
      found.calendarName,
      await outstandingForToken(ctx, found.booking),
    );
  },
});

export const rescheduleByToken = defineService({
  name: "bookings.rescheduleByToken",
  summary: "Let the customer move their own appointment.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "blocks",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  }),
  output: tokenView,
  handler: async (input, ctx) => {
    const found = await tokenBooking(ctx, input.token);
    if (!found) throw new ServiceError("not_found", "That link is no longer valid.");
    const moved = (await ctx.callAsSystem(getService("bookings.reschedule"), {
      id: found.booking.id,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: "Moved by the customer.",
      // Never overridden from here. The override is the owner's, and a
      // customer-facing path that could set it would make the policy advisory.
      overridePolicy: false,
    })) as typeof bookings.$inferSelect;
    return tokenViewOf(moved, found.calendarName);
  },
});

export const cancelByToken = defineService({
  name: "bookings.cancelByToken",
  summary: "Let the customer cancel their own appointment.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "blocks",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    reason: z.string().trim().min(1).max(500).default("Cancelled by the customer."),
  }),
  output: z.object({ id: uuid, outcome: storedOutcome.nullable() }),
  handler: async (input, ctx) => {
    const found = await tokenBooking(ctx, input.token);
    if (!found) throw new ServiceError("not_found", "That link is no longer valid.");
    const cancelled = (await ctx.callAsSystem(getService("bookings.setStatus"), {
      id: found.booking.id,
      status: "cancelled",
      reason: input.reason,
    })) as typeof bookings.$inferSelect;
    // The terms are told to them plainly at the moment they cancel, which is
    // the one moment somebody actually reads them.
    return {
      id: cancelled.id,
      outcome: storedOutcome.nullable().parse(cancelled.cancellationOutcome ?? null),
    };
  },
});

export const listBookings = defineService({
  name: "bookings.list",
  summary: "Appointments in a window, by calendar or by customer.",
  kind: "query",
  permission: "scoped",
  // C8.11: the customer this asks about may ask it themselves. The
  // contract layer verifies the field is present and is their own contact
  // before the handler runs, so this widens what a customer can *see*
  // about themselves and nothing else.
  selfService: { contactField: "contactId" },
  input: z.object({
    calendarId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    statuses: z.array(z.enum(BOOKING_STATUSES)).min(1).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  // A list, not a set of full records. The policy snapshot and the
  // cancellation outcome are read on the one appointment somebody opened —
  // carrying two JSON blobs per row through a day's diary buys nothing.
  output: listed(
    bookingRow
      .omit({ cancellationPolicy: true, cancellationOutcome: true })
      .extend({
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
        rescheduleCount: bookings.rescheduleCount,
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

export const removeBookingParticipant = defineService({
  name: "bookings.removeParticipant",
  summary: "Take somebody out of a group booking and give the seat back.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "blocks",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid, bookingId: uuid, seatsReleased: z.number().int() }),
  handler: async (input, ctx) => {
    const [participant] = await ctx.tx
      .select()
      .from(bookingParticipants)
      .where(eq(bookingParticipants.id, input.id))
      .limit(1);
    if (!participant) throw new ServiceError("not_found", "That guest is not on this booking.");

    const [booking] = await ctx.tx
      .select({ id: bookings.id, capacityUsed: bookings.capacityUsed })
      .from(bookings)
      .where(eq(bookings.id, participant.bookingId))
      .limit(1);
    if (!booking) throw new ServiceError("not_found", "No such appointment.");

    await ctx.tx
      .delete(bookingParticipants)
      .where(eq(bookingParticipants.id, participant.id));
    // The seat goes back to the calendar. Never below one: the booking itself
    // is somebody, and a party of zero holding no time is a row that quietly
    // stops appearing in the seat count while still occupying a slot.
    await ctx.tx
      .update(bookings)
      .set({
        capacityUsed: Math.max(1, booking.capacityUsed - participant.seatCount),
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, booking.id));

    ctx.setSubject("booking", booking.id);
    // A freed seat on a shared calendar is exactly what somebody is waiting
    // for. The event carries it; the waitlist decides what to do with it.
    ctx.queueEvent("booking.seatsReleased", {
      id: booking.id,
      seats: participant.seatCount,
    });
    return {
      id: participant.id,
      bookingId: booking.id,
      seatsReleased: participant.seatCount,
    };
  },
});

export const setParticipantStatus = defineService({
  name: "bookings.setParticipantStatus",
  summary: "Mark who turned up to a class.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid(), status: z.enum(PARTICIPANT_STATUSES) }),
  output: row({
    id: uuid,
    bookingId: uuid,
    status: z.enum(PARTICIPANT_STATUSES),
  }),
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(bookingParticipants)
      .set({ status: input.status, updatedAt: sql`now()` })
      .where(eq(bookingParticipants.id, input.id))
      .returning({
        id: bookingParticipants.id,
        bookingId: bookingParticipants.bookingId,
        status: bookingParticipants.status,
        contactId: bookingParticipants.contactId,
      });
    if (!updated) throw new ServiceError("not_found", "That guest is not on this booking.");
    // A guest with a contact gets it on their own timeline; a named guest with
    // no row in the spine has nowhere to put it, which is the honest answer
    // rather than inventing a contact for somebody who gave no email address.
    if (updated.contactId) {
      await recordOnTimeline(ctx, {
        contactId: updated.contactId,
        bookingId: updated.bookingId,
        eventType: `booking.participant.${input.status}`,
      });
    }
    ctx.setSubject("booking", updated.bookingId);
    return updated;
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
  bookingByToken,
  rescheduleByToken,
  cancelByToken,
  listBookings,
  getBooking,
  addBookingParticipant,
  removeBookingParticipant,
  setParticipantStatus,
];
