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
