<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Customer surfaces — 2026-10-07

This change implements the five gaps identified in the public-site audit.
It does not declare Freeholder stable. MASTER.md §43 remains the acceptance authority.

| Surface | Customer entry | Owner controls | Shared service boundary |
| --- | --- | --- | --- |
| Blog | /blog | /admin/blog, then the existing visual page editor | cms.listBlogPosts, CMS create/update/publish |
| Booking | /book and /embed/booking | Catalog service offerings, price rules, calendars, booking audiences | catalog.publicBookingQuote, catalog.bookService, catalog.moveMyBooking |
| Newsletters | /newsletters | /admin/newsletters; /admin/settings#mail | broadcasts.start/sendNext/tick, mail.readiness, mail outbox and signed delivery feedback |
| Memberships | /memberships | /admin/subscriptions, catalogue prices and payment provider | subscriptions.publicPlans/join/mine, canonical invoice checkout, invoice.paid activation |
| Client portal | /portal | Existing owner records and document shares | portal.myRecord/actOnMyRecord, documents.myDownload |

## Configuration and promises

Customer sign-in requires a delivering transactional mail route. Newsletter
campaigns require a verified active default bulk sender, provider credentials
and authenticated delivery feedback. The readiness check uses the same route
selection as sending, including connected mailboxes. Failure leaves drafts and
recipient ledgers intact. SMTP/HTTP test doubles prove software behavior; they
do not prove external delivery or inbox placement.

Public booking requires an active public service, priced default variant,
allowed full/deposit payment rule, calendar availability and a matching booking
audience. Reservation resolves the signed-in contact; callers cannot supply
another contact, duration, resource set or invoice amount. Current prices and
terms are hashed and rechecked. Calendar locks serialize primary and resource
claims; a retry key is scoped to the customer and accepted promise. Deposits use
the shared payment plan, invoice and ledger. Requested bookings still follow
the owner's existing confirmation, intake and waiver rules. Cancellation
records the policy outcome; refunds remain an owner money operation.

Membership signup requires an active public priced product and plan. Paid
signups are paused with paused grants until their first invoice is fully paid.
Retries reuse the signup. A cancelled pending signup cannot activate, and its
invoice no longer offers customer checkout. Recurring payment-method consent
is explicit; only consented provider evidence is stored. A durable sweep recovers
activation and future provider schedules. New customers starting a trial that
requires a saved card still need the business to arrange that method; this is
shown as unavailable rather than granting an unverified trial. Live recurring
settlement remains C11.05.

Private client document versions mark their assets private, including existing
versions in the additive migration. That flag survives archiving, revocation,
and disabling the documents module. Generic media routes cannot bypass share
expiry, revocation, login or download limits. Unrelated public asset downloads
retain their existing behavior. Portal lists and record responses contain no
quote, booking or document bearer credentials, provider references or staff notes.

## Verification

Automated evidence is in tests/modules/customer-surfaces.test.ts,
tests/browser/customer-surfaces.spec.ts, tests/modules/broadcasts.test.ts,
tests/core/newsletters.test.ts, tests/core/payment-adapters.test.ts and the
existing membership/document/portal suites. Browser fixtures are disposable
customer sessions; they are not claims of delivered mail or real card settlement.

Local verification on 2026-10-07 used disposable PostgreSQL 16 databases, clean
migrations through 0022, and the production standalone build:

- Both browser journeys passed; Axe passed in light and dark themes. The owner
  created and published a blog post. A verified customer booked, rescheduled and
  cancelled an appointment, joined a membership, saw pending-payment access and
  cancelled. An anonymous customer API request was refused.
- All ten customer-surface service tests and eight SDK tests passed. These cover
  published-versus-draft privacy, reviewed translations, stale booking terms,
  slot contention, retry identity, deposit billing, ownership, quote acceptance,
  private document access and one-use email proof.
- Both newsletter archive/consent/merge cases and all twenty broadcast cases
  passed. All eleven subscription-billing cases
  passed across the regression runs, including verified first-payment consent,
  exact saved-method binding, refusal of an unrelated card and compensation when
  cancellation races provider schedule creation.
- Production build, TypeScript, ESLint, licensing, plan consistency, service
  composition, registry inventory and F-matrix checks passed. The dependency
  audit is clean after updating Next.js, Sharp and shell-quote to patched versions.

The database tests stage mail and use payment-provider test doubles. The first
temporary database run exceeded its container memory limit; the container was
adjusted and affected cases rerun. No production database was used for fixtures.
Required GitHub CI, merge and hosted deployment are recorded separately in the PR.

Production and playground mail/payment provider acceptance, independent security
review, and the deferred trial setup above remain explicit open work. Do not
check those acceptance items from mocked or ledger-only runs.
