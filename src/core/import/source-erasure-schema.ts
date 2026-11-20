// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: first-fulfilment membership, never reconstructed from later rows.
import { foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dataRequests } from "@/core/privacy/schema";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";

export const importSourceErasureScopes = pgTable("import_source_erasure_scopes", {
  requestId: uuid("request_id").primaryKey().references(() => dataRequests.id, { onDelete: "restrict" }),
  captureVersion: integer("capture_version").notNull().default(1),
  sourceCount: integer("source_count").notNull(), objectCount: integer("object_count").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});
export const importSourceErasureMembers = pgTable("import_source_erasure_members", {
  requestId: uuid("request_id").notNull().references(() => importSourceErasureScopes.requestId, { onDelete: "restrict" }),
  runId: uuid("run_id").notNull().references(() => importRuns.id, { onDelete: "restrict" }),
  uploadId: uuid("upload_id").notNull(), chunkCount: integer("chunk_count").notNull(),
  graphId: uuid("graph_id").references(() => importSourceGraphs.id, { onDelete: "restrict" }),
  graphGeneration: uuid("graph_generation"), sourceRevision: text("source_revision"),
}, table => [primaryKey({ name: "import_source_erasure_members_pk", columns: [table.requestId, table.runId, table.uploadId] }),
  index("import_source_erasure_members_graph_idx").on(table.graphId, table.requestId)]);
export const importSourceErasureObjects = pgTable("import_source_erasure_objects", {
  requestId: uuid("request_id").notNull(), runId: uuid("run_id").notNull(), uploadId: uuid("upload_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(), keyDigest: text("key_digest").notNull(),
}, table => [primaryKey({ name: "import_source_erasure_objects_pk", columns: [table.requestId, table.runId, table.uploadId, table.chunkIndex] }),
  foreignKey({ name: "import_source_erasure_objects_member_fk", columns: [table.requestId, table.runId, table.uploadId], foreignColumns: [importSourceErasureMembers.requestId, importSourceErasureMembers.runId, importSourceErasureMembers.uploadId] }).onDelete("restrict"),
  index("import_source_erasure_objects_digest_idx").on(table.keyDigest, table.requestId)]);
