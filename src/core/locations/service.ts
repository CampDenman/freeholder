// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Locations and NAP (MASTER.md §4.10, §13 step 4).
//
// Reading is public because every public page renders the footer, and the
// footer carries the primary location's NAP. Writing is owner-only: an address
// is the business's identity to a search engine, and a staff account that can
// change it can quietly move the business.
//
// §4.10: "Locations are optional: a purely online creator skips this and no
// empty local scaffolding appears." Nothing here creates a default location,
// and every read answers null rather than a placeholder — the emptiness has to
// survive all the way to the surfaces, or an online-only business ends up with
// a blank address block in its footer.
import { z } from "zod";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  businessLocations,
  openingHours,
  serviceAreas,
} from "@/core/locations/schema";
import { violates } from "@/core/db/errors";
import { defineService, ServiceError } from "@/core/service";

/** A URL segment: lowercase, no punctuation to escape, no leading dash. */
const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "use lowercase letters, numbers and single dashes",
  });

/**
 * Coordinates arrive as numbers and are stored as `numeric`, which drizzle
 * reads and writes as a string. Converting here rather than at each call site
 * keeps the boundary in one place.
 */
const coordinate = (max: number) =>
  z
    .number()
    .min(-max)
    .max(max)
    .transform((n) => n.toString());

const locationShape = {
  name: z.string().min(1).max(200),
  slug,
  schemaType: z.string().min(1).max(80).nullish(),
  street: z.string().max(200).nullish(),
  unit: z.string().max(60).nullish(),
  city: z.string().max(120).nullish(),
  region: z.string().max(120).nullish(),
  postalCode: z.string().max(24).nullish(),
  country: z.string().length(2).toUpperCase(),
  latitude: coordinate(90).nullish(),
  longitude: coordinate(180).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.email().max(200).nullish(),
  googleBusinessProfileUrl: z.url().max(500).nullish(),
  sameAs: z.array(z.url().max(500)).max(25),
  priceRange: z.string().max(40).nullish(),
  timezone: z.string().max(80).nullish(),
  status: z.enum(["visible", "hidden"]),
};

const createLocation = z.object({
  ...locationShape,
  sameAs: locationShape.sameAs.default([]),
  status: locationShape.status.default("visible"),
  /**
   * Whether this is the business's own NAP. Absent means "decide": the first
   * location on an instance is primary, because a business with exactly one
   * location and no primary would render no address anywhere and give an owner
   * nothing to click to fix it.
   */
  isPrimary: z.boolean().optional(),
});

/** Patch keeps the shape without the defaults — see settings/service.ts. */
const patchLocation = z.object(locationShape).partial().extend({
  id: z.uuid(),
});

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: "use 24-hour HH:MM",
});

/**
 * One opening-hours interval: a weekly rule or a dated override, never both.
 * The database says the same thing in a check constraint; saying it here too
 * is what turns a constraint violation into a sentence somebody can act on.
 */
const hoursEntry = z
  .object({
    weekday: z.number().int().min(0).max(6).nullish(),
    onDate: z.iso.date().nullish(),
    opens: timeOfDay.nullish(),
    closes: timeOfDay.nullish(),
    closed: z.boolean().default(false),
    label: z.string().max(120).nullish(),
  })
  .refine((v) => (v.weekday === null || v.weekday === undefined) !== (v.onDate === null || v.onDate === undefined), {
    message: "give either a weekday or a date, not both",
  })
  .refine((v) => (v.closed ? !v.opens && !v.closes : Boolean(v.opens && v.closes)), {
    message: "open hours need both a start and an end; closed days need neither",
  })
  .refine((v) => v.closed || !v.opens || !v.closes || v.opens < v.closes, {
    // Overnight hours are real (a bar open until 2am) but they are expressed
    // as two intervals, not one that wraps — a single row where closes < opens
    // renders as a negative day and emits nonsense.
    message: "closing time must be after opening time; split hours that cross midnight into two entries",
  });

export const listLocations = defineService({
  name: "locations.list",
  summary: "Every location, primary first.",
  kind: "query",
  permission: "public",
  input: z.object({
    /** Hidden locations are for the admin; the public surface never sees one. */
    includeHidden: z.boolean().default(false),
  }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(businessLocations)
      .where(
        input.includeHidden
          ? undefined
          : eq(businessLocations.status, "visible"),
      )
      .orderBy(sql`${businessLocations.isPrimary} desc`, asc(businessLocations.name));
    return rows;
  },
});

/**
 * The location whose NAP is the business's own.
 *
 * Null is a real answer, not a missing one (§4.10: locations are optional).
 * Every caller renders nothing when it comes back null.
 */
export const primaryLocation = defineService({
  name: "locations.primary",
  summary: "The location whose NAP the site renders as its own.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(businessLocations)
      .where(
        and(
          eq(businessLocations.isPrimary, true),
          eq(businessLocations.status, "visible"),
        ),
      )
      .limit(1);
    return row ?? null;
  },
});

/**
 * One location with everything a page or a JSON-LD builder needs, in one call.
 *
 * A block resolving a location should not have to make three round trips to
 * draw an address, a set of hours and a service area.
 */
export const getLocation = defineService({
  name: "locations.get",
  summary: "One location, with its hours and service area.",
  kind: "query",
  permission: "public",
  input: z
    .object({ id: z.uuid().optional(), slug: slug.optional() })
    .refine((v) => Boolean(v.id) !== Boolean(v.slug), {
      message: "ask by id or by slug",
    }),
  handler: async (input, ctx) => {
    const [location] = await ctx.tx
      .select()
      .from(businessLocations)
      .where(
        input.id
          ? eq(businessLocations.id, input.id)
          : eq(businessLocations.slug, input.slug!),
      )
      .limit(1);
    if (!location) return null;

    const [hours, [area]] = await Promise.all([
      ctx.tx
        .select()
        .from(openingHours)
        .where(eq(openingHours.locationId, location.id))
        .orderBy(asc(openingHours.weekday), asc(openingHours.onDate)),
      ctx.tx
        .select()
        .from(serviceAreas)
        .where(eq(serviceAreas.locationId, location.id))
        .limit(1),
    ]);

    return { ...location, hours, serviceArea: area ?? null };
  },
});

export const createLocationService = defineService({
  name: "locations.create",
  summary: "Add a location.",
  kind: "mutation",
  permission: "owner",
  input: createLocation,
  handler: async (input, ctx) => {
    const { isPrimary, ...values } = input;

    const [existingCount] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(businessLocations);
    const first = (existingCount?.count ?? 0) === 0;
    const primary = isPrimary ?? first;

    // Demoting the incumbent before inserting, rather than letting the partial
    // unique index reject the write: an owner marking a new location primary
    // means "this one instead", and answering with a constraint error would
    // make them go and unset the old one first.
    if (primary && !first) {
      await ctx.tx
        .update(businessLocations)
        .set({ isPrimary: false })
        .where(eq(businessLocations.isPrimary, true));
    }

    const [row] = await ctx.tx
      .insert(businessLocations)
      .values({ ...values, isPrimary: primary })
      .returning()
      .catch(slugConflict(values.slug));

    ctx.setSubject("business_locations", row!.id);
    ctx.queueEvent("location.created", { id: row!.id, slug: row!.slug });
    return row!;
  },
});

export const updateLocation = defineService({
  name: "locations.update",
  summary: "Change a location's details.",
  kind: "mutation",
  permission: "owner",
  input: patchLocation,
  handler: async (input, ctx) => {
    const { id, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "locations.update: nothing to change");
    }

    const [existing] = await ctx.tx
      .select({ slug: businessLocations.slug })
      .from(businessLocations)
      .where(eq(businessLocations.id, id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "No such location.");

    const [row] = await ctx.tx
      .update(businessLocations)
      .set(changes)
      .where(eq(businessLocations.id, id))
      .returning()
      .catch(slugConflict(changes.slug));

    ctx.setSubject("business_locations", id);
    // §5's "slugs never silently break" is handled where the page is: a
    // location that moves is a page that moves, and cms.updatePage already
    // records the redirect for any page whose slug changes. Recording one here
    // too would be a second place for that rule to be got right or wrong.
    ctx.queueEvent("location.updated", { id, slug: row!.slug, moved: changes.slug !== existing.slug });
    return row!;
  },
});

/**
 * Make this location the business's own NAP.
 *
 * Separate from `update` because it is a change to a *different* location as
 * well as this one, and because it is the one-click action the admin list
 * offers beside every row.
 */
export const setPrimaryLocation = defineService({
  name: "locations.setPrimary",
  summary: "Choose the location whose NAP the site renders as its own.",
  kind: "mutation",
  permission: "owner",
  input: z.object({ id: z.uuid() }),
  handler: async (input, ctx) => {
    const [location] = await ctx.tx
      .select()
      .from(businessLocations)
      .where(eq(businessLocations.id, input.id))
      .limit(1);
    if (!location) throw new ServiceError("not_found", "No such location.");
    if (location.status === "hidden") {
      throw new ServiceError(
        "validation",
        "A hidden location cannot be the primary one — the footer would render nothing.",
      );
    }

    await ctx.tx
      .update(businessLocations)
      .set({ isPrimary: false })
      .where(
        and(
          eq(businessLocations.isPrimary, true),
          ne(businessLocations.id, input.id),
        ),
      );
    const [row] = await ctx.tx
      .update(businessLocations)
      .set({ isPrimary: true })
      .where(eq(businessLocations.id, input.id))
      .returning();

    ctx.setSubject("business_locations", input.id);
    ctx.queueEvent("location.updated", { id: input.id, slug: row!.slug });
    return row!;
  },
});

/**
 * Replace a location's hours wholesale.
 *
 * A week of hours is edited as a week — an owner changes Tuesday and Saturday
 * together and presses save once — so the service takes the whole set. Diffing
 * to preserve row ids would buy nothing: nothing references an hours row.
 */
export const setOpeningHours = defineService({
  name: "locations.setHours",
  summary: "Replace a location's opening hours.",
  kind: "mutation",
  permission: "owner",
  input: z.object({
    locationId: z.uuid(),
    entries: z.array(hoursEntry).max(120),
  }),
  handler: async (input, ctx) => {
    const [location] = await ctx.tx
      .select({ id: businessLocations.id })
      .from(businessLocations)
      .where(eq(businessLocations.id, input.locationId))
      .limit(1);
    if (!location) throw new ServiceError("not_found", "No such location.");

    // Two rules for one weekday is two answers to "when are you open?", and
    // the database cannot express "at most one per weekday per location"
    // without also forbidding the dated overrides that share the table.
    const weekdays = input.entries
      .map((entry) => entry.weekday)
      .filter((day): day is number => typeof day === "number");
    if (new Set(weekdays).size !== weekdays.length) {
      throw new ServiceError(
        "validation",
        "Each weekday can only be given once. Split a day with a break into a morning and an afternoon by using dated entries.",
      );
    }

    await ctx.tx
      .delete(openingHours)
      .where(eq(openingHours.locationId, input.locationId));

    const rows =
      input.entries.length === 0
        ? []
        : await ctx.tx
            .insert(openingHours)
            .values(
              input.entries.map((entry) => ({
                locationId: input.locationId,
                weekday: entry.weekday ?? null,
                onDate: entry.onDate ?? null,
                opens: entry.opens ?? null,
                closes: entry.closes ?? null,
                closed: entry.closed,
                label: entry.label ?? null,
              })),
            )
            .returning();

    ctx.setSubject("business_locations", input.locationId);
    ctx.queueEvent("location.updated", { id: input.locationId });
    return rows;
  },
});

export const setServiceArea = defineService({
  name: "locations.setServiceArea",
  summary: "Set or clear where a location will travel to.",
  kind: "mutation",
  permission: "owner",
  input: z.object({
    locationId: z.uuid(),
    /** Null clears it — a business that has stopped travelling. */
    area: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("radius"),
          centerLatitude: coordinate(90),
          centerLongitude: coordinate(180),
          radiusKm: z.number().positive().max(20_000).transform(String),
        }),
        z.object({
          kind: z.literal("regions"),
          regions: z.array(z.string().min(1).max(120)).min(1).max(50),
        }),
      ])
      .nullable(),
  }),
  handler: async (input, ctx) => {
    const [location] = await ctx.tx
      .select({ id: businessLocations.id })
      .from(businessLocations)
      .where(eq(businessLocations.id, input.locationId))
      .limit(1);
    if (!location) throw new ServiceError("not_found", "No such location.");

    await ctx.tx
      .delete(serviceAreas)
      .where(eq(serviceAreas.locationId, input.locationId));

    let row = null;
    if (input.area) {
      const values =
        input.area.kind === "radius"
          ? {
              kind: "radius" as const,
              centerLatitude: input.area.centerLatitude,
              centerLongitude: input.area.centerLongitude,
              radiusKm: input.area.radiusKm,
            }
          : { kind: "regions" as const, regions: input.area.regions };
      [row] = await ctx.tx
        .insert(serviceAreas)
        .values({ locationId: input.locationId, ...values })
        .returning();
    }

    ctx.setSubject("business_locations", input.locationId);
    ctx.queueEvent("location.updated", { id: input.locationId });
    return row;
  },
});

export const deleteLocation = defineService({
  name: "locations.remove",
  summary: "Delete a location.",
  kind: "mutation",
  permission: "owner",
  input: z.object({ id: z.uuid() }),
  handler: async (input, ctx) => {
    const [location] = await ctx.tx
      .select()
      .from(businessLocations)
      .where(eq(businessLocations.id, input.id))
      .limit(1);
    if (!location) throw new ServiceError("not_found", "No such location.");

    const [remaining] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(businessLocations);
    if (location.isPrimary && (remaining?.count ?? 0) > 1) {
      // Deleting the primary while others exist would leave the site with no
      // NAP and no obvious reason why — the footer would simply stop rendering
      // an address. Choosing the replacement is the owner's call, not a
      // heuristic's.
      throw new ServiceError(
        "conflict",
        "Make another location the primary one first — the site renders its address from it.",
      );
    }

    // Hours and service area go with it by cascade; the row's own page is left
    // to the caller, because a page an owner has edited is content, not debris.
    await ctx.tx
      .delete(businessLocations)
      .where(eq(businessLocations.id, input.id));

    ctx.setSubject("business_locations", input.id);
    ctx.queueEvent("location.deleted", { id: input.id, slug: location.slug });
    return { id: input.id, slug: location.slug };
  },
});

/**
 * Turn the unique-index violation into the sentence that fixes it.
 *
 * The constraint is what guarantees the fact; this only decides what an owner
 * reads when they hit it. Recognising it is `violates` — see core/db/errors.ts
 * for why that is not a one-line message match.
 */
function slugConflict(candidate: string | undefined) {
  return (error: unknown): never => {
    if (violates(error, "business_locations_slug")) {
      throw new ServiceError(
        "conflict",
        `Another location already uses the address /locations/${candidate ?? ""}.`,
      );
    }
    throw error;
  };
}

export default [
  listLocations,
  primaryLocation,
  getLocation,
  createLocationService,
  updateLocation,
  setPrimaryLocation,
  setOpeningHours,
  setServiceArea,
  deleteLocation,
];
