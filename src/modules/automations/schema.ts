// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Automations and their versions (MASTER.md §4.17, C9.01).
//
// §4.17: "A version is immutable, and a run pins the one that produced it.
// Editing an automation writes a new `AutomationVersion` and bumps
// `current_version`; in-flight runs finish on the version they started."
//
// So the graph is not a column on `automations`. It lives on a version, the
// automation carries a pointer to the current one, and there is no service
// that edits a published version — the same discipline `DocumentVersion` and
// `AgentPlaybookVersion` already keep, for the same reason: a run that went
// wrong last month must be readable against the rules it was actually given.
//
// The one exception is the draft, which is explicitly mutable and explicitly
// not a version. See `draft_graph` below.
//
// The run tables (`AutomationRun`, `AutomationRunStep`,
// `AutomationContactState`) are C9.02 and are deliberately absent here: C9.01
// builds and validates automations, and nothing yet executes one.
import {
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
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const AUTOMATION_TRIGGERS = ["event", "schedule", "manual"] as const;
export const AUTOMATION_STATUSES = ["draft", "active", "paused", "archived"] as const;
export const AUTOMATION_REENTRY = ["once", "cooldown", "always"] as const;

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    triggerKind: text("trigger_kind", { enum: AUTOMATION_TRIGGERS })
      .notNull()
      .default("event"),
    /** The bus topic, when the trigger is an event. From the event catalogue. */
    eventPattern: text("event_pattern"),
    scheduleCron: text("schedule_cron"),
    /**
     * The zone the cron is read in (§4.9). Null means the business's own, so
     * "every morning at 7" stays 7 across a clock change — the same decision
     * `agent_playbooks.timezone` records.
     */
    timezone: text("timezone"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /** Optional entry filter: only contacts in this segment may enter (§30). */
    entrySegmentId: uuid("entry_segment_id").references(() => segments.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: AUTOMATION_STATUSES }).notNull().default("draft"),
    /**
     * The version runs use. Null until one is published, which is what makes
     * "saved but never switched on" a real and safe state.
     *
     * No foreign key: versions reference automations, and a reference back
     * would be a cycle neither table could be inserted into first — the same
     * shape `documents.current_version_id` has.
     */
    currentVersionId: uuid("current_version_id"),
    /**
     * The work in progress. Explicitly mutable, explicitly not a version.
     *
     * An owner building a canvas saves constantly and most of those saves are
     * not decisions. Writing a version per keystroke would make the history
     * that matters — "what changed between the run that worked and the run
     * that did not" — unreadable. Publishing is the decision, and publishing
     * is what writes a version.
     */
    draftGraph: jsonb("draft_graph"),
    /** §40's ladder only lowers: an automation may be more cautious, never less. */
    autonomyCeiling: text("autonomy_ceiling", {
      enum: ["suggest", "approve", "autonomous"],
    }),
    /** Per-run money ceiling for prompt work this automation creates. */
    budgetMinor: integer("budget_minor"),
    reentry: text("reentry", { enum: AUTOMATION_REENTRY }).notNull().default("once"),
    cooldownDays: integer("cooldown_days"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("automations_name_idx").on(t.name),
    index("automations_status_idx").on(t.status, t.updatedAt),
    // C9.02 reads this to find event-triggered automations; indexed now so the
    // column that will be queried on every published event is not a scan.
    index("automations_event_idx").on(t.eventPattern, t.status),
    index("automations_due_idx").on(t.status, t.nextRunAt),
  ],
);

/**
 * One published shape of the graph. Immutable once written (§4.17).
 *
 * No `updated_at` and no service that edits a row, exactly as
 * `document_versions` has none: a version that could be changed afterwards
 * answers "what were the rules then" with whatever somebody typed last.
 */
export const automationVersions = pgTable(
  "automation_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /** 1-based and contiguous, because "version 3" is what people say. */
    version: integer("version").notNull(),
    graph: jsonb("graph").notNull(),
    /** What changed, in the owner's words. */
    note: text("note"),
    /**
     * The trigger as it was when this version was published.
     *
     * Copied rather than read through, because a run has to be readable
     * against what it was actually doing: an automation moved from an event to
     * a schedule last week does not make last month's runs schedule-triggered.
     */
    triggerKind: text("trigger_kind", { enum: AUTOMATION_TRIGGERS }).notNull(),
    eventPattern: text("event_pattern"),
    scheduleCron: text("schedule_cron"),
    /**
     * Who was allowed in, as at publication (§30, C7.17).
     *
     * Copied for the same reason the trigger is: an automation whose audience
     * was narrowed last week did not narrow last month's runs, and a run has
     * to be readable against what it was actually doing.
     */
    entrySegmentId: uuid("entry_segment_id").references(() => segments.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // One row per version number per automation. Under concurrent publishes
    // only the index can stop two "version 3"s existing.
    uniqueIndex("automation_versions_number_idx").on(t.automationId, t.version),
    index("automation_versions_automation_idx").on(t.automationId, t.createdAt),
  ],
);

/**
 * What this automation has already done to this person (§4.17, C9.02).
 *
 * §4.17: "Re-entry is a stated policy, not an accident ... A customer
 * receiving the same win-back note every time they cancel is the failure mode
 * that makes owners switch automation off entirely."
 *
 * One row per person per automation, enforced by a unique index rather than by
 * the handler: the decision is read and written on the same row, so two events
 * arriving together must not be able to create two states and both conclude
 * "never entered".
 */
export const automationContactState = pgTable(
  "automation_contact_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    entryCount: integer("entry_count").notNull().default(0),
    lastEnteredAt: timestamp("last_entered_at", { withTimezone: true }),
    /** Null when the policy is `once` or `always`; a date under `cooldown`. */
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("automation_contact_state_once_idx").on(t.automationId, t.contactId),
  ],
);
