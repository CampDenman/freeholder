-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.37 (MASTER.md §44.7): a group call's media key is replaced when someone
-- leaves the conversation, or a device is removed, during the call.
ALTER TABLE "member_group_calls" ADD COLUMN "key_generation" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_mls_log" ADD COLUMN "call_generation" integer;
