// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One template model for every kind of message (MASTER.md §30, C9.05).
//
// §30: "one template model serves everything — newsletter layouts, campaign
// designs, and transactional emails (receipt, booking confirmation, quote
// sent) are all `EmailTemplate` rows editable in the same drag-and-drop
// editor."
//
// The alternative — a table per kind — is the thing this refuses. A receipt
// and a campaign differ in *when they are sent and to whom*, not in what they
// are made of, and four near-identical tables is four places for the block
// vocabulary, the variable slots and the locale handling to drift apart.
//
// Locale variants are `entity_translations` rows, not columns here. That is
// core's existing mechanism (§4.9) and using it means a template is translated
// by the same screen that translates a page.
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** §30's four, plus SMS — §4.14 sends texts from a template too. */
export const TEMPLATE_KINDS = [
  "transactional",
  "campaign",
  "newsletter",
  "automation",
  "sms",
] as const;

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: TEMPLATE_KINDS }).notNull(),
    name: text("name").notNull(),
    /**
     * The stable name a sender asks for: "invoice.sent", "booking.confirmed".
     *
     * Null for anything an owner made up themselves. A transactional sender
     * needs to find *the* receipt template without knowing its id or trusting
     * its display name, and a name an owner can rename is not an identifier.
     */
    slug: text("slug"),
    subject: text("subject").notNull().default(""),
    /** The same block tree a page uses (§32), rendered by `email-render.ts`. */
    blocks: jsonb("blocks").notNull().default([]),
    /**
     * The slots this template promises to fill.
     *
     * §30 calls them "locked variable slots". Declared rather than inferred
     * from the blocks, because the promise runs the other way: a sender
     * supplies these, and a template that quietly stopped needing one would
     * make the sender's job impossible to check.
     */
    variables: jsonb("variables").notNull().default([]),
    /**
     * The shipped wording, kept alongside the owner's edits.
     *
     * §30 asks for "a 'reset to default' escape hatch", and an escape hatch
     * needs somewhere to escape *to*. Holding the original here rather than in
     * code means reset works on an instance whose release has moved on, and
     * that "has this been customised" is answerable by comparison rather than
     * by a flag somebody has to remember to set.
     */
    defaultBlocks: jsonb("default_blocks"),
    defaultSubject: text("default_subject"),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One template per slug. A sender asking for "invoice.sent" and getting
    // whichever of two rows sorted first is a bug that only shows up in
    // somebody's inbox.
    uniqueIndex("email_templates_slug_idx").on(t.slug).where(sql`${t.slug} is not null`),
    index("email_templates_kind_idx").on(t.kind, t.status),
  ],
);
