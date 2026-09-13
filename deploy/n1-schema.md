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

## C10.19 — one-time pre-1.0 baseline

Collapsing `0000`–`0167` into `0000_reviewed-baseline.sql` is an acknowledged
schema break (`schemaRisk: "breaking"`). A database whose journal still names
the old chain cannot apply the baseline, and rolling back to a pre-collapse
image is not an image swap: the previous migrator does not recognise the new
journal. Fresh installs apply the baseline from empty. This is the only window
the chain is still ours to collapse; after 1.0 it is somebody else's installed
history.

Sibling `0168_*` first-party plugin migrations (C3.13) are not in this
baseline. Fold them in when those PRs land, or rebase this collapse after them.
