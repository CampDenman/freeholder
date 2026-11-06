# Migrate to or from a Linux server

Target: `linux`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md).

- **Out:** `sudo freeholder backup` writes `database.dump` (PostgreSQL custom
  format) and `media.tar.gz`, whose paths are the storage keys. Restore the
  dump on the target with `pg_restore --no-owner`, and copy the media to the
  target's bucket with the same keys, for example
  `rclone copy /var/lib/freeholder/media remote:bucket`.
- **In:** copy a backup directory from another Linux install (or build one: a
  `pg_dump --format=custom` as `database.dump`, the bucket's objects as
  `media/` inside `media.tar.gz`, and `sha256sum ./* > SHA256SUMS`) and run
  `sudo freeholder restore /path/to/that-directory`.
- Keep `/etc/freeholder/freeholder.env` from the source: `CREDENTIAL_KEY`
  decrypts stored provider credentials, and a new one cannot read them.
