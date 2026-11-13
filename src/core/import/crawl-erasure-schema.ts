// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: actual initial erasure membership, including a completed empty capture.
// Source-only81 models remain unregistered until the full source is qualified.
import { foreignKey, index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataRequests } from "@/core/privacy/schema";
import { importCrawlSources } from "./crawl-schema";

export const importCrawlErasureScopes = pgTable("import_crawl_erasure_scopes", {
  requestId: uuid("request_id").primaryKey().references(() => dataRequests.id, { onDelete: "restrict" }),
  captureVersion: integer("capture_version").notNull().default(1),
  sourceCount: integer("source_count").notNull(),
  responseCount: integer("response_count").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importCrawlErasureSources = pgTable("import_crawl_erasure_sources", {
  requestId: uuid("request_id").notNull().references(() => importCrawlErasureScopes.requestId, { onDelete: "restrict" }),
  sourceId: uuid("source_id").notNull(), generation: uuid("generation").notNull(),
}, table => [
  primaryKey({ name: "import_crawl_erasure_sources_pk", columns: [table.requestId, table.sourceId, table.generation] }),
  foreignKey({ name: "import_crawl_erasure_sources_original_fk", columns: [table.sourceId, table.generation], foreignColumns: [importCrawlSources.id, importCrawlSources.generation] }).onDelete("restrict"),
  index("import_crawl_erasure_sources_original_idx").on(table.sourceId, table.generation, table.requestId),
]);
