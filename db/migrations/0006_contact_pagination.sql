-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C11.11: a unique newest-first order for tied import timestamps; an index
-- prevents each page of a large contact book from sorting the whole table.
CREATE INDEX "contacts_created_id_idx" ON "contacts" ("created_at", "id");
