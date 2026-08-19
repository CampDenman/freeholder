// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const voiceVideoArtifacts = pgTable(
  "voice_video_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    title: text("title").notNull(),
    externalRef: text("external_ref"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("voice_video_artifacts_contact_idx").on(t.contactId)],
);
