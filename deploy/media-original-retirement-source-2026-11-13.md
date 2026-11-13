<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original ordinary media retirement — source checkpoint

This checkpoint is source only. No compiler, lint, parser, tests, database,
provider account or network operation was run for it. It does not enable the
unpublished original-request capability, close C1.12/C11.08, or establish actual
provider support. Root owns assembly of the separate unapplied82 tail and every
new-database qualification. Existing migration/failed-database evidence and
native controls are preserved.

The existing internal `deleteWithReceipt` cleanup path now delegates ordinary
objects to `original-retirement.ts`. It retains the existing transfer-lineage
path first. The ordinary path requires one intact accepted PUT with a non-NULL
original reservation UUID, its actual original logical and physical finishes,
and its exact first provider revision. Current key equality, a 404, elapsed
time, a human assertion or an empty inventory cannot supply missing birth or
stop proof. Historical NULLs, multiple generations, any multipart ancestry,
transfer membership, a live owning reference or named hold remain pending.

The claim commits a separate UUID-bound DELETE receipt and authentic
server-held logical caller before any provider I/O. This fences future ordinary
PUT and new multipart-resource births for that reservation. It never restarts
an earlier admitted caller. An already returned DELETE can be followed by fresh
verification, without another DELETE. An interrupted or ambiguous earlier
writer remains pending for exact recovery.

Production I/O uses `configuredOriginalRequestStore` and its existing accounted
S3/Replit protocol, resolved only from the exact configured private resource.
Captured adapters cannot substitute another binding. No provider I/O occurs in
a transaction. If the original object is present, the path first performs a
fresh pinned full-body SHA-256/length/read and verifies the original physical
request nonce. Two complete matching configuration/object/version/session
(or Replit retained-generation) inventories must prove only the original
resource at that key before a conditional DELETE can be admitted. The actual
physical admission rechecks ownership, named holds, generation, complete fresh
proof and that no physical DELETE was admitted for that caller before.

The authentic DELETE return and physical ACK/finish commit independently of
later local application. A later inventory/quota/hold refusal cannot roll them
back. If the object was already absent, the actual owning closure returns
`notAttempted`; no fabricated acceptance or additional DELETE is recorded.
After the caller finishes, a fresh pinned absence read and two complete,
matching physical inventories must show no original-key object, retained
version, soft-deleted resource, delete marker or upload session. The SQL proof
checks both page chains and actual page/request finishes. Only then can the two
exact original-UUID receipts gain `deleted_at`, the pending pointer be removed,
and that original caller's quota token release charged bytes. Its quota token
and raw locator remain for the separate privacy minimizer; another equal-key
charge is never adopted or released.

The immutable first erasure capture is unchanged. A newly admitted DELETE is
appended to the existing actual original cohort through its existing late
member mechanism. The existing original-reservation retirement predicate gains
an ordinary branch using the new physical proof, so the existing original
provider minimizer can subsequently apply its exact token/lineage rules.
First descriptors, request/fact digests, original bytes, first return and
receipt identities are never replaced by a later observation.

## Source contract

No table, column, model, FK, index or public service/API/MCP/SDK signature is
added. All142 model identities remain unchanged. Four new SQL functions and
two new triggers live only in the owned unapplied tail:

- `freeholder_media_original_absence_inventory_complete(uuid)` — complete
  original retirement inventories, both full page chains, actual page finishes
  and no original-key physical member.
- `freeholder_media_ordinary_retirement_proven(uuid)` — exact standalone
  original family, no other generation/copy/session/hold, actual caller and
  request finishes, returned conditional-delete or genuine unattempted caller,
  and the exact fresh absence inventory.
- `freeholder_media_ordinary_delete_request_guard()` and
  `media_ordinary_delete_request` — fresh original nonce/body/inventory and
  hold/lineage recheck before the actual conditional request; no duplicate
  physical dispatch.
- `freeholder_media_ordinary_retirement_guard()` and
  `media_ordinary_retirement` — refuse standalone `deleted_at` without that
  actual complete proof, including legacy NULL births.

Existing original inventory evidence accepts the new ordinary retirement
purpose under exact pinned absence evidence; its freshly verified human
recovery wrappers retain their existing authorization and recovery-only
surface. Internal shared lifecycle functions do not fabricate a person or a
ServiceContext. Existing transfer proof, empty first-scope metadata authority,
full I/O gate, first-capture immutability and old controls remain intact.

## Prepared controls, all unrun

`tests/core/media-original-retirement-proof.test.ts` declares16 pure cases:
valid exact proof; paused logical writer despite404/empty listing; missing
physical PUT finish; missing original admission; hidden second mutation;
foreign namespace/key/revision; unfinished/unknown/non-absent read; unpinned
read/missing actual absence fact; missing physical absence finish; corrupt
original/read descriptor; retained version; soft-deleted retained bytes;
retained session; delete marker; changing inventory/configuration; unrelated
foreign resources preserved.

`tests/core/media-original-retirement-lifecycle.test.ts` declares six native
cases using a new fictional private TCP provider helper. They exercise the
real shared infrastructure and durable requests, not mocked authorization or
fabricated service contexts: positive conditional retirement; real logical404
with retained physical version bytes; real logical404 with retained upload
session bytes; actually paused admitted PUT followed by its genuine late PUT
and finish; an actual named privacy hold preserving an unknown-owner original;
and actual successful DELETE followed by an interrupted inventory, then fresh
verification with exactly one total DELETE. The new fixture retains the actual
PUT bodies in its separate retained-version/session maps. It preserves all
existing provider helpers and native oracles unchanged.

These six native cases explicitly require the complete future request
capability. Their setup refuses its absence and never creates a test-only
capability. They are not evidence of a passing ordinary-media lifecycle today.

## Remaining implementation and acceptance

The first path requires actual retained finishes. Exact tracked-crash executor
stop review, failed/unknown DELETE review, safe new admission after a genuinely
unattempted preflight, multipart create/complete/abort recovery and retirement,
quota initialization/release recovery, pinned-read/cutover integration and
translated owner recovery remain required. Linux/systemd witnesses must stay
an optional strong path for legacy/untracked cohorts; complete new tracked
cohorts cannot acquire an unnecessary Linux requirement. Provider-specific
historical version/session provenance that cannot be proved remains explicit
debt, never an equal-key adoption or invented historical birth.

Current source qualification, SQL parsing, fresh normal migration, strict model
and function/trigger parity, all affected native cases with independent
journal/profile/client-drain proof, actual provider/platform/account acceptance,
final-candidate recovery and independent security review remain open.
