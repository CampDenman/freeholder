<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Revision-bound transfer transport — 2026-11-12

C11.08 remains open. The existing transfer provider factories expose two
additional primitives: readVersioned and deleteVersioned. Existing copyManifestObjects
and the CLI continue to call only GET/create-only PUT. No source cleanup
command, adoption service, erasure authority or actual provider acceptance
is enabled by this source checkpoint.

Each revision binds the actual provider namespace, exact key and opaque
provider revision. S3 captures the strong ETag from its successful GET and
uses If-Match on DELETE. The value is a concurrency condition, never a content
checksum. Replit uses its explicit original bucket and official Google SDK,
reads the body by the metadata's exact generation, and deletes with that same
string precondition. A pinned-body failure is not current-object absence;
403/unknown reads never authorize cleanup. Missing/weak/foreign revisions and
412/unsupported preconditions stop; no unconditional retry exists. Provider
retry is disabled for these Google client operations. Private provider errors
are reduced to stable stage/status messages.

Contracts verified against official primary documentation:
[S3 conditional deletes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-deletes.html),
[Cloud Storage preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions),
[Cloud Storage delete](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/delete).

Full Node22 types and focused lint pass. All21 factory/adjacent controls pass
in `/tmp/freeholder-transfer82-versioned-after.json` (11 new revision tests,
7 existing create-only and3 existing Replit-read controls). They exercise the
actual factories with intercepted HTTP/SDK provider edges, including newer
writer preservation and exact generations beyond JavaScript's safe integer
range. No real account request ran. The earlier combined36-control source
batch also included4 hook and11 original-witness controls; counts are not
combined into native/provider acceptance.

Complete source-writer quiescence, both full SHA-256 byte proofs, active-target
adoption, contact/hold/erasure authority, actual caller lifecycle, quota,
durable cleanup jobs and owner/API surfaces remain required. Source cleanup
must use the real protocol's exact admission, not these raw primitives as
standalone authority. No82 SQL/journal or cross-target closure is supplied.
