<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Verified original media transfer lifecycle — source checkpoint

C1.12/C11.08 remain open. This isolated implementation starts at combined
`bab980add656e159643a21597ea274cb63d4d282`. It is an **unqualified, incomplete
source checkpoint**, not an integration-ready release or a provider acceptance.
No compiler, lint, test, build, install, PostgreSQL, provider or owner-account
operation was run while the root held the execution lane.

## Implemented source boundary

The shared first plan captures the complete bounded application inventory,
all original receipt membership/digests and original contact subjects. It does
not accept a caller-selected subset. Unknown namespaces, redacted or unresolved
receipts, active multipart resources, erased subjects, named holds and inventory
limits refuse. First request identity/resources/membership are immutable.

New ordinary PUT/DELETE and multipart admissions carry their actual writer
runtime birth, and record a finish only after the real provider promise
returns successfully. An early positive ACK is not a finish. Existing rows keep
NULL birth/finish: the proposed SQL never backfills history. Complete fully
tracked histories can claim without systemd. The namespace/object lock order
and cold/warm previous-writer SQL fences prevent new ordinary physical intents
from crossing the capture. An admitted unknown caller still blocks.

Legacy/untracked Linux cohorts have a separate root-operator executor,
`scripts/media-writer-drain.mjs`. Capture first commits the namespace fence,
then records the original kernel boot, systemd invocation, cgroup subtree and
PID/start-tick identities. The owner stops the service separately. Verify
requires the original processes absent, original cgroup subtree empty and the
unit inactive. It never issues stop, guesses from readiness, expires a caller,
or treats a timeout as proof. Unknown remote/uncaptured legacy writers remain
proof debt; other host/container executor witnesses remain to be supplied.

Each transfer provider invocation commits its own intent before I/O. The actual
server closure keeps an unexported random caller token. Its return/positive fact
commits independently of domain application. Unknown PUTs are not resent;
accepted source DELETEs are not repeated after an application failure. Existing
S3/Replit factories, create-only writes, revision conditions and CLI complete
byte-copy/SHA checks are reused. An occupied target is refused even when its
bytes happen to match: this plan has no original receipt for that occupant.

Complete source/target byte and revision proofs precede atomic adoption of all
logical objects. Existing logical keys resolve through the adopted physical
key for normal media, import, capture, gallery and social reads. Source
retirement requires fresh target bytes and the exact original source revision;
its ACK/absence receipts are separate. Source retirement deliberately leaves
the original PUT's `deleted_at` NULL while the copied bytes survive. Existing
import438 original-erasure predicates therefore cannot mistake moving bytes for
erasing them. First import captures/receipts are unchanged.

Target quota is reserved before physical PUT when quota mode is enabled;
unknown work retains its capacity. Successful byte verification settles the
reservation, and exact physical absence releases it. A hosted source cannot
silently omit the configured target quota/inventory.

Original transfer erasure source checks the owning logical reference, current
holds and every caller, conditionally removes both resources, verifies both
absences, then retires the original/copy witnesses. Target PUT receipts exist
before I/O and inherit existing exact erasure cohorts under the identity lock.
A late positive target return revokes original retirement and retains its
original token/lineage, rather than adopting a later unrelated generation.
Contact merge repoints only subject pointers and captures bounded full lineage
so changed transfer facts refuse undo. Pending copied keys remain owned.

## Still required in this same full-spec item

This checkpoint must not be qualified or integrated as a complete feature.
The following source obligations remain active, with no scope deferral:

- Complete transfer-specific privacy export/minimization registration and its
  immutable original request/job membership. Include inherited holds, both
  resources, every physical receipt/caller, and retention policy treatment.
- Register committed-observation and durable/periodic late-fact recovery back
  into the exact original media/import erasure scope. Preserve original438
  capture/receipt bytes. Prove copy-before/during-erasure, holds and late caller
  cases through real privacy services, including already minimized evidence.
- Complete fresh-human unknown-caller recovery, immutable review receipts and
  exact original stopped-process/provider evidence. Reads may establish proof;
  neither a timeout nor a current resource may authorize destructive retry.
- Finish owner UI/actions and all four locales; maintain real HTTP/MCP shared
  permissions/audit and regenerate the final combined SDK only in root's lane.
- Add bounded durable job contracts containing original plan/object/caller IDs,
  safe phase resumption and original job/request proof. Never auto-retry an
  uncertain physical mutation.
- Strengthen the owned SQL tail with complete adoption/retirement/first-member
  guards and final model/constraint/trigger parity. Root owns final assembly,
  journal entry, capability adoption and a genuinely new ordinary database.
- Finish review of all read consumers and the explicit private source/target
  configuration cutover. Keep original resources available for unfinished
  cleanup; never reveal/copy real owner credentials in chat or artifacts.

The unapplied SQL is `deploy/sql/0082_verified_media_transfer.unapplied.sql`.
No published0–81 SQL or journal entry was changed. The suffix name is an owned
assembly proposal, not authorization to apply migration82.

## Prepared controls, not executed

`tests/core/media-storage-transfer-proof.test.ts` declares six pure controls:
complete inventory refusal, complete byte/size comparison, strong exact S3
revision, opaque large Replit generation, outstanding-caller refusal and an ACK
that cannot stand in for a finished read.

`tests/core/media-storage-transfer-lifecycle.test.ts` declares five database
controls using actual shared services and a real TCP synthetic S3 provider:
copy/adopt/conditional-retire with original receipt unchanged; incomplete-plan
adoption refusal; identical occupied target preservation; lost PUT reply with
no automatic resend/adoption/delete; immutable first claim and denied actors
with no physical side effects. They are prepared only, not collected or run.
The fixture is fictional owned storage, not real provider/account acceptance,
HTTP/MCP ingress, independent security review or a cross-target restore.

All original pre-existing fixture bodies/proofs remain unchanged. Qualification
must stop on the first failure and preserve its database/evidence. Actual S3
and Replit acceptance, a final other-Tier1 original-byte restore/update/rollback
journey, C11.10 independent review and final release reconciliation remain open.
