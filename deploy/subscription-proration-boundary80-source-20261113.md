<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Actual proration principal boundary — 2026-11-13

C9.33/C9.38/C12.38/C1.08. Finite SOURCE ONLY continuation of `2a943a01`.
No compiler, lint, tests, DB, migration, native, build, install or provider
operation was run. This source is unqualified and closes no feature, provider
acceptance or stable gate. MASTER §43 remains the only status authority.

## Concrete gap and source repair

Generic saved-method recovery may supply PaymentIntent creation time as
`occurredAt`; authorized offline recording accepts a supplied `processedAt`.
Neither proves that an exact new target was fully funded before its accepted
effective instant. Existing `createdAt`/`observedAt` defaults use PostgreSQL
`now()`, the transaction's start, so even those timestamps cannot supply the
strict retention-time boundary after a delayed transaction.

New immutable cash confirmations bind one exact original successful
customer/route-verified provider observation, or one actual external-payment
attestation, to the original accepted target. Noncash confirmations bind the
actual original application/reservation. SQL captures them as those real
source rows are inserted and forces `retainedAt=clock_timestamp()` in the
guard; callers cannot backdate it. Full-row PostgreSQL evidence hashes bind
the actual source receipts. An unproved route or ancillary-fee assertion is
not relabeled principal; route-proved cash can still retain separate fee debt.
Manual receipts remain attestations, never bank verification.

Canonical paid status and exact principal/route/caller/refund checks remain
required. A supplied `paidAt` before the boundary alone is insufficient:
every successful actual target payment and exact applied credit must have
its own matching confirmation retained by that instant. Paid effect and
commission eligibility use this additional proof. A late legitimate external
record keeps its actual payment, paid invoice and whole original credit
promise but cannot reactivate expired consent. Its target enters fresh-review
debt with old plan/access retained. New buyer/owner quote notice explains the
boundary in EN/FR/ES/AR before consent.

A deferred real-clock acceptance guard rolls back entirely local new
documents/credit if the original acceptance transaction cannot commit before
the chosen instant. No external provider call occurs in that transaction.
Historical paid source invoices/terms are unchanged. New review also refuses
a target plan that silently changes the original billing backend; existing
DB authority already required the backend to match.

## Owned unapplied SQL, privacy and controls

`subscription-proration-boundary80.fragment.sql` is a new owned UNAPPLIED tail
after frozen fee tail
`818462a6f088a6a90ba31ab88cc077201a4e3903d6318602a181dd43e01f3bae`.
Its SHA256 is
`30dde7ff494d1d2ea81d1561e73c0ffba15721f215a3fd16bf13c73036002bb9`.
It is UNPARSED/UNEXECUTED; root owns assembly and a fresh DB. Earlier frozen
tails are untouched. Eight enabled source-capture/immutable/deadline/effect/
eligibility guards are required before new review or collection.

Two private/noTTL families have no new contact columns. Their ownership is
the actual invoice/payment/application and accepted subscription receipt.
Safe subject export includes exact receipt identities/actual retention times,
counting both families against the existing complete5000 agreement export.
`subscriptionProrationBoundaryWitnesses(tx, readonly invoiceIds)` adds
`cash`, `credit` and `incomplete`, with exact parent IDs, full-row PostgreSQL
SHA256 and combined5000 bound. Root's three central financial witness files
are untouched; root must compose these new children before qualification.

Two meaningful actual manual native controls are PREPARED/UNRUN. One records
real late external principal with an earlier supplied processedAt, proves
the invoice is paid but actual DB confirmation is late, then refuses new
access/eligibility while preserving payment, credit and old paid period. It
also refuses rewriting the actual confirmation. The other reaches the actual
shared acceptance/document/credit writer inside a real service transaction,
waits through the real boundary, then requires the deferred23514 rollback and
unchanged old financial/terms/calendar rows. It checks that acceptance really
ran, preventing an earlier unrelated error from satisfying the oracle. These
controls never hand-insert financial rows or fake PostgreSQL time. All prior
prepared controls remain unqualified in this lane.

## Required continuation

This is the necessary boundary foundation discovered while tracing actual
platform-card proration. Complete exact stored-method consent/mandate,
off-session claim/POST/apply, separately admitted original GET and stop/recovery
still require implementation and native/provider qualification. Generic renewal
charging can dunn/advance the original subscription and lacks the new target's
independent reader ownership; it is not reused as if it completed this scope.
Original paid access/calendar must survive declined, unknown or late changes.

Authenticated historical success-event timestamps require their own complete
original raw lineage if later used; object creation or arbitrary processedAt
will not substitute. Late actual money remains genuine recovery work, not a
fictional absence or automatic charge/refund. Authentic late/partial target
release/rebinding and independent provider preview/zero-bootstrap/controlled
draft fee/finalize/pay remain required under the full current specification.
No provider DTO or existing reader signing policy is weakened.
The existing plain original cash-principal composition also rereads its
exact-source authenticated witness after history/current-bank reads. Any
independently committed callback arriving between those reads forces review;
a later projection cannot silently discard that new raw occurrence.
