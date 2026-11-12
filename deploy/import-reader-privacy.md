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

## Durable original-reader ownership follow-up

The local follow-up reserves `0078_import_reader_ownership.sql` after the
frozen 73–77 chain. It is intentionally not journalled while its predecessors
remain under composition. Isolated tests explicitly apply its source SQL;
that is not a contiguous upgrade rehearsal, deployment or completed C2.29.

Three actual shared-service before controls lost a known reader or rebound
their identical original comment to another contact after address change,
address reuse and merge undo. All three after controls passed in 38.97 seconds.
A second run passed real erasure/reimport fencing, a named reader hold and
exact normalized merge/undo for 1,001 reader receipts in 17.14 seconds. The
merge ledger holds a constant-size witness reference rather than another copy
of those reader identities. Explicit search/retention treatment covers the
current contact FK; historical before/after UUIDs are documented immutable
witness exclusions, owned by the same reader privacy source.

An additional real before control found two WordPress instances under one host
colliding when post/comment IDs overlapped. It failed in 7.86 seconds. The
current source scopes receipts to the original WXR site URL and preserves that
context for deferred cutover. A fresh v2 proof database then passed all four
context/owner controls in 28.81 seconds: distinct site instances, real verified
owner selection followed by actual comment commit, denial of properly scoped
agents/personal keys/stale verification, and source-only DTO privacy.

The next real boundary failed in 7.97 seconds: resolving the receipt to A
without projecting A into cached reader copies let the different email holder
B's erasure remove A's pending comment. Owner resolution now updates those
matching original-instance/post/comment pointers in the same transaction while
preserving source bodies and original executor metadata. That exact after
control passed in 8.48 seconds. Eleven distinct reader controls have passed
across these staged runs; they are not a final combined v2 qualification.

Previously unseen ambiguous readers remain unbound in a durable review state.
The owner page shows at most 50 original readers, searches the existing contact
spine, and records the explicit choice through the shared audited service.
Erased receipts cannot be reassigned, and retained records with active or
acknowledged erasures cannot authorize another import. Wrapped receipt keys
stay out of subject exports and participate in credential rotation.

The current revision still needs the full v2 regression and inventory run,
live SDK generation, production build/browser qualification, complete
contiguous upgrade and independent review. These software proofs supply no
human security signature or actual source/provider acceptance.

Two further actual failures exposed a separate hold boundary: an approved held
comment stayed public after acknowledged erasure, and rolling its import back
deleted the held evidence through the page cascade. The three-control before
run failed those two assertions while ordinary unheld rollback passed, in
19.02 seconds. Shared CMS deletion now honors dependent reader holds, and
reader rollback deletes only unheld rows. Public comment reads veto active or
acknowledged erasure without changing the privately held original moderation
state. Rollback records and displays retained private pages, including graph
child aggregation. The exact three after controls passed in 25.03 seconds;
focused lint and full typecheck also passed.

The combined v2 source run now passes all 14 reader controls in 90.28 seconds.
Live SDK generation passed all eight controls (3.24 seconds), and the exact
search/retention contact-FK inventory checks both passed (36.91 seconds; 27
unrelated cases deliberately filtered). Repository-wide types and lint,
license headers and the plan gate passed. Production build and artifact scrub
passed on local Node 24: 20,608 files and 248,233,314 bytes, with no source or
environment leakage. Final protected Node 22 qualification remains required.

Actual production owner journeys passed for Spanish, French and Arabic in the
first browser run (55.3 seconds). English reached its successful HTTP 200 form
redirect, but its fixture raced reading a response body discarded on navigation.
The fixture now checks the actual status and durable receipt; the exact English
repeat passed in 25.5 seconds. All four locales have real keyboard assignment,
320px layout, light/dark Axe checks, actual comment commit, original owner audit
and private-field omission evidence. These staged proofs do not claim the
complete legacy-source regression, 73–78 upgrade rehearsal, provider acceptance
or independent review.
