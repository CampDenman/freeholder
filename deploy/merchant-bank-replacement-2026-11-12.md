<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original bank refund replacement — C5.19/C12.38

This isolated source follows current bank checkpoint `c73cc46b`. It does not
change assembled SQL `e7834c9048ecd5eace52ecc391ff392f7b0701b396e02ddcfc364cb8743d82a5`
or any preserved database. The collection model remains disabled.

The shared scoped, step-up service `invoicing.replaceReturnedBankRefund`
requires a signed-in person without key scopes and explicit confirmation.
It reads each exact original resource outside transactions, commits observed
facts before reporting policy errors, then reserves under original identity,
refund, payment, invoice and cash locks. An actual current failed/cancelled
resource and separately finished physical creators are required. A pending or
unknown caller cannot authorize a new key. RMA refunds use their existing
original part and issued credit; this generic service refuses to own them.

The existing business journal stores a purpose-bound HMAC receipt covering
original request digests, actual failed-read receipts and revisions, full money
scope, parent/child refund identities, human actor and the journal occurrence.
The current key signs; previous keys only verify. These are authenticated
records in a mutable journal, not a claim of DB append-only storage. A reserved
child key with missing, corrupt or ambiguous evidence remains recovery debt;
the service never invents or signs historical causality. Physical dispatch
rechecks the chain under the existing cash lock. A post-dispatch outcome read
checks all original chain resources, including a later positive on the old one.

The buyer projection and financial debt share exact promise proof. An unrelated
equal refund cannot discharge the original promise. A genuine over-return
retains all observations and review debt, without charging the buyer. Existing
financial dependency fingerprints include journal children for the original
payment/receipt owners; the source also commits an original-profile repair
outbox pointer alongside the new causal record.

Source checkpoint `e4a39f30` passes full Node22 types with an 8GB heap, all 15
changed TypeScript/TSX files' lint and 63 DB-free controls in five files: 18
causal authentication/rotation/tuple/journal controls, 19 current-read controls,
14 capacity controls, five private-service controls and seven audit controls.
All 12 dependency manifests match the existing qualified installation; no
install occurred. All runners exited successfully; no database was opened.
Logs are `/tmp/freeholder-bank-replacement80-types-v1.log`,
`/tmp/freeholder-bank-replacement80-lint-v1.log` and
`/tmp/freeholder-bank-replacement80-controls-v1.{json,log}`.

Further qualification remains pending for generic replacement faults and
concurrency recovery, RMA credit/resource
convergence, late positives, stale reads, caller barriers and populated history.
Historical legacy bank recovery is also required and remains unfinished; no
new platform, request, invoice or causal history is backfilled for old refunds.
No browser, SDK, provider-account, stable or full-spec acceptance is claimed.

The first generic native case subsequently passed **8.118s** on exact
`a6c3dd47`, test-file SHA256
`43f549716e919731d6ecd4771f0b8fdbde472c9916e6a9d9835b4043f6fe1a45`,
against the existing disposable V11 ordinary-migration database and unchanged
SQL e783. It used the real current checkout, shared refund/current-read and
human replacement services, actual Stripe factory, intercepted HTTP and actual
HMAC verification/committed event intake. The original 400 refund changed from
success to bank failure; an unrelated 400 refund did not fulfill that original
promise. One explicitly authorized 400 replacement did. Replay caused no new
POST; the test asserted three distinct physical keys and customer `canPay=false`.
This generic case had no credit note; it supplies no RMA credit-reuse proof.

Independent SQL readback confirms original 4200 paid, current 800 refunded,
one failed 400 plus two succeeded 400 refunds, three ordinal-one finished
original callers/resources, one exact original-to-child causal journal and
retained original success/failure/failure-balance observations. Journal entries
remain 81 with e783. A bare inspection client inherited America/Vancouver and
returned no valid current receipt because timestamp serialization changed the
revision. The same read-only client in UTC, as required by core
`SESSION_SETTINGS` and §4.9, found the exact original FAILED and replacement
SUCCEEDED current receipts with matching revisions. The unrelated ACK-only
refund correctly has no current-read receipt. Neither inspection wrote stored
facts; all clients closed and final independent target backends were empty.
No eight-table golden hash was taken for this case.

Evidence: `/tmp/freeholder-bank-current80-generic-native-v1.{json,log}`,
`-v1-ledger.json` and `-v1-receipts.json`. The other four bank-native controls
remain unexecuted. Separate test-only `a490551c` strengthens the paused-caller
fixture to commit the real ACK and raw positive first, then hold only the
actual physical caller's promise before its finish receipt. It asserts the
physical ACK and bound positive exist while the finish receipt is absent.
Incremental full Node22 types and single-fixture lint both pass; no native has
run for this stronger case. The first generic case body stays byte-identical
to a6 (body SHA256 `336ab6879390bb8fd112c85e9c9446f9109524a7ccb2ea190891c4733e4cf6a6`).

The first two-resource native then reached a genuine code defect on exact
287/a490, unchanged test SHA48cf8407/V11 e783. It failed 7.062s after the real
400 failure and independent 600 action/null reads had passed. The next actual
600 pending read committed its raw observation, capture, read finish and valid
current receipt. Its logical projection tried to insert a `processing` to
`processing` transition when the failure code changed from action to pending;
the existing `money_state_events` transition constraint correctly refused it.
The projection transaction rolled back, leaving paid4200/current-refunded0,
failed400 and processing600, two original finished resources and both resources'
independent current receipts intact. Success restoration was not reached.

The failed populated state is preserved in
`freeholder_bank_pending80_populated_before_v11_test_20261112`. A template-only
clone passed0.479s with 15 UTC table count/SHA comparisons across source-before,
clone and source-after; ordinary journal81/max60/e783 and both backend sets were
unchanged/empty. Its report and start flag use exclusive creation and refuse
overwrites. Evidence is `/tmp/freeholder-bank-current80-resources-native-v1.*`
and `/tmp/freeholder-bank-pending80-populated-clone-v11.json`.

The narrow source repair emits a logical refund transition only when its
logical status changes. It keeps the actual row/failure-code update, committed
provider read facts, ordinary service audit, bank-state outbox and fee
reconciliation. No SQL, old money or test oracle changes. Source `2a191d44`
passes incremental full Node22 types, changed invoice-service lint and the five
finite core files'63 assertions with no skips. No registry or oracle changed.

The **unchanged two-resource AFTER passed7.381s** on 2a191, original test
SHA48cf8407 and existing V11/e783. The actual factory/HMAC flow completed
failed400 and independent600 action→null→pending→success. It asserted two
physical keys/POSTs and customer `canPay=false`. Independent UTC SQL asserts
paid4200/refunded600, failed400 plus succeeded600, two finished ordinal-one
original resources, both simultaneously valid FAILED/SUCCEEDED current
receipts, all retained raw success/action/null/pending/failure-balance facts and
real bank-state outbox events for failed/action/pending/succeeded. Journal81,
e783 and final empty target backends are unchanged. No causal replacement
journal or issued credit is expected in this case.

AFTER evidence is `/tmp/freeholder-bank-current80-resources-native-v2.{json,log}`
and `-v2-ledger.json`; the latter uses exclusive creation. BEFORE files and the
15-table golden clone remain separate and unchanged. Generic first proof and
this two-resource proof are component runs on their exact source checkpoints;
the RMA-credit, stale-read and strengthened unfinished-caller natives are still
unexecuted, and final combined-source/legacy/provider acceptance remains open.

The first RMA-credit native then failed genuinely6.617s on e007/product2a191,
unchanged test48cf8407 and V11/e783. The actual original4200 refund succeeded,
then its requires_action observation/current receipt and cash projection
committed: original4200 paid, current0 refunded and refund4200 processing.
The original issued4200 credit and exact frozen return part remained intact.
The return incorrectly stayed refunded because its post-commit bank-state
listener rolled back at `notifications.create`: topic
`return.refundNeedsAttention` violates the lowercase topic contract. The real
bank-state outbox remains pending with that error and attempt1. Terminal
failure and replacement were not reached; no RMA reuse proof is claimed.

The failed state is preserved in separate template-only
`freeholder_bank_rma80_populated_before_v11_test_20261112`, which passed0.145s
with23 UTC count/SHA equalities across source-before, clone and source-after,
including credit, return/part/original lines, outbox and the prior15 financial
tables. Exclusive report/start flags refuse overwrite. Journal81/max60/e783
and both clients/backend sets were unchanged/empty. Evidence is
`/tmp/freeholder-bank-current80-rma-native-v1.{json,log}`,
`-v1-ledger.json`, `-v1-outbox.json` and
`/tmp/freeholder-bank-rma80-populated-clone-v11.json`.

The narrow source repair uses notification topic `return.refund_needs_attention`
and renames only its two translation keys in each of the four locales. Actual
timeline/emitted event names, money, SQL and the original oracle remain
unchanged. Source qualification and unchanged RMA AFTER remain pending.
