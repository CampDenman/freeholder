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

## Collection source integration checkpoint — not enabled or qualified

The isolated collection source now has draft per-party issue receipts, original
order and new-agreement payment routes, platform-owned customer/method keys,
canonical invoice due limits, public per-party invoice projections, independent
authenticated money receipts and actual charge inspection. New positive money
blocks another attempt until reconciled; payment application and seller
settlement remain separate. Ten pure cumulative fee-target controls and the
existing ten collection amount controls pass. The four-file source contract
run passed 32 controls. Full TypeScript and focused lint pass at this checkpoint.

Migration80 is deliberately unjournalled and has never been applied. It still
requires the independently owned tax, subscription and runtime ABI fragments,
full new booking/service source snapshots and routes, native source controls,
fee-operation dispatch/recovery, all partial/unknown refund and dispute flows,
per-party member settlement, original-customer late-erasure qualification,
owner recovery interfaces, four-locale browser and live SDK/API/MCP permission
qualification. The provider model registry still excludes seller_merchant.
This checkpoint must not be described as activation, stable completion,
provider-account acceptance or an independently reviewed security sign-off.

## Original fee recovery and scheduled-origin source checkpoint

The subscription origin proof is now integrated into original charge inspection
and customer refund dispatch. Scheduled charges prove the actual original
InvoicePayment/PaymentIntent relation and do not invent Freeholder attempt
metadata. The subscription witness must commit before ordinary billing applies.
The verified webhook phase can return a private durable subscription receipt
ID through the startup registry; ordinary application receives that prepared
event only afterwards.

The new common commission ledger supports an original observed fee greater
than the frozen merchandise commission, including a scheduled percentage fee.
It derives a cumulative retained-fee target, counts earlier accepted corrections
and customer refund operations, and refuses another dispatch while a prior
operation is unknown. Actual fee-refund acknowledgements commit independently
before the logical operation transition. A failed auxiliary read or logical
application therefore cannot erase a positive ACK. A provider-side fee refund
outside the known ledger remains review debt; it is not silently adopted as an
unknown operation or ignored before another POST. Currency disagreement remains
review debt. New provider operations carry the original platform namespace.

Customer settlement/refund commits enqueue a separate fee reconciliation job.
Its failure does not rewind customer money. An accepted fee operation is not a
claim that all current commission obligations are reconciled; the job re-reads
actual provider evidence before reporting satisfaction. Owner review has a
scoped shared service exposing retained physical money and fee facts, including
unapplied positive observations and paginated history. Further owner UI and
unknown-payment recovery integration remain required.

Seven focused no-database files passed 102 controls, and full TypeScript plus
focused lint passed at this checkpoint. This includes scheduled-origin,
inspection/refund, exact fee-ACK, cumulative arithmetic and private-service/audit
contracts. It does not claim native financial journeys, database migration80,
real provider accounts, all four locale flows or completed privacy/merge/hold
qualification. `merchant-invoice-source-inventory-2026-11-11.md` records the
additional inherited-source paths that must be complete before activation.

## Disabled booking and protocol composition checkpoint

New booking acceptance now has an original catalog ownership witness, an
immutable member policy and a separate original charge/tax scope. Rescheduling
copies that scope rather than consulting the offering's later owner. Invoice
and payment routes can retain this single-source scope independently of order
allocations and subscription agreements. Buyer tax destination and seller
public identity have separate erasure roles; parent-contact merge receipts
include bounded child money witnesses. These are source foundations: original
booking price capture, public quote/consent, inherited financial sources and
native qualification still need completion before this model can be enabled.

New scheduled charges preserve the explicitly frozen Stripe API version on
original inspection, refund and commission operations; historical and hosted
charge defaults retain their original protocol. Seven adapter/protocol files
passed 129 controls and four source/privacy/audit contract files passed 30.
Full TypeScript and focused lint passed. Migration80 remains unapplied and
unjournalled; this is not a native migration, provider-account or release claim.
