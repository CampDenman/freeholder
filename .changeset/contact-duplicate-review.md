---
"freeholder": minor
---

Add a human-reviewed duplicate workflow to the Contact spine. An indexed scan
surfaces canonical candidate pairs with transparent name, phone, organization,
and country scoring; it never merges automatically, and dismissals remain
closed across later scans. The translated admin review desk makes the surviving
record explicit before an owner approves a merge.

Every manual or queue-approved merge now records its exact contact snapshots
and affected references. Owners can undo while the survivor and moved records
remain conflict-free; relationships, timeline events, form submissions, and
analytics attribution return to their original contacts in one transaction.
Security credentials are invalidated rather than restored, and such merges are
clearly recorded as non-undoable. The same permissioned services power admin,
HTTP API, OpenAPI, and MCP callers.
