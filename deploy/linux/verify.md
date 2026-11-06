# Verify: Linux server (no Docker)

Also complete the shared [Tier-1 verification](../recipe-verification.md);
where it says "bucket", read "`/var/lib/freeholder/media`" for local storage.

- [ ] `sudo freeholder status` passes every check: service, PostgreSQL, Caddy,
      local readiness, HTTPS with a valid certificate, media directory, backup
      timer and free disk. It is the Doctor for this recipe and needs no Node,
      pnpm or checkout.
- [ ] `https://YOUR-DOMAIN` loads with no browser warning and a fresh
      instance sends you to `/setup`.
- [ ] Only ports 22, 80 and 443 answer from outside. PostgreSQL listens on
      localhost only (`ss -ltn | grep 5432` shows `127.0.0.1`), and so does the
      app (`127.0.0.1:3000`).
- [ ] Upload an image, then `sudo ls -R /var/lib/freeholder/media`: it is
      there, and `sudo systemctl restart freeholder` keeps it.
- [ ] `sudo freeholder backup` writes a directory under
      `/var/lib/freeholder/backups` with `database.dump`, `media.tar.gz` and
      `SHA256SUMS`.
- [ ] `sudo freeholder restore latest` brings the site back with the same
      pages and media. **Do this once before you trust the backup.**
- [ ] `systemctl list-timers freeholder-backup.timer` shows the next run.
