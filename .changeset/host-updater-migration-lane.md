---
"freeholder": patch
---

Verified host update executors now cover migration-changing releases and the remaining hosting targets. The Docker host updater admits schema-changing candidates only behind an explicit `allow_schema_changes` opt-in: the rehearsal proves the migrations run against a restored backup, cutover holds maintenance for the whole window, and rollback restores the write-free cutover backup before repinning the previous image, because the previous image may not read a migrated schema. A new host updater brings the same discipline to systemd, source-pull and platform deploy-hook targets: digest-pinned immutable artifacts, optional exact-identity cosign verification, a backup hook that must produce a real file, and health-checked rollback that is independently re-verified before a run can call itself rolled back (C10.06).
