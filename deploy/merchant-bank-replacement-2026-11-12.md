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

Qualification is pending: full types, changed-file lint, finite authentication
and private/audit controls, actual generic replacement and RMA credit/resource
convergence, late positives, stale reads, caller barriers and populated history.
Historical legacy bank recovery is also required and remains unfinished; no
new platform, request, invoice or causal history is backfilled for old refunds.
No browser, SDK, provider-account, stable or full-spec acceptance is claimed.
