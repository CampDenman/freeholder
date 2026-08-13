// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Content translations (MASTER.md §4.9).
//
// §4.9 draws a line the whole i18n design rests on: **UI strings** live in
// message catalogs shipped with the platform and translated by the community,
// while **content** — pages, products, galleries, campaigns — lives here, in
// the owner's database, because only they can write it.
//
// One row per entity per locale, holding the fields that differ. Not a
// duplicate of the entity: a translated page is the same page with different
// words, so its slug, its position in the hierarchy and its publication state
// stay where they are. That is what makes "the French site" the same site
// rather than a parallel one somebody has to keep in step.
import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const entityTranslations = pgTable(
  "entity_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "page", "section", "product" — whatever a module calls its own rows. */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** BCP-47, and never the default locale: that is the entity itself. */
    locale: text("locale").notNull(),
    /** The translated fields. Shape is the entity's business, not core's. */
    fields: jsonb("fields").notNull().default({}),
    /**
     * How much to trust it.
     *
     * §4.9 permits machine drafting and forbids publishing it silently, so the
     * distinction has to survive in the data: `machine` is a draft a human has
     * not seen, and the renderer treats it as absent on the public surface.
     */
    status: text("status", { enum: ["draft", "machine", "reviewed"] })
      .notNull()
      .default("draft"),
    /** "user:<id>", "agent:<key>" — the same actor strings as the audit log. */
    translatedBy: text("translated_by"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("entity_translations_key_idx").on(
      t.entityType,
      t.entityId,
      t.locale,
    ),
    index("entity_translations_locale_idx").on(t.locale, t.entityType),
  ],
);
