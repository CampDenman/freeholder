<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original merchant fee dispatch admission (C5.19/C12.38)

The actual shared-service/Stripe-factory control at `64347385` failed in 7.261s
on normal v9 / SQL `958226930359c22a7997aa025186f28c071b2a3ecd45cc5c34acfc43dce2c144`.
A real caller paused immediately before its dispatch transition; a second real
caller completed that same original fee operation. When the first resumed, the
terminal idempotent-return branch bypassed the dispatch-status refusal, and its
orchestrator performed another POST.

The owned HTTP backend retained the original key for 24 hours, then pruned it
under a Date-only simulated 25-hour clock advance. This models the documented
[Stripe API v1 idempotency lifetime](https://docs.stripe.com/api/idempotent_requests):
keys may be pruned after at least 24 hours, and reusing a pruned key creates a
new request. No actual provider account or real 25-hour wait was used. The first
provider refund and the second both fit the original 500-cent physical capacity;
provider capacity therefore does not enforce the intended 100-cent line refund.

Both real caller promises drained before the assertion. The HTTP edge accepted
two distinct 100-cent resources under one original key. Independent PostgreSQL
readback retained one accepted operation (`fr_feeRace1`), both bound 100-cent
observations (`fr_feeRace1` and `fr_feeRace2`), canonical retained target 400,
and the intact 1,200-cent customer refund and credit on its 5,400-cent payment.
No client connection remained.

The actual populated failing database is preserved separately as
`freeholder_fee_stale80_populated_before_v9_test_20261112`. All eight original
money-table counts and SHA256 digests match its source snapshot; both physical
observations, original key and 81-entry SQL958 journal remain unchanged. The
original fixture, first type diagnostic, corrected source qualification, native
result, ledger and clone proof are preserved as
`/tmp/freeholder-stale-fee-dispatch-*`.

The minimal source repair checks dispatch eligibility before returning an
existing terminal result. Only an actually reserved operation can grant the
reserved-to-dispatching transition. Terminal reconciliation stays idempotent,
while a paused dispatch caller receives the existing conflict before provider I/O.
No SQL, registered service, key, original money row or accepted history changes.

The repair at `4fda521b` passed full Node22 typechecking, changed-source lint,
actual614-note generation, three changelog controls and license/plan/note gates.
The byte-identical original fixture (SHA256
`8b10169f85c3992aec0d8397dc8a0d635ffd38d0a07c134ef8777321b3c7625b`)
then passed in6.609s on exact `72ac85e8` / normal v9 / unchanged SQL958. The
owned backend accepted only one100-cent resource under the original key even
after its modeled expiry; independent readback found one accepted operation,
one bound physical observation and the intact customer refund/credit1200.
All caller work and database clients drained. Logs and ledger are preserved as
`/tmp/freeholder-stale-fee-dispatch-after-*`; the actual populated BEFORE clone
remains unchanged and has not been migrated or used for this resettable AFTER.

Historical excess money requires review; this source correction does not
rewrite or automatically recover it. A dedicated non-resetting review at
`4c4de105` passed in0.399s on that exact old clone: actual factory inspection
reported200 returned, reconciliation required review and commission debt, and
no POST occurred. Both original observations, the one original accepted row,
and all eight original money-table golden hashes/counts remained unchanged
against clone creation, before and after the test; the81-entry SQL958 journal
and empty client set were independently verified. The test's explicit history
flag and clone-name guard prevent it from running on a resettable fixture.
Logs and golden proofs are `/tmp/freeholder-stale-fee-history-*`.

Whole current-source integration remains outstanding. Full C12.38, provider
acceptance, independent review and stable sign-off remain open.
