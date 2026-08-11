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
> connection model are implemented. The complete scope, verified baseline and
> remaining checklist live only in [`MASTER.md` §43](MASTER.md#43-product-completion-plan--the-live-checklist).

## Product-complete target

This is the intended finished surface, not a claim that every item below is
already implemented. `MASTER.md` §43 is authoritative about current status.

- **Website + CMS** — pages, blog, portfolio, SEO-as-architecture (schema.org,
  sitemaps, OG images) baked in
- **Unified CRM spine** — contacts, companies, timelines; every module writes
  to it
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
- **Email** — transactional via the owner's Google/Outlook account, bulk via
  a provider adapter; broadcasts and simple automations
- **First-party analytics** — privacy-first pageviews plus the full funnel
  (visit → lead → quote → paid), joined to the CRM
- **Full admin** — CRUD everything, toggle modules, seed/demo mode
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

Freeholder core is **AGPL-3.0-only**; the SDKs and templates under
`packages/` are **MIT**. Plain-English map in [`LICENSING.md`](LICENSING.md).
External apps talking to a Freeholder site via SDK/API/MCP can be licensed
however you like.

## Ownership and authorship

Freeholder was created, originally authored, and is owned and maintained by
**Tony Aly** ([tonyaly.com](https://tonyaly.com),
`tony@paradisemodern.com`), who makes it available to the world as open-source
software. The repository is hosted under the `CampDenman` GitHub organization;
that is where the code lives, not a separate author or rights holder.

Contributions are welcome under the DCO — see
[`CONTRIBUTING.md`](CONTRIBUTING.md). The DCO rather than a CLA is deliberate:
contributors keep their own copyright, which means the project cannot be
relicensed out from under the people who built it.

## Repository layout

```
app/            Next.js App Router — public site, portal, admin, API (AGPL-3.0-only)
src/            core spine, feature modules, adapters, MCP server (AGPL-3.0-only)
packages/       separately published MIT packages (@freeholder/sdk, …)
MASTER.md       sole product specification, status, and completion plan
```

The core application lives at the repository root — one monolith, not a
monorepo. `packages/` exists only for artifacts people install outside this
repo. The full layout is specified in `MASTER.md` §10.
