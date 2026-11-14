<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original ordinary upload binding — source checkpoint, 2026-11-14

C1.12/C11.08. Predecessor is immutable `0ca7c3eef88ef9c993dbde60c77f3d260fbf6dd0`.
This child performed SOURCE ONLY edits and byte inventory. Compiler, lint,
parser, migration, model parity, pure/native/TCP tests, hooks, provider/operator
acceptance and release gates are UNRUN. Neither media capability is published.
This is not independent security review, an incident report or completion.

The genuine producer is `beginUploadApply` inside the existing guarded shared
service. It locks contact identity, checks the actual actor and original owner,
then inserts the upload BEFORE its staged pointer and optional multipart
reservation in the same transaction. Both new rows receive one explicit UUID.
No provisional NULL birth may commit; deferred validation checks both actual
rows and actual transaction birth time, key, MIME and owner. The upload UUID
survives deletion of the temporary pointer. Image derivatives keep separate
reservation UUIDs with the same immutable upload FK and separate first-scope
and physical proof; equal keys never link generations.

Schema delta: exactly one nullable UUID/no default/no backfill column
`media_uploads.original_reservation_id`, one partial unique
`media_uploads_original_reservation_idx` (non-NULL rows), no FK to a deletable
pointer, no new models/public or private services/jobs/capability names.
Old rows retain NULL forever, even UPDATE. No birth migration UPDATE or volatile
ADD DEFAULT is used. Existing real surviving FK plus authenticated first pointer
witness can be read conservatively for legacy recovery; this leaf does not
reduce legacy ordinary rows after losing their last immutable link. Their debt
is explicit. It does not replace the idle multipart certificate consumer.

Exactly four new SQL function headers:

- `freeholder_media_upload_reservation_guard() RETURNS trigger`
- `freeholder_media_upload_reservation_birth_complete_guard() RETURNS trigger`
- `freeholder_media_upload_original_erasure_ready(original_upload uuid,original_request uuid) RETURNS boolean`
- `freeholder_media_upload_terminal_custody(original_upload uuid) RETURNS boolean`

Exactly two new trigger identities: `media_upload_original_reservation`
(BEFORE INSERT/UPDATE/DELETE) and `media_upload_original_birth_complete`
(AFTER INSERT, DEFERRABLE INITIALLY DEFERRED). Four full existing continuations:
`freeholder_media_original_scope_contains(jsonb,uuid)`,
`freeholder_media_original_reservation_guard()`,
`freeholder_media_original_scope_complete_guard()` and
`freeholder_media_original_scope_guard()`. Whole previous 897790-byte owned82
prefix is retained. Root alone assembles normal82 and qualifies a NEW database.

Future upload members may contain optional `reservationId` and `keyDigest`.
Parsing adds no default and rewrites no historical JSON. The witness remains
on the WHOLE actual row; no new NULL projection is discarded to preserve an
old hash. A raw key is digested once at genuine first capture. A retained marker
cannot supply a digest. A repeated new verified request can reuse the first
tuple only from agreeing complete captures and intact original receipts for
the precise historical subject. Existing contact privacy history and merge/undo
ownership classify every relevant boundary; mixed or unknown ownership keeps
opaque debt. No email, current contact, latest timestamp, equal key or missing
artifact becomes authority. Old captures and original receipts stay unchanged.

`original-upload-privacy.ts` requires this exact first membership plus the actual
request, installed full ABI, all mandatory birth/admission fences, holds and
complete ordinary physical proof. Unwritten is permitted only for a genuine
new mandatory guarded birth with no original caller/request/copy/quota debt;
UUID or missing receipt alone is insufficient. Every actually linked derivative
must independently be first-captured and retired or genuinely unwritten.
Existing `original-provider-minimization.ts` performs exact token-bound quota
and physical metadata reduction unchanged. No raw key-based deletion, new
provider request or remote multipart terminal inference is added. The UUID and
first digest stay, and missing rows or unknown NULL ancestry remain pending.

`original-upload-retention.ts` preserves the thirty-day terminal policy without
pretending an expired intake row proves byte erasure. Actual DB time and full
ordinary proxy custody (or genuine physical retirement), ownership, holds and
quota-token agreement are required. Only filename/provenance/media metadata/
failure details are reduced. Original owner, actor, UUID, asset FK and necessary
private locator remain for live custody and future capture. The existing cleanup
`prunedSessions` count now counts actual redundant metadata reductions rather
than deleted proof rows. Future scan time cannot manufacture age or custody.
Unknown, held, direct multipart or unverified legacy rows keep necessary raw
recovery evidence and truthful debt; no new no-TTL optout or fake purge coverage.

Prepared controls (all UNRUN): eight pure capture-domain controls, three genuine
shared CUSTOMER upload/abort/retention service controls with fictional private
TCP provider and no I/O, plus two genuine verified-erasure/repeated-request
controls explicitly dependent on the real complete request ABI. No fixture ABI
publisher, fake ServiceContext or synthetic positive provider receipt is used.
The independently corrected CUSTOMER/confirmation/hold setup at `72bb97f6`
is a separate immutable fixture leaf, to be normal-merged by root.

Required qualification before activation includes strict new-column/default/
index/deferred-trigger parity; a populated old-NULL upgrade with later UPDATE
still NULL; actual incomplete same-TX birth rollback; attempted UUID/FK rebind;
disabled mandatory fence refusal; exact derivative first-scope and live caller/
quota/hold refusal; genuine written ordinary conditional retirement before
metadata reduction; real thirty-day live-custody reduction preserving bytes;
and ambiguous/corrupt/mixed-subject repeated requests. Existing safe physical
reducer/write-ledger and all predecessor oracle bodies are byte-identical.
Actual request/part capability activation requires the full remaining protocol,
not this checkpoint. Legacy recovery, issued-URL terminal/provider proof,
capture/quota/cutover and external operator/security acceptance remain open.
