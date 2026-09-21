# Docker host updates (C10.31)

The first automatic lane supports the standard Linux `app` / PostgreSQL 16 `db` /
`caddy` Compose deployment, S3 media and no custom app mounts except its private
control socket. Other recipes, local media and schema-changing updates remain
manual. It never mounts Docker's socket inside Freeholder.

Install Python 3, Docker Compose and a checksum-verified current `cosign` from
the official Sigstore release. The verifier requires the exact main-branch
`publish-image.yml` signing identity; that workflow verifies CI build provenance
before promotion. No personal GitHub token is needed on the host.

As root, copy `scripts/docker-updater.py` to
`/usr/local/lib/freeholder/docker-updater.py`, copy the three systemd files here
to `/etc/systemd/system`, and copy `config.example.json` to
`/etc/freeholder/updater.json` with mode 600, owned by root. Adjust the paths and
app GID. The deployment's `compose.yml` must use `${FREEHOLDER_IMAGE}` and keep
the app behind Caddy, with no published app port. Add to the app:

```yaml
environment:
  FREEHOLDER_UPDATE_SOCKET: /run/freeholder-updater/updater.sock
volumes:
  - /run/freeholder-updater:/run/freeholder-updater:ro
```

Run `systemctl daemon-reload` and
`systemctl enable --now freeholder-updater.service`, then recreate the app to
mount the socket. `/admin/updates` shows host status and provides an owner-only
update request requiring fresh two-factor authentication. A queued request is
not a completed deployment; refresh for durable progress. The socket accepts
only status and an apply request for the fixed upstream repository.

Start with `automatic: false`. Exercise the CLI with a verified candidate:

```sh
python3 /usr/local/lib/freeholder/docker-updater.py apply --digest sha256:...
python3 /usr/local/lib/freeholder/docker-updater.py status
```

Older images did not include a source revision label. For the first upgrade
from one of those images, verify its exact digest and source commit against
the original successful main CI artifact/provenance. Add `initial_image`
(`ghcr.io/campdenman/freeholder@sha256:...`) and `initial_revision` (the full
40-character commit) to the root-owned configuration. This baseline applies
only when the running image matches that exact digest. Never guess its commit
from a mutable tag. New candidate images must carry their own revision label;
the bootstrap baseline cannot authorize an unlabelled candidate.

Every candidate is signature-checked, restored against a real database backup
and checked against upstream commit history so a stale channel tag cannot
downgrade the installation. Missing revision labels, unavailable commit-history
verification, or divergent/older revisions refuse before maintenance. The public
GitHub comparison endpoint receives only the two public release revisions.
The restored candidate runs
on a network with no egress, booted and smoke-tested. A change in database schema
or migration journal refuses cutover. A passing candidate puts Caddy into
maintenance, stops the app, takes a final backup, pins the image and verifies
readiness and routes before reopening traffic. Failure restores the previous
image and verifies it; database writes are preserved. Failed recovery leaves
maintenance enabled and blocks another update. Interrupted runs also block.

After proving recovery on your installation, set `automatic: true`, select
`channel` (`stable` uses `latest`; `edge` uses the latest tested main image), and
`utc_hour` (0–23). Restart the updater service and enable
`freeholder-update-check.timer`. The host checks once in that UTC hour each day;
this operator schedule is independent of the in-app signed-release-feed policy.
Disable the timer or set `automatic: false` to pause unattended changes. An
absent stable tag fails safely. No automatic migration or forced downgrade is
inferred from a version number.

Backups, exact configs, image identities and status live under
`state_directory`, readable only by root. They contain production secrets and
personal data: include them in your encrypted backup/retention policy. They are
not automatically deleted. Monitor free disk and systemd failures. An operator
must diagnose an interrupted/recovery-required run, verify the live image,
database and proxy, and archive `status.json` before another run is permitted.
Never clear a failure solely to make the scheduler retry.

Host tests: `python3 -m unittest discover -s tests/host -v`.
