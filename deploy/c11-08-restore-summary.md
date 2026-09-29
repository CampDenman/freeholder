# C11.08 live Tier-1 restore drill — record (2026-09-28)

The clause C11.08 left open was *"restore on another Tier-1 target remains the
ownership-drill pair matrix rather than a second live instance."* This drill
ran the real thing end to end on live DigitalOcean infrastructure, per §23's
mandated sequence (export archive → provision target from recipe → import →
storage sync → verify before cutover) and the drill-record fields in
[`ownership-recovery.md`](ownership-recovery.md). Raw transcript:
[`c11-08-restore-drill-2026-09-28.log`](c11-08-restore-drill-2026-09-28.log).

## Drill record (required fields)

- **Restore-drill date:** 2026-09-28 (UTC 2026-09-29T00:14Z – 01:30Z).
- **Operator:** Tony Aly (executed by the Kimi Code agent on the owner's
  machine; every step timestamped in the log).
- **Source archive checksum:** SHA-256
  `e78527321bb2fb93675a57d83f7e7782499c4936e5a8dc19b8eb119a46279123`,
  6,918,459 bytes, custom-format `pg_dump --no-owner --no-privileges`. Verified
  identical on the target box before `pg_restore`.
- **Source:** droplet `freeholder-ref` (id 604232042, 104.131.118.196),
  app+db in compose at /opt/freeholder, running
  `ghcr.io/campdenman/freeholder:edge@sha256:0827de96…0a46a`. Export was
  read-only; the source stayed healthy throughout (its `/perf-home` still
  serves 200 after the drill) and the transient dump file was removed from its
  disk.
- **Target:** droplet `freeholder-restore` (id 604504844, 209.97.155.248,
  nyc3, s-1vcpu-1gb) provisioned from
  [`deploy/digitalocean-droplet`](../deploy/digitalocean-droplet/README.md):
  recipe `cloud-init.yml`, then recipe `compose.yml`/`Caddyfile`/`backup.sh`
  scp'd to /opt/freeholder, `.env` written on-box with freshly generated
  secrets, image pinned to the source digest via the recipe's `FREEHOLDER_IMAGE`
  mechanism (`:edge` had moved to a newer build between the source's last pull
  and this drill; the pin keeps the restore same-schema — both digests are in
  the log).
- **Restore command (the recipe's own shape):** into an empty database —
  `docker compose -f compose.yml exec -T db pg_restore --no-owner
  --no-privileges -U freeholder -d freeholder < freeholder.dump` (the
  `recipe.yaml` `restore`/`migrate-in` operation), exit 0, zero errors.
- **Restored table/row totals:** source logical export 374 tables / 150,812
  rows / 10,000 media assets. Target re-export after restore: 374 tables /
  150,905 rows / 10,000 media assets. Per-table comparison: **366 of 374
  tables identical** in row count *and* canonical SHA-256. The 8 differing
  tables are all runtime-operational — `pgboss.job` (+26), `pgboss.job_common`
  (+52), `pgboss.queue`, `pgboss.schedule`, `pgboss.version`,
  `public.analytics_events` (+4), `public.audit_log` (+10),
  `public.job_runtime_heartbeats` (+1) — written by the *target app's own* live
  job worker/heartbeat between restore and re-export, not by the restore. Every
  owned table matches exactly: contacts 5,001; messages 20,000; orders 2,000;
  invoices 2,000; products 500; assets 10,000; media_objects 10,000; pages 1;
  users 1.
- **Media discrepancy counts:** the media manifest (assets, objects, integrity)
  is **byte-identical** across the restore — `missingInventoryKeys` 0,
  `unreferencedInventoryKeys` 0 on both sides. The byte-level finding:
  **10,000 of 10,000 media objects have no source bytes.** The source dataset
  is DB-seeded (`tests/helpers/performance.ts` inserts `assets`/
  `media_objects` rows; it never writes object bytes), so the *source instance
  itself* 404s its own media. `pnpm media:transfer` refuses local-disk stores
  by design ("local storage is not a Tier-1 migration target") — the guardrail
  fired as written and is captured in the log. Nothing existed to byte-copy, so
  the restore reproduced the source's media state exactly. This is a
  source-data finding, not a restore failure; it is worth a seed-harness
  follow-up so future ref datasets carry real object bytes.
- **Key fingerprint match:** source `CREDENTIAL_KEY` fingerprint
  `5138ef637205fa71e479874daa992bbfc6eb1f2e8893a9a9c0404ed3574074e1`,
  recomputed on the source box (key never displayed) and matching the export's
  `recovery.json` (`secretValuesIncluded: false`, `validFormat: true`). The
  target was provisioned with fresh secrets per the drill plan; because the
  source holds **zero** `connected_accounts` rows, the fresh key strands no
  ciphertext. The runbook's "keep the same CREDENTIAL_KEY" rule matters only
  when encrypted credentials exist.
- **Retention/erasure checks:** the dataset is synthetic test data (no personal
  rows); the restored copy lives only on the disposable drill target. Per
  `ownership-recovery.md`'s post-restore review, `connections.grants` and
  `connected_accounts` were re-checked on the target: 0 rows, so no agent
  grants point at production mailboxes and nothing needed revoking.
- **Verification before cutover (§23 step 4):** the recipe `verify` operation
  (`pnpm doctor`) ran against the target app from the worktree:
  **verdict `warn` — 16 ok / 14 warn / 0 fail of 30 checks** (exit 1). Every
  warning is expected for a scratch drill box: http `APP_URL`, no mail/SMS/
  push/AI adapters, media-on-disk per the documented deviation below, update
  policy undeclared. The File-storage check passed (wrote, read and deleted a
  test file). Owner access used the recipe's own recovery path
  (`scripts/owner-password.mjs --disable-2fa`, then doctor `--enroll-totp` —
  the designed enrollment for a fresh disposable instance); no secret left the
  box.
- **Served-page proof:** `GET http://209.97.155.248/perf-home` → 200 through
  Caddy on the target (and via ssh port-forward), 26,351 bytes, the seeded
  "Performance home" page rendered. Diff against the source-rendered page
  shows only the origin in canonical/OG URLs (`localhost:3000` vs the target
  IP) — the imported site is live on the second instance.

## Recorded deviations (all in the log)

1. **Storage mode:** the droplet recipe mandates Spaces (§18); the target
   mirrors the source's actual local-disk storage (`FREEHOLDER_UNSAFE_LOCAL_
   STORAGE=1` + the `./media/.data` volume, as the source box runs) because the
   source dataset is local-disk and the one historic freeholder Spaces bucket
   no longer exists (404 in all regions). Creating new paid resources was not
   part of the sanctioned drill footprint (two $6 droplets). Doctor reports
   media-on-disk as a warn, as `verify.md` anticipates.
2. **Bind-mount ownership:** the app container runs as uid 1001; docker
   auto-created the host `./media/.data` as root, so the first doctor run
   failed File-storage with EACCES until the directory was `chown`ed to
   1001:1001 (the source box already carries that ownership). Recorded as a
   real-world sharp edge for local-storage overrides.
3. **Image pin:** `FREEHOLDER_IMAGE` set to the source digest; current `:edge`
   had moved on. The recipe's own rollback variable carries the pin.

## Infrastructure left running

Both droplets are **leave-running** for the owner to decide (per drill
instructions): `freeholder-ref` (604232042, 104.131.118.196) and
`freeholder-restore` (604504844, 209.97.155.248). Two $6/mo droplets.
