// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Members (MASTER.md §44.1, C12.01): one site, many people.
//
// A member is any signed-in user who has claimed a handle. The profile hangs
// off `users`, not `contacts`: a contact is a record the business keeps about
// someone, a member profile is something the person keeps about themselves.
// The link to the spine is the user's own contact row (`contacts.user_id`).
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const MEMBER_STATUSES = ["active", "pending", "suspended"] as const;
export const JOIN_POLICIES = ["open", "approval", "invite"] as const;
/** Lowercase letters, digits and underscores; 3–30 characters. */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;
import { VISIBILITIES } from "./visibility";
export { VISIBILITIES, type Visibility } from "./visibility";
export const RELATION_KINDS = ["block", "mute", "restrict"] as const;

export const memberProfiles = pgTable(
  "member_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("active"),
    /** A self-attestation, never a birthdate: the site needs the answer, not the data. */
    isAdult: boolean("is_adult").notNull().default(false),
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }).notNull(),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    handleChangedAt: timestamp("handle_changed_at", { withTimezone: true }),
    /** §44.3: profile fields and defaults are the member's choice; private by default. */
    bioVisibility: text("bio_visibility", { enum: VISIBILITIES }).notNull().default("followers"),
    links: jsonb("links").$type<{ label: string; url: string }[]>().notNull().default([]),
    linksVisibility: text("links_visibility", { enum: VISIBILITIES }).notNull().default("followers"),
    defaultPostVisibility: text("default_post_visibility", { enum: VISIBILITIES }).notNull().default("followers"),
    /** A private account approves each follower. */
    isPrivate: boolean("is_private").notNull().default(true),
    /** Search engines may index the profile only when the member says so. */
    indexable: boolean("indexable").notNull().default(false),
    /** §44.6: read receipts are opt-in, and you only see others' if you share yours. */
    readReceipts: boolean("read_receipts").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("member_profiles_handle_idx").on(t.handle),
    check("member_profiles_bio_visibility_valid", sql`${t.bioVisibility} in ('public','followers','friends','subscribers','only_me')`),
    check("member_profiles_links_visibility_valid", sql`${t.linksVisibility} in ('public','followers','friends','subscribers','only_me')`),
    check("member_profiles_default_post_visibility_valid", sql`${t.defaultPostVisibility} in ('public','followers','friends','subscribers','only_me')`),
    index("member_profiles_status_idx").on(t.status, t.createdAt),
    check("member_profiles_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,30}$'`),
    check("member_profiles_status_valid", sql`${t.status} in ('active','pending','suspended')`),
    check("member_profiles_display_name_length", sql`char_length(${t.displayName}) between 1 and 80`),
    check("member_profiles_bio_length", sql`char_length(${t.bio}) <= 1000`),
  ],
);

/** The site's membership rules. One row, id 1. */
export const memberSettings = pgTable(
  "member_settings",
  {
    id: integer("id").primaryKey().default(1),
    joinPolicy: text("join_policy", { enum: JOIN_POLICIES }).notNull().default("open"),
    minimumAge: integer("minimum_age").notNull().default(16),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check("member_settings_singleton", sql`${t.id} = 1`),
    check("member_settings_join_policy_valid", sql`${t.joinPolicy} in ('open','approval','invite')`),
    check("member_settings_minimum_age_range", sql`${t.minimumAge} between 13 and 21`),
  ],
);

/** Invitations for invite-only sites, matched on the email the person proves. */
export const memberInvitations = pgTable(
  "member_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("member_invitations_email_idx").on(t.email),
    check("member_invitations_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

/** §44.4: one-way follows. A follow of a private account starts as a request. */
export const memberFollows = pgTable(
  "member_follows",
  {
    followerId: uuid("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "requested"] }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("member_follows_followee_idx").on(t.followeeId, t.status),
    check("member_follows_not_self", sql`${t.followerId} <> ${t.followeeId}`),
    check("member_follows_status_valid", sql`${t.status} in ('active','requested')`),
  ],
);

/** §44.4: mutual friendship, stored once per pair with the lower id first. */
export const memberFriendships = pgTable(
  "member_friendships",
  {
    lowId: uuid("low_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    highId: uuid("high_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted"] }).notNull(),
    createdAt: createdAtColumn(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.lowId, t.highId] }),
    index("member_friendships_high_idx").on(t.highId, t.status),
    check("member_friendships_ordered", sql`${t.lowId} < ${t.highId}`),
    check("member_friendships_status_valid", sql`${t.status} in ('pending','accepted')`),
    check("member_friendships_requester_in_pair", sql`${t.requestedBy} in (${t.lowId}, ${t.highId})`),
  ],
);

/** §44.4: block, mute and restrict, each private to the member who set it. */
export const memberRelations = pgTable(
  "member_relations",
  {
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    targetId: uuid("target_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RELATION_KINDS }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.targetId, t.kind] }),
    index("member_relations_target_idx").on(t.targetId, t.kind),
    check("member_relations_not_self", sql`${t.ownerId} <> ${t.targetId}`),
    check("member_relations_kind_valid", sql`${t.kind} in ('block','mute','restrict')`),
  ],
);

/** §44.4: a member's post. A repost has no body; a quote has both. */
export const memberPosts = pgTable(
  "member_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    visibility: text("visibility", { enum: VISIBILITIES }).notNull(),
    repostOf: uuid("repost_of"),
    createdAt: createdAtColumn(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("member_posts_author_idx").on(t.authorId, t.createdAt),
    index("member_posts_created_idx").on(t.createdAt, t.id),
    index("member_posts_repost_idx").on(t.repostOf),
    check("member_posts_visibility_valid", sql`${t.visibility} in ('public','followers','friends','subscribers','only_me')`),
    check("member_posts_body_length", sql`char_length(${t.body}) <= 5000`),
    check("member_posts_has_content", sql`char_length(${t.body}) > 0 or ${t.repostOf} is not null`),
  ],
);

/** Threaded comments; `parentId` points at the comment being answered. */
export const memberComments = pgTable(
  "member_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => memberPosts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    createdAt: createdAtColumn(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("member_comments_post_idx").on(t.postId, t.createdAt),
    check("member_comments_body_length", sql`char_length(${t.body}) between 1 and 2000`),
  ],
);

export const REACTIONS = ["like", "love", "laugh", "wow", "sad", "thanks"] as const;

export const memberReactions = pgTable(
  "member_reactions",
  {
    postId: uuid("post_id").notNull().references(() => memberPosts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: REACTIONS }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.userId] }),
    check("member_reactions_kind_valid", sql`${t.kind} in ('like','love','laugh','wow','sad','thanks')`),
  ],
);

/** Hashtags, lowercased, for discovery of public posts. */
export const memberPostTags = pgTable(
  "member_post_tags",
  {
    postId: uuid("post_id").notNull().references(() => memberPosts.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tag] }), index("member_post_tags_tag_idx").on(t.tag)],
);

/** Mentions in posts and comments, and people tagged in a post (with consent). */
export const memberMentions = pgTable(
  "member_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => memberPosts.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => memberComments.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["mention", "tag"] }).notNull(),
    /** Tags need the tagged member's approval before they appear on their profile. */
    status: text("status", { enum: ["pending", "approved", "declined"] }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("member_mentions_user_idx").on(t.userId, t.kind, t.status),
    index("member_mentions_post_idx").on(t.postId),
    check("member_mentions_kind_valid", sql`${t.kind} in ('mention','tag')`),
    check("member_mentions_status_valid", sql`${t.status} in ('pending','approved','declined')`),
  ],
);

/** §44.6: a one-to-one or group conversation between members. */
export const memberConversations = pgTable(
  "member_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["direct", "group"] }).notNull(),
    /** For a direct conversation, "lowId:highId", so a pair has exactly one. */
    directKey: text("direct_key"),
    title: text("title"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_conversations_direct_idx").on(t.directKey),
    check("member_conversations_kind_valid", sql`${t.kind} in ('direct','group')`),
    check("member_conversations_direct_key", sql`(${t.kind} = 'direct') = (${t.directKey} is not null)`),
    check("member_conversations_title_length", sql`${t.title} is null or char_length(${t.title}) between 1 and 80`),
  ],
);

/**
 * Who is in a conversation. `requested` is a message request: it waits in the
 * recipient's requests until they accept it, and the sender cannot tell
 * whether it was read.
 */
export const memberConversationParticipants = pgTable(
  "member_conversation_participants",
  {
    conversationId: uuid("conversation_id").notNull().references(() => memberConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["active", "requested", "left"] }).notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    muted: boolean("muted").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("member_conversation_participants_user_idx").on(t.userId, t.state),
    check("member_conversation_participants_state_valid", sql`${t.state} in ('active','requested','left')`),
  ],
);

/** A message. The body is encrypted at rest and bound to the message id. */
export const memberMessages = pgTable(
  "member_messages",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => memberConversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
    bodySealed: text("body_sealed").notNull(),
    createdAt: createdAtColumn(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("member_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);
