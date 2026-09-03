// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Connected social profiles (MASTER.md §33, C9.24).
//
// Provider is plain text, not a closed enum, so a plugin can add a network
// without a migration on this table — the property C9.31 later proves. The
// unique index is (provider, provider account id) because several profiles
// per network is the normal case, not a workaround.
//
// No account is usable until a person finishes the provider's OAuth *and*
// Freeholder's review step. `pending_review` is that gate. Assignment,
// read/respond/publish and approval policy are owner decisions on the row,
// independent of what the API currently permits (that lives in `capabilities`).
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { conversations } from "@/core/messaging/schema";
import { assets } from "@/core/media/schema";
import { businessLocations } from "@/core/locations/schema";
import { reviews } from "@/modules/reviews/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import {
  SOCIAL_APPROVAL_POLICIES,
  SOCIAL_ASPECTS,
  SOCIAL_ASSIGNMENTS,
  SOCIAL_HEALTH,
  SOCIAL_INTERACTION_KINDS,
  SOCIAL_PROFILE_STATUSES,
  SOCIAL_PUBLICATION_STATUSES,
  SOCIAL_RIGHTS,
  SOCIAL_SOURCE_KINDS,
  SOCIAL_VARIANT_STATUSES,
} from "./contract";

export const socialOauthStates = pgTable(
  "social_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    returnTo: text("return_to").notNull().default("/admin/social"),
    codeVerifier: text("code_verifier"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_oauth_states_hash_idx").on(t.tokenHash),
    index("social_oauth_states_expiry_idx").on(t.expiresAt),
  ],
);

export const socialProfiles = pgTable(
  "social_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    /** Encrypted under CREDENTIAL_KEY, bound to this row's id. */
    credentials: text("credentials"),
    status: text("status", { enum: SOCIAL_PROFILE_STATUSES })
      .notNull()
      .default("pending_review"),
    assignedTo: text("assigned_to", { enum: SOCIAL_ASSIGNMENTS })
      .notNull()
      .default("business"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    allowRead: boolean("allow_read").notNull().default(true),
    allowRespond: boolean("allow_respond").notNull().default(false),
    allowPublish: boolean("allow_publish").notNull().default(false),
    approvalPolicy: text("approval_policy", { enum: SOCIAL_APPROVAL_POLICIES })
      .notNull()
      .default("required"),
    capabilities: jsonb("capabilities")
      .$type<{
        read: boolean;
        respond: boolean;
        publish: boolean;
        extras: string[];
      }>()
      .notNull()
      .default(sql`'{"read":true,"respond":false,"publish":false,"extras":[]}'::jsonb`),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastHealthAt: timestamp("last_health_at", { withTimezone: true }),
    lastHealthStatus: text("last_health_status", { enum: SOCIAL_HEALTH }),
    lastError: text("last_error"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedBy: uuid("connected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("social_profiles_provider_idx").on(t.provider, t.providerAccountId),
    index("social_profiles_status_idx").on(t.status),
    index("social_profiles_assignee_idx").on(t.assigneeUserId),
  ],
);

export const socialProfileLocations = pgTable(
  "social_profile_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => businessLocations.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_profile_locations_idx").on(t.profileId, t.locationId),
    index("social_profile_locations_location_idx").on(t.locationId),
  ],
);

/**
 * Canonical owned content (MASTER.md §33, C9.25).
 *
 * Ingested once, edited once, cross-published without creating loops.
 * `(source_provider, source_ref)` is the provider's own post id.
 * `content_digest` is what we actually said, so the same caption+bytes
 * arriving from another network is the same package, not a new one.
 */
export const socialPackages = pgTable(
  "social_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKind: text("source_kind", { enum: SOCIAL_SOURCE_KINDS }).notNull(),
    sourceProfileId: uuid("source_profile_id").references(() => socialProfiles.id, {
      onDelete: "set null",
    }),
    sourceProvider: text("source_provider"),
    sourceRef: text("source_ref"),
    contentDigest: text("content_digest").notNull(),
    parentPackageId: uuid("parent_package_id").references((): AnyPgColumn => socialPackages.id, {
      onDelete: "set null",
    }),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull().default(""),
    locale: text("locale").notNull().default("en"),
    canonicalUrl: text("canonical_url"),
    rights: text("rights", { enum: SOCIAL_RIGHTS }).notNull().default("owned"),
    provenance: jsonb("provenance").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("social_packages_source_idx")
      .on(t.sourceProvider, t.sourceRef)
      .where(sql`source_provider is not null and source_ref is not null`),
    index("social_packages_digest_idx").on(t.contentDigest),
    index("social_packages_parent_idx").on(t.parentPackageId),
  ],
);

export const socialPackageAssets = pgTable(
  "social_package_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => socialPackages.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_package_assets_idx").on(t.packageId, t.assetId),
    index("social_package_assets_asset_idx").on(t.assetId),
  ],
);

export const socialVariants = pgTable(
  "social_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => socialPackages.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    caption: text("caption").notNull().default(""),
    hashtags: text("hashtags").array().notNull().default(sql`'{}'`),
    assetIds: text("asset_ids").array().notNull().default(sql`'{}'`),
    aspectRatio: text("aspect_ratio", { enum: SOCIAL_ASPECTS }).notNull(),
    safeArea: jsonb("safe_area")
      .$type<{ top: number; bottom: number; left: number; right: number }>()
      .notNull(),
    durationSeconds: integer("duration_seconds"),
    generated: boolean("generated").notNull().default(false),
    status: text("status", { enum: SOCIAL_VARIANT_STATUSES }).notNull().default("draft"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("social_variants_package_idx").on(t.packageId),
    index("social_variants_profile_idx").on(t.profileId),
  ],
);

/** Where a package has appeared. The unique provider ref is the loop brake. */
export const socialPublications = pgTable(
  "social_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => socialPackages.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => socialVariants.id, {
      onDelete: "set null",
    }),
    profileId: uuid("profile_id").references(() => socialProfiles.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    status: text("status", { enum: SOCIAL_PUBLICATION_STATUSES }).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key"),
    /** First-party URL stamped on publish so visits close the loop (C9.27). */
    canonicalUrl: text("canonical_url"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_publications_ref_idx")
      .on(t.provider, t.providerRef)
      .where(sql`provider_ref is not null`),
    uniqueIndex("social_publications_idempotency_idx")
      .on(t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
    index("social_publications_package_idx").on(t.packageId),
    index("social_publications_scheduled_idx").on(t.scheduledAt, t.status),
  ],
);

export const socialInteractions = pgTable(
  "social_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => socialPackages.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => socialProfiles.id, {
      onDelete: "set null",
    }),
    providerRef: text("provider_ref").notNull(),
    kind: text("kind", { enum: SOCIAL_INTERACTION_KINDS }).notNull(),
    body: text("body").notNull(),
    authorHandle: text("author_handle").notNull(),
    authorEmail: text("author_email"),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_interactions_ref_idx").on(t.providerRef),
    index("social_interactions_contact_idx").on(t.contactId),
    index("social_interactions_package_idx").on(t.packageId),
  ],
);

export const socialGbpReviews = pgTable(
  "social_gbp_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    providerRef: text("provider_ref").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("social_gbp_reviews_ref_idx").on(t.providerRef),
    uniqueIndex("social_gbp_reviews_review_idx").on(t.reviewId),
    index("social_gbp_reviews_profile_idx").on(t.profileId),
  ],
);

export type SocialProfile = typeof socialProfiles.$inferSelect;
export type SocialPackage = typeof socialPackages.$inferSelect;
