// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Popups, announcement surfaces and what they did (MASTER.md §36, C9.30).
//
// §36 names the whole category in one line: "**Popups, announcement bars,
// exit-intent** (OptinMonster's category): block-editor-built, frequency-
// capped, targeting rules; newsletter capture wired to §30 consent records."
// Four obligations, and three of them are columns here.
//
// **Block-editor-built.** `blocks` is a block tree (§32), validated against the
// same registry as a page and edited in the same editor. A popup is not a rich
// text field with a border: it is content structure, so re-theming, migrating a
// block type and the accessibility hints all reach it for free.
//
// **Frequency-capped.** `frequency_cap` and its period are the ceiling; the
// count they are compared against lives in `popup_events`, not here. A cap
// cached on the popup would be a per-popup number pretending to be a
// per-visitor one, and the first two visitors would share it.
//
// **Targeting rules.** `segment_id` and nothing that re-implements it. §30
// makes a segment "the unit of who", and C7.17 made every surface adopt it; a
// popup that grew its own audience language would be the second answer to
// "who" that §4.14 names outright as the failure.
//
// The check constraints are the parts a form could otherwise skip: an audience
// mode that names no segment, and — the one that matters — a popup that
// collects an email address with no consent statement to show beside the box.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { segments } from "@/core/segments/schema";
import { newsletters } from "@/modules/newsletters/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** Where it appears. A modal interrupts; a banner does not. */
export const POPUP_SURFACES = ["modal", "banner", "corner"] as const;
/** What makes it appear. */
export const POPUP_TRIGGERS = ["immediate", "delay", "scroll", "exitIntent"] as const;
/** Who sees it, in terms of one segment (§30). */
export const POPUP_AUDIENCES = ["everyone", "inSegment", "notInSegment"] as const;
export const POPUP_STATUSES = ["draft", "active", "paused"] as const;
export const POPUP_CAPTURES = ["none", "email"] as const;
/** What one visitor did with it. The vocabulary of `popup_events`. */
export const POPUP_EVENT_KINDS = ["shown", "dismissed", "captured"] as const;

export const popups = pgTable(
  "popups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable handle, so a test or a config can name a popup. */
    slug: text("slug").notNull(),
    /** What the owner calls it in the admin list. */
    name: text("name").notNull(),
    /**
     * The dialog's accessible name, shown as its own heading.
     *
     * Required, not optional. A modal dialog with no accessible name is
     * announced as "dialog" and nothing else, which is the difference between
     * an interruption a screen-reader user can understand and one they cannot.
     * Making it a column rather than hoping for a heading block means the name
     * exists whatever the owner drags into the body.
     */
    title: text("title").notNull(),
    surface: text("surface", { enum: POPUP_SURFACES }).notNull().default("modal"),
    trigger: text("trigger", { enum: POPUP_TRIGGERS }).notNull().default("delay"),
    /** Seconds for `delay`, percent of the page for `scroll`, unused otherwise. */
    triggerValue: integer("trigger_value").notNull().default(5),
    /** The body, as blocks (§32). Validated against the registry on write. */
    blocks: jsonb("blocks").notNull().default([]),

    /* ------------------------------------------------------------- who */
    audience: text("audience", { enum: POPUP_AUDIENCES }).notNull().default("everyone"),
    segmentId: uuid("segment_id").references(() => segments.id, {
      onDelete: "restrict",
    }),
    /** Glob-ish paths: `/`, `/shop/*`, `/blog/**`. Empty means anywhere. */
    pathPatterns: jsonb("path_patterns").notNull().default([]),
    /** Empty means any language the site publishes. */
    locales: jsonb("locales").notNull().default([]),

    /* ------------------------------------------------------- how often */
    /** Null is uncapped, and the admin says so in those words. */
    frequencyCap: integer("frequency_cap"),
    frequencyPeriodHours: integer("frequency_period_hours").notNull().default(168),
    /** Somebody who closed it has answered. Zero means ask again immediately. */
    dismissSuppressHours: integer("dismiss_suppress_hours").notNull().default(720),
    /** Asking a subscriber to subscribe is the classic popup insult. */
    stopAfterCapture: boolean("stop_after_capture").notNull().default(true),

    /* ---------------------------------------------------------- capture */
    captureMode: text("capture_mode", { enum: POPUP_CAPTURES }).notNull().default("none"),
    /** The double-opt-in list that proves control of a captured address. */
    newsletterId: uuid("newsletter_id").references(() => newsletters.id, {
      onDelete: "restrict",
    }),
    /**
     * The exact words shown beside the tick box.
     *
     * Stored because consent evidence has to say what was agreed to, not just
     * that something was. `contacts.recordConsent` takes a `termsVersion`, and
     * this is what fills it — so an owner who rewords the statement can still
     * tell which version each person actually saw.
     */
    consentStatement: text("consent_statement"),
    consentVersion: text("consent_version"),
    successMessage: text("success_message"),

    /* --------------------------------------------------------- when/rank */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Only one popup shows at a time; the highest priority wins the moment. */
    priority: integer("priority").notNull().default(0),
    status: text("status", { enum: POPUP_STATUSES }).notNull().default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("popups_slug_idx").on(t.slug),
    index("popups_status_idx").on(t.status, t.priority),
    check("popups_slug_shape", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("popups_slug_bounded", sql`char_length(${t.slug}) <= 180`),
    check("popups_name_bounded", sql`char_length(${t.name}) between 1 and 120`),
    check("popups_title", sql`char_length(${t.title}) between 1 and 160`),
    check("popups_surface_allowed", sql`${t.surface} in ('modal', 'banner', 'corner')`),
    check(
      "popups_trigger_allowed",
      sql`${t.trigger} in ('immediate', 'delay', 'scroll', 'exitIntent')`,
    ),
    check(
      "popups_trigger_value",
      sql`${t.triggerValue} between 0 and 600 and (${t.trigger} <> 'scroll' or ${t.triggerValue} between 1 and 100)`,
    ),
    check(
      "popups_audience_allowed",
      sql`${t.audience} in ('everyone', 'inSegment', 'notInSegment')`,
    ),
    check("popups_paths_array", sql`jsonb_typeof(${t.pathPatterns}) = 'array'`),
    check("popups_locales_array", sql`jsonb_typeof(${t.locales}) = 'array'`),
    // An audience that names no segment is a rule that cannot be evaluated,
    // and the evaluation would have to guess. Guessing widens the audience.
    check(
      "popups_audience_segment",
      sql`${t.audience} = 'everyone' or ${t.segmentId} is not null`,
    ),
    // The one that earns its place. A popup that asks for an email address
    // with nothing to say about what happens next is a consent record nobody
    // could defend, so the database refuses to hold one.
    check(
      "popups_capture_consent",
      sql`${t.captureMode} <> 'email' or (${t.consentStatement} is not null and ${t.newsletterId} is not null)`,
    ),
    check("popups_capture_allowed", sql`${t.captureMode} in ('none', 'email')`),
    check(
      "popups_consent_bounded",
      sql`${t.consentStatement} is null or char_length(${t.consentStatement}) <= 500`,
    ),
    check(
      "popups_consent_version_bounded",
      sql`${t.consentVersion} is null or char_length(${t.consentVersion}) <= 60`,
    ),
    check(
      "popups_success_message_bounded",
      sql`${t.successMessage} is null or char_length(${t.successMessage}) <= 400`,
    ),
    check(
      "popups_frequency_cap_positive",
      sql`${t.frequencyCap} is null or ${t.frequencyCap} > 0`,
    ),
    check("popups_frequency_cap_bounded", sql`${t.frequencyCap} is null or ${t.frequencyCap} <= 100`),
    check("popups_frequency_period", sql`${t.frequencyPeriodHours} between 1 and 8760`),
    check("popups_dismiss_suppress", sql`${t.dismissSuppressHours} between 0 and 8760`),
    check("popups_priority_bounded", sql`${t.priority} between 0 and 1000`),
    check("popups_status_allowed", sql`${t.status} in ('draft', 'active', 'paused')`),
    check(
      "popups_window",
      sql`${t.endsAt} is null or ${t.startsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
);

/**
 * What one visitor did with one popup, once (C9.30).
 *
 * This is the frequency cap's memory, and it is a table rather than a counter
 * for the reason every cap eventually needs: the owner has to be able to see
 * that the popup was shown 412 times and captured 31 addresses, and a counter
 * that only knows "how many are left" cannot answer that.
 *
 * Bounded by the cap it enforces. A capped popup writes at most
 * `frequency_cap` `shown` rows per visitor per period, because the row is what
 * stops the next one — so the table cannot grow faster than the popup is
 * allowed to appear.
 *
 * `visitor_key` is the first-party analytics visitor id when the visitor has
 * one, and null when they do not. It is deliberately *not* required: a popup
 * must still be capped for somebody who has declined analytics identifiers,
 * and that cap is carried in their own browser instead (see tally.ts).
 */
export const popupEvents = pgTable(
  "popup_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    popupId: uuid("popup_id")
      .notNull()
      .references(() => popups.id, { onDelete: "cascade" }),
    visitorKey: text("visitor_key"),
    /**
     * Who it was, when the platform already knows.
     *
     * Null for an anonymous visitor, which is most of them. Set when a
     * signed-in customer sees one, and set on capture — which is what lets an
     * owner see that this popup is where a contact came from, on the contact
     * rather than in a silo.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: POPUP_EVENT_KINDS }).notNull(),
    path: text("path"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The cap question, in index order: this popup, this visitor, this kind,
    // inside this window.
    index("popup_events_cap_idx").on(t.popupId, t.visitorKey, t.kind, t.occurredAt),
    // The owner's question: how has this popup done.
    index("popup_events_report_idx").on(t.popupId, t.kind, t.occurredAt),
    index("popup_events_contact_idx").on(t.contactId),
    check("popup_events_kind_allowed", sql`${t.kind} in ('shown', 'dismissed', 'captured')`),
    check(
      "popup_events_visitor_bounded",
      sql`${t.visitorKey} is null or char_length(${t.visitorKey}) <= 64`,
    ),
    check("popup_events_path_bounded", sql`${t.path} is null or char_length(${t.path}) <= 2048`),
  ],
);
