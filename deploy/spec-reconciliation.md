<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Spec reconciliation — §§1–42 vs schema, services, UI

*MASTER.md C11.16. Reconciled 2026-09-13 against parent `2b14cbe`.*

C11.16 requires that every affirmative capability in §§1–42 either has a
completed checklist item, is listed here as remaining work with an open
checklist id, or is struck from the spec in the same change. This file is that
table. It is not C11.17 and it does not claim DONE.

**Method.** Section headings in `MASTER.md` were read against:

- schema: every `pgTable` in `src/` and `plugins/` (343 tables)
- services: registry names (`defineService` / orchestrators)
- UI: `app/(admin)/admin/**/page.tsx` (136), `app/portal/**/page.tsx` (20),
  public catch-all `app/(public)/[[...slug]]`, embed/capture/gift/community
  routes, `apps/mobile`

Checked C-items are the delivery evidence; unchecked C-items are remaining.
Anti-roadmap rows are refusals, not leftovers.

## How to read the table

| Status | Meaning |
|---|---|
| Built | Affirmative claim exists in schema, services and a human surface, with a checked C-item |
| Built (service) | Schema + services exist; F04 is a named existing screen or an explicit N/A on the C-item |
| Remaining | Affirmative, not complete; named open C-item |
| Struck | Wording in §§1–42 over-claimed; narrowed in this change |
| Doctrine | Architecture / refusal / historical rationale, not a feature to ship |

## §§1–42

| § | Title | What exists | Status | Remaining or struck |
|---|---|---|---|---|
| 1 | Why Freeholder | Pitch, Apache-2.0, contribute channel, demo fixture. Recipes in `deploy/`. | Built | Struck: `/docs/deploy` path (actual `deploy/`). |
| 2 | Architectural principles | Single-tenant, monolith, contact spine, invoice convergence, adapters, first-party analytics, service layer, SSR SEO, i18n, one database. | Doctrine + built | None as leftover features. |
| 3 | Module map | Core + commerce + services + content + growth + platform folders exist as `src/core`, `src/modules/*`, `plugins/*`. Admin shell, CRM, inbox, automations, portal, reporting, API, MCP all present. | Built | Struck: `[v2: auto-clip]` on social; tax line is the `none` seam, not named vendors. Folder names in the tree are conceptual (catalog owns orders; scheduling owns booking; newsletters owns email-marketing). |
| 4.1 | Identity & access | `roles`, `role_grants`, `users`, `sessions`, `login_security_events`, `staff_invitations`, `customer_magic_links`, `contacts`, `organizations`, `timeline_events`. `/admin/roles`, `/admin/invitations`, `/security`, `/admin/contacts`. | Built | C1.01–C1.08. |
| 4.2 | Catalog | Products, variants, options, attributes, media (incl. GLB/glTF/USDZ), relations, bundles, service offerings, price lists/breaks, customer groups, inventory ledger, back-in-stock, suppliers/POs, digital deliveries, rental terms, passes. `/admin/products`, inventory, procurement, price-lists. | Built | **Struck `LicenseKey` and `DigitalFulfillment` sibling fields** (`license_template_id`, `watermark_policy`). Grants are `digital_deliveries` tokens (C5.19). |
| 4.3 | Money | Orders, quotes, contracts, invoices, payments, subscriptions, content unlocks, tips, coupons, gift cards, affiliate program/code/commission. `/admin/orders`, quotes, agreements, invoices, payments, promotions, referrals. | Built | **Struck Stripe Connect as a DONE payout adapter.** C9.10 ships manual/CSV batches. Live hosted settlement remains honesty on C11.05, not a claimed hop. |
| 4.4 | Time | Calendars, memberships, rules/exceptions, busy blocks, bookings, participants, waitlist, reminders, cancellation policies, audiences. `/admin/calendar(s)`, appointments, waitlist. ICS + Google/Microsoft writeback. | Built | **Struck `BookingSeries`.** Recurring is not a first-class RRULE entity; each occurrence is a `Booking`. ICS import does not expand `RRULE` (`src/core/ics.ts`). |
| 4.5 | Media & galleries | Assets, capture sessions, galleries, selections, access logs, documents/versions/shares, projects/outcomes/media/collections/testimonials. `/admin/media`, galleries, documents, projects. | Built | C1.12–C1.29, C8.01–C8.08, C8.13. |
| 4.6 | Content, forms, SEO | CMS pages/posts/revisions, forms/submissions, redirects, help articles/categories. Catch-all public route. `/admin/pages`, forms, redirects. | Built | **Struck `SeoSetting` as a table.** Sitewide SEO lives on `business_profile` + CMS page SEO jsonb + `redirects`. |
| 4.7 | Growth | Broadcasts (not a separate `EmailCampaign` table), reviews, social accounts/packages/variants/publications, analytics events. `/admin/newsletters`, social, traffic. | Built | Table names differ (`broadcasts`, `mail_deliveries`); the capability is C9.04–C9.06, C9.24–C9.27, C8.09, C1.18. |
| 4.8 | Platform | API keys, webhooks, audit log, release notes, module settings, guidance, demo scenarios, contributions. `/admin/plugins`, contribute, demos, guidance, updates, health. | Built | **Struck dedicated public `/changelog` route.** Instance notes are `/admin/updates`; a CMS page can reprint them. Agent-mandatory release notes remain. |
| 4.9 | Internationalization | `business_profile` locales/currency/timezone/units; `entity_translations`; en/fr/es catalogs; locale-prefixed public URLs; hreflang/sitemaps. `/admin/translations`. | Built | **Struck `LocaleSetting` / `CurrencySetting` / `FxRate` tables and `adapters/fx`.** Those fields live on `business_profile`. Auto-FX display stays off (§8). Charges never auto-convert. |
| 4.10 | Locations & NAP | `business_locations`, `opening_hours`, `service_areas`; location pages via CMS. `/admin/locations`. | Built | C2.21 feeds, C9.27 GBP hours. |
| 4.11 | Shipping | Zones, methods, rate bands, boxes, fulfillments, delivery windows, RMAs. `/admin/shipping`, fulfillment, returns. Carrier family is `adapters/carrier/none`. | Built | Live carrier labels/rates are the seam, not a shipped UPS/ShipStation adapter (C5.18 honesty). |
| 4.12 | Tax | Categories, zones, rates, registrations, exemptions, tax lines. `/admin/invoices/tax`. `adapters/tax/none` plus built-in templates (CA/EU/UK/US/AU/NZ). | Built | **Struck named Stripe Tax / Avalara / TaxJar implementations as DONE**, including the leftover “replacement family” sentence. The contract is C5.01; the arithmetic is the templates (C5.02–C5.04). |
| 4.13 | Loyalty & referrals | Programs, accounts, points ledger, tiers, rewards, attribution, invitations, payout batches/lines. `/admin/loyalty`, referrals. | Built | C9.09–C9.12. Payout `method` is manual; `provider` is not a shipped adapter (see 4.3). |
| 4.14 | Messaging | Conversations, messages, deliveries, numbers, windows, keywords, SMS Twilio, site chat. `/admin/inbox`, messaging. Voice/video is the plugin. | Built | C7.08–C7.15, C3.13 plugin. |
| 4.15 | Subscriptions & paywalls | Plans, subscriptions, entitlements, grants, pass balances, paywalls, meters, dunning. `/admin/subscriptions`, paywalls. Portal self-service. | Built | **Live Stripe/PayPal settlement remaining honesty (C11.05), not a claimed hop.** |
| 4.16 | Ads | Sizes, slots, advertisers, campaigns, creatives, stats, ads.txt. `/admin/ads`. | Built | C9.17–C9.20. |
| 4.17 | Runs | `runs`, `run_steps`, `run_approvals`, `run_spend` shared by agents and automations. `/admin/work`, automations. | Built | C4.02, C9.02. |
| 5 | SEO layer | SSR catch-all, schema.org JSON-LD, hreflang, sitemaps, llms.txt, robots, IndexNow, OG, product/location feeds. `scripts/seo-gate.mjs`, public-gates. | Built | C2.20–C2.22, C1.18. |
| 6 | Cross-module flows | C11.01–C11.07 journeys prove the compounding paths with adapter doubles. | Built | Live provider sessions/charges not claimed. |
| 7 | Original v1 slice | Historical dependency rationale. Subscriptions, gift cards, PayPal, voice/video plugins all later shipped. | Doctrine | Not a live backlog. Auto-clip struck (see §3). |
| 8 | Design decisions | Custom fields jsonb, multi-currency without auto-FX, tax templates, en/fr/es, logical CSS, hreflang in core. | Built | RTL catalog is still English/French/Spanish; injected `dir` is C11.12 leftover, not a shipped Arabic catalog. |
| 9 | Stack | Next App Router, strict TS, Drizzle, Postgres, pg-boss, S3 adapter, Tailwind, ICU, Zod, hand-rolled sessions. | Built | Lucia is the pattern, not a dependency. |
| 10 | Repository layout | Matches the tree with the as-implemented notes in MASTER. Packages: sdk, create-freeholder, templates, mobile-app, cli, plugin-kit. | Built | Struck `adapters/fx`. Public routing is the catch-all, not per-section files. |
| 11 | Module contract | `defineModule` manifests, tables, services, events. Modules do not import each other. | Built | C3.08–C3.12. |
| 12 | Adapter contract | Payments (Stripe, PayPal, manual, Square, Mollie, Razorpay, Paystack, Flutterwave), mail (Gmail/Outlook/Resend/Postmark/SES/SMTP), storage, SMS Twilio, AI, agent, POS Stripe/manual, social, tax/carrier/calendar `none`. | Built | **Struck Mercado Pago as in-plan.** C5.07 shipped the four named “after 1.0” adapters. Accounting is export shapes (C9.32), not an adapter family. |
| 13 | Setup wizard | `/setup` country/locale/currency/timezone, owner, modules, demo. | Built | C1.24–C1.25. |
| 14 | Replit-first deploy | `.replit`, `replit.nix`, `create-freeholder`, `env.ts`, doctor, ownership export. | Built | Struck MIT on the scaffolder (Apache-2.0, C0.10 / §22). |
| 15 | Quality gates | typecheck, lint, tests, SEO, i18n, money, service-layer, changelog, a11y, upgrade, schema-compat, autofill, perf harness. | Built | Medium-dataset perf and browser vitals remain C11.11. Upgrade gate needs published images. |
| 16 | Agent conventions | CLAUDE.md, one C-item per change, DCO, changesets. | Built | C0.08, C0.12. |
| 17 | Configuration | `freeholder.config.ts`, env Zod, doctor. | Built | C3.16 recipes. |
| 18 | Recipe anatomy | Six recipe directories with README / env / infra / verify. | Built | C3.16–C3.17. |
| 19 | Support tiers | Tier-1 vs community labelled in recipes. | Built | C3.16. |
| 20 | Replit recipe | `deploy/replit/`. | Built | C3.16. |
| 21 | DigitalOcean | App Platform + droplet recipes. | Built | C3.16, C10.10. |
| 22 | create-freeholder | `packages/create-freeholder`, Apache-2.0. | Built | C3.14. |
| 23 | Migration matrix | Ownership export + `scripts/ownership-drill.mjs --all-pairs`. | Remaining (C11.08 hop) | Drill exists; restore on another live Tier-1 instance is C11.08. |
| 24 | Plugins: the design bet | `src/core/plugins`, `packages/plugin-kit`, isolate, first-party plugins under `plugins/`. | Built | C3.08–C3.13. |
| 25 | Plugin DX | Scaffolding, fixture instance, contract tests, `packages/plugin-kit`. | Built | C3.12. |
| 26 | Trust model | Signed install, capability isolation, hostile-plugin refusals. | Built | C3.10–C3.11. |
| 27 | Federated registries | Local/community/verified/private registries. | Built | C3.11. |
| 28 | Living platform contract | OpenAPI, SDK, MCP, `llms.txt` generated from the registry. | Built | C3.01–C3.07. |
| 29 | Ecosystem | First-party plugins teach the API by existing. | Built | C3.13 gift/print/community/voice-video/marketplace. |
| 30 | CRM depth | Pipelines, tasks, notes, segments, scoring, saved views, imports, newsletters, templates. `/admin/pipeline`, tasks, segments, scoring, newsletters. | Built | C7.01–C7.07, C9.04–C9.06. |
| 31 | Front-site assistant | Grounded assistant, guardrails, corpus. `/admin/assistant`, public block. | Built | C9.21–C9.23. |
| 32 | Universal editor | Block editor, sections, templates, layouts, tokens, experiments, email-safe output. `/admin/pages`, sections, templates, design, experiments. | Built | C2.01–C2.23. |
| 33 | Social hub | OAuth, ingest, composer, GBP, publication calendar. `/admin/social`. | Built | C9.24–C9.27, C9.31. Auto-clip struck. |
| 34 | Sharing DNA | Share targets, tracked links, gallery partner, quote partner, product/gift share, embeds. `/admin/sharing`, embed routes. | Built | C9.28–C9.29, C9.34–C9.36. |
| 35 | React Native app | `packages/mobile-app`, `apps/mobile`, screen contracts, push tokens, private cache, companion/capture code, `freeholder-app init`, store/CI gates. | Remaining | **C10.15 and C10.16 are checked.** Device leftover is physical proof: C10.17 companion, C10.18 capture batches, C10.25–C10.28 tabs, C10.30 cache. Signed store binaries still need EAS credentials. |
| 36 | Mined roadmap | Core absorptions and first-party plugins match C3.13 / C5–C9. Anti-roadmap held. Autofill gate §36.1 / §15.10. | Built | Anti-roadmap is exclusion, not leftover. |
| 37 | Self-building instance | Builder content + code lanes, MCP, `/source`, budgets, approvals. `/admin/builder`. | Built | C4.19–C4.22. GitHub PR delivery still needs a connected repo (C11.06 honesty). |
| 38 | Day-one surface | Demos, guidance, capture, services, calendars, catalog, shipping/tax, passes, loyalty, SMS, subscriptions, ads, time, POS, projects, galleries, SEO, CRM, automations, reporting, roles, export, help, waivers, updates. | Built except named leftovers | In-person Terminal is adapter representation (C5.24), not a claimed live reader. 3D/AR is accepted media roles (C5.11), not a storefront AR viewer. |
| 39 | Staying current | Channels, signed feed, checks, preflight, apply/rollback, N-1, policy, fork lane, targets, admin/CLI/MCP. `/admin/updates`. | Built | C10.01–C10.11, C10.19–C10.22. |
| 40 | Agent orchestration | Connections, workers, tasks, runs, approvals, spend, playbooks, pause/kill. `/admin/work`. | Built | C4.01–C4.10, C4.23. |
| 41 | Connected accounts | OAuth, encrypted credentials, calendar/mail grants, busy union. `/admin/settings` connections. | Built | C4.10–C4.13, C4.18. Live Google/Microsoft sessions not claimed (C11.07). |
| 42 | Briefing | Briefings, contributions, preferences, playbook schedules. `/admin/briefing`. | Built | C4.14–C4.17. |

## Struck in this change (were affirmative, are not built, had no open C-item)

These are removed from §§1–42 so C11.16 is not papering over them:

1. **`BookingSeries`** as a required entity — occurrences are `Booking` rows.
2. **`LicenseKey`** and `DigitalFulfillment` sibling fields (`license_template_id`, `watermark_policy`) — digital access is `digital_deliveries`.
3. **Stripe Connect / payout-provider adapter as DONE** — C9.10 CSV/manual is the shipped path. `PayoutBatch.method` is `manual`.
4. **Social auto-clip as a v2 DONE feature** — C9.26 ships reviewed variants; auto-clip is not in the plan.
5. **Dedicated public `/changelog` route** — `/admin/updates` is the instance log.
6. **`LocaleSetting` / `CurrencySetting` / `FxRate` tables and `adapters/fx`** — profile columns; no auto-FX.
7. **`SeoSetting` table** — redirects + profile + page SEO.
8. **`/docs/deploy`** — `deploy/`.
9. **MIT on `create-freeholder`** — Apache-2.0.
10. **Mercado Pago as in-plan** — not a C-item; C5.07's four adapters shipped.
11. **Named Stripe Tax / Avalara / TaxJar implementations** — tax `none` + templates. §4.12's leftover “replacement family” sentence, and §3's “Stripe Tax et al” seam label, now match.

## Remaining affirmative work (open checklist items)

These stay in the spec. They are why C11.17 cannot be checked.

| Item | What is still true |
|---|---|
| Device evidence | C10.17, C10.18, C10.25, C10.26, C10.27, C10.28, C10.30: native screens/cache exist in tree; physical device, keychain and accessibility inspection are not claimed. C10.15 init and C10.16 store/CI gates are checked. |
| Independent security review | C11.10 — packet at `security/independent-review-packet.md` is not a signed review. |
| Live settlement | C11.05 remaining honesty. Manual/offline and adapter doubles are what journeys run. Hosted Stripe/PayPal charges are not claimed. |
| C11.08 Tier-1 restore | Fresh demo + WordPress/generic import + local signed apply/rollback exist. Restore onto another live Tier-1 target remains the ownership-drill pair matrix, not a second instance in the journey. |
| C11.11 large seed | Small-seed server clocks in CI. Medium/large §15.1 seed, Core Web Vitals, editor, job-queue, migration and cold-boot are opt-in and fail closed here. |
| C11.12 leftovers | Axe on setup/admin/editor/storefront/portal plus a bounded extra set of owner F04 list screens (search, retention, payments, messaging, pipeline, products, redirects, pages, community, voice-video, plus the earlier roles/invitations/contacts/health/settings/plugins/work). Remaining F04 lists (inbox, invoices, orders, galleries, quotes, forms, media, jobs, locations, calendar, automations, reports, newsletters, appointments, and others) and detail pages with record ids stay out. RTL is injected `dir`, not a shipped Arabic catalog. |
| C11.14 leftovers | `search.query` covers registered live sources; other titled contact-attached stores (orders, subscriptions, remaining SEARCH_TABLE_OPT_OUTS) stay per-list. Per-record restore is merge-undo + instance drill, not undelete-every-row. Retention is a bounded per-kind policy registry + `core.applyRetention` job (privacy holds honoured; consent/audit/accounting opted out), not a TTL column on every table. |
| C11.15 leftovers | Scaffold/TODO/false-positive gates closed in earlier passes. Not every sentence in §§1–42 has its own acceptance test; this recon is the map, not a substitute for those tests. |
| C11.17 | Unsigned. Owner must sign the §43.1 record after the clean-room suite. |

## Anti-roadmap (correctly not built)

Multi-tenancy, payroll, full bookkeeping and tax filing, multi-level referrals, warehouse/WMS depth, a general mail client, core voice/video implementations, third-party surveillance as core, page-builder lock-in formats, dropshipping marketplaces, crypto payments, raw card data.

Marketplace channel sync and gated communities are first-party plugins (C3.13), not core.

## C11.17 clean-room suite (command list)

Run from the repository root. This is the suite the owner signs; this change
runs whatever the worktree can run (no Docker images, no second Tier-1 host,
no physical device).

| Command | What it proves | This worktree 2026-09-13 |
|---|---|---|
| `pnpm plan:check` | §43 ids, evidence, proofs, current focus | ran: 297 IDs, 269 checked, 28 open |
| `pnpm exec tsc --noEmit` | types, including C11.02 `onHand` narrowing | ran: clean |
| `node scripts/license-headers.mjs` | SPDX | ran: clean |
| `node scripts/changelog-gate.mjs` | changeset + CHANGELOG version | ran: clean |
| `pnpm exec vitest run tests/core/spec-reconciliation.test.ts tests/core/plan-gate.test.ts tests/core/changelog-output.test.ts` | recon + plan + changelog output | ran: clean |
| `pnpm gates` | tsc, lint, license, changelog, plan, contract suites | **not green:** lint is red on pre-existing `messaging` schema imports, pipeline `toFixed`, work-form literals; contract suites fail `mobile-private-cache` (C10.30 tsconfig, no `TEST_DATABASE_URL`) |
| `pnpm test` | Vitest unit/service/db suite | skipped: `TEST_DATABASE_URL` unset |
| `pnpm test:journeys` | Playwright C11 + journeys | skipped: no app/db |
| `pnpm test:a11y` | Playwright axe | skipped: no app/db |
| `pnpm ownership:drill` | §23 pair matrix | skipped: no `psql` |
| `bash scripts/upgrade-gate.sh` | §39.9 previous-image upgrade | skipped: no Docker, no `PREVIOUS_IMAGE` |
| `bash scripts/public-gates.sh` | SEO crawl of seeded image | skipped: no Docker |

A green local `plan:check` is not C11.17. Journeys, ownership-drill and
upgrade-gate belong on CI or a signed owner run. Do not treat this table as
DONE.

## What this file does not claim

- Product DONE.
- Independent security review.
- Live payment-provider settlement.
- Native store submission or a physical-device walkthrough.
- That every F04 screen has been axe-walked in this worktree.
