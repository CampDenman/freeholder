<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Host updates on non-Docker targets (C10.06)

`docker-updater.py` covers the standard Compose recipe. This executor covers
the remaining hosting targets — source-pull containers (Replit), systemd or
plain-binary hosts, and platform deploy hooks (Render, Railway, DigitalOcean
App Platform) — with the same discipline the readiness audit demanded: no
success is recorded unless the backup and the health check both proved, and
every refusal is durable.

The operator declares an **immutable, digest-pinned artifact** and the commands
their target's tooling runs. The executor downloads the artifact, verifies its
sha256 (and optionally the publisher's cosign signature), refuses to continue
unless the backup hook produced a real non-empty file at the declared path,
applies, health-checks, and — on failure — rolls back and independently
re-runs the health check before it will say `rolled_back`.

## Install

Copy `scripts/host-updater.py` to `/usr/local/lib/freeholder/host-updater.py`
and a root-owned, mode-600 `/etc/freeholder/host-updater.json` adapted from
`deploy/host-updater.example.json`:

```json
{
  "state_directory": "/var/lib/freeholder-host-updater",
  "socket": "/run/freeholder-host-updater/updater.sock",
  "app_gid": 1001,
  "backup_produces": "/backups/freeholder-pre-update.dump",
  "health_timeout_seconds": 180,
  "artifact": {
    "url": "https://releases.example.com/freeholder/freeholder-0.1.0.tar.gz",
    "sha256": "<64 hex chars pinned at release time>",
    "cosign_identity": "https://github.com/CampDenman/freeholder/.github/workflows/publish-host-artifact.yml@refs/heads/main",
    "signature_url": "https://releases.example.com/freeholder/freeholder-0.1.0.tar.gz.sig"
  },
  "hooks": {
    "backup": "systemctl stop freeholder && pg_dump --format=custom freeholder > /backups/freeholder-pre-update.dump && systemctl start freeholder",
    "maintenance_on": "touch /var/www/maintenance.on",
    "apply": "tar -C /opt/freeholder -xzf \"$FH_ARTIFACT\" && systemctl restart freeholder",
    "health": "curl -fsS http://127.0.0.1:3000/api/health | grep -q '\"ok\":true'",
    "rollback": "/opt/freeholder/bin/restore-previous && systemctl restart freeholder",
    "maintenance_off": "rm -f /var/www/maintenance.on"
  },
  "automatic": false,
  "utc_hour": 10
}
```

Rules the executor enforces before any hook runs:

- The configuration is root-owned and not writable by group/other; every path
  is absolute; the artifact URL is `https`; the digest is an immutable
  sha256; `backup`, `apply`, `health` and `rollback` are non-empty commands.
- When `cosign_identity` is set, `signature_url` must be `https` and `cosign
  verify-blob` must validate the artifact against that exact identity and the
  GitHub OIDC issuer before anything else happens.
- The `backup` hook must leave a non-empty file at `backup_produces`. A
  fingerprint, a log line or a missing file is not a backup: the run refuses
  and nothing else runs.
- Hooks run as root with `FH_ARTIFACT` pointing at the verified artifact.

## Run

```sh
python3 /usr/local/lib/freeholder/host-updater.py apply --config /etc/freeholder/host-updater.json
python3 /usr/local/lib/freeholder/host-updater.py status --config /etc/freeholder/host-updater.json
```

The state machine is the Docker executor's: verify artifact → verified backup
→ maintenance on → apply → health → maintenance off → `completed`. On a
health failure after apply, rollback runs and the health hook must pass again
before the run records `rolled_back`; a rollback that cannot verify itself
records `recovery_required`, leaves maintenance on, and blocks every later
run. A run interrupted mid-state blocks the next run until an operator
inspects the host, archives `status.json`, and clears the state deliberately.
A failure before the apply hook ran records `failed` and never runs rollback,
because the deployment it would roll back was never touched.

`maintenance_on`/`maintenance_off` are optional; when present they bracket the
candidate window exactly as Caddy does on the Docker lane. Keep their effect
write-blocking: the rollback guarantee is that no accepted write lands between
the backup and the verified rollback.

## Schedule

The same operator discipline as the Docker lane: start with `automatic:
false`, prove refusal and recovery on your installation, then set `automatic:
true` and `utc_hour` (0–23) and drive `scheduled` from an hourly systemd
timer. Disable the timer or set `automatic: false` to pause unattended
changes.

## Target mapping

| Target family | `apply` hook is | `rollback` hook restores |
|---|---|---|
| Replit (source-pull) | fetch + install the pinned artifact commit and restart | the previous artifact |
| systemd / bare host | unpack the pinned artifact and restart the unit | the previous artifact |
| Render / Railway / DO App Platform (deploy hook) | hand the pinned artifact to the platform deploy API | the previous deploy spec |

On every target the artifact stays immutable and digest-pinned, so rollback is
always to exactly what ran before. Host tests: `python3 -m unittest discover
-s tests/host -v`.
