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

The next booking source slice derives its accepted price, seats, currency,
payment mode and tax category from the actual original product. Separate tax
and public-business consent digests bind the original platform/recipient and
merchant support identity. The invoice tax hook checks the original buyer and
exact accepted line money. Public booking displays that business and tax total
before consent in all four locales. First pricing of an unpriced appointment
requires an explicit current quote; rescheduling copies its original terms.
Pure consent, locale and private-service controls passed; the audit-label run
identified the tax-erasure label supplied by the pending upstream order/tax
checkpoint. Full booking database/browser and owner quoting qualification are
still required; no migration or provider mode has been activated.

The order issue and collection resolvers now consume the original pre-draft
commercial witness, including its model, fees, platform, recipient and exact
per-party tax profile. They do not replace those terms with today's site
configuration. Cart checkout displays every named business, its tax and total,
and binds separate accepted business and tax digests. Quote review uses the
existing bounded private return-cookie flow; customer addresses do not travel
in checkout URLs. Six focused no-database files passed 106 controls and full
TypeScript plus focused lint passed. The prepared-buyer private quote phase
is the next composition step for scoped checkout callers; assembled80 native,
SDK and browser qualification remain open.

## Original request and unknown-checkout source checkpoint

Each new hosted/saved-method request retains its original opaque provider
invoice/contact references before I/O. The current invoice-to-contact pointer
remains the authority for permissions, erasure and merge. Physical checkout
creation admits a durable dispatch with the full original argument digest and
the original key. Changed parameters cannot replay it. A later refused call
does not clear an earlier unknown call: ordinary failure/cancellation requires
either proved no dispatch, explicit definitive refusals for every admitted
creation call, or the exact provider resource's terminal zero-money receipt.
Positive cash always prevents a no-charge conclusion.

Original Checkout search never interprets an empty bounded listing as absence.
Provider expiration/cancellation acknowledgements commit independently before
subsequent reads. Negative terminal proof compares actual original invoice and
contact metadata; contradictory positive money is still retained, unapplied.
Two before controls on the earlier disabled80 adapter reproduced the missing
negative metadata comparison. Its corrected complete HTTP suite passes 15
controls, including positive-cash preservation. This is source qualification of
the unpublished80 implementation, not an unchanged-main production defect.

The protocol follows Stripe's current [Checkout expiration](https://docs.stripe.com/api/checkout/sessions/expire)
and [PaymentIntent cancellation](https://docs.stripe.com/api/payment_intents/cancel)
contracts. Expired Checkout prevents customer completion; direct cancellation
of a Checkout-owned intent uses only the documented `requires_capture`
exception. Processing or unidentified money stays unresolved. Provider account
acceptance and every supported partial/unknown resolution still need actual
qualification; no financial model has been enabled.

The owner review exposes original accounts, retained money, commission facts,
physical dispatches and cancellation evidence. A recovered original checkout
link uses a five-minute authenticated browser witness bound to its payment and
owner. The four locale catalogs contain its action and outcome copy. Shared
invoice/contact merge receipts include bounded fingerprints of new payment
requests, dispatches, cash, fees, refunds and disputes; unchanged legacy
invoice history retains its existing receipt shape. Financial privacy export
includes this original recovery history without reassigning its opaque
provider contact reference. Native merge/erasure/hold, all method recovery,
per-allocation settlement and actual owner/buyer browser qualification remain
required before source activation.

At this source freeze, full TypeScript and focused lint pass; nine no-database
files pass 131 controls. These include the authenticated owner-link, private
service/audit, locale, original recovery, booking consent and tax contracts.
The common subscription application reader proves one exact original receipt
has a succeeded payment, verified customer cash, immutable route and canonical
invoice/tax lines; other unapplied invoice cash returns pending. New original
receipt IDs have unique payment bindings. No schema80 SQL or native recovery
case has been applied yet. Saved-method dispatch/recovery, full per-party
settlement and composed lifecycle/source/browser acceptance are still active
completion work, not new stable deferrals.

### Current combined source candidate, 2026-11-12

The financial source has been composed onto the actual migration 0–79 source
checkpoint `eba0220f`; migrations 75–79 and their existing journal entries are
preserved. The earlier SQL diagnostic used normal migrations 0–77 followed by
explicit unpublished fragments and passed. That result did not qualify
migration 79, a contiguous migration 80, or any native payment service.

The isolated candidate now assembles migration 80 from the owned tax,
subscription scope, subscription lifecycle, order and payment fragments with
`scripts/assemble-merchant-schema80.mjs`, and appends its local journal entry.
This is unpublished test source. New provider schedules remain guarded and
the seller-as-merchant model remains unavailable while its lifecycle,
settlement and refund recovery are completed. Changes to an owned fragment
require regenerating the assembled migration before testing. Old warm tax
readers and already admitted provider calls must actually stop and drain;
no SQL trigger is claimed to intercept an old SELECT or cancel remote work.

Both financial webhook gateways now forward the authenticated subscription
scope lookup. Only the payment adapter may invoke that lookup after raw-byte
signature and timestamp verification. The registry preserves the actual
platform, original charge account and frozen protocol; tagged new schedule
feedback refuses missing source integration. The independent cash evidence
phase attempts every authenticated event before returning an application
error, so one policy mismatch does not hide another positive observation.
Six focused no-database controls and the full TypeScript check pass for this
source increment. Contiguous SQL and native source qualification are pending.

### Saved-card source recovery increment

Saved-method recovery now uses its actual original PaymentIntent in the
shared owner reconciliation service. A cancellation acknowledgement commits
before the final provider read; that acknowledgement alone never releases
another attempt. Terminal receipts distinguish a real Checkout Session from
a saved-card intent with no session. The latter requires an authenticated
canceled intent and exactly zero received money. Pending, missing, ambiguous
and positive outcomes remain blocked or recorded as unapplied cash.
The owner form has both resource paths in all four locale catalogs.

The adapter and terminal-proof controls pass 39 cases, and the combined
financial/scope staging batch passes 43 cases; locale and journal controls
pass 62 cases. The full 8 GB TypeScript check and focused lint pass. The
fresh regenerated migration and three prepared native checkout/recovery
cases remain pending for this increment. The earlier frozen schema candidate and its native tax tests are
kept separately; their SQL evidence is not attributed to this changed schema.
The actual checkout fixture uses real member/catalog/tax/quote/issue services
with a test payment edge, and its direct/destination mixed-cart cases do not
constitute real provider-account acceptance.
