# Verify: Docker Compose

Complete the shared [Tier-1 verification](../recipe-verification.md), then the
platform checks below.

- [ ] `docker compose ps` shows app and postgres healthy.
- [ ] `/api/health` returns `ok` and `version`.
- [ ] Doctor is green.
- [ ] Production storage is not the local disk adapter.
