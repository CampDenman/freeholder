<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Charge-only original refund feedback checkpoint

C12.38/C1.08, 2026-11-13. Isolated source-only correction from rootfb72a4c8.
No compiler, lint, build, tests, model imports, parser, provider or PostgreSQL
execution ran. No schema, guard, migration, journal or root worktree changed.
The failed actual unassigned V4 dataset and its evidence remain untouched.

Stripe documents Refund.payment_intent as nullable, independently of its charge
reference. See [Stripe's Refund object](https://docs.stripe.com/api/refunds/object),
attributes payment_intent and charge, reviewed2026-11-13. This nullable contract
does not assert that every PI-backed charge emits a null PI. The prepared
provider-edge vectors intentionally exercise the signed charge-only form.

The original fixture supplied a real signed PI-bearing refund. The existing
managed owner selector correctly retained it in merchant_refund_observations
before any cash recovery owner, so expecting a legacy raw row was incorrect.
That managed selector and PI retention behavior are unchanged.

The unassigned native journey now sends payment_intent:null with its actual
original charge through the actual Stripe HMAC verifier and shared evidence
retainer. It asserts exactly one raw row, zero managed observations and zero
cash owners before discovery; preserves explicit unassigned review, exact
unapplied remainder, unchanged payment/refund/credit records and every no-repeat
oracle. A separate native case confirms the unchanged PI-bearing callback goes
to managed1/raw0. The existing actual NULL-payment subscription receipt journey
keeps all prior oracles and adds a charge-only callback through verify/retain,
exact receipt/profile repair and financial dependency discovery, with still no
local payment/refund/cash owner created. All native additions are UNRUN.

`original-cash-charge-ancestry.ts` is an ordinary read-only helper. It selects
actual succeeded positive payment observations and real positive subscription
charge receipts by providerChargeRef plus the exact observed original platform
and charge account. No amount, currency, email, current merchant account or
assumed creator chooses an owner. Real receipt FK aliases may collapse the two
representations of one original cash namespace; absent/conflicting aliases,
competing local owners or different PI namespaces refuse. Alias subscription,
platform/account, API epoch, invoice, PI and charge must all agree. Observed
platform absence cannot be backfilled by this direct charge lookup.

The financial feedback witness gathers charge references in a private sidecar.
Only an absent observed PI permits the new charge branch; a present contradictory
PI still requires its genuine original refund-resource binding. It verifies
raw receipt HMAC before ownership, checks global charge candidates rather than
sampling only the caller's payment, and bounds the combined unique physical
source/resource/owner/fact/feedback identity inventory at5000. Unknown platform
feedback can remain conservative review, while direct privacy ownership remains
unresolved until authentic original resource lineage proves it.

Historical namespace objects are byte-for-byte unchanged, including property
order and originalResourceRefs meaning. Charge references are never appended
to those namespace bodies. Existing namespaceDigest:actualFeedbackUUID IDs,
signed originals, old creator admissions, captured facts and bank GET/POST
rules are not rewritten. The privacy owner resolver composes the exact new
charge candidates with its existing legacy/request/captured-resource proof;
a corrupt old admission still refuses rather than being bypassed by a positive
row. Raw feedback commits before repair/outbox or application as before.

Twelve prepared pure/SQL-adapter cases cover exact charge/platform/account,
first-owner absence, old namespace bytes, NULL-payment receipt identity,
actual aliases, globally competing owners, foreign source/alias refusal,
present contradictory PI/missing platform, corrupt HMAC and overflow. These
are UNRUN; the first two actual partial-return oracles are unchanged. Root owns
renewed source checks and actual fresh-DB acceptance. This source checkpoint
closes no C item or stable/provider/privacy qualification requirement.
