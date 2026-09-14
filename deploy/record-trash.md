<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Note and task recovery (C11.14)

**Move to trash** removes a note or task from normal lists and global search.
Trashed tasks do not appear in briefings or claim reminder notifications.
The original row remains: restoring it preserves its ID, revisions, assignment,
recurrence state and subject links. A contact merge and its undo also update
contact-subject links, including on trashed rows.

Open **View trash** from the notes panel or task list. The paginated trash screen
uses the same record permissions as those surfaces. View access allows reading;
manage access allows restore or purge. A private note remains visible only to
its author. API-key note reads retain the shared-note visibility restriction.

**Restore** returns the original record to its normal lists. **Delete
permanently** requires typing `PURGE` and a recent identity verification. It
only accepts an already trashed record and refuses an active privacy retention
hold. Purging a note also removes its revisions. Privacy erasure deletes notes
and anonymizes tasks even while they are trashed; restore cannot recover those
erased personal fields.

The daily `core.purgeExpiredWorkRecords` job permanently purges eligible trash
older than thirty days, up to 500 notes and 500 tasks per run. Active retention
holds protect records from both this job and manual purge. Inspect failed jobs
in the existing platform job screen and retry after resolving the failure.
Configured retention policies and privacy erasure still apply and may remove
records before the normal thirty-day trash period. This feature does not
recover records that were permanently deleted before it was installed.

Migration `0010_note_task_trash.sql` adds nullable timestamps and partial indexes;
existing rows remain active. No second contact or archive store is introduced.
Ownership exports include the original rows and trash timestamps, and instance
backup/restore preserves them. This is recovery for notes and tasks, not a
claim that every record family now supports undelete; C11.14 remains open.

Application versions predating this migration do not filter trash timestamps.
If rolling back to such a version, restore its matching pre-upgrade database
backup through the normal rollback procedure; retaining the upgraded database
would make trashed rows appear active to the old code.
