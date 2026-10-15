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
import { products } from "@/modules/catalog/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { REPORT_REASONS, REPORT_TARGETS } from "./report-kinds";

export const MEMBER_STATUSES = ["active", "pending", "suspended"] as const;
export const JOIN_POLICIES = ["open", "approval", "invite"] as const;
export const PAYOUT_MODELS = ["hold", "seller_merchant", "instant"] as const;
export const PAYOUT_STATES = ["held", "due", "paid", "cancelled", "review"] as const;
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
    /** §44.9 (C12.29): an adult's choice to see adult posts and listings. Off by default. */
    showAdult: boolean("show_adult").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("member_profiles_handle_idx").on(t.handle),
    check("member_profiles_bio_visibility_valid", sql`${t.bioVisibility} in ('public','followers','friends','subscribers','only_me')`),
    check("member_profiles_links_visibility_valid", sql`${t.linksVisibility} in ('public','followers','friends','subscribers','only_me')`),
    check("member_profiles_default_post_visibility_valid", sql`${t.defaultPostVisibility} in ('public','followers','friends','subscribers','only_me')`),
    check("member_profiles_show_adult_needs_adult", sql`not ${t.showAdult} or ${t.isAdult}`),
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
    /** §44.8: members may list things for sale. Off until the site turns it on. */
    marketplaceEnabled: boolean("marketplace_enabled").notNull().default(false),
    /** New listings wait for the site's review before they are public. */
    listingReview: boolean("listing_review").notNull().default(true),
    /**
     * §44.8, owner decision 2026-10-14: hold funds until delivery by default;
     * `seller_merchant` sends charges straight to sellers; `instant` pays at once.
     */
    payoutModel: text("payout_model", { enum: PAYOUT_MODELS }).notNull().default("hold"),
    holdDays: integer("hold_days").notNull().default(14),
    /** The site's cut of each member sale, in basis points. Zero by default. */
    siteFeeBps: integer("site_fee_bps").notNull().default(0),
    /** Which marketplace payout adapter moves money to sellers. */
    payoutAdapter: text("payout_adapter").notNull().default("manual"),
    /** §44.9 (C12.29): whether members may post or list adult content at all. Off by default. */
    adultContent: boolean("adult_content").notNull().default(false),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check("member_settings_singleton", sql`${t.id} = 1`),
    check("member_settings_join_policy_valid", sql`${t.joinPolicy} in ('open','approval','invite')`),
    check("member_settings_minimum_age_range", sql`${t.minimumAge} between 13 and 21`),
    check("member_settings_payout_model_valid", sql`${t.payoutModel} in ('hold','seller_merchant','instant')`),
    check("member_settings_hold_days_range", sql`${t.holdDays} between 1 and 90`),
    check("member_settings_site_fee_range", sql`${t.siteFeeBps} between 0 and 5000`),
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
    /** Adult content (C12.29): only adults who opted in, and the author, see it. */
    adult: boolean("adult").notNull().default(false),
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

/** §44.7: a private call between two members. Media never touches the server. */
export const memberCalls = pgTable(
  "member_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callerId: uuid("caller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    calleeId: uuid("callee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    media: text("media", { enum: ["voice", "video"] }).notNull(),
    state: text("state", { enum: ["ringing", "active", "ended", "declined", "missed"] }).notNull(),
    createdAt: createdAtColumn(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("member_calls_callee_idx").on(t.calleeId, t.state),
    index("member_calls_caller_idx").on(t.callerId, t.state),
    check("member_calls_not_self", sql`${t.callerId} <> ${t.calleeId}`),
    check("member_calls_media_valid", sql`${t.media} in ('voice','video')`),
    check("member_calls_state_valid", sql`${t.state} in ('ringing','active','ended','declined','missed')`),
  ],
);

/**
 * WebRTC signalling between the two devices: session descriptions and ICE
 * candidates. Each is deleted once the other device reads it, and all are
 * deleted when the call ends; they carry no media.
 */
export const memberCallSignals = pgTable(
  "member_call_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id").notNull().references(() => memberCalls.id, { onDelete: "cascade" }),
    fromId: uuid("from_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["offer", "answer", "candidate"] }).notNull(),
    payload: jsonb("payload").notNull(),
    /** clock_timestamp, so signals sent in quick succession keep their order. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    index("member_call_signals_call_idx").on(t.callId, t.createdAt),
    check("member_call_signals_kind_valid", sql`${t.kind} in ('offer','answer','candidate')`),
  ],
);

/**
 * §44.8: a member's listing. The product itself lives in the catalog with
 * `products.seller_user_id`; this keeps the site's review of it.
 */
export const memberListings = pgTable(
  "member_listings",
  {
    productId: uuid("product_id").primaryKey().references(() => products.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    review: text("review", { enum: ["pending", "approved", "rejected"] }).notNull(),
    reviewNote: text("review_note"),
    /** Adult content (C12.29): only adults who opted in, and the seller, see it. */
    adult: boolean("adult").notNull().default(false),
    createdAt: createdAtColumn(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    index("member_listings_seller_idx").on(t.sellerId, t.createdAt),
    index("member_listings_review_idx").on(t.review, t.createdAt),
    check("member_listings_review_valid", sql`${t.review} in ('pending','approved','rejected')`),
  ],
);

/**
 * §44.8: how the site pays one seller. For the manual adapter the seller
 * gives instructions (sealed at rest) and the site marks the account ready;
 * provider adapters (C12.26, C12.27) keep the provider's account id here.
 */
export const memberPayoutAccounts = pgTable(
  "member_payout_accounts",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    status: text("status", { enum: ["pending", "ready", "disabled"] }).notNull().default("pending"),
    instructionsSealed: text("instructions_sealed"),
    externalAccountId: text("external_account_id"),
    updatedAt: updatedAtColumn(),
  },
  (t) => [check("member_payout_accounts_status_valid", sql`${t.status} in ('pending','ready','disabled')`)],
);

/** §44.8: what the site owes each seller for each order line. */
export const memberPayouts = pgTable(
  "member_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    sellerId: uuid("seller_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    grossMinor: integer("gross_minor").notNull(),
    feeMinor: integer("fee_minor").notNull(),
    netMinor: integer("net_minor").notNull(),
    state: text("state", { enum: PAYOUT_STATES }).notNull(),
    model: text("model", { enum: PAYOUT_MODELS }).notNull(),
    releaseAt: timestamp("release_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reference: text("reference"),
    note: text("note"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("member_payouts_order_item_idx").on(t.orderItemId),
    index("member_payouts_seller_idx").on(t.sellerId, t.state),
    index("member_payouts_release_idx").on(t.state, t.releaseAt),
    check("member_payouts_state_valid", sql`${t.state} in ('held','due','paid','cancelled','review')`),
    check("member_payouts_amounts", sql`${t.feeMinor} >= 0 and ${t.netMinor} = ${t.grossMinor} - ${t.feeMinor}`),
  ],
);

/** §44.8: one seller's part of one order — how it reached the buyer. */
export const memberSaleFulfilments = pgTable(
  "member_sale_fulfilments",
  {
    orderId: uuid("order_id").notNull(),
    sellerId: uuid("seller_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    state: text("state", { enum: ["awaiting", "shipped", "delivered"] }).notNull().default("awaiting"),
    carrier: text("carrier"),
    tracking: text("tracking"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Who settled delivery: the buyer, the site, or the holding window. */
    deliveredBy: text("delivered_by", { enum: ["buyer", "site", "window"] }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.sellerId] }),
    check("member_sale_fulfilments_state_valid", sql`${t.state} in ('awaiting','shipped','delivered')`),
  ],
);

/** §44.8: a buyer's dispute about one seller's part of an order. */
export const memberDisputes = pgTable(
  "member_disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    sellerId: uuid("seller_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    buyerUserId: uuid("buyer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason", { enum: ["not_received", "not_as_described", "other"] }).notNull(),
    state: text("state", { enum: ["open", "released", "refunded", "withdrawn"] }).notNull().default("open"),
    resolutionNote: text("resolution_note"),
    createdAt: createdAtColumn(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("member_disputes_order_idx").on(t.orderId, t.sellerId),
    index("member_disputes_state_idx").on(t.state, t.createdAt),
    uniqueIndex("member_disputes_one_open_idx").on(t.orderId, t.sellerId).where(sql`${t.state} = 'open'`),
    check("member_disputes_reason_valid", sql`${t.reason} in ('not_received','not_as_described','other')`),
    check("member_disputes_state_valid", sql`${t.state} in ('open','released','refunded','withdrawn')`),
  ],
);

/** §44.8: the buyer, the seller and the site talking about one sale. Sealed at rest. */
export const memberSaleMessages = pgTable(
  "member_sale_messages",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    sellerId: uuid("seller_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    role: text("role", { enum: ["buyer", "seller", "site"] }).notNull(),
    bodySealed: text("body_sealed").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("member_sale_messages_sale_idx").on(t.orderId, t.sellerId, t.createdAt),
    check("member_sale_messages_role_valid", sql`${t.role} in ('buyer','seller','site')`),
  ],
);

/**
 * §44.8: buyer and seller review each other after a completed sale. Reviews
 * are double-blind: each is revealed when both are written, or when the
 * window passes, so neither side can answer the other's rating in kind.
 */
export const memberReviews = pgTable(
  "member_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    sellerId: uuid("seller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["of_seller", "of_buyer"] }).notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull().default(""),
    revealAt: timestamp("reveal_at", { withTimezone: true }).notNull(),
    reply: text("reply"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    /** Set when site staff remove the review after a report (C12.12). */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("member_reviews_one_per_side_idx").on(t.orderId, t.sellerId, t.authorId),
    index("member_reviews_subject_idx").on(t.subjectId, t.revealAt),
    check("member_reviews_rating_range", sql`${t.rating} between 1 and 5`),
    check("member_reviews_direction_valid", sql`${t.direction} in ('of_seller','of_buyer')`),
    check("member_reviews_body_length", sql`char_length(${t.body}) <= 2000`),
    check("member_reviews_reply_length", sql`${t.reply} is null or char_length(${t.reply}) <= 2000`),
    check("member_reviews_not_self", sql`${t.authorId} <> ${t.subjectId}`),
  ],
);


/**
 * §44.9 (C12.12): a member's report of something on the site. `subjectId` is
 * the member responsible for the reported thing; `excerpt` is what the reporter
 * saw, kept so the queue still shows it if the author edits or deletes it.
 */
export const memberReports = pgTable(
  "member_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    targetType: text("target_type", { enum: REPORT_TARGETS }).notNull(),
    targetId: uuid("target_id").notNull(),
    subjectId: uuid("subject_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: REPORT_REASONS }).notNull(),
    details: text("details").notNull().default(""),
    excerpt: text("excerpt").notNull().default(""),
    state: text("state", { enum: ["open", "actioned", "dismissed"] }).notNull().default("open"),
    action: text("action", { enum: ["removed", "suspended", "dismissed"] }),
    resolutionNote: text("resolution_note"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("member_reports_one_open_idx").on(t.reporterId, t.targetType, t.targetId).where(sql`${t.state} = 'open'`),
    index("member_reports_queue_idx").on(t.state, t.createdAt),
    index("member_reports_target_idx").on(t.targetType, t.targetId),
    check("member_reports_target_valid", sql`${t.targetType} in ('post','comment','message','listing','review','member')`),
    check("member_reports_state_valid", sql`${t.state} in ('open','actioned','dismissed')`),
    check("member_reports_details_length", sql`char_length(${t.details}) <= 2000`),
  ],
);

