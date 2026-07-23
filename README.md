# Freeholder

**The open-source operating system for a one-person business.**

Stop renting your business. Creators and small businesses today duct-tape
together a website builder, a booking tool, a gallery host, a CRM, an
invoicing app, an email platform, and a social scheduler — each one a
subscription, each one owning a silo of the same customer. Freeholder
replaces the stack with one self-hosted platform where a contact is **one
record**: their bookings, orders, quotes, gallery access, messages, and email
history all hang off one CRM timeline.

> **Status: pre-alpha.** The repository is being scaffolded. The canonical
> product and architecture specification lives in [`MASTER.md`](MASTER.md);
> code lands next. Watch the repo or join Discussions to follow along.

## What's in the box (planned v1 surface)

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
- **Auth** — email + password with OTP verification for owners; magic links
  for customers

Deployment targets one-click simplicity on vibe-coding platforms, starting
with Replit: single-tenant by design (one deploy = one business), a monolith
of toggleable modules, Postgres, S3-compatible media storage.

## Licensing

Freeholder core is **AGPL-3.0-only**; the SDKs and templates under
`packages/` are **MIT**. Plain-English map in [`LICENSING.md`](LICENSING.md).
External apps talking to a Freeholder site via SDK/API/MCP can be licensed
however you like.

## Governance

Freeholder is stewarded by the **Camp Denman Society**, a not-for-profit,
which holds the project's copyright and is positioned to support the project
long-term. Contributions are welcome under the DCO — see
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Repository layout

```
apps/web        Freeholder core application (AGPL-3.0-only)
packages/sdk    @freeholder/sdk — client SDK (MIT)
MASTER.md       canonical product & architecture specification
```
