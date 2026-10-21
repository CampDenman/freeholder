# Deploying the droplet

Merging to `main` publishes an image. It does not change a server. This is
the operator step that does, for the compose stack in this directory.

It is not the unattended updater. `platform.applyUpdate` stays unavailable.
A person names the revision and types `DEPLOY PRODUCTION`. The job then:

1. Resolves the published `sha-<12>` tag. That tag is an OCI index.
   Attestation does not exist for the index digest (`gh attestation verify`
   returns 404). The job selects the `linux/amd64` manifest inside the index
   and verifies that manifest.
2. Requires the attestation to be SLSA provenance from a push to
   `refs/heads/main`, signed by `.github/workflows/ci.yml`.
3. Takes a database backup with the droplet's `backup.sh` and refuses to
   continue if that upload is not reported.
4. Writes `FREEHOLDER_IMAGE` to `ghcr.io/campdenman/freeholder@sha256:<64>`
   and, when the running pin was already a digest, copies it to
   `PREVIOUS_FREEHOLDER_IMAGE`. A moving tag such as `edge` is never saved
   as the rollback pin.
5. Runs `docker compose pull && docker compose up -d` and waits until the
   app logs `[freeholder] schema is up to date`, then until
   `GET /api/health` returns `{"ok":true}`.

A failed readiness check does not roll the image back. The new migrations
may already be applied, and the previous image may be unable to read them.
`PREVIOUS_FREEHOLDER_IMAGE` is left in place for that decision. See
[`../update-apply.md`](../update-apply.md).

## Where the job runs

`.forgejo/workflows/deploy-production.yml` in this repository. Forgejo, not
GitHub. The job carries an SSH key and a host address, and this repository
is public, so those values are Forgejo secrets. They are not in the file
and they must not be copied into `.github/workflows`.

The forge does not yet have a `freeholder` repository. Push-to-create is
disabled for the organization, and creating it needs a token this repository
does not have. Create `freeholder` in the same Forgejo organization as
paradisemodern, on the forge named in `HANDOFF.md`, and push this
repository's `main` there. Register the release runner with the label
`freeholder-release` (the machine that already runs paradisemodern's
`pm-release` label can carry both).

Secrets on that repository:

| Secret | What it is |
| --- | --- |
| `FREEHOLDER_DEPLOY_SSH_KEY` | Private key authorized on the droplet, and nowhere else |
| `FREEHOLDER_DEPLOY_KNOWN_HOSTS` | `known_hosts` line for that host. The job refuses to trust a host it has not seen |
| `FREEHOLDER_DEPLOY_HOST` | Hostname or IPv4. Not stored in this repository |
| `FREEHOLDER_DEPLOY_USER` | Optional. Defaults to `root`, which is what this recipe uses |
| `FREEHOLDER_DEPLOY_HEALTH_URL` | `https://<your domain>/api/health` |
| `FREEHOLDER_GH_TOKEN` | Optional. Reads the public attestation. Leave unset if `gh` on the runner is already signed in |

Dispatch the workflow with confirmation `DEPLOY PRODUCTION` and the revision
you intend to run. A revision is a full commit, its first 12 hex characters,
`sha-` plus those 12, or the `linux/amd64` digest itself. The 12-character
form is the tag publish-image creates. It is not a 7-character tag.

Check the result from a machine that does not need the host written down
here: the site loads, and `GET /api/health` is ok. The forge log prints the
digest and the source commit. It does not print `.env`.

## Doing it by hand

Same rules, without the workflow. Resolve the `linux/amd64` digest (not the
index), verify it, back up, then pin and recreate:

```bash
node scripts/deploy-droplet.mjs --revision <12-char-or-full-sha> --dry-run
```

`--dry-run` stops after attestation and prints the pin. Applying it needs
`DEPLOY_HOST`, `DEPLOY_SSH_KEY_PATH`, `DEPLOY_KNOWN_HOSTS_FILE` and
`DEPLOY_HEALTH_URL` in the environment. The remote half is
`scripts/deploy-droplet-remote.sh`.

## Rolling back

Only after you know the previous image can read the schema the new image
migrated:

```bash
ssh <user>@<host> 'cd /opt/freeholder && FREEHOLDER_IMAGE="$PREVIOUS_FREEHOLDER_IMAGE" docker compose up -d'
```

That is the recipe's rollback. It is an operator decision. The workflow will
not make it for you.
