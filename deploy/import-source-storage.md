<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Private import source storage (C3.22/C2.29/C11.10)

All source uploads require private storage. A reserved upload expires after
24 hours; limits remain 100 MiB per source and 4 MiB per chunk. The server
snapshots each input chunk, hashes it, and commits its digest and pending-object
ledger row before provider I/O. A received identical retry avoids another write;
different bytes require a new upload. Ambiguous provider failures retain their
ledger entry and can be retried without forgetting accepted bytes.

Expiry, replacement and preview acceptance schedule durable deletion through
the existing core job. Immediate deletion is a fast path. The existing orphan
sweep also recovers pending objects after the upload window. Active retained
archive ownership prevents either path from deleting original ZIP chunks.
Explicit release or expiry removes that protection; cleanup then retries the
exact derived keys. An outage never replaces a private source with public storage.

`src/core/import/retained-source.ts` exports `RetainedImportSource`,
`retainedImportSourceSchema`, `makeRetainedImportSource`,
`retainedSourceFromRun` and `readRetainedSourceChunk`. The descriptor is
`{runId,uploadId,revision,filename,bytes,chunkBytes,chunkDigests,expiresAt}`.
Its revision is a domain-separated SHA-256 of the ordered chunk manifest,
not the raw file digest; identical bytes have the same revision across uploads.
`checkpoint.retainedSource` owns the original bytes.
`checkpoint.archiveSource` binds that descriptor to the canonical preview digest.
Every read checks current run/upload/revision ownership, expiry, chunk count,
actual size and SHA-256, outside a service transaction. Preview acceptance
rechecks expiry after I/O. Published and rolled-back runs do not retain sources.

The archive adapter must release retention in the accepted commit transaction
and arrange durable cleanup; this foundation alone does not admit ZIP files or
complete archive imports. Existing text/WXR callers retain the same public
verbs. Private claim phases now mutate the ledger under the original actor and
public-parent authorization, with their import-run audit subject.

`tests/core/import-source-object-cleanup.test.ts` exercises real service/database
calls with a synthetic storage adapter: failed deletion, lost acknowledgement,
public-storage refusal, immutable retries, corrupted bytes, active retention
and expiry during I/O. These are local recovery proofs, not actual provider or
source-specific acceptance. Historical pre-fix uploads whose metadata and keys
were already forgotten require a private provider inventory; this change cannot
reconstruct those keys. Cross-target object-byte recovery and independent
security review remain open.

Peer review reproduced a delayed PUT completing after expiry had already removed
its pending row; a later sweep then missed the raw bytes. A private, original-
actor parent-bound post-I/O phase now restores the pending ledger and queues
cleanup after every attempted PUT, including lost acknowledgements. It commits
before an expired/replaced upload is refused, so error rollback cannot erase the
cleanup witness. Actual late success and late error controls cover this repair.

Every in-flight PUT also has a distinct durable attempt in
`checkpoint.sourceWrites`, including identical parallel writes. Cleanup preserves
its ledger witness while any attempt is unresolved, even after upload expiry or
terminal run status. A matching post-I/O phase clears only its own attempt. A
crash or unknown provider outcome must remain visible and pending: timeouts and
an absent object cannot prove cancellation. The owner must establish the actual
provider outcome before clearing an unresolved attempt during recovery; neither
cleanup nor privacy acknowledgement can infer that proof from elapsed time.
The source ledger bounds outstanding attempts to 100 per import and refuses new
writes until recovery makes room. This is a fail-closed recovery state, not a
claim that a hung provider request has been cancelled.

The merged reader-privacy window can refuse a pre-erasure WXR after parsing.
That typed refusal now releases only the matching rejected raw upload in a
private caller-authorized phase, committing durable deletion before rethrowing.
Its audit contains IDs, never the rejected preview. A protected-CI regression
first reproduced the keeper retaining those bytes; the repaired exact public
preview-key control proves immediate removal with the original agent audit and
continued CRM refusal. Other transient/stale-source conflicts do not release
retained archive/media ownership.

A separate actual control reproduced PUT rejection before a later provider
write: clearing the attempt on that error let expiry forget the key. The final
post-I/O phase clears only an acknowledged successful PUT; any error preserves
its exact attempt as `unknown`. Later identical success, an absent object or
elapsed time cannot settle a different unknown request. Those witnesses remain
visible for recovery and block byte-deletion/erasure acknowledgement until actual
provider completion or cancellation evidence exists. Unknown provider requests
are deliberately not garbage-collected as if their client error proved failure.

## Raw reader erasure receipts

All opaque reserved or retained original chunks join `imports.readerSources`, including reserved
keys whose provider write has not arrived yet. The reader-comment hold covers
these raw copies too. Local contact anonymization and parsed-cache cleanup do
not complete the receipt: a durable `core.eraseImportSourceObjects` task must
confirm deletion and absence on the original private storage. Provider errors,
a still-active source window and each unresolved writer keep the receipt in
progress. Recovery can redrive the same original task ID. No raw reader address,
body or arbitrary object key comes from the erasure request payload.

Upload reservation and chunk claims acquire the shared side of the existing
identity guard before reading the run. Multiple ordinary writers may proceed;
merge/erasure uses the exclusive side. Direct imported/public reader-comment
mutations use the same guard and reject an explicitly erased contact binding.
This prevents new raw sources or comments appearing after erasure has already
passed their scope. Actual before-failing controls cover both snapshot races.

`ServiceDef.auditInputFields` limits only the input evidence stored beside an
authorized operation; it cannot change caller, action, subject, permission or
transaction ownership. The global secret redactor still applies. Raw import
payloads/previews and reader-comment bodies are excluded prospectively. Erasure
also removes named historical content fields from the relevant import/comment
audit differences while preserving operation metadata. Actual source and CMS
comment audit regressions failed before the repair. A NUL-containing private
input control verifies the handler receives its real input while audit stores
only permitted metadata. Stored article/page/media recovery ownership remains.

The receipt/guard proof is local with synthetic private storage. Independent
security review, historical provider inventory and final cross-target object
recovery still require actual evidence; C2.29/C3.22/C11.10 are not closed here.

Explicit reader holds also protect the current original file from normal expiry,
replacement cleanup and rollback. The privacy hold branch invokes an optional
registered source `retain` callback in the same real transaction. Imports binds
only existing upload IDs to that actual request/exception. The keeper consults
the current exception before deletion, ahead of ordinary terminal/expiry checks;
removal or expiry releases that protection. Later uploads are not held by an old
nonce. Three actual future-sweep failures reproduced lost held bytes; preservation,
replacement isolation and removal are covered by
`tests/core/import-source-hold-retention.test.ts`. Internal request/exception
bindings remain in the database and are excluded from every public import
run/list DTO; an exact source-only key regression exercises that boundary.

After the payment-customer privacy repair merged, main integration retained its
universal pending/missing-receipt guard and this source's hold callback. The only
merge conflict was the four-language pending help text, now covering payment
customers, recordings, transcripts and stored files together. A fresh isolated
database run passed 43 source/hold/audit/provider checks across six files; all
fast gates passed (368 contracts with one deliberate skip). These are combined
source checks, not independent sign-off or live-provider acceptance.
