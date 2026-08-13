# scripts/ — operational entry points

Current entry points include `doctor`, owner-password recovery, ownership
export and restore rehearsal, the SEO and accessibility public gates, schema
compatibility, changelog enforcement and the upgrade gate. Package scripts in
the root `package.json` are the supported commands.

`doctor.mjs` accepts an owner password plus `--totp-secret` (or the equivalent
`FREEHOLDER_*` variables) for an interactive owner check. Automation should use
a bearer key scoped to `platform.doctor` through `--api-key` /
`FREEHOLDER_API_KEY`, so a monitor does not retain an owner's password or TOTP
seed. `--enroll-totp` exists only for the disposable fresh-image validation
gate and must not be used as an operational shortcut.

`ownership-export.mjs` writes every application-owned table, a media manifest,
the declarative configuration and checksums while replacing authentication and
encryption material with `[REDACTED]`. It records whether recovery secrets are
configured and fingerprints a valid `CREDENTIAL_KEY`, but never writes a raw
environment value or database URL. `ownership-drill.mjs` accepts only a
database named with `test` or `drill`, runs a real `pg_dump`/`pg_restore` into a
random scratch database, compares every table and generates the export from
the restored copy. PostgreSQL client tools must be at least as new as the
server. See `deploy/ownership-recovery.md`.

The finished operational surface still requires setup/install (`MASTER.md`
C3.14), the single-archive/import UX and human-readable projections (C3.18),
cross-platform migration (C3.19), and complete recipe-level parity and update/
rollback (C3.17 and C10.10). C1.23 supplies the guarded ownership substrate;
those later items build on it rather than being claimed by a command name.
