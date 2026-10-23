// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events, sessions, tickets, waitlists, check-in (MASTER.md C6.11).

import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { isUniqueViolation } from "@/core/db";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineOrchestratedService, defineService, permits, ServiceError, type ServiceContext } from "@/core/service";
import { anonymousClientKey, consumeAccepted, rateLimitKey } from "@/core/security/rate-limit";
import { registerContactReference } from "@/core/contacts/service";
import { listLocations } from "@/core/locations/service";
import { resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { recordRedirect } from "@/core/seo/service";
import { siteOrigin } from "@/core/seo/origin";
import { QUANTITY_SCALE } from "@/modules/invoicing/money";
import { invoices, payments } from "@/modules/invoicing/schema";
import {
  createDraftInvoice,
  issueInvoice,
  voidInvoice,
} from "@/modules/invoicing/invoice-service";
import { sendInvoice } from "@/modules/invoicing/customer-service";
import {
  customerInvoicePath,
  invoiceAccessToken,
} from "@/modules/invoicing/customer-tokens";
import { registerCheckoutEligibility } from "@/modules/invoicing/checkout-requirements";
import {
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  eventRegistrations,
  eventSessions,
  eventTickets,
  events,
} from "./schema";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";
import { renderEventIcs } from "./ics";
import { EVENTS_INDEX_SLUG, syncEventPublicPage } from "./public-pages";
import { pages } from "@/modules/cms/schema";
import "./blocks";

const id = z.string().uuid();
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(180);
const name = z.string().trim().min(1).max(240);
const expectedVersion = z.number().int().positive();

const OCCUPYING = ["reserved", "confirmed", "checked_in"] as const;

/** C6.11: a held seat is released if its invoice is not settled within this. */
export const REGISTRATION_HOLD_MS = 30 * 60 * 1000;

/** Statuses that make a second registration for the same person a duplicate. */
const LIVE_REGISTRATION = ["reserved", "confirmed", "waitlisted", "checked_in"] as const;

const eventRow = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  venueName: z.string().nullable(),
  venueAddress: z.string().nullable(),
  venueLocationId: uuid.nullable(),
  status: z.enum(EVENT_STATUSES),
  seo: z.unknown(),
  workingName: z.string().nullable(),
  workingSummary: z.string().nullable(),
  workingVenueName: z.string().nullable(),
  workingVenueAddress: z.string().nullable(),
  workingSeo: z.unknown().nullable(),
  version: z.number().int(),
  publishedAt: timestamp.nullable(),
  cancelledAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const eventSessionRow = row({
  id: uuid,
  eventId: uuid,
  startsAt: timestamp,
  endsAt: timestamp,
  timezone: z.string(),
  capacity: z.number().int(),
  waitlistEnabled: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const eventSessionWithRemaining = eventSessionRow.extend({
  remaining: z.number().int(),
});

const eventTicketRow = row({
  id: uuid,
  eventId: uuid,
  name: z.string(),
  priceMinor: z.number().int(),
  currency: z.string(),
  active: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const eventRegistrationRow = row({
  id: uuid,
  eventId: uuid,
  sessionId: uuid,
  ticketId: uuid.nullable(),
  contactId: uuid,
  status: z.enum(REGISTRATION_STATUSES),
  quantity: z.number().int(),
  checkedInAt: timestamp.nullable(),
  invoiceId: uuid.nullable(),
  holdExpiresAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

registerContactReference({
  table: "event_registrations",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(eventRegistrations)
      .set({ contactId: survivingId })
      .where(eq(eventRegistrations.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: eventRegistrations.id, contactId: eventRegistrations.contactId })
      .from(eventRegistrations)
      .where(inArray(eventRegistrations.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(
      z.object({ id: z.string().uuid(), contactId: z.string().uuid() }),
    );
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: eventRegistrations.id, contactId: eventRegistrations.contactId })
          .from(eventRegistrations)
          .where(inArray(eventRegistrations.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "An event registration changed after this merge. Leave the merge in place or restore that registration first.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(eventRegistrations)
        .set({ contactId: duplicateId })
        .where(inArray(eventRegistrations.id, moved.map((row) => row.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "events.registrations",
  tables: ["event_registrations"],
  exportData: async (tx, contactId) =>
    tx
      .select({
        id: eventRegistrations.id,
        eventId: eventRegistrations.eventId,
        sessionId: eventRegistrations.sessionId,
        status: eventRegistrations.status,
        quantity: eventRegistrations.quantity,
      })
      .from(eventRegistrations)
      .where(eq(eventRegistrations.contactId, contactId)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(eventRegistrations)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(eventRegistrations.contactId, contactId),
          inArray(eventRegistrations.status, ["reserved", "confirmed", "waitlisted"]),
        ),
      )
      .returning({ id: eventRegistrations.id });
    return { affected: rows.length };
  },
});

function duplicateSlug(value: string): ServiceError {
  return new ServiceError("conflict", `Another event already uses /events/${value}.`);
}

async function occupied(ctx: ServiceContext, sessionId: string): Promise<number> {
  const [row] = await ctx.tx
    .select({
      taken: sql<number>`coalesce(sum(${eventRegistrations.quantity}), 0)`,
    })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.sessionId, sessionId),
        inArray(eventRegistrations.status, [...OCCUPYING]),
      ),
    );
  return Number(row?.taken ?? 0);
}

async function loadEvent(ctx: ServiceContext, eventId: string) {
  const [event] = await ctx.tx.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new ServiceError("not_found", "That event is not here.");
  return event;
}

type AdmissionTicket = typeof eventTickets.$inferSelect;

/**
 * How admission is taxed. Admission is supplied where the event happens, so
 * tax runs from the business's primary location to the venue, through the
 * same calculate path as every other sale; the attendee's own address plays
 * no part, so none is asked for. An event with no venue of its own is held
 * at the business. A venue typed in as free text (not one of the business's
 * saved locations) cannot be placed in a tax jurisdiction, so it is taxed
 * as if held at the business, and the invoice says so. A business with no
 * location at all adds no tax, as catalog orders do, and the invoice says why.
 */
async function admissionTax(ctx: ServiceContext, eventId: string) {
  const locations = await ctx.callAsSystem(listLocations, {});
  const origin = locations.find((each) => each.isPrimary) ?? locations[0];
  if (!origin) {
    return { tax: { mode: "not_applicable" as const, reason: "This business has no location to tax event admission from, so no tax was added." } };
  }
  const [event] = await ctx.tx
    .select({ venueLocationId: events.venueLocationId, venueName: events.venueName, venueAddress: events.venueAddress })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const saved = event?.venueLocationId ? locations.find((each) => each.id === event.venueLocationId) : undefined;
  const elsewhere = !saved && Boolean(event?.venueLocationId || event?.venueName?.trim() || event?.venueAddress?.trim());
  const venue = saved ?? origin;
  const place = (at: typeof origin) => ({
    country: at.country,
    region: at.region ?? undefined,
    postalCode: at.postalCode ?? undefined,
    city: at.city ?? undefined,
  });
  return {
    tax: { mode: "calculate" as const, origin: place(origin), destination: place(venue) },
    memo: elsewhere ? "Tax on this admission was worked out at the business's location: the venue is not one of its saved locations." : undefined,
  };
}

/**
 * Create and issue the invoice that holds a paid seat, in the caller's
 * transaction. One registration ever has one invoice: `invoices_source_idx`
 * makes (sourceType, sourceId) unique, and the idempotency key is the
 * registration, so a retried sweep or a double promotion raises nothing twice.
 */
async function issueAdmissionInvoice(
  ctx: ServiceContext,
  args: {
    registrationId: string;
    contactId: string;
    eventName: string;
    ticket: AdmissionTicket;
    quantity: number;
    holdExpiresAt: Date;
  },
) {
  const { tax, memo } = await admissionTax(ctx, args.ticket.eventId);
  const draft = await ctx.callAsSystem(createDraftInvoice, {
    contactId: args.contactId,
    currency: args.ticket.currency,
    sourceType: "event",
    sourceId: args.registrationId,
    idempotencyKey: `event-registration:${args.registrationId}`,
    lines: [
      {
        sourceType: "event_ticket",
        sourceId: args.ticket.id,
        description: `${args.eventName} — ${args.ticket.name}`,
        quantityMicros: args.quantity * QUANTITY_SCALE,
        unitAmountMinor: args.ticket.priceMinor,
      },
    ],
    tax,
    ...(memo ? { memo } : {}),
    dueAt: args.holdExpiresAt,
  });
  return ctx.callAsSystem(issueInvoice, { id: draft.invoice.id });
}

/**
 * Promote the oldest waitlisted row that fits the freed seats. The caller
 * holds the session row lock. A promoted paid row becomes a fresh 30-minute
 * held reservation with its own issued invoice, and the emailed invoice — pay
 * link included — is the waitlist notification. Legacy rows that cannot prove
 * admission (no ticket on a ticketed event, or a retired ticket) stay waiting.
 */
async function promoteNext(
  ctx: ServiceContext,
  eventId: string,
  session: typeof eventSessions.$inferSelect,
): Promise<void> {
  const remaining = session.capacity - (await occupied(ctx, session.id));
  const [next] = await ctx.tx
    .select()
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.sessionId, session.id),
        eq(eventRegistrations.status, "waitlisted"),
      ),
    )
    .orderBy(asc(eventRegistrations.createdAt))
    .limit(1);
  if (!next || next.quantity > remaining) return;
  const tickets = await ctx.tx.select().from(eventTickets)
    .where(eq(eventTickets.eventId, eventId));
  const ticket = tickets.find((candidate) => candidate.id === next.ticketId);
  if ((next.ticketId && (!ticket || !ticket.active)) || (!next.ticketId && tickets.length > 0)) {
    return;
  }
  if (ticket && ticket.priceMinor > 0) {
    const holdExpiresAt = new Date(Date.now() + REGISTRATION_HOLD_MS);
    const [event] = await ctx.tx
      .select({ name: events.name })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    const issued = await issueAdmissionInvoice(ctx, {
      registrationId: next.id,
      contactId: next.contactId,
      eventName: event?.name ?? "Event",
      ticket,
      quantity: next.quantity,
      holdExpiresAt,
    });
    await ctx.tx
      .update(eventRegistrations)
      .set({ status: "reserved", holdExpiresAt, invoiceId: issued.invoice.id })
      .where(eq(eventRegistrations.id, next.id));
    await ctx.callAsSystem(sendInvoice, {
      id: issued.invoice.id,
      idempotencyKey: `event-waitlist-promotion:${next.id}`,
    });
    ctx.queueEvent("events.promoted", {
      eventId,
      registrationId: next.id,
      contactId: next.contactId,
      invoiceId: issued.invoice.id,
    });
    return;
  }
  await ctx.tx
    .update(eventRegistrations)
    .set({ status: "confirmed" })
    .where(eq(eventRegistrations.id, next.id));
  ctx.queueEvent("events.registered", {
    eventId,
    registrationId: next.id,
    contactId: next.contactId,
    promoted: true,
  });
}

/**
 * Void the unpaid invoice behind a cancelled hold, so its link can never be
 * paid. A settled invoice is left paid — refunding is a deliberate invoicing
 * act, never a side effect of cancelling a seat.
 */
async function voidUnpaidAdmissionInvoice(ctx: ServiceContext, invoiceId: string): Promise<void> {
  const [invoice] = await ctx.tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice || invoice.paidMinor > 0) return;
  if (!["sent", "viewed", "overdue"].includes(invoice.status)) return;
  try {
    await ctx.callAsSystem(voidInvoice, {
      id: invoice.id,
      reason: "The event registration this invoice holds was cancelled.",
    });
  } catch (error) {
    // A payment attempt in flight blocks voiding; the checkout eligibility
    // hook refuses the payment either way, because the registration is no
    // longer reserved.
    if (!(error instanceof ServiceError && error.code === "conflict")) throw error;
  }
}

export const listEvents = defineService({
  name: "events.list",
  summary: "List events for the owner workspace.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(EVENT_STATUSES).optional(),
  }),
  output: listed(eventRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(events)
      .where(input.status ? eq(events.status, input.status) : undefined)
      .orderBy(desc(events.updatedAt));
    return rows;
  },
});

export const getEvent = defineService({
  name: "events.get",
  summary: "One event with sessions, tickets and registrations.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: z.object({
    event: eventRow,
    sessions: listed(eventSessionWithRemaining),
    tickets: listed(eventTicketRow),
    registrations: listed(eventRegistrationRow),
  }),
  handler: async (input, ctx) => {
    const event = await loadEvent(ctx, input.id);
    const [sessions, tickets, registrations] = await Promise.all([
      ctx.tx.select().from(eventSessions).where(eq(eventSessions.eventId, event.id)).orderBy(asc(eventSessions.startsAt)),
      ctx.tx.select().from(eventTickets).where(eq(eventTickets.eventId, event.id)).orderBy(asc(eventTickets.createdAt)),
      ctx.tx
        .select()
        .from(eventRegistrations)
        .where(eq(eventRegistrations.eventId, event.id))
        .orderBy(desc(eventRegistrations.createdAt)),
    ]);
    const remaining = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        remaining: Math.max(0, session.capacity - (await occupied(ctx, session.id))),
      })),
    );
    return { event, sessions: remaining, tickets, registrations };
  },
});

export const listPublicEvents = defineService({
  name: "events.listPublic",
  summary: "Published events for the public index.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: listed(
    eventRow.extend({
      /** The first session still to finish, or null when none is ahead. */
      nextStartsAt: timestamp.nullable(),
      nextEndsAt: timestamp.nullable(),
      nextTimezone: z.string().nullable(),
      /** When the last session ended; set only once every session is over. */
      endedAt: timestamp.nullable(),
    }),
  ),
  handler: async (_input, ctx) => {
    // Only events whose public page is live: the index must never link to a
    // page that answers 404. An event published without one (inserted
    // directly, or its page trashed) is not on the public site, so it is not
    // on the public list either — the same rule the sitemap follows, since
    // the sitemap is built from published pages.
    const rows = await ctx.tx
      .select()
      .from(events)
      .where(
        and(
          eq(events.status, "published"),
          sql`exists (
            select 1 from ${pages}
            where ${pages.slug} = ${`${EVENTS_INDEX_SLUG}/`}::text || ${events.slug}
              and ${pages.status} = 'published'
              and ${pages.trashedAt} is null
          )`,
        ),
      )
      .orderBy(desc(events.publishedAt), asc(events.name));
    if (rows.length === 0) return [];
    const sessions = await ctx.tx
      .select()
      .from(eventSessions)
      .where(inArray(eventSessions.eventId, rows.map((event) => event.id)))
      .orderBy(asc(eventSessions.startsAt));
    const now = Date.now();
    const listedRows = rows.map((event) => {
      const own = sessions.filter((session) => session.eventId === event.id);
      const next = own.find((session) => session.endsAt.getTime() > now) ?? null;
      const last = own.at(-1);
      return {
        ...event,
        nextStartsAt: next?.startsAt ?? null,
        nextEndsAt: next?.endsAt ?? null,
        nextTimezone: next?.timezone ?? null,
        endedAt: !next && last ? own.reduce((latest, session) =>
          session.endsAt > latest ? session.endsAt : latest, last.endsAt) : null,
      };
    });
    // Upcoming soonest first, then undated, then past most recent first.
    return listedRows.sort((a, b) => {
      const rank = (row: (typeof listedRows)[number]) => (row.nextStartsAt ? 0 : row.endedAt ? 2 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.nextStartsAt && b.nextStartsAt) return a.nextStartsAt.getTime() - b.nextStartsAt.getTime();
      if (a.endedAt && b.endedAt) return b.endedAt.getTime() - a.endedAt.getTime();
      return 0;
    });
  },
});

export const resolvePublicEvent = defineService({
  name: "events.resolvePublic",
  summary: "A published event with live session remaining seats.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: eventRow.extend({
    sessions: listed(eventSessionWithRemaining),
    tickets: listed(eventTicketRow),
  }).nullable(),
  handler: async (input, ctx) => {
    const [event] = await ctx.tx.select().from(events).where(eq(events.slug, input.slug)).limit(1);
    if (!event || event.status === "draft") return null;
    const [sessions, tickets] = await Promise.all([
      ctx.tx
        .select()
        .from(eventSessions)
        .where(eq(eventSessions.eventId, event.id))
        .orderBy(asc(eventSessions.startsAt)),
      ctx.tx
        .select()
        .from(eventTickets)
        .where(eq(eventTickets.eventId, event.id))
        .orderBy(asc(eventTickets.createdAt)),
    ]);
    const remaining = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        remaining: Math.max(0, session.capacity - (await occupied(ctx, session.id))),
      })),
    );
    return { ...event, sessions: remaining, tickets };
  },
});

export const createEvent = defineService({
  name: "events.create",
  summary: "Create a draft event.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name,
    slug,
    summary: z.string().trim().max(500).optional(),
    venueName: z.string().trim().max(200).optional(),
    venueAddress: z.string().trim().max(500).optional(),
    venueLocationId: id.nullable().optional(),
  }),
  output: eventRow,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx
      .insert(events)
      .values({
        name: input.name,
        slug: input.slug,
        summary: input.summary ?? null,
        venueName: input.venueName ?? null,
        venueAddress: input.venueAddress ?? null,
        venueLocationId: input.venueLocationId ?? null,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "events_slug_idx")) throw duplicateSlug(input.slug);
        throw error;
      });
    ctx.setSubject("event", created!.id);
    ctx.queueEvent("events.created", { eventId: created!.id });
    return created!;
  },
});

export const updateEvent = defineService({
  name: "events.update",
  summary: "Update event identity and venue.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id,
    expectedVersion,
    name: name.optional(),
    slug: slug.optional(),
    summary: z.string().trim().max(500).nullable().optional(),
    venueName: z.string().trim().max(200).nullable().optional(),
    venueAddress: z.string().trim().max(500).nullable().optional(),
    seo: z.object({ title: z.string().max(60).optional(), description: z.string().max(155).optional() }).optional(),
  }),
  output: eventRow,
  handler: async (input, ctx) => {
    const existing = await loadEvent(ctx, input.id);
    if (existing.version !== input.expectedVersion) {
      throw new ServiceError("conflict", "This event changed after you opened it.");
    }
    const { id: _id, expectedVersion: _version, ...patch } = input;
    const published = existing.status === "published";
    const contentEdit =
      input.name !== undefined ||
      input.summary !== undefined ||
      input.venueName !== undefined ||
      input.venueAddress !== undefined ||
      input.seo !== undefined;
    const [updated] = await ctx.tx
      .update(events)
      .set({
        ...patch,
        ...(published && contentEdit
          ? {
              name: existing.name,
              summary: existing.summary,
              venueName: existing.venueName,
              venueAddress: existing.venueAddress,
              seo: existing.seo,
              workingName: input.name ?? existing.workingName ?? existing.name,
              workingSummary:
                input.summary !== undefined
                  ? input.summary
                  : (existing.workingSummary ?? existing.summary),
              workingVenueName:
                input.venueName !== undefined
                  ? input.venueName
                  : (existing.workingVenueName ?? existing.venueName),
              workingVenueAddress:
                input.venueAddress !== undefined
                  ? input.venueAddress
                  : (existing.workingVenueAddress ?? existing.venueAddress),
              workingSeo: input.seo ?? existing.workingSeo ?? existing.seo,
            }
          : {}),
        version: existing.version + 1,
      })
      .where(and(eq(events.id, existing.id), eq(events.version, existing.version)))
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "events_slug_idx")) throw duplicateSlug(input.slug ?? existing.slug);
        throw error;
      });
    if (!updated) throw new ServiceError("conflict", "This event changed while it was being saved.");
    if (existing.slug !== updated.slug && existing.publishedAt) {
      await ctx.callAsSystem(recordRedirect, {
        fromPath: `events/${existing.slug}`,
        toPath: `events/${updated.slug}`,
        status: "301",
        source: `events:${updated.id}`,
      });
    }
    ctx.setSubject("event", updated.id);
    ctx.queueEvent("events.updated", { eventId: updated.id });
    if (input.slug !== undefined) {
      await syncEventPublicPage(ctx, updated.id);
    }
    return updated;
  },
});

export const publishEvent = defineService({
  name: "events.publish",
  summary: "Publish a reviewed event to /events/{slug}.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id, expectedVersion }),
  output: eventRow,
  handler: async (input, ctx) => {
    const existing = await loadEvent(ctx, input.id);
    if (existing.version !== input.expectedVersion) {
      throw new ServiceError("conflict", "This event changed after you opened it.");
    }
    if (existing.status === "cancelled") {
      throw new ServiceError("conflict", "A cancelled event cannot be published.");
    }
    const name = existing.workingName ?? existing.name;
    const summary = existing.workingSummary ?? existing.summary;
    const venueName = existing.workingVenueName ?? existing.venueName;
    const venueAddress = existing.workingVenueAddress ?? existing.venueAddress;
    const seo = existing.workingSeo ?? existing.seo;
    const [updated] = await ctx.tx
      .update(events)
      .set({
        status: "published",
        publishedAt: existing.publishedAt ?? sql`now()`,
        name,
        summary,
        venueName,
        venueAddress,
        seo,
        workingName: name,
        workingSummary: summary,
        workingVenueName: venueName,
        workingVenueAddress: venueAddress,
        workingSeo: seo,
        version: existing.version + 1,
      })
      .where(and(eq(events.id, existing.id), eq(events.version, existing.version)))
      .returning();
    if (!updated) throw new ServiceError("conflict", "This event changed during publish.");
    ctx.setSubject("event", updated.id);
    ctx.queueEvent("events.published", { eventId: updated.id });
    await syncEventPublicPage(ctx, updated.id);
    return updated;
  },
});

export const cancelEvent = defineService({
  name: "events.cancel",
  summary: "Cancel a published or draft event and take its page offline.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id, expectedVersion }),
  output: eventRow,
  handler: async (input, ctx) => {
    const existing = await loadEvent(ctx, input.id);
    if (existing.version !== input.expectedVersion) {
      throw new ServiceError("conflict", "This event changed after you opened it.");
    }
    const [updated] = await ctx.tx
      .update(events)
      .set({
        status: "cancelled",
        cancelledAt: sql`now()`,
        version: existing.version + 1,
      })
      .where(and(eq(events.id, existing.id), eq(events.version, existing.version)))
      .returning();
    if (!updated) throw new ServiceError("conflict", "This event changed during cancel.");
    ctx.setSubject("event", updated.id);
    ctx.queueEvent("events.cancelled", { eventId: updated.id });
    await syncEventPublicPage(ctx, updated.id);
    return updated;
  },
});

export const addEventSession = defineService({
  name: "events.addSession",
  summary: "Add a timed session with seat capacity.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    eventId: id,
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: z.string().trim().min(1).max(80).default("UTC"),
    capacity: z.number().int().min(0).max(100_000),
    waitlistEnabled: z.boolean().default(true),
  }),
  output: eventSessionRow,
  handler: async (input, ctx) => {
    if (input.endsAt <= input.startsAt) {
      throw new ServiceError("validation", "A session must end after it starts.");
    }
    await loadEvent(ctx, input.eventId);
    const [created] = await ctx.tx.insert(eventSessions).values(input).returning();
    ctx.setSubject("eventSession", created!.id);
    ctx.queueEvent("events.sessionAdded", { eventId: input.eventId, sessionId: created!.id });
    return created!;
  },
});

export const addEventTicket = defineService({
  name: "events.addTicket",
  summary: "Add a ticket or pass type to an event.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    eventId: id,
    name: z.string().trim().min(1).max(120),
    priceMinor: z.number().int().min(0),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("CAD"),
  }),
  output: eventTicketRow,
  handler: async (input, ctx) => {
    await loadEvent(ctx, input.eventId);
    const [created] = await ctx.tx.insert(eventTickets).values(input).returning();
    ctx.setSubject("eventTicket", created!.id);
    return created!;
  },
});

/**
 * C11.10: the most seats one public registration may take. A visitor can
 * still bring a party; a made-up address cannot empty a session in one call.
 * Staff registering on somebody's behalf keep the full range.
 */
const PUBLIC_SEATS_PER_REGISTRATION = 10;
/** Public registrations one email address may make per hour. */
const PUBLIC_REGISTRATION_LIMIT = { limit: 10, windowSeconds: 60 * 60 } as const;
/** Per client network address; looser, since honest people share addresses. */
const PUBLIC_CLIENT_LIMIT = { limit: 30, windowSeconds: 60 * 60 } as const;

/**
 * The earlier registration a repeated submit should return, or null when the
 * repeat is a genuinely different ask (another ticket, another seat count) or
 * the first one has left its hold window. A paid replay hands back the same
 * invoice's payment page — never a second invoice — and only while that
 * invoice is still issued, unpaid and its hold live.
 */
async function replayRegistration(
  ctx: ServiceContext,
  existing: typeof eventRegistrations.$inferSelect,
  input: { ticketId?: string; quantity: number },
): Promise<{ registration: typeof eventRegistrations.$inferSelect; paymentUrl: string | null } | null> {
  if ((existing.ticketId ?? undefined) !== input.ticketId) return null;
  if (existing.quantity !== input.quantity) return null;
  const now = Date.now();
  if (existing.createdAt.getTime() < now - REGISTRATION_HOLD_MS) return null;
  if (existing.status === "confirmed" || existing.status === "waitlisted") {
    // A free seat or a waitlist place: the same answer the first submit got.
    return existing.invoiceId ? null : { registration: existing, paymentUrl: null };
  }
  if (existing.status !== "reserved" || !existing.invoiceId) return null;
  if (!existing.holdExpiresAt || existing.holdExpiresAt.getTime() <= now) return null;
  const [invoice] = await ctx.tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, existing.invoiceId))
    .limit(1);
  if (!invoice || invoice.paidMinor > 0 || !["sent", "viewed"].includes(invoice.status)) return null;
  return {
    registration: existing,
    paymentUrl: `${siteOrigin()}${customerInvoicePath(invoice.id, invoiceAccessToken(invoice))}`,
  };
}

export const registerForEvent = defineService({
  name: "events.register",
  summary: "Register a contact for a session, holding paid seats behind an issued invoice and waitlisting when the session is full.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    eventId: id,
    sessionId: id,
    ticketId: id.optional(),
    email: z.string().trim().email().toLowerCase(),
    name: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().int().min(1).max(50).default(1),
  }),
  output: z.object({
    registration: eventRegistrationRow,
    // Where the attendee pays, when admission is paid: the portal invoice page
    // under its HMAC capability. Null for free seats and waitlist rows — a
    // waitlist claim is free and carries no invoice.
    paymentUrl: z.string().url().nullable(),
  }),
  handler: async (input, ctx) => {
    const staff = permits(ctx.actor, "scoped", "events.cancelRegistration", "mutation");
    if (!staff) {
      if (input.quantity > PUBLIC_SEATS_PER_REGISTRATION) {
        throw new ServiceError(
          "validation",
          `One registration can hold up to ${PUBLIC_SEATS_PER_REGISTRATION} seats. Contact the organiser for a larger group.`,
        );
      }
      // Counted in this transaction, so a refused registration costs nothing
      // and the limit holds when another flow composes this one.
      // The client address (validated, or forwarded when the deployment has
      // no trusted header) stops one caller cycling made-up emails.
      const keys: Array<[string, typeof PUBLIC_REGISTRATION_LIMIT | typeof PUBLIC_CLIENT_LIMIT]> = [
        [`email:${input.email}`, PUBLIC_REGISTRATION_LIMIT],
      ];
      if (ctx.actor.request?.trustedIp || ctx.actor.request?.ip) {
        keys.push([anonymousClientKey(ctx.actor), PUBLIC_CLIENT_LIMIT]);
      }
      for (const [key, policy] of keys) {
        const verdict = await consumeAccepted(
          ctx.tx,
          rateLimitKey("events.register", key),
          policy,
        );
        if (!verdict.allowed) {
          throw new ServiceError(
            "rate_limited",
            "That is a lot of registrations at once. Try again later.",
            verdict.retryAfterSeconds,
          );
        }
      }
    }
    const event = await loadEvent(ctx, input.eventId);
    if (event.status !== "published") {
      throw new ServiceError("conflict", "This event is not open for registration.");
    }
    const [session] = await ctx.tx
      .select()
      .from(eventSessions)
      .where(and(eq(eventSessions.id, input.sessionId), eq(eventSessions.eventId, event.id)))
      .for("update");
    if (!session) throw new ServiceError("not_found", "That session is not here.");
    // C6.11: a ticket is an admission rule, not an optional caller assertion.
    const tickets = await ctx.tx.select().from(eventTickets)
      .where(eq(eventTickets.eventId, event.id));
    const ticket = tickets.find((candidate) => candidate.id === input.ticketId);
    if (input.ticketId && (!ticket || !ticket.active)) {
      throw new ServiceError("validation", "Choose an active ticket for this event.");
    }
    if (!input.ticketId && tickets.length > 0) {
      throw new ServiceError("validation", "Choose a ticket for this event.");
    }
    const resolved = await ctx.callAsSystem(resolveContact, {
      email: input.email,
      name: input.name,
      source: "event-registration",
    });
    // One live registration per person per session: a second row would hold
    // two seats for one attendee, or waitlist them behind themselves.
    const [duplicate] = await ctx.tx
      .select()
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.sessionId, session.id),
          eq(eventRegistrations.contactId, resolved.contact.id),
          inArray(eventRegistrations.status, [...LIVE_REGISTRATION]),
        ),
      )
      .limit(1);
    if (duplicate) {
      // A double-clicked button or a retried request is the same
      // registration, not a second one and not a failure. The 2026-10-23
      // audit watched a paid submit succeed while its twin came back
      // "conflict", so the visitor was told it had failed with a seat and an
      // invoice already held — and retrying looked like the only way on.
      // Within the hold window the same ask gets back what it made.
      const replay = await replayRegistration(ctx, duplicate, input);
      if (replay) {
        ctx.setSubject("eventRegistration", duplicate.id);
        return replay;
      }
      throw new ServiceError("conflict", "This email is already registered for that session.");
    }
    const taken = await occupied(ctx, session.id);
    const remaining = session.capacity - taken;
    const waitlisted = remaining < input.quantity;
    if (waitlisted && !session.waitlistEnabled) {
      throw new ServiceError("conflict", "That session is full.");
    }
    const paid = ticket !== undefined && ticket.priceMinor > 0;
    const holdExpiresAt = paid && !waitlisted
      ? new Date(Date.now() + REGISTRATION_HOLD_MS)
      : null;
    const [created] = await ctx.tx
      .insert(eventRegistrations)
      .values({
        eventId: event.id,
        sessionId: session.id,
        ticketId: input.ticketId ?? null,
        contactId: resolved.contact.id,
        status: waitlisted ? "waitlisted" : paid ? "reserved" : "confirmed",
        quantity: input.quantity,
        holdExpiresAt,
      })
      .returning();
    ctx.setSubject("eventRegistration", created!.id);
    if (waitlisted) {
      ctx.queueEvent("events.waitlisted", {
        eventId: event.id,
        registrationId: created!.id,
        contactId: resolved.contact.id,
      });
      return { registration: created!, paymentUrl: null };
    }
    if (!paid || !ticket) {
      ctx.queueEvent("events.registered", {
        eventId: event.id,
        registrationId: created!.id,
        contactId: resolved.contact.id,
      });
      return { registration: created!, paymentUrl: null };
    }
    // Paid admission converges on the commerce spine (§4.3): the seat is
    // reserved and its invoice created and issued in this same transaction, so
    // there is never a held seat without a money object or a charge without a
    // seat. Settlement confirms the seat (invoicing.settlePayment); the hold
    // lapses under events.expireHeldRegistrations if it never settles.
    const issued = await issueAdmissionInvoice(ctx, {
      registrationId: created!.id,
      contactId: resolved.contact.id,
      eventName: event.name,
      ticket,
      quantity: input.quantity,
      holdExpiresAt: holdExpiresAt!,
    });
    const [held] = await ctx.tx
      .update(eventRegistrations)
      .set({ invoiceId: issued.invoice.id })
      .where(eq(eventRegistrations.id, created!.id))
      .returning();
    const paymentUrl = `${siteOrigin()}${customerInvoicePath(
      issued.invoice.id,
      invoiceAccessToken(issued.invoice),
    )}`;
    return { registration: held!, paymentUrl };
  },
});

export const cancelRegistration = defineService({
  name: "events.cancelRegistration",
  summary: "Cancel a registration and promote the oldest waitlisted seat that now fits.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: eventRegistrationRow,
  handler: async (input, ctx) => {
    const [reference] = await ctx.tx.select({ sessionId: eventRegistrations.sessionId })
      .from(eventRegistrations).where(eq(eventRegistrations.id, input.id));
    if (!reference) throw new ServiceError("not_found", "That registration is not here.");
    // Serialize capacity changes with enrollment; always lock session first.
    await ctx.tx.select({ id: eventSessions.id }).from(eventSessions)
      .where(eq(eventSessions.id, reference.sessionId)).for("update");
    const [existing] = await ctx.tx
      .select()
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, input.id))
      .for("update");
    if (!existing) throw new ServiceError("not_found", "That registration is not here.");
    if (existing.status === "cancelled") return existing;
    if (existing.invoiceId && existing.status === "reserved") {
      // The mirror of catalog.cancelOrder's race guard: a held seat whose
      // invoice has an in-flight payment attempt cannot be released —
      // settlement may still legitimately arrive, and it must never land on a
      // seat somebody else now holds. The attempt's own lifecycle (fail,
      // cancel, reconcile) is what unblocks a later cancellation.
      const [activeAttempt] = await ctx.tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.invoiceId, existing.invoiceId),
            inArray(payments.status, ["created", "processing"]),
          ),
        )
        .limit(1);
      if (activeAttempt) {
        throw new ServiceError("conflict", "A payment attempt is still active for this registration. Reconcile or cancel it before releasing the seat.");
      }
    }
    const [updated] = await ctx.tx
      .update(eventRegistrations)
      .set({ status: "cancelled" })
      .where(eq(eventRegistrations.id, existing.id))
      .returning();
    // The cancelled row's invoice id stays on the outcome (the returned row):
    // a settled paid registration reports it and leaves the refund as a
    // deliberate invoicing act; an unpaid hold's invoice is voided here so its
    // payment link dies with the seat.
    if (existing.invoiceId) {
      await voidUnpaidAdmissionInvoice(ctx, existing.invoiceId);
    }
    const [session] = await ctx.tx
      .select()
      .from(eventSessions)
      .where(eq(eventSessions.id, existing.sessionId))
      .limit(1);
    if (session?.waitlistEnabled && OCCUPYING.includes(existing.status as (typeof OCCUPYING)[number])) {
      await promoteNext(ctx, existing.eventId, session);
    }
    ctx.setSubject("eventRegistration", existing.id);
    return updated!;
  },
});

export const checkInRegistration = defineService({
  name: "events.checkIn",
  summary: "Mark a confirmed registration as checked in.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: eventRegistrationRow,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That registration is not here.");
    if (existing.status !== "confirmed" && existing.status !== "checked_in") {
      throw new ServiceError("conflict", "Only a confirmed registration can be checked in.");
    }
    const tickets = await ctx.tx.select().from(eventTickets)
      .where(eq(eventTickets.eventId, existing.eventId));
    const ticket = tickets.find((candidate) => candidate.id === existing.ticketId);
    if ((existing.ticketId && (!ticket || !ticket.active)) ||
        (!existing.ticketId && tickets.length > 0)) {
      throw new ServiceError("conflict", "This registration has no verifiable free admission. Reconcile its ticket and payment before check-in.");
    }
    if (ticket && ticket.priceMinor > 0) {
      // Paid admission checks in on a settled invoice, never on the row alone:
      // a legacy confirmation with no invoice stays refused, exactly as before
      // settlement existed. The settled invoice id rides the outcome row as
      // the evidence link.
      const [invoice] = existing.invoiceId
        ? await ctx.tx.select().from(invoices).where(eq(invoices.id, existing.invoiceId)).limit(1)
        : [];
      if (!invoice || invoice.status !== "paid") {
        throw new ServiceError("conflict", "This paid registration has no settled payment. Reconcile its invoice before check-in.");
      }
    }
    const [updated] = await ctx.tx
      .update(eventRegistrations)
      .set({ status: "checked_in", checkedInAt: existing.checkedInAt ?? sql`now()` })
      .where(eq(eventRegistrations.id, existing.id))
      .returning();
    ctx.setSubject("eventRegistration", existing.id);
    ctx.queueEvent("events.checkedIn", { registrationId: existing.id, eventId: existing.eventId });
    return updated!;
  },
});

export const confirmPaidRegistration = defineService({
  name: "events.confirmPaidRegistration",
  summary: "Confirm a held registration once its invoice is fully settled.",
  kind: "mutation",
  permission: "system",
  input: z.object({ registrationId: id, invoiceId: id }),
  output: eventRegistrationRow,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, input.registrationId))
      .for("update");
    if (!existing) throw new ServiceError("not_found", "That registration is not here.");
    if (existing.invoiceId !== input.invoiceId) {
      throw new ServiceError("conflict", "That invoice does not hold this registration.");
    }
    // Idempotent: a duplicated settlement signal confirms nothing twice.
    if (existing.status === "confirmed" || existing.status === "checked_in") return existing;
    if (existing.status !== "reserved") {
      throw new ServiceError("conflict", "Only a held registration can be confirmed by payment.");
    }
    const [updated] = await ctx.tx
      .update(eventRegistrations)
      .set({ status: "confirmed" })
      .where(eq(eventRegistrations.id, existing.id))
      .returning();
    ctx.setSubject("eventRegistration", existing.id);
    ctx.queueEvent("events.registered", {
      eventId: existing.eventId,
      registrationId: existing.id,
      contactId: existing.contactId,
      invoiceId: input.invoiceId,
    });
    return updated!;
  },
});

const lapsedHolds = defineService({
  name: "events.lapsedHolds",
  summary: "Held registrations whose payment deadline passed, oldest first.",
  kind: "query",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(500) }),
  output: listed(row({ id: uuid })),
  handler: async (input, ctx) =>
    ctx.tx
      .select({ id: eventRegistrations.id })
      .from(eventRegistrations)
      .where(
        and(
          eq(eventRegistrations.status, "reserved"),
          isNotNull(eventRegistrations.holdExpiresAt),
          lt(eventRegistrations.holdExpiresAt, sql`now()`),
          // Money arrived (fully or in part): the owner reconciles it, so the
          // sweep never takes it and it can never fill a batch.
          sql`not exists (select 1 from ${invoices} i where i.id = ${eventRegistrations.invoiceId} and (i.paid_minor > 0 or i.status in ('paid', 'refunded')))`,
        ),
      )
      // A hold with a payment attempt in flight cannot be released until the
      // attempt resolves: it goes after every hold that can, so a pile of
      // them never starves holds that lapsed later.
      .orderBy(
        sql`exists (select 1 from ${payments} p where p.invoice_id = ${eventRegistrations.invoiceId} and p.status in ('created', 'processing'))`,
        asc(eventRegistrations.holdExpiresAt),
      )
      .limit(input.limit),
});

/** One lapsed hold, in its own transaction: released, or left for a reason. */
const expireHeldRegistration = defineService({
  name: "events.expireHeldRegistration",
  summary: "Cancel one held registration whose payment deadline passed without settlement.",
  kind: "mutation",
  permission: "system",
  input: z.object({ id: uuid }),
  output: row({ expired: z.boolean() }),
  handler: async (input, ctx) => {
    const [registration] = await ctx.tx
      .select({ status: eventRegistrations.status, invoiceId: eventRegistrations.invoiceId, holdExpiresAt: eventRegistrations.holdExpiresAt })
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, input.id))
      .limit(1);
    // Settled or cancelled since it was listed.
    if (registration?.status !== "reserved" || !registration.holdExpiresAt || registration.holdExpiresAt.getTime() >= Date.now()) {
      return { expired: false };
    }
    const [invoice] = registration.invoiceId
      ? await ctx.tx
          .select({ status: invoices.status, paidMinor: invoices.paidMinor })
          .from(invoices)
          .where(eq(invoices.id, registration.invoiceId))
          .limit(1)
      : [];
    // Money arrived (fully or in part): the seat is no longer the sweeper's
    // to release — the owner reconciles a partial payment by hand.
    if (invoice && (invoice.paidMinor > 0 || invoice.status === "paid" || invoice.status === "refunded")) {
      return { expired: false };
    }
    // Cancelling releases the seat, voids the unpaid invoice and runs the
    // waitlist promotion cascade, all inside the cancellation's own locks.
    await ctx.callAsSystem(cancelRegistration, { id: input.id });
    return { expired: true };
  },
});

/**
 * The five-minute sweep. Each hold is released in its own transaction, so
 * one that cannot be (a payment attempt in flight, or a promotion that
 * fails — say the next person's email was erased) stays as it is without
 * holding back every other lapsed seat. Failures are counted and logged.
 */
export const expireHeldRegistrations = defineOrchestratedService({
  name: "events.expireHeldRegistrations",
  summary: "Cancel held registrations whose payment deadline passed without settlement.",
  kind: "mutation",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: row({ expired: z.number().int(), blocked: z.number().int(), failed: z.number().int() }),
  handler: async (input, actor) => {
    const candidates = await lapsedHolds.call({ limit: input.limit }, actor);
    let expired = 0;
    let blocked = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        if ((await expireHeldRegistration.call({ id: candidate.id }, actor)).expired) expired += 1;
      } catch (error) {
        // A payment attempt that began before the hold lapsed blocks the
        // release; the attempt's own lifecycle unblocks a later sweep.
        if (error instanceof ServiceError && error.code === "conflict") {
          blocked += 1;
          continue;
        }
        failed += 1;
        console.error(`[events] could not release lapsed hold ${candidate.id}`, error);
      }
    }
    return { expired, blocked, failed };
  },
});

export const cancelRegistrationForInvoice = defineService({
  name: "events.cancelRegistrationForInvoice",
  summary: "Cancel the registration an event invoice holds, when that invoice is voided or refunded.",
  kind: "mutation",
  permission: "system",
  input: z.object({ invoiceId: id }),
  output: row({ cancelled: z.boolean() }),
  handler: async (input, ctx) => {
    const [invoice] = await ctx.tx
      .select({ sourceType: invoices.sourceType, sourceId: invoices.sourceId })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!invoice || invoice.sourceType !== "event" || !invoice.sourceId) {
      return { cancelled: false };
    }
    const [registration] = await ctx.tx
      .select({ id: eventRegistrations.id, status: eventRegistrations.status })
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, invoice.sourceId))
      .limit(1);
    if (!registration || registration.status === "cancelled") return { cancelled: false };
    await ctx.callAsSystem(cancelRegistration, { id: registration.id });
    return { cancelled: true };
  },
});

/** Refund or void of an event invoice cancels the seat and promotes the waitlist. */
async function onInvoiceClosed(payload: unknown): Promise<void> {
  const invoiceId = (payload as { invoiceId?: string } | null)?.invoiceId;
  if (!invoiceId) return;
  await cancelRegistrationForInvoice.call({ invoiceId }, { kind: "system" });
}

export async function onInvoiceRefunded(payload: unknown): Promise<void> {
  await onInvoiceClosed(payload);
}

export async function onInvoiceVoided(payload: unknown): Promise<void> {
  await onInvoiceClosed(payload);
}

// C6.11: a lapsed hold must never become payable. Paying an event invoice is
// refused at checkout unless the registration is still reserved, its hold is
// still live, and the session is still ahead on a published event.
registerCheckoutEligibility("event", async (ctx, sourceId) => {
  const [registration] = await ctx.tx
    .select({
      status: eventRegistrations.status,
      holdExpiresAt: eventRegistrations.holdExpiresAt,
      sessionId: eventRegistrations.sessionId,
      eventId: eventRegistrations.eventId,
    })
    .from(eventRegistrations)
    .where(eq(eventRegistrations.id, sourceId))
    .limit(1);
  if (!registration || registration.status !== "reserved") return false;
  if (!registration.holdExpiresAt || registration.holdExpiresAt.getTime() <= Date.now()) {
    return false;
  }
  const [session] = await ctx.tx
    .select({ startsAt: eventSessions.startsAt })
    .from(eventSessions)
    .where(eq(eventSessions.id, registration.sessionId))
    .limit(1);
  if (!session || session.startsAt.getTime() <= Date.now()) return false;
  const [event] = await ctx.tx
    .select({ status: events.status })
    .from(events)
    .where(eq(events.id, registration.eventId))
    .limit(1);
  return event?.status === "published";
});

export const eventCalendar = defineService({
  name: "events.calendar",
  summary: "RFC 5545 ICS for a published event.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: z.string().nullable(),
  handler: async (input, ctx) => {
    const event = await ctx.call(resolvePublicEvent, { slug: input.slug });
    if (!event || event.status === "cancelled") return null;
    const origin = siteOrigin();
    return renderEventIcs({
      uid: event.id,
      name: event.name,
      description: event.summary,
      url: `${origin}/events/${event.slug}`,
      venue: [event.venueName, event.venueAddress].filter(Boolean).join(", ") || null,
      sessions: event.sessions,
    });
  },
});

/**
 * The demo contribution for events (C6.11, C1.28).
 *
 * A class rather than a conference, because the thing an owner needs to see
 * working is the one that is hard to believe from a screenshot: a session
 * with a real capacity, one seat already gone, and a public page that says so.
 * The class is paid on purpose — its public page carries the registration
 * form, and buying a seat walks the real invoice path, so the demo proves
 * purchasable admission rather than asserting it.
 */
const DEMO_CONTRIBUTION = { key: "events.demo-class", version: 1 };
const DEMO_OUTCOME = "events.demo-class.visible";
const DEMO_SLUG = "freeholder-demo-sourdough-class";

const DEMO_CLASS = {
  en: {
    name: "[Demo] Intro to sourdough",
    summary: "Four hours, one loaf each, everything provided.",
    venueName: "The back kitchen",
    ticket: "General admission",
  },
  es: {
    name: "[Demo] Introducción a la masa madre",
    summary: "Cuatro horas, un pan por persona, todo incluido.",
    venueName: "La cocina trasera",
    ticket: "Entrada general",
  },
  fr: {
    name: "[Demo] Initiation au levain",
    summary: "Quatre heures, un pain chacun, tout est fourni.",
    venueName: "La cuisine du fond",
    ticket: "Entrée générale",
  },
} as const;

export const loadDemoEvent = defineService({
  name: "events.loadDemoFixture",
  summary: "Load the events contribution for a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, DEMO_CONTRIBUTION, "load");
    const copy = DEMO_CLASS[input.locale as keyof typeof DEMO_CLASS];
    if (!copy) throw new ServiceError("validation", "Unsupported demo locale.");

    const made = await ctx.callAsSystem(createEvent, {
      name: copy.name,
      slug: DEMO_SLUG,
      summary: copy.summary,
      venueName: copy.venueName,
    });
    // Far enough ahead that the demo does not age into a past event the
    // first week nobody looks at it.
    const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
    await ctx.callAsSystem(addEventSession, {
      eventId: made.id,
      startsAt,
      endsAt,
      capacity: 8,
      waitlistEnabled: true,
    });
    await ctx.callAsSystem(addEventTicket, {
      eventId: made.id,
      name: copy.ticket,
      priceMinor: 6500,
    });
    // Published, because an unpublished demo proves the admin screen exists
    // and nothing about what a visitor would see.
    await ctx.callAsSystem(publishEvent, { id: made.id, expectedVersion: made.version });

    return demoLoadResultSchema.parse({
      records: [
        {
          fixtureKey: "demo-class",
          subjectType: "event",
          subjectId: made.id,
          label: made.name,
        },
      ],
    });
  },
});

export const purgeDemoEvent = defineService({
  name: "events.purgeDemoFixture",
  summary: "Purge only events proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, DEMO_CONTRIBUTION, "purge");
    const purged: Array<{ subjectType: string; subjectId: string }> = [];
    for (const record of input.records) {
      if (record.fixtureKey !== "demo-class" || record.subjectType !== "event") {
        throw new ServiceError("validation", "Unexpected events demo provenance.");
      }
      // Registrations point at a contact with onDelete: restrict, so they go
      // first. They are answers given to a demo, and the run that created
      // them is the run removing them; sessions and tickets cascade.
      await ctx.tx
        .delete(eventRegistrations)
        .where(eq(eventRegistrations.eventId, record.subjectId));
      await ctx.tx.delete(events).where(eq(events.id, record.subjectId));
      purged.push({ subjectType: record.subjectType, subjectId: record.subjectId });
    }
    return demoPurgeResultSchema.parse({ purged });
  },
});

export const verifyDemoEvent = defineService({
  name: "events.verifyDemoFixture",
  summary: "Verify the visible events outcome for a tracked demo run.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, DEMO_CONTRIBUTION, "verify");
    const ids = input.records
      .filter((record) => record.subjectType === "event")
      .map((record) => record.subjectId);
    const [found] = ids.length
      ? await ctx.tx
          .select({ slug: events.slug, name: events.name, status: events.status })
          .from(events)
          .where(eq(events.id, ids[0]!))
          .limit(1)
      : [];
    const sessions = found
      ? await ctx.tx
          .select({ id: eventSessions.id })
          .from(eventSessions)
          .where(eq(eventSessions.eventId, ids[0]!))
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: DEMO_OUTCOME,
          // Published *and* has a session: a class with no date is not a
          // class anybody could attend, so it would prove nothing.
          achieved:
            found?.slug === DEMO_SLUG &&
            found.name.startsWith("[Demo]") &&
            found.status === "published" &&
            sessions.length > 0,
          detail: found?.name,
        },
      ],
    });
  },
});
export default [
  listEvents,
  getEvent,
  listPublicEvents,
  resolvePublicEvent,
  createEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
  addEventSession,
  addEventTicket,
  registerForEvent,
  cancelRegistration,
  checkInRegistration,
  confirmPaidRegistration,
  lapsedHolds,
  expireHeldRegistration,
  expireHeldRegistrations,
  cancelRegistrationForInvoice,
  eventCalendar,
  loadDemoEvent,
  purgeDemoEvent,
  verifyDemoEvent,
];
