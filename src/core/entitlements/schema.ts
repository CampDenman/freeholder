// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Access as grants, never as a flag on the content (MASTER.md §4.15, C9.14).
//
// §4.15: "who may see this" is a different question from "who paid", and
// conflating them is how content ends up gated by a boolean somebody forgot
// to check. An Entitlement is what a plan, pass, unlock, tier or manual
// decision grants. An EntitlementGrant is a person actually holding one.
// Access is computed from the grants at the moment of asking.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const GRANTOR_TYPES = ["plan", "pass", "unlock", "tier", "manual"] as const;
export type GrantorType = (typeof GRANTOR_TYPES)[number];
export const ENTITLEMENT_PERIODS = ["per_month", "per_cycle", "total"] as const;
export const ENTITLEMENT_STATUSES = ["active", "archived"] as const;
export const GRANT_STATUSES = ["active", "paused", "expired", "revoked"] as const;
export const PASS_BALANCE_STATUSES = ["active", "exhausted", "expired", "revoked"] as const;

export type Resource = { kind: string; selector?: string };

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grantorType: text("grantor_type", { enum: GRANTOR_TYPES }).notNull(),
    /** Plan, pass product, invoice, loyalty tier, or a manual decision. Untyped: core does not import modules. */
    grantorId: uuid("grantor_id").notNull(),
    name: text("name").notNull(),
    resource: jsonb("resource").$type<Resource>().notNull(),
    /** Null means unmetered. */
    quantity: integer("quantity"),
    period: text("period", { enum: ENTITLEMENT_PERIODS }).notNull().default("total"),
    priority: integer("priority").notNull().default(0),
    status: text("status", { enum: ENTITLEMENT_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("entitlements_grantor_idx").on(t.grantorType, t.grantorId),
    uniqueIndex("entitlements_grantor_resource_idx").on(
      t.grantorType,
      t.grantorId,
      sql`(${t.resource}->>'kind')`,
      sql`coalesce(${t.resource}->>'selector', '')`,
    ),
    check("entitlements_quantity_positive", sql`${t.quantity} is null or ${t.quantity} >= 1`),
  ],
);

export const entitlementGrants = pgTable(
  "entitlement_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "restrict" }),
    sourceSubscriptionId: uuid("source_subscription_id"),
    sourcePassBalanceId: uuid("source_pass_balance_id"),
    sourceUnlockId: uuid("source_unlock_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    used: integer("used").notNull().default(0),
    status: text("status", { enum: GRANT_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("entitlement_grants_contact_idx").on(t.contactId, t.status),
    index("entitlement_grants_entitlement_idx").on(t.entitlementId),
    index("entitlement_grants_subscription_idx").on(t.sourceSubscriptionId),
    uniqueIndex("entitlement_grants_subscription_live_idx")
      .on(t.entitlementId, t.contactId, t.sourceSubscriptionId)
      .where(sql`${t.sourceSubscriptionId} is not null and ${t.status} in ('active', 'paused')`),
    uniqueIndex("entitlement_grants_pass_live_idx")
      .on(t.entitlementId, t.contactId, t.sourcePassBalanceId)
      .where(sql`${t.sourcePassBalanceId} is not null and ${t.status} in ('active', 'paused')`),
    uniqueIndex("entitlement_grants_unlock_live_idx")
      .on(t.entitlementId, t.contactId, t.sourceUnlockId)
      .where(sql`${t.sourceUnlockId} is not null and ${t.status} in ('active', 'paused')`),
    uniqueIndex("entitlement_grants_manual_live_idx")
      .on(t.entitlementId, t.contactId)
      .where(
        sql`${t.sourceSubscriptionId} is null and ${t.sourcePassBalanceId} is null
          and ${t.sourceUnlockId} is null and ${t.status} in ('active', 'paused')`,
      ),
    check("entitlement_grants_used_nonnegative", sql`${t.used} >= 0`),
    check(
      "entitlement_grants_window",
      sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
);

/**
 * Prepaid quantity on a pass product. The grant is the access; this is the
 * remaining punches. Spending writes both.
 */
export const passBalances = pgTable(
  "pass_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    /** Catalog product of kind `pass`. Untyped so core never imports catalog. */
    productId: uuid("product_id").notNull(),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "restrict" }),
    quantityOriginal: integer("quantity_original").notNull(),
    quantityRemaining: integer("quantity_remaining").notNull(),
    sourceOrderId: uuid("source_order_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status", { enum: PASS_BALANCE_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("pass_balances_contact_idx").on(t.contactId, t.status),
    uniqueIndex("pass_balances_order_idx")
      .on(t.sourceOrderId, t.productId)
      .where(sql`${t.sourceOrderId} is not null`),
    check("pass_balances_original_positive", sql`${t.quantityOriginal} >= 1`),
    check("pass_balances_remaining_nonnegative", sql`${t.quantityRemaining} >= 0`),
  ],
);

/** A one-time purchase that unlocks a resource. The grant is the access. */
export const contentUnlocks = pgTable(
  "content_unlocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull(),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "restrict" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("content_unlocks_contact_idx").on(t.contactId),
    uniqueIndex("content_unlocks_invoice_idx").on(t.invoiceId),
  ],
);
