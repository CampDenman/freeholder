<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original full-cash return source checkpoint

MASTER §43 C12.38/C1.08/C5.19. SOURCE ONLY, UNQUALIFIED. No compiler, lint,
build, dependency installation, native test, migration, database or provider
request ran for this increment. All controls described below are prepared and
UNRUN. `git diff --check` is source whitespace review only. No feature/checklist
closure, model activation, provider acceptance or stable sign-off is supplied.

This is a finite full-original-cash checkpoint. It does not complete all
destination refund behavior. Exact cumulative **partial** recipient and fee
targets remain required source work after this freeze. They must derive from
immutable original principal, actual returned parts and their original route,
plus actual refund/reversal allocations. Equal amounts, current catalog owners,
FX assumptions and a generic full-return waiver cannot choose a partial owner.
Partial recipient debt continues to be reported truthfully until that work is
implemented; it is not deferred from the full specification.

## Original source and physical authority

`original_cash_recoveries` freezes the actual original payment-observation or
subscription receipt/observation tuple. A subscription source has NULL payment
ownership; no canonical payment or logical refund is invented for its cash.
The actual original platform, charge account, API version, PI, charge/fee
references and recipient remain separate. Another source observation or owner
cannot silently replace the first source even if the PI or amount is equal.

`original_cash_recovery_operations` admits each actual inventory/recovery GET
separately from one fee-refund or recipient-reversal POST. Its original body,
resource parent, amount, currency, process birth, capability hash and admission
are immutable and purpose-HMAC authenticated. A unique original owner/kind
permits only one physical auxiliary creation. Unknown transport, missing GET,
provider key pruning and time do not authorize another POST. Previously admitted
operations use original-parent GET recovery, including bounded exact-metadata
lookup when the creating response was unreadable.

`original_cash_recovery_facts` commits actual server-held callback occurrences
before later policy. IDs are retained before money parsing; contradictory money
is retained before refusal. A monotonic original-owner sequence preserves actual
callback order without relying on millisecond timestamps or random UUID order.
Every fact has its own purpose-HMAC and retained occurrence/time. Actual wrapper
finishes and fresh human hosting-stop reviews are different facts. No synthetic
ServiceContext, old creator finish, negative lookup or guessed process birth is
accepted. Failed persistence can flush the actual held packets and finish
without repeating external I/O.

An older fee journal lacks original physical process identity. Its actual row
can receive a new explicit hosting review, authenticated against the exact
retained operation digest. The historical caller remains NULL/unknown. This is
a current human review, not a backfilled old admission/finish or bank outcome.
Changing that original fee row invalidates the review. A fresh complete bank
inventory and all other actual caller proof remain necessary.

`original_cash_recovery_closures` retains complete original principal, customer
refund, fee, recipient, dispute and caller proof. Already applied money keeps
its actual invoice/payment/refund/credit lifecycle. Unapplied money additionally
requires the existing canonical `merchant_unapplied_charge_resolutions` receipt,
whose separate real inventory caller and actual finish are revalidated. An
unapplied alternate PI cannot clear a canonical payment's destination debt.
Full-return commission/recipient debt clears only against an unchanged exact
full-return receipt; later financial facts make the prior receipt stale.

The optional Stripe edge operates on the original platform for application-fee
refunds and destination transfer reversals. It proves parent account, charge,
original amount and actual currency before dispatch and never combines an
automatic proportional fee refund with recipient reversal. Documentation reads
used the official [reversal creation](https://docs.stripe.com/api/transfer_reversals/create)
and [retrieval](https://docs.stripe.com/api/transfer_reversals/retrieve) contracts.
These were documentation reads, not provider-account requests or acceptance.

## Shared owner flow and privacy

The same scoped shared services back `/admin/invoices/cash-recovery`, generated
HTTP/OpenAPI/MCP and the eventual SDK. Original-cash return and hosting reviews
require fresh verification, a signed-in human, no API key and exact confirmation.
GET-only inspection grants no new refund, fee or recipient POST. Four locale
catalogs supply return/recovery/unknown/live-process/legacy-hosting guidance.
The list derives candidates from retained positive financial observations;
caller fields are available only to authorized financial staff. Customer
metadata and credentials are not copied into the new journals.

Every primary operation/fact/closure commits an original-source privacy repair
pointer in the existing transactional outbox before profile lookup, artifact
repair or later policy. The original source selects the merchant profile; a
missing or corrupt profile/artifact retains repair debt after primary facts
commit. Search excludes all four private models; financial retention excludes
TTL deletion. No contact FK or new private customer spine is introduced.

## Root-owned financial integration contract

The root owns `merchant-refund-dependencies.ts`,
`merchant-payment-dependencies.ts` and `merchant-tax-privacy.ts`. Those files are
unchanged here. Add this helper to their actual original owner selections:

`originalCashRecoveryFinancialWitness(tx, exactOriginalPaymentIds, exactOriginalSubscriptionReceiptIds)`

It returns four arrays: `{ owners, operations, facts, closures }`. Every returned
row is authenticated, sorted deterministically and scoped through the actual
payment/receipt FK. Input aggregate and returned aggregate bounds are each
5,000; truncation, missing authentic evidence or corrupt HMAC fails closed.
Include all four arrays and their counts in original seller/buyer financial
fingerprints, merge undo, financial export and total aggregate bounds. An owner
row alone is already a witness before its first GET. Do not select by current
account, email or amount, or omit receipt-only owners whose payment FK is NULL.
The shared cash-history helper already composes original-owner operations/facts
for current return freshness and caller quiescence; closures are excluded from
that intrinsic revision to avoid a self-invalidating proof cycle.

## Prepared controls and remaining work

Prepared, UNRUN: **19 pure, 7 actual adapter-factory transport, 13 shared-contract
and 4 native cases**. Pure/contract controls cover exact namespaces, receipt-only
ownership, original key rotation, occurrence/purpose substitution, changed raw
money, exact safe-cent capacity, ambiguous ACKs, human permissions and private
phase boundaries. Adapter controls cover original-platform/version bodies,
ACK-before-policy, actual contradictory money and unreadable accepted fee/
reversal responses recovered by GET without another POST.

The native bodies use actual checkout/payment/refund/shared recovery services
and the actual auxiliary/cash-inventory Stripe factory with intercepted HTTP.
They prepare full destination return with existing credits/refunds unchanged,
a genuinely positive capture rejected by later invoice-currency policy and
returned without a settled payment/logical refund/credit, unreadable fee
recovery and a paused real recipient caller refusing a second POST. Synthetic
payment edges are explicit. These are not tests of actual provider accounts,
and the raw subscription NULL-payment variant still needs its own integrated
native acceptance after the carrier source joins. All native bodies have
60-second deadlines and release/join their actual paused callers.

Unassigned dashboard partial returns and new generations remain conservative:
the existing common capacity refuses unassigned/contradictory money and no
amount-only association is introduced. Exact partial-return/remainder and
recipient/fee target composition is the next required finite source slice.
Original refund hosting recovery continues through its existing shared
request/dispatch review services; the new hosting controls cover new auxiliary
and inspection callers plus explicit old-fee hosting review.

The owned UNAPPLIED suffix is `deploy/original-cash-return81.fragment.sql`, SHA-256
`ab894bec2daba2b060012f5c59c9108f8acd8e6e4450b7525771a7f0ae301a74`.
It defines exactly four models, immutable guarded insertion, exact caller/owner
relations, single auxiliary creation and an old payment-only fee-dispatch fence.
It is unassembled and unapplied. The RMA suffix stays
`5c2a285cc619a2fcd7a4314e98ac62a08f7a842e1740a245cfaf6e5ed1d07a11`,
recovery stays `d4ae54e3b8b9f93b28b98a6e5f42d9f98835353f221f3290afbd8613a9f9a3f0`,
current-proof stays `73a89f9dcc9b79bca72b713f53db81949c27cdd805f0fc05714cae6ea2203678`.
No prior SQL, database, golden, failure or stopped-child fixture was changed.

After root integration: full source gates, combined SQL/parity, new databases,
actual callback/host-stop/partial/corruption/late-feedback natives, exact
receipt-only subscription acceptance, populated upgrades, SDK/browser journeys,
actual provider acceptance and independent review remain required. Source
presence alone supplies none of these qualifications.
