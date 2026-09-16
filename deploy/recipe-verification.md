# Tier-1 deployment verification

Run this checklist after install, restore, update and rollback. A command that
exists in `recipe.yaml` is not considered tested until its observable result is
checked here.

1. Confirm the platform reports the service and PostgreSQL resource healthy.
2. Request `/api/health`; require HTTP 200, `ok: true` and the expected version.
3. Complete `/setup` on a fresh database, sign in, sign out and sign in again.
4. Run the recipe's `verify` operation and resolve every Doctor failure.
5. Upload an image, reload it through its signed/private URL, then delete it.
   Confirm the object is in the configured bucket—not container/workspace disk.
6. Create a contact and an invoice with a non-round amount; record their IDs,
   cents, currency and timestamps for restore comparison.
7. Run `backup`, restore into a scratch database with `restore`, point a
   temporary app at it and compare an ownership export. Drop the scratch DB.
8. Deploy a newer digest with `update`, repeat steps 1–5, then deploy the prior
   digest with `rollback` and repeat them again. Return to the intended release.
9. Record provider, region, image digest, database version, test time and
   operator in the deployment's private operations log.

For a provider move, continue with [migration-runbook.md](migration-runbook.md)
and do not delete the old database or bucket during this checklist.
