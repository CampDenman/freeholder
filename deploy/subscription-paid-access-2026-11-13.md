<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Subscription upgrade paid-access repair

MASTER §43 C9.33/C11.10. An owner-requested manual upgrade previously switched
the plan and granted its access immediately despite issuing an unpaid
proration invoice. Customer changes already requested the payment guard; the
owner path used the unsafe default. Positive non-provider changes now preserve
the original plan until the exact issued invoice is paid in full. Partial
payment keeps the promise pending. Completion additionally checks the original
subscription source, contact, currency, exact total and zero refunded money.
The owner receives a translated pending-payment notice and invoice link.

Unused-price calculations use BigInt with separately rounded old/new portions,
retaining the existing minor-unit policy and original calendar. This is a
bounded repair of the existing net-difference path. Full commercial gross
credit/debit proration and provider collection remain separate open work.

## Actual before and after

Protected-main product source `41546d80c364bffb8fdbc9f383e54a2bc629806e`
plus only the native fixture (`72e569483195d1aa3543ed06817f16da94caf4e6`)
genuinely failed: the Upgraded plan and active grant existed while its4500
invoice was issued with paid0. Only the original1000 period payment existed.
The failing database remains preserved; it was neither reset nor migrated.
A prior invalid fixture SKU was classified separately before the financial
target, then corrected only by lowercasing the fixture identifier.

On repair source `f1a3a1dc008433294dd1afd520266b6db295c74d`, the unchanged
financial oracle passes against a fresh ordinary0–79 database (8.742 seconds
for the runner). It proves original access through unpaid and partial payment,
full-payment switch, unchanged calendar/original invoice and retry idempotency.
Independent read-only inspection verifies exactly two paid invoices1000/4500,
three actual payments1000/1/4499, an active upgraded grant, every published
migration timestamp/hash, UTC, fsync on, jit off, no recovery and no clients
left connected. All eight retained BEFORE table counts and full PostgreSQL
row digests remain identical after the AFTER run.

Seven directly affected existing plan-change controls then pass (37.096 seconds
for the runner): no-proration deferral, owner partial/full payment, customer
seller/plan restrictions and paid upgrade, voided pending invoice, retired
default variant, changed-price renewal, and customer ownership refusal. The
other51 cases were explicitly filtered, not reported as passing. The database
was reused only after preserving the first passing dataset's independent proof;
all clients drained again.

## Source qualification and limits

The same repair source passes full TypeScript (47.637 seconds), whole-project
ESLint (98.407 seconds),47 nonempty source-test files with398 actual assertions
and84 explicit database skips, license headers, changeset/changelog and plan
checks. All operations were bounded and stopped on first failure. No dependency
installation was needed; exact existing dependency descriptors were checked.

Local evidence is preserved at:

- `/tmp/freeholder-proration-after79-v1-source-result-20261113.json`
- `/tmp/freeholder-proration-after79-v1-source-tests-20261113.json`
- `/tmp/freeholder-proration-owner-before79-v2-classification.json`
- `/tmp/freeholder-proration-owner-after79-v3-native.json`
- `/tmp/freeholder-proration-owner-after79-v3-ledger.json`
- `/tmp/freeholder-proration-related-after79-v3-native.json`
- `/tmp/freeholder-proration-related-after79-v3-drain.json`

No schema, SQL, version or deployment changes. Protected PR/CI still governs
integration. No actual provider-account, owner browser or final stable-release
acceptance, independent C11.10 report or C11.17 signature is supplied here.
