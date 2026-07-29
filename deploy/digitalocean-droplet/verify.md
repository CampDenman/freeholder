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
