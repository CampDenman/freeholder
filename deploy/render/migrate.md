# Migrate to or from Render

Target: `render`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md). Sync
`render.yaml`, enter every `sync: false` object-storage value during initial
Blueprint creation, and use the database connection string from the migration
workstation for restore. Set `APP_URL` to the final HTTPS origin, verify the
temporary Render URL, then cut over DNS. Roll back by deploying the previous
image tag and restoring DNS to the read-only source.
