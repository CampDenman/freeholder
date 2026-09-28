<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Provider recording erasure (C1.08 / C3.13)

The implemented flow documented below is the in-tree Daily adapter's: the
Daily adapter remains as optional non-first-party code, while the de-facto
first-party provider is paradisemodern's Paradise Comms (owner decision
2026-09-27), whose recording-delete API is not shipped yet (see the
PM-path note at the end).

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

Verified recordings are also copied into the owner's configured storage (see
`deploy/first-party-plugins.md`). A second worker, `voiceVideo.eraseImportedCopies`,
deletes those owner-storage copies — recording and transcript objects — before
the same privacy task acknowledges. It waits out any in-flight import lease,
and an absent object counts as already erased, so retries converge.

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
jobs**. Inspect `voiceVideo.eraseProviderRecordings` and
`voiceVideo.eraseImportedCopies` using the job IDs in
the receipt. Fix the reported configuration, identity, or provider failure, then
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
and pruning against PostgreSQL. `tests/core/daily-import.test.ts` checks the
owner-storage import (automatic copy after verified capture, content-addressed
retry idempotency, failure visibility) and that contact erasure deletes the
imported copies, that retention holds protect them, and that a storage outage
keeps the receipt pending until the retry succeeds. These are implementation
checks, not live provider acceptance or independent review.

The implementation follows Daily's [recording deletion API](https://docs.daily.co/reference/rest-api/recordings/delete-recording)
and [transcript deletion API](https://docs.daily.co/reference/rest-api/transcripts/delete-transcript),
using the [recording inventory](https://docs.daily.co/reference/rest-api/recordings/list-recordings)
and [transcript inventory](https://docs.daily.co/reference/rest-api/transcripts/list-transcripts).
Live acceptance must verify deletion and delayed processing with the configured
Daily account. Provider telemetry, backups, expired room metadata, and copies
the owner exported outside Freeholder are not independently erased or verified
by these workers.
Owner-storage import is implemented (see above); live provider acceptance
remains open in C3.13.

## Paradise Comms (first-party) path — pending PM recording-delete API

The de-facto first-party voice/video provider is paradisemodern's Paradise
Comms (owner decision 2026-09-27): prod `https://paradisemodern.com/v1`,
per-site `x-api-key` or legacy portfolio bearer tokens. PM has **no recording
list/get/delete or erasure API yet** — recordings land in DigitalOcean Spaces
and the read/delete endpoints are PM-side work items. Provider-side erasure
of PM recordings therefore lands with PM's recording-delete API; until then
erasure covers local rows and the owner-storage copies, and the privacy
receipt must name the un-erased provider recordings instead of claiming
completion. Contact erasure still queues the local-row removal and the
owner-storage copy deletion on the same receipt, so the local half of the
obligation is met and the provider half is visibly pending. The Daily-based
flow documented above remains implemented for the in-tree Daily adapter.
