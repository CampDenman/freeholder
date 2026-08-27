# Migrate to or from a DigitalOcean Droplet

Target: `digitalocean-droplet`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md). Restore
through `docker compose exec -T db pg_restore`; port 5432 must remain private.
Sync media to Spaces rather than droplet disk, run the restore rehearsal in
`verify.md`, and repoint DNS only after Caddy serves the final hostname. Roll
back by restoring DNS and the previous digest-pinned `FREEHOLDER_IMAGE`.
