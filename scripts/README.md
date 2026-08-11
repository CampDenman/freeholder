# scripts/ — operational entry points

Current entry points include `doctor`, owner-password recovery, the SEO and
accessibility public gates, schema compatibility, changelog enforcement and
the upgrade gate. Package scripts in the root `package.json` are the supported
commands.

`doctor.mjs` accepts an owner password plus `--totp-secret` (or the equivalent
`FREEHOLDER_*` variables) for an interactive owner check. Automation should use
a bearer key scoped to `platform.doctor` through `--api-key` /
`FREEHOLDER_API_KEY`, so a monitor does not retain an owner's password or TOTP
seed. `--enroll-totp` exists only for the disposable fresh-image validation
gate and must not be used as an operational shortcut.

The finished operational surface also requires setup/install (`MASTER.md`
C3.14), full export (C3.18), cross-platform migration (C3.19), and recipe-level
backup/restore/update/rollback (C3.17 and C10.10). Those are completion targets,
not commands that exist merely because they are named in the specification.
