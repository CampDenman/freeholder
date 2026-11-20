-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C12.38: UNAPPLIED additive fragment after the current assembled ordinary80.
-- A new candidate hash/database is required; never apply to V10/V11 proof DBs.
ALTER TABLE subscription_provider_schedule_operations DROP CONSTRAINT subscription_schedule_operations_kind;
--> statement-breakpoint
ALTER TABLE subscription_provider_schedule_operations ADD CONSTRAINT subscription_schedule_operations_kind
 CHECK(kind IN('create','create_product','update','pause','resume','cancel','void_invoice','delete_draft'));
