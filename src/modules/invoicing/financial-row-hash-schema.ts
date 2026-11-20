// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C11.05: exact current-row fingerprints maintained by the source tables.
import { sql } from "drizzle-orm";
import { bigint, check, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

export const financialRowHashes = pgTable("financial_row_hashes", {
  tableName: text("table_name").notNull(),
  rowId: uuid("row_id").notNull(),
  rowSha256: text("row_sha256").notNull(),
  rowBytes: bigint("row_bytes", { mode: "number" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.tableName, t.rowId] }),
  check("financial_row_hashes_value", sql`${t.rowSha256} ~ '^[a-f0-9]{64}$' and ${t.rowBytes}>=0`),
]);
