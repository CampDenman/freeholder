# FREEHOLDER — Master Project Document

**The open-source operating system for a one-person business.**
Draft v2 (unified) · July 2026 · Tony Aly · AGPL-3.0 core / MIT SDK & templates

This single document is the canonical source of truth for the project. On repo day, §1 gets excerpted as `README.md`; everything else ships as-is.

## Contents

**The pitch** — 1. Why Freeholder
**Architecture** — 2. Principles · 3. Module Map · 4. Data-Model Spine · 5. The SEO Layer · 6. Cross-Module Flows · 7. Build Order (v1 slice) · 8. Open Decisions
**Build contract** — 9. Stack Decisions · 10. Repository Layout · 11. Module Contract · 12. Adapter Contract · 13. Setup Wizard · 14. Replit-First Deploy Story · 15. Quality Gates (CI) · 16. Agent Conventions
**Deployment** — 17. Configuration Model · 18. Recipe Anatomy & Mandates · 19. Support Tiers · 20. Recipe: Replit · 21. Recipe: DigitalOcean · 22. create-freeholder · 23. Migration Matrix
**Extensibility** — 24. Plugins: The Design Bet · 25. Plugin DX · 26. Trust Model · 27. Federated Registries · 28. The Living Platform Contract · 29. What This Buys the Ecosystem
**Going big** — 30. CRM Depth · 31. Front-Site AI Assistant · 32. Universal Drag-and-Drop Editor · 33. Social Media Hub · 34. Sharing DNA · 35. React Native App · 36. Mined Roadmap (WordPress & Shopify)

---

## 1. Why Freeholder

**The open-source operating system for a one-person business.**

Stop leasing your business. Website, store, bookings, quotes, invoices, client galleries, CRM, email, analytics — one deploy, one database, one login. Yours.

---

### The problem

Running a small business or creative practice today means renting a stack: a site builder, a booking tool, a gallery platform, a CRM, an invoicing app, an email service, a link-in-bio, an analytics dashboard. Each one owns a silo of *your* customer. Each one charges monthly rent. None of them talk to each other, so you are the integration layer — copy-pasting between tabs at 11pm.

### The idea

In property law, a **leaseholder** pays rent forever for something they'll never own. A **freeholder** owns the thing outright.

Freeholder is a single open-source application that replaces the rented stack. Everything hangs off one spine — a unified contact record — so your customer's bookings, orders, quotes, invoices, gallery views, and email opens are one timeline, not nine dashboards. Deploy it once, on infrastructure you control, and own your entire business system.

### What's inside

- **Website + CMS** — server-rendered, SEO-serious by construction (clean browse architecture, full schema.org, hreflang, auto sitemaps, llms.txt)
- **Commerce** — products (physical, digital, services), cart, checkout, coupons, gift cards; Stripe first, PayPal adapter
- **Bookings** — availability, deposits, reminders, reschedule links, 2-way Google/Outlook calendar sync
- **Quotes → contracts → invoices** — send quotes, negotiate line items with logged-in prospects, click-to-sign, deposits, payment plans
- **Client galleries** — password/PIN/login access, proofing and selects, watermarks, download policies, print sales
- **CRM** — every contact, every interaction, one timeline; forms and intake questionnaires feed it automatically
- **Email** — transactional through your own Gmail/Outlook; campaigns and simple automations through a bulk adapter
- **Customer portal** — your clients get one login for their quotes, invoices, bookings, files, and galleries
- **First-party analytics** — privacy-first, cookie-banner-free, joined to your CRM: visit → lead → quote → paid, one funnel
- **Multilingual + international** — locales, currencies, timezones, tax zones, and NAP/local-SEO built into the core, not bolted on
- **AI-native** — a bundled MCP server exposes the whole admin surface to your AI assistant, with scoped permissions and a full audit log. "Chase my overdue invoices" is a sentence, not an afternoon.

### Quickstart

**Replit (fastest):** fork the template, hit Run, walk through the setup wizard. Live in minutes.

**Anywhere else:**

```bash
npx create-freeholder my-business
cd my-business && cp .env.example .env   # add Postgres + storage
npm run setup                             # migrate, then open /setup
```

Docker, Railway, Render, and DigitalOcean recipes are in `/docs/deploy`.

Load the demo business from the setup wizard to explore everything populated, then purge it with one click.

### Owning means being able to leave

One button exports everything — database, media, and a human-readable archive of every contact, invoice, and booking. If you ever leave Freeholder, you leave with your business intact. We think that's exactly why you'll stay.

### License

- **Core**: AGPL-3.0. Use it, self-host it, modify it, host it for clients — but improvements to the platform stay open.
- **SDK, deploy tooling, and templates** (`packages/`): MIT. Build businesses, themes, agencies, and tools on top of Freeholder without restriction.

### Contributing

Start with the architecture (§2–§8) and the build contract (§9–§16). Translations are the easiest first PR — locale catalogs live in `/locales`. The CI gates enforce the SEO, i18n, and money-handling standards automatically, so you can't accidentally ship a regression to the things that matter most.

---

*Become a Freeholder.*

---

**Thesis:** One deploy = one business. Every module hangs off a single unified contact spine. Stop leasing your business.

---

## 2. Architectural Principles

1. **Single-tenant.** One Freeholder instance serves one business. No tenant_id anywhere. This kills multi-tenant complexity and matches the "click deploy" story (Replit first, then DO/Railway/Render/anything with Postgres + object storage).
2. **Monolith with modules.** One app, one Postgres database, one ORM schema. Modules are feature folders that can be toggled on/off in admin, not services. A module may own tables, but it may never duplicate a spine entity.
3. **The Contact Spine.** `Contact` is the center of gravity. Bookings, orders, quotes, invoices, gallery access, form submissions, email events, reviews, messages — everything references `contact_id`. The CRM timeline is a *view* over the spine, not a separate store.
4. **Money converges on Invoice → Payment.** Whether value arrives via cart checkout, an accepted quote, a booking deposit, or a subscription cycle, it is realized as an `Invoice` paid by one or more `Payment` records through a payment-provider adapter. One reconciliation path, one refund path, one reporting path.
5. **Adapters for anything external.** Payments (Stripe default, PayPal), transactional mail (Gmail/Outlook OAuth), bulk mail (Resend/Postmark/SES), storage (S3-compatible), SMS (Twilio, optional), calendar sync (Google/Microsoft). Core never imports a vendor SDK directly; it imports the adapter interface.
6. **First-party analytics.** Privacy-first pageview + event capture, stored locally, joined to the spine. No third-party pixels in core. Experimentation is native to the same store: variant impressions and conversions (§32) are first-class events, so A/B results live next to revenue, not in a separate tool.
7. **Agent-operable by design.** Every admin capability is exposed through the internal service layer, which is what the REST API, the admin UI, *and* the bundled MCP server all call. If the UI can do it, an agent can do it, with the same permission checks.
8. **Boring technology.** Postgres, one web framework, server-rendered public pages (SEO), background jobs via a Postgres-backed queue (no Redis requirement for v1).
9. **International by default.** Locale, currency, timezone, and location are first-class core config, not bolt-ons. All money is `(amount_cents, currency)`, all timestamps are UTC with a business timezone for display, all user-facing strings run through the i18n layer from commit one — retrofitting i18n is the single most expensive refactor a platform can face.
10. **SEO is architecture, not garnish.** Public pages are server-rendered HTML, URL structure follows a RIBA-compliant browse hierarchy (Root-Indexed Browse Architecture — every indexable page reachable within shallow hops from root-linked index pages), and every page ships complete meta, JSON-LD, and hreflang. The SEO module doesn't "add SEO"; the routing layer *is* the SEO.
11. **Vibe-coded by design.** The primary way this codebase — and any deployed instance — gets edited is a coding agent in conversation with its owner. Every design decision is made with that reader in mind: strict TypeScript + Zod make the spec machine-checkable, modules and adapters have contracts narrow enough for an agent to hold one fully in context, conventions are enforced by lint/types/CI rather than tribal knowledge, and seed/demo mode exists so an agent can verify its change end-to-end. Code that is hard for an agent to safely modify is a design defect, not a documentation gap.
12. **One sacred database (mandate).** Every piece of state lives in the ACID-compliant relational database (PostgreSQL) — religiously normalized (3NF as the default; denormalization only as a measured, documented optimization with the normalized source retained), deliberately abstracted (modules and plugins reach data exclusively through the service layer, never raw tables), and well-indexed as a review requirement (every foreign key indexed; every service-layer query pattern backed by an index; migrations adding queries without indexes fail review). No shadow stores: no state in JSON files, no truth in localStorage, no "we'll just cache it in memory." jsonb is permitted only for genuinely owner-defined schemaless data (custom fields, block content) and hot jsonb paths get generated columns + indexes. Transactions wrap every multi-table mutation — a half-created order must be impossible, not unlikely. The database *is* the business; everything else is a projection of it.

---

## 3. Module Map

```
freeholder/
├── core/                    # Always on — the spine
│   ├── auth                 # Email+password+OTP (owner/staff), magic-link (customers), sessions, roles
│   ├── contacts             # Contacts, organizations, tags, custom fields, timeline
│   ├── media                # Asset library: images, video, docs; variants; S3 adapter
│   ├── settings             # Business profile, branding, module toggles, adapter config
│   ├── i18n                 # Locales, translations, currency, formats — used by every module
│   ├── locations            # Business locations, NAP, hours, service areas → LocalBusiness schema
│   ├── notifications        # In-app + email notification fanout
│   └── jobs                 # Background queue, scheduled tasks
│
├── commerce/                # Sell things
│   ├── catalog              # Products (physical / digital / service), variants, pricing
│   ├── cart-checkout        # Cart, checkout, tax + shipping rules
│   ├── orders               # Order lifecycle, fulfillment, digital delivery
│   ├── payments             # Invoice + Payment core, tips & pay-what-you-want, provider adapters (Stripe, PayPal)
│   ├── promotions           # Coupons, gift cards, abandoned-cart recovery
│   └── subscriptions        # Memberships, recurring billing, gated content & paywalls (recurring or one-time unlock)
│
├── services/                # Sell time & expertise
│   ├── booking              # Availability, calendars, bookings, reminders, 2-way cal sync
│   ├── quotes               # Quote pipeline: draft → sent → negotiation → accepted
│   ├── contracts            # E-sign: templates, click-to-sign, audit trail
│   └── invoicing            # Manual invoices, deposits, payment plans, late fees, receipts
│
├── content/                 # Be found & show work
│   ├── cms                  # Pages, blog, blocks, nav, redirects
│   ├── galleries            # Public portfolio + private client galleries (proofing, delivery, sales)
│   ├── forms                # Lead capture, intake questionnaires → contacts + submissions
│   └── seo                  # RIBA browse hierarchy, sitemaps, schema.org, hreflang, OG images, llms.txt, programmatic location/service pages
│
├── growth/                  # Keep & grow the audience
│   ├── email-marketing      # Broadcasts, simple automations, list segments (spine-native)
│   ├── reviews              # Post-job review requests, moderation, display widgets
│   ├── social               # Media prep (crop/trim presets, captions) + scheduled publishing [v2: auto-clip]
│   ├── affiliates           # Referral & commission engine: dual-sided codes, admin-defined commission rules on any conversion, payout ledger
│   └── analytics            # First-party pageviews + funnel events, joined to contacts
│
└── platform/                # Operate & extend
    ├── admin                # The admin app shell: dashboards, CRUD for everything
    ├── portal               # Customer portal: their quotes, invoices, bookings, galleries, files, messages
    ├── api                  # REST API + API keys + webhooks (outbound)
    └── mcp                  # Bundled MCP server exposing the service layer to AI agents
```

**Module rules:**
- A module may depend on `core` and declare dependencies on other modules (e.g., `quotes` requires `invoicing`).
- Toggling a module off hides its UI and API surface; its data is retained.
- Every module ships with seed/demo data so a fresh deploy is instantly explorable.

---

## 4. The Data-Model Spine

### 4.1 Identity & Access

| Entity | Purpose | Key fields |
|---|---|---|
| `User` | A login. Owner, staff, or customer. | email, password_hash (nullable for magic-link-only customers), role, otp_secret, last_login_at |
| `Session` | Server-side sessions. | user_id, token_hash, expires_at, ip, user_agent |
| `Contact` | **The spine.** Every human/org the business touches. May or may not have a `User`. | user_id (nullable, 1:1), name, email, phone, org_id, source, tags[], custom_fields (jsonb), lifecycle_stage (lead → prospect → customer → repeat), preferred_locale, timezone, country, owner_notes |
| `Organization` | Optional B2B grouping of contacts. | name, domain, custom_fields |
| `TimelineEvent` | Append-only polymorphic event log per contact. Powers the CRM timeline. | contact_id, actor (user/system/agent), event_type, subject_type, subject_id, payload (jsonb), occurred_at |

**Rule:** anything notable that happens to a contact — quote sent, invoice paid, gallery viewed, email opened, booking rescheduled, form submitted — emits a `TimelineEvent`. Modules write events; the CRM reads them. This is the integration contract between modules.

### 4.2 Catalog (what's for sale)

| Entity | Purpose | Key fields |
|---|---|---|
| `Product` | Anything sellable. `kind: physical \| digital \| service` | name, slug, kind, description, media[], status, seo fields |
| `ProductVariant` | Price point / option combo. | product_id, sku, price_cents, currency, inventory_qty (physical), file_asset_id (digital), options (jsonb) |
| `ServiceOffering` | Service-specific config layered on a `service` product. | product_id, duration_min, buffer_before/after_min, location_type (in_person/virtual/client_site), deposit_type (none/fixed/percent), deposit_value, cancellation_policy, max_per_day |
| `PriceRule` | Payment options per offering. | product_id, mode (full/deposit_balance/payment_plan/hourly), plan_schedule (jsonb) |

### 4.3 Money (the convergence path)

| Entity | Purpose | Key fields |
|---|---|---|
| `Order` | A cart-driven purchase. | contact_id, status, currency, totals (sub/tax/ship/discount/total), shipping_address, fulfillment_status |
| `OrderItem` | Line items. | order_id, product_variant_id, qty, unit_price_cents, snapshot (jsonb) |
| `Quote` | Negotiable offer to a specific contact. | contact_id, status, version, valid_until, deposit_required, terms, accepted_at, accepted_by_user_id |
| `QuoteItem` | Line items (editable per version). | quote_id, description, qty, unit_price_cents, optional (bool, client can toggle) |
| `QuoteMessage` | Negotiation thread on a quote. | quote_id, author (owner/contact), body, proposed_changes (jsonb) |
| `Contract` | Agreement requiring signature. | contact_id, quote_id (nullable), template_id, body_snapshot, status, signed_at, signature (name, ip, user_agent, hash) — audit trail |
| `Invoice` | **The single money object.** | contact_id, source_type + source_id (order/quote/booking/subscription/manual), status, line_items (jsonb snapshot), totals, due_at, deposit_of_invoice_id (for split deposit/balance), schedule (jsonb for plans) |
| `Payment` | One attempt/settlement against an invoice. | invoice_id, provider (stripe/paypal/manual/gift_card), provider_ref, amount_cents, status, method, refunded_amount_cents |
| `Subscription` | Recurring billing. | contact_id, product_variant_id, provider_ref, status, current_period_end, grants (jsonb: gated content, member pricing) |
| `ContentUnlock` | One-time paywall purchase. | contact_id, subject_type + subject_id (page/post/gallery/asset), invoice_id, granted_at, expires_at (nullable — lifetime by default) |
| `Tip` | Voluntary payment, standalone or attached to another flow. | contact_id (nullable — anonymous allowed), invoice_id, amount_cents, currency, context (block/checkout/invoice/gallery), message |
| `Coupon` / `GiftCard` | Promotions. | code, rules (jsonb), balance_cents (gift card), redemptions |
| `AffiliateProgram` | Admin-defined commission scheme. | name, conversion_types[] (signup/subscription/order/booking/custom event), customer_discount (jsonb), commission (jsonb: percent or fixed, basis, cap, recurring or first-cycle-only), cookie_window_days, status |
| `AffiliateCode` | A referrer's code within a program (IROCK). | program_id, contact_id (the referrer — a Contact like everyone else), code, landing_path, clicks, status |
| `CommissionEvent` | One earned commission on the ledger. | affiliate_code_id, referred_contact_id, conversion_type, subject_type + subject_id, invoice_id (nullable — signups have no invoice), amount_cents, status (pending → approved → paid, or reversed on refund) |

Paywalls, tips, and commissions all obey the convergence rule: an unlock or tip is realized as an `Invoice` + `Payment` like any other money-in, and commission payouts settle through the invoicing module (manual/batch in v1; payout-provider adapter such as Stripe Connect as a v2 adapter) — no parallel money paths. Attribution is first-party: a visit with `?ref=IROCK` sets the code on the session, conversion within `cookie_window_days` writes the `CommissionEvent`, refunds reverse it automatically.

**Money state machines (enforce in service layer, not UI):**

```
Quote:    draft → sent → viewed → (negotiating ⇄) → accepted | declined | expired
                                  accepted → [Contract if required] → Invoice(deposit) → Invoice(balance)

Order:    cart → pending_payment → paid → fulfilling → fulfilled | refunded | cancelled

Invoice:  draft → sent → viewed → partially_paid → paid | overdue | void | refunded

Payment:  created → processing → succeeded | failed → (refund: partial | full)
```

### 4.4 Time (booking)

| Entity | Purpose | Key fields |
|---|---|---|
| `Calendar` | An owner/staff bookable resource. | user_id, external_sync (google/microsoft), sync_token |
| `AvailabilityRule` | Recurring open hours + exceptions. | calendar_id, weekday, start/end, timezone, effective range |
| `Booking` | A scheduled appointment. | contact_id, service_offering_id, calendar_id, starts_at, ends_at, status, location, invoice_id (deposit), reschedule_token, notes, intake_submission_id |
| `BookingReminder` | Scheduled notifications. | booking_id, channel (email/sms), send_at, sent_at |

```
Booking:  requested → confirmed → completed | no_show
          any → rescheduled (new row, links to prior) | cancelled (policy applied → refund/credit per rules)
```

### 4.5 Media & Galleries

| Entity | Purpose | Key fields |
|---|---|---|
| `Asset` | Any uploaded file. | kind (image/video/doc/audio), storage_key, mime, bytes, width/height/duration, variants (jsonb: thumbs, web, watermarked), alt_text, blurhash |
| `Gallery` | Collection of assets. `kind: portfolio \| client_delivery` | title, slug, kind, contact_id (client galleries), cover_asset_id, access (public/password/pin/login), expires_at, download_policy (none/web_res/full_res/limit_n), watermark (bool) |
| `GalleryItem` | Ordered membership. | gallery_id, asset_id, position |
| `GallerySelection` | Client proofing. | gallery_id, contact_id, asset_id, kind (favorite/select/reject), comment |
| `GalleryAccessLog` | Views/downloads → also emits TimelineEvents. | gallery_id, contact_id, action, asset_id, at |

Print/digital sales from a gallery: `GalleryItem` links to `ProductVariant` price sheets → standard `Order` flow. No parallel commerce path.

### 4.6 Content, Forms, SEO

| Entity | Purpose | Key fields |
|---|---|---|
| `Page` / `Post` | CMS. Block-based body. | title, slug, blocks (jsonb), status, published_at, seo (jsonb), og_image_asset_id |
| `Form` | Definable forms. | name, fields (jsonb schema), destination (contact_create/update), notify, automation_trigger |
| `FormSubmission` | Responses → linked/creating contacts. | form_id, contact_id, data (jsonb), source_url |
| `Redirect`, `SeoSetting` | 301s, sitewide schema.org config, sitemap inclusion rules. | — |

### 4.7 Growth

| Entity | Purpose | Key fields |
|---|---|---|
| `EmailCampaign` | Broadcast or automation step. | subject, body (blocks), segment (jsonb query over spine), status, scheduled_at |
| `EmailMessage` | Per-recipient send record. | campaign_id (nullable for transactional), contact_id, status, opened_at, clicked_at → TimelineEvents |
| `Review` | Collected feedback. | contact_id, source (post_booking/post_order/manual), rating, body, status (pending/approved), display_locations[] |
| `SocialAccount` | Connected profiles. | platform, auth (encrypted), status |
| `SocialPost` | Prepared + scheduled content. | assets[], variants per platform (jsonb: crop, caption, hashtags), scheduled_at, status, results (jsonb) |
| `AnalyticsEvent` | First-party events. | anon_id, contact_id (once identified), session_id, name (pageview/add_to_cart/quote_viewed/…), props (jsonb), url, referrer, at |

Funnel = `AnalyticsEvent` joined through `contact_id` to money tables. Visit → lead → quote → paid, one query.

### 4.8 Platform

| Entity | Purpose | Key fields |
|---|---|---|
| `ApiKey` | Programmatic access. | name, hashed_key, scopes[], last_used_at |
| `Webhook` | Outbound events. | url, events[], secret, delivery log |
| `AuditLog` | Every admin/agent mutation. | actor, action, subject, diff (jsonb), at |
| `ReleaseNote` | The instance's own changelog — every functional change to *this site*, auto-drafted, owner-publishable. | kind (platform_upgrade/module_toggled/plugin_installed/plugin_updated/plugin_removed/setting_changed/custom), title, body, actor (owner/staff/agent/system), source_ref (version, plugin@version, audit ids), visibility (internal/public), occurred_at |
| `ModuleSetting` | Toggles + per-module config. | module, enabled, config (jsonb) |

The MCP server authenticates as a scoped `ApiKey`, calls the same service layer, and every mutation lands in `AuditLog` with `actor = agent:<key-name>`. The owner can read a plain-English log of everything their AI did.

**Instance release notes (mandated best practice):** every Freeholder keeps its *own* changelog. Whenever functionality on the site is CRUD'd — the platform upgrades, a module is toggled, a plugin is installed/updated/removed, a consequential setting changes — a `ReleaseNote` is auto-drafted from the triggering event (platform upgrades pull the relevant entries straight from the core changelog; plugin changes pull from the plugin's changelog). Agents making functional changes via MCP must write the note as part of the change — the service layer won't complete a functionality-mutating call from an agent without one. Admin gets a "What Changed" timeline; owners can optionally publish selected notes to a public `/changelog` page (server-rendered, in the sitemap — a live site that documents its own evolution is both a trust signal and an SEO asset). The discipline that keeps the platform honest at the repo level (§15.6) is thereby inherited by every deployed site: no functionality ever changes silently, anywhere in the ecosystem.

### 4.9 Internationalization (core/i18n)

**Setup wizard captures on first run:** business country, primary locale, additional locales, base currency, timezone, units (metric/imperial), first day of week, date/number formats (sensible defaults per locale, overridable).

| Entity | Purpose | Key fields |
|---|---|---|
| `LocaleSetting` | Enabled locales for the instance. | locale (BCP-47: en, fr-CA, de…), enabled, is_default, url_strategy_position |
| `EntityTranslation` | Translations for content entities. One row per entity × locale. | entity_type, entity_id, locale, fields (jsonb: title, body, seo…), status (draft/machine/reviewed), translated_by (user/agent) |
| `CurrencySetting` | Currencies the business operates in. | currency (ISO-4217), is_base, enabled, rounding_rule |
| `FxRate` | Display-conversion rates (informational). | from, to, rate, as_of, source (manual/adapter) |
| `PriceListEntry` | Explicit per-currency prices (real multi-currency selling — never auto-convert charges). | product_variant_id, currency, amount_cents |

**Rules:**
- **UI strings** (buttons, labels, emails' boilerplate) live in message catalogs (ICU MessageFormat JSON), shipped per locale, community-translatable. **Content** (pages, products, galleries, campaigns) lives in `EntityTranslation`.
- **URL strategy:** default locale unprefixed, others path-prefixed (`/fr/services/...`). Every localized page emits full `hreflang` alternates + `x-default`. One sitemap per locale, indexed by a sitemap index.
- **Money is never auto-converted at charge time.** A variant is either priced in a currency (PriceListEntry) or unavailable in it. FX rates are for display/reporting only. Invoices, payments, and refunds stay in their original currency forever.
- **Customer-facing everything follows `Contact.preferred_locale`:** portal, quotes, invoices, contracts, booking reminders, marketing emails. A quote sent to a French client renders in French with EUR prices if priced; the admin sees it in the owner's locale.
- **Timezone discipline:** store UTC; bookings render in *both* business and contact timezone on every customer surface (the #1 no-show cause is timezone confusion).
- **Tax follows location, not locale:** tax zones key off business location + customer country (see §4.10).
- **AI-assisted translation** (BYO key) can machine-draft `EntityTranslation` rows flagged `status=machine` for owner review — never silently published.

### 4.10 Locations & NAP (core/locations)

NAP (Name, Address, Phone) consistency is the backbone of local SEO. It's captured once, structured, and emitted everywhere — footer, contact page, schema.org, sitemaps — from a single source of truth. Locations are optional: a purely online creator skips this and no empty local scaffolding appears.

| Entity | Purpose | Key fields |
|---|---|---|
| `BusinessLocation` | A physical or service-area presence. | name, slug, is_primary, address (structured: street, unit, city, region, postal, country), geo (lat, lng), phone, email, google_business_profile_url |
| `OpeningHours` | Structured hours → OpeningHoursSpecification schema. | location_id, weekday, opens, closes, special_dates (jsonb: holidays, seasonal) |
| `ServiceArea` | For go-to-customer businesses (no storefront address shown). | location_id, kind (radius/regions), center_geo, radius_km, regions[] |
| `LocationPage` | Auto-generated, RIBA-structured local landing pages. | location_id, service ids[], generated blocks (jsonb, owner-editable), status |

**Rules:**
- Primary location's NAP renders identically everywhere (exact-match string discipline) — the render helper is the only way to output NAP, so it *can't* drift.
- Each location emits `LocalBusiness` (or subtype: Photographer, HairSalon, etc. — owner picks from schema.org business types in setup) JSON-LD with geo, hours, priceRange, sameAs links.
- Multi-location businesses get `/locations/` as a root-linked index page with each location one hop below — RIBA-compliant by construction.
- Bookings can be tied to a location (`Booking.location_id`); tax zones and service availability can vary per location.

---

## 5. The SEO Layer (doctrine, enforced structurally)

This section encodes the standards from BigDataSEO.com and the Vibe Coding 101 SEO Foundation as *build requirements*, not suggestions. CI should fail on violations where checkable.

**Rendering:** every public page is server-rendered HTML — content present in the initial response, no client-render-only routes on the public surface. Admin and portal can be as app-like as they want; they're noindexed anyway.

**Browse architecture (RIBA):** the public URL tree is a root-indexed browse hierarchy. Homepage → section indexes (`/services/`, `/shop/`, `/portfolio/`, `/blog/`, `/locations/`) → items, with every indexable page within 3 hops of root for a typical instance. No orphan pages: publishing anything automatically links it from its section index. Pagination is capped and chunked, never infinite chains. Faceted/filter URLs are noindexed with canonical to the base — filters never mint crawlable near-duplicates.

**Per-page requirements (enforced by the page-render pipeline):**
- Unique title (<60 chars) and meta description (<155 chars), editable per entity per locale, with sane auto-generated defaults
- Canonical absolute URL on every page; trailing-slash and case normalization at the router
- Full OG + Twitter card set; auto-generated OG images (branded template + entity title) with per-entity override
- One H1; semantic heading hierarchy; alt text required on public images (AI-suggested, owner-approved)
- JSON-LD by page type: `WebSite`+`Organization`/`LocalBusiness` (home), `Product`+`Offer` (products), `Service` (services), `Event` (bookable events), `Article`+`Person` (blog), `BreadcrumbList` (all non-home), `FAQPage`/`HowTo` where blocks warrant, `Review`/`AggregateRating` fed by the reviews module
- `hreflang` alternates on every localized page

**Site-level:** locale-split sitemaps under a sitemap index, auto-updated on publish with IndexNow ping; robots.txt allowing crawlers and blocking `/admin`, `/portal`, checkout, and filter parameters; 301 management via the `Redirect` entity with automatic redirect creation on slug change (slugs never silently break); clean structural 404s.

**AEO (answer-engine optimization):** auto-generated `/llms.txt` describing the business, offerings, locations, and key pages; content blocks encourage direct-answer patterns (FAQ blocks are first-class in the CMS); all schema above doubles as AI-crawler food. The analytics module tags referrers from AI surfaces (ChatGPT, Perplexity, AI Overviews) as a distinct acquisition channel.

**Programmatic pages:** the location × service matrix (e.g., `/locations/comox-valley/wedding-photography/`) is generated only where the owner enables it, with genuinely differentiated content blocks per page (location-specific galleries, testimonials, hours) — thin-template mass generation is explicitly out of scope; it's the failure mode RIBA audits exist to catch.

---

## 6. Cross-Module Flows (the compounding effects)

1. **Lead → cash (service business):** Form submission → Contact(lead) → owner sends Quote → negotiation thread → accepted → Contract e-signed → deposit Invoice auto-issued → Booking scheduled → reminder emails → completed → balance Invoice → Payment → review request → testimonial on site. *Every arrow is a TimelineEvent.*
2. **Shoot → deliver → upsell (creator):** Booking completed → client Gallery created (login-gated, watermarked proofs) → client makes Selections → owner finalizes → download delivery per policy → print upsell via gallery price sheet → Order → Payment.
3. **Content → commerce:** Blog post (SEO module ships schema + OG) → first-party analytics attributes the visit → visitor buys digital product → anon_id merges into Contact → future email campaigns segment on "bought X, hasn't booked Y."
4. **Agent operations:** "Claude, chase overdue invoices" → MCP → service layer lists `Invoice(status=overdue)` → drafts reminder per contact tone/history from Timeline → sends via mail adapter → logs to AuditLog + TimelineEvents.

---

## 7. Build Order (proposed v1 slice)

The v1 that is genuinely shippable on Replit and already better than the tool-mash:

1. core (auth, contacts, media, settings, jobs, **i18n scaffolding + locations/NAP** — the setup wizard asks country/locale/currency/timezone on first run; the string layer and money conventions exist before any feature is built, even if v1 ships with full translations for only 2–3 locales)
2. invoicing + payments (Stripe adapter) — money path first
3. catalog + simple checkout (digital + service products; physical can trail)
4. booking (with Google Calendar sync)
5. quotes (+ contracts minimal: click-to-accept with audit trail; full templated e-sign v1.1)
6. cms + forms + seo
7. galleries (portfolio + client delivery with proofing)
8. portal + admin polish + first-party analytics
9. mcp + api + webhooks
10. email marketing (broadcasts first, automations v1.1)

Deferred to v2: subscriptions/memberships, gift cards, social auto-clipping (manual crop/trim presets ship in v1.5), PayPal adapter, SMS.

---

## 8. Open Decisions

- **Framework:** Next.js (largest vibe-coding familiarity, Replit-native) vs SvelteKit (lighter). Leaning Next.js for adoption.
- **ORM:** Drizzle (SQL-transparent, light) vs Prisma (familiar). Leaning Drizzle.
- **Custom fields:** jsonb on Contact (fast, v1) vs EAV tables (queryable, heavier). Leaning jsonb + generated columns for hot fields.
- **Multi-currency:** store currency per money row from day one; v1 UI = base currency + optional PriceListEntry overrides per enabled currency. Auto-FX display of prices is off by default (honest pricing beats approximate pricing).
- **Tax:** v1 = simple rate tables per tax zone (keyed to business location + customer country); Stripe Tax as optional adapter later. Canada (GST/PST/HST) and EU VAT (incl. B2B reverse-charge flag) are the two zone templates that ship in v1.
- **v1 shipped locales:** propose en + fr + es (covers Canada bilingual compliance and the largest creator markets); community PRs add catalogs. Machine-translation assist for content from day one, always flagged for review.
- **RTL:** the CSS layer uses logical properties from the start so Arabic/Hebrew are a catalog away, not a rewrite.
- **hreflang + sitemap generation:** build in core routing, not as a plugin — every module's public pages inherit it for free.

---

## 9. Stack Decisions (settling the open items)

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (App Router)** | Largest vibe-coding familiarity, Replit-native, SSR/SSG for the public surface, API routes for the service layer |
| Language | **TypeScript, strict** | Agent-friendly: types are machine-checkable spec |
| ORM | **Drizzle** | SQL-transparent, light, migrations as code, no codegen daemon |
| DB | **PostgreSQL 15+** | Replit-provisioned or any managed PG |
| Queue | **pg-boss** (Postgres-backed) | No Redis dependency; one datastore for v1 |
| Storage | **S3-compatible adapter** | Replit Object Storage / DO Spaces / R2 / MinIO |
| Styling | **Tailwind + CSS logical properties** | RTL-ready from day one |
| i18n | **ICU MessageFormat catalogs** (`/locales/*.json`) + `EntityTranslation` table | Per §4.9 |
| Auth | **Lucia-style session auth, hand-rolled thin** | Email+password+OTP (admin), magic link (customers). No auth SaaS |
| Validation | **Zod** everywhere; schemas shared between API, forms, and MCP tool definitions | One schema, three surfaces |

---

## 10. Repository Layout

```
freeholder/                          # AGPL-3.0
├── LICENSE                          # AGPL-3.0
├── README.md
├── ARCHITECTURE.md
├── SCAFFOLD.md                      # this file
├── CLAUDE.md / AGENTS.md            # agent ground rules (Acquirer Audit Set compatible)
├── PROJECT_BACKLOG.json             # append-only backlog
│
├── app/                             # Next.js App Router
│   ├── (public)/                    # server-rendered public surface — THE SEO SURFACE
│   │   ├── [locale]/                # optional locale segment (default locale unprefixed via middleware)
│   │   │   ├── page.tsx             # home
│   │   │   ├── services/            # section index + items (RIBA level 1 → 2)
│   │   │   ├── shop/
│   │   │   ├── portfolio/
│   │   │   ├── blog/
│   │   │   ├── locations/
│   │   │   └── [...page]/           # CMS catch-all
│   ├── (portal)/portal/             # customer portal (noindex)
│   ├── (admin)/admin/               # admin app (noindex)
│   ├── api/                         # REST API routes → thin wrappers over services
│   ├── sitemap-index.xml/route.ts
│   ├── robots.txt/route.ts
│   └── llms.txt/route.ts
│
├── src/
│   ├── core/                        # the spine — modules may import core, never vice versa
│   │   ├── db/                      # drizzle client, migration runner
│   │   ├── auth/
│   │   ├── contacts/
│   │   ├── media/
│   │   ├── i18n/                    # locale resolution, t(), money/date formatters
│   │   ├── locations/               # NAP source of truth + renderNAP() helper
│   │   ├── settings/
│   │   ├── events/                  # TimelineEvent emitter + module event bus
│   │   ├── jobs/                    # pg-boss wrapper, job registry
│   │   └── seo/                     # meta builder, JSON-LD builders, sitemap/hreflang engine
│   │
│   ├── modules/                     # feature modules (see §11)
│   │   ├── catalog/
│   │   ├── orders/
│   │   ├── payments/
│   │   ├── invoicing/
│   │   ├── quotes/
│   │   ├── contracts/
│   │   ├── booking/
│   │   ├── cms/
│   │   ├── galleries/
│   │   ├── forms/
│   │   ├── email-marketing/
│   │   ├── reviews/
│   │   ├── social/
│   │   ├── analytics/
│   │   └── subscriptions/
│   │
│   ├── adapters/                    # vendor isolation layer (see §12)
│   │   ├── payments/  (stripe/, paypal/, manual/)
│   │   ├── mail/      (gmail/, outlook/, resend/, smtp/)
│   │   ├── storage/   (s3/, replit/, local/)   # local = dev-only; production mandates managed object storage (§18)
│   │   ├── calendar/  (google/, microsoft/)
│   │   ├── sms/       (twilio/, none/)
│   │   ├── ai/        (anthropic/, openai/, none/)   # BYO key
│   │   └── fx/        (manual/, ecb/)
│   │
│   └── mcp/                         # bundled MCP server — tools generated from service registry
│
├── locales/                         # ICU MessageFormat catalogs: en.json, fr.json, es.json…
├── db/migrations/
├── seed/                            # demo business: "Aurora Coast Photography" — full fake data
├── scripts/                         # setup, seed, doctor (env checks), export
├── tests/
│
└── packages/                        # MIT-licensed, separately published
    ├── sdk/                         # @freeholder/sdk — typed API client
    ├── create-freeholder/           # npx create-freeholder — deploy bootstrapper
    └── templates/                   # @freeholder/templates — theme starters
```

**License boundary:** everything under root = AGPL-3.0. Everything under `packages/` = MIT with its own LICENSE. The SDK and templates being MIT means agencies and tool-makers can build on Freeholder freely; the AGPL core means nobody closes the platform itself.

---

## 11. Module Contract

A module is a folder in `src/modules/<name>/` with a manifest. Modules register capabilities; core wires them. Modules communicate **only** via the event bus and core services — never by importing each other's internals.

```ts
// src/modules/quotes/manifest.ts
import { defineModule } from "@/core/module";

export default defineModule({
  name: "quotes",
  version: "1.0.0",
  requires: ["invoicing"],            // dependency check at boot
  tables: () => import("./schema"),   // drizzle tables owned by this module
  services: () => import("./services"), // the ONLY business-logic entry points
  routes: {
    public: () => import("./routes/public"),   // e.g. /quote/[token]
    admin:  () => import("./routes/admin"),
    portal: () => import("./routes/portal"),
    api:    () => import("./routes/api"),
  },
  events: {
    emits: ["quote.sent", "quote.viewed", "quote.accepted", "quote.declined"],
    listens: { "invoice.paid": "onInvoicePaid" },
  },
  jobs: () => import("./jobs"),       // e.g. quote expiry sweep
  mcpTools: () => import("./mcp"),    // tool defs w/ Zod schemas → auto-exposed
  seo: { sitemapSources: [] },        // public URL providers for the sitemap engine
  settingsSchema: quoteSettingsZod,   // renders the module's admin settings page
  seed: () => import("./seed"),       // demo data contribution
  navigation: { admin: [...], portal: [...] },
});
```

**Boot sequence:** load manifests → topo-sort by `requires` → run pending migrations per module → register services in the service registry → mount routes → subscribe event listeners → register jobs → build MCP tool list from enabled modules only.

**The service registry is the single choke point.** Admin UI, REST API, and MCP all call `services.quotes.send(...)`. Every service method: validates with Zod, checks permissions from session/API-key scopes, executes in a transaction, emits TimelineEvents, writes AuditLog. A service method that skips any of these fails code review — this is the invariant that makes the platform agent-safe.

---

## 12. Adapter Contract

Adapters isolate vendors. Each adapter family has one interface in `src/adapters/<family>/types.ts`; implementations are selected by env/settings and instantiated once at boot.

```ts
// src/adapters/payments/types.ts
export interface PaymentAdapter {
  readonly id: "stripe" | "paypal" | "manual";
  createCheckout(invoice: InvoiceForCharge): Promise<{ url: string; providerRef: string }>;
  createSubscription?(sub: SubscriptionRequest): Promise<ProviderSubscription>;
  refund(payment: PaymentRecord, amountCents: number): Promise<RefundResult>;
  verifyWebhook(req: RawRequest): Promise<PaymentEvent>;   // normalize to internal event shape
  supportedCurrencies(): Promise<string[]>;
}
```

```ts
// src/adapters/mail/types.ts
export interface MailAdapter {
  readonly id: "gmail" | "outlook" | "resend" | "smtp";
  readonly kind: "transactional" | "bulk" | "both";
  send(msg: OutboundEmail): Promise<{ providerRef: string }>;
  // gmail/outlook implement OAuth connect + refresh; owner's own address = deliverability + replies land in their inbox
}
```

**Routing rule:** transactional mail (receipts, OTPs, booking confirmations, quote notifications) goes through the owner's connected Gmail/Outlook. Bulk (campaigns) requires a bulk adapter (Resend/SES/Postmark) — the email-marketing module refuses to broadcast through a personal mailbox, protecting the owner's domain reputation from themselves.

Same pattern for storage, calendar (2-way sync w/ webhook or polling fallback), sms, fx, and ai. The `none/` implementations let every optional family be absent without null-checks scattered through modules.

---

## 13. Setup Wizard (first boot)

Fresh deploy with empty DB → `/setup` (locked after completion):

1. **Owner account** — email, password, OTP verification (proves mail works before anything else; offers Gmail/Outlook OAuth connect here, falls back to SMTP)
2. **Business identity** — name, what-you-do (picks schema.org business type), logo
3. **International** — country → smart defaults for locale, currency, timezone, units, tax zone template (CA GST/PST/HST, EU VAT, US none, …); add extra locales/currencies now or later
4. **Location / NAP** — optional: address or service area, phone, hours → primary `BusinessLocation`
5. **Payments** — Stripe connect (or skip; "manual invoicing" works with zero providers)
6. **Modules** — sensible presets: *Creator* (galleries, booking, quotes), *Service business* (booking, quotes, contracts, invoicing), *Shop* (catalog, orders), *Everything*
7. **Demo data?** — load "Aurora Coast Photography" seed to explore, one-click purge later

Every step writes real settings; nothing is a dead-end. `scripts/doctor.ts` re-validates env + adapters anytime.

---

## 14. Replit-First Deploy Story

- `.replit` + `replit.nix` committed; **Run** = migrate → seed-if-empty → dev server. Deploy = Replit Deployments with PG + Object Storage provisioned.
- `npx create-freeholder` (MIT) scaffolds/forks for Railway, Render, DO App Platform, and bare Docker (`Dockerfile` + `compose.yml` with PG + MinIO for full self-host).
- All config via env with a single `env.ts` Zod schema — `doctor` prints exactly what's missing in plain English.
- **Export is a feature:** one admin button produces a full archive (SQL dump + media + a human-readable JSON of every entity). Ownership isn't a slogan; leaving must be easy — that's what makes staying a choice.

---

## 15. Quality Gates (CI)

1. **Typecheck + lint + tests** — standard.
2. **SEO gate (the doctrine, §5, machine-checked):** crawl the built public surface of the seeded demo site and fail on: missing/duplicate titles or descriptions, missing canonical, missing hreflang where locales > 1, any indexable page > 3 hops from root, orphan pages, invalid JSON-LD (validated against schema.org types), images without alt.
3. **i18n gate:** fail on hardcoded user-facing strings in public/portal surfaces (lint rule: text must pass through `t()`); fail on catalog keys missing from the default locale.
4. **Money gate:** lint rule forbidding float arithmetic on money and any FX call inside charge paths.
5. **Service-layer gate:** no route handler or MCP tool may import Drizzle tables directly — services only.
6. **Changelog gate (the release-notes religion):** any PR that creates, updates, or removes user-facing functionality — a service method, route, MCP tool, setting, module capability — must include a changeset entry (`feat/fix/breaking` + one plain-English sentence a business owner can understand). CI detects functional diffs (service registry, route table, or MCP tool list changed) with no accompanying changeset and fails. Release notes are then auto-assembled per release from changesets — never written from memory the night before, never skipped. Undocumented functionality changes are treated as bugs.
7. **A11y smoke** on key public templates.

These gates ARE the moat. Any contributor (human or agent) inherits the standards automatically.

---

## 16. Conventions for Coding Agents (CLAUDE.md summary)

- One backlog item per build session; append-only `PROJECT_BACKLOG.json`; confidence tags verified/inferred/assumed on claims about existing code.
- Never create a parallel path for something the spine owns (no module-local contacts, money, or media tables).
- New public pages must register a sitemap source and pass the SEO gate locally before PR.
- Migrations are forward-only; destructive changes require a data-migration plan in the PR body.
- Every new service method ships with: Zod schema, permission check, TimelineEvent emission where contact-relevant, AuditLog write, and a test.
- Every functional CRUD — added, changed, or removed capability — ships with a changeset entry in the same commit. No entry, no merge (Changelog gate, §15.6). This applies to agents identically: a build session that touches functionality ends by writing its own release note.
- Agents are the expected primary editors (§2, principle 11): a convention that can't be checked by lint, types, or CI must be written down here — tribal knowledge is a bug.

---

## 17. The Configuration Model

A running Freeholder instance is fully described by three orthogonal layers. Keeping them orthogonal is what lets contributors add one axis without touching the others.

```
┌─────────────────────────────────────────────────────────┐
│ 1. DEPLOYMENT TARGET      (where it runs)                │
│    replit · digitalocean-app · digitalocean-droplet ·    │
│    railway · render · fly · docker-selfhost · …          │
├─────────────────────────────────────────────────────────┤
│ 2. ADAPTER PROFILE        (which vendors it talks to)    │
│    payments, mail-transactional, mail-bulk, storage,     │
│    calendar, sms, ai, fx — each an adapter id + config   │
├─────────────────────────────────────────────────────────┤
│ 3. BUSINESS PRESET        (which modules are on)         │
│    creator · service-business · shop · everything ·      │
│    custom — plus locale/currency/tax-zone defaults       │
└─────────────────────────────────────────────────────────┘
```

All three resolve into one artifact: **`freeholder.config.ts`** (checked in, no secrets) + **env vars** (secrets, per SCAFFOLD's single Zod `env.ts`). A "recipe" is a documented, validated combination of layer 1 with sane defaults for layers 2–3.

```ts
// freeholder.config.ts — the whole instance, declaratively
export default defineConfig({
  target: "digitalocean-app",
  adapters: {
    payments: "stripe",
    mailTransactional: "gmail",
    mailBulk: "resend",
    storage: "s3",            // DO Spaces is S3-compatible
    calendar: "google",
    sms: "none",
    ai: "anthropic",
    fx: "manual",
  },
  preset: "service-business",
  locales: ["en", "fr"],
  baseCurrency: "CAD",
});
```

`scripts/doctor.ts` reads config + env and reports, in plain English, exactly what's missing or misconfigured for the chosen target. Doctor is the contract that makes community recipes trustworthy — a recipe isn't "done" until doctor passes green on a fresh deploy of it.

---

## 18. Recipe Anatomy (what contributors add)

```
deploy/
├── README.md                        # the recipe index + tier table
├── _template/                       # copy to start a new recipe
└── <target-name>/
    ├── recipe.yaml                  # machine-readable manifest (below)
    ├── README.md                    # human walkthrough: provision → deploy → verify
    ├── .env.example                 # every var this target needs, annotated
    ├── infra/                       # target-specific files (app spec, compose, nix…)
    └── verify.md                    # post-deploy checklist doctor can't automate
```

```yaml
# deploy/<target>/recipe.yaml
name: digitalocean-app
tier: 1                    # see §19
maintainers: ["@tonyaly"]
freeholder_min_version: "1.0.0"
provides:
  database: managed-postgres
  storage: spaces-s3
  jobs: web-process        # or worker-process if the target supports one
  cron: platform-native    # or in-process fallback
estimated_monthly_cost_usd: { min: 17, typical: 29 }
limits:
  - "App Platform has no persistent disk — storage adapter MUST be s3 (Spaces)"
tested_on: "2026-07-01"
```

**Recipe rules:**
- A recipe may pin *required* adapter choices only when the platform forces them (e.g., no-persistent-disk targets must use S3 storage). Everything else stays owner-choice.
- **Storage mandate (all tiers):** production media lives in managed object storage, never on instance disk. On Tier-1 targets this is pinned: **Replit → Replit Object Storage; DigitalOcean (both flavors) → Spaces.** Other recipes must mandate their platform's equivalent (R2, S3, GCS…). The `local/` storage adapter is dev-only and refuses to start with `NODE_ENV=production` unless explicitly overridden with `FREEHOLDER_UNSAFE_LOCAL_STORAGE=1` — a flag named to be embarrassing in a config review. Rationale: media is the least-recoverable asset a business has; a dead droplet or wiped container must never be able to take the photo archive with it. Object storage also makes cross-platform migration a bucket sync instead of a rescue operation.
- **Migration mandate (Tier 1–2):** a recipe is not approved without a specced migration path. Every Tier 1–2 recipe ships `migrate.md` covering, at minimum, migration **to and from each Tier-1 target** (export archive → provision → import → storage sync → DNS repoint), with expected downtime and a verification checklist. Tier-1 pairs are round-trip tested in CI (see §23); Tier-2 paths are verified by the recipe maintainer per release. No approved platform is ever a dead end — that's the ownership promise expressed as a requirement.
- Every recipe must run the same app code. No target-specific forks of application logic — if a target needs a code change, that change goes behind a capability flag in core (e.g., `jobs: in-process | worker`), available to all targets.
- CI runs a **recipe validation matrix**: for each Tier 1–2 recipe, boot the app with that recipe's config against ephemeral PG + MinIO, run doctor, run the smoke suite. Recipes that rot get flagged automatically, not discovered by frustrated users.

---

## 19. Support Tiers (managing the contribution surface honestly)

| Tier | Meaning | Bar |
|---|---|---|
| **1 — Core** | Maintained by the project, tested in CI on every release, first-class docs. | Replit, DigitalOcean (both flavors) at launch |
| **2 — Community-verified** | Contributed + actively maintained by a named community maintainer; in the CI matrix; may lag releases briefly. | recipe.yaml maintainer answers issues; validation passing |
| **3 — Experimental** | Contributed, works-when-tested, no CI guarantee. Clearly labeled. | Doctor passes at submission time |

Tiers are printed in the recipe index and in `create-freeholder`'s target picker. Honest labeling beats a long list of half-working targets — nothing kills an open-source project's reputation faster than a README full of deploy buttons that don't work.

---

## 20. Tier-1 Recipe: Replit

**Who it's for:** the vibe-coding on-ramp. Fork → Run → live. Zero terminal.

**Provisioning:** Replit template repo (published to the template gallery) with `.replit`, `replit.nix`, and PostgreSQL + Object Storage declared. Forking provisions both automatically; `DATABASE_URL` and object-storage credentials are injected by the platform.

**Mapping:**

| Concern | Replit answer |
|---|---|
| Database | Replit PostgreSQL (injected `DATABASE_URL`) |
| Storage | **Replit Object Storage — mandated** (storage mandate §18) via the s3-compatible adapter (`storage: "replit"` thin wrapper); local disk never used for media |
| Jobs | In-process pg-boss (single process; fine at this scale) |
| Cron | pg-boss scheduled jobs (no platform cron needed) |
| Domains | Replit Deployments custom domain + automatic TLS |
| Secrets | Replit Secrets pane — `.env.example` mirrors exactly what to paste |

**Run button =** `npm run start:replit` → migrate → seed-if-empty → serve. First visit hits `/setup`.

**Honest limits (in the recipe README):** dev workspace sleeps (Deployments don't — deploy for production); single-region. Media is already in Replit Object Storage per the mandate, so graduating to DigitalOcean later is the standard migration path (§23) — a bucket sync, not a rescue. Replit is the best *first* home and a fine *forever* home for low-traffic businesses; the recipe says both plainly.

**Strategic note:** this template is also the funnel from vibe-coding-101.com — "Module 8: deploy a real business" links straight to the fork button, with your Replit referral on the path. Curriculum → template → deployed Freeholder instances is a compounding loop across your properties.

---

## 21. Tier-1 Recipe: DigitalOcean (two flavors)

### 21a. `digitalocean-app` — App Platform (recommended default)

**Who it's for:** the graduation path — managed everything, no server admin, scales past Replit.

| Concern | DO answer |
|---|---|
| Compute | App Platform web service (basic-xxs to start) |
| Database | Managed PostgreSQL (dev tier fine to start) |
| Storage | Spaces (S3-compatible) + Spaces CDN for media/gallery delivery |
| Jobs | Separate worker process in the same app spec (App Platform supports it) — pg-boss in worker mode |
| Cron | pg-boss scheduling in the worker |
| Domains/TLS | App Platform managed |

**Infra artifact:** `infra/app.yaml` (DO App Spec) checked into the recipe — `doctl apps create --spec deploy/digitalocean-app/infra/app.yaml` is the whole provisioning story, and the spec doubles as documentation. Typical cost: ~$5 web + $7 worker (optional at low volume) + $15 managed PG dev + $5 Spaces ≈ **$17–32/mo** — one Dubsado subscription.

**Forced constraint:** no persistent disk → `storage` must be `s3` (Spaces). Recipe pins it.

### 21b. `digitalocean-droplet` — Droplet + Docker Compose (full self-host)

**Who it's for:** maximum ownership per dollar; the "I want it all on one box I control" crowd — philosophically the purest Freeholder deployment.

**Infra artifact:** `infra/compose.yml` — app + postgres + Caddy (automatic TLS) on a single $12–24/mo droplet, with **media mandated to DO Spaces** (storage mandate, §18) — the droplet holds compute and the database, never the media archive. MinIO appears only in the local-dev compose profile. `infra/cloud-init.yml` for one-command droplet bootstrap. Backup story documented and scripted from day one: nightly `pg_dump` shipped to a versioned Spaces bucket (media is already there) via `scripts/backup.sh`, restore rehearsal included in verify.md — a self-host recipe without a tested restore path is a liability, so the recipe treats backups as part of "working," not an appendix. Net effect: a destroyed droplet is a 20-minute cloud-init rebuild, not a data-loss event.

---

## 22. `create-freeholder` Flow (MIT package, ties it together)

```
npx create-freeholder my-business

? Where will this run?          › Replit / DigitalOcean App Platform /
                                  DO Droplet / Railway (community) / … [tiers labeled]
? Business preset?              › Creator / Service business / Shop / Everything
? Country?                      › CA  → defaults: en+fr, CAD, America/Vancouver, GST/PST
? Payments now or later?        › Stripe / Later
→ writes freeholder.config.ts, .env.example (target-specific), copies infra/
→ prints the recipe's 5-step walkthrough with your values filled in
```

The generator never hides steps behind magic — it prints what it did and what remains, because the target user is learning to own their stack, and the tool should teach while it scaffolds.

---

## 23. Migration Between Approved Platforms (mandated, tested)

Migration is not a docs page; it's part of a recipe's definition of done (§18 migration mandate). The mechanism: config is declarative, export is total (§14), and — thanks to the storage mandate — media already lives in object storage, so most migrations are **export archive → provision target from recipe → import → bucket-to-bucket storage sync (rclone script included) → DNS repoint**, with expected downtime measured in minutes.

**The migration matrix** (published in the recipe index, kept honest by CI):

| From \ To | Replit | DO App Platform | DO Droplet |
|---|---|---|---|
| **Replit** | — | ✅ CI round-trip | ✅ CI round-trip |
| **DO App Platform** | ✅ CI round-trip | — | ✅ script (shared Spaces bucket: repoint, no copy) |
| **DO Droplet** | ✅ CI round-trip | ✅ script (shared Spaces bucket: repoint, no copy) | — |

- **Tier-1 pairs:** CI performs the actual export/import round-trip on every release — the promise is executed, not asserted. Note the DO↔DO cells: because both flavors mandate Spaces, media doesn't move at all; migration is a database restore and a config change.
- **Tier-2 recipes:** must ship `migrate.md` to/from every Tier-1 target to be approved; maintainer re-verifies per release, and the matrix marks last-verified dates.
- `scripts/migrate.ts` drives the common path (export → integrity check → import → storage sync → post-import doctor run) so the human steps are provisioning and DNS, nothing else.

"Start on Replit, graduate to DigitalOcean, never lose a byte" is the growth story — the mandates make it a tested property of the system rather than a hope.

---

## 24. Plugins: The Design Bet

**A plugin is a module you didn't write.** There is no second, weaker extension API — plugins use the exact `defineModule()` contract from §11 (tables, services, routes, events, jobs, MCP tools, seo sources, settings, seed, navigation), plus plugin-only capabilities below. This is the single most important decision in this doc: core modules are dogfooding the plugin API every day, so the plugin API can never rot, and any core module could be extracted into a plugin (and vice versa — great community plugins can graduate into core).

```ts
// the whole plugin, minimal form — one file
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "gift-registry",
  version: "0.1.0",
  freeholder: ">=1.0.0",
  permissions: ["invoicing:create", "contacts:read"],   // §26
  services: { /* ... */ },
  routes: { public: { "/registry": RegistryPage } },
  mcpTools: { /* auto-derived from services + Zod */ },
});
```

**Beyond the module contract, plugins can also register:**
- **CMS block types** — new blocks appear in the page editor (e.g., a "before/after slider" block)
- **Dashboard widgets** — cards on the admin home
- **Adapter implementations** — a plugin can ship a whole new payments/mail/storage/sms adapter (`registerAdapter("payments", squareAdapter)`); this is how Square, Wise, Paddle etc. arrive without core PRs
- **Theme hooks** — declared slots in public templates (header, footer, product page sections); no monkey-patching
- **Automation actions/triggers** — new verbs for the email-marketing automations and future workflow builder
- **Custom entities** — plugin tables that attach to the spine the only legal way: `contact_id` foreign keys + TimelineEvent emission. The CRM timeline shows plugin events with zero integration work.

**Hard rules (enforced, not requested):**
- Plugins never import another plugin's or module's internals — services, events, and core only. Lint gate.
- Plugins never touch spine tables directly — core services only. The service-layer CI gate (§15.5) applies to plugins identically.
- Money stays converged: a plugin that charges anything does it by creating Invoices through `services.invoicing` — no parallel payment paths, ever.

---

## 25. Ridiculously Easy (the DX bar)

```bash
npx create-freeholder-plugin gift-registry     # scaffolds manifest, example service+route+test
cd gift-registry && npm run dev                 # boots a seeded demo Freeholder with your plugin
                                          # hot-reloading inside it — full site, fake business
npm test                                  # runs against the same seeded instance
npm run share                             # validates → publishes to npm as freeholder-plugin-gift-registry
```

The bar: **zero-config from idea to installable in under an hour.** The dev harness (part of MIT `plugin-kit`) is the make-or-break piece — nobody should need to set up a whole Freeholder to write a widget. `npm run dev` gives them Aurora Coast Photography with their plugin live inside it.

**Installing (owner side):**
- Admin → Plugins → browse/search → one-click install (npm fetch, integrity-pinned) → permission consent screen → enable
- Or: `npm i freeholder-plugin-gift-registry` in the deploy, auto-discovered by the `freeholder-plugin-*` naming convention
- Or: drop a folder into `/plugins` (the hackable path — a vibe-coded personal plugin never needs publishing)
- Config-as-code stays true: installed plugins + versions are recorded in `freeholder.config.ts`, so a redeploy reproduces the instance exactly

---

## 26. Trust Model (honest v1)

Plugins run **in-process** — same trust level as core once installed. Sandboxing in-process JS is a research project, not a v1 feature, so we do trust engineering instead and say so plainly:

1. **Declared permissions, enforced at the service registry.** A plugin's manifest lists scopes (`contacts:read`, `invoicing:create`, `settings:write`, `network:external`, …). The service registry rejects calls outside the granted set; the install screen shows scopes in human language ("can create invoices; cannot read your email settings"). Network egress from plugin code goes through a fetch wrapper that enforces the `network:external` scope.
2. **Registry review tiers** (mirrors deploy recipes): **Verified** (maintainer-reviewed source, in the CI matrix, badge) / **Community** (automated checks: no eval, scope-lint, license check, integrity pinned, **CHANGELOG.md present with an entry for the published version — versions without release notes are rejected by the registry**) / **Unlisted** (install by name at your own risk — always possible; it's your instance). Plugin changelog entries are what feed the instance's own release notes when a plugin is installed or updated, so a missing changelog breaks the chain for every downstream site — hence it's a hard registry requirement, not a courtesy.
3. **Kill switches:** per-plugin disable without uninstall; plugin errors are boundary-caught and degrade to a disabled widget, never a downed site; `AuditLog` records every plugin's service calls under `actor: plugin:<name>`.

**Licensing lanes (stated up front to avoid the WordPress wars):**
- **In-process plugins** import AGPL core APIs → must carry AGPL-compatible licenses. The registry checks the license field.
- **Out-of-process apps** — anything that talks to a Freeholder via REST API, SDK, webhooks, or MCP — are independent works: **any license, any commercial model.** Sell your SaaS companion freely.
This gives commercial developers a clean lane (external apps) while keeping the in-process ecosystem open — the exact ecosystem structure that kept WordPress plugins flourishing for two decades, minus the license ambiguity.

---

## 27. Registries: Federated From Day One

A plugin registry is **just a signed JSON index** — deliberately boring so that anyone can host one:

```jsonc
// https://plugins.freeholder.ai/index.json  (canonical, auto-built from npm + GitHub topic)
{ "registry": "Freeholder Official", "updated": "2026-07-22",
  "plugins": [{
    "name": "freeholder-plugin-gift-registry", "version": "0.4.2",
    "tier": "verified", "license": "AGPL-3.0",
    "permissions": ["invoicing:create","contacts:read"],
    "freeholder": ">=1.0.0", "integrity": "sha512-…",
    "repo": "github:someone/gift-registry", "description": "…", "screenshots": […]
  }]
}
```

- The admin Plugins page ships pointed at the canonical registry, and **owners can add registry URLs** — an agency's private library, a vertical marketplace ("Freeholder for Photographers"), a company-internal registry. Third-party plugin businesses are a feature, not a threat: they grow the reason to choose Freeholder.
- The canonical registry is itself generated (npm scan for the prefix + GitHub topic `freeholder-plugin`), so listing requires no gatekeeper for Community tier — publish and appear.
- `plugins.freeholder.ai` doubles as the browsable web catalog — server-rendered, RIBA-structured, one page per plugin. The plugin catalog is itself an SEO asset that markets the platform.

---

## 28. The Living Platform Contract (SDK / API / MCP / docs, never stale)

**Problem being killed:** every platform's docs and SDKs drift from reality within months. Freeholder's answer: there is exactly **one source of truth — the service registry with its Zod schemas** — and everything else is *generated* from it. Nothing is hand-maintained twice.

```
        Zod schemas + service registry + module/plugin manifests
                              │  (build step: npm run contract)
     ┌───────────┬────────────┼────────────┬──────────────┐
     ▼           ▼            ▼            ▼              ▼
 OpenAPI 3.1  @freeholder/  MCP tool    Docs site     llms.txt +
 spec         sdk (typed    definitions (API ref,     llms-full.txt
 (zod-openapi) client, gen'd (runtime,   MCP ref,     (for AI
              from OpenAPI) per-instance) guides)      consumers)
```

**How each stays current:**

1. **OpenAPI** — generated from the same Zod schemas that validate every request at runtime. It is definitionally impossible for the spec to describe a shape the API doesn't enforce.
2. **SDK (`@freeholder/sdk`, MIT)** — generated from the OpenAPI spec; typed, tree-shakable, with hand-written ergonomic wrappers only for flows (pagination, auth) — wrappers are tested against the generated layer so they break loudly if the contract moves. Published automatically on every release by CI (changesets); SDK version === platform version, always.
3. **MCP** — already runtime-generated (§11): tools are derived from the enabled services of *that instance*, so an instance with the gift-registry plugin automatically exposes gift-registry tools to agents, with descriptions from the plugin's own schema annotations. New feature merged → new MCP tool exists. No release lag at all.
4. **Per-instance introspection** — every Freeholder serves its own live contract: `/api/openapi.json` (reflecting its version + enabled modules + plugins), `/api/mcp` manifest, and `/llms.txt`. An agent or developer never reasons from generic docs about what *this* instance can do — they ask it.
5. **Docs site** (`docs.freeholder.ai`) — reference sections are built from the generated artifacts in CI on every release; prose guides live beside code and are **executable**: doc snippets are extracted and run against the seeded demo instance in CI, so a guide with stale code fails the build. Docs ship `llms-full.txt` so AI assistants helping developers always have current ground truth.
6. **The drift gate** — CI fails any PR where committed generated artifacts differ from freshly regenerated ones. Contract updates are not a chore anyone can forget; they are a build step no one can skip.

**Change discipline:** semver on the platform; additive changes flow freely; breaking changes require a deprecation window (old shape served with `Deprecation` headers + changelog entry auto-assembled from conventional commits). The generated diff between two OpenAPI versions *is* the migration guide's skeleton.

---

## 29. What This Buys the Ecosystem

- A weekend contributor ships a plugin in an afternoon and it's discoverable the same day (Community tier, no gatekeeper).
- An agency builds a private registry of client plugins and manages fleets of Freeholder instances declaratively.
- A commercial developer sells an external companion app via the MIT SDK with zero license anxiety.
- An AI agent connected to any instance discovers its exact live capabilities — including plugins installed yesterday — through MCP introspection, and the docs it reads are generated from the code it's calling.
- And the core team maintains **one** thing: the service registry. Everything else — API, SDK, MCP, reference docs, llms.txt — is a build artifact.

---

## 30. CRM Depth: Newsletters, Templates, Lifecycles

**Newsletters as a first-class object** (not just "campaigns"): a `Newsletter` is a recurring publication with an identity — name, description, cadence, public archive page (server-rendered, in the sitemap: every past issue is an SEO asset), and its own subscribe endpoint/embeddable form. Contacts hold per-newsletter subscriptions with double-opt-in records and one-click unsubscribe (RFC 8058), consent timestamps retained for compliance (CASL — you're Canadian — GDPR, CAN-SPAM).

| Entity | Key fields |
|---|---|
| `Newsletter` | name, slug, description, cadence, from_identity, archive_public (bool), template_id |
| `NewsletterSubscription` | contact_id, newsletter_id, status, consent (jsonb: method, ip, at), source |
| `EmailTemplate` | kind (newsletter/campaign/transactional/automation), name, blocks (jsonb — same block editor as pages, §32), variables[], locale variants via EntityTranslation |
| `NewsletterIssue` | newsletter_id, subject, blocks, status, sent_at, archive_slug, stats rollup |

**Template system:** one template model serves everything — newsletter layouts, campaign designs, and transactional emails (receipt, booking confirmation, quote sent) are all `EmailTemplate` rows editable in the same drag-and-drop editor, with locked variable slots ({{invoice.total}}, {{booking.starts_at_local}}) that render per contact locale/timezone/currency. Transactional templates ship as defaults, owner-customizable, with a "reset to default" escape hatch and test-send-to-self on every editor screen.

**Lead lifecycles, configurable:** the hardcoded lifecycle_stage becomes a definable pipeline. `LifecyclePipeline` (name, stages[] with order, color, and stage-entry automations) — default ships as Subscriber → Lead → Prospect → Customer → Repeat → Advocate, fully editable. Stage transitions are service-layer events: they emit TimelineEvents, can trigger automations ("entered Prospect → send case-study sequence"), and power a kanban pipeline view in admin. Multiple pipelines allowed (e.g., a wholesale pipeline beside retail). Lead scoring v1: simple, transparent point rules on spine events (opened 3 emails +5, viewed pricing +10, quote accepted → auto-advance) — no black-box scoring.

---

## 31. Front-Site AI Assistant (owner-controlled, knowledge-grounded)

An optional module (`growth/assistant`), **off by default, enabled by a setting in admin** — when on, the public site gets a chat assistant that answers as the business: hours, services, pricing, availability, policies — and can *act* within tight, owner-granted scopes (start a booking, capture a lead, request a quote) via the same permission-scoped service layer as everything else.

**LLM selection follows the adapter pattern (`adapters/ai`):** owner picks provider + model + key in admin. **On the Replit recipe, this defaults to Replit's hosted model providers** (platform-billed, zero extra signup — the assistant works minutes after deploy); on other targets it's BYO key (Anthropic/OpenAI/etc.) with a "none" fallback that simply hides the assistant.

**Knowledge base, easily edited in admin:**
- **Auto-grounded:** the assistant's retrieval index is built from what the site already knows — published pages, service descriptions, product catalog, locations/hours, public policies. Publish a change → index updates. No copy-paste maintenance.
- **`KnowledgeEntry`** — owner-added Q&As, facts, and policies in a simple admin CRUD ("we don't shoot weddings in December," "parking is behind the building"), each toggleable and locale-aware.
- **Guardrails as settings, not prompts:** topics to refuse, escalation rule ("if asked about X, offer the contact form"), tone presets, and a hard rule set the module enforces outside the model: the assistant never invents prices or availability — it quotes the catalog and calendar through service calls or says it doesn't know.
- **Every conversation lands on the spine:** transcripts attach to the Contact (created on email capture), emit TimelineEvents, and unanswered questions queue in admin as "knowledge gaps" — the owner turns yesterday's failed answer into today's KnowledgeEntry in one click. The assistant measurably gets smarter weekly, and the owner can see why.

Embeddings for retrieval use pgvector — inside the one sacred database (principle 12, §2), not a bolt-on vector store.

---

## 32. Universal Drag-and-Drop Editor

One block editor for **everything with a public face** — pages, posts, email templates, newsletter issues, landing pages, the assistant's rich answers, and the site chrome itself. Not a per-feature editor zoo; the same `blocks (jsonb)` schema everywhere, with per-context block palettes (email context excludes interactive blocks and renders to table-based HTML for mail clients; page context gets the full set).

**Structure is data; code is vocabulary.** The governing rule of the whole editing surface: rearranging the site — any page, the chrome around it, the look of it — is a database write, live on next request, never a build. Only extending the *vocabulary* (a new block type, a new behavior) is code, which arrives via plugin and its rebuild-on-install. There is no build step between an owner and their site.

- **Block library v1:** text, heading, image (auto alt-text suggestion), gallery embed, video, button/CTA, columns, divider, FAQ (emits FAQPage schema), testimonial (pulls from reviews), product/service card (live from catalog), booking widget, form embed, quote-request, map (from locations), social embed, share block (§34), tip/support (pay-what-you-want with preset amounts), paywall gate (wraps any blocks behind a one-time unlock or subscription — server-rendered teaser, gated content never present in the HTML), custom HTML (admin-only permission).
- **Editing model:** drag to reorder, slash-command insertion, inline editing, autosave with visible version history and one-click restore (`ContentRevision` rows — normalized, in the database, per the mandate). Live responsive preview (desktop/mobile) and — for emails — inbox preview with the test-send button adjacent.
- **Templates & sections:** any block arrangement can be saved as a reusable Section (synced or detached copies), and full-page templates ship per business preset. Plugins register new block types through the manifest (§24) and they appear in the palette with zero editor changes.
- **Site chrome is Sections:** the header, footer, nav, and announcement bar are synced Sections — block trees in the database, edited in the same editor, server-rendered on every page. Menus are rows, not JSX. `app/(public)/layout.tsx` is a thin shell that renders the chrome Sections; it contains no hardcoded site structure.
- **Design tokens, not themes:** colors, typography, logo, spacing, and radii are settings rows emitted as CSS custom properties at request time; Tailwind's palette references the variables rather than hardcoding values. Rebranding the site is a settings save, effective on next page load.
- **Templates are defaults, never cages:** the layout of a product, service, or post page starts from a stored template whose dynamic blocks bind to the entity being viewed (this product's gallery here, price block there, reviews above the fold if the owner drags them there) — but any individual entity can detach into a fully bespoke block tree of its own. Every entity with a public face carries an optional per-entity `blocks` override; a store where every product page is completely different is a supported first-class state, not a workaround. Default templates ship per business preset as seed data, so day one still looks designed.
- **Variants are native (A/B everywhere):** any block, Section, page, or per-entity layout can hold named variants with a traffic split — variants live inside the same `blocks` schema, not in a bolt-on experiment tool. Assignment is server-side and sticky per visitor, rendered in the initial HTML (no client-side swap flicker), and every conversion-bearing block (CTA, form, checkout, booking, quote request, newsletter signup, tip, paywall gate) reports impressions and conversions to first-party analytics on the spine. "Which headline books more calls" is a native report joined to actual revenue, and adding a variant is one action in the editor, everywhere. Caching is designed for this from day one: the visitor's variant assignment is part of the page-cache key (and the cache layer's Vary surface), so full-page and edge caching coexist with live experiments by construction — never a retrofit.
- **Typed blocks, never markup blobs:** every block is a Zod-schema'd JSON node rendered by a server component. Stored HTML soup forfeits the SEO gate, sane migrations, and re-theming forever — the custom HTML block stays admin-only, scoped, and deliberately inconvenient.
- **The SEO contract holds:** blocks render server-side to semantic HTML; the editor enforces one H1 and warns on heading-order violations — the drag-and-drop layer can't produce pages that fail the SEO gate.

---

## 33. Social Media Hub (central ingest & export)

Upgrades the `growth/social` module into the media traffic-controller: **one place where media flows in from and out to every connected platform.**

- **Connections:** admin OAuth connect for Instagram, Facebook, TikTok, YouTube, LinkedIn, X, Pinterest, Google Business Profile — each a `SocialAccount` with health status (token expiry warnings surfaced, not discovered at post time). Platform adapters isolate each API's chaos behind one interface (`adapters/social/*`), so a broken platform API is one adapter patch, not a core release.
- **Ingest:** pull your own published posts and their media back into the Asset library (creators' camera rolls live on Instagram; their site should be able to reclaim them). Imported assets carry provenance (platform, original post, date) and can be dropped into galleries, pages, and testimonial blocks. Comment/mention ingestion queues into a lightweight social inbox that attaches to Contacts where identifiable.
- **Export:** compose once in the block editor's social composer → per-platform variants (crop presets 9:16/1:1/16:9, caption lengths, hashtag sets per platform, burned-in captions via ffmpeg) → schedule across accounts from one calendar view. Every published post links back to a site URL with share tracking (§34), closing the loop in first-party analytics: which post drove which visit drove which sale.
- **Google Business Profile is a first-class citizen** (posts, hours sync from `OpeningHours`, review ingestion into the reviews module) — for local businesses GBP outranks every social network in revenue impact, and almost no tool treats it seriously.

---

## 34. Sharing in the DNA

Sharing isn't a buttons plugin; it's a property of every entity with a public face.

- **Everything shareable has a `ShareTarget`:** canonical URL + auto-generated OG image + per-channel share intents (native Web Share API on mobile, channel links on desktop, copy-with-attribution). Pages, posts, products, galleries (and individual gallery images where the owner allows), newsletter issues, events, reviews, the changelog — one system, present by default, removable per entity.
- **Tracked, first-party:** share links carry a short `ref` token → `SharedLink` rows (entity, sharer contact if known, channel) → clicks land as analytics events attributed to the share. The owner sees "this gallery was shared 12 times and drove 3 bookings" — sharing becomes a measured channel, not a hopeful button.
- **Client-side sharing where it counts:** a client can share their proofing gallery with a partner (scoped guest access, owner-permitted), share a quote internally before accepting ("send to my business partner" issues a view-only link), and gift-card/registry-style sharing on products.
- **Referral & advocacy rails (spec'd — `growth/affiliates`, §3, §4.3):** every Contact can hold referral codes; referred conversions attribute automatically on the spine. Admins define commission rules for **any** conversion type — signups, subscriptions, orders, bookings, custom events — and codes are dual-sided: the visitor gets the discount, the referrer earns the commission (a creator sends visitors with code IROCK → the subscriber gets 10% off, the creator earns 10% commission). Attribution is first-party (`?ref` token → `AffiliateCode` → `CommissionEvent`), the ledger runs pending → approved → paid with automatic reversal on refund, and referrers see their own earnings in the customer portal — an affiliate is just a Contact with a code, not a separate system. The loyalty module (roadmap, §36) extends these same rails with points and tiers rather than inventing its own tracking.
- **Embeds:** galleries, review walls, booking widgets, and newsletter signup blocks all emit copy-paste embed codes — Freeholder content propagates onto other sites with backlinks. Sharing outward is also an SEO strategy.

---

## 35. React Native App: Always Ready for the Stores

`packages/mobile-app` (MIT): a **white-label Expo/React Native app** for the business's *customers*, driven entirely by the instance's generated SDK and live contract (§28) — permanently in sync with the platform by construction.

- **In the box v1:** branded home (colors/logo/fonts pulled from instance settings), browse services & products, book with push-notification reminders, view/pay invoices, client galleries (the killer feature — proofing and favoriting from a phone is where clients actually live), portal messages, newsletter content, push notifications for the moments that matter (booking confirmed, gallery ready, invoice due, back-in-stock).
- **Always submission-ready:** `npx freeholder-app init` reads the instance URL → pulls branding, generates icons/splash from the logo, writes store metadata (descriptions from the business profile, screenshots auto-captured from seeded content) → `eas build` produces store-submittable binaries. The CI matrix builds the app against the demo instance on every release, so "ready for submission" is a tested property, not a promise. Store-listing checklists (Apple review quirks, Play data-safety forms) ship as docs with the honest caveat that review outcomes are the stores' call.
- **Owner companion (v2):** same codebase, admin mode — today's-bookings glance, tap-to-invoice, respond to messages, approve reviews. One app, role-gated, since the SDK already enforces permissions.

---

## 36. Mined Roadmap: What WordPress & Shopify Prove People Want

Method: the most-installed plugins/apps on both ecosystems are a revealed-preference map of what every SMB eventually bolts on. The pattern across both stores in 2026 is consistent — SEO, page building, forms, security, performance, email/SMS flows, reviews with photos, loyalty/referrals, upsells, wishlists, subscriptions, support inboxes, and mobile apps dominate installs (per current ecosystem rankings: Yoast/Rank Math, Elementor, WPForms/CF7, Wordfence, WP Rocket/Smush, Klaviyo/Omnisend, Loox/Judge.me, ReferralCandy/Smile, Recharge, Gorgias, Tapcart/Shopney). Freeholder's plan for each, sorted by disposition:

**Absorb into core (table stakes the tool-mash proves):**
- **Security hardening** (Wordfence's category): rate limiting, login protection, 2FA for staff, security headers, dependency audit in CI — shipped, not sold.
- **Performance & image optimization** (WP Rocket/Smush): automatic responsive variants, AVIF/WebP, lazy loading, CDN-friendly caching headers — the media pipeline does this by default; Core Web Vitals tracked in first-party analytics.
- **Anti-spam** (Akismet): honeypots + time-traps + optional Turnstile on every form and the assistant; submission quarantine queue.
- **Photo/UGC reviews** (Loox/Judge.me): review requests post-purchase/booking with photo upload, incentive coupon option, review walls as blocks, AggregateRating schema — extends the existing reviews module.
- **Wishlists & saved carts** (Wishlist Plus): contact-attached, cross-device, with "price dropped / back in stock" hooks.
- **Back-in-stock + waitlists**: inventory events → notification subscriptions — trivial on the spine, disproportionately loved.
- **Upsells, cross-sells, bundles, order bumps** (Kaching et al.): related-products, bundle pricing, post-add-to-cart offers, checkout bump — rules configured in admin, no code.
- **Events & ticketing** (The Events Calendar): an `Event` entity (venue from locations, schema.org Event, ICS) selling tickets through standard products — bridges booking and commerce.
- **Popups, announcement bars, exit-intent** (OptinMonster's category): block-editor-built, frequency-capped, targeting rules; newsletter capture wired to §30 consent records.
- **Automations/workflows** (Uncanny Automator, Klaviyo flows): visual trigger→condition→action builder over spine events; plugins contribute verbs (§24). This is the connective tissue that makes everything else compound.
- **Support inbox + live chat** (Gorgias/Click-to-Chat): unified inbox (site chat, assistant escalations, contact forms, social inbox) threaded per Contact; WhatsApp/Messenger deep-links for the click-to-chat pattern.

**Ship as first-party plugins (wanted often, not by all):**
- **Loyalty programs** (Smile's category) extending the core affiliates module (§3, §34): points, tiers, rewards on the same first-party attribution rails — referrals and commissions themselves are already core.
- **SMS marketing** (Klaviyo/Omnisend's second channel) via the sms adapter, consent-gated.
- **Gift options & registries**; **local delivery/pickup scheduling** (huge for food/retail); **print-on-demand adapter** (Printify-style) as a fulfillment plugin; **memberships/gated communities** beyond simple subscriptions.

**Explicitly out (the anti-roadmap):** dropshipping marketplaces, ad-network integrations, third-party analytics pixels as core, page-builder lock-in formats, anything that makes the owner's data someone else's product. The WordPress lesson cuts both ways — install-count proves demand, but half those plugins exist to patch an incoherent core. Freeholder absorbs the coherence and leaves the patchwork behind.

**Sequencing:** core absorptions land across v1.x in roughly the order listed (security/performance/anti-spam are v1.0 gates, not features); first-party plugins are the launch catalog for the plugin registry — seeding the ecosystem with high-demand examples that teach the plugin API by existing.
