<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Reader privacy during imports

MASTER.md C2.29/C3.22/C11.10 remain open. This is source repair and local
qualification, not an independent review, deployed-data audit or live-source
cutover acceptance.

Actual PostgreSQL regressions reproduced four failures: acknowledged erasure
left reader details in an import preview; queued replacement cutover recreated
an erased contact/comment; an opaque upload parsed after erasure reintroduced
its old reader input; and changing an existing reader's address before erasure
let a pending comment create their old contact again.

Reader previews and pending replacement comments now participate in the shared
contact privacy registry. Export includes only the subject's reader entries.
Erasure removes their name, email and comment together, preserving article text,
other readers and page/media recovery ownership. Existing readers bind to their
unified contact ID when staged; contact merge and conflict-checked undo repoint
those JSON references. Publication reuses that contact even after an address
change. Import run/list responses strip those internal CRM bindings, including
for exact source-preview keys that cannot read contacts. The private ledger
retains them for erasure. Active merge history, the subject's own recorded address changes and exact
imported-comment references provide
matching for older cached input. Previewing does not create new CRM contacts.

Commit releases redundant preview reader copies. Pending replacement comments
remain private until cutover and stay subject to erasure. Rollback discards their
pending input. Commit, publication and erasure lock the same import run. A merge
that encounters an active import refuses with a retry message instead of waiting
while it holds contacts needed by the publisher. Both snapshot and repoint use
this refusal, including a new run created between those phases. Audit export
and erasure follow the same active merged identity. Payload cleanup preserves
the existing actor-anonymization policy and does not reassign historical actions
or subject IDs. Undone
merges keep the other person separate. Scoped reader-comment legal
holds also retain their cached source scope and report partial erasure.

Unparsed uploads cannot yet be matched to a contact. If erasure completes after
an upload was reserved, staging a file containing reader comments refuses and
deletes its private chunks. Review the source and start a fresh upload; the
service never reconstructs an erased identity from it.

Migration 0069 must follow reserved migration 0068, including journal timestamp
order. It removes redundant legacy terminal copies. A pre-protection source
that overlaps an acknowledged erasure cannot recover that person's former
identity from the erased CRM: its cached reader input is removed, its run is
marked for review, and both queued commit and publication refuse. Page/media
ownership and rollback remain intact. Roll back the run, review the owner's
source for erased readers, and start a new import. Active named reader holds
are excluded from that ambiguous-source cleanup. The SQL guard also refuses
cutover from the immediately previous image, which cannot interpret the flag;
this compatibility change is explicitly marked schema-breaking. Recovery must
respect already acknowledged erasures before anything becomes public again.

The final integrated PostgreSQL/native run passed 62 checks, including the
independently reviewable contact-history repair in PR #662, reader-source privacy,
merge/undo, exact import-key boundaries and all eight SDK checks. Production build
and artifact scrub passed: 19,423 files and 237,159,757 bytes. Type, lint, license,
plan and all 368 contract checks passed (one deliberate contract exclusion).
The contact-history dependency and migration 0068 are merged. A fresh database
with contiguous migrations through 0069 passes another 44 source, contact-lineage,
exact-key and SDK controls. Migration 0069 retains journal order. Protected PR
qualification remains required. No new browser surface is introduced; existing
owner forms and HTTP/MCP use the same shared mutations and original actor audit.

A separate actual reproduction after this parsed-cache repair found an erasure
receipt can complete while an opaque original WXR still contains reader data.
The retained-source cleanup follow-up must make that receipt wait for confirmed
provider cleanup. This increment does not claim full raw-object erasure or close
C2.29/C11.10.
