<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Documentation claim mapping — §§1–42 → acceptance evidence (C11.15)

*MASTER.md C11.15. Mapped 2026-09-16 against parent `5425821` (after #396
landed the F-criteria matrix; this change also carries that audit's
annotation-rewrite worklist to completion — see the C11.15 item).*

C11.15's remaining gap was: not every affirmative documentation claim in
§§1–42 had a passing acceptance test. This file is the inventory that closes
that gap. `deploy/spec-reconciliation.md` (C11.16) maps *sections* to schema,
services, UI and checklist items; this map goes one level down and maps
*claims* — the affirmative, testable capability statements in §§1-42 — to the
passing suite, gate or generated artifact that proves each one, or strikes the
over-claim in the same change.

**Method.** Every section of `MASTER.md` §§1–42 was read and its affirmative,
testable claims extracted, grouped into one row per claim cluster (a row names
the smallest set of related claims that one evidence set proves).
Doctrine, principles, historical rationale and anti-roadmap refusals are not
claims and are not rows. Each row is dispositioned:

- **Evidence** — the claim is proven by a passing test suite, gate script or
  generated artifact cited in the row. Every cited path resolves in the tree
  and every row cites at least one `*.test.ts` or gate script.
- **Narrowed** — §§1–42 over-claimed; the wording was corrected in the same
  change. Each Narrowed row names its strike entry (S1–S10 below), and
  `tests/core/doc-claim-mapping.test.ts` verifies the old wording no longer
  parses in MASTER.md and the new wording does.

Two judgement calls are recorded as documented behaviour, not scaffolds, per
the item text: §35's branded placeholder screenshots are the documented
store-gate stand-in (`apps/mobile/store/metadata.json`,
`scripts/mobile-store-gate.mjs`), and adapter "not implemented" strings are
F07 fail-closed refusals (`src/adapters/payments/provider-helpers.ts`,
`tests/core/payment-adapters.test.ts`).

**Status: COMPLETE.** All 42 sections are considered (no skips); every row
carries evidence or a same-change strike.

**Verification** (this change, before push):

- `pnpm exec vitest run tests/core/doc-claim-mapping.test.ts` — the mapping
  gate itself (pure, no database).
- `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/freeholder_claims_test pnpm exec vitest run tests/core tests/modules tests/adapters` — every cited
  suite executed on a disposable PostgreSQL 16 database: **351 files, 3,655
  passed, 17 skipped, 2 failed in one file** — the failure is the pre-existing
  `tests/modules/funnel.test.ts` cross-file isolation flake the #396 audit
  already recorded (fails identically on pre-change trees; 8/8 passing in
  isolation, re-run above). Run-environment fixes during verification:
  `CHANGELOG.md` regenerated for the new changeset, and the scratch database
  renamed to satisfy the C10.19 identity guard's `test|drill` name rule.
- `pnpm gates` (includes the mapping gate via `scripts/fast-gates.mjs`) and
  `pnpm plan:check` — on this base (#396 merged): 290 IDs, 272 checked, 18 open
  (exactly one more than the base's 271/19).
- HEAD at mapping time: this change (parent `5425821`, PR on
  `docs/doc-claim-mapping`).

## Struck or narrowed in this change

Each entry quotes old → new. The mapping gate fails if any Old string still
appears in MASTER.md or any New string is missing.

### S1 — §12 · Mail adapter `id` literal
- Kind: Narrowed
- Old: readonly id: "gmail" | "outlook" | "resend" | "smtp";
- New: readonly id: MailProvider; // smtp · console · gmail · outlook · resend · postmark · ses · none
- Why: the illustrative interface lagged `MailProvider` in `src/adapters/mail/types.ts` — SES, Postmark, console and `none` were missing from the doc while §12's own routing prose already names Resend/SES/Postmark.

### S2 — §21b · Droplet backup script path
- Kind: Narrowed
- Old: via `scripts/backup.sh`, restore rehearsal included in verify.md
- New: via `deploy/digitalocean-droplet/infra/backup.sh` (installed on the droplet as `/opt/freeholder/backup.sh`), restore rehearsal included in verify.md
- Why: no `scripts/backup.sh` exists; the shipped script lives in the recipe's `infra/` directory and deploys to `/opt/freeholder/backup.sh` (per `deploy/digitalocean-droplet/verify.md`).

### S3 — §25 · plugin-kit license
- Kind: Narrowed
- Old: The dev harness (part of MIT `plugin-kit`) is the make-or-break piece
- New: The dev harness (part of Apache-2.0 `plugin-kit`, like every package in this repository — §22's license policy) is the make-or-break piece
- Why: flatly false — every package is Apache-2.0 (`packages/plugin-kit/package.json`, the license gate, §22's license policy). C0.10 struck MIT on `create-freeholder`; this was the surviving sibling sentence.

### S4 — §27 · Hosted canonical registry and web catalog
- Kind: Narrowed
- Old: The canonical registry is itself generated (npm scan for the prefix + GitHub topic `freeholder-plugin`), so listing requires no gatekeeper for Community tier — publish and appear.
- New: The canonical registry URL ships as a seeded Verified entry; building the hosted index itself (npm scan for the prefix + GitHub topic `freeholder-plugin`) is hub infrastructure outside the instance tree. C3.11 ships what instances run: the signed index format, caching, federation and owner-added registries.
- Old: `plugins.freeholder.ai` doubles as the browsable web catalog
- New: A hosted browsable catalog at `plugins.freeholder.ai` — server-rendered, RIBA-structured, one page per plugin — is hub infrastructure, not an instance capability
- Why: the signed index format, caching and owner-added registries are instance code with passing coverage (`tests/core/plugins-lifecycle.test.ts`); the npm-scan build and the browsable catalog site are hub infrastructure that no instance test can prove, and none is claimed elsewhere in the tree.

### S5 — §28 · Hosted docs site with executable guides
- Kind: Narrowed
- Old: 5. **Docs site** (`docs.freeholder.ai`)
- New: 5. **Reference docs** — the human reference and `llms.txt`/`llms-full.txt` contract sections are generated from the same schemas in CI on every release (C3.06)
- Why: no docs site or doc-snippet runner exists in the tree. C3.06 ships the in-tree truth — generated human reference, `/llms.txt` and `/llms-full.txt`, and the drift gate — so the item now claims exactly that.

### S6 — §31 · Retrieval embeddings
- Kind: Narrowed
- Old: Embeddings for retrieval use pgvector
- New: Embeddings for retrieval live in the one sacred database
- Why: `src/modules/assistant/embed.ts` writes a `real[]` column and `src/modules/assistant/retrieve.ts` ranks by cosine in the service on stock Postgres — no pgvector extension exists in any migration. The architectural claim (no bolt-on vector store) stands; the product name was wrong.

### S7 — §4.8 · Instance release notes scope
- Kind: Narrowed
- Old: | `ReleaseNote` | The instance's own changelog — every functional change to *this site*, auto-drafted, owner-publishable.
- New: | `ReleaseNote` | The instance's own changelog — platform upgrades auto-draft entries today; wider event coverage remains work.
- Old: Whenever functionality on the site is CRUD'd
- New: platform upgrades already write it
- Why: `release_notes` exists (`src/core/update/schema.ts`) and platform-upgrade apply auto-drafts rows (`src/core/update/apply.ts`), but auto-draft for module toggles / plugin installs / setting changes, the agent-must-carry-a-note enforcement, and an admin timeline over instance notes are not built. The paragraph claimed all of them.

### S8 — §37 · Builder changes write a ReleaseNote
- Kind: Narrowed
- Old: Every accepted change writes its `ReleaseNote` (§4.8) — already mandatory for agent-made functional changes.
- New: Every accepted change is already audited with `actor = agent:<name>` (§4.8)
- Why: builder changes land in `AuditLog` today; ReleaseNote auto-drafting covers platform upgrades only (S7). The "already mandatory" claim was false.

### S9 — §38 · Release-notes bullet
- Kind: Narrowed
- Old: (§4.8), so nothing about their
- New: (§4.8 — platform upgrades
- Why: same scope correction as S7 — the day-one surface bullet now states what auto-drafts today.

### S10 — §34 · Changelog as share target
- Kind: Narrowed
- Old: newsletter issues, events, reviews, the changelog — one system
- New: newsletter issues, events, reviews — one system
- Why: no share target exists for instance release notes (no admin surface lists them; S7), so the enumeration covers exactly the entities `tests/modules/share.test.ts` proves.

## Claim map

| § | Claim | Disposition | Evidence |
|---|---|---|---|
| 1 | "What's inside": CMS/storefront, commerce, bookings, quotes→contracts→invoices, galleries, CRM, email, portal, first-party analytics, i18n and the MCP agent surface are shipped capabilities | Evidence | `tests/core/mcp.test.ts`, `tests/modules/subscriptions.test.ts`, `tests/core/bookings.test.ts`, `deploy/spec-reconciliation.md` |
| 1 | Quickstart contract: Replit template path, `npx create-freeholder` flow, Docker/Railway/Render/DO recipes in `deploy/`, demo load with one-click purge | Evidence | `tests/core/create-freeholder.test.ts`, `tests/core/demo-paths.test.ts`, `deploy/replit/recipe.yaml`, `deploy/README.md` |
| 1 | "Owning means being able to leave": one-button full export (database, media, human-readable archive) | Evidence | `tests/core/ownership-export.test.ts`, `tests/core/portability.test.ts` |
| 1 | License: Freeholder-authored code/SDK/deploy tooling/templates Apache-2.0; third-party material keeps its own notices | Evidence | `scripts/license-headers.mjs`, `packages/plugin-kit/package.json`, `LICENSING.md` |
| 1 | Contribution channel: owners file bugs/features/patches from the instance (admin, HTTP or MCP) to the hub; nothing sent until asked; GitHub PRs remain the merge path | Evidence | `tests/core/contribute.test.ts` |
| 2 | Contact spine: bookings, orders, quotes, invoices, gallery access, form submissions, email events, reviews and messages reference the contact; the CRM timeline is a view over TimelineEvents | Evidence | `tests/core/spine.test.ts`, `tests/core/resolver.test.ts`, `tests/core/contacts-read.test.ts` |
| 2 | Money converges on Invoice → Payment through a provider adapter; one reconciliation, refund and reporting path | Evidence | `tests/core/invoicing.test.ts`, `tests/core/payment-provider-service.test.ts`, `tests/core/money-arithmetic.test.ts` |
| 2 | Adapters isolate every external vendor (payments, mail, storage, SMS, calendar, AI, agent); core imports interfaces, never SDKs | Evidence | `tests/core/payment-adapters.test.ts`, `tests/core/mail-adapters.test.ts`, `tests/core/storage.test.ts`, `tests/core/edge-adapters.test.ts` |
| 2 | Agent-operable by design: admin UI, HTTP API and MCP all call the one service layer with the same permission checks | Evidence | `tests/core/service-composition.test.ts`, `tests/core/mcp.test.ts`, `tests/core/internal-services.test.ts` |
| 2 | First-party analytics stored locally and joined to the spine; experimentation events are native to the same store | Evidence | `tests/core/analytics.test.ts`, `tests/core/analytics-experiments.test.ts`, `tests/modules/funnel.test.ts` |
| 2 | One sacred database: ACID Postgres, transactions around multi-table mutations, no shadow stores; single-tenant (no tenant_id); SEO as architecture (SSR, RIBA, hreflang); boring technology (pg-boss, one framework) | Evidence | `tests/core/service.test.ts`, `tests/core/db-errors.test.ts`, `tests/core/transactional-jobs.test.ts`, `tests/core/seo-surface.test.ts`, `tests/core/locale-routing.test.ts` |
| 3 | Module map: core spine folders + commerce/services/content/growth/platform modules exist as `src/core`, `src/modules/*`, `plugins/*`; folder names are conceptual where noted | Evidence | `deploy/spec-reconciliation.md`, `tests/core/module.test.ts` |
| 3 | Modules toggle on/off hiding UI and API while retaining data; every module ships seed/demo data | Evidence | `tests/core/demo-scenarios.test.ts`, `tests/core/seed-demo.test.ts`, `tests/core/demo-migration.test.ts` |
| 4.1 | Identity entities (roles, grants, users, sessions, login security events) with authorization resolved from stored grants — no owner branch; OTP on staff logins | Evidence | `tests/core/roles.test.ts`, `tests/core/session-management.test.ts`, `tests/core/http-auth.test.ts`, `tests/core/two-factor.test.ts` |
| 4.1 | Staff invitations: private expiring link, resend rotates the token, revocation stops it, acceptance atomically creates exactly one user, lifecycle audited | Evidence | `tests/core/invitations.test.ts` |
| 4.1 | Customer magic links prove the Contact: 15-minute one-use raw-in-mail-only token, GET stages in an HttpOnly cookie and POST consumes, refuses staff-granted roles, merge/change invalidates; notable contact events emit TimelineEvents | Evidence | `tests/core/customer-magic-links.test.ts`, `tests/core/spine.test.ts` |
| 4.2 | One catalog spine: `kind` (physical/digital/service/rental/bundle/pass) decides extra tables; option matrices generate the variant grid; unlimited role-typed media | Evidence | `tests/core/catalog.test.ts`, `tests/core/catalog-variants.test.ts`, `tests/core/catalog-offerings.test.ts` |
| 4.2 | Pricing: price lists and audiences, price breaks in both tiered and volume arithmetic, deterministic single price-resolution function returning the winning reason | Evidence | `tests/core/price-breaks.test.ts`, `tests/core/catalog-pricing.test.ts` |
| 4.2 | Inventory: append-only StockMovement ledger, expiring StockReservation, optional per-product tracking, multi-location from the first migration, suppliers and purchase orders, back-in-stock subscriptions | Evidence | `tests/core/catalog-inventory.test.ts`, `tests/core/catalog-procurement.test.ts`, `tests/core/catalog-orders.test.ts` |
| 4.2 | Digital goods grant delivery tokens (no license-key table), rentals book resource calendars, passes spend through the same price resolver; guest/saved carts, wishlists and view-only redaction enforce cart access at the service boundary | Evidence | `tests/core/rentals.test.ts`, `tests/core/catalog-carts.test.ts`, `tests/core/cart-access.test.ts` |
| 4.3 | Money entities (Order, Quote, Contract, Invoice, Payment, Subscription, Tip, Coupon/GiftCard, AffiliateProgram/Code/CommissionEvent) with state machines enforced in the service layer, not the UI | Evidence | `tests/core/invoicing.test.ts`, `tests/core/catalog-orders.test.ts`, `tests/core/quotes.test.ts`, `tests/core/contract-templates.test.ts` |
| 4.3 | Customers pay where they read: one customer invoice page (portal session or HMAC link) starts hosted checkout; payment attempts commit before provider I/O and repeat requests reuse the outstanding attempt; the manual adapter shows instructions and records owner-attested receipts | Evidence | `tests/core/customer-invoices.test.ts`, `tests/core/payment-provider-service.test.ts`, `tests/core/promo-quote.test.ts` |
| 4.3 | First-party affiliate attribution: `?ref=` session code, windowed CommissionEvent, automatic refund reversal, manual/CSV payout batches through invoicing — no payout-provider adapter | Evidence | `tests/modules/referrals.test.ts`, `tests/modules/referrals-commission.test.ts` |
| 4.4 | Calendars for persons, the business and resources; availability computed at request time from rules, exceptions, busy blocks, buffers, lead time, horizon, granularity, capacity, compound requirements, assignment, travel time and caps | Evidence | `tests/core/calendars.test.ts`, `tests/core/availability.test.ts` |
| 4.4 | Bookings: status flow, reschedule-token links (plus portal selfService), policy-driven cancellation, intake forms and waivers held on the booking, waitlists, multi-channel reminders, UTC stored with booking timezone retained | Evidence | `tests/core/bookings.test.ts`, `tests/core/waitlists-and-policy.test.ts`, `tests/core/intake-waivers-reminders.test.ts` |
| 4.4 | Double-booking prevented by a database exclusion constraint over (calendar, time range) under concurrency; ICS everywhere without an adapter; two-way Google/Microsoft writeback behind the calendar family | Evidence | `tests/core/booking-concurrency.test.ts`, `tests/core/ics-and-writeback.test.ts`, `tests/core/calendar-sync.test.ts` |
| 4.5 | Media: one pipeline for uploads, responsive variants, alt text, watermarking, malware scanning and resumable direct upload; capture sessions (screen/camera/mic, share-sheet, QR, expiring upload links) converge on normal Assets | Evidence | `tests/core/media.test.ts`, `tests/core/media-capture.test.ts`, `tests/core/media-watermark.test.ts`, `tests/core/malware.test.ts` |
| 4.5 | Galleries: portfolio/client kinds, access modes (public/password/PIN/login), proofing selections, append-only access logs emitting TimelineEvents, print sales through the standard order flow | Evidence | `tests/core/gallery-proofing.test.ts`, `tests/core/gallery-sales.test.ts`, `tests/core/customer-galleries.test.ts`, `tests/core/client-galleries.test.ts` |
| 4.5 | Documents are revised not replaced: immutable versions, pinned or current shares, append-only access log surviving contact merge, exportable history | Evidence | `tests/modules/documents.test.ts` |
| 4.6 | CMS pages/posts with block bodies, definable forms whose submissions create/link contacts, 301 redirects, and a help centre that is the CMS (same editor, trigram search, yes/no helpfulness, indexable by default) | Evidence | `tests/core/cms-blocks.test.ts`, `tests/core/forms.test.ts`, `tests/modules/help-centre.test.ts`, `tests/core/c11-14-search.test.ts` |
| 4.7 | Growth: broadcasts with per-recipient delivery records feeding TimelineEvents, review collection/moderation, connected social accounts with explicit assignments, first-party analytics events joined through contact_id into one funnel query (tables are `broadcasts`/`mail_deliveries`, per the C11.16 recon) | Evidence | `tests/modules/broadcasts.test.ts`, `tests/core/reviews.test.ts`, `tests/modules/social.test.ts`, `tests/core/analytics.test.ts` |
| 4.8 | Platform: API keys with scopes, outbound webhooks with delivery logs, AuditLog on admin/agent mutations, module settings/toggles, versioned guidance flows and progress, deterministic demo scenarios, the opt-in contribution channel | Evidence | `tests/core/apikeys.test.ts`, `tests/core/webhooks.test.ts`, `tests/core/audit-labels.test.ts`, `tests/core/guidance.test.ts`, `tests/core/demo-scenarios.test.ts`, `tests/core/contribute.test.ts` |
| 4.8 | MCP authenticates as a scoped ApiKey against the same service layer; every mutation lands in AuditLog with `actor = agent:<key-name>` | Evidence | `tests/core/mcp.test.ts` |
| 4.8 | Instance release notes: the `release_notes` entity with kind/actor/source_ref/visibility exists and platform-upgrade apply auto-drafts entries; module/plugin/setting auto-draft, agent-must-carry-a-note enforcement and an admin timeline are named as remaining work (was: every functional change auto-drafted, owner-publishable) | Narrowed | S7 |
| 4.9 | Setup wizard captures country, locales, currency, timezone, units; business profile is one row, not satellite tables; EntityTranslation carries content translations with machine-draft review states; no FX-rate table and no `adapters/fx` family — money is never auto-converted; URL strategy is unprefixed default + prefixed locales with hreflang and per-locale sitemaps | Evidence | `tests/core/onboarding-contract.test.ts`, `tests/core/settings.test.ts`, `tests/core/locale-routing.test.ts`, `tests/core/i18n.test.ts` |
| 4.9 | Customer-facing surfaces follow Contact preferred locale and render in both business and contact timezones; RTL catalogs render from the locale's script; AI-assisted translation drafts stay flagged for review | Evidence | `tests/core/customer-locale.test.ts`, `tests/core/customer-locale-ui.test.ts`, `tests/core/i18n-gate.test.ts`, `tests/core/locale-quality.test.ts`, `tests/modules/translate.test.ts` |
| 4.10 | Locations and NAP: structured address/geo/phone, weekday or on-date opening hours, service areas, hidden-location access rules enforced on lists, pages and events, LocalBusiness JSON-LD, root-linked `/locations/` index, LocationPage as a CMS page | Evidence | `tests/core/locations.test.ts`, `tests/modules/location-pages.test.ts`, `tests/core/seo-public-entities.test.ts` |
| 4.11 | Shipping as a rate engine: most-specific zones, methods (flat/weight/price/item/dimensional/free/pickup/local delivery), rate bands and boxes with computed dimensional weight, split fulfillments, delivery windows, RMA; `requires_shipping` keeps digital/service lines out; carrier family is the `none` seam; fulfilment writes stock movements and TimelineEvents | Evidence | `tests/core/shipping-quote.test.ts`, `tests/core/catalog-fulfillment.test.ts`, `tests/core/edge-adapters.test.ts` |
| 4.12 | Tax engine: categories, zones, rates with compound/priority, inclusive/exclusive display per zone, reverse charge, threshold watching, stated rounding, snapshotted TaxLines; v1 templates for CA/EU/UK/US/AU/NZ; adapter family is `none` plus the built-in engine; named vendor calculators are not in the plan | Evidence | `tests/core/tax-templates.test.ts`, `tests/core/money-arithmetic.test.ts`, `tests/core/edge-adapters.test.ts` |
| 4.13 | Loyalty and referral on one ledger: earn rules as spine-event listeners, append-only points ledger with refund reversal and noticed expiry, tiers, rewards redeeming through the normal money path, attribution touches with read-time model choice, holdbacks with automatic reversal, manual payout batches, one-hop data model | Evidence | `tests/modules/loyalty.test.ts`, `tests/modules/loyalty-rewards.test.ts`, `tests/modules/referrals.test.ts`, `tests/modules/referrals-commission.test.ts` |
| 4.14 | Messaging: numbers with registration tracking, conversations with a reply channel separate from each message's channel, delivery receipts, keyword rules with STOP/START/HELP honoured first in every supported language, quiet hours resolved against the recipient's timezone | Evidence | `tests/core/sms.test.ts`, `tests/core/sms-keywords.test.ts`, `tests/core/sms-policy.test.ts`, `tests/core/conversations.test.ts` |
| 4.14 | Consent is per purpose and per channel and enforced in the service layer with no skip path; opt-out propagates across channels; per-message cost is recorded; templates are EmailTemplate rows; MMS media comes from core/media; site chat lands in the unified inbox | Evidence | `tests/core/sms-consent.test.ts`, `tests/core/sms-registration.test.ts`, `tests/core/sms-templates.test.ts`, `tests/core/site-chat.test.ts` |
| 4.15 | Access computed from EntitlementGrants; hard/soft/metered paywalls never ship gated content in the HTML; crawler honesty via `isAccessibleForFree`/`cssSelector` per seo_policy; plans state proration per plan; dunning is a retry schedule with grace and a chosen final action; billing modes provider/platform/manual; portal self-service change/pause/cancel | Evidence | `tests/core/paywalls.test.ts`, `tests/core/entitlements.test.ts`, `tests/modules/subscriptions.test.ts`, `tests/modules/subscription-billing.test.ts` |
| 4.16 | Ad inventory: seeded IAB sizes per breakpoint, slots that reserve their declared size, Advertiser as a Contact, campaigns/line items with targeting, dayparting and frequency caps, review state and labelled sponsored placements | Evidence | `tests/modules/ads.test.ts` |
| 4.16 | House fill by default; third-party tags consent-gated and off by default; `/ads.txt` generated; first-party MRC viewability measurement from the same analytics identifier; signed click-out counting; ad sales invoiced through the normal money path | Evidence | `tests/modules/ads-serving.test.ts`, `tests/modules/ads-third-party.test.ts`, `tests/modules/ads-measurement.test.ts` |
| 4.17 | One automation graph with deterministic and prompt steps: immutable versions pinned by runs, loops bounded at validation, per-(automation, version, trigger-key) idempotency, stated re-entry policy, waiting as rows; guardrails are run properties (consent, quiet hours, budget, approval gates); untrusted input is quoted data; failing steps retry then park; pause/kill/inspect are first-class; runs/steps/approvals/spend live in `core/runs` | Evidence | `tests/modules/automations.test.ts`, `tests/modules/automations-runtime.test.ts`, `tests/modules/automations-guardrails.test.ts`, `tests/core/agents-run.test.ts`, `tests/core/agents-pause.test.ts` |
| 5 | SEO as build requirements: server-rendered public surface, RIBA browse hierarchy within three hops with no orphans, per-page title/description/canonical/OG/JSON-LD/hreflang, locale-split sitemaps with IndexNow, robots blocking admin/portal/checkout, 301s on slug change, structural 404s | Evidence | `tests/core/seo.test.ts`, `tests/core/seo-gate.test.ts`, `scripts/seo-gate.mjs`, `tests/core/seo-surface.test.ts` |
| 5 | AEO and monetization surfaces: generated `/llms.txt` and `/llms-full.txt`, generated `/ads.txt`, paywall structured data matching the gate, programmatic location×service pages only where enabled with differentiated blocks | Evidence | `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`, `tests/core/seo-public-entities.test.ts`, `tests/modules/location-pages.test.ts` |
| 6 | The five cross-module flows (lead→cash, shoot→deliver→upsell, content→commerce, agent operations, contribution) compound with every arrow a TimelineEvent, proven against adapter doubles | Evidence | `tests/core/c11-02-catalog-journey.test.ts`, `tests/core/c11-03-booking-journey.test.ts`, `tests/core/c11-06-agent-journey.test.ts`, `tests/core/c11-07-mail-calendar-journey.test.ts` |
| 7 | The original deferred-to-v2 list (subscriptions/memberships, gift cards, PayPal, voice/video plugins) later shipped under §43; social auto-clipping did not and is not in the plan | Evidence | `tests/modules/subscriptions.test.ts`, `tests/core/product-gift-share.test.ts`, `tests/core/payment-adapters.test.ts`, `tests/core/first-party-plugins.test.ts` |
| 8 | Design decisions as built: custom fields jsonb on Contact, multi-currency without auto-FX, the §4.12 tax engine, en/fr/es + ar catalogs with logical CSS/RTL, hreflang in core routing | Evidence | `tests/core/contact-data-depth.test.ts`, `tests/core/i18n-gate.test.ts`, `tests/core/colour-literals.test.ts`, `tests/core/tax-templates.test.ts` |
| 9 | Stack as decided: Next.js App Router, strict TypeScript, Drizzle, PostgreSQL, pg-boss queue, S3-compatible storage, Tailwind with logical properties, ICU MessageFormat catalogs, hand-rolled Lucia-style sessions, Zod everywhere | Evidence | `package.json`, `tsconfig.json`, `tests/core/session-management.test.ts`, `tests/core/storage.test.ts`, `tests/core/i18n.test.ts` |
| 10 | Repository layout matches the tree with the as-implemented notes (catch-all public route, no `adapters/fx`, adapter families on disk); packages sdk/create-freeholder/templates/mobile-app/cli/plugin-kit ship Apache-2.0 | Evidence | `deploy/spec-reconciliation.md`, `tests/core/create-freeholder.test.ts`, `scripts/license-headers.mjs` |
| 11 | Module contract: `defineModule` manifests, boot topo-sort by `requires`, modules communicate only via the event bus and core services | Evidence | `tests/core/module.test.ts`, `tests/core/plugin-contract.test.ts` |
| 11 | The service registry is the single choke point: Zod validation, permission checks from session/API-key scopes, transactions, TimelineEvents and AuditLog on every method; `permission: "system"` services are registry-only and invisible to HTTP/OpenAPI/SDK/MCP | Evidence | `tests/core/internal-services.test.ts`, `tests/core/service-composition.test.ts`, `tests/core/service-output.test.ts` |
| 11 | Background work crosses the transaction boundary via `ctx.queueJob`: bounded retry/backoff, heartbeat leases, dead-letter queue with step-up controls, listener-aware outbox with replay | Evidence | `tests/core/transactional-jobs.test.ts`, `tests/core/outbox.test.ts`, `tests/core/job-runtime-health.test.ts`, `tests/core/runtime-shutdown.test.ts` |
| 12 | Payment adapter contract (checkout/subscription/refund/webhook/capabilities); methods vs providers; multiple live providers with eligibility rules; refunds return through the provider that took the money | Evidence | `tests/core/payment-adapters.test.ts`, `tests/core/payment-provider-service.test.ts`, `tests/core/pos-adapters.test.ts` |
| 12 | At-1.0 shipped providers Stripe, PayPal, manual — plus Square, Mollie, Razorpay, Paystack/Flutterwave (C5.07); crypto and raw-card providers refused, keeping PCI scope SAQ-A | Evidence | `tests/core/payment-adapters.test.ts` |
| 12 | Mail interface ships the full `MailProvider` set (smtp, console, gmail, outlook, resend, postmark, ses, none); transactional routes via the owner's Gmail/Outlook and bulk refuses to send through a personal mailbox; storage/calendar/sms/ai/tax/carrier/agent families ship `none` seams; accounting is export shapes, not an adapter family | Evidence | `src/adapters/mail/types.ts`, `tests/core/mail-adapters.test.ts`, `tests/core/mail-service.test.ts`, `tests/core/storage.test.ts`, `tests/core/tax-templates.test.ts` |
| 12 | The doc's illustrative mail interface omitted four shipped providers from the `id` literal (was: `gmail`, `outlook`, `resend`, `smtp` only) | Narrowed | S1 |
| 13 | Setup wizard `/setup`: owner account with OTP proof, business identity, international defaults, optional NAP, payments (or skip), module presets, reversible start path, first guided win; locked after completion | Evidence | `tests/core/onboarding-contract.test.ts`, `tests/core/two-factor.test.ts`, `tests/core/seed-demo.test.ts` |
| 13 | Every shipped role gets task-based guidance that resumes, dismisses and resets; GuidanceFlow/DemoScenario contributions arrive via the manifest registry with conformance tests | Evidence | `tests/core/guidance-definitions.test.ts`, `tests/core/guidance-ui.test.ts`, `tests/core/demo-scenarios.test.ts` |
| 14 | Replit-first deploy: `.replit`/`replit.nix` committed, Run = migrate → seed-if-empty → serve; `npx create-freeholder` scaffolds Railway/Render/DO/Docker; one Zod `env.ts` with doctor printing plain-English gaps | Evidence | `.replit`, `replit.nix`, `tests/core/create-freeholder.test.ts`, `tests/core/doctor.test.ts`, `tests/core/doctor-script.test.ts`, `src/core/env.test.ts` |
| 14 | Export is a feature: one admin button produces the full archive (SQL dump + media + human-readable JSON of every entity) | Evidence | `tests/core/ownership-export.test.ts`, `tests/core/portability.test.ts` |
| 15 | Quality gates 1–6: typecheck/lint/tests, SEO crawl gate, i18n gate (no hardcoded public strings, catalog completeness), money gate (no float arithmetic on money, no FX in charge paths), service-layer gate, changelog gate | Evidence | `scripts/fast-gates.mjs`, `eslint.config.mjs`, `tests/core/i18n-gate.test.ts`, `tests/core/seo-gate.test.ts`, `scripts/changelog-gate.mjs`, `tests/core/changelog-output.test.ts` |
| 15 | Quality gates 7–11: real-browser axe accessibility, upgrade gate (previous image booted, applied, rolled back), schema-compatibility gate, autofill gate, performance-budget gate | Evidence | `tests/core/a11y-smoke.test.ts`, `scripts/upgrade-gate.sh`, `tests/core/upgrade-gate.test.ts`, `tests/core/schema-compat-gate.test.ts`, `tests/core/autofill-safety.test.ts`, `scripts/performance-budgets.mjs`, `tests/core/performance-budgets.test.ts` |
| 15.1 | Performance budgets are defined per surface with p75/p95 rationale and the small-droplet reference target; measurement on the seeded medium dataset at reference scale remains C11.11 honesty | Evidence | `scripts/performance-budgets.mjs`, `tests/core/performance-budgets.test.ts`, `deploy/performance-measurements.md` |
| 16 | Agent conventions are enforced, not tribal: one §43 item per change with evidence, retired planning files stay retired, changesets gate functional CRUD | Evidence | `tests/core/plan-gate.test.ts`, `scripts/plan-gate.mjs`, `scripts/changelog-gate.mjs` |
| 17 | Configuration model: deployment target × adapter profile × business preset resolve to `freeholder.config.ts` plus Zod-validated env; doctor validates config+env; connected-account credentials are AES-256-GCM encrypted under `CREDENTIAL_KEY` with supported rotation; disaster recovery and the logical ownership export are two distinct artifacts; CI performs a real guarded dump/restore digest comparison | Evidence | `src/core/config.test.ts`, `src/core/env.test.ts`, `tests/core/doctor.test.ts`, `tests/core/mail-outbox-crypto.test.ts`, `tests/core/ownership-export.test.ts`, `tests/core/migrate.test.ts` |
| 18 | Recipe anatomy: every recipe ships recipe.yaml/README/.env.example/infra/verify.md; the storage mandate pins managed object storage on Tier-1; migration and update mandates with rollback; same app code on every target; CI runs a recipe validation matrix | Evidence | `deploy/replit/recipe.yaml`, `deploy/README.md`, `tests/core/deploy-recipe.test.ts`, `tests/core/recipes.test.ts`, `scripts/recipe-matrix.sh` |
| 19 | Support tiers 1–3 are defined and labelled in the recipe index and create-freeholder's target picker | Evidence | `deploy/README.md`, `tests/core/create-freeholder.test.ts`, `tests/core/recipes.test.ts` |
| 20 | Tier-1 Replit recipe: provisioning mapping with Replit Object Storage mandated, run button = migrate/seed/serve, honest limits (dev sleep, single-region) and the graduation path in migrate.md | Evidence | `deploy/replit/README.md`, `deploy/replit/recipe.yaml`, `deploy/replit/migrate.md`, `tests/core/recipes.test.ts` |
| 21 | DigitalOcean App Platform recipe: checked-in `infra/app.yaml` spec, managed PostgreSQL + Spaces + CDN, optional worker process, forced S3 constraint, cost table | Evidence | `deploy/digitalocean-app/infra/app.yaml`, `tests/core/recipes.test.ts` |
| 21 | Droplet recipe: compose app + Postgres + Caddy, cloud-init bootstrap, media mandated to Spaces, nightly backup shipped to a versioned bucket with restore rehearsal in verify.md (the doc cited `scripts/backup.sh`; the shipped script is the recipe's infra script) | Narrowed | S2 |
| 22 | create-freeholder flow: interactive target/preset/country/payments prompts write config + env + infra; `--non-interactive` requires every flag; `--migrate` refuses without `DATABASE_URL` | Evidence | `tests/core/create-freeholder.test.ts` |
| 23 | Migration between approved platforms: six Tier-1 targets, all 30 directed pairs exercised through the database restore/export drill with fingerprint comparison, byte-verified media transfer; restore onto another live Tier-1 instance remains the C11.08 hop | Evidence | `scripts/ownership-drill.mjs`, `tests/core/ownership-export.test.ts`, `tests/core/portability.test.ts`, `scripts/media-transfer.mjs`, `deploy/migration-runbook.md` |
| 23 | Site import studio: WordPress REST/WXR importer, generic-site crawler with limits/robots/review queue/typed-block output, importer extension contract for connector plugins | Evidence | `tests/core/importers.test.ts` |
| 24 | Plugins are modules under the same `defineModule()` contract plus plugin-only capabilities (blocks, widgets, adapters, theme hooks, verbs, import connectors, spine-attached custom entities); hard rules enforced: no cross-internals imports, no direct spine tables, money converges through invoicing | Evidence | `tests/core/plugin-contract.test.ts`, `tests/core/plugin-claims.test.ts`, `tests/core/cms-plugin-proof.test.ts` |
| 25 | Plugin DX bar: `create-freeholder-plugin` scaffold, dev harness booting the seeded demo, three install paths, installed plugins recorded in `freeholder.config.ts` (the harness is Apache-2.0 like every package — was: "MIT plugin-kit") | Narrowed | S3 |
| 26 | Trust model: declared permission scopes enforced at the registry with a network-egress wrapper; Verified/Community/Unlisted review tiers with the changelog-as-registry-requirement; signed releases verified before apply; per-plugin kill switch, boundary-caught errors, audit actor `plugin:<name>` | Evidence | `tests/core/plugin-contract.test.ts`, `tests/core/plugins-lifecycle.test.ts`, `tests/core/malware.test.ts`, `tests/core/update-feed.test.ts` |
| 27 | Registries are signed JSON indexes; owners add registry URLs (private/agency/marketplace); local/community/verified/private tiers with caching; the hosted canonical index build and browsable catalog site are hub infrastructure, not instance capabilities (was: canonical index auto-generated, catalog doubles as an SEO site) | Narrowed | S4 |
| 28 | The living platform contract: OpenAPI, SDK, MCP tools, `/llms.txt`+`/llms-full.txt` are all generated from the service registry with Zod schemas; per-instance introspection (`/api/openapi.json`, `/api/mcp`); the drift gate fails stale projections; outputs are described and enforced; hosted docs site with executable prose guides is not part of the v1 tree (was: docs.freeholder.ai with runnable snippets) | Narrowed | S5 |
| 29 | The ecosystem consequences rest on shipped capabilities: afternoon-plugin scaffolding, private registries, the Apache-2.0 SDK, MCP introspection of the live instance | Evidence | `tests/core/plugin-scaffold.test.ts`, `tests/core/plugins-lifecycle.test.ts`, `tests/core/sdk.test.ts`, `tests/core/mcp.test.ts` |
| 30 | Newsletters are first-class objects: per-newsletter subscriptions with double-opt-in consent records, one-click unsubscribe (RFC 8058), public archive pages in the sitemap | Evidence | `tests/core/newsletters.test.ts` |
| 30 | One template model serves newsletters, campaigns and transactional mail with locked variable slots, per-locale variants, test-send-to-self and reset-to-default | Evidence | `tests/modules/templates.test.ts` |
| 30 | The CRM working surface: deals/pipelines, tasks attachable to anything, notes with mentions, segments as the one definition of "who", transparent scoring rules, saved views, duplicates surfaced never auto-merged, relationships | Evidence | `tests/core/pipelines.test.ts`, `tests/core/tasks.test.ts`, `tests/core/notes.test.ts`, `tests/core/segments.test.ts`, `tests/core/scoring.test.ts`, `tests/core/saved-views.test.ts`, `tests/core/contact-duplicate-review.test.ts` |
| 30 | Consent is a record (purpose/method/timestamp/source); data requests are a workflow with a real export artifact and durable provider erasure; signup contact-import offer is owner-controlled, previewed, revocable and consent-free | Evidence | `tests/core/contact-privacy-rights.test.ts`, `tests/core/deferred-erasure.test.ts`, `tests/core/sms-consent.test.ts`, `tests/core/analytics-consent.test.ts`, `tests/core/signup-contact-import.test.ts` |
| 30 | Trash and recovery: notes/tasks/pages/forms/popups/segments/views keep rows with exclusions, fail-closed consumers, step-up typed purge, bounded daily sweep, merge repointing and erasure non-resurrection; money ledgers and append-only evidence are named not-applicable | Evidence | `tests/core/record-trash-families.test.ts`, `tests/core/record-trash.test.ts`, `deploy/record-trash.md` |
| 31 | Front-site assistant: optional module off by default, adapter-selected LLM, auto-grounded retrieval from what the site knows plus owner KnowledgeEntry rows, guardrails enforced outside the model, transcripts on the spine with knowledge-gap queue; embeddings live in Postgres as a `real[]` column ranked by cosine — no vector extension (was: "use pgvector") | Narrowed | S6 |
| 31 | LLM selection follows the adapter pattern: the Replit recipe default works through the host's OpenAI-compatible gateway (base URL + host key, no second signup); other targets are BYO key with a `none` fallback that hides the assistant | Evidence | `src/adapters/ai/openai.ts`, `src/adapters/ai/index.ts`, `tests/modules/assistant.test.ts` |
| 32 | One block editor for every public-facing surface: block library v1, drag/slash/inline editing, autosave with ContentRevision history and one-click restore, responsive and inbox preview | Evidence | `tests/core/cms-blocks.test.ts`, `tests/core/cms-rich.test.ts`, `tests/core/cms-history.test.ts`, `tests/core/cms-move.test.ts` |
| 32 | Structure is data: synced-or-detached Sections and templates, site chrome as Sections, design tokens emitted as CSS custom properties, per-entity block overrides, native server-side sticky A/B variants with conversion reporting, typed Zod blocks, the SEO contract enforced by the render pipeline | Evidence | `tests/core/cms-sections.test.ts`, `tests/core/cms-templates.test.ts`, `tests/core/design-tokens.test.ts`, `tests/core/theme.test.ts`, `tests/core/cms-experiments.test.ts`, `tests/core/analytics-experiments.test.ts` |
| 33 | Social hub: OAuth connect per profile with explicit assignment and publish policy, ingest into canonical packages with provenance and loop prevention, composer variants generated from live capability data, one calendar with idempotent retries and provider reconciliation | Evidence | `tests/modules/social-onboarding.test.ts`, `tests/modules/social-ingest.test.ts`, `tests/modules/social-composer.test.ts`, `tests/adapters/social-conformance.test.ts` |
| 33 | Google Business Profile is first-class: posts, opening-hours sync and review ingestion | Evidence | `tests/modules/social-gbp.test.ts` |
| 34 | Sharing is a property of every shareable entity: ShareTargets with generated OG images and channel intents, first-party tracked links attributed through analytics, partner sharing for galleries and quotes, embed codes with backlinks (the enumeration drops "the changelog" — instance release notes have no share target) | Narrowed | S10 |
| 35 | The white-label customer app is driven by the generated SDK: branded home, browse, book with push reminders, view/pay invoices, gallery proofing, messages, newsletters, back-in-stock pushes | Evidence | `tests/core/mobile-screens.test.ts`, `tests/core/mobile-app.test.ts`, `packages/mobile-app/src/branding.ts` |
| 35 | The app is a client, never a second implementation: screen contracts and `useScreenWrite`, honest instance discovery via `/.well-known/freeholder` with contract-version refusal, portal auth with keychain-held tokens, offline read-through/write-never with the media-capture queue as the stated exception, push as a delivery channel with dead-token deletion; device acceptance for the deferred items is §43.18 honesty | Evidence | `tests/core/mobile-app-shell.test.ts`, `tests/core/mobile-private-cache.test.ts`, `tests/core/mobile-capture-batches.test.ts`, `tests/core/push-devices.test.ts` |
| 35 | Always submission-ready: `freeholder-app init` pulls branding and writes store metadata, the store gate builds against the demo instance on every release; branded placeholder screenshots are the documented stand-in until a running demo captures real ones | Evidence | `tests/core/freeholder-app-init.test.ts`, `tests/core/mobile-store-gate.test.ts`, `scripts/mobile-store-gate.mjs`, `apps/mobile/store/metadata.json` |
| 36 | Mined-roadmap absorptions are shipped: rate limiting/login protection/2FA/security headers/dependency audit, responsive AVIF/WebP media pipeline, form anti-spam with quarantine, photo reviews, wishlists and saved carts, back-in-stock and waitlists, bundles/upsells, popups/announcement bars, the visual automation builder, the unified inbox with site chat | Evidence | `tests/core/rate-limit.test.ts`, `tests/core/security-headers.test.ts`, `tests/core/reviews.test.ts`, `tests/core/catalog-carts.test.ts`, `tests/core/catalog-inventory.test.ts`, `tests/modules/popups.test.ts`, `tests/modules/automations.test.ts`, `tests/core/inbox.test.ts`, `tests/core/site-chat.test.ts` |
| 36.1 | Autofill is machine-checked: submit controls are never disabled because an autofillable field looks empty, and honeypots carry non-autofillable names plus vendor opt-outs | Evidence | `tests/core/autofill-safety.test.ts` |
| 37 | The self-building instance: persistent affordance with one thread per instance, two lanes (structure = database write live next request; vocabulary = plugin PR through the owner's CI), preview diffs before publish, taste changes shipped as variants with splits, `pm_brain` default builder adapter with `none` removing it | Evidence | `tests/core/builder-authority.test.ts`, `tests/core/builder-content-lane.test.ts`, `tests/core/builder-code-lane.test.ts`, `src/adapters/agent/pm-brain.ts` |
| 37 | The envelope is architecture: owner-authenticated only, prompt injection treated as the live threat (untrusted content is data, never instruction), token budgets, one-action reversibility, `actor = agent:<name>` audit on every row | Evidence | `tests/core/agents-injection.test.ts`, `tests/core/builder-authority.test.ts` |
| 37 | The builder is reachable over MCP with `builder.*` as a separately granted scope, and `/source` emits version, plugins, license and the builder diff (builder changes are audited today; ReleaseNote auto-drafting covers platform upgrades only — was: every accepted change writes a ReleaseNote) | Narrowed | S8 |
| 38 | Teach by doing: several complete demo scenarios with guided day-in-the-life outcomes, role-based first runs, the public demo/guidance extension contract, and capture/phone ingest in the first lesson | Evidence | `tests/core/demo-scenarios.test.ts`, `tests/browser/demo-scenarios.spec.ts`, `tests/browser/guidance.spec.ts`, `tests/core/media-capture.test.ts` |
| 38 | Sell time, things and expertise from one system — including time tracking that becomes invoice lines in one step and in-person payments through the provider's terminal/tap-to-pay | Evidence | `tests/core/time-entries.test.ts`, `tests/core/invoicing-pos.test.ts`, `tests/core/pos-adapters.test.ts` |
| 38 | Show the work, know who everyone is, operate without fear: reporting an owner will read plus accounting exports in QuickBooks/Xero shapes, roles/invitations/2FA, owner-controlled backups with documented restore, help centre doubling as assistant corpus, e-signed waivers, and an instance that keeps itself patched — release notes auto-draft for platform upgrades today on the road to nothing changing silently (was: unqualified) | Narrowed | S9 |
| 39 | The customization contract: database/plugins/configuration/uploads are the named seams; core is never patched in place; the owner does not manage `package.json` | Evidence | `deploy/customization-seams.md`, `tests/core/update-seams.test.ts` |
| 39 | Versions, channels and the signed feed: stable/security/edge channels with machine-readable metadata; feed and image signatures are a hard stop; the daily jittered check is a plain GET with no telemetry and an explicit off switch | Evidence | `tests/core/update-feed.test.ts`, `tests/core/update-check.test.ts`, `deploy/release-feed.md` |
| 39 | Preflight, apply, rollback: signature/compatibility/dry-run/drift/environment checks before anything applies; snapshot → migrate → health-wait → cut over with kept previous container; expand-then-contract N-1 readability with `schema_breaking` refusal; security auto-apply in the business timezone with drain; the fork lane merges upstream into the owner's fork | Evidence | `tests/core/update-preflight.test.ts`, `tests/core/update-apply.test.ts`, `tests/core/update-fork.test.ts`, `tests/core/update-targets.test.ts`, `tests/core/schema-compat-gate.test.ts`, `tests/core/upgrade-gate.test.ts` |
| 39 | Update surfaces: the admin status line that is never ambiguous, the `freeholder update` CLI with cron-shaped exit codes, MCP tools with apply as a separate scope, and escalation notifications for outstanding security releases | Evidence | `tests/core/update-admin.test.ts`, `tests/core/update-cli.test.ts`, `tests/core/update-escalation.test.ts` |
| 40 | The agent workforce: managed and inbound connections, named agents holding their own scoped ApiKeys, tasks as a tree with dependencies, runs of service-layer steps, approvals with real previews, the spend ledger, reusable playbooks | Evidence | `tests/core/agents.test.ts`, `tests/core/agents-workforce-adapter.test.ts`, `tests/core/agents-approvals.test.ts`, `tests/core/agents-budgets.test.ts`, `tests/core/agents-playbooks.test.ts` |
| 40 | Execution is safe by construction: tasks claimed with leases (never pushed), runs bounded by wall-clock/step/budget checked before each step, failure retries then parks visibly, the owner gets a board, live run view, approvals queue, spend and a real kill switch; untrusted input never becomes instruction and never raises autonomy | Evidence | `tests/core/agents-run.test.ts`, `tests/core/agents-pause.test.ts`, `tests/core/agents-autonomy.test.ts`, `tests/core/agents-inbound.test.ts`, `tests/core/agents-injection.test.ts`, `tests/core/agents-board.test.ts` |
| 41 | Connected accounts belong to people: multiple accounts per provider, AES-256-GCM encrypted credentials under `CREDENTIAL_KEY`, rotation inside one transaction, `needs_reconnect` as a state, incremental authorization (ask for the least, ask later) | Evidence | `tests/core/connections.test.ts`, `tests/core/mail-outbox-crypto.test.ts`, `tests/core/calendar-oauth.test.ts`, `tests/core/mail-oauth.test.ts` |
| 41 | Busy time unions across every connected calendar while detail stays private (`busy_only` default), booking audiences computed as one lookup, mail read resolves correspondents into the spine, contact import merges through the duplicate queue | Evidence | `tests/core/calendar-busy.test.ts`, `tests/core/calendar-sync.test.ts`, `tests/core/booking-audiences.test.ts`, `tests/core/mail-import.test.ts`, `tests/core/contact-import.test.ts` |
| 41 | Everything synced from a connected account is `input_trust: untrusted`; connection access is granted per agent, per connection, separately from tool scopes | Evidence | `tests/core/connection-grants.test.ts`, `tests/core/agents-injection.test.ts` |
| 42 | Playbook scheduling runs on Postgres: one minutely sweep over due playbooks, `next_run_at`/`last_run_at`/`catch_up`/`timezone` semantics, a missed window runs once, overlap refused | Evidence | `tests/core/agents-schedule.test.ts` |
| 42 | Orchestration is prompt-based: the owner-authored prompt is trusted, everything it operates on is not (suggest-capped), and `params_schema` lets a playbook run by hand with different inputs | Evidence | `tests/core/briefing-playbooks.test.ts`, `tests/core/agents-autonomy.test.ts` |
| 42 | The daily briefing is assembled before the owner arrives by a scheduled job; sections come from declared contributors with severity and omission of empties; delivery extends to email/SMS | Evidence | `tests/core/briefing.test.ts`, `tests/core/briefing-contributors.test.ts`, `tests/core/daily-flow.test.ts` |

## What this file does not claim

- Product DONE — C11.17 remains unsigned.
- That every cited suite was re-run in this worktree for this mapping; the
  verification header names exactly what ran here, and CI re-runs everything
  on the PR.
- That Narrowed rows are feature removals — each names the remaining work in
  the new spec wording.
