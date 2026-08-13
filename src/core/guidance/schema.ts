// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Durable onboarding definitions and per-person progress (MASTER.md sections
// 4.8, 13 and 31). Definitions are versioned facts: changing a shipped flow
// creates a new version rather than silently changing the lesson underneath a
// person who is halfway through it.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const guidanceFlows = pgTable(
  "guidance_flows",
  {
    key: text("key").notNull(),
    version: integer("version").notNull(),
    titleKey: text("title_key").notNull(),
    descriptionKey: text("description_key").notNull(),
    audienceRoles: text("audience_roles").array().notNull().default(sql`'{}'`),
    requiredCapabilities: text("required_capabilities")
      .array()
      .notNull()
      .default(sql`'{}'`),
    steps: jsonb("steps").notNull().default([]),
    status: text("status", { enum: ["draft", "active", "retired"] })
      .notNull()
      .default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: "guidance_flows_key_version_pk",
      columns: [t.key, t.version],
    }),
    index("guidance_flows_status_idx").on(t.status, t.key, t.version),
    check("guidance_flows_version_positive", sql`${t.version} > 0`),
    check(
      "guidance_flows_status_valid",
      sql`${t.status} in ('draft', 'active', 'retired')`,
    ),
    check(
      "guidance_flows_steps_array",
      sql`jsonb_typeof(${t.steps}) = 'array'`,
    ),
  ],
);

export const guidanceProgress = pgTable(
  "guidance_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    flowKey: text("flow_key").notNull(),
    flowVersion: integer("flow_version").notNull(),
    completedSteps: text("completed_steps")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * The eligible step set at the last interaction. A newly granted
     * capability adds a key here only after the service has reactivated the
     * flow, which is how dismissed/completed guidance reliably reappears.
     */
    seenSteps: text("seen_steps").array().notNull().default(sql`'{}'`),
    state: text("state", { enum: ["active", "dismissed", "completed"] })
      .notNull()
      .default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: "guidance_progress_user_flow_version_pk",
      columns: [t.userId, t.flowKey, t.flowVersion],
    }),
    index("guidance_progress_user_state_idx").on(t.userId, t.state, t.updatedAt),
    check("guidance_progress_version_positive", sql`${t.flowVersion} > 0`),
    check(
      "guidance_progress_state_valid",
      sql`${t.state} in ('active', 'dismissed', 'completed')`,
    ),
    check(
      "guidance_progress_completed_consistent",
      sql`(${t.state} = 'completed' and ${t.completedAt} is not null) or (${t.state} <> 'completed' and ${t.completedAt} is null)`,
    ),
    check(
      "guidance_progress_dismissed_consistent",
      sql`(${t.state} = 'dismissed' and ${t.dismissedAt} is not null) or (${t.state} <> 'dismissed' and ${t.dismissedAt} is null)`,
    ),
  ],
);
