// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who wants a full slot, in order (MASTER.md §4.4's `Waitlist`, C6.08).
//
// A waitlist is the difference between "sorry, we're full" and a booking the
// business would otherwise never have taken. The whole value is in what
// happens at the moment a seat frees, and there are two ways to do it:
//
//   1. Tell everybody at once and let them race.
//   2. Offer it to the first person in line, and hold it for them.
//
// This does the second. The first is easier to build and looks generous, but
// it is a race the business always wins and the customer always loses: the
// person who was first in line finds the seat gone by the time they read the
// email, and learns that the waitlist is a lottery. An offer here is held —
// a token, a deadline, and nobody else's until the deadline passes.
//
// The queue is ordered by the owner's `position` and then by when somebody
// joined, so "first asked" is a fact rather than whatever the query returned.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import {
  bookings,
  bookingWaitlist,
  calendars,
  WAITLIST_STATUSES,
} from "@/core/scheduling/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";

/** How long somebody has to take up an offer before it passes on. */
const DEFAULT_OFFER_HOURS = 24;

const waitlistRow = row({
  id: uuid,
  contactId: uuid,
  serviceOfferingId: uuid.nullable(),
  calendarId: uuid.nullable(),
  windowStart: timestamp,
  windowEnd: timestamp,
  seatCount: z.number().int(),
  status: z.enum(WAITLIST_STATUSES),
  position: z.number().int(),
  offeredAt: timestamp.nullable(),
  offerExpiresAt: timestamp.nullable(),
  offerStartsAt: timestamp.nullable(),
  offerEndsAt: timestamp.nullable(),
  bookingId: uuid.nullable(),
  notes: z.string().nullable(),
});

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to manage the waitlist.");
  }
}

async function recordOnTimeline(
  ctx: ServiceContext,
  input: { contactId: string; entryId: string; eventType: string; payload?: object },
): Promise<void> {
  await ctx.tx.insert(timelineEvents).values({
    contactId: input.contactId,
    actor: ctx.actor.kind === "user" ? `user:${ctx.actor.userId}` : "system",
    eventType: input.eventType,
    subjectType: "waitlist_entry",
    subjectId: input.entryId,
    payload: input.payload ?? {},
  });
}

export const joinWaitlist = defineService({
  name: "waitlist.join",
  summary: "Ask to be told when a full slot frees up.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({
    /** The one automated door into the spine (§2 principle 3). */
    contact: z.object({
      email: z.string().trim().email().toLowerCase(),
      name: z.string().trim().min(1).max(200).optional(),
      phone: z.string().trim().max(100).optional(),
    }),
    /** Null means "whoever is free", which is what most people actually want. */
    calendarId: z.uuid().nullish(),
    serviceOfferingId: z.uuid().nullish(),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    seatCount: z.number().int().min(1).max(100).default(1),
    notes: z.string().trim().max(1_000).nullish(),
  }),
  output: waitlistRow,
  handler: async (input, ctx) => {
    const windowStart = new Date(input.windowStart);
    const windowEnd = new Date(input.windowEnd);
    if (windowEnd <= windowStart) {
      throw new ServiceError("validation", "A window ends after it starts.");
    }
    if (input.calendarId) {
      const [calendar] = await ctx.tx
        .select({ id: calendars.id, status: calendars.status })
        .from(calendars)
        .where(eq(calendars.id, input.calendarId))
        .limit(1);
      if (!calendar) throw new ServiceError("not_found", "No such calendar.");
      if (calendar.status !== "active") {
        throw new ServiceError("conflict", "That calendar takes no new bookings.");
      }
    }

    // Never `contacts.create`: somebody on a waitlist is very often somebody
    // the business already knows, and an insert would fork the spine.
    const resolved = (await ctx.callAsSystem(getService("contacts.resolve"), {
      email: input.contact.email,
      ...(input.contact.name ? { name: input.contact.name } : {}),
      ...(input.contact.phone ? { phone: input.contact.phone } : {}),
      source: "waitlist",
    })) as { contact: { id: string } };

    // Joining twice for the same window is a person clicking twice, not a
    // person wanting two seats. The existing entry keeps its place in the
    // queue, which is the whole thing they would lose by being re-added.
    const [existing] = await ctx.tx
      .select()
      .from(bookingWaitlist)
      .where(
        and(
          eq(bookingWaitlist.contactId, resolved.contact.id),
          eq(bookingWaitlist.windowStart, windowStart),
          eq(bookingWaitlist.windowEnd, windowEnd),
          input.calendarId
            ? eq(bookingWaitlist.calendarId, input.calendarId)
            : isNull(bookingWaitlist.calendarId),
          sql`${bookingWaitlist.status} in ('waiting','offered')`,
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [created] = await ctx.tx
      .insert(bookingWaitlist)
      .values({
        contactId: resolved.contact.id,
        calendarId: input.calendarId ?? null,
        serviceOfferingId: input.serviceOfferingId ?? null,
        windowStart,
        windowEnd,
        seatCount: input.seatCount,
        notes: input.notes ?? null,
      })
      .returning();

    await recordOnTimeline(ctx, {
      contactId: resolved.contact.id,
      entryId: created!.id,
      eventType: "waitlist.joined",
      payload: { windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() },
    });
    ctx.setSubject("waitlistEntry", created!.id);
    ctx.queueEvent("waitlist.joined", {
      id: created!.id,
      contactId: resolved.contact.id,
    });
    return created!;
  },
});

export const listWaitlist = defineService({
  name: "waitlist.list",
  summary: "The queue for a calendar, in the order it will be offered.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    calendarId: z.uuid().optional(),
    status: z.enum(WAITLIST_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    waitlistRow.extend({
      contactName: z.string().nullable(),
      contactEmail: z.string().nullable(),
    }),
  ),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx
      .select({
        id: bookingWaitlist.id,
        contactId: bookingWaitlist.contactId,
        serviceOfferingId: bookingWaitlist.serviceOfferingId,
        calendarId: bookingWaitlist.calendarId,
        windowStart: bookingWaitlist.windowStart,
        windowEnd: bookingWaitlist.windowEnd,
        seatCount: bookingWaitlist.seatCount,
        status: bookingWaitlist.status,
        position: bookingWaitlist.position,
        offeredAt: bookingWaitlist.offeredAt,
        offerExpiresAt: bookingWaitlist.offerExpiresAt,
        offerStartsAt: bookingWaitlist.offerStartsAt,
        offerEndsAt: bookingWaitlist.offerEndsAt,
        bookingId: bookingWaitlist.bookingId,
        notes: bookingWaitlist.notes,
        contactName: contacts.name,
        contactEmail: contacts.email,
      })
      .from(bookingWaitlist)
      .innerJoin(contacts, eq(contacts.id, bookingWaitlist.contactId))
      .where(
        and(
          input.calendarId ? eq(bookingWaitlist.calendarId, input.calendarId) : undefined,
          input.status ? eq(bookingWaitlist.status, input.status) : undefined,
        ),
      )
      // The same order the offer runs in, so the list is a prediction rather
      // than a different opinion.
      .orderBy(asc(bookingWaitlist.position), asc(bookingWaitlist.createdAt))
      .limit(input.limit);
    // The offer token is never here. It is a credential, and a list is the
    // easiest place in the product for one to end up in a log or a screenshot.
    return rows;
  },
});

export const setWaitlistPosition = defineService({
  name: "waitlist.setPosition",
  summary: "Move somebody up or down the queue.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id: z.uuid(), position: z.number().int().min(0).max(10_000) }),
  output: waitlistRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(bookingWaitlist)
      .set({ position: input.position, updatedAt: sql`now()` })
      .where(eq(bookingWaitlist.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That waitlist entry is not here.");
    ctx.setSubject("waitlistEntry", updated.id);
    return updated;
  },
});

export const withdrawFromWaitlist = defineService({
  name: "waitlist.withdraw",
  summary: "Take somebody off the queue.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: waitlistRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(bookingWaitlist)
      .set({
        status: "withdrawn",
        // The offer goes with the entry, or a lapsed token still opens a door.
        offerToken: null,
        offerExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(bookingWaitlist.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That waitlist entry is not here.");
    await recordOnTimeline(ctx, {
      contactId: updated.contactId,
      entryId: updated.id,
      eventType: "waitlist.withdrawn",
    });
    ctx.setSubject("waitlistEntry", updated.id);
    return updated;
  },
});

/**
 * Whether a seat is genuinely free on a calendar for a window.
 *
 * Asked before an offer goes out, because the alternative is telling somebody
 * a slot is theirs and then discovering it is not — which is worse than never
 * having offered.
 */
async function seatsFree(
  tx: Tx,
  input: { calendarId: string; startsAt: Date; endsAt: Date },
): Promise<number> {
  const [calendar] = await tx
    .select({ capacity: calendars.capacityDefault, status: calendars.status })
    .from(calendars)
    .where(eq(calendars.id, input.calendarId))
    .limit(1);
  if (!calendar || calendar.status !== "active") return 0;
  const [held] = await tx
    .select({ seats: sql<number>`coalesce(sum(${bookings.capacityUsed}), 0)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.calendarId, input.calendarId),
        sql`${bookings.status} in ('requested','confirmed','in_progress')`,
        sql`tstzrange(${bookings.startsAt}, ${bookings.endsAt}, '[)')
            && tstzrange(${input.startsAt.toISOString()}::timestamptz,
                         ${input.endsAt.toISOString()}::timestamptz, '[)')`,
      ),
    );
  // Seats an outstanding offer is already holding are not free. Without this
  // the same seat is offered to two people, which is the exact race the held
  // offer exists to prevent.
  const [offered] = await tx
    .select({ seats: sql<number>`coalesce(sum(${bookingWaitlist.seatCount}), 0)::int` })
    .from(bookingWaitlist)
    .where(
      and(
        eq(bookingWaitlist.calendarId, input.calendarId),
        eq(bookingWaitlist.status, "offered"),
        sql`${bookingWaitlist.offerExpiresAt} > now()`,
        sql`tstzrange(${bookingWaitlist.offerStartsAt}, ${bookingWaitlist.offerEndsAt}, '[)')
            && tstzrange(${input.startsAt.toISOString()}::timestamptz,
                         ${input.endsAt.toISOString()}::timestamptz, '[)')`,
      ),
    );
  return Math.max(0, calendar.capacity - (held?.seats ?? 0) - (offered?.seats ?? 0));
}

export const offerWaitlistSlot = defineService({
  name: "waitlist.offer",
  summary: "Hold a freed slot for the first person in line.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z.object({
    calendarId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    /** Skip the queue and offer it to one named entry — the owner's override. */
    entryId: z.uuid().optional(),
    offerHours: z.number().int().min(1).max(336).default(DEFAULT_OFFER_HOURS),
  }),
  output: z.object({ offered: waitlistRow.nullable(), reason: z.string().nullable() }),
  handler: async (input, ctx) => {
    // A person or the platform itself. The automatic pass that runs when an
    // appointment is cancelled comes through here as the system, so both the
    // owner's manual offer and the automatic one take the queue in the same
    // order — two implementations would eventually disagree about who is next.
    if (ctx.actor.kind !== "system") requirePerson(ctx.actor);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) {
      throw new ServiceError("validation", "A slot ends after it starts.");
    }
    return offerSlot(ctx, {
      calendarId: input.calendarId,
      startsAt,
      endsAt,
      entryId: input.entryId,
      offerHours: input.offerHours,
    });
  },
});

/**
 * Offer one freed slot to whoever is next, and hold it for them.
 *
 * Shared by the owner's manual control and the automatic pass that runs when
 * an appointment is cancelled, so both take the queue in the same order and
 * neither can offer a seat the other has already promised.
 */
export async function offerSlot(
  ctx: ServiceContext,
  input: {
    calendarId: string;
    startsAt: Date;
    endsAt: Date;
    entryId?: string;
    offerHours?: number;
  },
): Promise<{ offered: (typeof bookingWaitlist.$inferSelect) | null; reason: string | null }> {
  // Serialise the whole offer against this calendar. Two cancellations landing
  // together would otherwise both see the same free seat and both promise it.
  await ctx.tx.execute(
    sql`select id from ${calendars} where ${calendars.id} = ${input.calendarId} for update`,
  );

  const free = await seatsFree(ctx.tx, {
    calendarId: input.calendarId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
  if (free <= 0) return { offered: null, reason: "Nothing is free at that time." };

  const [next] = await ctx.tx
    .select()
    .from(bookingWaitlist)
    .where(
      and(
        eq(bookingWaitlist.status, "waiting"),
        input.entryId ? eq(bookingWaitlist.id, input.entryId) : undefined,
        // A null calendar means "whoever is free", so those entries are
        // candidates for every calendar rather than none.
        or(
          isNull(bookingWaitlist.calendarId),
          eq(bookingWaitlist.calendarId, input.calendarId),
        ),
        // The slot has to be inside the window they actually asked for.
        lte(bookingWaitlist.windowStart, input.startsAt),
        sql`${bookingWaitlist.windowEnd} >= ${input.endsAt.toISOString()}::timestamptz`,
        sql`${bookingWaitlist.seatCount} <= ${free}`,
      ),
    )
    .orderBy(asc(bookingWaitlist.position), asc(bookingWaitlist.createdAt))
    .limit(1);
  if (!next) return { offered: null, reason: "Nobody in the queue wants that slot." };

  const expiresAt = new Date(
    Date.now() + (input.offerHours ?? DEFAULT_OFFER_HOURS) * 3_600_000,
  );
  const [offered] = await ctx.tx
    .update(bookingWaitlist)
    .set({
      status: "offered",
      offeredAt: sql`now()`,
      offerExpiresAt: expiresAt,
      offerToken: randomBytes(24).toString("base64url"),
      offerStartsAt: input.startsAt,
      offerEndsAt: input.endsAt,
      // The offer is for this calendar even when they asked for any of them,
      // or claiming it would have to guess which one they were promised.
      calendarId: input.calendarId,
      updatedAt: sql`now()`,
    })
    .where(eq(bookingWaitlist.id, next.id))
    .returning();

  await recordOnTimeline(ctx, {
    contactId: offered!.contactId,
    entryId: offered!.id,
    eventType: "waitlist.offered",
    payload: {
      startsAt: input.startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });
  ctx.queueEvent("waitlist.offered", {
    id: offered!.id,
    contactId: offered!.contactId,
    calendarId: input.calendarId,
    startsAt: input.startsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  return { offered: offered!, reason: null };
}

export const claimWaitlistOffer = defineService({
  name: "waitlist.claim",
  summary: "Take up a held slot, with no account and no support email.",
  kind: "mutation",
  // The token *is* the authorisation, as with the reschedule link (§4.4):
  // somebody claiming an offer from an email has no session, and requiring one
  // would mean the offer only worked for customers who happened to have an
  // account. It is unguessable, single-use, and expires on its own.
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "blocks",
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: z.object({ bookingId: uuid, startsAt: timestamp, endsAt: timestamp }),
  handler: async (input, ctx) => {
    const [entry] = await ctx.tx
      .select()
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.offerToken, input.token))
      .limit(1);
    if (!entry || entry.status !== "offered") {
      throw new ServiceError("not_found", "That offer is no longer open.");
    }
    if (!entry.offerExpiresAt || entry.offerExpiresAt <= new Date()) {
      throw new ServiceError(
        "conflict",
        "That offer has expired and the slot has gone to somebody else.",
      );
    }
    if (!entry.calendarId || !entry.offerStartsAt || !entry.offerEndsAt) {
      throw new ServiceError("conflict", "That offer is incomplete.");
    }

    const [contact] = await ctx.tx
      .select({ email: contacts.email, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, entry.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "That offer is no longer open.");

    // The seat this offer was holding is released first, so the booking does
    // not collide with the hold that was keeping it available.
    await ctx.tx
      .update(bookingWaitlist)
      .set({ status: "booked", offerToken: null, updatedAt: sql`now()` })
      .where(eq(bookingWaitlist.id, entry.id));

    const booking = (await ctx.callAsSystem(getService("bookings.create"), {
      calendarId: entry.calendarId,
      contact: { email: contact.email, ...(contact.name ? { name: contact.name } : {}) },
      serviceOfferingId: entry.serviceOfferingId,
      startsAt: entry.offerStartsAt.toISOString(),
      endsAt: entry.offerEndsAt.toISOString(),
      capacityUsed: entry.seatCount,
      source: "site",
      status: "confirmed",
    })) as { id: string; startsAt: Date; endsAt: Date };

    await ctx.tx
      .update(bookingWaitlist)
      .set({ bookingId: booking.id, updatedAt: sql`now()` })
      .where(eq(bookingWaitlist.id, entry.id));
    await recordOnTimeline(ctx, {
      contactId: entry.contactId,
      entryId: entry.id,
      eventType: "waitlist.claimed",
      payload: { bookingId: booking.id },
    });
    ctx.setSubject("waitlistEntry", entry.id);
    return {
      bookingId: booking.id,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    };
  },
});

/**
 * Let lapsed offers go, and pass the slot to the next person in line.
 *
 * Run on a schedule rather than checked lazily, because the whole promise of a
 * held offer is that it *stops* being held. An offer nobody sweeps up sits on
 * a seat forever, and the queue behind it never moves.
 */
export const expireWaitlistOffers = defineService({
  name: "waitlist.expireOffers",
  summary: "Release offers nobody took up, and pass the slot on.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({}),
  output: z.object({ expired: z.number().int(), reoffered: z.number().int() }),
  handler: async (_input, ctx) => {
    const lapsed = await ctx.tx
      .update(bookingWaitlist)
      .set({ status: "expired", offerToken: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(bookingWaitlist.status, "offered"),
          lte(bookingWaitlist.offerExpiresAt, new Date()),
        ),
      )
      .returning({
        id: bookingWaitlist.id,
        contactId: bookingWaitlist.contactId,
        calendarId: bookingWaitlist.calendarId,
        startsAt: bookingWaitlist.offerStartsAt,
        endsAt: bookingWaitlist.offerEndsAt,
      });

    let reoffered = 0;
    for (const entry of lapsed) {
      await recordOnTimeline(ctx, {
        contactId: entry.contactId,
        entryId: entry.id,
        eventType: "waitlist.offerExpired",
      });
      if (!entry.calendarId || !entry.startsAt || !entry.endsAt) continue;
      const passed = await offerSlot(ctx, {
        calendarId: entry.calendarId,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
      });
      if (passed.offered) reoffered += 1;
    }
    return { expired: lapsed.length, reoffered };
  },
});

/**
 * Offer a freed slot in response to a committed booking event (C6.08).
 *
 * On the event bus rather than inside the cancellation, for the same reason
 * the upstream calendar write is (C6.06): the seat is only genuinely free once
 * the cancellation has committed. Offering from inside the transaction would
 * promise a slot to somebody and then, if the mutation rolled back, leave them
 * holding an offer for an appointment that never went away.
 *
 * Never throws into the bus. The cancellation has already happened and is
 * correct; a waitlist that could not be advanced is a smaller problem than a
 * cancellation that appears to have failed.
 */
export async function offerForBookingEvent(
  eventName: string,
  payload: unknown,
): Promise<void> {
  if (eventName !== "booking.cancelled" && eventName !== "booking.seatsReleased") {
    return;
  }
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) return;

  try {
    const { db } = await import("@/core/db");
    const [booking] = await db()
      .select({
        calendarId: bookings.calendarId,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
      })
      .from(bookings)
      .where(eq(bookings.id, id))
      .limit(1);
    if (!booking) return;
    await offerWaitlistSlot.call(
      {
        calendarId: booking.calendarId,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
      },
      { kind: "system" },
    );
  } catch (error) {
    console.warn(`[scheduling] could not offer the slot freed by ${id}`, error);
  }
}

/**
 * Erasure keeps the queue honest and forgets who was in it.
 *
 * The row is deleted rather than blanked, unlike a booking: a waitlist entry
 * is a request, not a record of something that happened, and there is no
 * business fact left behind once the person is gone.
 */
registerContactPrivacySource({
  scope: "contact.waitlist",
  tables: ["booking_waitlist"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.contactId, contactId))
      .orderBy(asc(bookingWaitlist.windowStart)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .delete(bookingWaitlist)
      .where(eq(bookingWaitlist.contactId, contactId))
      .returning({ id: bookingWaitlist.id });
    return { affected: rows.length };
  },
});

export default [
  joinWaitlist,
  listWaitlist,
  setWaitlistPosition,
  withdrawFromWaitlist,
  offerWaitlistSlot,
  claimWaitlistOffer,
  expireWaitlistOffers,
];
