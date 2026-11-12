<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Per-party collection source evidence — C12.26/C12.38

This work extends the immutable original invoice portions from migration77.
It is unfinished source work. The source branch starts at signed allocation
checkpoint `a2b0d7b4`; reserved migration80 work remains unqualified and outside
the journal. Nothing
here enables seller collection, closes C12.26/C12.38, or supplies a real-money,
tax, independent-review or stable-release sign-off.

The adapter boundary now represents the original authenticated platform,
connected charge account, destination recipient and settlement merchant as
separate facts. A destination charge uses the platform namespace, never a
`Stripe-Account` header for its recipient. New routes verify the authenticated
platform with a provider read before each operation and refuse replacement
platform credentials. Hosted and saved-method collection retain actual paid
provider observations before comparing the invoice or settlement route. A
recipient/fee mismatch remains private settlement debt; a positive Session
without consistent original intent binding remains unapplied observed money.
Historical
direct requests retain their existing account-scoped contract without guessed
platform identity.

An exact application-fee refund is a separate operation from the customer's
refund. Its original fee, original charge, original account, currency, amount
and operation ID must agree. For destination fees, `originating_transaction`
identifies the original platform charge; the fee's `charge` is the connected
transaction. Both direct and destination application-fee refunds use the
original platform's fee namespace. The provider receives the frozen exact
commission amount, never a proportion of item tax or freight. Bounded complete
page recovery matches the exact operation metadata. A missing lookup remains
unresolved; it is not evidence that a timed-out operation did not happen.

The first bounded no-database provider run passed 87 controls across five files.
A later six-file run passes 104 controls, adding exact payment-attempt metadata,
actual paid-amount disagreements and original-resource recovery. The three new
platform-scoped erasure controls also pass alongside the 12 existing controls.
TypeScript with an 8GB heap and focused ESLint pass. These are mocked provider
HTTP controls, not native invoice journeys or actual Stripe-account acceptance.

Recovery searches complete bounded pages on the original platform/charge
namespace and matches immutable payment-attempt/platform metadata. Positive
page observations commit through a callback before another page can fail. An
empty lookup never proves absence. The original known Checkout Session can be
expired only in Stripe's supported state; its acknowledgement commits before
further reads. Processing asynchronous payments remain pending. Checkout-owned
PaymentIntents use direct cancellation only for Stripe's documented
`requires_capture` exception, retaining the actual complete Session state.
No human negative shortcut releases an unidentified original CREATE, and no
new charge key is authorized just because the 23-hour replay window elapsed.

New customer/method resources carry original platform scope through erasure
and revocation; old records remain explicitly NULL rather than being rebound
to today's credentials. Provider lookup does not rewrite old contact metadata
after a legitimate contact merge.

A further adapter checkpoint authenticates the actual platform for newly tagged
payment webhooks and for refund/dispute events. It preserves original attempt
metadata, the actual PaymentIntent charge reference and actual recipient/fee
facts. A paid Checkout Session without its original intent proof remains a
positive observation requiring verification. Recipient disagreement and excess
paid amounts remain positive facts. The five-file mocked-provider run passed
97 controls before the additional partial-transfer control; the earlier legacy
refund fixtures were updated to mock the newly required platform read. These
counts do not claim database or real-account acceptance.

Original-charge inspection now reads the actual PaymentIntent, then its Charge,
original platform application fee and destination Transfer. Eight focused mocked
HTTP controls pass, including positive money committed before a later fee read
fails, original fee/transfer lineage, foreign metadata, missing transfers and
fee-currency disagreement. Full TypeScript and focused lint pass at this stage.
A successful customer charge alone does not assert completed seller settlement;
fee correction and refund history must still satisfy the immutable commission.
These controls cover newly committed payment-attempt metadata; scheduled
subscription charge-origin proof is a separate source integration still underway.

The remaining full specification is still required: immutable per-party issue
snapshots and route admission on one invoice; original-merchant tax and fee
integration; payment/refund/dispute and partial/unknown recovery; original
account saved-method/customer treatment; buyer and owner flows in all four
locales; shared-service SDK/API/MCP parity; migration/merge/privacy/hold
qualification; and actual documented provider acceptance. MASTER.md §43
remains the only completion authority. No new work is deferred.

Provider semantics were checked against primary documentation on 2026-11-12:
[charge types](https://docs.stripe.com/connect/charges),
[destination Checkout](https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=stripe-hosted),
[refund parameters](https://docs.stripe.com/api/refunds/create),
[application-fee identity](https://docs.stripe.com/api/application_fees/object),
[exact fee refunds](https://docs.stripe.com/api/fee_refunds/create), and
[indirect charge refunds/disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes).
Recovery uses [original Session expiry](https://docs.stripe.com/api/checkout/sessions/expire)
and the documented [Checkout intent cancellation exception](https://docs.stripe.com/api/payment_intents/cancel).
Destination refunds and disputes debit the platform balance even with
`on_behalf_of`; the setting changes settlement merchant, not charge namespace.

Charge inspection also follows the official [PaymentIntent](https://docs.stripe.com/api/payment_intents/object),
[Charge](https://docs.stripe.com/api/charges/object), and [Transfer](https://docs.stripe.com/api/transfers/object) object contracts.
