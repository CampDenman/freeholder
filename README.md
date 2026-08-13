# Freeholder

**The open-source operating system for a one-person business.**

Stop renting your business. Creators and small businesses today duct-tape
together a website builder, a booking tool, a gallery host, a CRM, an
invoicing app, an email platform, and a social scheduler — each one a
subscription, each one owning a silo of the same customer. Freeholder
replaces the stack with one self-hosted platform where a contact is **one
record**: their bookings, orders, quotes, gallery access, messages, and email
history all hang off one CRM timeline.

> **Status: active product development.** The core platform, visual CMS,
> forms, analytics, HTTP API, webhooks, MCP, agent task substrate and encrypted
> connection model are implemented. Consent evidence, the customer privacy
> centre, protected data exports/corrections, and audited erasure with legal
> retention exceptions are also implemented. Background work now commits
> atomically with its caller and has durable idempotency, bounded retry/backoff,
> global concurrency, cancellation, heartbeat leases, an owner-visible run
> ledger, retained dead letters, stuck-work warnings, and audited recovery
> controls. The complete scope,
> verified baseline and remaining checklist live only in
> [`MASTER.md` §43](MASTER.md#43-product-completion-plan--the-live-checklist).

## Product-complete target

This is the intended finished surface, not a claim that every item below is
already implemented. `MASTER.md` §43 is authoritative about current status.

- **Website + CMS** — pages, blog, portfolio, SEO-as-architecture (schema.org,
  sitemaps, OG images) baked in
- **Unified CRM spine** — contacts, organizations, canonical tags, typed custom
  fields, relationships, lifecycle history, explainable duplicate review with
  conflict-safe merge undo, consent/privacy-rights workflows, and one shared
  timeline that every module writes to
- **Commerce** — products, digital downloads, services, coupons, gift cards;
  Stripe by default, PayPal as an option
- **Quotes → contracts → invoices** — negotiate line items with logged-in
  prospects, e-sign, deposits, payment plans
- **Booking & scheduling** — availability, buffers, deposits, reschedule
  policies, 2-way Google/Outlook calendar sync
- **Client galleries** — password/PIN galleries, proofing and selects,
  download tiers, watermarks, print sales
- **Client portal** — one login for a customer's quotes, invoices, bookings,
  galleries, files, and messages
- **International customer surfaces** — the default locale stays unprefixed,
  other locales use stable path prefixes, and a signed-in customer's Contact
  preference drives portal chrome, transactional templates, notification
  wrappers, digests, dates, and internal links. Header/footer variants remain
  editable CMS data rather than hardcoded layout markup. English, French and
  Spanish catalogs are exhaustively ICU-checked; an internal expanded
  pseudo-locale and script-derived document direction keep layouts ready for
  longer translations and RTL catalogs.
- **Email** — transactional via the owner's Google/Outlook account, bulk via
  a provider adapter; broadcasts and simple automations
- **Notification inbox** — a personal in-app attention queue with immediate
  email or scheduled digests, preference controls, replay-safe deduplication,
  and one-time escalation for unread critical work. SMS and push remain
  explicit disabled adapters until their carrier/compliance checkpoints.
- **First-party analytics** — configurable privacy-first, explicit-opt-in or
  disabled collection; bounded retention, reversible traffic-quality review,
  Core Web Vitals, campaign attribution and anonymized aggregate export, plus
  the full funnel (visit → lead → quote → paid) joined to the CRM
- **Full admin** — CRUD everything, toggle modules, seed/demo mode
- **Operational control** — retained background-work history, sanitized run
  detail, dead-letter recovery, lease-overdue warnings, and audited controls
- **MCP server** — the whole site is operable by the owner's AI assistant,
  out of the box
- **Auth** — email + password, TOTP, passkeys/security keys, recovery codes,
  mandatory 2FA for privileged roles, and fresh verification for critical
  work; personal session/device controls and privacy-limited suspicious-login
  notices are included. Customers use 15-minute one-use magic links that prove
  and link the existing Contact instead of creating a second identity

Deployment targets one-click simplicity on vibe-coding platforms, starting
with Replit: single-tenant by design (one deploy = one business), a monolith
of toggleable modules, Postgres, S3-compatible media storage.

## Licensing

Freeholder-authored code and packages are licensed under **Apache-2.0**. See
[`LICENSING.md`](LICENSING.md) for the plain-English policy and [`LICENSE`](LICENSE)
for the authoritative terms. Bundled third-party assets retain their own
license notices.

## Ownership and authorship

Freeholder was created, originally authored, and is owned and maintained by
**Tony Aly** ([tonyaly.com](https://tonyaly.com),
`tony@paradisemodern.com`), who makes it available to the world as open-source
software. The repository is hosted under the `CampDenman` GitHub organization;
that is where the code lives, not a separate author or rights holder.

Contributions are welcome under the DCO — see
[`CONTRIBUTING.md`](CONTRIBUTING.md). The DCO rather than a CLA is deliberate:
contributors keep their own copyright and contribute under Apache-2.0 without
assigning it to the project.

## Repository layout

```
app/            Next.js App Router — public site, portal, admin, API (Apache-2.0)
src/            core spine, feature modules, adapters, MCP server (Apache-2.0)
packages/       separately published Apache-2.0 packages (@freeholder/sdk, …)
MASTER.md       sole product specification, status, and completion plan
```

The core application lives at the repository root — one monolith, not a
monorepo. `packages/` exists only for artifacts people install outside this
repo. The full layout is specified in `MASTER.md` §10.
