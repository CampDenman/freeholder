<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Historical NULL upload anchors — source only, 2026-11-14

C1.12/C11.08. Isolated descendant of `361611af587bef47238b51bccf6c641478e2773f`.
No compiler, lint, SQL parser, migration, model parity, pure/native/TCP tests,
provider/operator actions or hooks ran. Root owns all qualification and normal82
assembly. Both capabilities remain unpublished; no security/stable/C closure.

Exactly the reviewed inventory: ZERO models, columns, indexes, checks, FKs,
trigger identities, public/private services, jobs or capability names. One
optional future upload-member `legacyAnchor` contains six safe actual UUID/
digest cells: requestId, captureDigest, reservationId, keyDigest, pointerWitness,
uploadWitness. Canonical originalReservationId remains NULL forever. Old JSON
parsing has no defaults and old witnesses/captures/receipts remain unchanged.
The whole 942079-byte /18ab087c owned82 predecessor is retained exactly.

Two new scalar SQL headers:

- `freeholder_media_upload_legacy_capture_anchor(original_upload uuid,original_request uuid) RETURNS jsonb`
- `freeholder_media_upload_legacy_original_erasure_ready(original_upload uuid,original_request uuid) RETURNS boolean`

Six full existing continuations:

- `freeholder_media_original_scope_contains(first_membership jsonb,reservation uuid) RETURNS boolean`
- `freeholder_media_original_scope_guard() RETURNS trigger`
- `freeholder_media_original_scope_complete_guard() RETURNS trigger`
- `freeholder_media_original_reservation_guard() RETURNS trigger`
- `freeholder_media_upload_original_erasure_ready(original_upload uuid,original_request uuid) RETURNS boolean`
- `freeholder_media_upload_reservation_guard() RETURNS trigger`

A new anchor requires an intact complete EARLIER capture and intact original
receipt whose exact recorded subject belongs wholly to the current subject
through the existing merge/undo ownership history. Every relevant capture must
agree, with no newest-row selection. Its captured primary pointer reservation/
key/witness must equal the actual surviving primary pointer and real upload FK.
An absent or changed pointer cannot create an anchor. Old pointer-FK rebinding
is now refused after original first capture. Existing actual resource-FK idle
multipart recovery stays separate.

The SQL full JavaScript pointer witness encodes all ELEVEN actual Drizzle row
fields: key, reservationId, ownerContactId, assetId, uploadId, role, state, bytes,
contentType, createdAt and updatedAt. Nullable cells remain present, bytes must
be JS-safe integers, Dates are UTC ISO milliseconds. This is the EXISTING full
pointer domain. The actual SQL result MUST native-equal transferDigest(actual
old Drizzle pointer) before qualification. The historical uploadWitness is read
literally from the authenticated old member; it is never rehashed or compared
to a current projection across the newly added NULL upload column. A NEW
capture's current witness still covers its whole actual new row.

Binding alone grants no remote authority. An actual original ordinary PUT,
original caller/runtime/physical request and existing full physical retirement
proof are required even to derive an anchor. Metadata reduction additionally
checks the exact new first membership, current original/copy/caller/inventory
frontier, named holds, namespace and quota-token proof. No unwritten legacy
branch exists. Missing original caller, empty listing, HEAD404, elapsed time,
owner text, equal key/email or a marker never proves it. No extra DELETE or
canonical raw locator/UUID refill occurs. Existing safe ordinary physical
reducer/write-ledger and every predecessor oracle remain byte-identical.

After genuine reduction removes the pointer, its already guarded immutable
first safe anchor retains the original mapping. Current proof revalidates its
actual referenced earlier capture/receipt and full physical state. A later
request can reuse only agreeing complete anchors; late facts or holds still
invalidate current entitlement while historical literal evidence remains.
A certificate/anchor never authorizes signing, PUT, multipart completion,
transfer, quota release by key or remote issued-URL terminal authority.

Eight pure shape/domain controls and seven genuine upgrade/native controls are
PREPARED/UNRUN. The latter require an explicit UUID-only manifest from ROOT's
actual frozen PRE-COLUMN producer -> NEW normal-upgrade exercise. They NEVER
seed positive SQL history, invent a ServiceContext or publish an ABI. Each
named native case consumes its OWN preserved old-to-new cohort. The native
pointer-domain prerequisite must run first. Two adversarial SQL insert controls
exercise real current runtime/fences with forged witness/reservation, not
positive fabricated evidence. The successful reduction control checks unchanged
original receipt/capture and unchanged physical request IDs/first FIN/stop/
token/descriptor digests; raw metadata may reduce legitimately.

Reachability matters: privacy.fulfillDataRequest refuses a second fulfillment
while an old applied request remains in_progress, and cancelMyDataRequest
correctly refuses pending provider work. This leaf changes neither rule. The
planned reachable old fixture uses an actual named hold at INITIAL old
fulfillment so captureRetention seals the old first capture with a terminal
retained/partially_completed receipt; actual public hold removal and genuine
physical retirement precede a new independently verified request. All related
source outcomes must really be terminal. If actual old producer/capture/hold
contracts cannot reach that state, ROOT preserves and classifies the FIRST
failure; no hold SQL, fake completed receipt or guard bypass supplies it.

When authentic first identity cannot be established, the owner's choices are
preserving pending recovery evidence or restoring exact original proof through
their own controlled backup process. A consent checkbox cannot invent lineage.
Unknown/unwritten legacy stays pending. Raw minimization and 30-day legacy
custody remain conservative; no new optout or claim of complete erasure support.

Required next evidence includes actual old producer/retained capture reachability,
normal-upgrade NULL immutability, SQL/Drizzle whole-pointer equality, genuine
conditional retirement, actual worker/repeated request, mixed-subject history,
conflicting old snapshots, paused/late caller and quota/hold controls. Issued
URL terminal/provider semantics, capture, quota initialization/release, cutover,
actual external provider/operator/security and final completion remain open.
