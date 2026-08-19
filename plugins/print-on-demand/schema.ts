// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const podJobs = pgTable(
  "pod_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("queued"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("pod_jobs_status_idx").on(t.status)],
);
