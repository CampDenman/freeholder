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

Qualification remains pending for actual generic replacement and RMA credit/resource
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
remain unexecuted. The paused-caller fixture is being strengthened separately
to commit the real ACK and raw positive first, then hold only the actual
physical caller's promise before its finish receipt.
