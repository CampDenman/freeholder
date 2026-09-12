// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const voiceVideoRooms = pgTable(
  "voice_video_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id"),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("pending"),
    externalRef: text("external_ref"),
    lastError: text("last_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("voice_video_rooms_contact_idx").on(t.contactId),
    index("voice_video_rooms_status_idx").on(t.status),
  ],
);

export const voiceVideoJoins = pgTable(
  "voice_video_joins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => voiceVideoRooms.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id"),
    status: text("status").notNull().default("joined"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("voice_video_joins_room_contact_idx").on(t.roomId, t.contactId),
    index("voice_video_joins_contact_idx").on(t.contactId),
  ],
);

export const voiceVideoArtifacts = pgTable(
  "voice_video_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => voiceVideoRooms.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    title: text("title").notNull(),
    externalRef: text("external_ref"),
    status: text("status").notNull().default("recorded"),
    conversationId: uuid("conversation_id"),
    transcript: text("transcript"),
    durationSeconds: integer("duration_seconds"),
    lastError: text("last_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("voice_video_artifacts_contact_idx").on(t.contactId),
    index("voice_video_artifacts_room_idx").on(t.roomId),
  ],
);
