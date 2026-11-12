<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original uploaded-source hold capture

This is a scoped privacy repair record. It does not establish release, provider,
independent security review, or complete live-crawl acceptance.

## Actual enabled-path failure

Test-only checkpoint `c9b85c00` ran against unchanged protected main
`a2e503fe6fed3c6c8bbfc3249b5535f939ad6c24`, with the ordinary migration prefix
through 79. The fixture uploaded actual private WXR bytes through the shared
import services, created a submitted erasure request, and added a real
`cms.readerComments` exception before request verification. Import rollback
followed by the shared object cleanup deleted those original bytes.

The selected native case failed in 10.40 seconds. Read-only classification found
one actual named exception, zero captured original upload nonces, one settled
physical DELETE receipt, and zero remaining reservations. Evidence is preserved
in `/tmp/freeholder-upload-main-pending-hold-before-native-one.log` and
`/tmp/freeholder-upload-main-pending-hold-before-classification.json`.

## Domain source checkpoint

Checkpoint `3f263cc8` moves original nonce capture into the real hold transaction.
It completes a normalized source capture receipt even when the actual first
membership is empty. Updates preserve that first membership. Fulfillment checks
the receipt and never recaptures later uploads. A historical missing receipt
remains review debt and stops cleanup; neither a timestamp nor a partial nonce
list proves a completed capture.

The imports pending-object callback uses the caller's actual transaction when
provided. The shared storage infrastructure must recheck ownership under its
real identity and object admission locks. A new hold also refuses an original
DELETE whose physical result is already unresolved: the hold cannot undo
provider work that was admitted before it.

This domain draft requires the separately owned shared helper, storage admission
change, and normalized receipt table in the unpublished migration 80. The draft
has not yet received compiler or native qualification. Its unchanged original
oracle and the added empty/renewal, release, and unresolved DELETE controls are
unrun against that integration. Existing before evidence and all earlier
qualified ZIP and reader artifacts remain preserved.

The local disposable test cluster uses `jit=off` and `fsync=on`; this is not a
default-JIT or provider deployment claim.
