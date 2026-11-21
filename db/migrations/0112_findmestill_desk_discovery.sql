-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
CREATE TABLE findmestill_desks (
  identity text PRIMARY KEY,
  compact_jws text NOT NULL
);
--> statement-breakpoint
CREATE TABLE findmestill_desk_grants (
  identity text NOT NULL REFERENCES findmestill_desks(identity) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz,
  PRIMARY KEY (identity, user_id)
);
