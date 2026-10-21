# Real-browser product journeys

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder runs its primary owner journey against the production build in
Chromium. The service tests remain the detailed source of truth for validation
and permission matrices; this gate proves that the browser, Server Actions,
redirects, cookies, rendered pages and external protocols still join up.

## What the journey proves

`tests/browser/journeys.spec.ts` starts with an empty migrated database and
walks one continuous instance through:

- first-boot owner, business and location setup, including the permanent
  wizard lock and the narrow pre-2FA setup authorization boundary;
- authenticator enrollment, one-time recovery-code display, wrong-password
  feedback, password/TOTP login and session establishment;
- form creation, page creation, schema-derived block editing, autosave and
  deliberate publication;
- the public form's signed timestamp, submission confirmation, submission
  inbox and canonical Contact resolution;
- direct Contact creation and its shared detail record;
- human-reviewed `fr-CA` translation and localized public rendering;
- least-privilege API-key creation, one-time token reveal, MCP tool discovery
  and a scoped `contacts.list` JSON-RPC call; and
- forgotten-password request, one-time reset, all-session revocation, refusal
  of the old password and restoration with the new password plus a recovery
  code.

Production never reveals a reset token. The test follows the public forgot
form, then replaces only the resulting disposable database row's token hash
with the SHA-256 hash of a known test token before opening `/reset`. This is a
fixture seam, not an application endpoint or authentication bypass. Every
other credential is created and consumed through the rendered product.

## C11 cross-module journeys

`pnpm test:journeys` also runs `tests/browser/c11-*.spec.ts`. Those proofs
start from a seeded owner (first-boot remains C1.22) and walk the visitor-
facing seams C11.01 and C11.04 name: a cookieless localized enquiry/chat,
HTTP `quotes.setConversion`, quote accept, contract sign, C5.25 customer
invoice pay with `paidMinor`, contact timeline copy, `/admin/reports` after
pay, and the app-free `/capture/[token]` ingest page.

The rest of C11.01–C11.08 is mixed vitest composition in
`tests/core/c11-0*.test.ts`: catalog tax/stock/restock checkout, availability
query plus deposit/signed waiver/due reminder, interrupted capture then
gallery/social, subscription change/cancel with `hasAccess` after expiry,
agent approval plus builder prompt/apply/rollback and code gates, mocked
mail/calendar playbooks, and demo/import-ledger/update rollback. Hosted
Stripe/PayPal charges, live OAuth, live multi-network publish, and
WordPress-to-CMS page materialization are not claimed — adapter doubles and
the import ledger are named in MASTER.md §43.16. C11.08 stays open.

## Run it locally

Set `TEST_DATABASE_URL` or `BROWSER_DATABASE_URL` to a throwaway PostgreSQL
database whose name contains `test` or `a11y`. The configuration refuses any
other database name before connecting or truncating.

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:journeys
```

Run the complete serial browser gate with `pnpm test:browser`. The two suites
share `tests/browser/database.ts`; each resets the database on entry and again
on exit, then leaves only the default roles. This matters in CI because image,
SEO and upgrade checks use the same disposable PostgreSQL service afterward.

Screenshots, videos and traces from failures are under `test-results/browser`.
CI's HTML report is under `playwright-report/browser`. Neither is committed.

`BROWSER_BASE_URL` overrides the default `http://localhost:3100` only when the
replacement URL reaches the same local test process and disposable database.
