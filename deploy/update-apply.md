# Apply and roll back

Automatic `platform.applyUpdate` and `platform.rollbackUpdate` are unavailable.
The separate opt-in [Docker host executor](docker-updater/README.md) (C10.31)
provides owner-requested and scheduled image updates only when a restored-backup
rehearsal proves the database schema and migration journal remain unchanged.
Schema-changing releases and all other recipes still use the manual procedure.
The previous implementation did not create recoverable backups, execute
migrations or verify a candidate deployment, and could report a successful
rollback after rollback failed. It has been removed (C10.06/C10.10/C11.10).
Preflight without a signed feed fails its authenticity check.

For an operator-managed update:

1. Schedule maintenance and stop writes. Record the currently running image's
   immutable digest and retain the exact deployment configuration.
2. Create a PostgreSQL custom-format backup using `pg_dump --format=custom`,
   protect it like production data, and restore it into a separate database with
   `pg_restore`. Verify records and application access there. Back up configuration
   and follow the object-store backup policy too; a database dump excludes media.
3. Verify the release signature and provenance, and pin the candidate as
   `ghcr.io/campdenman/freeholder@sha256:<verified digest>`. Test its migrations
   against the restored database and exercise the site's enabled workflows.
4. Deploy the pinned candidate using the target's operator tooling. Run its real
   migrations and verify health, login, content and enabled business workflows
   against the candidate before reopening traffic. Retain the backup and old image.
5. If verification fails, keep maintenance enabled. An image swap back is safe
   only when the previous build can read the migrated schema. Otherwise restore
   the tested backup and compatible configuration, accounting for any writes
   accepted since the backup. Verify recovery before reopening traffic.

For Docker self-host and Droplet, `FREEHOLDER_IMAGE` controls the deployed image.
Set `PREVIOUS_FREEHOLDER_IMAGE` to the recorded immutable digest before invoking
an operator rollback. Missing pins now fail instead of silently selecting edge.
Cloud recipes require equivalent immutable deployment artifacts and recovery
verification through their provider tooling.

`platform.listUpdateRuns` remains available for historical inspection. Legacy
snapshot fingerprints contain no recoverable row data and must not be used as
restore points. A host executor with independent verification remains required
before unattended updates can be enabled again.
