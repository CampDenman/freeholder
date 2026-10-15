// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Members' bookable services (MASTER.md §44.8, C12.25).
//
// A member turns one of their service listings into something people can
// book on the member's own calendar, with the member's weekly hours. Booking
// is the site's own flow and policies (`catalog.bookService`), and the paid
// booking invoice becomes the member's payout (`members.recordInvoicePayout`).
import { z } from "zod";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { listAvailability, setAvailability } from "@/core/scheduling/availability-service";
import { createCalendar, setServiceCalendars } from "@/core/scheduling/service";
import { bookings, calendars } from "@/core/scheduling/schema";
import { bookingAudiences, bookingAudienceServices } from "@/core/scheduling/audience-schema";
import { contacts } from "@/core/contacts/schema";
import { getBusiness } from "@/core/settings/service";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { listPriceRules, setPriceRule, upsertServiceOffering } from "@/modules/catalog/offerings";
import { bookableServices } from "@/modules/catalog/public-booking";
import { products, serviceOfferings } from "@/modules/catalog/schema";
import { SERVICE_LOCATION_TYPES } from "@/modules/catalog/contract";
import { memberListings, memberProfiles } from "./schema";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.");
const hours = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), starts: clock, ends: clock }))
  .max(21)
  .refine((list) => list.every((h) => h.starts < h.ends), "Each period must end after it starts.");

async function activeMember(ctx: ServiceContext) {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  const [me] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, ctx.actor.userId));
  if (me?.status !== "active") throw new ServiceError("permission", "Your membership is not active.");
  return me;
}

/** The member's own calendar, created the first time they offer a service. */
async function myCalendar(ctx: ServiceContext, me: typeof memberProfiles.$inferSelect, create: boolean): Promise<string | null> {
  const [found] = await ctx.tx
    .select({ id: calendars.id })
    .from(calendars)
    .where(and(eq(calendars.userId, me.userId), eq(calendars.kind, "person")))
    .limit(1);
  if (found || !create) return found?.id ?? null;
  const business = await ctx.callAsSystem(getBusiness, {});
  const calendar = await ctx.callAsSystem(createCalendar, {
    kind: "person",
    userId: me.userId,
    name: me.displayName,
    slug: `member-${me.handle.replace(/_/g, "-")}`,
    timezone: business?.timezone ?? "UTC",
  });
  return calendar.id;
}

/**
 * Bookings are gated by audiences (§4.4). A member's service is bookable by
 * whoever can book the site's own services: every enabled public or
 * signed-in audience. A site with none gets one public audience for members.
 */
async function openToSiteAudiences(ctx: ServiceContext, serviceOfferingId: string): Promise<void> {
  let audiences = await ctx.tx
    .select({ id: bookingAudiences.id })
    .from(bookingAudiences)
    .where(and(eq(bookingAudiences.enabled, true), inArray(bookingAudiences.who, ["public", "signed_in"])));
  if (audiences.length === 0) {
    audiences = await ctx.tx
      .insert(bookingAudiences)
      .values({ name: "Members' services", slug: "members-services", who: "public", enabled: true })
      .onConflictDoNothing()
      .returning({ id: bookingAudiences.id });
    if (audiences.length === 0) audiences = await ctx.tx.select({ id: bookingAudiences.id }).from(bookingAudiences).where(eq(bookingAudiences.slug, "members-services"));
  }
  await ctx.tx
    .insert(bookingAudienceServices)
    .values(audiences.map((a) => ({ audienceId: a.id, serviceOfferingId })))
    .onConflictDoNothing();
}

export const offerBookableService = defineService({
  name: "members.offerBookableService",
  summary: "Let people book one of your service listings on your own calendar, during the hours you set.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({
    productId: uuid,
    durationMin: z.number().int().min(15).max(8 * 60),
    locationType: z.enum(SERVICE_LOCATION_TYPES).default("virtual"),
    hours,
  }),
  output: z.object({ calendarId: uuid, offeringId: uuid }),
  handler: async (input, ctx) => {
    const me = await activeMember(ctx);
    const [listing] = await ctx.tx
      .select({ review: memberListings.review, kind: products.kind, status: products.status })
      .from(memberListings)
      .innerJoin(products, eq(products.id, memberListings.productId))
      .where(and(eq(memberListings.productId, input.productId), eq(memberListings.sellerId, me.userId)));
    if (!listing) throw new ServiceError("not_found", "That listing is not yours.");
    if (listing.kind !== "service") throw new ServiceError("validation", "Only a service listing can be booked.");
    if (listing.review !== "approved" || listing.status !== "active") throw new ServiceError("conflict", "The listing must be live before people can book it.");
    const calendarId = (await myCalendar(ctx, me, true))!;
    const offering = await ctx.callAsSystem(upsertServiceOffering, {
      productId: input.productId,
      durationMin: input.durationMin,
      locationType: input.locationType,
    });
    if (!(await ctx.callAsSystem(listPriceRules, { productId: input.productId })).some((r) => r.mode === "full")) {
      await ctx.callAsSystem(setPriceRule, { productId: input.productId, mode: "full" });
    }
    await ctx.callAsSystem(setServiceCalendars, { serviceOfferingId: offering.id, members: [{ calendarId, role: "primary", priority: 0 }] });
    await ctx.callAsSystem(setAvailability, { calendarId, rules: input.hours.map((h) => ({ ...h, kind: "bookable" as const })) });
    await openToSiteAudiences(ctx, offering.id);
    ctx.setSubject("member_service", input.productId);
    return { calendarId, offeringId: offering.id };
  },
});

export const myBookingHours = defineService({
  name: "members.myBookingHours",
  summary: "The weekly hours people can book you.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({ calendarId: uuid.nullable(), hours: listed(row({ weekday: z.number().int(), starts: z.string(), ends: z.string() })) }),
  handler: async (_input, ctx) => {
    const me = await activeMember(ctx);
    const calendarId = await myCalendar(ctx, me, false);
    if (!calendarId) return { calendarId: null, hours: [] };
    const { rules } = await ctx.callAsSystem(listAvailability, { calendarId });
    return { calendarId, hours: rules.filter((r) => r.kind === "bookable").map((r) => ({ weekday: r.weekday, starts: r.starts.slice(0, 5), ends: r.ends.slice(0, 5) })) };
  },
});

export const setMyBookingHours = defineService({
  name: "members.setBookingHours",
  summary: "Set the weekly hours people can book you.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ hours }),
  output: z.object({ hours: z.number().int() }),
  handler: async (input, ctx) => {
    const me = await activeMember(ctx);
    const calendarId = await myCalendar(ctx, me, false);
    if (!calendarId) throw new ServiceError("conflict", "Offer a service for booking first.");
    const saved = await ctx.callAsSystem(setAvailability, { calendarId, rules: input.hours.map((h) => ({ ...h, kind: "bookable" as const })) });
    return { hours: saved.rules };
  },
});

export const myServiceBookings = defineService({
  name: "members.myServiceBookings",
  summary: "Upcoming bookings of your services.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(row({ id: uuid, startsAt: timestamp, endsAt: timestamp, status: z.string(), service: z.string().nullable(), customer: z.string().nullable() })),
  handler: async (_input, ctx) => {
    const me = await activeMember(ctx);
    const calendarId = await myCalendar(ctx, me, false);
    if (!calendarId) return [];
    const rows = await ctx.tx
      .select({ booking: bookings, customer: contacts.name })
      .from(bookings)
      .leftJoin(contacts, eq(contacts.id, bookings.contactId))
      .where(and(eq(bookings.calendarId, calendarId), gte(bookings.endsAt, new Date())))
      .orderBy(asc(bookings.startsAt))
      .limit(200);
    const names = new Map<string, string>();
    const out = [];
    for (const { booking, customer } of rows) {
      let service: string | null = null;
      if (booking.serviceOfferingId) {
        if (!names.has(booking.serviceOfferingId)) {
          const [p] = await ctx.tx
            .select({ name: products.name })
            .from(serviceOfferings)
            .innerJoin(products, eq(products.id, serviceOfferings.productId))
            .where(eq(serviceOfferings.id, booking.serviceOfferingId));
          names.set(booking.serviceOfferingId, p?.name ?? "");
        }
        service = names.get(booking.serviceOfferingId) || null;
      }
      out.push({ id: booking.id, startsAt: booking.startsAt, endsAt: booking.endsAt, status: booking.status, service, customer: customer ?? null });
    }
    return out;
  },
});

export const memberServices = defineService({
  name: "members.bookableServices",
  summary: "A member's services you can book, and where to book them.",
  kind: "query",
  permission: "public",
  input: z.object({ handle: z.string().trim().toLowerCase().max(60) }),
  output: z.object({ sellerUserId: uuid.nullable(), services: listed(row({ productId: uuid, name: z.string(), durationMin: z.number().int() })) }),
  handler: async (input, ctx) => {
    const [seller] = await ctx.tx
      .select({ userId: memberProfiles.userId })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.handle, input.handle), eq(memberProfiles.status, "active")));
    if (!seller) return { sellerUserId: null, services: [] };
    const { services } = await ctx.call(bookableServices, { sellerUserId: seller.userId });
    return { sellerUserId: seller.userId, services: services.map(({ productId, name, durationMin }) => ({ productId, name, durationMin })) };
  },
});

export default [offerBookableService, myBookingHours, setMyBookingHours, myServiceBookings, memberServices];
