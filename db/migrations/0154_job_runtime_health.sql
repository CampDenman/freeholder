-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
--
-- Durable, payload-free producer and worker health (MASTER.md C1.36).
CREATE TABLE "job_runtime_heartbeats" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"state" text DEFAULT 'starting' NOT NULL,
	"platform_version" text NOT NULL,
	"registered_jobs" integer DEFAULT 0 NOT NULL,
	"mounted_workers" integer DEFAULT 0 NOT NULL,
	"scheduled_jobs" integer DEFAULT 0 NOT NULL,
	"queued_jobs" integer DEFAULT 0 NOT NULL,
	"ready_jobs" integer DEFAULT 0 NOT NULL,
	"active_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"dead_letters" integer DEFAULT 0 NOT NULL,
	"queue_lag_seconds" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "job_runtime_heartbeats_role_check" CHECK ("role" in ('producer', 'worker')),
	CONSTRAINT "job_runtime_heartbeats_state_check" CHECK ("state" in ('starting', 'ready', 'degraded', 'stopping', 'stopped')),
	CONSTRAINT "job_runtime_heartbeats_version_not_blank" CHECK (length(trim("platform_version")) between 1 and 100),
	CONSTRAINT "job_runtime_heartbeats_error_code_length" CHECK ("last_error_code" is null or length("last_error_code") between 1 and 80),
	CONSTRAINT "job_runtime_heartbeats_counts_nonnegative" CHECK ("registered_jobs" >= 0 and "mounted_workers" >= 0 and "scheduled_jobs" >= 0 and "queued_jobs" >= 0 and "ready_jobs" >= 0 and "active_jobs" >= 0 and "failed_jobs" >= 0 and "dead_letters" >= 0 and "queue_lag_seconds" >= 0),
	CONSTRAINT "job_runtime_heartbeats_workers_match_role" CHECK (("role" = 'producer' and "mounted_workers" = 0) or "role" = 'worker'),
	CONSTRAINT "job_runtime_heartbeats_stop_timestamp" CHECK ("state" <> 'stopped' or "stopped_at" is not null)
);
--> statement-breakpoint
CREATE INDEX "job_runtime_heartbeats_freshness_idx" ON "job_runtime_heartbeats" USING btree ("heartbeat_at");
--> statement-breakpoint
CREATE INDEX "job_runtime_heartbeats_role_state_idx" ON "job_runtime_heartbeats" USING btree ("role", "state");
