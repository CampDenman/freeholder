<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Exact raw-feedback privacy owner source checkpoint

## Combined qualification follow-up, 2026-11-13

The first combined native attempt at c96cd325 stopped before the ownership
assertions: its helper used the current webhook retention path, which correctly
found the original payment and committed one managed observation/capture rather
than a legacy receipt. The failed V5 database is preserved with one payment,
zero logical refunds, zero cash recovery owners and zero legacy receipts; the
independent read-only proof records all 82 migration identities and drained
clients. This is an entry-path mismatch in the prepared test.

The first test now uses the existing exact-byte HMAC verifier and the real
system-only legacy retention service, as the other raw-owner controls already
do. Every original fingerprint, export, authentication, money, ownership and
no-provider-POST assertion remains. It tests repair of a retained historical raw
receipt; it does not claim the current webhook selects legacy retention. The
corrected body remains unrun until its new database qualification.

Separately, combined c96cd325 passes full types, affected model lint and metadata
renewal. Read-only schema parity passes all 86 models and all 82 migration
identities, including source-backed unnamed CHECK groupings and the explicitly
deferred first-operation FK. Actual SDK drift checks pass 8/8 with independent
proof that the previously qualified financial dataset was unchanged. These
component checks do not supply callback behavior or stable acceptance.

This bounded SOURCE ONLY increment follows qualified cacb80bd and its
7164e9d6 evidence documentation. It addresses MASTER §43 C1.08/C12.38. All new
controls are PREPARED/UNRUN. No compiler, lint, test, build, install, database,
native, model/journal assembly, server or provider request ran for this slice.
Earlier qualified source and failed logs remain unchanged. No checklist item,
model activation, financial acceptance or stable sign-off is supplied.

The existing `legacy_bank_feedback` repair branch could resolve only an
authentic old refund admission. An actual signed unassigned dashboard refund
on retained unapplied payment cash or a NULL-payment subscription receipt
therefore kept its outbox repair permanently pending. The new private
`originalBankFeedbackOwner(tx, rawFeedback)` returns a discriminated actual
payment-or-subscription-receipt identity, original namespace and a lineage
digest. It creates no local payment, refund, legacy admission, caller birth,
finish, guessed account, protocol or historical state.

Raw feedback HMAC/digest/retained occurrence verification precedes ownership.
The old namespace path still uses unchanged
`originalLegacyBankAdmissionNamespace`: an authentic admission owns its exact
original payment/PI/account without proving creator completion or inventing
its unknown creator platform. Related original legacy event families are
fully selected and bounded; a retained admission/physical marker that cannot
authenticate refuses modern fallback. A corrupt old namespace is never
silently repaired by choosing a newer equal payment.

Modern ownership derives only from actual retained positive payment
observations or original subscription charge receipts in the authenticated
observed account/platform namespace. An actual original refund-resource
binding can also explain feedback whose observed PI is contradictory: its
real dispatch, immutable original request digest and exact original source
are required. Authenticated raw cash-read facts can supply another actual
resource alias, after both owner and fact HMAC verification. The original
positive source must still exist. Amount equality, contact, email, current
provider configuration and present-day merchant accounts are never owner
selectors. Contradictory raw money is retained unchanged; identifying its
privacy owner does not settle it or weaken cash/refund guards.

A real `merchant_agreement_payment_routes.original_charge_receipt_id` may
combine a receipt with its actual local payment only after the frozen
subscription/PI/invoice/platform/account/protocol tuple matches the receipt.
Without that real FK, equal namespace or money does not combine independent
local owners. Absent, multiple owner, multiple original PI/account, multiple
known platform or conflicting alias identity remains repair debt. Legacy
unknown creator platform stays unknown; an actual retained positive platform
does not rewrite its historical admission.

The existing repair query then proves the frozen merchant source before
using a profile: order allocation collections, booking scope, agreement route
and subscription scope, or the actual receipt and its subscription scope.
The selected original cash account must equal that frozen source's account;
every known actual source platform must match the original frozen platform.
The actual callback platform assertion is checked separately from a legacy
unknown creator platform; it never fills that historical field. For example,
a real positive observation on `acct_Foreign` tied to a local
payment UUID cannot borrow the local `acct_Original` route's profile merely
because the payment or amount coincides. A direct account cannot become a
NULL platform account. A mismatched receipt/agreement scope also refuses
repair. The raw financial row/outbox remain committed when this identity
cannot be proved. No current account, profile-by-email or first matching route
fills the gap. The original exact-one-profile check remains in force.

Every selected source family and original event family is complete within
the aggregate5000 row bound. The pure owner selector also refuses oversized
candidate/alias sets. No sampled or truncated result establishes identity.
The lineage digest includes exact source generations, original receipt FK
aliases, retained resource-binding request/dispatch identities and authenticated
cash owner/fact digests. It joins the existing semantic repair evidence digest
without exposing raw call capabilities. The same private repair service,
permission, outbox event, source key and AFTER-COMMIT listener remain; no public
API/MCP service, UI action or new human authorization surface is added.

Exactly two product files change: the new
`src/modules/invoicing/original-cash-feedback-owner.ts` helper and the raw
feedback branch/frozen-route checks in
`src/modules/invoicing/merchant-refund-privacy-repair.ts`. Root's three central
financial witness/export files remain untouched. No schema or SQL tail changes.

Prepared controls comprise **10 pure and three native cases**, all UNRUN.
Pure controls cover actual payment/NULL-payment receipt distinction, real
receipt aliases, equal-namespace independent owners, conflicting PI/account/
platform, legacy unknown platform, absent/conflicting identities, complete
bounds, wrong frozen merchant source and immutable lineage generations.
Native bodies use real checkout/capture/RMA services and exact signed raw
feedback. They prepare unassigned unapplied payment ownership before any
cash owner/GET with the outbox retained, bad-HMAC refusal without row mutation,
contradictory PI tied through an actual request resource, and a real scheduled
paid receipt whose later canonical quantity rejection leaves no payment or
invoice before receipt-only feedback repair. They assert unchanged bank
feedback, principal/refunds and receipt identities. Only provider responses
are synthetic; no financial or caller history rows are inserted by hand.

The native NULL-payment control reuses the existing real producer helper
`tests/helpers/merchant-subscription80.ts`, copied byte-for-byte from combined
b8e7394a solely to keep the isolated leaf self-contained. SHA-256:
`75dd7595d1c4abd42183baf7aeb6706f5abd84bc14584dcb30c13e5d66ed6f0e`.
Root should preserve its existing newer helper if it differs on integration;
no old fixture assertions or producer history were modified.

Combined source gates, actual cash/NULL-payment/legacy-corruption/foreign-scope
and ambiguous-source native acceptance, independent ledgers/outbox drain,
complete erasure artifact repair, populated upgrades/rollback and independent
review remain required. Source presence alone does not qualify any of these.
