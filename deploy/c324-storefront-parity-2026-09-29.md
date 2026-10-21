<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# C3.24 — Native Storefront Parity Mapping (Shopify-core benchmark)

*Published 2026-09-29 under C3.24 (owner decision 2026-09-27, Tony Aly: "freeholder
should put shopify out of business" — the native store is the product; the Shopify
importer is a migration bridge, not an ongoing dependency). This document is the
capability mapping C3.24's evidence standard names: it maps Shopify-core storefront
capability onto Freeholder's native equivalent, marks each row native ✓ / partial ~ /
gap ✗ with repository citations, and dispositions every gap to a named plan item.
Its gap list fed C3.25 (storefront commerce parity) and C2.24 (storefront editor
blocks); both gaps closed on 2026-09-29 (G1 via C3.25 slices 1–2 + C2.24; G2 via
C3.25 slice 3 + C2.24), and rows 2–3 below carry the native flips with cited tests.*

## Method

Ground truth over optimism. Every ✓ row cites the test file that proves it, and
every path was opened and verified to exist on `origin/main` at this change's parent.
Depth claims cite the service and table they rest on; absence claims cite the schema
sweep that found nothing. Where the honest answer is "the service exists and is deep
but the public screen does not", the row says ~ and the gap is dispositioned.

## The mapping

### 1. Products / variants / options — ✓ native (deeper than the benchmark)

| | |
|---|---|
| Shopify-core | Products with options and generated variants, per-variant price/SKU/media. |
| Freeholder | Product lifecycle for six kinds incl. physical/digital/service/rental/bundle/pass (`src/modules/catalog/service.ts`, C5.09); option types/values + generated variant matrices with safe reconciliation (`src/modules/catalog/variants.ts`, `catalog.applyVariantMatrix`, C5.10); attributes, filtering and comparison (`src/modules/catalog/merchandising.ts`, C5.11); unlimited ordered media with variant swaps incl. 3D/AR (C5.11). Admin: `/admin/products`. |
| Proof | `tests/core/catalog-variants.test.ts`, `tests/core/catalog-merchandising.test.ts` |
| Depth beyond Shopify | Reusable option dimensions across products; attribute comparison; six product kinds through one contract. |
| Disposition | None. |

### 2. Collections / categories + faceted browse — ✓ native

| | |
|---|---|
| Shopify-core | Product collections/categories, taxonomy, faceted storefront browse, storefront search. |
| Freeholder | Collections and collection_products tables with services, trash/restore/purge, segment-driven rule membership, public /c/<slug> pages with SEO stamping (C3.25 slice 1, `src/modules/catalog/collections.ts`, migration `db/migrations/0020_collections.sql`); one `catalog.browseProducts` query powers the /c/<slug> filter/sort UI and the /search page — facet dimensions from option types, filterable attributes, anonymous-mirror price bands and availability, filter state in crawlable query params (C3.25 slice 2, `src/modules/catalog/browse.ts`, `app/(public)/browse-params.ts`, `app/(public)/browse/`, `app/(public)/search/`); the editor blocks render the same machinery on composed pages — productGrid (collection pick, optional facet panel, sort, pagination), featuredCollection (hero + curated front), storeSearch (term search scoped to the page's own ?q) — through the storefront's own CollectionGrid/FacetPanel/SortLinks/SearchBox components, so a composed page and an entity page cannot diverge (C2.24, `src/modules/cms/blocks/merchandising.tsx`). |
| Proof | `tests/core/catalog-collections.test.ts`, `tests/core/collections-storefront.test.ts`, `tests/core/catalog-browse.test.ts`, `tests/core/browse-storefront.test.ts` (services and both pages); `tests/core/merch-blocks.test.ts` (the blocks, canvas and public, EN/FR/ES/AR) |
| Depth beyond Shopify | Rule-based (segment-driven) membership alongside manual curation, through one reconciliation path; the same browse query feeds the page, the search surface and the editor blocks. |
| Disposition | None — G1 closed by C3.25 slices 1–2 (taxonomy, faceted browse, storefront search) and C2.24 (the collection/facet/search blocks), 2026-09-29. |

### 3. Cart / checkout — ✓ native (services and public self-serve UI)

| | |
|---|---|
| Shopify-core | Visitor adds to cart, checks out, pays, gets an order confirmation — self-serve on the storefront. |
| Freeholder (services) | Persistent/contact-attached carts with guest tokens, cross-device restore, merge, wishlists, price/stock refresh, abandonment events (`src/modules/catalog/cart.ts`, C5.20); checkout creates the order and an issued invoice in one transaction with shipping quote, tax, consent, idempotency and failure recovery (`catalog.checkoutCart`, C5.21); `payOrder` convergence. Gallery selling runs through the same cart (`galleries.addToCart`, `src/modules/galleries/service.ts`). |
| Proof (services) | `tests/core/catalog-carts.test.ts`, `tests/core/cart-access.test.ts`, `tests/core/gallery-sales.test.ts` |
| Freeholder (public UI) | Add-to-cart with a variant picker on the shelf, the product detail block and product cards, quoting the cart's own resolvePrice/availability sources (`catalog.purchaseOptions`); the guest cart capability in an HttpOnly cookie; a cartWidget chrome block; public /cart, /checkout and /orders/confirm pages — checkout proves the email first through the platform's customer magic link, and guest order lookup extends the cart-token gate via `catalog.shopperOrder` (C3.25 slice 3, `src/modules/catalog/storefront.ts`, `app/(public)/buy/`, `app/(public)/cart/`, `app/(public)/checkout/`, `app/(public)/orders/confirm/`). The buy affordance reaches composed pages through C2.24's buyButton block and the upgraded productCard, rendered by the same AddToCart component the shelf uses (`src/modules/cms/blocks/merchandising.tsx`, `src/modules/cms/blocks/surfaces.tsx`). |
| Proof (public UI) | `tests/core/storefront-commerce.test.ts`, `tests/core/cart-storefront.test.ts`, `tests/browser/storefront-checkout.spec.ts` (browse → variant picker → cart → email proof → order → token-gated confirmation); `tests/core/merch-blocks.test.ts` and `tests/browser/storefront-merch-blocks.spec.ts` (a page composed of the merchandising blocks: browse, filter, buy). |
| Disposition | None — G2 closed by C3.25 slice 3 (public cart/checkout/confirmation pages) and C2.24 (the buy affordance on product blocks), 2026-09-29. |

### 4. Discounts / coupons — ✓ native

| | |
|---|---|
| Shopify-core | Discount codes, gift cards, automatic promotions, recovery offers. |
| Freeholder | Coupons (percent/fixed/free-shipping) as invoice discount lines; gift cards with remaining-balance ledger paying through the customer-balance journal; bundles, order bumps and post-add offers as `offer_rules`; abandoned-cart recovery with one coupon + contact notice — no parallel money paths (`src/modules/catalog/promotions.ts`, `src/modules/catalog/promo-quote.ts`, C5.23). Admin: `/admin/promotions`; customer gift-card share page `app/gift/[token]/page.tsx`. |
| Proof | `tests/core/promo-quote.test.ts`, `tests/core/catalog-promotions.test.ts` |
| Disposition | None. |

### 5. Customer accounts / portal — ✓ native

| | |
|---|---|
| Shopify-core | Customer accounts: order history, profile, self-serve detail pages. |
| Freeholder | Passwordless magic-link sign-in (`app/portal/login`, `app/portal/magic`); a portal room registry where modules claim rooms over the same services admin uses (`src/core/portal/sections.ts`) — orders (`src/modules/catalog/portal.ts`), invoices, quotes, bookings, subscriptions, rentals, projects, documents, contracts, galleries, messages, referral earnings; profile and privacy pages; gift registry `/portal/registry`. |
| Proof | `tests/core/portal-shell.test.ts`, `tests/core/portal-rooms.test.ts` |
| Honest note | Portal order *detail* pages are deliberately reached by emailed view tokens (`href: null` in the orders room is a recorded refusal, not an omission — a list must not carry credentials). Parity is at the capability level; the depth choice is documented in `src/core/portal/sections.ts`. |
| Disposition | None for the account itself; order-detail-in-portal is covered by the C3.25 public-confirmation-page gap if closure wants session-native detail. |

### 6. Order management + notifications — ✓ native

| | |
|---|---|
| Shopify-core | Admin order pipeline, fulfillment, returns, customer order notifications. |
| Freeholder | Order lifecycle with mixed physical/digital/service lines and timeline (`src/modules/catalog/orders.ts`, C5.22); split shipments, tracking, digital delivery, RMA with restock/refund convergence (`src/modules/catalog/fulfillment.ts`, C5.19). Admin: `/admin/orders`, `/admin/fulfillment`, `/admin/returns`. Notifications: contact notices on ship/deliver/return-decision/refund (`notifyContact`, `src/modules/catalog/fulfillment.ts`); `order.placed`/`paid`/`cancelled` outbox events fan out on the webhook bus (C5.22); durable per-recipient fanout contract in `deploy/notification-fanout.md`. |
| Proof | `tests/core/catalog-orders.test.ts`, `tests/core/catalog-fulfillment.test.ts`, `tests/core/notifications.test.ts` |
| Disposition | None. |

### 7. Analytics — ✓ native (first-party, consent-gated)

| | |
|---|---|
| Shopify-core | Store analytics: traffic, conversion, funnels. |
| Freeholder | First-party analytics: pageview/event tracking, visitor identity, Web Vitals, overview/top-pages/top-referrers/daily (`src/modules/analytics/service.ts`); revenue/cohort/funnel reporting with saved views (`src/modules/reporting/service.ts`); admin `/admin/reports`, `/admin/traffic`; consent governance (`src/modules/analytics/settings.ts`). Deliberately no third-party pixels in core (§36 anti-roadmap). |
| Proof | `tests/core/analytics.test.ts`, `tests/core/analytics-consent.test.ts`, `tests/core/analytics-experiments.test.ts`, `tests/core/reporting.test.ts`, `tests/core/funnel.test.ts` |
| Disposition | None. |

### 8. SEO / marketing surfaces — ✓ native

| | |
|---|---|
| Shopify-core | SEO surfaces (sitemap, feeds, OG, structured data), email/popups/reviews/loyalty marketing apps. |
| Freeholder | Public entity registry driving OG images, `/feeds/{kind}.xml`, IndexNow, JSON-LD, automatic `/products` + product pages (`src/core/seo/`, C2.21); sitemap + URL redirects admin; marketing modules with the mined-roadmap (§36) absorptions: newsletters, popups, first-party ads with consent-gated third-party creative kind, social, photo reviews, loyalty/rewards, referrals, segments, and the automations engine as the Klaviyo-equivalent flow builder. |
| Proof | `tests/core/seo-surface.test.ts`, `tests/core/seo-public-entities.test.ts`, `tests/core/seo-gate.test.ts`, `tests/core/newsletters.test.ts`, `tests/core/popups.test.ts`, `tests/core/ads.test.ts`, `tests/core/reviews.test.ts`, `tests/core/loyalty.test.ts`, `tests/core/referrals.test.ts`, `tests/core/segments.test.ts`, `tests/core/automations.test.ts` |
| Disposition | None. |

### 9. Shipping / taxes — ✓ native

| | |
|---|---|
| Shopify-core | Shipping zones/rates/labels; sales tax calculation and remittance-readiness. |
| Freeholder | Shipping zones with most-specific match, a deterministic rate engine (flat/weight/price/item/dimensional/free/pickup/local-delivery), packaging + dimensional weight, carrier adapter seam, shipments and split fulfillment (`src/modules/catalog/shipping.ts`, `src/modules/catalog/shipping-quote.ts`, C5.18/C5.19). Taxes: zones/categories/exemptions/reverse-charge/shipping-tax with immutable `TaxLine` snapshots and owner-visible explanations; 94 source-attributed CA/EU/UK/US/AU/NZ starter templates (`src/modules/invoicing/`, C5.02–C5.04). |
| Proof | `tests/core/shipping-quote.test.ts`, `tests/core/money-arithmetic.test.ts`, `tests/core/invoicing.test.ts`, `tests/core/tax-templates.test.ts` |
| Disposition | None for calculation/engine depth. Live carrier label purchase stays on carrier adapters (documented adapter seam, C5.18) — deferred, not a parity gap: label buying is provider work, and the seam is the shipped contract. |

### 10. Apps / webhooks extensibility — ✓ native

| | |
|---|---|
| Shopify-core | App ecosystem; outbound webhooks on store events. |
| Freeholder | Signed webhook subscriptions over the outbox bus with rotate/inspect/replay and per-event deliveries (`src/core/webhooks/service.ts`, `deploy/notification-fanout.md`); the plugin platform (registry, isolation, scaffolding, kit, lifecycle — C3.01–C3.12) as the app-ecosystem equivalent; the automations engine with plugin-contributed verbs as the integration-platform equivalent. |
| Proof | `tests/core/webhooks.test.ts`, `tests/core/plugins-lifecycle.test.ts`, `tests/core/automations.test.ts`, `tests/core/automations-runtime.test.ts` |
| Disposition | None. |

### 11. Themes / visual customization — ✓ native (design-token model, deliberate scope)

| | |
|---|---|
| Shopify-core | Theme store; visual customization of the storefront. |
| Freeholder | Semantic design tokens with owner-editable light/dark themes, fonts, radius, motion, measure, gutter and logo (`src/core/design/`, admin `/admin/design`, C2.15); the block editor and reusable sections for page composition (C2.x); the two-lane builder for conversational restyling with preview diffs (§37). No theme marketplace — deliberate: §36's anti-roadmap excludes page-builder lock-in formats; theming is token-level and portable. |
| Proof | `tests/core/theme.test.ts`, `tests/core/cms-blocks.test.ts` |
| Disposition | None. Marketplace-style prebuilt themes are deferred by the anti-roadmap, not by missing capability. |

## Gap disposition summary

| # | Gap | Status | Disposition |
|---|---|---|---|
| G1 | No product collections/categories taxonomy, no faceted public browse, no storefront search | ✓ closed 2026-09-29 | **C3.25** slices 1–2 (tables/services + public browse/search), **C2.24** (collection/facet/search blocks) — rows flip native with cited tests |
| G2 | No public self-serve storefront cart/checkout/order-confirmation UI (services are native and deep) | ✓ closed 2026-09-29 | **C3.25** slice 3 (public pages on existing services), **C2.24** (buy affordance on product blocks) — row flips native with cited tests |
| G3 | Live carrier label purchase | deferred | Documented adapter seam (C5.18); provider work, not a parity gap |
| G4 | Prebuilt theme marketplace | deferred | §36 anti-roadmap (no lock-in formats); token-level theming ships |
| G5 | Third-party analytics pixels as core | deferred | §36 anti-roadmap; first-party analytics ships |

Counts: both fix-now gaps closed (G1 via C3.25 slices 1–2 + C2.24; G2 via C3.25 slice 3 + C2.24). 3 deferred with reasons. Native ✓: 10 rows (products/variants, **collections/faceted browse/storefront search**, discounts/coupons, customer accounts, orders+notifications, analytics, SEO/marketing, shipping/taxes, apps/webhooks, themes) — cart/checkout promoted from partial ~ to native ✓ on 2026-09-29 with its public UI proven. Partial ~: 0.

## Shopify importer positioning (migration-only)

The marketplace plugin's Shopify connection imports **paid order and refund
history only** — `read_orders` + `read_customers` scopes, GraphQL Admin API
`2026-07`, 50 orders per page, a 500-page stop with no incremental history
workflow, Shopify's own 60-day history limit unless approved access is granted,
paid/non-test/non-cancelled orders only, each landing as a reviewable draft
invoice through the canonical contact/invoicing services; later source edits and
cancellations do not update previous imports (`plugins/marketplace/shopify.ts`;
full limits in `deploy/first-party-plugins.md`). It does not import products,
collections, customers-as-catalog or themes — the native store owns those, which
is what makes this mapping, not the importer, the parity instrument. This
positioning is recorded in MASTER.md §36, C3.13 and C3.24 (owner decision
2026-09-27); tests: `tests/core/shopify-adapter.test.ts`,
`tests/core/shopify-sync.test.ts`, `tests/core/shopify-refunds.test.ts`.

## What closes C3.24

C3.24's box requires the mapping **and** the gaps closed. This document is the
mapping; closure landed when C3.25 (G1, G2 storefront commerce) and C2.24 (G1,
G2 editor blocks) closed their gap lists — **both gaps closed 2026-09-29**: G1
by C3.25 slices 1–2 plus C2.24's collection/facet/search blocks, G2 by C3.25
slice 3 plus C2.24's buy affordance on the product blocks. Rows 2–3 above flip
to native ✓ with the cited tests, and `deploy/f-criteria-matrix.md`'s C3.24 row
carries the dated evidence.
