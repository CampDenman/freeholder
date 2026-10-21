<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Record recovery (C11.14)

**Move to trash** removes a record from normal lists and every surface that
reads it. The original row remains — same id, same natural key, same history —
until an explicit purge or the thirty-day sweep, so removal is reversible and
nothing silently widens or disappears underneath a recovery.

## Notes and tasks

Notes and tasks were the first recovery family. Trashed tasks do not appear in
project checklists or their open-task counts, briefings, or reminder claims.
Restoring preserves IDs, revisions, assignment, recurrence state and subject
links; a contact merge and its undo also update contact-subject links,
including on trashed rows. Purging a note also removes its revisions; erasure
deletes notes and anonymizes tasks even while they are trashed, and restore
never recreates erased personal fields. The trash screen uses each record's
existing view/manage grants; a private note remains visible only to its author.

## Pages, forms, popups, segments and saved views

The same guarantees now cover the rest of the recoverable families:

- **Pages, draft and published.** Trashing a page is instant takedown: the
  public lookup, sitemap, global search, help centre, scheduled publish and
  unpublish, preview links, presence, comments and every admin read filter
  trash. Because the trashed row keeps its slug, nothing can take the address
  while the page recovers; restoring a published page puts the same row back
  online. Purging removes the page and everything that exists only for it —
  revisions, layouts, preview links, presence, comments and translations.
- **Forms — the definition only.** Submissions are evidence of what somebody
  told the business: they stay live and reviewable while the definition is in
  trash, and the public form stops accepting new submissions. Purging a form
  is the pre-existing hard delete (the definition and, by its cascade, its
  submissions) behind typed confirmation, recent verification and the hold
  below — deleting submissions was not changed in any other way.
- **Popups.** A trashed popup stops deciding immediately: it is not a
  candidate, and recording events or captures against it fails. Its event
  history stays until purge.
- **Segments.** A trashed segment stops answering, and every consumer fails
  closed: a popup wired to it does not show (neither the inSegment nor the
  notInSegment reading), a contract price list stops applying, an automation
  does not start, and a segment-scoped messaging window steps aside so the
  default quiet-hours and caps still govern. Purging a segment that another
  surface still wires in is refused with a plain sentence.
- **Saved views — personal.** Only the owner sees or recovers their trashed
  views; a colleague's shared view that its owner trashed is not visible to
  anyone else. The daily sweep reclaims every owner's expired trash.

**Purging** requires typing `PURGE` and a recent identity verification. It
only accepts an already trashed record. Families whose rows — or whose child
rows, by cascade — carry contact personal data (forms via submissions, popups
via events, segments via captured membership) refuse to purge while any of
those contacts is under an active retention exception; the same guard covers
the scheduled sweep. Pages and saved views name no contact, so no contact-
scoped hold can apply to them and their purge carries no hold guard.

Privacy erasure still reaches the evidence rows while their parent is in
trash — submissions are anonymized in place, captured membership and popup
event links are removed — and restoring the parent never resurrects that
erased data.

Open **View trash** from the notes panel or task list, or open
`/admin/trash` directly. The paginated trash screen uses the same record
permissions as those surfaces: view access allows reading; manage access (or
ownership, for saved views) allows restore or purge.

The daily `core.purgeExpiredWorkRecords` job permanently purges eligible
trash older than thirty days, up to 500 records of each kind per run. Active
retention holds protect records from both this job and manual purge. Inspect
failed jobs in the existing platform job screen and retry after resolving the
failure. Configured retention policies and privacy erasure still apply and may
remove records before the normal thirty-day trash period. This feature does
not recover records that were permanently deleted before it was installed.

## What recovery deliberately does not cover

Not every family gets undelete, and the exclusions are deliberate rather than
oversights:

- **Money and ledger records** (orders, invoices, quotes, credit notes,
  payments, subscriptions, gift cards) are never hard-deleted; their
  reversible layer is the state machine — void, cancel, refund — which keeps
  numbers, audit trail and `RETENTION_TABLE_OPT_OUTS` legal/accounting holds.
  There is nothing to undelete.
- **Append-only evidence** (audit log, timeline events, the outbox, consent
  records, SMS compliance, data requests and erasure receipts) is opted out
  by spec. Restoring an erasure receipt would be wrong.
- **Credentials and bearers** (API keys, sessions, magic links, share links,
  device tokens, payment methods) must not be recoverable — security requires
  that revoking one is final.
- **Join and fan-out rows** (project collections, order items, captured
  memberships) ride their parent; recovering the parent recovers them.
- **Families with no delete path at all** (contacts, conversations, deals,
  bookings, projects, galleries, documents, suppliers, gift registries,
  events, newsletters, loyalty, reviews, referrals) already keep every row —
  the "no silent loss" promise holds by construction.
- **Owner configuration whose removal is the act itself** — redirects, webhook
  endpoints, keyword actions, scoring rules, playbooks, export artifacts and
  grants — is recreated by re-entering it, not recovered; deleting it never
  takes customer data with it.

Migration `0011_record_trash.sql` adds nullable timestamps and partial indexes
to the five new tables; existing rows remain active. No second contact or
archive store is introduced. Ownership exports include the original rows and
trash timestamps, and instance backup/restore preserves them.

Application versions predating migration `0011` do not filter the new trash
timestamps. If rolling back to such a version, restore its matching
pre-upgrade database backup through the normal rollback procedure; retaining
the upgraded database would make trashed pages, forms, popups, segments and
saved views appear active to the old code. (The same caveat has applied to
`0010` note and task trash since it shipped.)
