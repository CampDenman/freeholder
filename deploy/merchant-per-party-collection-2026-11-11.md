<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Per-party collection source evidence — C12.26/C12.38

This work extends the immutable original invoice portions from migration77.
It is unfinished source work. The source branch starts at signed allocation
checkpoint `a2b0d7b4`; no migration80 or journal entry is present yet. Nothing
here enables seller collection, closes C12.26/C12.38, or supplies a real-money,
tax, independent-review or stable-release sign-off.

The adapter boundary now represents the original authenticated platform,
connected charge account, destination recipient and settlement merchant as
separate facts. A destination charge uses the platform namespace, never a
`Stripe-Account` header for its recipient. New routes verify the authenticated
platform with a provider read before each operation and refuse replacement
platform credentials. Successful hosted and saved-method collection reads the
actual PaymentIntent route; a mismatched route remains unresolved. Historical
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

The bounded no-database provider run passes 87 controls across five files:
the new original-account/fee controls and the existing customer-erasure,
saved-method setup-evidence and setup-recovery controls. TypeScript and focused
ESLint also pass. These are mocked provider HTTP controls, not native invoice
journeys or actual Stripe-account acceptance.

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
Destination refunds and disputes debit the platform balance even with
`on_behalf_of`; the setting changes settlement merchant, not charge namespace.
