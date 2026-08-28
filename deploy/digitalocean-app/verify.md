# Verify: DigitalOcean App Platform

Complete the shared [Tier-1 verification](../recipe-verification.md), then the
platform checks below.

- [ ] The app URL loads over HTTPS.
- [ ] `/setup` on a fresh app; `/admin` after setup.
- [ ] Doctor is green.
- [ ] Uploads appear in Spaces, not on the container.
- [ ] A worker or web process can run `platform.doctor`.
