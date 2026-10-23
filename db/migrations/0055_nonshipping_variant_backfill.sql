-- Copyright (C) 2026 Tony Aly
-- SPDX-License-Identifier: Apache-2.0
-- C5.21: variants of downloads, services and passes stop asking for a postal
-- address. `product_variants.requires_shipping` defaults to true, and the
-- variant matrix used to take that default for every kind, so a voucher or a
-- download demanded an address and a delivery method nobody could quote
-- (2026-10-23 demo audit). New variants now follow the product's kind; this
-- brings existing ones into line. Physical, rental and bundle variants keep
-- whatever the owner set.
UPDATE "product_variants" SET "requires_shipping" = false
FROM "products" p
WHERE p."id" = "product_variants"."product_id"
  AND p."kind" IN ('digital', 'service', 'pass')
  AND "product_variants"."requires_shipping" = true;
