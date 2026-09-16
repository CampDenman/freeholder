<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Provider recording erasure (C1.08 / C3.13)

A verified contact erasure commits cleanup jobs in the same database transaction
that removes local Daily room and artifact rows. The privacy receipt lists the
pending job IDs. The request stays **In progress**, with no completion timestamp,
until every registered task acknowledges. A provider failure does not become a
successful erasure. Repeating fulfillment returns the existing pending receipt.

Daily workers verify the original account domain and room identity, expire the
room, eject participants, and verify empty presence. They delete finished room
recordings and transcripts, then check the inventory again. Processing media,
identity mismatches, incomplete pagination, and provider errors keep the task
pending. Cleanup waits for any previously claimed room operation's lease to
expire before starting. Already absent recordings and deleted transcripts are safe to retry.
The expired provider room remains available for identity verification on retry.

Recording and attendance retention holds also preserve the parent room before
its cascading deletion can run. Holds must be recorded before fulfillment.
Cancellation, denial, and retention edits cannot reverse erasure already in
progress, so these operations refuse while provider work remains pending.

## Recover interrupted work

Keep the voice/video plugin and job worker enabled. Keep the original Daily
domain and credentials configured until cleanup finishes; changing the domain
cannot redirect a queued deletion into another account. Jobs retain only the
request and provider identifiers needed for cleanup, not contact names or
transcript text.

The privacy request screen links staff with platform access to **Background
jobs**. Inspect `voiceVideo.eraseProviderRecordings` using the job IDs in the
receipt. Fix the reported configuration, identity, or provider failure, then
retry the same job. Automatic retries back off for up to 40 retries; exhausted
or cancelled jobs leave the privacy request pending for operator recovery.
Dead-letter redrive preserves the original receipt task ID in its payload even
though the queue assigns a new execution ID. Pending receipts are excluded from
artifact-expiry pruning. Do not replace a
pending receipt or manually mark its request complete to bypass failed work.

## Evidence and limits

`tests/core/daily-adapter.test.ts` checks deletion, identity refusal, pagination,
and lost responses with HTTP doubles. `tests/core/deferred-erasure.test.ts`
checks committed queue payloads, failure/retry, receipt completion, retention,
and pruning against PostgreSQL. These are implementation checks, not live
provider acceptance or independent review.

The implementation follows Daily's [recording deletion API](https://docs.daily.co/reference/rest-api/recordings/delete-recording)
and [transcript deletion API](https://docs.daily.co/reference/rest-api/transcripts/delete-transcript),
using the [recording inventory](https://docs.daily.co/reference/rest-api/recordings/list-recordings)
and [transcript inventory](https://docs.daily.co/reference/rest-api/transcripts/list-transcripts).
Live acceptance must verify deletion and delayed processing with the configured
Daily account. Custom bucket copies, provider telemetry, backups, and expired
room metadata are not independently erased or verified by these workers.
Owner-storage import and live provider acceptance remain open in C3.13.
