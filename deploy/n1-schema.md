# N-1 schema and the upgrade gate

Rollback is an image swap only while release N's schema is still readable by
release N-1. Expand, then contract.

Two gates keep that true:

1. **Schema-compatibility.** `scripts/schema-compat-gate.mjs` fails an
   unlabelled `DROP TABLE` / `DROP COLUMN` / rename / retype / required column.
   An acknowledged break must also set `schemaRisk: "breaking"` in
   `src/core/update/this-release.ts`, or the updater would treat a contract
   break as a safe image swap.
2. **Upgrade gate.** `scripts/upgrade-gate.sh` boots the previous published
   image, writes a contact, migrates forward with this build, checks the
   contact and the home page, then boots the previous image against the new
   schema with `FREEHOLDER_SKIP_MIGRATE=1`. If there is no previous image the
   gate skips with a warning, not a silent pass.

This is not unattended apply (C10.06) and not target-specific image swap
(C10.10).
