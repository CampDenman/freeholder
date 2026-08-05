# Verify: DigitalOcean droplet

What `doctor` cannot check for you. Work through it after the first deploy, and
again after anything that touches infrastructure.

## It is actually serving

- [ ] `https://yourdomain.com` loads over TLS with no browser warning.
- [ ] `http://yourdomain.com` redirects to HTTPS.
- [ ] A fresh instance sends you to `/setup`; a configured one does not.
- [ ] `curl -sI https://yourdomain.com | grep -i x-powered-by` returns nothing.

## Nothing is exposed that should not be

- [ ] `nmap yourdomain.com` (or `ufw status`) shows only 22, 80 and 443.
- [ ] `psql postgres://freeholder@yourdomain.com:5432/freeholder` **fails** —
      the database must not be reachable from the internet.
- [ ] `/admin` and `/login` return `noindex` in their robots meta.
- [ ] The Spaces bucket does not list its contents to an anonymous browser.

## Media really lives in Spaces

- [ ] Upload something in the admin, then confirm the object appears in the
      Spaces bucket rather than on the droplet.
- [ ] `docker compose down && docker compose up -d` — the file is still there.
      If it is not, storage fell back to disk and §18 is being violated.

## The restore actually works

**Do this once before you trust the backup at all.** A backup you have never
restored is a hope.

- [ ] Run `/opt/freeholder/backup.sh` by hand; an archive appears in the
      backup bucket.
- [ ] Restore it into a scratch database and confirm it opens:

      docker compose exec -T db createdb -U freeholder restore_test
      gunzip -c freeholder-TIMESTAMP.sql.gz \
        | docker compose exec -T db psql -U freeholder -d restore_test
      docker compose exec -T db psql -U freeholder -d restore_test \
        -c "select count(*) from contacts;"

- [ ] Drop the scratch database afterwards.
- [ ] Confirm the cron entry exists: `cat /etc/cron.d/freeholder-backup`.
- [ ] Come back tomorrow and confirm a new archive appeared on its own.

## It survives a reboot

- [ ] `reboot` the droplet; the site returns without anyone logging in.
- [ ] Sessions still work — you are not signed out.

## The image is the one we published

Every published image is signed keyless by the release workflow, with build
provenance and an SPDX SBOM attached (MASTER.md §39.3). Nothing about §39's
unattended updates is safe until an instance can prove what it is running, so
this is worth doing once by hand — and worth wiring into monitoring later.

- [ ] Verify the signature:

      cosign verify ghcr.io/campdenman/freeholder:edge \
        --certificate-identity-regexp '^https://github.com/CampDenman/freeholder/' \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com

- [ ] Verify the provenance — that this digest was built by that workflow, from
      this repository, rather than pushed by someone with a registry token:

      gh attestation verify oci://ghcr.io/campdenman/freeholder:edge \
        --repo CampDenman/freeholder

- [ ] A failure here is not a warning to note and move past. An image that
      cannot be verified should not be run.

## You can get back in when you cannot sign in

Worth doing once, before you need it — a password you cannot reset is a
business you cannot reach.

- [ ] Generate a new owner password and the statement that installs it:

      docker compose exec app node scripts/owner-password.mjs

- [ ] It prints the password once and does *not* apply it. Run the statement it
      gives you against the database, then sign in with the new password.
- [ ] Change it again from **Settings → Password**, so the password that ends
      up in your shell history is not the one you keep. Every other signed-in
      device is signed out when you do.

## Doctor passes

`doctor` is the one command that tries things rather than reading settings
back: it writes a file to your bucket and reads it again, opens the mail
configuration, and checks the database is on the schema this build expects.

- [ ] Run it from your machine, signed in as the owner:

      pnpm doctor --url https://your-domain --email you@example.com --password …

      …or from the server: `docker compose exec app node scripts/doctor.mjs`
      with `FREEHOLDER_URL`, `FREEHOLDER_EMAIL` and `FREEHOLDER_PASSWORD` set.

- [ ] Every line reads `ok`. A `warn` is something to know about — no mail
      configured, media on the machine's own disk. A `FAIL` will stop this
      instance doing its job, and each one names what to change.
- [ ] The same report is in the admin under **Health**, so you never need a
      terminal to find out that uploads stopped working.
