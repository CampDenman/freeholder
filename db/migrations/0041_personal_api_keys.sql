-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.14 (MASTER.md §44.10): keys people make for their own agents, acting as them.
ALTER TABLE "api_keys" ADD COLUMN "acts_as_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_acts_as_user_id_users_id_fk" FOREIGN KEY ("acts_as_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "api_keys_acts_as_idx" ON "api_keys" USING btree ("acts_as_user_id") WHERE "api_keys"."acts_as_user_id" is not null;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_personal_keys_expire" CHECK ("api_keys"."acts_as_user_id" is null or "api_keys"."expires_at" is not null);
