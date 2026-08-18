// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events, sessions, tickets, waitlists, check-in (MASTER.md C6.11).

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isUniqueViolation } from "@/core/db";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { recordRedirect } from "@/core/seo/service";
import { siteOrigin } from "@/core/seo/origin";
import {
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  eventRegistrations,
  eventSessions,
  eventTickets,
  events,
} from "./schema";
import { renderEventIcs } from "./ics";
import { syncEventPublicPage } from "./public-pages";
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
  output: listed(eventRow),
  handler: async (_input, ctx) =>
    ctx.tx
      .select()
      .from(events)
      .where(eq(events.status, "published"))
      .orderBy(desc(events.publishedAt), asc(events.name)),
});

export const resolvePublicEvent = defineService({
  name: "events.resolvePublic",
  summary: "A published event with live session remaining seats.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: eventRow.extend({ sessions: listed(eventSessionWithRemaining) }).nullable(),
  handler: async (input, ctx) => {
    const [event] = await ctx.tx.select().from(events).where(eq(events.slug, input.slug)).limit(1);
    if (!event || event.status === "draft") return null;
    const sessions = await ctx.tx
      .select()
      .from(eventSessions)
      .where(eq(eventSessions.eventId, event.id))
      .orderBy(asc(eventSessions.startsAt));
    const remaining = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        remaining: Math.max(0, session.capacity - (await occupied(ctx, session.id))),
      })),
    );
    return { ...event, sessions: remaining };
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

export const registerForEvent = defineService({
  name: "events.register",
  summary: "Register a contact for a session, waitlisting when the session is full.",
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
  output: eventRegistrationRow,
  handler: async (input, ctx) => {
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
    const taken = await occupied(ctx, session.id);
    const remaining = session.capacity - taken;
    const resolved = await ctx.callAsSystem(resolveContact, {
      email: input.email,
      name: input.name,
      source: "event-registration",
    });
    const waitlisted = remaining < input.quantity;
    if (waitlisted && !session.waitlistEnabled) {
      throw new ServiceError("conflict", "That session is full.");
    }
    const [created] = await ctx.tx
      .insert(eventRegistrations)
      .values({
        eventId: event.id,
        sessionId: session.id,
        ticketId: input.ticketId ?? null,
        contactId: resolved.contact.id,
        status: waitlisted ? "waitlisted" : "confirmed",
        quantity: input.quantity,
      })
      .returning();
    ctx.setSubject("eventRegistration", created!.id);
    ctx.queueEvent(waitlisted ? "events.waitlisted" : "events.registered", {
      eventId: event.id,
      registrationId: created!.id,
      contactId: resolved.contact.id,
    });
    return created!;
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
    const [existing] = await ctx.tx
      .select()
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, input.id))
      .for("update");
    if (!existing) throw new ServiceError("not_found", "That registration is not here.");
    if (existing.status === "cancelled") return existing;
    const [updated] = await ctx.tx
      .update(eventRegistrations)
      .set({ status: "cancelled" })
      .where(eq(eventRegistrations.id, existing.id))
      .returning();
    const [session] = await ctx.tx
      .select()
      .from(eventSessions)
      .where(eq(eventSessions.id, existing.sessionId))
      .limit(1);
    if (session?.waitlistEnabled) {
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
      if (next && next.quantity <= remaining) {
        await ctx.tx
          .update(eventRegistrations)
          .set({ status: "confirmed" })
          .where(eq(eventRegistrations.id, next.id));
        ctx.queueEvent("events.registered", {
          eventId: existing.eventId,
          registrationId: next.id,
          contactId: next.contactId,
          promoted: true,
        });
      }
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
  eventCalendar,
];
