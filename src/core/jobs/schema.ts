// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Durable idempotency claims for transactional background work (MASTER.md §43 C1.09).
// pg-boss owns execution state in its own schema; this one small core table
// remembers that a caller already requested a logical operation, even after
// pg-boss has pruned the completed job row.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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

/**
 * Cross-process proof that the queue runtime is alive.
 *
 * Request handlers and instrumentation execute in separate module graphs, and
 * production may put the worker in another process entirely. An in-memory
 * boolean therefore cannot answer whether required background work is live.
 * These deliberately payload-free rows can.
 */
export const jobRuntimeHeartbeats = pgTable(
  "job_runtime_heartbeats",
  {
    instanceId: uuid("instance_id").primaryKey(),
    role: text("role", { enum: ["producer", "worker"] }).notNull(),
    state: text("state", {
      enum: ["starting", "ready", "degraded", "stopping", "stopped"],
    })
      .notNull()
      .default("starting"),
    platformVersion: text("platform_version").notNull(),
    registeredJobs: integer("registered_jobs").notNull().default(0),
    mountedWorkers: integer("mounted_workers").notNull().default(0),
    scheduledJobs: integer("scheduled_jobs").notNull().default(0),
    queuedJobs: integer("queued_jobs").notNull().default(0),
    readyJobs: integer("ready_jobs").notNull().default(0),
    activeJobs: integer("active_jobs").notNull().default(0),
    failedJobs: integer("failed_jobs").notNull().default(0),
    deadLetters: integer("dead_letters").notNull().default(0),
    queueLagSeconds: integer("queue_lag_seconds").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [
    index("job_runtime_heartbeats_freshness_idx").on(t.heartbeatAt),
    index("job_runtime_heartbeats_role_state_idx").on(t.role, t.state),
    check(
      "job_runtime_heartbeats_role_check",
      sql`${t.role} in ('producer', 'worker')`,
    ),
    check(
      "job_runtime_heartbeats_state_check",
      sql`${t.state} in ('starting', 'ready', 'degraded', 'stopping', 'stopped')`,
    ),
    check(
      "job_runtime_heartbeats_version_not_blank",
      sql`length(trim(${t.platformVersion})) between 1 and 100`,
    ),
    check(
      "job_runtime_heartbeats_error_code_length",
      sql`${t.lastErrorCode} is null or length(${t.lastErrorCode}) between 1 and 80`,
    ),
    check(
      "job_runtime_heartbeats_counts_nonnegative",
      sql`${t.registeredJobs} >= 0 and ${t.mountedWorkers} >= 0 and ${t.scheduledJobs} >= 0 and ${t.queuedJobs} >= 0 and ${t.readyJobs} >= 0 and ${t.activeJobs} >= 0 and ${t.failedJobs} >= 0 and ${t.deadLetters} >= 0 and ${t.queueLagSeconds} >= 0`,
    ),
    check(
      "job_runtime_heartbeats_workers_match_role",
      sql`(${t.role} = 'producer' and ${t.mountedWorkers} = 0) or ${t.role} = 'worker'`,
    ),
    check(
      "job_runtime_heartbeats_stop_timestamp",
      sql`${t.state} <> 'stopped' or ${t.stoppedAt} is not null`,
    ),
  ],
);
