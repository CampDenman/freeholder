<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-29

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Refresh GitHub before treating anything below as shipped.

## C3.24 — native storefront parity mapping published (box stays open)

The 2026-09-27 owner decision ("freeholder should put shopify out of business"
— the native store is the product, the Shopify importer is a migration bridge)
gets its proof instrument: the capability mapping at
`deploy/c324-storefront-parity-2026-09-29.md`.

- **Eleven Shopify-core rows, ground truth over optimism.** Every native claim
  cites the test file that proves it: products/variants, discounts/coupons,
  customer accounts/portal, order management with notifications, first-party
  analytics, SEO/marketing surfaces, shipping/taxes, apps/webhooks and
  design-token theming are native ✓ — several deeper than the benchmark
  (price lists and tiered/volume breaks, append-only inventory ledger with
  procurement, deterministic shipping engine, signed webhook subscriptions).
- **One partial, honestly labelled.** Cart/checkout is native and deep at the
  service layer (persistent carts, one-transaction checkout into an issued
  invoice, idempotent payment) but the public self-serve storefront UI —
  cart page, checkout, order confirmation — does not exist yet; no route
  outside admin calls the cart services.
- **Two gaps, dispositioned.** There is no product collections/categories
  taxonomy (schema-confirmed: only the invoicing tax-category key exists),
  no faceted public browse and no storefront search. Both gaps are fix-now,
  assigned to C3.25 (storefront commerce) and C2.24 (editor blocks); the
  mapping feeds those items' gap lists. Deferred with reasons: live carrier
  labels (documented adapter seam), theme marketplace (§36 anti-roadmap),
  third-party analytics pixels (§36 anti-roadmap).
- **The importer stays a bridge.** The Shopify connection imports paid
  order/refund history only, within Shopify's documented limits (60-day
  history, 500-page stop, orders and refunds as reviewable draft invoices) —
  it does not import the catalog, which is what the native store owns.
- **The checklist box stays open, deliberately.** C3.24's wording requires
  every provable gap closed; closure lands via C3.25/C2.24, and the
  f-criteria-matrix row updates to dated evidence at that closure. No gate
  was weakened to flip it early.
