# Update preflight

Nothing applies without preflight. `platform.preflightUpdate` (and Doctor
`update.preflight`) run the same checks:

1. **Signature.** A supplied `releases.json` must verify against the embedded
   release public key. A bad signature is a hard stop.
2. **Plugins.** Every installed plugin's `freeholder` range must fit the
   target. A miss *names the plugin*.
3. **Drift.** Live edits of core files mean this instance is a fork.
4. **Environment.** Disk for a snapshot, Postgres 15+, required extensions,
   storage adapter.
5. **Shadow migration.** The live `public` tables are cloned into a temporary
   schema, optional target SQL is applied there, then the schema is dropped.
   The owner's data is not touched.
6. **Downtime.** The estimate is the dry-run's own timing.

This is not unattended apply (C10.06) and not the upgrade gate that boots the
previous image (C10.07).
