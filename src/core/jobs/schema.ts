// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Durable idempotency claims for transactional background work (MASTER.md §43 C1.09).
// pg-boss owns execution state in its own schema; this one small core table
// remembers that a caller already requested a logical operation, even after
// pg-boss has pruned the completed job row.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";

export const jobIdempotencyKeys = pgTable(
  "job_idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobName: text("job_name").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    jobId: uuid("job_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("job_idempotency_keys_name_key_idx").on(t.jobName, t.idempotencyKey),
    uniqueIndex("job_idempotency_keys_job_id_idx").on(t.jobId),
    index("job_idempotency_keys_expiry_idx").on(t.expiresAt),
    check("job_idempotency_keys_key_not_blank", sql`length(trim(${t.idempotencyKey})) > 0`),
    check("job_idempotency_keys_payload_hash_length", sql`length(${t.payloadHash}) = 64`),
    check("job_idempotency_keys_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
