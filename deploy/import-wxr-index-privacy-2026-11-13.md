<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original WordPress index erasure containment

C1.08/C3.47/C11.14 remain open. Protected main `81271622` product was tested
with test-only `f1b5d6a3` in an isolated ordinary schema 0–79 database. The
original full-erasure oracle is preserved on that commit in
`tests/core/import-wxr-index-erasure.test.ts`; it is not the containment test.

The real owner session uploaded and indexed a 501-entry synthetic WXR. Its
private marker appeared in an unaccepted entry title and an image plan. No
plan digest, child batch or accepted asset existed. The actual contact
verification, fulfilment, durable worker UUID and original storage receipts
were used. Only Date advanced beyond the actual captured private window,
after every original PUT had settled; timers and physical I/O remained real.
The test failed its final metadata-absence assertion after 5.656845 seconds.

Independent readback confirmed a completed request, `imports.readerSources`
reported erased with zero pending jobs, an invalidated graph, 501 entries,
one marked entry and one marked media plan, and no marked media key. The
original PUT and DELETE were accepted and its physical chunk was absent.
The populated failure and a separate golden clone have matching counts and
SHA-256 for 12 tables, the entire 80-entry journal, and the public/drizzle
schema (4,972 columns and 2,057 constraints). Deleted bytes are not claimed
as preserved. These synthetic local diagnostics are retained outside the
repository; neither database may be migrated or reset.

The no-DDL containment adds a private registered system service. It verifies
the exact retained queue payload and intact verified pending receipt, locks
the privacy identity/request and owning import runs, checks the existing
upload-bound retention exceptions, and acknowledges the task through the
shared privacy service in the same transaction. An unaccepted normalized
graph conservatively requires explicit recovery. The worker refuses only
after that recovery state commits. It does not edit immutable graph rows,
claim safe cleanup from expiry, adopt a later generation, or create tasks.

The candidate has a separate 501-entry containment oracle: raw bytes must be
absent while the same task remains pending, fulfilment time stays NULL,
resolution names index recovery, and private metadata is still acknowledged
as present. The original full-erasure oracle is preserved unchanged on the
before branch for the future guarded minimization proof. Source and native
qualification of containment are pending. Full normalized minimization,
accepted/held negative controls and historical completed-receipt recovery
remain required before stable readiness.
