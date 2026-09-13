# scripts/ — operational entry points

Current entry points include `doctor`, owner-password recovery, ownership
export and restore rehearsal, the SEO and accessibility public gates, schema
compatibility, changelog enforcement and the upgrade gate. Package scripts in
the root `package.json` are the supported commands.

`pnpm gates` runs the inexpensive pre-push checks. Its contract suite includes
contact merge coverage, registry completeness, documentation availability and
plan integrity. Every listed test file must report at least one passing test;
a missing, empty or entirely skipped file fails the gate. Database cases in
mixed suites still require a disposable `TEST_DATABASE_URL`. Browser checks
run separately against a built app; recipe, SEO and upgrade checks need Docker.

`doctor.mjs` accepts an owner password plus `--totp-secret` (or the equivalent
`FREEHOLDER_*` variables) for an interactive owner check. Automation should use
a bearer key scoped to `platform.doctor` through `--api-key` /
`FREEHOLDER_API_KEY`, so a monitor does not retain an owner's password or TOTP
seed. `--enroll-totp` exists only for the disposable fresh-image validation
gate and must not be used as an operational shortcut.

`schema-baseline-identity.mjs` (C10.19) applies the pre-collapse chain and
the reviewed baseline to empty databases and diffs their catalogs. Constraint
and index names are normalized (drizzle `*_id_*_id_fk` vs Postgres `*_fkey`).
`pnpm db:baseline-identity` is the named command; `pnpm test` runs the same
proof when `TEST_DATABASE_URL` is set.

`ownership-export.mjs` writes every application-owned table, a media manifest,
the declarative configuration and checksums while replacing authentication and
encryption material with `[REDACTED]`. It records whether recovery secrets are
configured and fingerprints a valid `CREDENTIAL_KEY`, but never writes a raw
environment value or database URL. `ownership-drill.mjs` accepts only a
database named with `test` or `drill`, runs a real `pg_dump`/`pg_restore` into a
random scratch database, compares every table and generates the export from
the restored copy. PostgreSQL client tools must be at least as new as the
server. See `deploy/ownership-recovery.md`.

`create-freeholder` now checks the generated environment, can install and
migrate, and prints the setup URL (C3.14). `pnpm packages:release` proves
package versions match the platform and a `vX.Y.Z` tag (C3.20). Recipe
update/rollback automation remains open under C10.10. C1.23 supplies the
guarded ownership substrate.
