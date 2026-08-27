# Migrate to or from DigitalOcean App Platform

Target: `digitalocean-app`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md). On
this target, use `${freeholder-db.DATABASE_PRIVATE_URL}` inside the app and the
public managed-database URL only from the trusted migration workstation. Copy
media into the private Spaces bucket named by `S3_BUCKET`, verify the target at
`${_self.PUBLIC_URL}`, and only then change DNS. Roll back with the previous App
Platform image/spec while the source database and bucket remain read-only.
