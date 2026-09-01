// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ad inventory: sizes, slots, advertisers, campaigns and line items
// (MASTER.md §4.16, C9.17).
//
// §4.16 opens by saying who this is for: "a local news site, a newsletter with
// a sponsor, a niche blog with a house ad for its own workshop. They need ad
// slots that behave properly at both breakpoints, a way to sell them, and
// honest numbers — not a Google tag and a hope."
//
// Two of its rules shape this file.
//
// "A slot declares a *set* per breakpoint, so one placement serves a
// leaderboard on a laptop and a 320×50 on a phone without the owner building
// two pages. Reserved space is rendered from the declared size at every
// breakpoint, because an ad that arrives late and pushes the article down is a
// Core Web Vitals failure." So `formats` is per-breakpoint and lives on the
// slot, not on the block that places it — one slot, many pages, one answer
// about how tall to leave the hole.
//
// "`Advertiser` … **A `Contact`**, not a separate customer table." So the
// advertiser row carries a `contact_id` and nothing that duplicates a contact.
// A local business that both advertises and buys prints is one person in this
// system, which is the whole point of the spine (§4.1).
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { assets } from "@/core/media/schema";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * An IAB-standard size, per breakpoint. Seeded, extensible (§4.16).
 *
 * A table rather than a constant because §4.16 says "seeded, extensible": a
 * publisher whose sponsor supplies an odd size should add a row, not wait for
 * a release.
 */
export const adSizes = pgTable(
  "ad_sizes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    breakpoint: text("breakpoint", { enum: ["desktop", "tablet", "mobile"] }).notNull(),
    /** The name the industry uses, so a media pack and this agree. */
    iabName: text("iab_name"),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex("ad_sizes_shape_idx").on(t.breakpoint, t.width, t.height)],
);

/**
 * A named, reusable position.
 *
 * §4.16: "Placed on the page as a block (§32), so where an ad appears is
 * content structure like everything else." The block carries the *code*; this
 * row carries everything else, so moving an ad slot is editing a page and
 * changing what it accepts is editing one row rather than every page it is on.
 */
export const adSlots = pgTable(
  "ad_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** What the block references. Stable; renaming one is a page edit. */
    code: text("code").notNull(),
    description: text("description"),
    /**
     * `[{ breakpoint, sizes: [{ width, height }], ratio? }]`.
     *
     * The set per breakpoint, and the source of the reserved space. jsonb
     * because the shape is a small list an owner edits, not a relation
     * anything joins on.
     */
    formats: jsonb("formats").notNull().default([]),
    lazy: boolean("lazy").notNull().default(true),
    /** Zero means never. A refreshing ad is a choice, not a default. */
    refreshSeconds: integer("refresh_seconds").notNull().default(0),
    /** Unsold inventory shows the owner's own campaign rather than a hole. */
    allowHouseFill: boolean("allow_house_fill").notNull().default(true),
    /**
     * Somebody else's script means somebody else's tracking, so §4.16 makes
     * this off by default and gated behind consent when it is on.
     */
    allowThirdParty: boolean("allow_third_party").notNull().default(false),
    status: text("status", { enum: ["draft", "active", "retired"] })
      .notNull()
      .default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("ad_slots_code_idx").on(t.code),
    index("ad_slots_status_idx").on(t.status),
  ],
);

/** Who is buying — a Contact, never a second customer table (§4.16). */
export const advertisers = pgTable(
  "advertisers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** The name on the media pack, when it differs from the contact's. */
    displayName: text("display_name"),
    website: text("website"),
    notes: text("notes"),
    billingTerms: text("billing_terms"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("advertisers_contact_idx").on(t.contactId)],
);

/**
 * A sale, invoiced through the normal money path (§4.16).
 *
 * `invoiceId` is a plain column rather than a foreign key, because §4.16 says
 * "selling an ad is selling a product" and the invoicing module may not be
 * installed on an instance that only ever runs house promotions. The link is
 * recorded; the dependency is not.
 */
export const adCampaigns = pgTable(
  "ad_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    advertiserContactId: uuid("advertiser_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status", {
      enum: ["draft", "scheduled", "live", "paused", "completed"],
    })
      .notNull()
      .default("draft"),
    pricing: text("pricing", { enum: ["cpm", "cpc", "flat", "house"] })
      .notNull()
      .default("house"),
    rateCents: integer("rate_cents").notNull().default(0),
    budgetCents: integer("budget_cents"),
    pacing: text("pacing", { enum: ["even", "asap"] })
      .notNull()
      .default("even"),
    invoiceId: uuid("invoice_id"),
    /** Higher wins the slot when several line items are eligible. */
    priority: integer("priority").notNull().default(0),
    /**
     * A campaign somebody is paying for should not go live because a field
     * was filled in. §43 C9.17 asks for approvals, and this is the gate: only
     * an approved campaign may be moved to `live`.
     */
    approvalState: text("approval_state", {
      enum: ["none", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("none"),
    approvalNote: text("approval_note"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("ad_campaigns_advertiser_idx").on(t.advertiserContactId),
    index("ad_campaigns_status_idx").on(t.status, t.startsAt),
  ],
);

/** What runs where (§4.16). */
export const adLineItems = pgTable(
  "ad_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Slot ids this may run in. A list, because one creative buys several. */
    slotIds: jsonb("slot_ids").notNull().default([]),
    /** `{ locales[], countries[], devices[], pathPatterns[], referrers[] }`. */
    targeting: jsonb("targeting").notNull().default({}),
    /** `{ days: [0-6], fromMinute, toMinute, timezone }` — the owner's hours. */
    dayparting: jsonb("dayparting").notNull().default({}),
    /** How many times one visitor may see it inside the period. */
    frequencyCap: integer("frequency_cap"),
    frequencyPeriodHours: integer("frequency_period_hours").notNull().default(24),
    goalImpressions: integer("goal_impressions"),
    goalClicks: integer("goal_clicks"),
    /** Relative share among equal-priority line items. */
    weight: integer("weight").notNull().default(1),
    status: text("status", { enum: ["draft", "active", "paused", "completed"] })
      .notNull()
      .default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("ad_line_items_campaign_idx").on(t.campaignId),
    index("ad_line_items_status_idx").on(t.status),
  ],
);

/**
 * The thing rendered (§4.16, C9.18).
 *
 * C9.17 could sell a slot but not fill it. This is what fills it: the owner's
 * own uploaded artwork, a headline and a click URL. §4.16 is explicit that
 * this is the case to get right — "the default inventory is the owner's own …
 * That is the case that must be excellent, because it is how a small
 * publisher runs a sponsor, and how anyone runs a house promotion."
 *
 * Two kinds ship here and no more. `image` is an asset from `core/media`;
 * `native` is text the site's own typography renders, for a newsletter-style
 * sponsor line that should not look like a banner. The `html_tag` and
 * `provider` kinds §4.16 also names carry somebody else's script, which means
 * consent, disclosure and `ads.txt` — that is C9.20's whole subject, and
 * shipping the columns for it now would be storage nothing reads.
 *
 * `width`/`height` are on the creative rather than derived from the asset
 * because the size is a *contract with the slot*: §4.16 reserves the space
 * from the declared size at every breakpoint, and an advertiser who supplied a
 * 1456×182 retina file for a 728×90 leaderboard has still bought a 728×90.
 * `ads.saveCreative` refuses a size none of the line item's slots declares,
 * because a creative that can never be served is one whose only symptom is an
 * advertiser asking why they saw no impressions.
 */
export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lineItemId: uuid("line_item_id")
      .notNull()
      .references(() => adLineItems.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["image", "native"] }).notNull(),
    /**
     * Restricted rather than cascaded: an image somebody is paying to run
     * should not disappear because it was tidied out of the media library.
     * The same choice catalog makes for a product image, for the same reason —
     * money depends on it still rendering.
     */
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "restrict" }),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Absolute http(s), validated on the way in and again on the way out. */
    clickUrl: text("click_url").notNull(),
    altText: text("alt_text"),
    headline: text("headline"),
    body: text("body"),
    ctaLabel: text("cta_label"),
    status: text("status", { enum: ["draft", "active", "paused"] })
      .notNull()
      .default("draft"),
    /**
     * §4.16: "creatives carry a review state". Separate from the campaign's
     * approval, which is the *sale*: an approved advertiser can still send
     * artwork the owner will not print, and one field cannot say both.
     */
    reviewState: text("review_state", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("ad_creatives_line_item_idx").on(t.lineItemId),
    // The serving query's shape: everything eligible, in one pass.
    index("ad_creatives_servable_idx").on(t.status, t.reviewState),
  ],
);
