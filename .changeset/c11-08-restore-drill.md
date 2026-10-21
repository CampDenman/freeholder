---
"freeholder": patch
---

C11.08's open clause — restore on another Tier-1 target — is closed by a live
drill, not another simulated pair: a real export from the running `freeholder-
ref` droplet (6,918,459-byte archive, SHA-256 `e7852732…a46279123`, plus a
374-table logical ownership export), a second droplet `freeholder-restore`
provisioned from the digitalocean-droplet recipe, a restore through the
recipe's own `pg_restore` operation into an empty database, and verification
before any cutover. The target re-export matched the source on 366 of 374
tables with every owned total exact (the 8 differing tables are the live
target app's own operational churn); `pnpm doctor` against the restored
instance finished 16 ok / 14 warn / 0 fail; and the seeded public page served
200 through the target's Caddy. The media leg is recorded honestly: the
dataset seeds 10,000 media rows with zero object bytes, so the manifest
round-tripped identically while `media:transfer`'s local-disk guardrail fired
as designed — a source-data finding, not a restore failure. Full record in
`deploy/c11-08-restore-summary.md` and the dated drill log in `deploy/`;
MASTER.md §43 C11.08 now carries the dated F04/F05/F07/F09/F12 evidence.
