<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original provider phase adapter — inactive source checkpoint

C12.38 remains open. This is an additive adapter foundation over current
f0416c52, not schedule admission or actual provider acceptance.

The supported new protocol is exactly `2026-10-28.endive`. Stripe's official
[23.1.0 release commit](https://github.com/stripe/stripe-node/commit/6d5ed967d602224ac3056dc3f0befbb55487ee50)
and pinned [API version](https://github.com/stripe/stripe-node/blob/6d5ed967d602224ac3056dc3f0befbb55487ee50/src/apiVersion.ts)
confirm that version. The corresponding generated
[SubscriptionSchedules resource](https://github.com/stripe/stripe-node/blob/6d5ed967d602224ac3056dc3f0befbb55487ee50/src/resources/SubscriptionSchedules.ts)
provides create/update/read/cancel endpoints and a genuinely nullable linked
subscription. Its phases accept inline recurring prices under an actual Stripe
product, exact boundaries, metadata, tax and routing settings; its fee percent
applies to the invoice total. The [schedule guide](https://docs.stripe.com/billing/subscriptions/subscription-schedules)
documents sequential bounded phases and distinct schedule cancellation versus
release. No SDK dependency is introduced.

The source pins the original platform and actual charge namespace on each
HTTP operation. Only actual `sub_sched_*`, `sub_*`, `prod_*`, `price_*`, `cus_*`
and `pm_*` provider references are accepted. An ACK may retain unknown customer
or subscription fields without inventing values. It commits the actual
schedule identity before independent schedule/price readback; that read proves
actual monetary price, calendar, method and destination against the exact
admitted request. Updates first read the separately retained previous inventory.
Schedule cancellation retains terminal ACK and known linked subscription IDs;
that is not a proof that earlier invoices or linked subscriptions are safe.

The initial synthetic HTTP controls are drafted but unrun. Full types, focused
lint and the finite new controls require an explicit source window. No public
or worker path calls these optional methods; provider creation remains closed.
There is no schema/journal change in this adapter checkpoint.

The next owned delta must supply real original auxiliary-product creation
intent/caller/ACK, one durable phase mutation claim and stopped caller evidence,
frozen dated invoices for admitted future phases, schedule-only stop coverage,
and original nonempty paid/returned-cash proof. A product reference is currently
an original-request prerequisite, not an invented Freeholder product UUID.
The new helpers alone do not provide those capabilities. Any model/fragment
extension must compose against the current ordinary80 prefix into a NEW hash
and NEW database; existing V10/V11 evidence remains immutable. Amendments and
provider creation stay disabled until the complete protocol is qualified.

The provider metadata binds the pre-existing committed operation UUID. It does
not embed its own full request digest: the pure body builder lets the real
claim freeze/hash the exact physical form after that UUID exists, avoiding a
circular hash. The separately returned inventory digest remains bound to the
server's retained admission, never accepted as a provider metadata assertion.

Qualification: a08a5a2e passed full Node22 types (8GB) and all four changed TS
files' lint. The nine real-factory, injected-HTTP controls passed as2+1+6
without repeating passed cases. Two new fixture errors are preserved: expecting
a raw network exception rather than paymentFetch's sanitized provider_failure,
and returning a schedule object at an auxiliary price endpoint. Test-only
be3c7653/f231bba7 corrected those fixtures; each changed-file lint passed.
Logs and exact JSON assertion reports have prefixes
`/tmp/freeholder-phase-adaptera08-`,
`/tmp/freeholder-phase-adapter-corrected-` and
`/tmp/freeholder-phase-adapter-aux-route-`. No DB, schema, provider or active
admission path was exercised. Actual auxiliary-product authority, physical
caller persistence, future invoice freezing and paid/returned resolution
remain required in the next concrete source increment.
