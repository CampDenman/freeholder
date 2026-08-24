-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- What each number is registered for (§4.14, C7.11).
--
-- A list rather than a single status: a US toll-free number can need
-- verification while a long code beside it needs a 10DLC brand *and* campaign,
-- and collapsing them loses which one an owner has to chase.
--
-- What is *required* is deliberately not stored. It is derived from country and
-- kind in `registration.ts`, because a stored requirement is one an owner could
-- clear, and carrier policy is not theirs to waive.
ALTER TABLE "messaging_numbers"
  ADD COLUMN IF NOT EXISTS "registrations" jsonb DEFAULT '[]' NOT NULL;
