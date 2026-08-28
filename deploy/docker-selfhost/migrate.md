# Migrate to or from Docker self-hosting

Target: `docker-selfhost`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md). Restore
with the Compose Postgres service, but copy production media to the configured
private S3-compatible store—local disk and the local-development MinIO profile
are not migration targets. Keep the prior image digest in
`PREVIOUS_FREEHOLDER_IMAGE` until database, media and public URL checks pass.
