// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Asking what can be booked (MASTER.md §4.4, C6.03).
//
// The service that a booking page will call. It reads the service's own shape
// — duration, buffers, capacity, assignment, travel time — from the catalog by
// name rather than by import, because core may not depend on a module (§11)
// and a business with the catalog switched off should get a clear refusal
// rather than a broken screen.
//
// `permission: "public"` is deliberate and narrow: what is free next Tuesday is
// exactly the question a visitor may ask, and the answer carries times, a
// calendar's name, and nothing else. Everything private stayed behind the
// resolver — a synced event's title never travelled this far, because C4.12
// never stored one it was not permitted to.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { uuid } from "@/core/contract";
import { calendars } from "@/core/scheduling/schema";
import { resolveSlots } from "@/core/scheduling/resolver";
import { audienceFor, audienceMayBook } from "@/core/scheduling/audiences";
import { getBusiness } from "@/core/settings/service";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";

/** A fortnight at a time. A year of fifteen-minute slots is not a page. */
const MAX_RANGE_DAYS = 62;

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date is written as YYYY-MM-DD.");

interface OfferingShape {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  travelTimeMin: number;
  capacity: number;
  assignment: "specific" | "pool" | "round_robin";
}

/**
 * The service's shape, from the catalog if it is installed.
 *
 * A missing catalog is a refusal rather than a guess: offering slots of an
 * invented length would be worse than saying the service cannot be read.
 */
async function offeringShape(
  ctx: ServiceContext,
  productId: string,
): Promise<OfferingShape> {
  let offering: unknown;
  try {
    offering = await ctx.callAsSystem(
      getService("catalog.getServiceOffering"),
      { productId },
    );
  } catch {
    throw new ServiceError(
      "conflict",
      "Services are part of the catalog, which is not installed on this site.",
    );
  }
  if (!offering) {
    throw new ServiceError("not_found", "That is not a bookable service.");
  }
  const shape = offering as Partial<OfferingShape>;
  if (!shape.durationMin || shape.durationMin <= 0) {
    throw new ServiceError("conflict", "That service has no length set.");
  }
  return {
    durationMin: shape.durationMin,
    bufferBeforeMin: shape.bufferBeforeMin ?? 0,
    bufferAfterMin: shape.bufferAfterMin ?? 0,
    travelTimeMin: shape.travelTimeMin ?? 0,
    capacity: shape.capacity ?? 1,
    assignment: shape.assignment ?? "specific",
  };
}

export const availableSlots = defineService({
  name: "scheduling.slots",
  summary: "What can be booked for a service, between two dates.",
  kind: "query",
  permission: "public",
  input: z.object({
    /** The service offering, which is keyed on its catalog product. */
    serviceOfferingId: z.uuid(),
    productId: z.uuid(),
    from: isoDate,
    to: isoDate,
    /** "I want Sam" — offered first, never the only answer for a pool. */
    preferredCalendarId: z.uuid().optional(),
    /** A party of three should not be offered a single place. */
    seats: z.number().int().min(1).max(100).default(1),
    /** 15-minute increments, or on the hour only. */
    granularityMin: z.number().int().min(5).max(240).optional(),
    limit: z.number().int().min(1).max(500).default(200),
    /**
     * The tokenised link a caller arrived by, if any (C6.05).
     *
     * Proof, not a claim: an unrecognised token falls back to whatever public
     * audience exists rather than to the one it looks like it names.
     */
    audienceToken: z.string().trim().min(8).max(200).optional(),
  }),
  output: z.array(
    z.object({
      startsAt: z.date(),
      endsAt: z.date(),
      calendarId: uuid,
      calendarName: z.string(),
      resourceCalendarIds: z.array(uuid),
      seatsAvailable: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    if (input.to < input.from) {
      throw new ServiceError("validation", "That range ends before it begins.");
    }
    const days =
      (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) /
      86_400_000;
    if (days > MAX_RANGE_DAYS) {
      throw new ServiceError(
        "validation",
        `Ask about at most ${MAX_RANGE_DAYS} days at a time.`,
      );
    }
    if (input.preferredCalendarId) {
      const [preferred] = await ctx.tx
        .select({ id: calendars.id })
        .from(calendars)
        .where(eq(calendars.id, input.preferredCalendarId))
        .limit(1);
      if (!preferred) throw new ServiceError("not_found", "No such calendar.");
    }

    const shape = await offeringShape(ctx, input.productId);
    const business = await ctx.call(getBusiness, {}).catch(() => null);

    // §41: bookability is a property of the audience, not of the calendar.
    // The same calendar answers differently for a customer and for a friend,
    // and busy time is subtracted from both.
    const audience = await audienceFor(ctx.tx, {
      token: input.audienceToken ?? null,
      // A tagged audience is proved by a contact identity, and a public
      // request has none until the customer portal session arrives with C8.
      // Passing null rather than guessing is the point: the alternative is a
      // tag audience that resolves for whoever happens to be signed in, which
      // is the opposite of what a tag means. `audienceFor` resolves tags
      // correctly wherever a contact *is* known, and is tested that way.
      contactId: null,
      signedIn: ctx.actor.kind === "user",
    });
    if (!audience) {
      // Not an error: an instance that takes no public bookings is a
      // legitimate configuration, and the honest answer is no times.
      return [];
    }
    if (!(await audienceMayBook(ctx.tx, audience.id, input.serviceOfferingId))) {
      // Also not an error, and deliberately indistinguishable from a fully
      // booked week: telling an anonymous caller that a service exists but is
      // not for them is a disclosure nobody asked for.
      return [];
    }

    return resolveSlots(ctx.tx, {
      serviceOfferingId: input.serviceOfferingId,
      from: input.from,
      to: input.to,
      timezone: business?.timezone ?? "UTC",
      durationMin: shape.durationMin,
      // The audience overrides the service where it has said something. Null
      // means it has not, rather than meaning zero.
      bufferBeforeMin: audience.bufferBeforeMin ?? shape.bufferBeforeMin,
      bufferAfterMin: audience.bufferAfterMin ?? shape.bufferAfterMin,
      travelTimeMin: shape.travelTimeMin,
      capacity: shape.capacity,
      assignment: shape.assignment,
      granularityMin: input.granularityMin,
      preferredCalendarId: input.preferredCalendarId,
      seats: input.seats,
      maxSlots: input.limit,
      audienceHours:
        audience.hours === "custom"
          ? { mode: "custom", rules: audience.customHours }
          : { mode: audience.hours },
      noticeOverrideMin: audience.minNoticeMin ?? undefined,
      horizonOverrideDays: audience.bookingHorizonDays ?? undefined,
    });
  },
});

export default [availableSlots];
