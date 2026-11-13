<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original phase stop and invoice quiescence — source checkpoint

C12.38/C1.08. This UNQUALIFIED source is based on the complete financial
integration `0ce0bb53`, whose ordinary80 SQL is exactly
`3a6862457f9342fe7ad109bc83c7a270ef5ac535a9b1639a459c23bc8a9c997f`.
It adds no tables or contact FKs, enables no provider admission, and has not
run a compiler, automated test, migration, native service or provider call.

Four private resident phases read actual primary schedule IDs, claim their
one cancellation, retain the actual stop ACK and finish the original caller.
Claims prove the original queued cohort/member inventory, current intact
pending privacy receipt, caller ownership and current retention holds. The
worker stops every actual primary schedule before canceling all original
linked subscriptions. Physical stop facts remain independent of commercial
read failures, and failed fact commits remain cached for no-POST flushing.
Unknown original ACKs or caller finishes remain recovery debt. No clock or
lease is used to establish caller exit.

Current null subscription pointers do not prove historical absence. Original
ACKs, verified or stale returned inventory and authenticated original cash
history preserve known linked resources. A zero-linked future schedule needs
its actual creating caller finish, returned nonce-owned cancellation, complete
actual linkage and provider-reported creation/cancellation timestamps before
the originally admitted first phase. Missing timestamps or historical links
keep recovery open. A cancellation acknowledgment alone never closes invoices,
PaymentIntents, fees, recipients or a whole privacy request.

The existing stopped-invoice reader now enumerates every original
`/v1/invoice_payments` page and reads each actual PaymentIntent, preserving
positive money through the existing separately committed `retainProviderCharge`
service before later page, amount, currency or obligation failures. It accepts
only the original customer, platform/account, invoice and subscription binding.
Actual related primary schedule IDs and the original create operation come
from this task's immutable source inventory. No synthetic operation, payment
attempt, cash receipt or subscription identifier is invented.

The shared retention projection reads every actual prior invoice and PI. It
requires terminal paid/void obligations, actual canceled zero-received intents,
and existing shared `subscriptionChargeDisposition` evidence for each positive
receipt: canonical applied payment or fully proved returned-unapplied cash.
The existing `merchantPaymentRecoveryDebt` and shared original financial
inventory remain required; this source introduces no separate fee math or
settlement authority. Zero-total paid invoices require an existing canonical
invoice/tax witness. Missing cash, open or processing intents, absent canonical
zero invoices and incomplete source history stay pending. The final privacy
consumer rereads the same current shared cash dispositions and payment debt.

`deploy/subscription-phase-stop80.fragment.sql` is a separate owned UNAPPLIED
additive tail after the exact full3a predecessor. Its SHA256 is
`173898e837f2678d14b4d077aa22be263dbcc9496172b51073b1f14139656eba`.
It validates positive original primary stop/caller/link coverage and permits
quiesced null-subscription resources only with that explicit proof. It also
requires phase stop coverage when a primary subscription is present. The
assembled migration, old fragments, preserved databases and goldens were not
changed. Root must assemble a NEW full80 hash and create a NEW named normal DB
before migration/model/native qualification; never apply this tail to a golden.

Nineteen new source controls are prepared and unrun: seven declared immutable
stop-proof cases, five actual-factory injected HTTP primary-stop cases and
seven actual-factory injected HTTP invoice/PI inventory cases. Existing phase
stop expectations now include the explicit nullable pre-start proof, and the
old invoice-page fixture supplies actual invoice-payment/PI responses. Its
loop count includes the newly required invoice-payment read; no timeout was
increased. All old business assertions remain represented, with positive cash
retention and complete inventory assertions added.

Full source/type/lint/private/audit checks, fresh ordinary schema/model and
SQL guard controls, real original producer and failure/replay service journeys,
nonempty applied/returned/fee/native paths and full owner/API/SDK/browser
qualification remain required. Further required source work includes durable
GET recovery after uncertain phase/cancel responses, original PI cancellation
and invoice void/delete callers, explicit commercial amendments and complete
future invoice lineage. This checkpoint does not close C12.38/C1.08, prove an
actual provider account or supply independent security/final stable sign-off.

Protocol references checked against Stripe's current primary API documentation:
[Subscription Schedule object](https://docs.stripe.com/api/subscription_schedules/object),
[cancel a schedule](https://docs.stripe.com/api/subscription_schedules/cancel),
and [complete invoice-payment pagination](https://docs.stripe.com/api/invoice-payment/list).
The documented nullable schedule links are treated as nullable facts, not an
absence certificate; the includable invoice payments field is not a full list.
