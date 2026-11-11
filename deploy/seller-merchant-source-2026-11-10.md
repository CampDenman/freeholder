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
The final build on protected core `1d6f1764` and standalone scrub checked 18,779
files and 226,776,069 bytes without source or environment leakage. Final fast
gates passed typechecking, lint, licensing, release notes, plan consistency
and 368 contract checks with one deliberate skip. The evidence matrix retains
369 rows × 12 criteria. These checks do not close C12.38 or C11.10.

## Account-scoped provider customer erasure

The local `commerce.money` erasure operation now captures every original
provider/account/customer before removing saved methods/customer bindings and
queues durable cleanup in the same transaction. A saved-method-only customer is
included; duplicate references on the same account are one task, while distinct
accounts remain separate. The existing money hold owns both the provider work
and its local references. No new retention scope bypasses that dependency.

Stripe cleanup requires an exact customer read and actual deletion acknowledgement
or its already-deleted tombstone on that original account. Failed/unsupported
work remains pending, including redrive with a new execution ID. The public
receipt contains task IDs rather than provider routing. The owner is told in
all four locales that Stripe customer deletion cancels active Stripe subscriptions.
Late authenticated feedback cannot restore erased saved cards or customer
bindings; real financial settlement still records. A real transaction-race
control verifies rollback and safe retry across erasure cutover. Another
request cannot discard the first pending receipt. A missing applied receipt
requires the exact original backup and original job reconciliation; it cannot
be replaced by a fabricated completion. See `deploy/privacy-rights.md`.

`tests/core/payment-provider-erasure.test.ts` and
`tests/core/stripe-customer-erasure.test.ts` are the source controls. Actual
provider erasure/account acceptance and the independent review remain required;
this increment does not close C12.38 or enable seller-merchant activation.

## Immutable trial setup and physical provider dispatches

Migration70 adds a private original request per card-setup attempt and a ledger
row for every physical Customer or Checkout POST. The original contact metadata,
name/email, currency, original account, return addresses and request keys are
frozen before I/O; Customer identity commits before Checkout starts. Each actual
response commits through a system-only phase even if privacy has meanwhile
removed the public identity. Competing responses retain every actual customer
reference. No provider call runs inside a service transaction.

New zero-fee card trials require the exact latest attempt's confirmed method,
original customer and original account. A newly saved unrelated card cannot
start the trial; re-verifying an older card for this exact attempt can. Contact
merge changes ownership through the subscription while preserving original
provider metadata. Signed feedback and actual readonly recovery must agree on
the account, Customer, Checkout, SetupIntent and attempt/subscription/contact.

Request-key retry age comes from PostgreSQL's first physical dispatch, not the
application clock or the parent row's creation time. Actual account-scoped reads
can recover an open, completed or expired session. Age and lookup absence never
settle a physical request; finding one customer does not establish that another
outstanding caller cannot still create a resource. All running/unknown calls
remain durable and keep privacy pending until their own final outcome is known.

The owner can inspect original request keys and accounts from the subscription
detail, reached from `/admin/subscriptions`. Recovery requires fresh interactive
verification and concrete original-provider operation/support evidence plus
evidence all original callers/retries stopped. Completed resources also require
positive original-account metadata checks; cancellation requires the provider's
actual no-resource/no-future-completion guarantee. These records are explicitly
`human_provider_confirmation`, with the original human actor and evidence, and
are never represented as machine-verified provider responses. Agents, personal
keys, system actors and stale verification cannot supply them. Without the
actual evidence, leave work pending. A fully settled cancellation can close its
attempt and let the customer explicitly start a new immutable request.

The `subscriptions.cardSetups` privacy source inherits the existing money hold.
Otherwise it queues durable cleanup before removing any pending setup evidence.
Cleanup waits for every physical call, deletes all actual customer references
on the original account and acknowledges the original logical job only after
success. Parent deletion and old-image erasure completion are fenced in SQL.
The historical confirmed-method UUID does not prevent credential erasure when
only setup evidence is held. Full rollback of migration70 requires the actual
pre-upgrade database/object snapshot; an older image is deliberately refused at
these safety boundaries.

Sources: `card-setup.ts`, `setup-dispatch.ts`, `setup-erasure.ts`,
`setup-reconciliation.ts` in `src/modules/subscriptions`; native controls in
`tests/modules/subscription-billing.test.ts`,
`tests/modules/member-merchant-policy.test.ts`,
`tests/core/stripe-setup-recovery.test.ts` and
`tests/core/stripe-setup-evidence.test.ts`; actual owner/customer UI journeys in
`tests/browser/trial-setup-recovery.spec.ts`. Browser provider states and HTTP
transports are synthetic source evidence. Actual enabled-account acceptance,
independent review and the remaining full seller-merchant integration above
remain required; this source increment enables no direct merchant mode.

Final audit-copy control also reproduced a completed erasure retaining the
subject's email in generic reconciliation audit input. The existing typed
`auditInputFields` seam now limits those phase copies to dispatch/outcome, and
setup application/response copies to their minimum operation IDs/stage. Full
concrete evidence remains in the private dispatch until its named hold or
cleanup permits erasure. Original actor/action/subject metadata is unchanged.

A populated schema69→70 rehearsal preserved the existing paused agreement,
customer and unrelated saved card, inserted zero setup/dispatch evidence, and
refused a prior-image trial activation with
`subscription_trial_setup_confirmation`. Migration70 SHA-256:
`11ca773e5a0aa938a913698fd38a78d3bd9f1eb0af3d3e0facd27c54831aebb8`.
This is upgrade/source refusal evidence; actual full restore acceptance remains
required under C11.08.

An actual least-privilege control also reproduced a freshly verified view-only
subscription role reading the private recovery record through the API. The
shared service now requires subscription management for both inspection and
confirmation, matching the owner UI. The response projects concrete evidence
fields, and authorized managers can review the recorded evidence in the page.
Agents, personal keys and view-only roles remain refused.

A merge/undo control reproduced a newly frozen merged-identity customer snapshot
following a subscription back to the separated person. Setup/dispatch state now
participates in the parent's undo boundary through exact locked fingerprints;
merge history stores only IDs/hashes, never another copy of customer inputs.
Unchanged pre-merge requests remain undoable, while new or changed provider
work refuses separation. Two ordered queries bound the combined setup and
physical-dispatch witness to 5,000 records; either overflow records a
non-undoable merge with no partial snapshot. Later overflow also refuses undo,
so rows outside a capped prefix cannot escape the identity boundary. Actual
over-cap controls cover parent records, child dispatches and later growth.
Migration70 seeds empty witnesses for pre-existing
active operations and fences prior-image inserts that omit the new family;
the populated upgrade rehearsal verifies both protections without inventing
any provider records.

Final source qualification includes 58 adapter/recovery wire controls, eight
SDK controls, 20 setup/identity/privacy-lineage controls, and six bounded
witness controls. The earlier seven-suite integration exercised 146 unique
cases: 144 passed initially; two invalid fixture assumptions were corrected
and their affected suites passed. It was not one wholly green 146-case run.
The final production artifact contains 20,320 files / 242,450,117 bytes and
passes the standalone source/environment scrub. Eight actual Chromium journeys
passed on a fresh schema70 database in English, Spanish, French and Arabic,
including keyboard submission, 320px reflow and both-theme Axe scans. Final
type, lint, licensing, plan and 373 contract checks passed across the main run
and the generated-changelog correction retry. Bounded peer review found no
remaining source blocker; it does not supply independent security sign-off.

Protected CI found nine missing activity-feed labels and an older merchant-card
browser fixture that relied on a card-age event without exact setup proof.
All new mutations now have precise four-locale request/outcome/recovery/cleanup
labels; requesting setup no longer claims the trial started. The existing
merchant fixture now supplies the actual expected durable proof shape and
provider-shaped synthetic account IDs, preserving its account/seller isolation
assertions. Final audit/translation controls passed 35, four owner recovery
journeys passed, and the four affected merchant journeys passed on the final
artifact. These fixture states remain synthetic, not live provider acceptance.

Archive/setup queue composition preserves both independent-review append
sections. Against the computed automatic merge tree, only the resolved packet
markers differ; runtime, SQL, SDK and locales are identical. The composed tree
passed 21 live SDK/activity/bounded-identity checks, four owner locale journeys,
all 373 contracts with one exclusion, full fast gates and a fresh production
scrub of 20,327 files / 242,796,086 bytes. Migration70 remains byte-identical at the
SHA-256 above. Fresh exact-head protected checks govern requeue; no gate is
inherited from a differently composed head.
