# Verify: Docker Compose

Complete the shared [Tier-1 verification](../recipe-verification.md), then the
platform checks below.

- [ ] `deploy/docker-selfhost/selfhost.sh check` passes: app, db and backup
      running, the app healthy, and `/api/health` answering over HTTPS with a
      valid certificate.
- [ ] `/api/health` returns `ok` and the release `version` you installed
      (`FREEHOLDER_IMAGE` is a release tag, not `edge`).
- [ ] Doctor is green; with local storage it reports media on
      `/var/lib/freeholder/media`.
- [ ] Upload an image, `docker compose ... up -d --force-recreate app`, and it
      is still there (it is on the `media` volume).
- [ ] `selfhost.sh backup` then `selfhost.sh restore latest` brings back the
      same pages and media.
