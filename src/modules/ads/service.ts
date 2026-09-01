// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ad inventory and the sale of it (MASTER.md §4.16, C9.17).
//
// C9.17 builds the inventory and the paperwork: sizes, slots, advertisers,
// campaigns, line items, targeting, dayparting, frequency caps and approvals.
// It serves nothing. Creatives, house fill, the signed click-out and the
// counting are C9.18 and C9.19, and keeping them apart is deliberate — an
// owner can sell and schedule a campaign before anything renders, which is the
// order the work actually happens in.
//
// The rule that shapes the whole module is §4.16's: "`Advertiser` … **A
// `Contact`**, not a separate customer table." A local business that both
// advertises and buys prints is one person here, which is the spine (§4.1)
// doing the job it exists for.
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import {
  actorString,
  defineService,
  getService,
  listServices,
  ServiceError,
} from "@/core/service";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { getBusiness } from "@/core/settings/service";
import { track } from "@/modules/analytics/service";
import {
  adCampaigns,
  adCreatives,
  adLineItems,
  adSizes,
  adSlots,
  advertisers,
} from "./schema";
import { clickPath, safeClickUrl, signClickToken, verifyClickToken } from "./clicks";
import { chooseFill, zonedClock, type Candidate, type DeclaredSize } from "./select";
import type { ServeContext } from "./targeting";

const slotCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.");

const sizeRow = row({
  id: uuidSchema,
  label: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  breakpoint: z.enum(["desktop", "tablet", "mobile"]),
  iabName: z.string().nullable(),
});

const format = z.object({
  breakpoint: z.enum(["desktop", "tablet", "mobile"]),
  sizes: z
    .array(z.object({ width: z.number().int().min(1).max(4000), height: z.number().int().min(1).max(4000) }))
    .min(1)
    .max(10),
});

const slotRow = row({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  formats: z.unknown(),
  lazy: z.boolean(),
  refreshSeconds: z.number().int(),
  allowHouseFill: z.boolean(),
  allowThirdParty: z.boolean(),
  status: z.enum(["draft", "active", "retired"]),
});

/**
 * The standard set §4.16 names, in one place.
 *
 * "Desktop: 970×250 billboard, 970×90 and 728×90 leaderboards, 300×250 medium
 * rectangle, 336×280 large rectangle, 300×600 half page, 160×600 skyscraper.
 * Mobile: 320×50 banner, 320×100 large banner, 300×250, 300×50."
 *
 * TypeScript rather than the migration, because reference data that exists
 * only in a migration cannot be restored — anything that truncates the table
 * leaves a publisher with no sizes and no way back short of editing SQL.
 */
export const STANDARD_SIZES = [
  { label: "Billboard", width: 970, height: 250, breakpoint: "desktop", iabName: "Billboard" },
  { label: "Super leaderboard", width: 970, height: 90, breakpoint: "desktop", iabName: "Super Leaderboard" },
  { label: "Leaderboard", width: 728, height: 90, breakpoint: "desktop", iabName: "Leaderboard" },
  { label: "Medium rectangle", width: 300, height: 250, breakpoint: "desktop", iabName: "Medium Rectangle" },
  { label: "Large rectangle", width: 336, height: 280, breakpoint: "desktop", iabName: "Large Rectangle" },
  { label: "Half page", width: 300, height: 600, breakpoint: "desktop", iabName: "Half Page" },
  { label: "Skyscraper", width: 160, height: 600, breakpoint: "desktop", iabName: "Wide Skyscraper" },
  { label: "Mobile banner", width: 320, height: 50, breakpoint: "mobile", iabName: "Mobile Banner" },
  { label: "Large mobile banner", width: 320, height: 100, breakpoint: "mobile", iabName: "Large Mobile Banner" },
  { label: "Medium rectangle", width: 300, height: 250, breakpoint: "mobile", iabName: "Medium Rectangle" },
  { label: "Mobile strip", width: 300, height: 50, breakpoint: "mobile", iabName: "Mobile Banner" },
] as const;

export const ensureSizes = defineService({
  name: "ads.ensureSizes",
  writeClass: "write",
  summary: "Make sure the standard ad sizes are present.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: row({ present: z.number().int(), added: z.number().int() }),
  handler: async (_input, ctx) => {
    const inserted = await ctx.tx
      .insert(adSizes)
      .values([...STANDARD_SIZES])
      // Idempotent by the shape index, so this is safe to run on every setup,
      // after a restore, or from an admin button.
      .onConflictDoNothing()
      .returning({ id: adSizes.id });
    const all = await ctx.tx.select({ id: adSizes.id }).from(adSizes);
    return { present: all.length, added: inserted.length };
  },
});

/** Core announces that setup finished; ads answers with its sizes (§11). */
export async function onSetupCompleted(): Promise<void> {
  const { db } = await import("@/core/db");
  await db()
    .insert(adSizes)
    .values([...STANDARD_SIZES])
    .onConflictDoNothing();
}

export const sizes = defineService({
  name: "ads.sizes",
  summary: "The standard ad sizes, by breakpoint.",
  kind: "query",
  permission: "scoped",
  input: z.object({ breakpoint: z.enum(["desktop", "tablet", "mobile"]).optional() }),
  output: listed(sizeRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(adSizes)
      .where(input.breakpoint ? eq(adSizes.breakpoint, input.breakpoint) : undefined)
      .orderBy(asc(adSizes.breakpoint), desc(adSizes.width)),
});

export const addSize = defineService({
  name: "ads.addSize",
  writeClass: "write",
  summary: "Add a size the standard set does not cover.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    label: z.string().trim().min(1).max(80),
    width: z.number().int().min(1).max(4000),
    height: z.number().int().min(1).max(4000),
    breakpoint: z.enum(["desktop", "tablet", "mobile"]),
    iabName: z.string().trim().max(80).nullish(),
  }),
  output: sizeRow,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx
      .insert(adSizes)
      .values({ ...input, iabName: input.iabName ?? null })
      // §4.16 says the set is "seeded, extensible" — adding one that already
      // exists is a duplicate, not an error worth a red screen.
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await ctx.tx
      .select()
      .from(adSizes)
      .where(
        and(
          eq(adSizes.breakpoint, input.breakpoint),
          eq(adSizes.width, input.width),
          eq(adSizes.height, input.height),
        ),
      );
    return existing!;
  },
});

export const saveSlot = defineService({
  name: "ads.saveSlot",
  writeClass: "write",
  summary: "Create or change an ad position.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(1).max(120),
    code: slotCode,
    description: z.string().trim().max(400).nullish(),
    formats: z.array(format).max(3).default([]),
    lazy: z.boolean().default(true),
    refreshSeconds: z.number().int().min(0).max(3600).default(0),
    allowHouseFill: z.boolean().default(true),
    allowThirdParty: z.boolean().default(false),
    status: z.enum(["draft", "active", "retired"]).default("draft"),
  }),
  output: slotRow,
  handler: async (input, ctx) => {
    const clash = await ctx.tx
      .select({ id: adSlots.id })
      .from(adSlots)
      .where(eq(adSlots.code, input.code));
    if (clash.some((each) => each.id !== input.id)) {
      throw new ServiceError(
        "conflict",
        `Another slot already uses the code "${input.code}". A block references a slot by its code, so two would make a page ambiguous.`,
      );
    }

    const values = {
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      formats: input.formats,
      lazy: input.lazy,
      refreshSeconds: input.refreshSeconds,
      allowHouseFill: input.allowHouseFill,
      allowThirdParty: input.allowThirdParty,
      status: input.status,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(adSlots)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(adSlots.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such slot.");
      return updated;
    }
    const [created] = await ctx.tx.insert(adSlots).values(values).returning();
    ctx.setSubject("ad_slot", created!.id);
    return created!;
  },
});

export const slots = defineService({
  name: "ads.slots",
  summary: "Every ad position.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(slotRow),
  handler: (_input, ctx) => ctx.tx.select().from(adSlots).orderBy(asc(adSlots.name)),
});

/**
 * One slot, by the code a block references.
 *
 * Public, and it must be: the block that reserves space renders on the public
 * site for a visitor who is nobody. It returns the shape of the hole and
 * nothing about who has bought it — §4.16's reserved space is a layout fact,
 * not a disclosure.
 */
export const slotByCode = defineService({
  name: "ads.slotByCode",
  summary: "The declared shape of one ad position.",
  kind: "query",
  permission: "public",
  input: z.object({ code: z.string().trim().toLowerCase().max(40) }),
  output: row({
    code: z.string(),
    formats: z.unknown(),
    lazy: z.boolean(),
    refreshSeconds: z.number().int(),
    allowHouseFill: z.boolean(),
  }).nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({
        code: adSlots.code,
        formats: adSlots.formats,
        lazy: adSlots.lazy,
        refreshSeconds: adSlots.refreshSeconds,
        allowHouseFill: adSlots.allowHouseFill,
        status: adSlots.status,
      })
      .from(adSlots)
      .where(eq(adSlots.code, input.code));
    if (!found || found.status !== "active") return null;
    const { status: _status, ...shape } = found;
    return shape;
  },
});

/* ---------------------------------------------------------- advertisers */

const advertiserRow = row({
  id: uuidSchema,
  contactId: uuidSchema,
  displayName: z.string().nullable(),
  website: z.string().nullable(),
  billingTerms: z.string().nullable(),
});

export const saveAdvertiser = defineService({
  name: "ads.saveAdvertiser",
  writeClass: "write",
  summary: "Record who is buying.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    /** Either an existing contact, or an email to resolve one by (§4.1). */
    contactId: uuidSchema.optional(),
    email: z.string().trim().email().toLowerCase().max(320).optional(),
    name: z.string().trim().max(200).optional(),
    displayName: z.string().trim().max(200).nullish(),
    website: z.string().trim().max(400).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    billingTerms: z.string().trim().max(200).nullish(),
  }),
  output: advertiserRow,
  handler: async (input, ctx) => {
    let contactId = input.contactId ?? null;
    if (!contactId) {
      if (!input.email) {
        throw new ServiceError("validation", "An advertiser needs a contact or an email.");
      }
      // An advertiser is a Contact like everyone else, and this is an
      // automated path, so `contacts.resolve` and never `contacts.create`.
      const { contact } = await ctx.callAsSystem(resolveContact, {
        email: input.email,
        name: input.name ?? input.displayName ?? undefined,
        source: "advertiser",
      });
      contactId = contact.id;
    }

    const values = {
      displayName: input.displayName ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      billingTerms: input.billingTerms ?? null,
    };
    const [existing] = await ctx.tx
      .select({ id: advertisers.id })
      .from(advertisers)
      .where(eq(advertisers.contactId, contactId));
    if (existing) {
      const [updated] = await ctx.tx
        .update(advertisers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(advertisers.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await ctx.tx
      .insert(advertisers)
      .values({ contactId, ...values })
      .returning();
    return created!;
  },
});

export const advertiserList = defineService({
  name: "ads.advertisers",
  summary: "Everybody buying inventory.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(advertiserRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(advertisers).orderBy(desc(advertisers.createdAt)),
});

/* ------------------------------------------------------------ campaigns */

const campaignRow = row({
  id: uuidSchema,
  advertiserContactId: uuidSchema,
  name: z.string(),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  status: z.enum(["draft", "scheduled", "live", "paused", "completed"]),
  pricing: z.enum(["cpm", "cpc", "flat", "house"]),
  rateCents: z.number().int(),
  budgetCents: z.number().int().nullable(),
  pacing: z.enum(["even", "asap"]),
  invoiceId: uuidSchema.nullable(),
  priority: z.number().int(),
  approvalState: z.enum(["none", "pending", "approved", "rejected"]),
});

export const saveCampaign = defineService({
  name: "ads.saveCampaign",
  writeClass: "write",
  summary: "Create or change a campaign.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    advertiserContactId: uuidSchema,
    name: z.string().trim().min(1).max(160),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    pricing: z.enum(["cpm", "cpc", "flat", "house"]).default("house"),
    rateCents: z.number().int().min(0).max(100000000).default(0),
    budgetCents: z.number().int().min(0).max(1000000000).nullish(),
    pacing: z.enum(["even", "asap"]).default("even"),
    invoiceId: uuidSchema.nullish(),
    priority: z.number().int().min(0).max(1000).default(0),
  }),
  output: campaignRow,
  handler: async (input, ctx) => {
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw new ServiceError("validation", "A campaign cannot end before it starts.");
    }
    const values = {
      advertiserContactId: input.advertiserContactId,
      name: input.name,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      pricing: input.pricing,
      rateCents: input.rateCents,
      budgetCents: input.budgetCents ?? null,
      pacing: input.pacing,
      invoiceId: input.invoiceId ?? null,
      priority: input.priority,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(adCampaigns)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(adCampaigns.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such campaign.");
      return updated;
    }
    const [created] = await ctx.tx.insert(adCampaigns).values(values).returning();
    ctx.setSubject("ad_campaign", created!.id);
    ctx.queueEvent("ads.campaignCreated", { campaignId: created!.id });
    return created!;
  },
});

export const decideCampaign = defineService({
  name: "ads.decideCampaign",
  writeClass: "write",
  summary: "Approve or reject a campaign before it may run.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(1000).nullish(),
  }),
  output: campaignRow,
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(adCampaigns)
      .set({
        approvalState: input.decision,
        approvalNote: input.note ?? null,
        approvedBy: actorString(ctx.actor),
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adCampaigns.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "There is no such campaign.");
    ctx.queueEvent("ads.campaignDecided", { campaignId: updated.id, decision: input.decision });
    return updated;
  },
});

export const setCampaignStatus = defineService({
  name: "ads.setCampaignStatus",
  writeClass: "write",
  summary: "Move a campaign between draft, scheduled, live, paused and completed.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    status: z.enum(["draft", "scheduled", "live", "paused", "completed"]),
  }),
  output: campaignRow,
  handler: async (input, ctx) => {
    const [campaign] = await ctx.tx
      .select()
      .from(adCampaigns)
      .where(eq(adCampaigns.id, input.id));
    if (!campaign) throw new ServiceError("not_found", "There is no such campaign.");

    // The approval gate. A campaign somebody is paying for must not go live
    // because a status field was changed — and a house promotion is the
    // owner's own, so it needs nobody's approval but theirs.
    if (
      input.status === "live" &&
      campaign.pricing !== "house" &&
      campaign.approvalState !== "approved"
    ) {
      throw new ServiceError(
        "validation",
        "This campaign has not been approved, so it cannot go live.",
      );
    }

    const [updated] = await ctx.tx
      .update(adCampaigns)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(adCampaigns.id, input.id))
      .returning();
    ctx.queueEvent("ads.campaignStatusChanged", { campaignId: input.id, status: input.status });
    return updated!;
  },
});

export const campaigns = defineService({
  name: "ads.campaigns",
  summary: "Campaigns, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    advertiserContactId: uuidSchema.optional(),
    status: z.enum(["draft", "scheduled", "live", "paused", "completed"]).optional(),
  }),
  output: listed(campaignRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(adCampaigns)
      .where(
        and(
          input.advertiserContactId
            ? eq(adCampaigns.advertiserContactId, input.advertiserContactId)
            : undefined,
          input.status ? eq(adCampaigns.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(adCampaigns.createdAt)),
});

/* ----------------------------------------------------------- line items */

const lineItemRow = row({
  id: uuidSchema,
  campaignId: uuidSchema,
  name: z.string(),
  slotIds: z.unknown(),
  targeting: z.unknown(),
  dayparting: z.unknown(),
  frequencyCap: z.number().int().nullable(),
  frequencyPeriodHours: z.number().int(),
  goalImpressions: z.number().int().nullable(),
  goalClicks: z.number().int().nullable(),
  weight: z.number().int(),
  status: z.enum(["draft", "active", "paused", "completed"]),
});

export const saveLineItem = defineService({
  name: "ads.saveLineItem",
  writeClass: "write",
  summary: "Say what runs where, when and how often.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    campaignId: uuidSchema,
    name: z.string().trim().min(1).max(160),
    slotIds: z.array(uuidSchema).min(1).max(50),
    targeting: z
      .object({
        locales: z.array(z.string().trim().max(20)).max(20).optional(),
        countries: z.array(z.string().trim().length(2).toUpperCase()).max(50).optional(),
        devices: z.array(z.enum(["desktop", "tablet", "mobile"])).max(3).optional(),
        pathPatterns: z.array(z.string().trim().max(200)).max(50).optional(),
        referrers: z.array(z.string().trim().max(200)).max(50).optional(),
      })
      .default({}),
    dayparting: z
      .object({
        days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        fromMinute: z.number().int().min(0).max(1439).optional(),
        toMinute: z.number().int().min(0).max(1439).optional(),
      })
      .default({}),
    frequencyCap: z.number().int().min(1).max(1000).nullish(),
    frequencyPeriodHours: z.number().int().min(1).max(720).default(24),
    goalImpressions: z.number().int().min(1).max(1000000000).nullish(),
    goalClicks: z.number().int().min(1).max(100000000).nullish(),
    weight: z.number().int().min(1).max(1000).default(1),
    status: z.enum(["draft", "active", "paused", "completed"]).default("draft"),
  }),
  output: lineItemRow,
  handler: async (input, ctx) => {
    const [campaign] = await ctx.tx
      .select({ id: adCampaigns.id })
      .from(adCampaigns)
      .where(eq(adCampaigns.id, input.campaignId));
    if (!campaign) throw new ServiceError("not_found", "There is no such campaign.");

    // Every named slot must exist. A line item pointing at a slot that does
    // not is one that will never run, and the owner's only symptom would be
    // an advertiser asking why they saw no impressions.
    const found = await ctx.tx
      .select({ id: adSlots.id })
      .from(adSlots)
      .where(inArray(adSlots.id, input.slotIds));
    if (found.length !== input.slotIds.length) {
      throw new ServiceError("validation", "One of those ad positions does not exist.");
    }

    const values = {
      campaignId: input.campaignId,
      name: input.name,
      slotIds: input.slotIds,
      targeting: input.targeting,
      dayparting: input.dayparting,
      frequencyCap: input.frequencyCap ?? null,
      frequencyPeriodHours: input.frequencyPeriodHours,
      goalImpressions: input.goalImpressions ?? null,
      goalClicks: input.goalClicks ?? null,
      weight: input.weight,
      status: input.status,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(adLineItems)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(adLineItems.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such line item.");
      return updated;
    }
    const [created] = await ctx.tx.insert(adLineItems).values(values).returning();
    return created!;
  },
});

export const lineItems = defineService({
  name: "ads.lineItems",
  summary: "Line items for a campaign.",
  kind: "query",
  permission: "scoped",
  input: z.object({ campaignId: uuidSchema }),
  output: listed(lineItemRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(adLineItems)
      .where(eq(adLineItems.campaignId, input.campaignId))
      .orderBy(desc(adLineItems.weight), asc(adLineItems.name)),
});


/* ----------------------------------------------------------- creatives */

/**
 * §4.16 bounds this module by editorial honesty, and the label is only half
 * of that. The other half is that an approved creative stays the creative
 * that was approved — so a paid creative returns to `pending` on every edit,
 * and a swapped image stops serving until somebody looks at it again.
 */
const creativeRow = row({
  id: uuidSchema,
  lineItemId: uuidSchema,
  kind: z.enum(["image", "native"]),
  assetId: uuidSchema.nullable(),
  width: z.number().int(),
  height: z.number().int(),
  clickUrl: z.string(),
  altText: z.string().nullable(),
  headline: z.string().nullable(),
  body: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  status: z.enum(["draft", "active", "paused"]),
  reviewState: z.enum(["pending", "approved", "rejected"]),
  reviewNote: z.string().nullable(),
});

/** The stored jsonb, read defensively — it is owner-editable. */
function declaredFormats(value: unknown): Array<{
  breakpoint: "desktop" | "tablet" | "mobile";
  sizes: DeclaredSize[];
}> {
  const parsed = z
    .array(
      z.object({
        breakpoint: z.enum(["desktop", "tablet", "mobile"]),
        sizes: z.array(z.object({ width: z.number().int(), height: z.number().int() })),
      }),
    )
    .safeParse(value);
  return parsed.success ? parsed.data.filter((format) => format.sizes.length > 0) : [];
}

export const saveCreative = defineService({
  name: "ads.saveCreative",
  writeClass: "write",
  summary: "Create or change the artwork a line item runs.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    lineItemId: uuidSchema,
    kind: z.enum(["image", "native"]).default("image"),
    assetId: uuidSchema.nullish(),
    width: z.number().int().min(1).max(4000),
    height: z.number().int().min(1).max(4000),
    clickUrl: z.string().trim().max(2000),
    altText: z.string().trim().max(300).nullish(),
    headline: z.string().trim().max(200).nullish(),
    body: z.string().trim().max(600).nullish(),
    ctaLabel: z.string().trim().max(60).nullish(),
    status: z.enum(["draft", "active", "paused"]).default("draft"),
  }),
  output: creativeRow,
  handler: async (input, ctx) => {
    // Everything that can refuse is read before anything is written. A failed
    // statement aborts the whole transaction, so a refusal discovered by
    // trying it is a refusal that cannot be recorded or explained.
    const [line] = await ctx.tx
      .select({
        id: adLineItems.id,
        slotIds: adLineItems.slotIds,
        pricing: adCampaigns.pricing,
      })
      .from(adLineItems)
      .innerJoin(adCampaigns, eq(adLineItems.campaignId, adCampaigns.id))
      .where(eq(adLineItems.id, input.lineItemId));
    if (!line) throw new ServiceError("not_found", "There is no such line item.");

    const destination = safeClickUrl(input.clickUrl);
    if (!destination) {
      throw new ServiceError(
        "validation",
        "A click-through needs a full web address starting http:// or https://.",
      );
    }

    if (input.kind === "image") {
      if (!input.assetId) {
        throw new ServiceError("validation", "Pick the image this ad shows.");
      }
      // §5 requires alt text on every public image, and an ad is no
      // exception — a sponsor's banner with no alt text is a page a screen
      // reader cannot describe.
      if (!input.altText) {
        throw new ServiceError(
          "validation",
          "Describe the image, for anyone who cannot see it.",
        );
      }
    } else if (!input.headline) {
      throw new ServiceError("validation", "A text ad needs a headline.");
    }

    // The size must be one the slots this line item runs in actually declare.
    // Otherwise the creative is unservable and the owner's only symptom is an
    // advertiser asking why they saw no impressions — the same failure C9.17
    // refuses a line item for.
    const slotIds = z.array(uuidSchema).safeParse(line.slotIds);
    const slotRows =
      slotIds.success && slotIds.data.length > 0
        ? await ctx.tx
            .select({ formats: adSlots.formats })
            .from(adSlots)
            .where(inArray(adSlots.id, slotIds.data))
        : [];
    const declared = slotRows
      .flatMap((slot) => declaredFormats(slot.formats))
      .flatMap((format) => format.sizes);
    if (!declared.some((size) => size.width === input.width && size.height === input.height)) {
      throw new ServiceError(
        "validation",
        `None of this line item's positions accepts a ${input.width}×${input.height} ad, so it could never run.`,
      );
    }

    // A house promotion is the owner's own, so making it is the approval —
    // recorded against them rather than waived, so the trail still says who.
    // Anything sold goes back to pending on every edit: §4.16's rule is that
    // "a creative cannot be swapped for a different target after approval",
    // and an edit is exactly that swap.
    const house = line.pricing === "house";
    const values: typeof adCreatives.$inferInsert = {
      lineItemId: input.lineItemId,
      kind: input.kind,
      assetId: input.assetId ?? null,
      width: input.width,
      height: input.height,
      clickUrl: destination,
      altText: input.altText ?? null,
      headline: input.headline ?? null,
      body: input.body ?? null,
      ctaLabel: input.ctaLabel ?? null,
      status: input.status,
      reviewState: house ? "approved" : "pending",
      reviewNote: null,
      reviewedBy: house ? actorString(ctx.actor) : null,
      reviewedAt: house ? new Date() : null,
    };

    if (input.id) {
      const [updated] = await ctx.tx
        .update(adCreatives)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(adCreatives.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such creative.");
      ctx.setSubject("ad_creative", updated.id);
      return updated;
    }
    const [created] = await ctx.tx.insert(adCreatives).values(values).returning();
    ctx.setSubject("ad_creative", created!.id);
    return created!;
  },
});

export const reviewCreative = defineService({
  name: "ads.reviewCreative",
  writeClass: "write",
  summary: "Approve or reject the artwork before it may appear.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(1000).nullish(),
  }),
  output: creativeRow,
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(adCreatives)
      .set({
        reviewState: input.decision,
        reviewNote: input.note ?? null,
        reviewedBy: actorString(ctx.actor),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adCreatives.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "There is no such creative.");
    ctx.queueEvent("ads.creativeReviewed", {
      creativeId: updated.id,
      decision: input.decision,
    });
    return updated;
  },
});

export const creatives = defineService({
  name: "ads.creatives",
  summary: "The artwork booked against a campaign.",
  kind: "query",
  permission: "scoped",
  input: z.object({ campaignId: uuidSchema }),
  output: listed(creativeRow),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: adCreatives.id,
        lineItemId: adCreatives.lineItemId,
        kind: adCreatives.kind,
        assetId: adCreatives.assetId,
        width: adCreatives.width,
        height: adCreatives.height,
        clickUrl: adCreatives.clickUrl,
        altText: adCreatives.altText,
        headline: adCreatives.headline,
        body: adCreatives.body,
        ctaLabel: adCreatives.ctaLabel,
        status: adCreatives.status,
        reviewState: adCreatives.reviewState,
        reviewNote: adCreatives.reviewNote,
      })
      .from(adCreatives)
      .innerJoin(adLineItems, eq(adCreatives.lineItemId, adLineItems.id))
      .where(eq(adLineItems.campaignId, input.campaignId))
      .orderBy(desc(adCreatives.createdAt)),
});

/* --------------------------------------------------------- the serving */

const servedCreative = row({
  id: uuidSchema,
  kind: z.enum(["image", "native"]),
  assetId: uuidSchema.nullable(),
  altText: z.string().nullable(),
  headline: z.string().nullable(),
  body: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  /**
   * Always first-party, always signed. The advertiser's own URL is never in
   * the page: §4.16 wants the count and the destination unable to disagree,
   * and a second, unsigned way out of the page is exactly that disagreement.
   */
  href: z.string(),
  /**
   * What the visible label says. There is no third value and no way to turn
   * it off — §4.16: "there is no configuration that removes the label".
   */
  label: z.enum(["sponsored", "house"]),
});

/**
 * What the visible label says. §4.16 allows exactly two answers and no way to
 * suppress either, so this is the only place the words are decided.
 */
function labelFor(house: boolean): "house" | "sponsored" {
  return house ? "house" : "sponsored";
}

/**
 * What to draw in this slot, at every breakpoint it declares.
 *
 * One call per placement rather than one per breakpoint, and no device
 * detection anywhere. §4.16 asks that "one placement serves a leaderboard on a
 * laptop and a 320×50 on a phone without the owner building two pages", and
 * the platform already refuses to derive anything from the visitor's device
 * (see `analytics/visitor.ts`). So the server answers for every breakpoint the
 * slot declares and CSS picks between them — which also means the reserved
 * space is correct before a byte of JavaScript runs, which is the Core Web
 * Vitals promise §36 makes on core's behalf.
 */
export const serve = defineService({
  name: "ads.serve",
  summary: "The ad to draw in one position, per breakpoint.",
  kind: "query",
  permission: "public",
  input: z.object({
    code: z.string().trim().toLowerCase().max(40),
    path: z.string().trim().max(2000).default("/"),
    locale: z.string().trim().max(20).default("en"),
    country: z.string().trim().length(2).toUpperCase().nullish(),
    referrer: z.string().trim().max(2000).nullish(),
  }),
  output: row({
    code: z.string(),
    lazy: z.boolean(),
    fills: listed(
      row({
        breakpoint: z.enum(["desktop", "tablet", "mobile"]),
        width: z.number().int(),
        height: z.number().int(),
        creative: servedCreative.nullable(),
      }),
    ),
  }).nullable(),
  handler: async (input, ctx) => {
    const [slot] = await ctx.tx.select().from(adSlots).where(eq(adSlots.code, input.code));
    if (!slot || slot.status !== "active") return null;
    const formats = declaredFormats(slot.formats);
    if (formats.length === 0) return null;

    // Everything that could run anywhere, in one pass: a live campaign's
    // active line items with approved, active artwork. Which of them actually
    // runs is decided in `select.ts`, where it can be tested without a
    // database — deciding between two advertisers is the part they dispute.
    const rows = await ctx.tx
      .select({
        lineItemId: adLineItems.id,
        campaignId: adCampaigns.id,
        pricing: adCampaigns.pricing,
        priority: adCampaigns.priority,
        weight: adLineItems.weight,
        startsAt: adCampaigns.startsAt,
        endsAt: adCampaigns.endsAt,
        slotIds: adLineItems.slotIds,
        targeting: adLineItems.targeting,
        dayparting: adLineItems.dayparting,
        creativeId: adCreatives.id,
        kind: adCreatives.kind,
        assetId: adCreatives.assetId,
        width: adCreatives.width,
        height: adCreatives.height,
        clickUrl: adCreatives.clickUrl,
        altText: adCreatives.altText,
        headline: adCreatives.headline,
        body: adCreatives.body,
        ctaLabel: adCreatives.ctaLabel,
      })
      .from(adCreatives)
      .innerJoin(adLineItems, eq(adCreatives.lineItemId, adLineItems.id))
      .innerJoin(adCampaigns, eq(adLineItems.campaignId, adCampaigns.id))
      .where(
        and(
          eq(adCreatives.status, "active"),
          // The editorial gate, in the hot path rather than in a comment.
          eq(adCreatives.reviewState, "approved"),
          eq(adLineItems.status, "active"),
          eq(adCampaigns.status, "live"),
        ),
      );

    const byLineItem = new Map<string, Candidate>();
    for (const each of rows) {
      const ids = z.array(uuidSchema).safeParse(each.slotIds);
      if (!ids.success || !ids.data.includes(slot.id)) continue;
      const candidate: Candidate = byLineItem.get(each.lineItemId) ?? {
        lineItemId: each.lineItemId,
        campaignId: each.campaignId,
        house: each.pricing === "house",
        priority: each.priority,
        weight: each.weight,
        startsAt: each.startsAt,
        endsAt: each.endsAt,
        // Read straight from jsonb: `matchesTargeting` and `withinDaypart`
        // both treat anything they do not recognise as an unstated condition,
        // which is the only safe reading of a field an owner can edit.
        targeting: each.targeting ?? {},
        dayparting: each.dayparting ?? {},
        creatives: [],
      };
      candidate.creatives.push({
        id: each.creativeId,
        kind: each.kind,
        assetId: each.assetId,
        width: each.width,
        height: each.height,
        clickUrl: each.clickUrl,
        altText: each.altText,
        headline: each.headline,
        body: each.body,
        ctaLabel: each.ctaLabel,
      });
      byLineItem.set(each.lineItemId, candidate);
    }
    const candidates = [...byLineItem.values()];

    const business = await ctx.call(getBusiness, {});
    const now = new Date();
    const clock = zonedClock(now, business?.timezone ?? "UTC");
    const issuedAt = Math.floor(now.getTime() / 1000);

    const fills = formats.map((format) => {
      const context: ServeContext = {
        locale: input.locale,
        country: input.country ?? null,
        device: format.breakpoint,
        path: input.path,
        referrer: input.referrer ?? null,
        minuteOfDay: clock.minuteOfDay,
        dayOfWeek: clock.dayOfWeek,
      };
      const chosen = chooseFill(candidates, format.sizes, context, {
        now,
        allowHouseFill: slot.allowHouseFill,
        roll: Math.random(),
        creativeRoll: Math.random(),
      });
      const reserved = chosen
        ? { width: chosen.creative.width, height: chosen.creative.height }
        : format.sizes[0]!;
      return {
        breakpoint: format.breakpoint,
        width: reserved.width,
        height: reserved.height,
        creative: chosen
          ? {
              id: chosen.creative.id,
              kind: chosen.creative.kind,
              assetId: chosen.creative.assetId,
              altText: chosen.creative.altText,
              headline: chosen.creative.headline,
              body: chosen.creative.body,
              ctaLabel: chosen.creative.ctaLabel,
              href: clickPath(
                signClickToken({
                  creativeId: chosen.creative.id,
                  url: chosen.creative.clickUrl,
                  issuedAt,
                }),
              ),
              label: labelFor(chosen.candidate.house),
            }
          : null,
      };
    });

    return { code: slot.code, lazy: slot.lazy, fills };
  },
});

/**
 * Count the click, then say where to send them (§4.16).
 *
 * The order in that sentence is the contract: this records first and hands
 * back a destination second, so there is no path through the code that sends
 * a visitor onward without the click having been counted.
 *
 * It is also this module's one untrusted public surface, so it treats the
 * token as hostile: the signature is verified before anything is read, the
 * destination comes from the row rather than from the request, and the two
 * must agree. A token whose URL no longer matches the creative's is refused
 * rather than followed — that is §4.16's "a creative cannot be swapped for a
 * different target after approval", enforced at the moment it would matter.
 */
export const recordClick = defineService({
  name: "ads.recordClick",
  writeClass: "write",
  summary: "Count an ad click and resolve where it goes.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    token: z.string().trim().min(1).max(2000),
    /** Supplied only when analytics policy permits identifiers at all. */
    anonId: z.string().trim().min(1).max(64).nullish(),
    sessionId: z.string().trim().min(1).max(64).nullish(),
    path: z.string().trim().max(2000).default("/"),
  }),
  rateLimit: {
    limit: 120,
    windowSeconds: 10 * 60,
    // Per link, not per visitor: there is no identity here we are willing to
    // rely on, and one link being hammered is the shape of the abuse.
    subject: (input) => `token:${input.token.slice(0, 40)}`,
    message: "That ad link has been followed a great many times just now.",
  },
  output: row({ url: z.string() }),
  handler: async (input, ctx) => {
    const claim = verifyClickToken(input.token, Math.floor(Date.now() / 1000));
    if (!claim) {
      throw new ServiceError("validation", "That ad link is not valid, or it has expired.");
    }

    const [creative] = await ctx.tx
      .select({
        id: adCreatives.id,
        clickUrl: adCreatives.clickUrl,
        lineItemId: adCreatives.lineItemId,
        campaignId: adLineItems.campaignId,
      })
      .from(adCreatives)
      .innerJoin(adLineItems, eq(adCreatives.lineItemId, adLineItems.id))
      .where(eq(adCreatives.id, claim.creativeId));
    if (!creative) throw new ServiceError("not_found", "That ad is no longer running.");

    if (creative.clickUrl !== claim.url) {
      throw new ServiceError(
        "conflict",
        "This ad's destination changed after it was shown, so the click was not followed.",
      );
    }
    // Checked again here rather than trusted from the row: a destination
    // written before this rule existed, or edited straight in SQL, must not
    // become a redirect the owner's own domain vouches for.
    const destination = safeClickUrl(creative.clickUrl);
    if (!destination) {
      throw new ServiceError("validation", "That ad's destination is not a web address.");
    }

    // §4.16 measures through first-party analytics (§4.7), so a click joins
    // the same ledger as everything else and C9.19's rollup reads it there
    // rather than from a counter only this module understands. No identifiers
    // means policy refused collection at the edge; the visitor still travels.
    if (input.anonId && input.sessionId) {
      await ctx.call(track, {
        anonId: input.anonId,
        sessionId: input.sessionId,
        name: "ad.click",
        // A double-click, a prefetch and a retried request are the same click
        // within a minute; a genuine second visit an hour later is not.
        eventKey: `ad.click:${input.anonId}:${creative.id}:${Math.floor(Date.now() / 60_000)}`,
        path: input.path,
        props: {
          creativeId: creative.id,
          lineItemId: creative.lineItemId,
          campaignId: creative.campaignId,
        },
      });
    }

    return { url: destination };
  },
});

/* ------------------------------------------------------ the money path */

/**
 * Raise the invoice for a sold campaign (§4.16).
 *
 * "Selling an ad is selling a product. `AdCampaign.invoice_id` ties a sale to
 * the same invoicing, tax and reporting path as everything else." So this
 * raises an ordinary invoice against an ordinary contact, and the advertiser's
 * pitch, quote, invoice and last year's campaign end up on one timeline.
 *
 * A *draft*, deliberately, and never issued here. Issuing allocates a gapless
 * number and settles a tax treatment, and this module has no addresses to
 * calculate one from — guessing a tax treatment on somebody's behalf is the
 * one thing an accounting system must not do. The owner issues it from the
 * invoice, where the question is asked properly.
 */
export const invoiceCampaign = defineService({
  name: "ads.invoiceCampaign",
  writeClass: "money",
  summary: "Raise the invoice for a sold campaign.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({
    invoiceId: uuidSchema,
    amountMinor: z.number().int(),
    currency: z.string(),
  }),
  handler: async (input, ctx) => {
    // Every refusal below is read before the first write. A failed statement
    // aborts the transaction, so "try it and then record that it failed" is
    // not something this can do.
    const [campaign] = await ctx.tx
      .select()
      .from(adCampaigns)
      .where(eq(adCampaigns.id, input.id));
    if (!campaign) throw new ServiceError("not_found", "There is no such campaign.");
    if (campaign.pricing === "house") {
      throw new ServiceError(
        "validation",
        "A house promotion is your own, so there is nobody to invoice.",
      );
    }
    if (campaign.invoiceId) {
      throw new ServiceError("conflict", "This campaign has already been invoiced.");
    }
    if (campaign.approvalState !== "approved") {
      throw new ServiceError(
        "validation",
        "Approve the campaign before invoicing it — the sale comes before the bill.",
      );
    }
    if (!listServices().has("invoicing.createDraft")) {
      throw new ServiceError("validation", "Invoicing is switched off, so nothing was raised.");
    }

    const lines = await ctx.tx
      .select({
        goalImpressions: adLineItems.goalImpressions,
        goalClicks: adLineItems.goalClicks,
      })
      .from(adLineItems)
      .where(eq(adLineItems.campaignId, input.id));
    const goalImpressions = lines.reduce((sum, line) => sum + (line.goalImpressions ?? 0), 0);
    const goalClicks = lines.reduce((sum, line) => sum + (line.goalClicks ?? 0), 0);

    // The booked value of the buy, computed the way the campaign was priced.
    // A per-thousand campaign is invoiced against what was *sold*: what was
    // delivered is not known until it has run, and reconciling the two
    // against this same invoice is C9.19's job.
    const amountMinor =
      campaign.pricing === "flat"
        ? campaign.rateCents
        : campaign.pricing === "cpm"
          ? Math.round((campaign.rateCents * goalImpressions) / 1000)
          : campaign.rateCents * goalClicks;
    if (amountMinor <= 0) {
      throw new ServiceError(
        "validation",
        campaign.pricing === "cpm"
          ? "Set a rate and an impression goal before invoicing a per-thousand campaign; there is nothing to bill against."
          : campaign.pricing === "cpc"
            ? "Set a rate and a click goal before invoicing a per-click campaign; there is nothing to bill against."
            : "Set a rate before invoicing this campaign.",
      );
    }

    const business = await ctx.call(getBusiness, {});
    const currency = business?.baseCurrency;
    if (!currency) {
      throw new ServiceError("validation", "Set your currency in settings before invoicing.");
    }

    // Resolved by name rather than imported: §4.16's `invoice_id` is a plain
    // column and not a foreign key precisely because an instance that only
    // ever runs house promotions need not install invoicing at all.
    const draft = (await ctx.call(getService("invoicing.createDraft"), {
      contactId: campaign.advertiserContactId,
      currency,
      sourceType: "ad_campaign",
      sourceId: campaign.id,
      // Stable per campaign, so a retry never raises a second invoice.
      idempotencyKey: `ads:campaign:${campaign.id}`,
      lines: [
        {
          description:
            campaign.pricing === "cpm"
              ? `${campaign.name} — ${goalImpressions} impressions`
              : campaign.pricing === "cpc"
                ? `${campaign.name} — ${goalClicks} clicks`
                : campaign.name,
          quantityMicros: 1_000_000,
          unitAmountMinor: amountMinor,
        },
      ],
      tax: {
        mode: "not_applicable",
        reason: `Advertising campaign ${campaign.name}; tax applied when issued.`,
      },
    })) as { invoice: { id: string } };

    await ctx.tx
      .update(adCampaigns)
      .set({ invoiceId: draft.invoice.id, updatedAt: new Date() })
      .where(eq(adCampaigns.id, campaign.id));
    ctx.setSubject("ad_campaign", campaign.id);
    ctx.queueEvent("ads.campaignInvoiced", {
      campaignId: campaign.id,
      invoiceId: draft.invoice.id,
    });
    return { invoiceId: draft.invoice.id, amountMinor, currency };
  },
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "advertisers",
  // An advertiser row is one per contact, so merging two who both advertise
  // would collide. The survivor's record wins and the duplicate's is dropped:
  // the fields are a display name and billing terms, and two answers to
  // "what shall we call them on the invoice" is one answer too many.
  repoint: async (tx, duplicateId, survivingId) => {
    const [survivor] = await tx
      .select({ id: advertisers.id })
      .from(advertisers)
      .where(eq(advertisers.contactId, survivingId));
    if (survivor) {
      await tx.delete(advertisers).where(eq(advertisers.contactId, duplicateId));
      return;
    }
    await tx
      .update(advertisers)
      .set({ contactId: survivingId })
      .where(eq(advertisers.contactId, duplicateId));
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select()
      .from(advertisers)
      .where(eq(advertisers.contactId, duplicateId));
    const [theirs] = await tx
      .select({ id: advertisers.id })
      .from(advertisers)
      .where(eq(advertisers.contactId, survivingId));
    return {
      state: { rows: mine },
      // Dropping a row cannot be undone by moving one back, so only the
      // repoint case is reversible. Same reasoning as loyalty's ledger.
      undoable: !(mine.length > 0 && theirs),
    };
  },
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const parsed = z
      .object({ rows: z.array(z.object({ id: z.string().uuid() })) })
      .parse(beforeState);
    for (const each of parsed.rows) {
      await tx
        .update(advertisers)
        .set({ contactId: duplicateId })
        .where(eq(advertisers.id, each.id));
    }
  },
});

registerContactReference({
  table: "ad_campaigns",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(adCampaigns)
      .set({ advertiserContactId: survivingId })
      .where(eq(adCampaigns.advertiserContactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select({ id: adCampaigns.id })
      .from(adCampaigns)
      .where(eq(adCampaigns.advertiserContactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(adCampaigns)
        .set({ advertiserContactId: duplicateId })
        .where(eq(adCampaigns.id, each.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.ads",
  tables: ["advertisers", "ad_campaigns"],
  exportData: async (tx, contactId) => ({
    advertiser: await tx.select().from(advertisers).where(eq(advertisers.contactId, contactId)),
    campaigns: await tx
      .select()
      .from(adCampaigns)
      .where(eq(adCampaigns.advertiserContactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // The advertiser record goes; the campaigns stay, because a campaign is a
    // sale with an invoice against it and §4.16 ties it to "the same
    // invoicing, tax and reporting path as everything else" — business
    // records a jurisdiction requires the owner to keep are not the
    // individual's to erase. The name goes with the contact.
    const removed = await tx
      .delete(advertisers)
      .where(eq(advertisers.contactId, contactId))
      .returning({ id: advertisers.id });
    return { affected: removed.length };
  },
});

export default [
  sizes,
  ensureSizes,
  addSize,
  saveSlot,
  slots,
  slotByCode,
  saveAdvertiser,
  advertiserList,
  saveCampaign,
  decideCampaign,
  setCampaignStatus,
  campaigns,
  saveLineItem,
  lineItems,
  saveCreative,
  reviewCreative,
  creatives,
  serve,
  recordClick,
  invoiceCampaign,
];
