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
