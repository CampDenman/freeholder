// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const COMMUNITY_ACCESS = ["open", "gated"] as const;
export const COMMUNITY_ROLES = ["member", "moderator"] as const;
export const COMMUNITY_POST_STATES = ["visible", "hidden", "removed"] as const;

export const communitySpaces = pgTable(
  "community_spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    access: text("access").notNull().default("open"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("community_spaces_slug_idx").on(t.slug)],
);

export const communityMembers = pgTable(
  "community_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => communitySpaces.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("community_members_space_contact_idx").on(t.spaceId, t.contactId),
    index("community_members_contact_idx").on(t.contactId),
  ],
);

export const communityRooms = pgTable(
  "community_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => communitySpaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("community_rooms_space_slug_idx").on(t.spaceId, t.slug),
    index("community_rooms_space_idx").on(t.spaceId),
  ],
);

export const communityPosts = pgTable(
  "community_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => communityRooms.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: text("status").notNull().default("visible"),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("community_posts_room_created_idx").on(t.roomId, t.createdAt),
    index("community_posts_contact_idx").on(t.contactId),
    index("community_posts_status_idx").on(t.status, t.createdAt),
    check("community_posts_body", sql`char_length(${t.body}) between 1 and 2000`),
    check(
      "community_posts_status",
      sql`${t.status} in ('visible', 'hidden', 'removed')`,
    ),
  ],
);

export const communityJoinRequests = pgTable(
  "community_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => communitySpaces.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("community_join_requests_space_contact_idx").on(t.spaceId, t.contactId),
    index("community_join_requests_contact_idx").on(t.contactId),
  ],
);
