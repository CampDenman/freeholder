// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Module toggles + per-module config (MASTER.md §4.8). Toggling a module off
// hides its UI and API surface; its data is retained (§3, module rules).
import { pgTable, boolean, jsonb, text, timestamp } from "drizzle-orm/pg-core";

export const moduleSettings = pgTable("module_settings", {
  /** The module's manifest name — one row per module, so it is the key. */
  module: text("module").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  /** Validated against the module's settingsSchema (§11) before write. */
  config: jsonb("config").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
