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
import { actorString, defineService, ServiceError } from "@/core/service";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { adCampaigns, adLineItems, adSizes, adSlots, advertisers } from "./schema";

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
];
