# Migrate to or from Replit

Target: `replit`

Follow the complete [Tier-1 migration runbook](../migration-runbook.md). Use a
Replit Deployment rather than a sleeping workspace, restore into Replit
Postgres, and use `scripts/media-transfer.mjs` with a Replit target/source so
the media-manifest keys are copied through the Object Storage SDK. Verify the
Deployment URL before custom-domain cutover; preserve `CREDENTIAL_KEY` so
connected accounts remain decryptable.
