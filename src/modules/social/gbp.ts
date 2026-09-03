// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Google Business Profile hours, reviews and outbound-link attribution (C9.27).
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { env } from "@/core/env";
import { socialAdapters, type SocialHoursPeriod } from "@/adapters/social";
import { decryptSecret } from "@/core/connections/crypto";
import { businessLocations, openingHours } from "@/core/locations/schema";
import { ingestExternal } from "@/modules/reviews/service";
import { analyticsAttributions, analyticsEvents } from "@/modules/analytics/schema";
import { invoices } from "@/modules/invoicing/schema";
import {
  defineService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { ingestProfile } from "./ingest";
import { socialGbpReviews, socialProfiles, socialProfileLocations } from "./schema";

function tokenFor(profile: { id: string; credentials: string | null }): string {
  if (!profile.credentials) {
    throw new ServiceError("validation", "This profile has no stored credentials.");
  }
  const parsed = JSON.parse(decryptSecret(profile.credentials, profile.id)) as {
    accessToken?: string;
  };
  if (!parsed.accessToken) {
    throw new ServiceError("validation", "The stored credentials have no access token.");
  }
  return parsed.accessToken;
}

function asClock(value: string | null): string {
  if (!value) return "00:00";
  return value.slice(0, 5);
}

async function requireGbp(ctx: ServiceContext, profileId: string) {
  const [profile] = await ctx.tx
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.id, profileId))
    .limit(1);
  if (!profile) throw new ServiceError("not_found", "There is no such social profile.");
  if (profile.provider !== "google_business") {
    throw new ServiceError(
      "validation",
      "Hours and review sync is for Google Business Profile.",
    );
  }
  if (profile.status !== "active") {
    throw new ServiceError("conflict", "Only a reviewed, active profile can sync.");
  }
  return profile;
}

/** Assigned locations for a GBP profile, falling back to the primary NAP. */
export async function gbpLocationIds(
  ctx: ServiceContext,
  profileId: string,
): Promise<string[]> {
  const assigned = await ctx.tx
    .select({ locationId: socialProfileLocations.locationId })
    .from(socialProfileLocations)
    .where(eq(socialProfileLocations.profileId, profileId));
  if (assigned.length > 0) return assigned.map((row) => row.locationId);
  const [primary] = await ctx.tx
    .select({ id: businessLocations.id })
    .from(businessLocations)
    .where(eq(businessLocations.isPrimary, true))
    .limit(1);
  return primary ? [primary.id] : [];
}

async function periodsFor(
  ctx: ServiceContext,
  locationId: string,
): Promise<SocialHoursPeriod[]> {
  const hours = await ctx.tx
    .select()
    .from(openingHours)
    .where(eq(openingHours.locationId, locationId));
  return hours
    .filter((row) => row.weekday !== null)
    .map((row) => ({
      weekday: row.weekday!,
      opens: asClock(row.opens),
      closes: asClock(row.closes),
      closed: row.closed,
    }));
}

export const syncGbpHours = defineService({
  name: "social.syncGbpHours",
  writeClass: "write",
  summary: "Push this location's opening hours to Google Business Profile.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ profileId: uuid, locationId: uuid.optional() }),
  output: row({ locations: z.number().int() }),
  handler: async (input, ctx) => {
    const profile = await requireGbp(ctx, input.profileId);
    const locationIds = input.locationId
      ? [input.locationId]
      : await gbpLocationIds(ctx, profile.id);
    if (locationIds.length === 0) {
      throw new ServiceError(
        "validation",
        "Assign this profile to a location, or add a primary location, before syncing hours.",
      );
    }
    const adapter = socialAdapters.get(profile.provider);
    const token = tokenFor(profile);
    for (const locationId of locationIds) {
      await adapter.pushHours(token, await periodsFor(ctx, locationId));
    }
    ctx.setSubject("social_profile", profile.id);
    ctx.queueEvent("social.gbpHoursSynced", {
      profileId: profile.id,
      locations: locationIds.length,
    });
    return { locations: locationIds.length };
  },
});

export const syncGbpReviews = defineService({
  name: "social.syncGbpReviews",
  writeClass: "write",
  summary: "Import Google Business Profile reviews into the reviews module.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ profileId: uuid }),
  output: row({ imported: z.number().int(), skipped: z.number().int() }),
  handler: async (input, ctx) => {
    const profile = await requireGbp(ctx, input.profileId);
    const adapter = socialAdapters.get(profile.provider);
    const remote = await adapter.listReviews(tokenFor(profile));
    let imported = 0;
    let skipped = 0;
    for (const item of remote) {
      const [seen] = await ctx.tx
        .select({ id: socialGbpReviews.id })
        .from(socialGbpReviews)
        .where(eq(socialGbpReviews.providerRef, item.providerRef))
        .limit(1);
      if (seen) {
        skipped += 1;
        continue;
      }
      const review = await ctx.callAsSystem(ingestExternal, {
        source: "google_business",
        rating: item.rating,
        body: item.body,
        displayName: item.displayName,
        email: item.email,
      });
      await ctx.tx.insert(socialGbpReviews).values({
        reviewId: review.id,
        profileId: profile.id,
        providerRef: item.providerRef,
      });
      imported += 1;
    }
    ctx.setSubject("social_profile", profile.id);
    ctx.queueEvent("social.gbpReviewsSynced", { profileId: profile.id, imported });
    return { imported, skipped };
  },
});

export const syncGbp = defineService({
  name: "social.syncGbp",
  writeClass: "write",
  summary: "Pull GBP posts and reviews and push opening hours in one pass.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ profileId: uuid }),
  output: row({
    packagesCreated: z.number().int(),
    hoursLocations: z.number().int(),
    reviewsImported: z.number().int(),
    reviewsSkipped: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const profile = await requireGbp(ctx, input.profileId);
    let packagesCreated = 0;
    if (profile.allowRead) {
      const ingested = await ctx.call(ingestProfile, { profileId: profile.id });
      packagesCreated = ingested.packagesCreated;
    }
    let hoursLocations = 0;
    try {
      const hours = await ctx.call(syncGbpHours, { profileId: profile.id });
      hoursLocations = hours.locations;
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== "validation") throw error;
    }
    const reviews = profile.allowRead
      ? await ctx.call(syncGbpReviews, { profileId: profile.id })
      : { imported: 0, skipped: 0 };
    return {
      packagesCreated,
      hoursLocations,
      reviewsImported: reviews.imported,
      reviewsSkipped: reviews.skipped,
    };
  },
});

export const attributionReport = defineService({
  name: "social.attributionReport",
  summary: "Visits, contacts and revenue attributed to outbound social posts.",
  kind: "query",
  permission: "scoped",
  input: z.object({ days: z.number().int().min(1).max(90).default(30) }),
  output: listed(
    row({
      source: z.string(),
      campaign: z.string().nullable(),
      visitors: z.number().int(),
      contacts: z.number().int(),
      conversions: z.number().int(),
      revenueMinor: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const from = new Date(Date.now() - input.days * 86_400_000);
    const attributed = await ctx.tx
      .select({
        anonId: analyticsAttributions.anonId,
        source: analyticsAttributions.lastSource,
        campaign: analyticsAttributions.lastCampaign,
        lastAt: analyticsAttributions.lastAt,
      })
      .from(analyticsAttributions)
      .where(
        and(
          eq(analyticsAttributions.lastMedium, "social"),
          gte(analyticsAttributions.lastAt, from),
        ),
      );
    if (attributed.length === 0) return [];

    const anonIds = attributed.map((row) => row.anonId);
    const identified = await ctx.tx
      .select({
        anonId: analyticsEvents.anonId,
        contactId: analyticsEvents.contactId,
      })
      .from(analyticsEvents)
      .where(
        and(
          inArray(analyticsEvents.anonId, anonIds),
          isNotNull(analyticsEvents.contactId),
        ),
      );
    const conversions = await ctx.tx
      .select({
        anonId: analyticsEvents.anonId,
      })
      .from(analyticsEvents)
      .where(
        and(
          inArray(analyticsEvents.anonId, anonIds),
          eq(analyticsEvents.name, "form.submitted"),
        ),
      );
    const contactIds = [
      ...new Set(
        identified
          .map((row) => row.contactId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const paid =
      contactIds.length === 0
        ? []
        : await ctx.tx
            .select({
              contactId: invoices.contactId,
              paidMinor: invoices.paidMinor,
            })
            .from(invoices)
            .where(
              and(
                inArray(invoices.contactId, contactIds),
                isNotNull(invoices.paidAt),
                gte(invoices.paidAt, from),
              ),
            );

    const contactsByAnon = new Map<string, Set<string>>();
    for (const row of identified) {
      if (!row.contactId) continue;
      const set = contactsByAnon.get(row.anonId) ?? new Set();
      set.add(row.contactId);
      contactsByAnon.set(row.anonId, set);
    }
    const converted = new Set(conversions.map((row) => row.anonId));
    const revenueByContact = new Map<string, number>();
    for (const row of paid) {
      revenueByContact.set(
        row.contactId,
        (revenueByContact.get(row.contactId) ?? 0) + Number(row.paidMinor),
      );
    }

    const groups = new Map<
      string,
      {
        source: string;
        campaign: string | null;
        visitors: number;
        contactIds: Set<string>;
        conversions: number;
        revenueMinor: number;
      }
    >();
    for (const row of attributed) {
      const key = `${row.source}\0${row.campaign ?? ""}`;
      const current = groups.get(key) ?? {
        source: row.source,
        campaign: row.campaign,
        visitors: 0,
        contactIds: new Set<string>(),
        conversions: 0,
        revenueMinor: 0,
      };
      current.visitors += 1;
      if (converted.has(row.anonId)) current.conversions += 1;
      for (const contactId of contactsByAnon.get(row.anonId) ?? []) {
        if (!current.contactIds.has(contactId)) {
          current.contactIds.add(contactId);
          current.revenueMinor += revenueByContact.get(contactId) ?? 0;
        }
      }
      groups.set(key, current);
    }
    return [...groups.values()]
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 50)
      .map((row) => ({
        source: row.source,
        campaign: row.campaign,
        visitors: row.visitors,
        contacts: row.contactIds.size,
        conversions: row.conversions,
        revenueMinor: row.revenueMinor,
      }));
  },
});

export function outboundCampaignUrl(publicationId: string, provider: string): string {
  const base = env().APP_URL.replace(/\/+$/, "");
  const params = new URLSearchParams({
    utm_source: provider,
    utm_medium: "social",
    utm_campaign: publicationId,
  });
  return `${base}/?${params.toString()}`;
}

export async function runGbpJob(): Promise<void> {
  const { db } = await import("@/core/db");
  const rows = await db()
    .select({ id: socialProfiles.id })
    .from(socialProfiles)
    .where(
      and(eq(socialProfiles.status, "active"), eq(socialProfiles.provider, "google_business")),
    );
  for (const row of rows) {
    await syncGbp.call({ profileId: row.id }, { kind: "system" });
  }
}
