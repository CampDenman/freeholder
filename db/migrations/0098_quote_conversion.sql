-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- What an accepted quote becomes (C6.13, §4.3).
--
--   accepted → [Contract if required] → Invoice(deposit) → Invoice(balance)
--
-- Per quote rather than per instance, because a kitchen refit and a one-hour
-- consultation are not the same job even in the same business.
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "conversion_plan" jsonb;
-- The guard against converting twice, which would produce a second invoice for
-- one job — the kind of mistake an owner discovers from a customer.
ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "converted_at" timestamp with time zone;
