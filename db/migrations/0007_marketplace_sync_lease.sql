-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C3.13: fence expired sync workers without holding a transaction over I/O.
ALTER TABLE "marketplace_channels" ADD COLUMN "sync_lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "marketplace_channels" ADD COLUMN "sync_lease_expires_at" timestamp with time zone;
