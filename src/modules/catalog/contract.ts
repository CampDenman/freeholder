// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared catalog vocabulary. Keeping these tuples here means the database,
// services and admin cannot quietly invent different product states.

export const PRODUCT_KINDS = [
  "physical",
  "digital",
  "service",
  "rental",
  "bundle",
  "pass",
] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_VISIBILITIES = [
  "public",
  "unlisted",
  "member_only",
] as const;
export type ProductVisibility = (typeof PRODUCT_VISIBILITIES)[number];

export function schemaTypeFor(kind: ProductKind): "Product" | "Service" {
  return kind === "service" ? "Service" : "Product";
}

export const ATTRIBUTE_KINDS = ["text", "number", "bool", "enum", "measure"] as const;
export const MEDIA_ROLES = [
  "hero",
  "gallery",
  "swatch",
  "size_chart",
  "lifestyle",
  "360",
  "model",
] as const;
export const PRICE_LIST_KINDS = [
  "retail",
  "wholesale",
  "member",
  "sale",
  "contract",
] as const;

export const RELATION_KINDS = [
  "upsell",
  "cross_sell",
  "accessory",
  "replacement",
  "variant_of",
] as const;

export const BUNDLE_PRICE_MODES = ["sum", "fixed", "percent_off"] as const;
export const PRICE_BREAK_MODES = ["volume", "tiered"] as const;

export const SERVICE_LOCATION_TYPES = [
  "in_person",
  "virtual",
  "client_site",
] as const;
export const SERVICE_DEPOSIT_TYPES = ["none", "fixed", "percent"] as const;
export const SERVICE_ASSIGNMENTS = ["specific", "pool", "round_robin"] as const;
export const CANCELLATION_FEE_TYPES = [
  "none",
  "fixed",
  "percent",
  "forfeit_deposit",
] as const;
export const PRICE_RULE_MODES = [
  "full",
  "deposit_balance",
  "payment_plan",
  "hourly",
  "retainer",
] as const;

export const STOCK_REASONS = [
  "sale",
  "return",
  "adjustment",
  "transfer",
  "receipt",
  "damage",
  "count",
] as const;
export const STOCK_HOLDERS = ["cart", "order", "booking"] as const;
export const RESERVATION_STATUSES = [
  "active",
  "consumed",
  "released",
  "expired",
] as const;

export const BACKORDER_POLICIES = ["refuse", "allow_date", "allow_silent"] as const;
export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "partial",
  "received",
  "cancelled",
] as const;

export const SHIPPING_METHOD_KINDS = [
  "flat",
  "weight",
  "price",
  "item",
  "dimensional",
  "free",
  "pickup",
  "local_delivery",
] as const;

export const CART_KINDS = ["cart", "saved"] as const;
export const CART_STATUSES = ["open", "converted", "abandoned"] as const;
export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "fulfilling",
  "fulfilled",
  "refunded",
  "cancelled",
] as const;

export const FULFILLMENT_KINDS = ["physical", "digital"] as const;
export const FULFILLMENT_STATUSES = [
  "pending",
  "picking",
  "packed",
  "shipped",
  "delivered",
  "failed",
  "returned",
] as const;
export const RETURN_STATUSES = [
  "requested",
  "approved",
  "received",
  "refunded",
  "rejected",
] as const;

export const COUPON_KINDS = ["percent", "fixed", "free_shipping"] as const;
export const GIFT_CARD_STATUSES = ["active", "redeemed", "void"] as const;
export const OFFER_RULE_KINDS = ["bump", "post_add"] as const;
