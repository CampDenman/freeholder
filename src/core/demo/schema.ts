// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Immutable demo definitions, lifecycle runs and exact record provenance.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const demoScenarios = pgTable(
  "demo_scenarios",
  {
    key: text("key").notNull(),
    version: integer("version").notNull(),
    titleKey: text("title_key").notNull(),
    descriptionKey: text("description_key").notNull(),
    preset: text("preset").notNull(),
    requiredModules: text("required_modules").array().notNull().default(sql`'{}'`),
    requiredCapabilities: text("required_capabilities")
      .array()
      .notNull()
      .default(sql`'{}'`),
    fixtureManifest: jsonb("fixture_manifest").notNull().default([]),
    defaultLocale: text("default_locale").notNull(),
    supportedLocales: text("supported_locales").array().notNull(),
    tourFlowKey: text("tour_flow_key"),
    status: text("status", { enum: ["draft", "active", "retired"] })
      .notNull()
      .default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: "demo_scenarios_key_version_pk",
      columns: [t.key, t.version],
    }),
    index("demo_scenarios_status_idx").on(t.status, t.key, t.version),
    check("demo_scenarios_version_positive", sql`${t.version} > 0`),
    check(
      "demo_scenarios_status_valid",
      sql`${t.status} in ('draft', 'active', 'retired')`,
    ),
    check(
      "demo_scenarios_fixture_manifest_array",
      sql`jsonb_typeof(${t.fixtureManifest}) = 'array'`,
    ),
  ],
);

export const demoScenarioRuns = pgTable(
  "demo_scenario_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioKey: text("scenario_key").notNull(),
    scenarioVersion: integer("scenario_version").notNull(),
    locale: text("locale").notNull(),
    generation: integer("generation").notNull().default(1),
    status: text("status", { enum: ["active", "purged"] })
      .notNull()
      .default("active"),
    loadedAt: timestamp("loaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    foreignKey({
      name: "demo_scenario_runs_definition_fk",
      columns: [t.scenarioKey, t.scenarioVersion],
      foreignColumns: [demoScenarios.key, demoScenarios.version],
    }).onDelete("restrict"),
    index("demo_scenario_runs_scenario_idx").on(
      t.scenarioKey,
      t.scenarioVersion,
      t.loadedAt,
    ),
    uniqueIndex("demo_scenario_runs_one_active_idx")
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
    check("demo_scenario_runs_generation_positive", sql`${t.generation} > 0`),
    check(
      "demo_scenario_runs_status_valid",
      sql`${t.status} in ('active', 'purged')`,
    ),
    check(
      "demo_scenario_runs_purge_consistent",
      sql`(${t.status} = 'purged' and ${t.purgedAt} is not null) or (${t.status} = 'active' and ${t.purgedAt} is null)`,
    ),
  ],
);

export const demoRecords = pgTable(
  "demo_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => demoScenarioRuns.id, { onDelete: "cascade" }),
    generation: integer("generation").notNull(),
    contributionKey: text("contribution_key").notNull(),
    contributionVersion: integer("contribution_version").notNull(),
    fixtureKey: text("fixture_key").notNull(),
    subjectType: text("subject_type").notNull(),
    /** Text rather than uuid: plugin-owned entities may use another stable id. */
    subjectId: text("subject_id").notNull(),
    label: text("label").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("demo_records_fixture_idx").on(
      t.runId,
      t.generation,
      t.contributionKey,
      t.fixtureKey,
    ),
    index("demo_records_subject_idx").on(t.subjectType, t.subjectId),
    check("demo_records_generation_positive", sql`${t.generation} > 0`),
    check(
      "demo_records_contribution_version_positive",
      sql`${t.contributionVersion} > 0`,
    ),
  ],
);
