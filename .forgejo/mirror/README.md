<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Freeholder's private Forgejo mirror

GitHub `CampDenman/freeholder` supplies the reviewed source. Forgejo
`tony/freeholder` is a regular private repository that follows GitHub `main`.
The sync fetches both tips afresh, logs their SHAs and commit counts, and
advances only Forgejo `main`. It requires the old mirror tip to be an ancestor
of the source and guards against overwriting a concurrent change. A missing branch
or a fetch or push failure also fails the run. `--check` exits 0 when the tips
match, 1 when a fast-forward is available, and 2 for mirror-only history.

## Set up the timer

Use a Linux operations host with Git, Bash, OpenSSH, `flock` and systemd.
From the reviewed repository root, create a dedicated service identity and
cache, then install the units:

```sh
sudo useradd --system --user-group --home-dir /var/lib/freeholder-mirror \
  --shell /usr/sbin/nologin freeholder-mirror
sudo install -d -m 0700 -o freeholder-mirror -g freeholder-mirror /var/lib/freeholder-mirror
sudo -u freeholder-mirror git init --bare /var/lib/freeholder-mirror/cache.git
sudo install -D -m 0755 .forgejo/mirror/sync-main.sh /usr/local/libexec/freeholder-mirror-sync
sudo install -m 0644 .forgejo/mirror/freeholder-mirror.service \
  .forgejo/mirror/freeholder-mirror.timer /etc/systemd/system/
```

Generate an unattended SSH key for `freeholder-mirror` at
`/var/lib/freeholder-mirror/id_ed25519`. Add its public half as a write-enabled
deploy key on `tony/freeholder` only. Install the independently verified SSH
host key for `[forge.paradisemodern.com]:2222` in
`/var/lib/freeholder-mirror/known_hosts`, readable by the service user. Keep
both files inside the service's private state directory.

Run a read-only comparison before enabling updates:

```sh
sudo -u freeholder-mirror env \
  GIT_SSH_COMMAND='/usr/bin/ssh -F /dev/null -i /var/lib/freeholder-mirror/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/lib/freeholder-mirror/known_hosts' \
  /usr/local/libexec/freeholder-mirror-sync --check /var/lib/freeholder-mirror/cache.git \
  https://github.com/CampDenman/freeholder.git \
  ssh://git@forge.paradisemodern.com:2222/tony/freeholder.git
```

If the tips match or there are zero mirror-only commits, start the service
and check the first run before enabling the timer:

```sh
sudo systemctl daemon-reload
sudo systemctl start freeholder-mirror.service
sudo journalctl -u freeholder-mirror.service -n 30 --no-pager
sudo systemctl enable --now freeholder-mirror.timer
```

A mirror push can trigger Forgejo's `main` workflows. Review the live repo's
Actions configuration before the first write. A successful sync proves source
freshness only. For `demo.freeholder.ai`, compare the OCI revision on the
container that holds the `playground-app` proxy alias with the revision of
GHCR `ghcr.io/campdenman/freeholder:edge`. Its version string and HTTP health
are separate checks. Keep the demo's deploy credentials in the private Forgejo
repo. Before enabling `deploy-demo.yml`, make the updater use the existing
playground reset hand-over and require the serving container's image to match
the promoted image. The current updater starts the default Compose project,
while the alternating reset can leave the other project serving and answering
the updater's HTTP check.
