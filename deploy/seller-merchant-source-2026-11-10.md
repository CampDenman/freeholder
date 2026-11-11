<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C12.38 collection-policy and account-boundary source work

This records partial implementation evidence. `MASTER.md` §43 is the status
authority. C12.38 stays open and the owner-facing payout registry still refuses
`seller_merchant`. No production deployment or live provider acceptance is
claimed by these changes.

Issued member invoices retain a private collection-policy snapshot. Member
subscription agreements capture their terms before the first invoice or trial
access; renewal invoices use that agreement instead of current site defaults.
The agreement cannot change to a different seller's plan. Platform collection
continues to support the existing held/instant payout paths.

Stripe transfer readiness alone cannot authorize a direct charge. A seller
merchant policy requires an active seller, charge capability, a connected
account and a public merchant name. Before new collection, the original
account and its authorization are checked again. Changing that account does
not move an old invoice or agreement to its replacement.

Payment attempts reserve account and fee in a private table, under the normal
invoice lock. Application fees use exact integer arithmetic, including
cumulative allocation across installments. Buyer inputs cannot select the
account or fee. Ordinary payment/subscription rows contain no routing columns;
internal orchestration uses private envelopes. Saved customers and methods
are indexed by provider **and account**. Captures, refunds, off-session charges,
recurring creation/update/cancellation and method revocation use their original
account. Refund requests ask to return an application fee only when the
original payment charged one.

Authenticated payment feedback must match the reserved account and actual
application fee before settlement. Checkout completion alone is not proof of
the fee on a connected PaymentIntent. Refunds and disputes must identify the
parent payment on the same account. Connected-account bank payouts do not
become platform deposits. A pending stored-card response remains processing;
a transport exception leaves the original attempt available for same-key
recovery. Neither is recorded as a provider decline.

Migration 67 preserves existing platform-collected invoices, agreements,
accepted payments and saved methods. It does not invent seller routes,
merchant branding or charge readiness for historical transfer accounts.

## Qualification

The focused native suites are `tests/modules/member-merchant-policy.test.ts`,
`tests/modules/member-payouts.test.ts`,
`tests/modules/member-subscriptions.test.ts`,
`tests/modules/subscriptions.test.ts`,
`tests/modules/subscription-billing.test.ts`,
`tests/core/payment-provider-service.test.ts`,
`tests/core/payment-adapters.test.ts` and
`tests/adapters/payout-providers.test.ts`. Internal-service inventory and audit
label checks keep private phases out of public discovery. The live SDK
generation, production build, fast gates and a real 66→67 upgrade rehearsal
must also pass on the final tree.

The focused PostgreSQL run passed 54 cases across merchant agreements,
subscription billing and payment-provider services. These include a trial
without an invoice, changed defaults/accounts, platform-card refusal on a
connected agreement, cross-seller plan-change refusal, pending payment,
response-loss/same-key recovery, wrong-account success refusal and the
existing provider ledger paths. Nineteen final Stripe edge tests, eight payout
edge tests and 17 discovery/audit/contract checks passed. The live SDK
generation passed all eight checks.

The final production build and standalone scrub passed: 18,586 files,
224,712,470 bytes, with no source or environment leakage. Local fast gates
passed typechecking, lint, licensing, release notes, plan consistency and
the contract suites. The plan still reports 31 live open C-items; this partial
repair closes no launch acceptance item. The evidence matrix resolves all
369 rows × 12 criteria.

The separate real 66→67 upgrade rehearsal preserved an accepted processing
payment and its reference/amount, legacy platform customers/cards, both an
active member agreement and a trial with no invoice. Historical Stripe
transfer accounts retained their ID but gained neither charge readiness nor
an invented merchant name. Existing invoices remained platform-collected;
zero seller payment routes were invented. Account-scoped uniqueness admitted
the same provider customer/method references on a different account without
changing the original rows. The temporary database was removed. Migration 67
SHA-256: `678a794801bbb9ea7e0b41dc1d3d17a05dfdf1530722f4001308f815e158c250`.

## Remaining full integration

The source foundation does not yet enable account-scoped trial-card setup
and card selection across all buyer surfaces, authenticated Connect financial
webhook forwarding, complete direct recurring-payment reconciliation with
actual PaymentIntent fee proof, direct-charge payout-ledger reconciliation,
seller branding/support on invoices and receipts, or the complete localized
owner/buyer browser journeys. Checkout retry inputs also need explicit recovery
qualification when customer mappings change between attempts. Each remains
part of C12.38; none is newly deferred.

Actual enabled provider settlement remains C11.05/C12.26, independent review
remains C11.10, recovery acceptance remains C11.08, and the final exact-candidate
signature remains C11.17. Mock transports and disposable database results do
not supply those sign-offs.
