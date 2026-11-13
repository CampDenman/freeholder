// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: graph ranges remain bound to distinct actual HTTP responses.
// Private graph bindings require their matching guarded migration81 schema.
import { foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";

export const importCrawlGraphs = pgTable("import_crawl_graphs", {
  graphId: uuid("graph_id").primaryKey().references(() => importSourceGraphs.id, { onDelete: "restrict" }),
  sourceId: uuid("source_id").notNull(),
  sourceGeneration: uuid("source_generation").notNull(),
  sourceRevision: text("source_revision").notNull(),
  requestOrdinal: integer("request_ordinal").notNull().default(0),
  entryOrdinal: integer("entry_ordinal").notNull().default(0),
  bodyBytes: integer("body_bytes").notNull().default(0),
  metadataBytes: integer("metadata_bytes").notNull().default(0),
  physicalBytes: integer("physical_bytes").notNull().default(0),
  createdAt: createdAtColumn(),
}, table => [
  foreignKey({ name: "import_crawl_graphs_original_fk", columns: [table.sourceId, table.sourceGeneration], foreignColumns: [importCrawlSources.id, importCrawlSources.generation] }).onDelete("restrict"),
  uniqueIndex("import_crawl_graphs_original_unique").on(table.sourceId, table.sourceGeneration),
]);

/** Equal numeric offsets on different responses are distinct ranges. The
 * normalized response/request FK is authority; metadata is its projection.
 */
export const importCrawlEntryOriginals = pgTable("import_crawl_entry_originals", {
  entryId: uuid("entry_id").primaryKey().references(() => importSourceEntries.id, { onDelete: "restrict" }),
  graphId: uuid("graph_id").notNull().references(() => importCrawlGraphs.graphId, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull().references(() => importCrawlRequests.id, { onDelete: "restrict" }),
  responseId: uuid("response_id").notNull(),
  createdAt: createdAtColumn(),
}, table => [
  foreignKey({ name: "import_crawl_entry_originals_response_fk", columns: [table.responseId, table.requestId], foreignColumns: [importCrawlResponses.id, importCrawlResponses.requestId] }).onDelete("restrict"),
  index("import_crawl_entry_originals_graph_idx").on(table.graphId),
  index("import_crawl_entry_originals_response_idx").on(table.responseId),
]);
