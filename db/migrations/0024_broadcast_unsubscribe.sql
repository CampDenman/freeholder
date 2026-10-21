-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C9.37: existing campaign copies receive private, durable opt-out capabilities.
ALTER TABLE "broadcast_recipients" ADD COLUMN "unsubscribe_token" uuid NOT NULL DEFAULT gen_random_uuid();
--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_unsubscribe_idx" ON "broadcast_recipients" ("unsubscribe_token");
--> statement-breakpoint
-- Contact merges retain delivered links while deduplicating campaign counts.
ALTER TABLE "broadcast_recipients" ADD COLUMN "unsubscribe_token_aliases" uuid[] NOT NULL DEFAULT '{}'::uuid[];
--> statement-breakpoint
CREATE INDEX "broadcast_recipients_unsubscribe_aliases_idx" ON "broadcast_recipients" USING gin ("unsubscribe_token_aliases");
