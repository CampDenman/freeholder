# Migrate to or from Docker self-hosting

Target: `docker-selfhost`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md).
Restore with the Compose Postgres service (`selfhost.sh restore` takes a
backup directory in the `backups` volume with the same layout as the Linux
recipe's, so backups move between the two directly). Media goes to the
`media` volume with its storage keys as paths, or to the configured private
S3-compatible store; the local-development MinIO profile is not a migration
target. Keep the prior image in `PREVIOUS_FREEHOLDER_IMAGE` until database,
media and public URL checks pass.
