-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
ALTER TABLE findmestill_desks ADD COLUMN published_document text;
--> statement-breakpoint
CREATE TABLE findmestill_customer_links (
  identity text PRIMARY KEY REFERENCES findmestill_desks(identity) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE
);
