// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Share targets and tracked short links (MASTER.md §34, C9.28).
//
// §34's first sentence is the one this schema is shaped by: "Sharing isn't a
// buttons plugin; it's a property of every entity with a public face."
//
// A property, not a record. So there is deliberately no row per shareable
// thing: the set of things with a public face is already answered once, by the
// SEO entity registry every module feeds (`core/seo/entities.ts`), and a second
// list would drift from it the first time somebody published a product. A
// `share_targets` row exists only where an owner has *said something* about an
// entity — turned sharing off, or given it a headline for social that differs
// from the one search sees. Absence of a row means "shareable, described by the
// page itself", which is what "present by default, removable per entity" means
// when written down as data.
//
// The one thing that is a record is the act of sharing. `shared_links` is
// append-only in practice and deliberately not deduplicated: one row is one
// person deciding to send one thing to one channel, which is exactly the
// sentence §34 promises an owner ("this gallery was shared 12 times"). Reusing
// a row would make that count "how many distinct ways it could be shared",
// which is a number nobody asked for.
//
// What is *not* here is any click counter. §34 wants clicks to "land as
// analytics events attributed to the share", and the platform already counts
// visits, sessions and campaign conversions. A `clicks` column here would be a
// second set of numbers that disagrees with the traffic report the moment
// somebody declines analytics — so the redirect carries a campaign instead and
// the answer comes from the one ledger that already exists.
import { pgTable, boolean, index, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * What an owner has said about sharing one public entity (§34).
 *
 * Keyed by `path` + `locale` rather than by a foreign key to some entity
 * table, because the entities are owned by a dozen modules and the only thing
 * they all agree on is the URL. That is the same key the sitemap, the OG route
 * and the canonical tag use, so a share target cannot describe a URL the rest
 * of the platform does not publish.
 */
export const shareTargets = pgTable(
  "share_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The registry's kind: page, product, gallery, event… Display only. */
    entityKind: text("entity_kind").notNull().default("page"),
    /** Public path, no leading slash. "" is the home page. */
    path: text("path").notNull(),
    locale: text("locale").notNull().default("en"),
    /**
     * The control, and the only one that has to be *enforced*.
     *
     * A stored `false` that nothing reads would be worse than no column at
     * all: an owner would believe they had switched sharing off. So it is read
     * in four places — the public share bar, minting a link, resolving a
     * short link, and the generated social card — and the third of those is
     * the one that matters, because it kills links that are already out in
     * the world rather than only refusing new ones.
     */
    shareable: boolean("shareable").notNull().default(true),
    /**
     * Channels this entity may be shared to. Empty means every channel the
     * instance offers, which is the default an owner never has to think about.
     */
    channels: text("channels").array().notNull().default([]),
    /**
     * A headline for social that differs from the one search sees.
     *
     * Separate from `seo.title` because they are answers to different
     * questions — a search result is read by somebody already looking, a
     * shared card is read by somebody who was not — and collapsing them would
     * make improving one quietly worsen the other.
     */
    socialTitle: text("social_title"),
    socialDescription: text("social_description"),
    /** Owner-supplied card. Null means the generated one. */
    imageUrl: text("image_url"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One answer per URL per language. Two rows for one path would be two
    // answers to "may this be shared", and the safe one would lose whichever
    // query happened to sort first.
    uniqueIndex("share_targets_path_idx").on(t.path, t.locale),
    index("share_targets_shareable_idx").on(t.shareable),
  ],
);

/**
 * One act of sharing (§34).
 *
 * `sharerContactId` is the spine rule applied to somebody who happens to have
 * passed a link on: a sharer is a Contact like everybody else, nullable
 * because most sharing is done by people the business has never met. It is
 * registered in `contacts.merge` and in the privacy registry from
 * `service.ts` — a column pointing at `contacts.id` that merge does not know
 * about is the silent fork the spine exists to prevent.
 *
 * `ref` is a public identifier, not a credential: it is stored in the clear
 * because anybody holding the link can already follow it, and hashing it would
 * only stop the owner from reading their own report.
 */
export const sharedLinks = pgTable(
  "shared_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => shareTargets.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    channel: text("channel").notNull(),
    sharerContactId: uuid("sharer_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // The whole redirect is a lookup on this, on a public path, so it is
    // unique and it is the index.
    uniqueIndex("shared_links_ref_idx").on(t.ref),
    index("shared_links_target_idx").on(t.targetId, t.createdAt),
    index("shared_links_sharer_idx").on(t.sharerContactId),
  ],
);
