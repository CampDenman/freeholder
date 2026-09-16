---
"freeholder": patch
---

Global search now requires the actual read permission for each kind of record.
An API key limited to contact writes can no longer use search to read contact
names or email addresses; notes, tasks and conversations use their own grants.

Completion checks now test realistic performance datasets and scan 22 more
admin lists for accessibility in both themes (C11.10–C11.12, C11.14–C11.15).

Community members and moderators must now sign in. Knowing another member's
email no longer reveals gated posts or lets someone write or moderate as them.
Unconfigured print, marketplace, and voice/video providers report failure
instead of simulated success. Contacts imported together now paginate in a
stable order without repeating people (C3.13, C11.10–C11.11, C11.15).

SDK generation now refuses to report success when its live-registry step was
skipped (C3.03, C11.15).

Managed agents can no longer propose or execute private service phases. Capture
session IDs require media access, upload staging is internal, and phone links
can bind only their own uploads (C4.03–C4.04, C1.29, C11.09).

Print-provider acceptance no longer marks an order shipped or presents the
vendor order identifier as a carrier tracking number (C3.13).

Print and voice/video provider claims now exclude simultaneous retries (C3.13).

The upgrade gate now fails when its previous image cannot be pulled instead
of reporting an unverified upgrade as a successful first-release skip (C11.15).

Marketplace sync now uses expiring leases to exclude competing workers and
imports each contact, invoice and channel order atomically (C3.13).
