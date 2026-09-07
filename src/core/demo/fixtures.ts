// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core-owned complete-scenario fixtures (MASTER.md §38, C1.27).
import { eq, inArray } from "drizzle-orm";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { defineService, getService, ServiceError } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { businessLocations } from "@/core/locations/schema";
import { conversations, messages } from "@/core/messaging/schema";
import { bookings, calendars } from "@/core/scheduling/schema";
import { requireDemoHandlerRun } from "./handler";

const COPY = {
  en: {
    customer: "[Demo] Jordan Hale",
    overdue: "[Demo] Past-due client",
    location: "[Demo] Harbour studio",
    calendar: "[Demo] Sitting room",
    thread: "[Demo] Dates for the sitting",
    inbound: "Can we move Thursday's sitting an hour later?",
  },
  fr: {
    customer: "[Demo] Jordan Hale",
    overdue: "[Demo] Client en retard",
    location: "[Demo] Studio du port",
    calendar: "[Demo] Salle de pose",
    thread: "[Demo] Horaires de la séance",
    inbound: "Peut-on décaler la séance de jeudi d’une heure ?",
  },
  es: {
    customer: "[Demo] Jordan Hale",
    overdue: "[Demo] Cliente atrasado",
    location: "[Demo] Estudio del puerto",
    calendar: "[Demo] Sala de retrato",
    thread: "[Demo] Horario de la sesión",
    inbound: "¿Podemos mover la sesión del jueves una hora?",
  },
} as const;

function copy(locale: string) {
  return COPY[locale as keyof typeof COPY] ?? COPY.en;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const CONTACTS = { key: "core.demo-contacts", version: 1 } as const;
const LOCATIONS = { key: "core.demo-locations", version: 1 } as const;
const BOOKINGS = { key: "core.demo-bookings", version: 1 } as const;
const INBOX = { key: "core.demo-inbox", version: 1 } as const;

export const loadDemoContacts = defineService({
  name: "core.loadDemoContacts",
  summary: "Load the marked demo contacts for a tracked run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTACTS, "load");
    const labels = copy(input.locale);
    const customer = asRecord(
      await ctx.callAsSystem(getService("contacts.resolve"), {
        email: "jordan.hale@demo.freeholder.test",
        name: labels.customer,
        country: "CA",
      }),
    );
    const overdue = asRecord(
      await ctx.callAsSystem(getService("contacts.resolve"), {
        email: "past-due@demo.freeholder.test",
        name: labels.overdue,
        country: "CA",
      }),
    );
    const customerId = asRecord(customer.contact).id;
    const overdueId = asRecord(overdue.contact).id;
    if (typeof customerId !== "string" || typeof overdueId !== "string") {
      throw new ServiceError("internal", "Demo contact resolve did not return ids.");
    }
    return demoLoadResultSchema.parse({
      records: [
        { fixtureKey: "customer", subjectType: "contact", subjectId: customerId, label: labels.customer },
        { fixtureKey: "overdue-client", subjectType: "contact", subjectId: overdueId, label: labels.overdue },
      ],
    });
  },
});

export const purgeDemoContacts = defineService({
  name: "core.purgeDemoContacts",
  summary: "Delete only contacts proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTACTS, "purge");
    const ids = input.records.map((record) => record.subjectId);
    if (ids.length) await ctx.tx.delete(contacts).where(inArray(contacts.id, ids));
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoContacts = defineService({
  name: "core.verifyDemoContacts",
  summary: "Verify marked demo contacts still exist.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTACTS, "verify");
    const ids = input.records.filter((record) => record.subjectType === "contact").map((record) => record.subjectId);
    const rows = ids.length
      ? await ctx.tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, ids))
      : [];
    const named = rows.filter((row) => row.name.startsWith("[Demo]"));
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "core.demo-contacts.visible",
          achieved: named.length === 2,
          detail: named.map((row) => row.name).join(", "),
        },
      ],
    });
  },
});

export const loadDemoLocations = defineService({
  name: "core.loadDemoLocations",
  summary: "Load the marked demo studio location.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, LOCATIONS, "load");
    const labels = copy(input.locale);
    const location = asRecord(
      await ctx.callAsSystem(getService("locations.create"), {
        name: labels.location,
        slug: "freeholder-demo-studio",
        country: "CA",
        city: "Vancouver",
        region: "BC",
        street: "12 Harbour Walk",
        postalCode: "V6B 1A1",
        timezone: "America/Vancouver",
        status: "visible",
        isPrimary: false,
      }),
    );
    if (typeof location.id !== "string") {
      throw new ServiceError("internal", "Demo location create did not return an id.");
    }
    return demoLoadResultSchema.parse({
      records: [
        { fixtureKey: "studio", subjectType: "location", subjectId: location.id, label: labels.location },
      ],
    });
  },
});

export const purgeDemoLocations = defineService({
  name: "core.purgeDemoLocations",
  summary: "Delete only locations proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, LOCATIONS, "purge");
    for (const record of input.records) {
      await ctx.callAsSystem(getService("locations.remove"), { id: record.subjectId });
    }
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoLocations = defineService({
  name: "core.verifyDemoLocations",
  summary: "Verify the marked demo studio is still listed.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, LOCATIONS, "verify");
    const id = input.records.find((record) => record.subjectType === "location")?.subjectId;
    const [location] = id
      ? await ctx.tx
          .select({ id: businessLocations.id, name: businessLocations.name, slug: businessLocations.slug })
          .from(businessLocations)
          .where(eq(businessLocations.id, id))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "core.demo-locations.visible",
          achieved: location?.slug === "freeholder-demo-studio" && Boolean(location.name.startsWith("[Demo]")),
          detail: location?.name,
        },
      ],
    });
  },
});

export const loadDemoBookings = defineService({
  name: "core.loadDemoBookings",
  summary: "Load a marked resource calendar and a sitting on it.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, BOOKINGS, "load");
    const labels = copy(input.locale);
    const [studio] = await ctx.tx
      .select({ id: businessLocations.id })
      .from(businessLocations)
      .where(eq(businessLocations.slug, "freeholder-demo-studio"))
      .limit(1);
    const calendar = asRecord(
      await ctx.callAsSystem(getService("calendars.create"), {
        kind: "resource",
        name: labels.calendar,
        slug: "freeholder-demo-room",
        locationId: studio?.id ?? null,
        timezone: "America/Vancouver",
        capacityDefault: 1,
      }),
    );
    if (typeof calendar.id !== "string") {
      throw new ServiceError("internal", "Demo calendar create did not return an id.");
    }
    const start = new Date(Date.now() + 7 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    const booking = asRecord(
      await ctx.callAsSystem(getService("bookings.create"), {
        calendarId: calendar.id,
        contact: { email: "jordan.hale@demo.freeholder.test", name: labels.customer },
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        status: "confirmed",
        locationId: studio?.id ?? null,
        notes: labels.calendar,
      }),
    );
    if (typeof booking.id !== "string") {
      throw new ServiceError("internal", "Demo booking create did not return an id.");
    }
    return demoLoadResultSchema.parse({
      records: [
        { fixtureKey: "room", subjectType: "calendar", subjectId: calendar.id, label: labels.calendar },
        { fixtureKey: "sitting", subjectType: "booking", subjectId: booking.id, label: labels.calendar },
      ],
    });
  },
});

export const purgeDemoBookings = defineService({
  name: "core.purgeDemoBookings",
  summary: "Delete only calendars and bookings proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, BOOKINGS, "purge");
    const bookingIds = input.records.filter((record) => record.subjectType === "booking").map((record) => record.subjectId);
    const calendarIds = input.records.filter((record) => record.subjectType === "calendar").map((record) => record.subjectId);
    if (bookingIds.length) await ctx.tx.delete(bookings).where(inArray(bookings.id, bookingIds));
    if (calendarIds.length) await ctx.tx.delete(calendars).where(inArray(calendars.id, calendarIds));
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoBookings = defineService({
  name: "core.verifyDemoBookings",
  summary: "Verify the marked sitting is still on the demo calendar.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, BOOKINGS, "verify");
    const calendarId = input.records.find((record) => record.subjectType === "calendar")?.subjectId;
    const bookingId = input.records.find((record) => record.subjectType === "booking")?.subjectId;
    const [calendar] = calendarId
      ? await ctx.tx.select({ slug: calendars.slug, name: calendars.name }).from(calendars).where(eq(calendars.id, calendarId)).limit(1)
      : [];
    const [booking] = bookingId
      ? await ctx.tx.select({ id: bookings.id, status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId)).limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "core.demo-bookings.visible",
          achieved:
            calendar?.slug === "freeholder-demo-room" &&
            Boolean(calendar.name.startsWith("[Demo]")) &&
            booking?.status === "confirmed",
          detail: calendar?.name,
        },
      ],
    });
  },
});

export const loadDemoInbox = defineService({
  name: "core.loadDemoInbox",
  summary: "Open a marked conversation with the demo customer.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, INBOX, "load");
    const labels = copy(input.locale);
    const [person] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, "jordan.hale@demo.freeholder.test"))
      .limit(1);
    if (!person) throw new ServiceError("conflict", "Demo inbox needs the customer contact.");
    const contactId = person.id;
    const [opened] = await ctx.tx
      .insert(conversations)
      .values({
        contactId,
        subject: labels.thread,
        replyChannel: "email",
      })
      .returning({ id: conversations.id });
    await ctx.tx.insert(messages).values({
      conversationId: opened!.id,
      contactId,
      direction: "inbound",
      channel: "email",
      body: labels.inbound,
      sentBy: "contact",
    });
    return demoLoadResultSchema.parse({
      records: [
        { fixtureKey: "thread", subjectType: "conversation", subjectId: opened!.id, label: labels.thread },
      ],
    });
  },
});

export const purgeDemoInbox = defineService({
  name: "core.purgeDemoInbox",
  summary: "Delete only conversations proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, INBOX, "purge");
    const ids = input.records.map((record) => record.subjectId);
    if (ids.length) {
      await ctx.tx.delete(messages).where(inArray(messages.conversationId, ids));
      await ctx.tx.delete(conversations).where(inArray(conversations.id, ids));
    }
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoInbox = defineService({
  name: "core.verifyDemoInbox",
  summary: "Verify the marked conversation is still in the inbox.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, INBOX, "verify");
    const id = input.records.find((record) => record.subjectType === "conversation")?.subjectId;
    const [thread] = id
      ? await ctx.tx
          .select({ id: conversations.id, subject: conversations.subject, status: conversations.status })
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "core.demo-inbox.visible",
          achieved: thread?.status === "open" && Boolean(thread.subject?.startsWith("[Demo]")),
          detail: thread?.subject ?? undefined,
        },
      ],
    });
  },
});

export default [
  loadDemoContacts,
  purgeDemoContacts,
  verifyDemoContacts,
  loadDemoLocations,
  purgeDemoLocations,
  verifyDemoLocations,
  loadDemoBookings,
  purgeDemoBookings,
  verifyDemoBookings,
  loadDemoInbox,
  purgeDemoInbox,
  verifyDemoInbox,
];
