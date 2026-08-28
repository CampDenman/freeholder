# Migrate to or from Railway

Target: `railway`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md). Apply
`.railway/railway.ts`, preserve `APP_URL`, `SESSION_SECRET` and `CREDENTIAL_KEY`,
and use the generated Postgres and bucket reference variables. Railway buckets
use virtual-hosted S3 addressing, which this recipe sets explicitly. Run the
target export and upload/read/delete verification before assigning the public
domain or changing DNS.
