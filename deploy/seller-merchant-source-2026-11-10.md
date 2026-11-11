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

The next source increment wires account-scoped trial setup and card selection
on member offers and trial return, including an agreement's original provider
after defaults change. Private account/customer references do not enter the
card labels or public response. Pending trials require a card verified after
their recorded setup; an unrelated merchant's or platform card cannot start
them. Public offer terms bind the current collection policy in their opaque
terms hash.

The Connect webhook verifies its original bytes before forwarding normalized
financial events through system-only services in the existing transaction.
Recurring paid invoices need a unique paid InvoicePayment and its succeeded
PaymentIntent on the original account, with the actual customer, amount,
currency and application fee. Zero-value trial invoices do not buy a period.
The ledger checks canonical period dates and the pending plan's interval,
keeps the real charge reference for refunds, and refuses a second charge for
an already paid period. Verified money already collected is still recorded
after the seller is disabled; that does not authorize a new collection.

Direct-charge earnings reconcile as already paid, under the frozen seller
and fee policy. Refunds/disputes put those earnings into review or cancel
them after a full refund. They never become transfer candidates or accept
manual commands to send another payout. Order-line earnings and the separate
subscription/booking recorder cannot both pay the same order.

Source qualification for this increment: 81 PostgreSQL financial cases passed
across merchant agreements, existing held/instant payouts, subscription billing
and payment-provider services. Forty-one native provider/private-service/audit
checks and all eight live SDK checks passed. A production build and standalone
artifact scrub passed. Four actual Chromium journeys passed at 320px in English,
Spanish, French and Arabic RTL, with keyboard submission, both-theme Axe scans, original-account
card selection and other-person refusal. Provider setup in those journeys is
seeded; these are not real Stripe acceptance. A subsequent focused renewal
run also qualifies changing from a monthly to an annual plan at renewal,
including rollback of a paid event with the old interval. All 38 financial
renewal/billing cases passed; a duplicate private-service inventory entry from
the rebase was repaired and all 41 provider/private-service checks then passed.
Required fast gates passed 368 contract checks with one deliberate skip,
typechecking, lint, licensing, release notes and plan consistency. The evidence
matrix covers 369 rows × 12 criteria. The final standalone artifact scrub
checked 18,777 files and 226,573,806 bytes. This increment leaves migration 67
unchanged. GitHub reported zero open CodeQL and Dependabot alerts on 2026-11-10;
that is not independent review.

Still required: seller branding/support and commercial identity on invoices
and receipts; complete mixed-seller/site carts; exact recurring tax, fee and
rounding behavior; fresh setup evidence for reused cards; changed-customer
retry inputs; external/dashboard refund recovery; account-scoped erasure;
complete dispute recovery and all four-locale owner/buyer/provider journeys.
Each remains part of C12.38; none is newly deferred. The owner-facing registry
continues to refuse activation.

Actual enabled provider settlement remains C11.05/C12.26, independent review
remains C11.10, recovery acceptance remains C11.08, and the final exact-candidate
signature remains C11.17. Mock transports and disposable database results do
not supply those sign-offs.

## Card-setup provider evidence

Setup completions normally identify the SetupIntent by reference. After exact
raw-byte signature and account validation, the adapter retrieves it with its
payment method expanded on the same account. Its reference, succeeded status,
off-session usage, customer/method binding and original contact/subscription
metadata must agree. Incomplete provider evidence produces retryable refusal,
never an invented payment or a silently accepted card. Unrelated setup events
do not trigger provider reads. Returned normalized events contain masked method
evidence and exclude client secrets. These calls follow Stripe's
[SetupIntent retrieval](https://docs.stripe.com/api/setup_intents/retrieve)
contract.

The source integration test runs a real-shaped signed unexpanded completion
through the actual Stripe normalizer, saved-method ledger and paused trial
activation. Provider HTTP responses in these tests are synthetic; they are
not real Stripe acceptance. Exact session-bound proof for a previously saved
card, first-customer creation bound to a durable setup-attempt/request snapshot,
and the other full integration
requirements above remain open. C12.38 is not checked and seller-merchant
activation remains unavailable.

The four-file source run passed 78 checks: 49 database-backed provider/billing
integration cases and 29 provider-edge cases. That includes actual raw HMAC
verification and unexpanded SetupIntent normalization into the saved-method
ledger and paused card-trial activation, with synthetic provider HTTP responses.
Nine new evidence checks failed on the earlier adapter before the repair.
The lean final adapter/evidence run passed all 29 cases again. Public SDK
generation passed all eight checks; no new public service or migration is added.
